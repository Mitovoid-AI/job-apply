# apply.md — Assisted applications (prepare, review, then submit what's approved)
> Trigger: "apply", "apply to these", "apply to the top N", /apply
> Load first: `_shared.md`, `config/profile.yml` (`application_answers` + `candidate`), `data/pipeline.json`
> Browser: Claude in Chrome (the user's Chrome). It can attach the resume PDF to the form.

## Ground rules (no exceptions)
1. **Nothing is submitted without the user's OK for that job number in their latest message**
   (e.g. `submit 1, 3`). An OK covers exactly what the review table showed for that job. It
   never carries over to other jobs, later batches or changed forms.
2. **Only type values the user gave:** `application_answers` / `candidate` in `profile.yml`,
   or text the user approved in the review table. Never invent experience, CTC, notice
   period, skills, visa status or any other fact.
3. **Never type passwords, create accounts or solve CAPTCHAs.** Stop and hand that job to the user.
4. **Never tick marketing or newsletter opt-ins.** Required privacy/consent checkboxes are listed
   in the review table; the user's OK for that job covers ticking them.
5. **Diversity, disability and veteran questions:** use `eeo_default` ("Prefer not to say")
   unless the user set another answer.
6. **Forms handled:** Greenhouse, Lever and Ashby. Anything behind a login (Workday, company
   portals), LinkedIn Easy Apply and Naukri: give the user the link and don't automate it.
7. **Never apply twice:** skip any job whose pipeline entry is `applied` or later.
8. **Grade A or B only**, unless the user names the job themselves.

## Step 1 — Pick the batch
- From the user: job numbers from the last scan/pipeline view, or URLs. "Top N" means the best
  A/B entries in `data/pipeline.json` with status `to_apply`.
- At most 5 jobs per batch.
- A job with no pipeline entry gets one first (status `to_apply`, `_shared.md` format).

## Step 2 — Prepare each job (type nothing into any form yet)
1. **Still open?** Load the job URL. Closed / 404 / "no longer accepting" → set status
   `expired`, drop it from the batch.
2. **Read the form.** List every field: label, type, required or not, options.
   - Always read the live form in the browser (read only, type nothing). Greenhouse: the form
     on the job page. Lever: `<job url>/apply`. Ashby: the job's "Application" tab.
   - Greenhouse extra: `https://boards-api.greenhouse.io/v1/boards/<board>/jobs/<id>?questions=true`
     gives the custom questions with their dropdown options, but it leaves out standard fields
     (country, city, the education block), so it never replaces reading the page.
   - Note any reCAPTCHA / hCaptcha script on the page as a blocker risk ("may challenge on Submit").
3. **Resume.** Run the resume-tailor skill with the job URL and `--company "<Company>"`. Save
   the PDF path as `resume_pdf` on the pipeline entry. Flag `page_count` above `page_limit`.
4. **Answer each field:**
   - Standard fields (name, email, phone, links, city, company, experience, education,
     notice, CTC, relocation, work authorization, source) → from `application_answers`.
   - Dropdowns and radio buttons → the option that matches the answer; no matching option → flag it.
   - Free-text questions (why this company, a project, cover letter) → draft up to 120 words
     using only facts from `cv.md`. Mark it **DRAFT**: the user must approve the text.
   - A required field whose value is empty in the profile → **NEED** (ask the user).
   - Optional fields with no value → leave empty.
5. **Blockers:** CAPTCHA on the page, login wall, odd upload rules (e.g. Word file only).

## Step 3 — Review table (save it, show it, then stop)
Save the full detail to `data/apply/<YYYY-MM-DD>-batch-<n>.md` (gitignored), then show:

```
| # | Company · Role | Grade | Resume (base, pages) | Key answers | Drafts | Needs from you | Blockers |
|---|---|---|---|---|---|---|---|
| 1 | Sarvam AI · ML Engineer | A | AI_ML_Engineer, 1 p | Notice 30d · Exp. CTC 18 LPA · Relocate: yes | 1a | — | — |
| 2 | ... | B | ... | ... | — | Expected CTC | CAPTCHA |

1a. "Why Sarvam AI?" (DRAFT, 84 words)
> ...

Consent checkboxes: 1 → "I agree to the privacy policy" (required)
```

End with: *Reply with the numbers to submit, e.g. `submit 1, 3`, plus any edits
(`1a: <your text>`, `2: expected CTC 18 LPA`). Nothing is sent until you do.*
Then **stop and wait** for the user's reply.

## Step 4 — Submit only what was approved
Read the user's reply: only the numbers they listed, with their edits applied. A job that
still has an unanswered NEED is skipped (say so). For each approved job, one at a time:
1. Open the form fresh. Fill every field from the approved table and attach `resume_pdf`.
2. Re-read the filled form and compare it with the approved table. If anything differs (a new
   required question, different options, a CAPTCHA, a login wall) → don't submit; tell the
   user what changed and move on.
3. Click Submit once. Wait for the confirmation message or page. No confirmation after about
   15 s → check the page and report it as "unclear"; never submit a second time.
4. Update the pipeline entry: `status: applied`, `date_applied` today, `applied_via: claude`,
   `resume_pdf`, `apply_batch`, and the confirmation text in `notes`.

Finish with a table: submitted / skipped (why) / failed, then run `npm run verify`.

## Fill-only variant (option A)
If the user says "fill but don't submit": do Steps 2 and 4.1–4.2 for one job, leave the tab open
at the Submit button, and stop. When the user says they submitted it, update the tracker
(`applied_via: manual`).
