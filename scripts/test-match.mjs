// Checks the matching rules in lib/match.mjs: node scripts/test-match.mjs
// Each case: [profile, title, shown?, label when shown ("core" = your role, "adjacent"), location]
import { makeMatcher } from "./lib/match.mjs";
const AI = makeMatcher({ roles: ["AI Engineer", "ML Engineer", "Machine Learning Engineer", "Applied Scientist"], expYears: 1, anywhere: false, aiProfile: true });
const BE = makeMatcher({ roles: ["Backend Developer", "Frontend Developer", "Product Manager"], expYears: 1, anywhere: false, aiProfile: false });
const job = (title, location = "Bangalore") => ({ title, location, snippet: "", remote: false });
const cases = [
  [BE, "Backend Developer", true, "core"], [BE, "Frontend Developer - React", true, "core"],
  [BE, "Product Manager, Payments", true, "core"], [BE, "Developer, Backend (Node.js)", true, "core"],
  [BE, "Machine Learning Engineer", false], [BE, "Data Scientist", false], [BE, "Sales Executive", false],
  [BE, "Senior Backend Developer", false], [BE, "Senior Product Manager", false], [BE, "Senior Backend Software Engineer", false],
  [AI, "Machine Learning Engineer II", true, "core"], [AI, "Engineer, Machine Learning", true, "core"],
  [AI, "Research Engineer, Machine Learning (RL Velocity)", true, "core"], [AI, "AI/ML Engineer", true, "core"],
  [AI, "Applied Scientist III", true, "core"], [AI, "Data Scientist", true, "adjacent"],
  [AI, "Network Operations Engineer, AI Networking", true, "adjacent"], [AI, "Staff Engineer 1 – Salesforce AI", false],
  [AI, "Backend Developer", false], [AI, "Senior Backend Software Engineer", false],
  [AI, "Research Scientist, Discovery (Engineering & Applied Sciences)", false],
  [AI, "ML Engineer", false, null, "Indianapolis, IN"], [AI, "ML Engineer", true, "core", "Remote - India"],
  [AI, "ML Engineer", true, "core", "Gurugram"],
];
let bad = 0;
for (const [m, t, shown, label, loc] of cases) {
  const got = m.matches(job(t, loc)), role = m.roleMatch(job(t, loc));
  const ok = got === shown && (!shown || role === label);
  if (!ok) bad++;
  console.log(ok ? "ok  " : "FAIL", t, loc || "", "->", got ? role : "hidden");
}
console.log(bad ? `${bad} FAILED` : "all passed");
process.exit(bad ? 1 : 0);
