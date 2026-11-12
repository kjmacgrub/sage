# Hilary's side + household totals, 2027-2047. Rebuilt 2026-11-06 (same logic as the Oct 2026 scratchpad version).
import kenalone_model as m
INF=1.025; YEARS=list(range(2027,2048))
DIV={75:24.6,76:23.7,77:22.9,78:22.0,79:21.1,80:20.2,81:19.4,82:18.5,83:17.7,84:16.8,85:16.0}
DEF_ANN=lambda y: 497_000*1.074**((y+1)-2026.6)   # Fidelity deferred annuity, Aug 2026 value, end of year y
def hilary(price=1_100_000, buy_year=2027, costs=0.02, appr=0.03, ira_r=0.05, roth_r=0.074, tax_r=0.063, conv=50_000, rent_fn=None, tax_from_conv=False):
    rent_fn=rent_fn or m.RENT
    rows=[]
    ira=(784_769-80_000)*1.05; roth=80_000*1.074
    taxable=(m.POT-25_200)+344_437*1.063**0.4   # her half-pot after 2026 conversion tax + her own account, pooled
    home=0.0
    for y in YEARS:
        k=y-2026; age=65+(y-2027)
        living=47_250*INF**k; rent=rent_fn(y)
        ann=50_649; ss=0 if y<2029 else 1_210*12*INF**k
        rmd=ira/DIV[age] if age>=75 else 0
        ordinary=ann+0.85*ss+rmd
        itax=max(0,ordinary-16_000)*0.215-20_000*0.095
        base_draw=living+rent+itax-(ann+ss+rmd)      # before conversion tax
        avail=taxable*(1+tax_r)-base_draw-(price*(1+costs) if y==buy_year else 0)
        if tax_from_conv:
            c=min(conv,max(0,ira-rmd)); ctax=c*0.315
            from_taxable=min(ctax,max(0,avail)); withheld=ctax-from_taxable   # tax the taxable money cannot cover is withheld from the conversion
            ctax=from_taxable
        else:
            c=min(conv,max(0,ira-rmd),max(0,avail)/0.315)   # convert only what the taxable money can pay tax on
            ctax=c*0.315; withheld=0
        total=living+rent+itax+ctax; income=ann+ss+rmd; draw=total-income
        taxable=taxable*(1+tax_r)-draw
        if y==buy_year:
            taxable-=price*(1+costs); home=price
        elif home: home*=1+appr
        w=0; rw=0
        if taxable<-1:            # spending gap with no taxable money left: from the IRA (grossed up), then the Roth
            need=-taxable; taxable=0
            avail_ira=max(0,ira-c-rmd)
            w=min(need/(1-0.315),avail_ira); rw=need-w*(1-0.315)
        taxable=max(taxable,0)
        ira=max(0,ira-c-rmd-w)*(1+ira_r)
        roth=max(0,roth-rw)*(1+roth_r)+(c-withheld)*(1+roth_r)
        rows.append(dict(y=y,draw=draw,taxable=taxable,home=home,roth=roth,ira=max(ira,0),c=c,w=w,rmd=rmd,ctax=ctax,withheld=withheld,rw=rw))
    return rows
def household(k_conv=None, price=1_100_000, **hk):
    kr=m.baseline_draws(conv=k_conv); kb=m.bucket(kr,0.063)
    hr=hilary(price=price,**hk) if price else hilary(price=0,buy_year=0,**hk)
    out=[]
    for k,(kc,kg),h in zip(kr,kb,hr):
        kt=kc+kg+k['roth']+k['ira']; hinv=h['taxable']+h['roth']+h['ira']+DEF_ANN(k['y'])
        out.append(dict(y=k['y'],ken=kt,hil_inv=hinv,home=h['home'],hh=kt+hinv+h['home']))
    return out
if __name__=='__main__':
    for name,sched in (('current',m.CONV),('slow',m.CONV_SLOW)):
        print('==',name)
        for r in household(sched):
            if r['y'] in (2027,2033,2037,2042,2047):
                print(f"{r['y']} Ken {r['ken']/1e6:5.2f}M  Hilary inv {r['hil_inv']/1e6:5.2f}M  home {r['home']/1e6:4.2f}M  HH {r['hh']/1e6:6.2f}M  today$ {r['hh']/INF**(r['y']-2026)/1e6:5.2f}M")
