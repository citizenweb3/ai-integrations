"""LLM prompt loader.

All LLM prompts live in /prompts/ at the repo root. Edit prompt content there,
not in code. To add a prompt, drop a .txt file with $var placeholders (string.Template
syntax) and call render('name', var=value). Nested names like 'snippets/foo' map to
'prompts/snippets/foo.txt'. Rendering uses safe_substitute and then asserts that no
unresolved $placeholders remain — missing vars raise KeyError. Cache is process-level:
editing a prompt file requires a process restart to take effect.
"""

import logging
import re
from pathlib import Path
from string import Template

log = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts"
_CACHE: dict[str, Template] = {}
_PLACEHOLDER_RE = re.compile(r'\$(?!\$)([A-Za-z_][A-Za-z0-9_]*)')


def load_prompt(name: str) -> Template:
    cached = _CACHE.get(name)
    if cached is not None:
        return cached
    path = _PROMPTS_DIR / f"{name}.txt"
    template = Template(path.read_text(encoding="utf-8"))
    _CACHE[name] = template
    return template


def render(name: str, **vars: object) -> str:
    rendered = load_prompt(name).safe_substitute(vars)
    missing = _PLACEHOLDER_RE.findall(rendered)
    if missing:
        log.error("prompt_missing_vars name=%s vars=%s", name, missing)
        raise KeyError(f"Prompt '{name}' missing variables: {sorted(set(missing))}")
    return rendered
