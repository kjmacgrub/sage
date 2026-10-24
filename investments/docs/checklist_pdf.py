"""Render docs/review-checklist.md to a PDF in ~/Downloads.

Usage: .venv/bin/python investments/docs/checklist_pdf.py
Needs the `markdown` package (in the venv) and Google Chrome.
"""
import datetime, pathlib, subprocess, sys
import markdown

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "review-checklist.md"
today = datetime.date.today().isoformat()
OUT = pathlib.Path.home() / "Downloads" / f"Options review checklist {today}.pdf"
TMP = HERE / ".checklist.html"

text = SRC.read_text().replace("# Options sleeve — review checklist", f"# Options sleeve — review checklist\n\n*Printed {today} from `investments/docs/review-checklist.md`.*", 1)
body = markdown.markdown(text, extensions=["tables", "sane_lists"])
html = f"""<!doctype html><html><head><meta charset="utf-8">
<title>Options sleeve review checklist</title>
<style>
@page {{ size: letter; margin: 0.7in 0.75in; }}
body {{ font: 10.5pt/1.4 -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color:#222; }}
h1 {{ font-size: 20pt; margin: 0 0 4px; }}
h1 + p {{ color:#666; }}
h2 {{ font-size: 14pt; margin: 22px 0 6px; padding-top: 10px; border-top: 2px solid #5a7a52; color:#3f5a39; page-break-after: avoid; }}
h3 {{ font-size: 11.5pt; margin: 14px 0 4px; page-break-after: avoid; }}
p, li {{ margin: 3px 0; }}
ol, ul {{ padding-left: 22px; }}
li > ul, li > ol {{ margin: 2px 0 4px; }}
code {{ font: 9.5pt Menlo, monospace; background:#f3f3f3; padding:0 3px; border-radius:3px; }}
table {{ border-collapse: collapse; margin: 8px 0; font-size: 9.5pt; page-break-inside: avoid; }}
th, td {{ border: 1px solid #ccc; padding: 3px 7px; text-align: left; vertical-align: top; }}
th {{ background:#eef2ec; }}
strong {{ color:#000; }}
</style></head><body>
{body}
</body></html>"""
TMP.write_text(html)
chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
subprocess.run([chrome, "--headless", "--disable-gpu", "--no-pdf-header-footer",
                f"--print-to-pdf={OUT}", TMP.as_uri()], check=True, capture_output=True)
TMP.unlink()
try:
    import pypdf
    n = len(pypdf.PdfReader(str(OUT)).pages)
    print(f"{OUT}  ({n} pages)")
except ImportError:
    print(OUT)
