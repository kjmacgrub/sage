#!/usr/bin/env python3
"""Build a standalone HTML equity-curve page from one or more CSVs.

usage: make_chart.py OUT.html LABEL=path.csv [LABEL=path.csv ...]
CSV columns: date,netLiquidity,profitLoss,drawdownPct
"""
import csv, json, sys

out = sys.argv[1]
series = []
for arg in sys.argv[2:]:
    label, path = arg.split("=", 1)
    rows = []
    with open(path) as f:
        for r in csv.DictReader(f):
            rows.append([r["date"], float(r["netLiquidity"]), float(r["profitLoss"]), float(r["drawdownPct"])])
    series.append({"label": label, "rows": rows})

data = json.dumps(series)
title = "2027 Portfolio Equity Curve" if len(series) == 1 else "2027 Portfolio: Equity Curve Comparison"

html = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title>
<style>
:root{color-scheme:light;--surface:#fcfcfb;--panel:#ffffff;--text-1:#0b0b0b;--text-2:#52514e;--text-3:#8a8984;
 --grid:#e6e5e1;--axis:#c9c8c2;--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--neg:#e34948;--tip:#ffffff;--tipb:#d6d5d0}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--surface:#1a1a19;--panel:#222221;--text-1:#f0efec;--text-2:#c3c2b7;--text-3:#8f8e87;
 --grid:#2f2f2d;--axis:#45453f;--s1:#3987e5;--s2:#d95926;--s3:#199e70;--neg:#e66767;--tip:#2a2a28;--tipb:#45453f}}
:root[data-theme="dark"]{color-scheme:dark;--surface:#1a1a19;--panel:#222221;--text-1:#f0efec;--text-2:#c3c2b7;--text-3:#8f8e87;
 --grid:#2f2f2d;--axis:#45453f;--s1:#3987e5;--s2:#d95926;--s3:#199e70;--neg:#e66767;--tip:#2a2a28;--tipb:#45453f}
*{box-sizing:border-box}
body{margin:0;background:var(--surface);color:var(--text-1);font:14px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text",Helvetica,Arial,sans-serif;padding:24px 16px}
h1{font-size:20px;font-weight:600;margin:0 0 4px}
.sub{color:var(--text-2);margin:0 0 16px}
.wrap{max-width:1100px;margin:0 auto}
.panel{background:var(--panel);border:1px solid var(--grid);border-radius:10px;padding:12px 8px 4px;margin-bottom:12px;position:relative}
.panel h2{font-size:13px;font-weight:600;color:var(--text-2);margin:0 0 4px 44px;letter-spacing:.01em}
svg{display:block;width:100%;height:auto}
.grid line{stroke:var(--grid);stroke-width:1}
.axis text{fill:var(--text-3);font-size:11px}
.axis line{stroke:var(--axis)}
.line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.dd{fill-opacity:.18;stroke-width:1.5}
.lbl{font-size:11px;font-weight:600;fill:var(--text-1);paint-order:stroke;stroke:var(--panel);stroke-width:3px;stroke-linejoin:round}
.legend{display:flex;gap:18px;margin:0 0 8px 44px;font-size:12px;color:var(--text-2)}
.legend span::before{content:"";display:inline-block;width:14px;height:3px;border-radius:2px;vertical-align:middle;margin-right:6px;background:var(--c)}
.xh{stroke:var(--text-3);stroke-width:1;stroke-dasharray:3 3;pointer-events:none}
.tip{position:absolute;pointer-events:none;background:var(--tip);border:1px solid var(--tipb);border-radius:6px;padding:6px 9px;font-size:12px;color:var(--text-1);box-shadow:0 2px 8px rgba(0,0,0,.12);white-space:nowrap;display:none;z-index:2}
.tip b{font-weight:600}.tip .d{color:var(--text-2)}
.tip .row{display:flex;gap:10px;justify-content:space-between}
table{border-collapse:collapse;font-size:12px;margin-top:8px;width:100%}
th,td{text-align:right;padding:4px 8px;border-bottom:1px solid var(--grid)}th:first-child,td:first-child{text-align:left}
details{margin-top:8px;color:var(--text-2)}summary{cursor:pointer}
.stats{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:14px}
.stat .k{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media (max-width:700px){.stats{grid-template-columns:repeat(3,1fr)}}
.stat{background:var(--panel);border:1px solid var(--grid);border-radius:8px;padding:10px 12px}
.stat .k{font-size:11px;color:var(--text-2);text-transform:uppercase;letter-spacing:.04em}
.stat .v{font-size:18px;font-weight:600;margin-top:2px}
.stat .v small{font-size:11px;font-weight:500;color:var(--text-3);margin-left:4px}
</style></head><body><div class="wrap">
<h1>__TITLE__</h1>
<p class="sub" id="sub"></p>
<div class="stats" id="stats"></div>
<div class="panel" id="p1"><h2>Net liquidity (log scale)</h2><div class="legend" id="lg1"></div><svg id="s1"></svg><div class="tip" id="t1"></div></div>
<div class="panel" id="p2"><h2>Drawdown from running peak</h2><svg id="s2"></svg><div class="tip" id="t2"></div></div>
<details><summary>Data table (monthly closes)</summary><table id="tbl"></table></details>
</div>
<script>
const SERIES=__DATA__;
const COLORS=['var(--s1)','var(--s2)','var(--s3)'];
const fmt$=v=>v>=1e6?'$'+(v/1e6).toFixed(2)+'M':v>=1e3?'$'+Math.round(v/1e3)+'k':'$'+Math.round(v);
const fmtF=v=>(v<0?'-':'')+'$'+Math.abs(Math.round(v)).toLocaleString();
const W=1100,H1=380,H2=180,ML=60,MR=70,MT=10,MB=28;
const toDate=s=>new Date(s+'T00:00:00');
const all=SERIES.flatMap(s=>s.rows);
const t0=toDate(all[0][0]).getTime(),t1=Math.max(...SERIES.map(s=>toDate(s.rows[s.rows.length-1][0]).getTime()));
const minV=Math.min(...all.map(r=>r[1])),maxV=Math.max(...all.map(r=>r[1]));
const minDD=Math.min(...all.map(r=>r[3]));
const x=t=>ML+(t-t0)/(t1-t0)*(W-ML-MR);
const lmin=Math.log10(minV*0.95),lmax=Math.log10(maxV*1.05);
const y1=v=>MT+(1-(Math.log10(v)-lmin)/(lmax-lmin))*(H1-MT-MB);
const ddMin=Math.floor(minDD/5)*5-2;
const y2=v=>MT+(0-v)/(0-ddMin)*(H2-MT-MB);
function xTicks(){const out=[];const d=new Date(t0);d.setMonth(0,1);d.setFullYear(d.getFullYear()+1);while(d.getTime()<t1){out.push(new Date(d));d.setFullYear(d.getFullYear()+1)}return out}
function yTicks1(){const out=[];let p=Math.pow(10,Math.floor(lmin));while(p<=Math.pow(10,lmax)){for(const m of [1,2,5]){const v=p*m;if(Math.log10(v)>=lmin&&Math.log10(v)<=lmax)out.push(v)}p*=10}return out}
function svg(id,h){const s=document.getElementById(id);s.setAttribute('viewBox',`0 0 ${W} ${h}`);return s}
const S1=svg('s1',H1),S2=svg('s2',H2);
let g='';
g+='<g class="grid">'+yTicks1().map(v=>`<line x1="${ML}" x2="${W-MR}" y1="${y1(v)}" y2="${y1(v)}"/>`).join('')+'</g>';
g+='<g class="axis">'+yTicks1().map(v=>`<text x="${ML-8}" y="${y1(v)+4}" text-anchor="end">${fmt$(v)}</text>`).join('');
g+=xTicks().map(d=>`<text x="${x(d.getTime())}" y="${H1-8}" text-anchor="middle">${d.getFullYear()}</text>`).join('')+`<line x1="${ML}" x2="${W-MR}" y1="${H1-MB}" y2="${H1-MB}"/></g>`;
SERIES.forEach((s,i)=>{const d=s.rows.map((r,k)=>(k?'L':'M')+x(toDate(r[0]).getTime()).toFixed(1)+' '+y1(r[1]).toFixed(1)).join('');g+=`<path class="line" d="${d}" style="stroke:${COLORS[i]}"/>`;
 const last=s.rows[s.rows.length-1];g+=`<text class="lbl" x="${x(toDate(last[0]).getTime())+6}" y="${y1(last[1])+4}">${fmt$(last[1])}</text>`;
 let mi=0;s.rows.forEach((r,k)=>{if(r[3]<s.rows[mi][3])mi=k});const m=s.rows[mi];
 g+=`<circle cx="${x(toDate(m[0]).getTime())}" cy="${y1(m[1])}" r="4" fill="var(--neg)" stroke="var(--panel)" stroke-width="2"/><text class="lbl" x="${x(toDate(m[0]).getTime())}" y="${y1(m[1])+16}" text-anchor="middle">Max DD ${m[3]}%</text>`;});
g+=`<line id="xh1" class="xh" y1="${MT}" y2="${H1-MB}" x1="-9" x2="-9"/>`;
S1.innerHTML=g;
g='<g class="grid">'+[0,-5,-10,-15,-20,-25].filter(v=>v>=ddMin).map(v=>`<line x1="${ML}" x2="${W-MR}" y1="${y2(v)}" y2="${y2(v)}"/>`).join('')+'</g>';
g+='<g class="axis">'+[0,-5,-10,-15,-20,-25].filter(v=>v>=ddMin).map(v=>`<text x="${ML-8}" y="${y2(v)+4}" text-anchor="end">${v}%</text>`).join('');
g+=xTicks().map(d=>`<text x="${x(d.getTime())}" y="${H2-8}" text-anchor="middle">${d.getFullYear()}</text>`).join('')+'</g>';
SERIES.forEach((s,i)=>{const pts=s.rows.map(r=>x(toDate(r[0]).getTime()).toFixed(1)+' '+y2(r[3]).toFixed(1));
 const col=SERIES.length===1?'var(--neg)':COLORS[i];
 g+=`<path class="dd" d="M${pts[0].split(' ')[0]} ${y2(0)} L${pts.join('L')} L${pts[pts.length-1].split(' ')[0]} ${y2(0)}Z" style="fill:${col};stroke:${col}"/>`;});
g+=`<line id="xh2" class="xh" y1="${MT}" y2="${H2-MB}" x1="-9" x2="-9"/>`;
S2.innerHTML=g;
// legend
const lg=document.getElementById('lg1');if(SERIES.length>1)lg.innerHTML=SERIES.map((s,i)=>`<span style="--c:${COLORS[i]}">${s.label}</span>`).join('');else lg.remove();
// subtitle + stats
const f=SERIES[0].rows[0][0],l=SERIES[0].rows[SERIES[0].rows.length-1][0];
document.getElementById('sub').textContent=`${f} to ${l}, ${SERIES[0].rows.length} trading days, open positions marked daily. Hover for detail.`;
document.getElementById('stats').innerHTML=SERIES.map((s,i)=>{const r=s.rows,a=r[0][1]-r[0][2],b=r[r.length-1][1];const md=Math.min(...r.map(q=>q[3]));const worst=r.reduce((p,q)=>q[2]<p[2]?q:p);const best=r.reduce((p,q)=>q[2]>p[2]?q:p);
 return [['Start',fmtF(a)],['End',fmtF(b)],['Multiple',(b/a).toFixed(2)+'×'],['Max drawdown',md+'%'],['Worst day',fmtF(worst[2])+`<small>${worst[0]}</small>`],['Best day','+'+fmtF(best[2])+`<small>${best[0]}</small>`]]
 .map(([k,v])=>`<div class="stat" style="border-top:3px solid ${COLORS[i]}"><div class="k">${SERIES.length>1?s.label+' · ':''}${k}</div><div class="v">${v}</div></div>`).join('')}).join('');
// table: last row of each month
const tb=document.getElementById('tbl');let th='<tr><th>Month</th>'+SERIES.map(s=>`<th>${s.label||'Net liq'}</th><th>DD</th>`).join('')+'</tr>';
const months={};SERIES.forEach((s,i)=>s.rows.forEach(r=>{const k=r[0].slice(0,7);(months[k]=months[k]||[])[i]=r}));
tb.innerHTML=th+Object.keys(months).sort().map(k=>'<tr><td>'+k+'</td>'+SERIES.map((s,i)=>{const r=months[k][i];return r?`<td>${fmtF(r[1])}</td><td>${r[3]}%</td>`:'<td></td><td></td>'}).join('')+'</tr>').join('');
// hover
function hook(svgEl,tipEl,xhId){svgEl.addEventListener('mousemove',e=>{const rect=svgEl.getBoundingClientRect();const px=(e.clientX-rect.left)/rect.width*W;if(px<ML||px>W-MR){tipEl.style.display='none';return}
 const t=t0+(px-ML)/(W-ML-MR)*(t1-t0);let html='';let xx=px;SERIES.forEach((s,i)=>{let lo=0,hi=s.rows.length-1;while(lo<hi){const m=(lo+hi)>>1;toDate(s.rows[m][0]).getTime()<t?lo=m+1:hi=m}const r=s.rows[lo];if(i===0)xx=x(toDate(r[0]).getTime());
  html+=`<div class="d">${r[0]}${SERIES.length>1?' · '+s.label:''}</div><div class="row"><span>Net liq</span><b>${fmtF(r[1])}</b></div><div class="row"><span>Day P/L</span><b>${(r[2]>=0?'+':'')+fmtF(r[2])}</b></div><div class="row"><span>Drawdown</span><b>${r[3]}%</b></div>`});
 tipEl.innerHTML=html;tipEl.style.display='block';const prect=tipEl.parentElement.getBoundingClientRect();let left=e.clientX-prect.left+14;if(left+tipEl.offsetWidth>prect.width-8)left=e.clientX-prect.left-tipEl.offsetWidth-14;tipEl.style.left=left+'px';tipEl.style.top=(e.clientY-prect.top-10)+'px';
 document.getElementById('xh1').setAttribute('x1',xx);document.getElementById('xh1').setAttribute('x2',xx);document.getElementById('xh2').setAttribute('x1',xx);document.getElementById('xh2').setAttribute('x2',xx)});
 svgEl.addEventListener('mouseleave',()=>{tipEl.style.display='none';document.getElementById('xh1').setAttribute('x1',-9);document.getElementById('xh1').setAttribute('x2',-9);document.getElementById('xh2').setAttribute('x1',-9);document.getElementById('xh2').setAttribute('x2',-9)})}
hook(S1,document.getElementById('t1'));hook(S2,document.getElementById('t2'));
</script></body></html>"""
html = html.replace("__TITLE__", title).replace("__DATA__", data)
with open(out, "w") as f:
    f.write(html)
print(out, len(html), "bytes")
