# job-apply

Find, evaluate, tailor and track job applications at Indian companies, with a local dashboard
and Claude Code.

- **Find:** scans the public job boards (Greenhouse, Lever, Ashby) of the companies in
  `portals/india.yml` and reads how many years of experience each job asks for. AI/ML jobs
  outside your `target_roles` (Data Scientist, SDE - AI…) are labelled adjacent and hidden on
  the Jobs page until you switch them on.
- **Evaluate:** grades a job A–F against your CV, using Claude Code in the background.
- **Tailor:** builds a one-page resume for the job with your own resume tailor (a separate repo
  with `tailor.py --json`).
- **Prepare:** after each scan, every job at your level gets a tailored resume and an answer for
  every field of its application form: profile values by rule, job-specific questions drafted by AI
  from your CV, and questions only you can answer left blank and flagged.
- **Apply:** "Open filled form" starts Chrome **on your machine** with everything filled in and the
  resume attached. You check it and press the site's Submit button; the confirmation page marks the
  job Applied.
- **Track:** a status board from "to apply" to "offer".

No code ever presses Submit. You do, on the real form (or you tell Claude Code to, job by job; see
`modes/apply.md`).

## Screens

| Screen | What it does |
|---|---|
| Overview | Matches, jobs that fit your experience, a funnel, and what needs your attention |
| Jobs | Filterable table with an experience badge (fits / stretch / too senior). Click a job for its description, evaluation, resume preview and actions |
| Pipeline | Drag-and-drop board of tracked jobs by status |
| Apply | Prepared applications: check or edit any answer, then Open filled form and press Submit |
| Profile | The answers application forms ask for (notice period, CTC, LinkedIn…) |
| Settings | Checks that Node, the tailor and Claude Code are set up |

## Setup

Requires Python 3.11+, Node 18+, Google Chrome (reading and filling forms), an OpenAI-compatible
AI key (drafting answers; your tailor's `.env` is reused if this repo has none), and, for grades,
Claude Code.

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

It prints a link like `http://127.0.0.1:8765/#token=…` and opens it in your default browser, or in
`DASHBOARD_BROWSER` if set (for a Chromium-based browser that wraps Brave or Chrome, also set
`DASHBOARD_BROWSER_PROFILE` to its profile folder so the link opens in the running window). Double-click `dashboard.pyw`
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
  scanned. `portals/india.yml` also has 17 global companies with India AI/ML jobs (31 boards in
  all). Add companies there once you've checked their board URL.
- The experience badge reads the first "N years" requirement in the description. It's a quick
  filter, not a grade.
- Application forms with a CAPTCHA or a login stop and hand over to you. There is no CAPTCHA
  workaround, by design.
- Form filling is tested on Greenhouse, Lever and Ashby forms. Searchable dropdowns (school, city)
  are matched by closest name; anything that doesn't fill is listed so you fill it in the window.
  Ashby's yes/no button questions aren't read yet.
- AI drafts only use your CV and profile, but read them before you press Submit: they're marked
  "draft" on the Apply page.
- "Applied" is set when the site's confirmation page appears. If you close the window first, the
  Apply page asks whether you submitted it.

## Credits

The scanner, Claude Code modes and company list are adapted from
[career-ops-india](https://github.com/AnojSKunte/career-ops-india) by Anoj S K (MIT), itself
inspired by [career-ops](https://github.com/santifer/career-ops). See `THIRD_PARTY_NOTICES.md`.
