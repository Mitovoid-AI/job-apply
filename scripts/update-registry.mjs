#!/usr/bin/env node
/**
 * scripts/update-registry.mjs — refresh portals/registry.json, the company list Find companies checks.
 *
 * Source: the employer registry of career-ops (https://github.com/career-ops-hq/career-ops, folder
 * employers/), CC BY 4.0; the credit and the registry's own notices go to portals/registry-NOTICE.md.
 * Keeps Greenhouse, Lever and Ashby boards in the US data region (the APIs scan.mjs calls) that aren't
 * retired, and only each board's id and company name.
 *
 * Run: node scripts/update-registry.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "career-ops-hq/career-ops";
const ATS = ["greenhouse", "lever", "ashby"];
const headers = { "User-Agent": "job-apply-registry", Accept: "application/vnd.github+json" };

async function get(url, as = "json") {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return as === "json" ? r.json() : r.text();
}

const sha = (await get(`https://api.github.com/repos/${REPO}/commits?path=employers&per_page=1`))[0].sha;
const raw = p => `https://raw.githubusercontent.com/${REPO}/${sha}/${p}`;
const boards = {}, counts = {};
for (const ats of ATS) {
  const files = (await get(`https://api.github.com/repos/${REPO}/contents/employers/boards/${ats}?ref=${sha}`))
    .filter(f => f.name.endsWith(".ndjson"));
  const seen = new Map();
  for (const f of files) {
    for (const line of (await get(raw(`employers/boards/${ats}/${f.name}`), "text")).split("\n")) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (row.ats !== ats || !row.board || row.retired || (row.region || "us") !== "us") continue;
      const key = String(row.board).toLowerCase();
      if (!seen.has(key)) seen.set(key, [String(row.board), String(row.name || row.board)]);
    }
  }
  boards[ats] = [...seen.values()].sort((a, b) => a[0].localeCompare(b[0]));
  counts[ats] = boards[ats].length;
  console.log(`${ats}: ${counts[ats]} boards`);
}

// One board per line, so a refresh shows up as a readable diff.
const lines = ATS.map(ats => `    "${ats}": [\n${boards[ats].map(b => `      ${JSON.stringify(b)}`).join(",\n")}\n    ]`);
fs.writeFileSync(path.join(ROOT, "portals/registry.json"), `{
  "source": "https://github.com/${REPO}/tree/${sha}/employers",
  "license": "CC BY 4.0, https://creativecommons.org/licenses/by/4.0/ (credit: portals/registry-NOTICE.md)",
  "fetched_at": "${new Date().toISOString()}",
  "counts": ${JSON.stringify(counts)},
  "boards": {
${lines.join(",\n")}
  }
}
`);

const notices = await get(raw("employers/THIRD_PARTY_NOTICES.md"), "text");
fs.writeFileSync(path.join(ROOT, "portals/registry-NOTICE.md"), `# Company registry notice

\`portals/registry.json\` is derived from the employer registry of
[career-ops](https://github.com/${REPO}) (folder \`employers/\`, commit \`${sha}\`).
Licensor and database maker: Santiago Fernández de Valderrama. It is licensed under the
Creative Commons Attribution 4.0 International License (CC BY 4.0),
https://creativecommons.org/licenses/by/4.0/.

**Changes:** only Greenhouse, Lever and Ashby boards in the US data region that are not retired
are kept, and only each board's id and company name. Refreshed with
\`node scripts/update-registry.mjs\`.

The registry's own third-party notices follow, as published at that commit.

---

${notices.trim()}
`);
console.log(`Saved portals/registry.json and portals/registry-NOTICE.md (commit ${sha.slice(0, 7)})`);
