"""The options review checklist, parsed from docs/review-checklist.md.

The markdown file is the single source: the PDF (docs/checklist_pdf.py) and the
Options › Checklist tab both read it, so they cannot drift apart. Sections whose
title starts Weekly / Monthly / Annual become tick-box step lists; every other
section is reference material shown beside them. Footnote references are left
in the HTML as %%NOTE:name%% for the page to turn into buttons.
"""
import re
from pathlib import Path

import markdown

SRC = Path(__file__).resolve().parents[2] / "docs" / "review-checklist.md"
_REF = re.compile(r"\[\^([\w-]+)\](?!:)")
_DEF = re.compile(r"^\[\^([\w-]+)\]:\s?", re.M)
_ITEM = re.compile(r"^\d+\.\s+", re.M)
_KINDS = ("weekly", "monthly", "annual")


def _html(md: str, inline: bool = False) -> str:
    out = markdown.markdown(_REF.sub(r"%%NOTE:\1%%", md), extensions=["tables", "sane_lists"])
    if inline and out.startswith("<p>") and out.endswith("</p>") and out.count("<p>") == 1:
        out = out[3:-4]
    return out


def _dedent(block: str) -> str:
    return "\n".join(l[4:] if l.startswith("    ") else l.lstrip() for l in block.splitlines())


def load() -> dict:
    text = SRC.read_text()
    first = _DEF.search(text)
    body, tail = (text, "") if not first else (text[:first.start()], text[first.start():])

    notes = {}
    defs = list(_DEF.finditer(tail))
    for i, m in enumerate(defs):
        end = defs[i + 1].start() if i + 1 < len(defs) else len(tail)
        notes[m.group(1)] = _html(_dedent(tail[m.end():end]).strip(), inline=True)

    sections = []
    for chunk in re.split(r"^## ", body, flags=re.M)[1:]:
        head, _, rest = chunk.partition("\n")
        refs = _REF.findall(head)
        parts = [p.strip() for p in _REF.sub("", head).split("·")]
        kind = parts[0].lower() if parts[0].lower() in _KINDS else "reference"
        sec = {"title": parts[0], "sub": " · ".join(parts[1:]), "kind": kind, "title_notes": refs}
        items = list(_ITEM.finditer(rest))
        if kind != "reference" and items:
            sec["intro"] = _html(rest[:items[0].start()].strip(), inline=True)
            sec["steps"] = []
            for i, m in enumerate(items):
                end = items[i + 1].start() if i + 1 < len(items) else len(rest)
                sec["steps"].append(_html(" ".join(rest[m.end():end].split()), inline=True))
        else:
            sec["html"] = _html(rest.strip())
        sections.append(sec)
    return {"sections": sections, "notes": notes, "modified": SRC.stat().st_mtime}
