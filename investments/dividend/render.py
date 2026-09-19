#!/usr/bin/env python3
"""
render.py — assemble the screener page from page/*.html + screen_data.json.

    python3 render.py            # writes dividend-compounders.html

Then republish with the Artifact tool against the existing URL so the link is
kept:  https://claude.ai/artifact/7oCuksREYjb1ViNXvDdnqT
"""
import json, datetime as dt, pathlib

d = pathlib.Path(__file__).parent
data = (d / 'screen_data.json').read_text()
tail = (d / 'page' / 'tail.html').read_text()
tail = tail.replace("$('asof').textContent='19 September 2026';",
                    f"$('asof').textContent='{dt.date.today():%-d %B %Y}';")
html = ((d / 'page' / 'head.html').read_text()
        + (d / 'page' / 'body.html').read_text()
        + '<script type="application/json" id="data">' + data + '</script>\n'
        + tail)
out = d / 'dividend-compounders.html'
out.write_text(html)
n = len(json.loads(data))
print(f'wrote {out.name} — {n} records, {len(html)/1024:.0f} KB')
