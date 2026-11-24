#!/usr/bin/env node
/**
 * scripts/scan.mjs — career-ops-india portal scanner
 * 
 * Hits Greenhouse, Lever, and Ashby ATS APIs for 60+ Indian companies.
 * Zero LLM tokens. Zero scraping. Clean JSON responses.
 * 
 * Run:  npm run scan
 * Run:  node scripts/scan.mjs --board greenhouse
 * Run:  node scripts/scan.mjs --json    (raw JSON output)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readConfig, makeMatcher } from "./lib/match.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// ── Portals loader ────────────────────────────────────────────────────────────
function readPortals() {
  const p = path.join(ROOT, "portals/india.yml");
  const text = fs.readFileSync(p, "utf8");
  const result = { greenhouse: [], lever: [], ashby: [] };
  let section = null, current = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("#") || !line.trim()) continue;
    const indent = line.match(/^(\s*)/)[1].length;
    const content = line.trim();
    if (indent === 0 && content.endsWith(":")) { section = content.replace(":",""); continue; }
    if (indent === 2 && content.startsWith("- name:")) {
      current = { name: content.replace("- name:","").trim() };
      if (result[section]) result[section].push(current);
    } else if (indent === 4 && current) {
      const [k,...v] = content.split(":");
      current[k.trim()] = v.join(":").trim().replace(/^"(.*)"$/, "$1");  // tier: "1" -> 1
    }
  }
  return result;
}

// ── ATS fetchers ──────────────────────────────────────────────────────────────
// Lever's API often takes 3–6 s per board and slower under load, so allow 25 s; boards that
// still fail are retried once, one at a time, after the first pass.
const TIMEOUT_MS = 25000;

async function fetchGreenhouse(slug, content = true) {
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs${content ? "?content=true" : ""}`,
      { headers: { "User-Agent": "career-ops-india/1.0" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { jobs: [], err: `HTTP ${res.status}` };
    const d = await res.json();
    return { jobs: d.jobs || [] };
  } catch(e) { return { jobs: [], err: e.message }; }
}

async function fetchLever(slug) {
  try {
    const res = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`,
      { headers: { "User-Agent": "career-ops-india/1.0" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { jobs: [], err: `HTTP ${res.status}` };
    const d = await res.json();
    return { jobs: Array.isArray(d) ? d : [] };
  } catch(e) { return { jobs: [], err: e.message }; }
}

async function fetchAshby(slug) {
  try {
    const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}`,
      { headers: { "User-Agent": "career-ops-india/1.0", "Accept": "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { jobs: [], err: `HTTP ${res.status}` };
    const d = await res.json();
    return { jobs: d.jobs || d.jobPostings || [] };   // the API returns "jobs"
  } catch(e) { return { jobs: [], err: e.message }; }
}

// ── Normalizers ───────────────────────────────────────────────────────────────
function normGH(j, co) {
  return { source:"greenhouse", company:co.name, tier:co.tier||"2",
    title:j.title||"", location:j.location?.name||"India",
    // Some boards' absolute_url is the company's own careers site (?gh_jid=), which the JD reader
    // and form filler can't use; the Greenhouse link redirects there in a browser anyway.
    url:/greenhouse\.io\//.test(j.absolute_url||"") ? j.absolute_url : `https://job-boards.greenhouse.io/${co.slug}/jobs/${j.id}`,
    // first_published is when the job went up; updated_at changes on every edit.
    posted_at:j.first_published||j.updated_at||j.created_at||null, department:j.departments?.[0]?.name||"",
    remote:(j.location?.name||"").toLowerCase().includes("remote"),
    snippet:(j.content||"").replace(/<[^>]*>/g," ").slice(0,300) };
}
function normLV(j, co) {
  const loc = j.categories?.location || j.workplaceType || "";
  return { source:"lever", company:co.name, tier:co.tier||"2",
    title:j.text||"", location:loc,
    url:j.hostedUrl||j.applyUrl||"",
    posted_at:j.createdAt ? new Date(j.createdAt).toISOString() : null,
    department:j.categories?.department||"",
    remote:loc.toLowerCase().includes("remote"),
    snippet:(j.descriptionPlain||"").slice(0,300) };
}
function normAB(j, co) {
  const loc = j.location||j.locationName||j.jobPostingLocations?.[0]?.locationName||"";
  return { source:"ashby", company:co.name, tier:co.tier||"2",
    title:j.title||"", location:loc,
    url:j.jobUrl||`https://jobs.ashbyhq.com/${co.slug}/${j.id}`,
    posted_at:j.publishedAt||null, department:j.department||j.departmentName||"",
    remote:j.isRemote||loc.toLowerCase().includes("remote"),
    snippet:(j.descriptionHtml||"").replace(/<[^>]*>/g," ").slice(0,300) };
}

// ── Main ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const boardFilter = args.find(a => a.startsWith("--board="))?.split("=")[1];
const jsonMode = args.includes("--json");
const discoverMode = args.includes("--discover");

const cfg = readConfig(path.join(ROOT, "config/profile.yml"));
const { roles, anywhere } = cfg;
const { matches, roleMatch } = makeMatcher(cfg);
const FETCH = { greenhouse: [fetchGreenhouse, normGH], lever: [fetchLever, normLV], ashby: [fetchAshby, normAB] };
const dataDir = path.join(ROOT, "data");
fs.mkdirSync(dataDir, { recursive: true });
const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } };

// Run fn over items with at most `size` running at once.
async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

// ── Find companies (--discover) ───────────────────────────────────────────────
// Checks every board in portals/registry.json (plus portals/india.yml) against your profile and
// saves the boards with matching jobs to data/companies.json, which Scan now then reads. Boards that
// answer 404 are skipped for 30 days (data/registry_dead.json). Takes a few minutes.
async function discover() {
  const reg = readJson(path.join(ROOT, "portals/registry.json"), { boards: {} });
  const seed = readPortals();
  const deadPath = path.join(dataDir, "registry_dead.json");
  const dead = readJson(deadPath, {});
  const recheckBefore = Date.now() - 30 * 864e5;
  const boards = [], keys = new Set();
  let skipped = 0;
  const add = (ats, slug, name) => {
    const k = `${ats}:${String(slug).toLowerCase()}`;
    if (keys.has(k)) return;
    keys.add(k);
    if (dead[k] && Date.parse(dead[k]) > recheckBefore) { skipped++; return; }
    boards.push({ ats, slug, name });
  };
  for (const ats of Object.keys(FETCH)) {
    if (boardFilter && boardFilter !== ats) continue;
    for (const c of seed[ats]) add(ats, c.slug, c.name);
    for (const [slug, name] of reg.boards?.[ats] || []) add(ats, slug, name);
  }
  if (!jsonMode) {
    console.log(`\n🔎 Find companies: ${boards.length} boards to check (${skipped} known-dead skipped)`);
    console.log(`   Roles: ${roles.join(", ")}  |  Locations: ${anywhere ? "anywhere" : "India and remote"}\n`);
  }
  const started = Date.now(), found = [], retryLater = [];
  let done = 0, live = 0, newlyDead = 0;
  const check = async (b, last) => {
    const [fetcher, norm] = FETCH[b.ats];
    const { jobs, err } = b.ats === "greenhouse" ? await fetcher(b.slug, false) : await fetcher(b.slug);
    const k = `${b.ats}:${String(b.slug).toLowerCase()}`;
    if (err) {
      if (/^HTTP (404|410)\b/.test(err)) {  // gone: skip it for the next 30 days
        if (!dead[k]) newlyDead++;
        dead[k] = new Date().toISOString();
      } else if (!last) retryLater.push(b);
    } else {
      live++;
      delete dead[k];
      const co = { name: b.name || b.slug, slug: b.slug, tier: "2" };
      const matched = jobs.map(j => norm(j, co)).filter(matches);
      if (matched.length) found.push({ ats: b.ats, slug: b.slug, name: co.name, matches: matched.length,
        core: matched.filter(j => roleMatch(j) === "core").length, sample: matched.slice(0, 3).map(j => j.title) });
    }
    if (!jsonMode && !last && ++done % 1000 === 0)  // second tries aren't counted again
      console.log(`  ${done}/${boards.length} checked · ${found.length} companies with matches · ${Math.round((Date.now() - started) / 1000)} s`);
  };
  await pool(boards, 48, b => check(b, false));  // Lever can take ~8 s even for a 404
  // Timeouts and 5xx get one more try, gently.
  await pool(retryLater, 6, b => check(b, true));
  found.sort((a, b) => b.core - a.core || b.matches - a.matches);
  const out = { discovered_at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000),
    roles, anywhere, experience_years: cfg.expYears, boards_checked: boards.length, boards_live: live,
    dead_skipped: skipped, companies: found };
  fs.writeFileSync(path.join(dataDir, "companies.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(deadPath, JSON.stringify(dead));
  const summary = { companies: found.length, jobs: found.reduce((n, c) => n + c.matches, 0),
    core_jobs: found.reduce((n, c) => n + c.core, 0), boards_checked: boards.length, boards_live: live,
    newly_dead: newlyDead, seconds: out.seconds };
  if (jsonMode) { console.log(JSON.stringify(summary)); return; }
  console.log(`\n✅ ${found.length} companies have ${summary.jobs} matching jobs (${summary.core_jobs} in your target roles)`);
  console.log(`   ${live} of ${boards.length} boards answered · ${newlyDead} new dead boards · ${out.seconds} s`);
  console.log(`   Saved to data/companies.json; Scan now will check these companies.\n`);
}

if (discoverMode) { await discover(); process.exit(0); }

// Scan now: the companies in portals/india.yml plus the ones Find companies saved to data/companies.json.
const portals = readPortals();
const discovered = readJson(path.join(dataDir, "companies.json"), null);
for (const c of discovered?.companies || []) {
  const list = portals[c.ats];
  if (list && !list.some(x => x.slug.toLowerCase() === c.slug.toLowerCase()))
    list.push({ name: c.name, slug: c.slug, tier: "2", discovered: true });
}
const results = [], errors = [], retry = [];

if (!jsonMode) {
  console.log(`\n🔍 career-ops-india scanner`);
  console.log(`   Roles: ${roles.join(", ")}`);
  console.log(`   Locations: ${anywhere ? "anywhere" : "India and remote"}`);
  console.log(`   Companies: ${portals.greenhouse.length + portals.lever.length + portals.ashby.length}` +
    (discovered ? ` (${discovered.companies?.length || 0} from Find companies)` : "") + "\n");
}

async function scanBoard(name, companies, fetcher, normalizer) {
  if (boardFilter && boardFilter !== name) return;
  if (!jsonMode) process.stdout.write(`Scanning ${companies.length} ${name} companies...`);
  await pool(companies, 24, async co => {
    if (co.note?.includes("current employer")) return;
    // Discovered boards skip Greenhouse's full descriptions (only used for the AI-keyword fallback):
    // with thousands of companies they make the scan many times slower.
    const { jobs, err } = await fetcher(co.slug, !co.discovered);
    if (err) { retry.push({ co, fetcher, normalizer, err }); return; }
    const matched = jobs.map(j => normalizer(j, co)).filter(matches);
    if (matched.length && !jsonMode) process.stdout.write(` ${co.name}(${matched.length})`);
    results.push(...matched);
  });
  if (!jsonMode) console.log(" ✓");
}

await scanBoard("greenhouse", portals.greenhouse, fetchGreenhouse, normGH);
await scanBoard("lever",      portals.lever,      fetchLever,      normLV);
await scanBoard("ashby",      portals.ashby,      fetchAshby,      normAB);

// Second chance for boards that timed out or errored, one at a time.
for (const { co, fetcher, normalizer, err: firstErr } of retry) {
  const { jobs, err } = await fetcher(co.slug);
  if (err) { errors.push({ company: co.name, error: err || firstErr }); continue; }
  results.push(...jobs.map(j => normalizer(j, co)).filter(matches));
}
if (retry.length && !jsonMode) console.log(`Retried ${retry.length} board(s): ${retry.length - errors.length} recovered`);

// Dedup by title+company+location (without location, a same-title job abroad could hide the India one)
const seen = new Set();
const unique = results.filter(j => {
  const key = `${j.title.toLowerCase().trim()}|${j.company.toLowerCase().trim()}|${(j.location || "").toLowerCase().trim()}`;
  if (seen.has(key)) return false;
  seen.add(key); return true;
});
for (const j of unique) j.match = roleMatch(j);
const coreCount = unique.filter(j => j.match === "core").length;

// Sort: tier 1 first, then by source
unique.sort((a,b) => (a.tier === "1" ? -1 : 1) - (b.tier === "1" ? -1 : 1));

// Save
const out ={ scanned_at: new Date().toISOString(), total: unique.length,
              errors: errors.length, failed: errors, jobs: unique };
fs.writeFileSync(path.join(dataDir, "scan_results.json"), JSON.stringify(out, null, 2));

if (jsonMode) { console.log(JSON.stringify(out)); process.exit(0); }

console.log(`\n${"─".repeat(50)}`);
console.log(`✅ ${unique.length} matching jobs found (${coreCount} in your target roles)  |  ⚠️  ${errors.length} companies unreachable`);
console.log(`${"─".repeat(50)}\n`);

if (unique.length === 0) {
  console.log("No matches found. Try broadening your target roles in config/profile.yml.\n");
  process.exit(0);
}

const tier1 = unique.filter(j => j.tier === "1");
const tier2 = unique.filter(j => j.tier !== "1");

if (tier1.length) {
  console.log(`🏆 Tier 1 companies (${tier1.length} matches):`);
  tier1.slice(0,10).forEach((j,i) =>
    console.log(`  ${i+1}. ${j.company.padEnd(20)} ${j.title}\n     📍 ${j.location||"India"}  🔗 ${j.url}`));
  if (tier1.length > 10) console.log(`  ... and ${tier1.length-10} more`);
}

if (tier2.length) {
  console.log(`\n📋 Other matches (${tier2.length}):`);
  tier2.slice(0,10).forEach((j,i) =>
    console.log(`  ${i+1}. ${j.company.padEnd(20)} ${j.title}\n     📍 ${j.location||"India"}  🔗 ${j.url}`));
  if (tier2.length > 10) console.log(`  ... and ${tier2.length-10} more`);
}

console.log(`\n💾 Full list saved to data/scan_results.json`);
console.log(`\nNext steps:`);
console.log(`  → Open Claude Code or Gemini CLI in this folder`);
console.log(`  → /evaluate [any URL above]  to get a full A–F score\n`);
