# scan.md — Indian Company Portal Scanner
> Trigger: "scan", "find jobs", "what's new", /scan
> Load first: `_shared.md`, `config/profile.yml`, `portals/india.yml`

## How It Works
Queries the Greenhouse/Lever/Ashby APIs of the companies in `data/companies.json` (built by Find
companies: `node scripts/scan.mjs --discover`, several minutes) plus `portals/india.yml`.
No scraping. No bot detection. Clean JSON.
If `data/companies.json` is missing or the profile's roles changed, offer to run Find companies first.
Run the actual scan: `node scripts/scan.mjs`
Then interpret `data/scan_results.json` and present results. Each job has `match`: `core` (one of the
target roles) or `adjacent` (an AI/ML title outside them, only for AI/ML profiles).

## Filtering Logic (scripts/lib/match.mjs, from profile.yml)
- Title match: the title names a target role (its words in order, at most one extra word between
  them, or "Engineer, Machine Learning" style). AI/ML titles and AI keywords count only when the
  target roles are AI/ML.
- A blocked-word list (sales, designer…) never hides a title that names one of your roles.
- Location: India (whole-word city names) or remote, or anywhere when `locations` has `Anywhere`
- Experience: under 3 years, titles with senior words (senior, lead, manager…) are skipped, except
  words that are part of your own role. The dashboard then reads the required years from each JD.

## Output Format
```
## Scan Results — {date}
Companies scanned: {N} | Jobs found: {N} | Matching profile: {N}

### 🟢 New since last scan
[jobs not already in pipeline.json]

### 📋 Top Matches
| # | Company | Role | Location | Posted | Est. Grade | URL |
[ranked by estimated fit]

### ⚠️ Partial Matches (review manually)
[keyword match but title not exact]
```

## Post-Scan Actions
1. "Evaluate any of these? Give me the number."
2. "Add all estimated A/B to tracker as to_apply?"
3. "Want to scan with different keywords?"

## Score Estimation During Scan
These are estimates — run /evaluate for full scoring.
- ~A/B: exact title match + Tier 1 company + salary likely in range
- ~C: partial match or unknown company tier
- ~D/F: experience or location mismatch

## Adding Companies
If user says "add [company]":
1. Check careers page URL for ATS provider (greenhouse.io / lever.co / ashbyhq.com)
2. Find the slug
3. Add to `portals/india.yml`
4. Confirm: "Added [company] to scan list."
