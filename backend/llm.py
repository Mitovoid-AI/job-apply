"""OpenAI-compatible LLM for drafting form answers.

Settings come from this repo's .env (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_EXTRA_BODY or
OPENROUTER_API_KEY / OPENROUTER_MODEL); anything missing falls back to the resume tailor's .env
(TAILOR_DIR/.env), so one key serves both. Keys are only read, never logged.
"""

import json
import os
import re

from . import settings

_KEYS = ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "LLM_EXTRA_BODY", "OPENROUTER_API_KEY", "OPENROUTER_MODEL")


def _read_env(path) -> dict:
    """python-dotenv parsing, so references like LLM_API_KEY=${GROQ_API_KEY} resolve."""
    from dotenv import dotenv_values
    if not path or not path.exists():
        return {}
    return {k: v for k, v in dotenv_values(path).items() if k in _KEYS and v}


def config() -> tuple[str, str | None, str, dict]:
    env = _read_env(settings.TAILOR_DIR / ".env" if settings.TAILOR_DIR else None)
    env.update(_read_env(settings.ROOT / ".env"))
    env.update({k: os.environ[k] for k in _KEYS if os.environ.get(k) and not os.environ[k].startswith("${")})
    base = env.get("LLM_BASE_URL") or "https://openrouter.ai/api/v1"
    key = env.get("LLM_API_KEY") or env.get("OPENROUTER_API_KEY")
    model = env.get("LLM_MODEL") or env.get("OPENROUTER_MODEL") or "google/gemini-2.5-flash-lite"
    try:
        extra = json.loads(env.get("LLM_EXTRA_BODY") or "{}")
    except json.JSONDecodeError:
        extra = {}
    return base, key, model, extra


def available() -> bool:
    return bool(config()[1])


def ask_json(prompt: str) -> dict:
    """One chat call that must return a JSON object."""
    from openai import OpenAI
    base, key, model, extra = config()
    if not key:
        raise RuntimeError("No LLM key: set LLM_API_KEY or OPENROUTER_API_KEY (here or in the tailor's .env)")
    client = OpenAI(api_key=key, base_url=base, timeout=120)
    raw = client.chat.completions.create(
        model=model, messages=[{"role": "user", "content": prompt}], temperature=0.2, extra_body=extra,
    ).choices[0].message.content or ""
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    m = re.search(r"\{.*\}", raw, re.S)
    if not m:
        raise RuntimeError("The LLM reply had no JSON object")
    return json.loads(m.group(0))
