# job-apply

Find, evaluate, tailor and track job applications at Indian companies, with a local dashboard
and Claude Code.

- **Find:** scans the public job boards (Greenhouse, Lever, Ashby) of the companies in
  `portals/india.yml` and reads how many years of experience each job asks for.
- **Evaluate:** grades a job A–F against your CV, using Claude Code in the background.
- **Tailor:** builds a one-page resume for the job with your own resume tailor (a separate repo
  with `tailor.py --json`).
- **Apply:** Claude Code reads the application form and prepares every answer. You review and fix
  them on the dashboard, then tell Claude which ones to submit.
- **Track:** a status board from "to apply" to "offer".

Nothing is ever submitted from the dashboard. Submitting is always a message you send to Claude
Code, job by job (see `modes/apply.md`).

## Screens

| Screen | What it does |
|---|---|
| Overview | Matches, jobs that fit your experience, a funnel, and what needs your attention |
| Jobs | Filterable table with an experience badge (fits / stretch / too senior). Click a job for its description, evaluation, resume preview and actions |
| Pipeline | Drag-and-drop board of tracked jobs by status |
| Apply | Edit the answers Claude prepared, fill in missing ones, approve drafts, copy the submit command |
| Profile | The answers application forms ask for (notice period, CTC, LinkedIn…) |
| Settings | Checks that Node, the tailor and Claude Code are set up |

## Setup

Requires Python 3.11+, Node 18+, and (for Evaluate and Apply) Claude Code.

```bash
git clone https://github.com/Mitovoid-AI/job-apply && cd job-apply
pip install -r requirements.txt
npm --prefix frontend install
npm --prefix frontend run build

cp config/profile.example.yml config/profile.yml   # then fill it in
cp .env.example .env                              # set TAILOR_DIR to your resume tailor repo
```

Also create `cv.md` (your CV in Markdown). Evaluate compares jobs against it.

For **Evaluate**, Claude Code must be signed in on the command line: run `claude` once in a
terminal and use `/login`.

## Run

```bash
python -m backend          # or double-click start-dashboard.cmd
```

It prints a link like `http://127.0.0.1:8765/#token=…` and opens it. Double-click `dashboard.pyw`
to run it without a console window (logs go to `data/dashboard.log`). To scan every morning, set
`DAILY_SCAN_AT=09:00` in `.env`; the scan runs while the dashboard is running.

Frontend development: run the backend, then `npm --prefix frontend run dev` and open the Vite
URL with the same `#token=…`.

## Using it with Claude Code

Open Claude Code in this folder. `CLAUDE.md` routes requests to the modes in `modes/`:

- `scan` / `/scan` — find jobs (same as the dashboard's Scan button)
- `/evaluate <url>` — full A–F report in `reports/`
- `/pdf <job>` — tailored resume through the resume-tailor skill
- `/apply <jobs>` — read the forms, build resumes, save a batch to `data/apply/`, show the review table
- `submit 1, 3 from batch <name>` — submits only those jobs, after re-checking anything you changed
  on the dashboard
- `/tracker` — update statuses

## Data and privacy

Everything stays in local files; there is no database:

| File | What |
|---|---|
| `config/profile.yml` | your answers, target roles, salary |
| `cv.md` | your CV |
| `data/pipeline.json` | tracked jobs |
| `data/scan_results.json`, `data/jd/` | latest scan and cached job descriptions |
| `data/apply/*.json` | apply batches |
| `reports/` | evaluation reports |

All of these are gitignored. The dashboard only listens on `127.0.0.1`, rejects requests whose
`Host` isn't localhost, and needs the token in `data/.dashboard-token` for every API call.

## Limits

- Only 14 of the 253 companies inherited from career-ops-india have a job board that responds on
  Greenhouse, Lever or Ashby. The rest are kept in `portals/india-unverified.yml` and aren't
  scanned. Add companies to `portals/india.yml` once you've checked their board URL.
- The experience badge reads the first "N years" requirement in the description. It's a quick
  filter, not a grade.
- Application forms with a CAPTCHA or a login stop and hand over to you.

## Credits

The scanner, Claude Code modes and company list are adapted from
[career-ops-india](https://github.com/AnojSKunte/career-ops-india) by Anoj S K (MIT), itself
inspired by [career-ops](https://github.com/santifer/career-ops). See `THIRD_PARTY_NOTICES.md`.
