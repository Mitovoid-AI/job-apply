"""Type prepared answers into a live form. Never clicks Submit."""

import difflib
import re

from playwright.sync_api import Page

from .answers import _norm, best_option


def closest(value: str, options: list[str], cutoff: float = 0.55) -> str | None:
    """Exact/prefix/word match first, then the most similar option (for spelling differences)."""
    pick = best_option(value, options)
    if pick:
        return pick
    v = _norm(value)
    scored = [(difflib.SequenceMatcher(None, v, _norm(o)).ratio(), o) for o in options]
    scored.sort(reverse=True)
    return scored[0][1] if scored and scored[0][0] >= cutoff else None


def _combobox(page: Page, selector: str, value: str, search: bool) -> bool:
    box = page.locator(selector).first
    box.scroll_into_view_if_needed(timeout=5000)
    words = re.findall(r"[A-Za-z0-9+]+", value.split(",")[0])
    # Short queries: long ones with apostrophes or other spellings filter everything out.
    for query in dict.fromkeys([" ".join(words[:2]), " ".join(words[:1])]):
        if not query:
            continue
        box.click(timeout=5000)
        box.fill("")
        box.type(query, delay=30)
        listbox = box.get_attribute("aria-controls") or box.get_attribute("aria-owns")
        opts = page.locator(f'[id="{listbox}"] [role="option"]') if listbox else page.locator('[role="option"]:visible')
        texts: list[str] = []
        for _ in range(15 if search else 8):  # wait until options show (search lists load from a server)
            page.wait_for_timeout(200)
            texts = [t.strip() for t in opts.all_inner_texts()]
            if texts and not _norm(texts[0]).startswith(("loading", "no options", "type to search")):
                break
        texts = [t for t in texts if not _norm(t).startswith(("loading", "no options", "type to search"))]
        pick = closest(value, texts) or (texts[0] if len(texts) == 1 else None)
        if pick:
            opts.nth(texts.index(pick)).click(timeout=5000)
            page.wait_for_timeout(200)
            return True
        page.keyboard.press("Escape")
    return False


def _radio(page: Page, selector: str, value: str) -> bool:
    inputs = page.locator(selector)
    labels = [inputs.nth(i).evaluate(
        "el => (el.id && document.querySelector(`label[for=\"${CSS.escape(el.id)}\"]`)?.innerText) "
        "|| el.closest('label')?.innerText || el.value") for i in range(inputs.count())]
    pick = best_option(value, [l.strip() for l in labels])
    if pick is None:
        return False
    inputs.nth([l.strip() for l in labels].index(pick)).check(timeout=5000)
    return True


def fill(page: Page, fields: list[dict]) -> dict:
    """Fill every field that has a value. Returns {filled, problems}."""
    filled, problems = [], []
    for f in fields:
        v, t = f.get("value"), f["type"]
        if v in (None, "") or not f.get("selector"):
            continue
        try:
            loc = page.locator(f["selector"]).first
            ok = True
            if t == "file":
                loc.set_input_files(v, timeout=10000)
            elif t in ("text", "textarea"):
                loc.scroll_into_view_if_needed(timeout=5000)
                loc.fill(str(v), timeout=5000)
            elif t == "select":
                loc.select_option(label=best_option(v, f.get("options") or []) or str(v), timeout=5000)
            elif t == "checkbox":
                loc.check(timeout=5000)
            elif t == "radio":
                ok = _radio(page, f["selector"], str(v))
            elif t == "combobox":
                ok = _combobox(page, f["selector"], str(v), bool(f.get("search")))
            if ok:
                filled.append(f["key"])
            else:
                problems.append({"label": f["label"], "error": f"no option matched “{v}”"})
        except Exception as e:  # one stubborn field shouldn't stop the rest
            problems.append({"label": f["label"], "error": str(e).splitlines()[0][:140]})
    return {"filled": filled, "problems": problems}


_READBACK = r"""
(sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  if (el.type === 'file') return el.files && el.files.length ? el.files[0].name : '';
  if (el.type === 'checkbox') return el.checked ? 'yes' : '';
  if (el.getAttribute('role') === 'combobox') {
    let n = el; for (let i = 0; i < 6 && n; i++) { n = n.parentElement; if (n && n.querySelector('label')) break; }
    const label = n?.querySelector('label')?.innerText || '';
    return (n?.innerText || '').replace(label, '').replace(/\s+/g, ' ').trim();
  }
  if (el.tagName === 'SELECT') return el.options[el.selectedIndex]?.text || '';
  return el.value;
}
"""


def unfilled_required(page: Page, fields: list[dict]) -> list[str]:
    """Labels of required fields that are still empty on the page."""
    missing = []
    for f in fields:
        if not f.get("required") or not f.get("selector") or f["type"] == "radio":
            continue
        try:
            got = page.evaluate(_READBACK, f["selector"])
        except Exception:
            got = None
        if not got or re.fullmatch(r"select\.*", _norm(got)):
            missing.append(f["label"])
    return missing
