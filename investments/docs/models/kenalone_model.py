# Ken-alone cash-flow model 2027-2047, with optional cash bucket.
# Rebuilt 2026-11-06 after the session scratchpad was cleared; same logic as the Oct 2026 version
# plus RMD divisors by age and the slower conversion schedule CONV_SLOW.
YEARS=list(range(2027,2048))
INF=1.025
POT=792_000   # Ken's taxable pot at the start of 2027: half of ~$1.3M net condo proceeds (sale $1.46M, 2026-11-06) + half joint managed + half joint cash, less the Dec 2026 odds and ends; was 816K on a $1.45M sale
DIV={75:24.6,76:23.7,77:22.9,78:22.0,79:21.1,80:20.2,81:19.4,82:18.5,83:17.7,84:16.8,85:16.0}
CONV={2027:50_000,2028:50_000,2029:50_000,2030:50_000,2031:50_000,2032:50_000,2033:44_928.27}   # $50K/yr until the IRA is empty
CONV_25={2027:50_000,**{y:25_000 for y in range(2028,2033)}}                                    # 2026-11-06 morning: $50K then $25K x5 (superseded same day)
CONV_SLOW={2027:50_000,**{y:20_000 for y in range(2028,2038)}}                                  # 2026-11-06 plan: $50K then $20K x10 (inside the NY exclusion), rest stays in the IRA
RENT=lambda y: 30_250+1_000 if y==2027 else 12_000*INF**(y-2028)
def baseline_draws(claim=65,conv=None,rent_fn=None,sleeve_r=0.12):
    rent_fn=rent_fn or RENT
    sched=conv or CONV
    rows=[]
    roth_sleeve=89_600; conv=0.0; ira=0.0
    for y in YEARS:
        k=y-2026
        living=47_250*INF**k
        rent=rent_fn(y)
        wages=19_500 if y==2027 else 0
        ssm={65:2_160,66:2_290,67:2_420}[claim]*INF**k
        first={65:2027,66:2028,67:2029}[claim]
        ss=0 if y<first else ssm*(8 if y==first else 12)
        # IRA
        if y==2027: ira=300_000
        rmd=ira/DIV[65+(y-2027)] if y>=2037 else 0
        convert=sched.get(y,0)
        ira=(ira-convert-rmd)*1.05
        ctax=convert*0.22+max(0,convert-20_000)*0.095
        ordinary=wages+0.85*ss+rmd
        itax=max(0,ordinary-16_000)*0.215
        total=living+rent+itax+ctax
        income=wages+ss+rmd
        draw=total-income
        roth_sleeve*=1+sleeve_r; conv=conv*(1+sleeve_r)+convert*(1+sleeve_r)
        rows.append(dict(y=y,living=living,rent=rent,itax=itax,ctax=ctax,rmd=rmd,total=total,income=income,draw=draw,roth=roth_sleeve+conv,ira=ira))
    return rows

def flat(rows,r=0.04,pot=POT):
    out=[]
    for d in rows:
        pot=pot*(1+r)-d['draw']; out.append(pot)
    return out

def bucket(rows,r_mgd,r_cash=0.027,pot=POT,years_cash=2,basis='draw',shock=None):
    """cash bucket holds `years_cash` years of upcoming draw (or total spending), refilled yearly."""
    draws=[d['draw'] for d in rows]; tot=[d['total'] for d in rows]
    need=list(draws if basis=='draw' else tot)
    need+= [need[-1]*1.025, need[-1]*1.025**2]
    def target(i): return sum(need[i:i+years_cash]) if i<len(need) else 0
    cash=target(0); mgd=pot-cash; out=[]
    for i,d in enumerate(rows):
        r=r_mgd
        if shock and d['y'] in shock: r=shock[d['y']]
        cash*=1+r_cash; mgd*=1+r
        cash-=d['draw']
        t=target(i+1); mv=t-cash   # positive: refill from managed
        cash+=mv; mgd-=mv
        out.append((cash,mgd))
    return out

if __name__=='__main__':
    for name,sched in (('current: $50K/yr to empty (~2033)',CONV),('new: $50K 2027, $25K 2028-32, rest stays',CONV_SLOW)):
        rows=baseline_draws(conv=sched); b=bucket(rows,0.063)
        print('\n==',name,' total converted',sum(sched.values())/1e3,'K; conv tax',round(sum(r['ctax'] for r in rows)/1e3),'K; RMDs 2037-47',round(sum(r['rmd'] for r in rows)/1e3),'K')
        print('year  draw  ctax   rmd  itax | cash  mgd   pot  | roth   ira   | total')
        for r,(c,g) in zip(rows,b):
            if r['y'] in (2027,2028,2030,2033,2034,2037,2040,2042,2045,2047):
                print(f"{r['y']} {r['draw']/1e3:5.0f} {r['ctax']/1e3:5.1f} {r['rmd']/1e3:5.1f} {r['itax']/1e3:5.1f} | {c/1e3:4.0f} {g/1e3:5.0f} {(c+g)/1e3:5.0f} | {r['roth']/1e3:5.0f} {r['ira']/1e3:5.0f} | {(c+g+r['roth']+r['ira'])/1e3:6.0f}")
