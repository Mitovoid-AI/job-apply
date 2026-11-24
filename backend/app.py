"""FastAPI app: JSON API under /api, the built frontend everywhere else.

Local only: bound to 127.0.0.1, rejects any Host header that isn't localhost (so a web page
can't reach it through DNS rebinding), and every /api call needs the token from
data/.dashboard-token (header X-Token, or ?token= for PDF/report links).
"""

import secrets
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import apply, jd, jobs, llm, prepare, profile, runners, settings, tasks, window


def load_token() -> str:
    if settings.TOKEN_FILE.exists():
        return settings.TOKEN_FILE.read_text(encoding="utf-8").strip()
    token = secrets.token_urlsafe(24)
    settings.TOKEN_FILE.write_text(token, encoding="utf-8")
    return token


TOKEN = load_token()
app = FastAPI(title="job-apply", docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def guard(request: Request, call_next):
    host = (request.headers.get("host") or "").split(":")[0]
    if host not in ("127.0.0.1", "localhost"):
        return PlainTextResponse("Forbidden host", status_code=403)
    if request.url.path.startswith("/api/"):
        given = request.headers.get("x-token") or request.query_params.get("token")
        if not given or not secrets.compare_digest(given, TOKEN):
            return JSONResponse({"detail": "Missing or wrong token. Open the link the server printed."},
                                status_code=401)
    return await call_next(request)


def _job_or_404(job_id: str) -> dict:
    job = next((j for j in jobs.list_jobs() if j["id"] == job_id), None)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


# ── Read ──────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    import shutil
    return {
        "ok": True,
        "tailor": bool(settings.TAILOR_DIR and (settings.TAILOR_DIR / "tailor.py").exists()),
        "claude": bool(shutil.which(settings.CLAUDE_BIN)),
        "node": bool(shutil.which(settings.NODE_BIN)),
        "profile": settings.PROFILE.exists(),
        "cv": settings.CV.exists(),
        "daily_scan_at": settings.DAILY_SCAN_AT or None,
        "llm": llm.available(),
        "auto_prepare": sorted(settings.AUTO_PREPARE),
        "auto_evaluate": settings.AUTO_EVALUATE,
    }


@app.get("/api/overview")
def overview():
    return jobs.overview()


@app.get("/api/jobs")
def list_jobs():
    return jobs.list_jobs()


@app.get("/api/jobs/{job_id}")
def job_detail(job_id: str):
    job = _job_or_404(job_id)
    cached = jd.get(job_id) or jd.ensure(job) or {}  # fetch on first open if the scan missed it
    job["fit"] = jd.fit_for(job_id)
    report = ((job.get("pipeline") or {}).get("evaluation") or {}).get("report")
    report_text = None
    if report:
        p = (settings.ROOT / report).resolve()
        if p.is_relative_to(settings.REPORTS.resolve()) and p.exists():
            report_text = p.read_text(encoding="utf-8")
    return {**job, "jd": cached.get("text"), "jd_fetched_at": cached.get("fetched_at"), "report_text": report_text}


@app.get("/api/pipeline")
def pipeline():
    return jobs.load_pipeline()


@app.get("/api/profile")
def get_profile():
    return profile.get_profile()


@app.get("/api/apply/batches")
def batches():
    return apply.batch_summaries()


@app.get("/api/apply/batches/{name}")
def batch(name: str):
    try:
        b = apply.get_batch(name)
    except ValueError:
        raise HTTPException(400, "Bad batch name")
    if b is None:
        raise HTTPException(404, "Batch not found")
    return b


@app.get("/api/files/pdf")
def pdf(path: str):
    if not settings.TAILOR_OUTPUT:
        raise HTTPException(404, "TAILOR_DIR not set")
    p = Path(path).resolve()
    if p.suffix.lower() != ".pdf" or not p.is_relative_to(settings.TAILOR_OUTPUT.resolve()) or not p.exists():
        raise HTTPException(404, "PDF not found")
    return FileResponse(p, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{p.name}"'})


@app.get("/api/tasks")
def running_tasks():
    return tasks.running()


@app.get("/api/tasks/{task_id}")
def task(task_id: str):
    t = tasks.get(task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    return t


# ── Actions ───────────────────────────────────────────────────────────
@app.post("/api/scan")
def scan():
    return tasks.start("scan", "all", runners.scan)


@app.post("/api/jobs/{job_id}/track")
def track(job_id: str):
    job = _job_or_404(job_id)
    jobs.track(job)
    return _job_or_404(job_id)


@app.post("/api/jobs/{job_id}/resume")
def build_resume(job_id: str):
    job = _job_or_404(job_id)
    return tasks.start("resume", job_id, lambda: runners.resume(job))


@app.post("/api/jobs/{job_id}/evaluate")
def evaluate(job_id: str):
    job = _job_or_404(job_id)
    return tasks.start("evaluate", job_id, lambda: runners.evaluate(job))


@app.post("/api/jobs/{job_id}/prepare")
def prepare_one(job_id: str):
    job = _job_or_404(job_id)
    return tasks.start("prepare", job_id, lambda: prepare.prepare_job(job))


@app.post("/api/apply/batches/{name}/jobs/{n}/open")
def open_window(name: str, n: int):
    """Open the filled form in a Chrome window on this machine. The user presses Submit."""
    if window.state().get("status") in ("opening", "filling", "waiting"):
        raise HTTPException(409, "A form window is already open. Finish or close it first.")
    return tasks.start("window", f"{name}:{n}", lambda: window.run(name, n))


@app.get("/api/apply/window")
def window_state():
    return window.state()


@app.post("/api/apply/batches/{name}/jobs/{n}/submitted")
def mark_submitted(name: str, n: int):
    """The user says they submitted it (e.g. closed the window before the confirmation showed)."""
    try:
        b = apply.get_batch(name)
    except ValueError:
        raise HTTPException(400, "Bad batch name")
    job = next((j for j in (b or {}).get("jobs", []) if j.get("n") == n), None)
    if not job:
        raise HTTPException(404, "Job not found in batch")
    window._record(name, job, "you confirmed it on the dashboard")
    if window.state().get("batch") == name and window.state().get("n") == n:
        window._set(status="submitted", proof="confirmed by you")
    return apply.get_batch(name)


class PipelinePatch(BaseModel):
    status: str | None = None
    next_action: str | None = None
    notes: str | None = None


@app.patch("/api/pipeline/{entry_id}")
def patch_pipeline(entry_id: int, body: PipelinePatch):
    fields = body.model_dump(exclude_none=True)
    if "status" in fields and fields["status"] not in jobs.VALID_STATUSES:
        raise HTTPException(400, f"Status must be one of: {', '.join(jobs.VALID_STATUSES)}")
    entry = jobs.update_entry(entry_id, fields)
    if not entry:
        raise HTTPException(404, "Tracker entry not found")
    return entry


class ProfileUpdate(BaseModel):
    answers: dict | None = None
    candidate: dict | None = None
    salary: dict | None = None


@app.put("/api/profile")
def put_profile(body: ProfileUpdate):
    if not settings.PROFILE.exists():
        raise HTTPException(400, "config/profile.yml doesn't exist yet: copy config/profile.example.yml")
    try:
        return profile.update_profile(body.answers, body.candidate, body.salary)
    except (TypeError, ValueError) as e:
        raise HTTPException(400, f"Invalid value: {e}")


class BatchJobPatch(BaseModel):
    fields: list[dict] = []
    ready: bool | None = None


@app.patch("/api/apply/batches/{name}/jobs/{n}")
def patch_batch_job(name: str, n: int, body: BatchJobPatch):
    try:
        b = apply.update_job(name, n, body.fields, body.ready)
    except ValueError:
        raise HTTPException(400, "Bad batch name")
    if b is None:
        raise HTTPException(404, "Batch not found")
    return b


# ── Frontend ──────────────────────────────────────────────────────────
if (settings.FRONTEND_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=settings.FRONTEND_DIST / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    index = settings.FRONTEND_DIST / "index.html"
    if path.startswith("api/"):
        raise HTTPException(404)
    f = (settings.FRONTEND_DIST / path).resolve()
    if path and f.is_file() and f.is_relative_to(settings.FRONTEND_DIST.resolve()):
        return FileResponse(f)
    if index.exists():
        return FileResponse(index)
    return HTMLResponse("<p>Frontend not built. Run <code>npm run build</code> in <code>frontend/</code>, "
                        "or use the dev server (<code>npm run dev</code>).</p>")
