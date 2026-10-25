"""Render docs/review-checklist.md to a PDF in ~/Downloads.

Page 1 is the action sheet (two columns); the footnotes start on page 2.
Footnote numbers on the sheet link to the notes, and each note links back.

Usage: .venv/bin/python investments/docs/checklist_pdf.py
Needs the `markdown` package (in the venv) and Google Chrome.
"""
import datetime, pathlib, subprocess
import markdown

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "review-checklist.md"
today = datetime.date.today().isoformat()
OUT = pathlib.Path.home() / "Downloads" / f"Options review checklist {today}.pdf"
TMP = HERE / ".checklist.html"

text = SRC.read_text().replace(
    "# Options sleeve — action sheet",
    f"# Options sleeve — action sheet <small>printed {today}</small>", 1)
body = markdown.markdown(text, extensions=["tables", "sane_lists", "footnotes"],
                         extension_configs={"footnotes": {"BACKLINK_TEXT": "↩", "PLACE_MARKER": "///NOTES///"}})
# Wrap the sheet; the footnotes div follows.
cut = body.find('<div class="footnote">')
sheet, notes = (body, "") if cut < 0 else (body[:cut], body[cut:])
html = f"""<!doctype html><html><head><meta charset="utf-8">
<title>Options sleeve action sheet</title>
<style>
@page {{ size: letter; margin: 0.5in 0.55in; }}
body {{ font: 9.6pt/1.32 -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color:#222; margin:0; }}
h1 {{ font-size: 16pt; margin: 0 0 2px; }}
h1 small {{ font-size: 8pt; font-weight: normal; color:#777; margin-left: 8px; }}
.sheet > p:first-of-type {{ color:#555; margin: 0 0 6px; font-size: 8pt; }}
.sheet .cols {{ column-count: 2; column-gap: 20px; column-rule: 1px solid #ddd; }}
h2 {{ font-size: 11.5pt; margin: 8px 0 3px; padding-top: 4px; border-top: 2px solid #5a7a52; color:#3f5a39; break-after: avoid; }}
.sheet h2:first-of-type {{ margin-top: 0; }}
p {{ margin: 2px 0; }}
li {{ margin: 1px 0; }}
ol, ul {{ padding-left: 16px; margin: 2px 0; }}
code {{ font: 9pt Menlo, monospace; background:#f3f3f3; padding:0 2px; border-radius:2px; }}
sup {{ font-size: 7pt; line-height: 0; }}
sup a {{ color:#5a7a52; text-decoration: none; font-weight: 600; }}
strong {{ color:#000; }}
.footnote {{ break-before: page; font-size: 9.5pt; line-height: 1.4; }}
.footnote hr {{ display: none; }}
.footnote::before {{ content: "Notes"; display:block; font-size: 15pt; font-weight: 700; margin: 0 0 8px; }}
.footnote ol {{ padding-left: 24px; }}
.footnote li {{ margin: 0 0 7px; break-inside: avoid; }}
.footnote li p {{ margin: 0; }}
.footnote-backref {{ color:#5a7a52; text-decoration: none; margin-left: 4px; }}
</style></head><body>
<div class="sheet">{sheet.replace('</p>', '</p><div class="cols">', 1)}</div></div>
{notes}
</body></html>"""
TMP.write_text(html)
chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
subprocess.run([chrome, "--headless", "--disable-gpu", "--no-pdf-header-footer",
                f"--print-to-pdf={OUT}", TMP.as_uri()], check=True, capture_output=True)
TMP.unlink()
try:
    import pypdf
    r = pypdf.PdfReader(str(OUT))
    links = sum(1 for pg in r.pages for a in (pg.get("/Annots") or []) if a.get_object().get("/Subtype") == "/Link")
    print(f"{OUT}  ({len(r.pages)} pages, {links} links)")
except ImportError:
    print(OUT)
