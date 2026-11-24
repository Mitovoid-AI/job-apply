"""Read an application form (Greenhouse, Lever, Ashby) into a list of fields. Read only.

Each field: {key, label, required, type, options, selector, search, name?}
  type: text | textarea | select | combobox | radio | checkbox | file
  selector: CSS selector used later by the filler (id, or name for inputs and groups)
  search: combobox whose options only appear after typing (school, city…)
"""

from playwright.sync_api import Page

ATS = {"greenhouse", "lever", "ashby"}


def apply_url(url: str, source: str) -> str:
    url = url.rstrip("/")
    if source == "lever" and not url.endswith("/apply"):
        return url + "/apply"
    if source == "ashby" and not url.endswith("/application"):
        return url + "/application"
    return url


_COLLECT = r"""
() => {
  const vis = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const clean = s => (s || '').replace(/\s+/g, ' ').replace(/\s*[✱*]\s*/g, ' ').trim();
  const marked = s => /[✱*]/.test(s || '');
  const question = el => {
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && l.innerText.trim()) return l.innerText; }
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map(i => document.getElementById(i)?.innerText || '').join(' '); if (t.trim()) return t; }
    const q = el.closest('.application-question'); if (q) { const t = q.querySelector('.application-label')?.innerText; if (t) return t; }
    const fs = el.closest('fieldset'); if (fs) { const t = fs.querySelector('legend')?.innerText; if (t) return t; }
    const w = el.closest('label'); if (w && w.innerText.trim()) return w.innerText;
    return el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
  };
  const optionLabel = el => {
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return l.innerText; }
    return el.closest('label')?.innerText || el.value || '';
  };
  const selectorFor = el => el.id ? `#${CSS.escape(el.id)}`
    : el.name ? `${el.tagName.toLowerCase()}[name="${el.name.replace(/"/g, '\\"')}"]` : null;
  const skip = el => el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.type === 'search'
    || /recaptcha|hcaptcha|h-captcha/i.test((el.name || '') + (el.id || '')) || (el.id || '').startsWith('iti-');
  const fields = [], groups = new Map();
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (skip(el)) continue;
    const isFile = el.type === 'file';
    if (!isFile && !vis(el)) continue;
    const raw = question(el);
    const required = el.required || el.getAttribute('aria-required') === 'true' || marked(raw);
    if (el.type === 'radio' || (el.type === 'checkbox' && el.name && document.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`).length > 1)) {
      const g = groups.get(el.name) || { key: el.name, label: clean(raw), required, type: el.type, options: [],
                                         selector: `input[name="${el.name.replace(/"/g, '\\"')}"]`, name: el.name };
      g.options.push(clean(optionLabel(el)));
      g.required = g.required || required;
      groups.set(el.name, g);
      continue;
    }
    const sel = selectorFor(el);
    if (!sel) continue;
    let type = el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea'
      : el.getAttribute('role') === 'combobox' ? 'combobox' : el.type === 'checkbox' ? 'checkbox' : isFile ? 'file' : 'text';
    const label = clean(raw) || (type === 'file' && el.id === '_systemfield_resume' ? 'Resume' : '');
    if (type === 'file' && !label) continue;  // e.g. Ashby's "autofill from resume" upload
    fields.push({
      key: el.id || el.name || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40),
      label, required, type, selector: sel, search: false, input_type: el.type || '',
      options: type === 'select' ? [...el.options].map(o => o.text.trim()).filter(t => t && !/^select\b/i.test(t)) : [],
    });
  }
  for (const g of groups.values()) {
    if (g.type === 'checkbox' && g.options.length === 1) {   // one box (+ a hidden twin): a single checkbox
      fields.push({ ...g, type: 'checkbox', label: g.label || g.options[0], options: [] });
    } else fields.push(g);
  }
  const captcha = !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [data-sitekey], #hcaptchaSubmitBtn');
  return { fields, captcha };
}
"""


def _combobox_options(page: Page, selector: str) -> list[str]:
    """Open a react-select style dropdown and read its options (empty = search-as-you-type)."""
    try:
        box = page.locator(selector).first
        box.scroll_into_view_if_needed(timeout=3000)
        box.click(timeout=3000)
        page.wait_for_timeout(400)
        # Only this dropdown's own menu: other lists (e.g. the phone country picker) stay in the page.
        listbox = box.get_attribute("aria-controls") or box.get_attribute("aria-owns")
        if listbox:
            opts = page.locator(f'[id="{listbox}"] [role="option"]')
        else:
            opts = page.locator('.select__menu [role="option"], [role="listbox"]:visible [role="option"]')
        texts = [t.strip() for t in opts.all_inner_texts()][:80]
        page.keyboard.press("Escape")
        page.wait_for_timeout(100)
        return [t for t in texts if t and not t.lower().startswith(("no options", "type to search", "loading"))]
    except Exception:
        return []


def read_page(page: Page) -> dict:
    data = page.evaluate(_COLLECT)
    for f in data["fields"]:
        if f["type"] == "combobox":
            f["options"] = _combobox_options(page, f["selector"])
            # No options until you type, or a long list (countries, schools): type to search.
            f["search"] = not f["options"] or len(f["options"]) >= 80
            if len(f["options"]) >= 80:
                f["options"] = []
    return data


def open_form(page: Page, url: str, source: str) -> None:
    page.goto(apply_url(url, source), wait_until="domcontentloaded", timeout=60000)
    try:
        page.wait_for_selector("input[type=email], input[name=email], #email, #_systemfield_email", timeout=20000)
    except Exception:
        pass
    page.wait_for_timeout(1500)


def read_form(url: str, source: str, browser=None) -> dict:
    """Headless read of the live form: {apply_url, fields, captcha}. Reuses `browser` if given."""
    from playwright.sync_api import sync_playwright
    if source not in ATS:
        raise ValueError(f"Can't read {source} forms (only Greenhouse, Lever, Ashby)")
    if browser is not None:
        page = browser.new_page()
        try:
            open_form(page, url, source)
            data = read_page(page)
        finally:
            page.close()
        return {"apply_url": apply_url(url, source), **data}
    with sync_playwright() as p:
        own = p.chromium.launch(channel="chrome", headless=True)
        try:
            return read_form(url, source, own)
        finally:
            own.close()
