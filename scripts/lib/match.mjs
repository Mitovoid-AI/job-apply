/**
 * scripts/lib/match.mjs — which jobs match a profile. Shared by scan.mjs (Scan now and
 * Find companies) and scripts/test-match.mjs.
 *
 * Everything person-specific comes from config/profile.yml: target_roles, experience_years and
 * locations. AI/ML extras (AI titles, AI keywords in the description) apply only when the
 * person's own roles are AI/ML.
 */

import fs from "fs";

// ── Profile ───────────────────────────────────────────────────────────────────
export function readConfig(profilePath) {
  if (!fs.existsSync(profilePath)) {
    console.error("❌ config/profile.yml not found. Copy config/profile.example.yml first.");
    process.exit(1);
  }
  const text = fs.readFileSync(profilePath, "utf8");
  const roles = [];
  let inRoles = false;
  for (const line of text.split("\n")) {
    if (line.trim().startsWith("target_roles:")) { inRoles = true; continue; }
    const item = line.match(/^\s*- (.+)$/);  // any indentation: "  - x" or "    - x"
    if (inRoles && item) roles.push(item[1].replace(/\s+#.*$/, "").trim().replace(/^["'](.*)["']$/, "$1"));
    else if (inRoles && line.trim() && !line.trim().startsWith("#")) inRoles = false;
  }
  const expMatch = text.match(/experience_years:\s*([\d.]+)/);
  const expYears = expMatch ? parseFloat(expMatch[1]) : 2;
  // "Anywhere" (or "Worldwide") in the locations list turns off the India location filter.
  const anywhere = /^\s*locations:[^\n]*\n(?:\s*[-#][^\n]*\n)*?\s*-\s*["']?(anywhere|worldwide)\b/im.test(text);
  const aiProfile = roles.some(r => AI_TITLE.test(r.toLowerCase()));
  return { roles: roles.filter(Boolean), expYears, anywhere, aiProfile };
}

// ── Rules ─────────────────────────────────────────────────────────────────────
export const AI_TITLE = /\b(ai|ml|llm|llms|genai|gen ai|nlp|mlops|machine learning|deep learning|generative|computer vision|artificial intelligence|applied scientist|data scientist)\b/;
const AI_KEYWORDS = ["llm","machine learning","deep learning","pytorch","rag","nlp","generative ai",
  "genai","fine-tun","transformer","computer vision","model training","embedding"];
// Titles skipped unless they name one of your own roles.
const NOISE_TERMS = ["senior director","vp ","vice president","head of","principal ",
  "staff engineer","c++","android developer","ios developer","frontend developer",
  "backend developer","devops","qa engineer","sdet","mobile developer",
  "sales","account executive","marketing","recruit","talent","customer success",
  "business development","designer","product manager","program manager","legal","finance"];
// Titles the ATS APIs give are all we have at scan time, so skip senior titles while
// experience_years is under 3.
const SENIOR_TERMS = ["senior","sr.","sr ","lead","manager","architect","director"];
// For AI/ML profiles: an AI/ML term followed by engineer/developer ("ML Ops Engineer",
// "AI/ML Engineer II") counts as your role even when no target_roles entry names it.
const CORE_TITLE = /\b(ai|ml|llm|llms|genai|gen ai|nlp|machine learning|generative ai|computer vision)\b.*\b(engineer|developer)\b|\bmle\b/;
// Whole words, so "Indianapolis" isn't India.
export const IN_LOC = /\b(india|bangalore|bengaluru|hyderabad|mumbai|delhi|ncr|pune|chennai|gurgaon|gurugram|noida|kolkata|ahmedabad|jaipur|kochi|lucknow|coimbatore|trivandrum|thiruvananthapuram|indore|chandigarh|mohali|nagpur|vadodara|mysore|mysuru|bhubaneswar|visakhapatnam|remote)\b/;

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRx = new Map();
function hasWord(text, w) {
  if (!wordRx.has(w)) wordRx.set(w, new RegExp(`(^|[^a-z0-9])${esc(w)}($|[^a-z0-9])`));
  return wordRx.get(w).test(text);
}
const roleWords = role => role.toLowerCase().match(/[a-z0-9+#.]+/g) || [];

/** A title names a role when the role's words appear in order with at most one extra word between
 *  them ("Backend Engineer" → "Senior Backend Software Engineer", "ML Engineer" → "AI/ML Engineer"),
 *  or in the "Engineer, Machine Learning" form with nothing else after it but brackets or a dash.
 *  So "AI Engineer" doesn't match "Software Engineer, AI Runtime" or "Staff Engineer – Salesforce AI". */
const W = "a-z0-9+#.";
const roleRx = new Map();
function roleRegexes(role) {
  if (!roleRx.has(role)) {
    const w = roleWords(role).map(esc);
    const gap = `[^${W}]+(?:[${W}]+[^${W}]+)?`;   // separator, optionally one extra word
    const inOrder = new RegExp(`(^|[^${W}])${w.join(gap)}($|[^${W}])`);
    const reversed = w.length > 1 ? new RegExp(
      `(^|[^${W}])${w[w.length - 1]}\\s*[,:|(\\-–—]\\s*${w.slice(0, -1).join("[\\s/-]+")}\\s*($|[(\\-–—,|])`) : null;
    roleRx.set(role, [inOrder, reversed].filter(Boolean));
  }
  return roleRx.get(role);
}
export function namesRole(title, roles) {
  const t = title.toLowerCase();
  return roles.some(r => roleWords(r).length > 0 && roleRegexes(r).some(rx => rx.test(t)));
}

export function makeMatcher({ roles, expYears, anywhere, aiProfile }) {
  // A senior word that's part of your own role ("Product Manager", "Tech Lead") isn't a seniority sign.
  const seniorTerms = SENIOR_TERMS.filter(s => !roles.some(r => hasWord(r.toLowerCase(), s.trim())));
  function matches(job) {
    const t = job.title.toLowerCase();
    const c = (job.snippet || "").toLowerCase();
    const loc = (job.location || "").toLowerCase();
    const own = namesRole(t, roles);
    const titleMatch = own || (aiProfile && AI_TITLE.test(t));
    const kwMatch = !titleMatch && aiProfile && AI_KEYWORDS.filter(k => c.includes(k)).length >= 3;
    const locMatch = anywhere || job.remote || !job.location || IN_LOC.test(loc);
    const noNoise = own || !NOISE_TERMS.some(n => t.includes(n));
    const levelOk = expYears >= 3 || !seniorTerms.some(s => t.includes(s));
    return (titleMatch || kwMatch) && locMatch && noNoise && levelOk;
  }
  // "core" = your role; "adjacent" = an AI/ML match outside your roles (only AI/ML profiles get
  // these). The dashboard hides adjacent jobs unless you switch them on.
  function roleMatch(job) {
    const t = job.title.toLowerCase();
    return namesRole(t, roles) || (aiProfile && CORE_TITLE.test(t)) ? "core" : "adjacent";
  }
  return { matches, roleMatch };
}
