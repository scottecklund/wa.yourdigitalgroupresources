const $ = id => document.getElementById(id);
const esc = s => (s==null?'':''+s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = n => (n==null||isNaN(n))?'—':Number(n).toLocaleString();

/* ===== Supabase client ===== */
let sb=null;
function initClient(){
  if(!window.SUPABASE_URL||!window.SUPABASE_ANON_KEY||/YOUR-PROJECT-REF|YOUR_ANON/.test(window.SUPABASE_URL+window.SUPABASE_ANON_KEY)){
    document.body.innerHTML='<div style="max-width:560px;margin:12vh auto;font-family:Inter,sans-serif;color:#18212F;background:#fff;border:1px solid #D7DBE2;border-radius:14px;padding:24px;line-height:1.5"><h2 style="font-family:Space Grotesk,sans-serif;margin-top:0">Set up config.js</h2><p>Copy <code>config.sample.js</code> to <code>config.js</code> and paste your Supabase Project URL and key (Project Settings → API). Then reload.</p></div>';
    return false;
  }
  sb=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_ANON_KEY,{
    auth:{
      autoRefreshToken:true,
      persistSession:true,
      detectSessionInUrl:false   // we never use magic-link redirects here; avoids URL-parse work on every load
    },
    global:{
      // A generous hard timeout so a genuinely stalled fetch (e.g. a hung token
      // refresh on tab-refocus) can't block forever — but long enough that it
      // NEVER catches a healthy call. Multi-keyword audits and Google's
      // PageSpeed test can legitimately run 20–40s, so this must stay well above that.
      fetch:(url,opts={})=>{
        const ctrl=new AbortController();
        const id=setTimeout(()=>ctrl.abort(),60000);
        return fetch(url,{...opts,signal:opts.signal||ctrl.signal}).finally(()=>clearTimeout(id));
      }
    }
  });
  return true;
}

/* ===== settings ===== */
const S_IDS=['drWeak','trafficWeak','top3Weak','speedWeak','agency'];
function settings(){const o={};S_IDS.forEach(id=>{const el=$('t_'+id);o[id]=el.type==='number'?(parseFloat(el.value)||0):el.value.trim();});return o;}
function saveSettings(){const o={};S_IDS.forEach(id=>o[id]=$('t_'+id).value);try{localStorage.setItem('aa_settings',JSON.stringify(o));}catch(e){}}
function loadSettings(){try{const o=JSON.parse(localStorage.getItem('aa_settings')||'{}');S_IDS.forEach(id=>{if(o[id]!=null&&o[id]!=='')$('t_'+id).value=o[id];});}catch(e){}}

/* ===== state ===== */
let ah=null;                 // audit payload from the edge function
let lh={status:'idle',scores:null}; // Google Lighthouse result
let lhToken=0;               // guards against a stale test landing after a new audit
let session=null;
let skipDupCheck=false;
let partner=null;            // {slug,name} — white-label partner from the ?p= URL slug
const PARTNER_AUTH_DOMAIN='partners.yourdigitalgroupresources.com'; // internal usernames: slug@this
let emailMode=false;         // staff escape hatch: sign in with a real email on a partner link
let embedMode=false;         // signed in silently (iframe embed) — hide account chrome
let viewingSaved=null;       // a saved prospect opened from the team list (archive view)
let compDismissed=[];        // indexes into ah.competitors the rep X'd out (persists in extras)
let currentSaveId=null;      // id of the auto-saved row for THIS audit (null until saved)
let autoSaving=false;        // guard against concurrent auto-saves
let reportJustOpened=0;      // timestamp the print tab was opened (suppresses auto-clear on return)
function partnerSlug(){
  const clean=v=>(v||'').toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,40);
  const q=new URLSearchParams(location.search).get('p');
  if(q)return clean(q);                                  // ?p=titan still works
  const seg=location.pathname.split('/').filter(Boolean)[0]||'';
  if(seg&&!seg.includes('.'))return clean(seg);           // /titan — ignore real files like index.html
  return '';
}
async function loadPartner(){
  const slug=partnerSlug();if(!slug)return;
  const {data}=await sb.from('partners').select('slug,name').eq('slug',slug).maybeSingle();
  if(data){partner=data;applyPartnerBrand();}
  else{const m=$('authMsg');if(m){m.className='authmsg err';m.textContent='Unknown partner link ("'+slug+'") — check the slug in the partners table.';}}
}
function applyPartnerBrand(){
  const name=partner.name;
  document.title=name+' MRR Prospect Research';
  const gt=$('gateTitle');if(gt)gt.textContent=name+' MRR Prospect Research';
  const at=$('appTitle');if(at)at.textContent=name+' MRR Prospect Research';
  updateGateMode();
}
function agencyName(fallback){return partner?partner.name:(settings().agency||fallback);}
function updateGateMode(){
  const hide=!!partner&&!emailMode;
  const row=$('emailRow');if(row)row.classList.toggle('hidden',hide);
  const tog=$('useEmail');if(tog)tog.classList.toggle('hidden',!hide);
}
const sel={age:'current',mobile:'yes'};
const auto={age:false,mobile:false};

const SECTIONS=[
  {id:'site',name:'Website',items:[
    {id:'age',type:'bands',label:'Site age / design',tip:'How current the website looks. Pre-filled from the copyright year on their homepage when we can find one — tap to override after a quick look.',
      opts:[{v:'current',label:'Current',zone:'g'},{v:'aging',label:'Aging',sub:'3–5 yr',zone:'a'},{v:'dated',label:'Dated',sub:'5+ yr',zone:'r'}]},
    {id:'mobile',type:'bands',label:'Mobile-friendly',tip:'Pre-filled by checking their homepage for a mobile viewport tag. Tap to override if a phone check tells you otherwise.',
      opts:[{v:'yes',label:'Yes',zone:'g'},{v:'partly',label:'Partly',zone:'a'},{v:'no',label:'No',zone:'r'}]}]}
];

const METRIC_TIPS={
  authority:'An overall 0–100 strength score based on how many quality websites link to them. Higher is harder to outrank.',
  traffic:'Estimated visitors per month from Google\u2019s free (unpaid) search results.',
  keywords:'How many Google searches they show up for, and how many of those land in the top 3 spots — where almost all the clicks go.',
  refdomains:'How many different websites link to them. More linking sites means more trust with Google.',
  backlinks:'Total individual links pointing to their site from across the web.',
  platform:'Whether the site runs on WordPress. WordPress sites are a fit for Targeted Landing Pages \u2014 non-WordPress sites are not, so don\u2019t pitch TLPs there.',
  paid:'Whether they\u2019re currently running Google Ads. If yes, they\u2019re paying for clicks — a strong budget signal and a fit for dedicated landing pages.',
  money:'The search every month that should be bringing them customers. We check how many people search it and whether their site shows up at all.',
  competitors:'The businesses on page 1 of their money search. If one is a national site or directory you can\u2019t realistically beat, X it out so it won\u2019t show on the client report.',
  contact:'Phone, email, and address pulled from their website (homepage or contact page). Best-effort — give it a quick glance before outreach.',
  rankedfor:'Searches where their site already appears, and at what position. Positions 4–20 are "almost there" — quick wins to pitch.',
  lh:'Four automated checks Google runs on the live site, scored 0–100: speed on a phone, accessibility, basic SEO hygiene, and code best practices.',
  speed:'How fast the site loads on a phone, per Google’s Lighthouse test. Google throttles this test — a slower network and a mid-range phone — so even well-built modern sites often score in the 40–60 range. Treat a lowish number as normal, not proof the site is broken. Genuinely slow sites, though, lose visitors and rank lower.',
  a11y:'Automated accessibility checks: alt text, color contrast, form labels, and more. A low score means detectable issues — a fit for an accessibility / ADA pitch. Note: this is not a full legal compliance audit.',
  lhseo:'Google\u2019s basic on-page checks: page titles, descriptions, crawlability. Complements the ranking data above.',
  lhbest:'General code health: HTTPS, broken images, browser errors, outdated libraries.'
};

function buildSections(){
  const sectionsEl=$('sections');
  SECTIONS.forEach(sec=>{
    const box=document.createElement('div');box.className='sec';box.dataset.id=sec.id;
    let html=`<div class="sec-head"><span class="sec-name">${sec.name} <span class="autonote" id="auto_${sec.id}"></span></span><span class="badge" id="badge_${sec.id}"></span></div>`;
    sec.items.forEach(it=>{
      html+=`<div class="item"><div class="item-label">${it.label}<span class="info" tabindex="0" role="button" aria-label="About ${it.label}"><span class="tipbubble">${it.tip}</span>i</span></div>`;
      html+=`<div class="bands" data-item="${it.id}">`+it.opts.map(o=>`<button data-v="${o.v}" data-zone="${o.zone}">${o.label}${o.sub?`<small>${o.sub}</small>`:''}</button>`).join('')+`</div>`;
      html+=`</div>`;
    });
    box.innerHTML=html;sectionsEl.appendChild(box);
  });
  sectionsEl.querySelectorAll('.bands').forEach(g=>g.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{sel[g.dataset.item]=b.dataset.v;auto[g.dataset.item]=false;render();if(currentSaveId)autoSaveProspect();})));
  document.addEventListener('click',e=>{
    const info=e.target.closest('.info');
    if(info){e.stopPropagation();document.querySelectorAll('.info.show').forEach(o=>{if(o!==info)o.classList.remove('show');});info.classList.toggle('show');return;}
    document.querySelectorAll('.info.show').forEach(o=>o.classList.remove('show'));
  });
}

/* ===== scoring ===== */
function isWordpress(){return !!(ah&&ah.site&&ah.site.wordpress);}
function adsRunning(){return ah && ((ah.paid_keywords||0)>0 || (ah.paid_pages||0)>0);}
// Does the client rank for keywords matching the INTENT of the money search,
// even if not the exact phrase? e.g. money="roof repair oklahoma city" should
// count "roofing oklahoma city ok" / "oklahoma roofing contractor" as a match.
function moneyIntentTokens(kw){
  const stop=new Set(['the','a','an','in','of','for','near','me','to','and','best','top','my','your','ok','repair','service','services','company','companies','contractor','contractors']);
  return (kw||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>2&&!stop.has(w));
}
// stem a word to its first 4+ chars so "roof"~"roofing"~"roofer", "plumb"~"plumbing"
function stem(w){return w.length<=4?w:w.slice(0,Math.max(4,w.length-3));}
function tokensOverlap(wantTokens,haveTokens){
  const haveStems=haveTokens.map(stem);
  let hits=0;
  for(const w of wantTokens){const ws=stem(w);if(haveStems.some(h=>h.startsWith(ws)||ws.startsWith(h)))hits++;}
  return hits;
}
function ranksForMoneyIntent(){
  if(!ah||!ah.money||!ah.top_keywords||!ah.top_keywords.length)return false;
  const want=moneyIntentTokens(ah.money.keyword);
  if(want.length<1)return false;
  return ah.top_keywords.some(k=>{
    if(k.position==null||k.position>10)return false;
    return tokensOverlap(want,moneyIntentTokens(k.keyword))>=Math.min(2,want.length);
  });
}
// "missing" only if they don't rank for the exact phrase AND don't rank for the intent
function moneyMiss(){
  if(!(ah&&ah.money&&ah.money.volume!=null&&ah.money.volume>0&&ah.money.best_position==null))return false;
  return !ranksForMoneyIntent();
}
// Strong local presence: any top-3 keyword, or several page-one commercial terms.
// Local businesses routinely rank well on low domain authority, so real rankings
// override the raw DR/traffic thresholds.
function seoStrongRankings(){
  if(!ah)return false;
  const t3=ah.org_keywords_1_3;
  if(t3!=null&&t3>=1)return true; // ranks in the top 3 for at least one term
  const pageOne=(ah.top_keywords||[]).filter(k=>k.position!=null&&k.position<=10).length;
  return pageOne>=5; // or holds page-one for several searches
}
// A freshly launched (or re-launched) site hasn't accrued Google rankings or organic traffic yet,
// so Ahrefs reports zeros for every organic metric even when the site is perfectly fine — the data
// simply lags the launch by days to weeks. That's "too new to score", not "weak SEO". Backlinks/DR
// are intentionally ignored here: they can carry over from an established domain (or lag too), so
// the reliable tell is a total absence of organic footprint — no traffic, no rankings anywhere.
function seoTooNew(){
  if(!ah)return false;
  const noTraffic=!(ah.org_traffic>0);
  const noTop3=!(ah.org_keywords_1_3>0);
  const noRanked=!((ah.top_keywords||[]).some(k=>k.position!=null));
  const moneyItems=(ah.money_list&&ah.money_list.length)?ah.money_list:(ah.money?[ah.money]:[]);
  const noMoneyRank=!moneyItems.some(m=>m&&m.best_position!=null);
  return noTraffic&&noTop3&&noRanked&&noMoneyRank;
}
function seoWeak(){if(!ah)return false;const s=settings();const dr=ah.dr,tr=ah.org_traffic,t3=ah.org_keywords_1_3;
  // Too new to have any organic data yet → can't call it weak, there's nothing to measure.
  if(seoTooNew())return false;
  // If they already rank well locally, SEO is NOT weak regardless of low authority/traffic.
  if(seoStrongRankings())return false;
  return (dr!=null&&dr<s.drWeak)||(tr!=null&&tr<s.trafficWeak)||(t3!=null&&t3<s.top3Weak)||moneyMiss();}
function speedWeakFlag(){return lh.status==='done'&&lh.scores&&lh.scores.perf!=null&&lh.scores.perf<settings().speedWeak;}
function adaWidgetPresent(){return !!(ah&&ah.site&&ah.site.ada_widget);}
function a11yIssues(){
  if(adaWidgetPresent())return false; // our ADA widget is already on the site — don't pitch ADA
  return lh.status==='done'&&lh.scores&&lh.scores.a11y!=null&&lh.scores.a11y<90;
}
// Mobile speed is always an "and" condition, never a standalone trigger — Google throttles the
// mobile test so even modern sites score low, and a slow score alone shouldn't pitch a new site.
// A site counts as outdated only when slow speed is paired with an aging design or a
// mobile-friendliness problem: (speed & age) or (speed & mobile).
function siteWeak(){const dated=sel.age!=='current',notMobile=sel.mobile!=='yes';
  return speedWeakFlag()&&(dated||notMobile);}
function score(){const weak=[];if(siteWeak())weak.push('site');if(seoWeak())weak.push('seo');
  let grade,action;
  if(weak.length===0){grade='C';action='Low priority';}
  else if(weak.length===2){grade='A';action='Contact immediately';}
  else{grade='B';action='Secondary priority';}
  return{grade,action,weak};}
function gapLabels(ids){const m={site:'outdated website',seo:'weak SEO'};return ids.map(i=>m[i]);}
function pitchList(s){const out=[];
  if(s.weak.includes('site'))out.push('New website');
  if(s.weak.includes('seo'))out.push('SEO');
  if(speedWeakFlag())out.push('Site speed');
  if(a11yIssues())out.push('ADA / accessibility');
  if(isWordpress())out.push('Targeted landing pages');
  return out;}
function reasonText(s){const gaps=gapLabels(s.weak);const ads=adsRunning()?' They\u2019re already running Google Ads, so there\u2019s budget to work with.':'';
  const miss=(!seoTooNew()&&moneyMiss())?' They\u2019re invisible for their money search — the clearest proof point you have.':'';
  const slow=speedWeakFlag()?(' Google scores their mobile speed '+lh.scores.perf+'/100.'):'';
  const tooNew=seoTooNew()?' Heads up: SEO can’t be scored yet — the site is too new for Google rankings or organic traffic to register in Ahrefs, so the SEO read is unknown, not strong. Worth re-running in a few weeks.':'';
  if(s.grade==='A')return 'Both gaps present: <b>'+gaps.join(' and ')+'</b>. Clear opportunity — top priority.'+miss+slow+ads;
  if(s.grade==='C'){
    if(seoTooNew())return 'The website looks solid and there’s no SEO problem to point to yet.'+tooNew+ads;
    return 'Website and SEO both look solid. Little to sell — deprioritize.'+ads;
  }
  return 'Opportunity: <b>'+gaps.join(', ')+'</b>. Solid prospect worth pursuing.'+miss+slow+tooNew+ads;}

/* ===== render ===== */
function metricCard(k,main,sub,tagLabel,tagCls,tipKey){
  const tip=tipKey?METRIC_TIPS[tipKey]:'';
  const info=tip?'<span class="info" tabindex="0" role="button" aria-label="About '+k+'"><span class="tipbubble">'+tip+'</span>i</span>':'';
  const subhtml=sub?' <small>'+sub+'</small>':'';
  const tag=tagLabel?'<div class="tag '+tagCls+'">'+tagLabel+'</div>':'';
  return '<div class="metric"><div class="k">'+k+info+'</div><div class="v">'+main+subhtml+'</div>'+tag+'</div>';
}
function infoIcon(key,label){return '<span class="info" tabindex="0" role="button" aria-label="About '+label+'"><span class="tipbubble">'+METRIC_TIPS[key]+'</span>i</span>';}

function lhBand(score){return score==null?['','']:(score<50?['Poor','weak']:(score<90?['Fair','mid']:['Good','ok']));}
function renderLH(){
  const box=$('lhBox');
  if(lh.status==='idle'){box.classList.add('hidden');return;}
  box.classList.remove('hidden');
  $('lhHead').innerHTML='Site health — Google\u2019s live test '+infoIcon('lh','site health');
  if(lh.status==='loading'){$('lhBody').innerHTML='<div class="lh-loading"><span class="spin"></span>Running Google\u2019s mobile test on their site… (15–30 seconds — the grade may update when it finishes)</div>';return;}
  if(lh.status==='error'){$('lhBody').innerHTML='<div class="lh-loading">Google\u2019s test couldn\u2019t run on this site (it may block testing, or the test service is busy). The grade is unaffected.</div>';return;}
  const s=lh.scores;
  const tile=(label,score,tipKey)=>{const[t,c]=lhBand(score);return metricCard(label,(score!=null?score:'—'),(score!=null?'/100':''),t,c,tipKey);};
  $('lhBody').innerHTML='<div class="readout four">'
    +tile('Mobile speed',s.perf,'speed')
    +tile('Accessibility',s.a11y,'a11y')
    +tile('SEO checks',s.seo,'lhseo')
    +tile('Best practices',s.best,'lhbest')
    +'</div>';
}
// per-keyword: do they rank page-one for a term matching THIS keyword's intent?
function relatedRankFor(keyword){
  if(!ah||!ah.top_keywords)return null;
  const want=moneyIntentTokens(keyword);
  if(want.length<1)return null;
  const matches=ah.top_keywords.filter(k=>{
    if(k.position==null||k.position>10)return false;
    return tokensOverlap(want,moneyIntentTokens(k.keyword))>=Math.min(2,want.length);
  });
  if(!matches.length)return null;
  matches.sort((a,b)=>a.position-b.position);
  return matches[0]; // strongest related ranking
}
function renderMoney(){
  const box=$('moneyBox');
  const list=(ah&&ah.money_list&&ah.money_list.length)?ah.money_list:((ah&&ah.money)?[ah.money]:[]);
  const shown=list.filter(x=>x&&x.keyword);   // keep every requested keyword, data or not
  if(!shown.length){box.classList.add('hidden');return;}
  box.classList.remove('hidden');
  $('moneyHead').innerHTML=(shown.length>1?'The money searches ':'The money search ')+infoIcon('money','the money search');
  $('moneyBody').innerHTML=shown.map(m=>{
    const hasData=m.volume!=null;
    const ranks=m.best_position!=null;
    const related=ranks?null:relatedRankFor(m.keyword); // only look for related if no exact rank
    const cpc=m.cpc!=null?('$'+(m.cpc/100).toFixed(2)):null;
    if(!hasData){
      return '<div class="money" style="margin-bottom:9px;background:var(--skip-bg);border-color:var(--line);">'
        +'<div class="money-kw">\u201C'+esc(m.keyword)+'\u201D</div>'
        +'<div class="money-stats" style="color:var(--ink-soft);">No search-volume data available for this term.</div>'
        +'<div class="money-verdict" style="color:var(--ink-soft);">Often means very low local search volume \u2014 worth confirming the wording with the client.</div>'
        +'</div>';
    }
    const ok=ranks||!!related;
    let verdict;
    if(ranks)verdict='Their site ranks <b>#'+m.best_position+'</b> for this search.';
    else if(related)verdict='Not ranking for this exact phrase, but they rank <b>#'+related.position+'</b> for the closely related \u201C'+esc(related.keyword)+'\u201D \u2014 so they\u2019re showing up for this search\u2019s intent.';
    else verdict='Their site was <b>not found</b> in the results for this search.';
    return '<div class="money '+(ok?'money-ok':'money-miss')+'" style="margin-bottom:9px;">'
      +'<div class="money-kw">\u201C'+esc(m.keyword)+'\u201D</div>'
      // TEMP: CPC hidden — restore by swapping the two lines below
      // +'<div class="money-stats"><b>'+fmt(m.volume)+'</b> searches/mo'+(cpc?' \u00B7 advertisers pay <b>'+cpc+'</b> per click':'')+'</div>'
      +'<div class="money-stats"><b>'+fmt(m.volume)+'</b> searches/mo</div>'
      +'<div class="money-verdict">'+verdict+'</div>'
      +'</div>';
  }).join('');
}
/* The full competitor list minus any the rep X'd out. Dismissals are tracked by
   index into the original ah.competitors array (not by domain string) so they
   always match regardless of casing/whitespace/escaping. */
function liveCompetitors(){
  if(!ah||!ah.competitors)return [];
  return ah.competitors.filter((c,i)=>!compDismissed.includes(i));
}
function renderCompetitors(){
  const box=$('compBox');
  const all=(ah&&ah.competitors)||[];
  if(!all.length){box.classList.add('hidden');return;}
  box.classList.remove('hidden');
  // keep original indexes alongside each survivor so the × knows what to dismiss
  const shown=all.map((c,i)=>({c,i})).filter(x=>!compDismissed.includes(x.i));
  $('compHead').innerHTML='Who\u2019s winning instead '+infoIcon('competitors','competitors');
  if(!shown.length){
    $('compBody').innerHTML='<div style="font-size:12.5px;color:var(--ink-soft);padding:8px 2px;">'
      +'All competitors dismissed. <button class="linklike" id="compReset" style="display:inline;margin:0;">Restore the list</button></div>';
    $('compReset').addEventListener('click',()=>{compDismissed=[];render();});
    return;
  }
  const rows=shown.map(({c,i})=>{
    const meta=c.position!=null
      ?('#'+c.position+' for the money search \u00B7 authority '+(c.dr!=null?Math.round(c.dr):'\u2014'))
      :(fmt(c.traffic)+' visits/mo \u00B7 authority '+(c.dr!=null?Math.round(c.dr):'\u2014'));
    return '<div class="comp-row" data-i="'+i+'">'
      +'<div class="comp-dom">'+esc(c.domain)+'</div>'
      +'<div style="display:flex;align-items:center;gap:10px;white-space:nowrap;">'
      +'<span class="comp-meta">'+meta+'</span>'
      +'<button class="del comp-x" data-i="'+i+'" aria-label="Remove '+esc(c.domain)+'" title="Can\u2019t compete with this one? Remove it from the list.">\u00D7</button>'
      +'</div></div>';
  }).join('');
  const note=compDismissed.length
    ?'<div style="font-size:11px;color:var(--ink-soft);margin-top:8px;"><button class="linklike" id="compReset" style="display:inline;margin:0;">Restore dismissed competitors</button></div>'
    :'';
  $('compBody').innerHTML=rows+note;
  $('compBody').querySelectorAll('.comp-x').forEach(b=>b.addEventListener('click',()=>{
    const i=parseInt(b.dataset.i,10);if(!compDismissed.includes(i))compDismissed.push(i);render();if(currentSaveId)autoSaveProspect();
  }));
  const reset=$('compReset');if(reset)reset.addEventListener('click',()=>{compDismissed=[];render();});
}
function savedBy(v){
  if(!v)return '';
  return String(v).toLowerCase().endsWith('@'+PARTNER_AUTH_DOMAIN)?'':String(v);
}
function fmtPhone(p){
  if(!p)return p;
  const d=String(p).replace(/\D/g,'');
  const n=(d.length===11&&d[0]==='1')?d.slice(1):d;
  return n.length===10?('('+n.slice(0,3)+') '+n.slice(3,6)+'-'+n.slice(6)):p;
}
function renderContact(){
  const box=$('contactBox');
  const c=ah&&ah.site&&ah.site.contact;
  if(!c||(!c.phone&&!c.email&&!c.address)){box.classList.add('hidden');return;}
  box.classList.remove('hidden');
  $('contactHead').innerHTML='Contact info on their site '+infoIcon('contact','contact info');
  const chip=v=>'<span class="contact-chip">'+esc(v)+'</span>';
  $('contactBody').innerHTML='<div class="contact-grid">'+[fmtPhone(c.phone),c.email,c.address].filter(Boolean).map(chip).join('')+'</div>';
}
function renderRankedFor(){
  const box=$('rankedBox');
  const rows=(ah&&ah.top_keywords||[]).filter(k=>k.keyword&&k.position!=null);
  if(!rows.length){box.classList.add('hidden');return;}
  box.classList.remove('hidden');
  $('rankedHead').innerHTML='What they already rank for '+infoIcon('rankedfor','ranked keywords');
  $('rankedBody').innerHTML='<table class="kwtable"><thead><tr><th>Search</th><th>Position</th><th>Searches/mo</th></tr></thead><tbody>'
    +rows.map(k=>'<tr><td>'+esc(k.keyword)+'</td><td class="pos '+(k.position<=3?'p-top':(k.position<=20?'p-near':''))+'">#'+k.position+'</td><td>'+fmt(k.volume)+'</td></tr>').join('')
    +'</tbody></table>';
}
function render(){
  if(ah){const s=settings();
    const drW=ah.dr!=null&&ah.dr<s.drWeak, trW=ah.org_traffic!=null&&ah.org_traffic<s.trafficWeak, kwW=ah.org_keywords_1_3!=null&&ah.org_keywords_1_3<s.top3Weak;
    const ads=adsRunning();
    // Too new to have organic data → show a neutral "New" badge instead of a red "Weak".
    const tooNew=seoTooNew();
    const orgTag=(w)=>tooNew?['New','mid']:(w?['Weak','weak']:['OK','ok']);
    const drT=orgTag(drW), trT=orgTag(trW), kwT=orgTag(kwW);
    $('readout').innerHTML=
      metricCard('Site authority',(ah.dr!=null?ah.dr:'—'),'',(ah.dr!=null?drT[0]:''),drT[1],'authority')
     +metricCard('Organic traffic',fmt(ah.org_traffic),(ah.org_traffic!=null?'/mo':''),(ah.org_traffic!=null?trT[0]:''),trT[1],'traffic')
     +metricCard('Keywords',fmt(ah.org_keywords),(ah.org_keywords_1_3!=null?(ah.org_keywords_1_3+' in top 3'):''),(ah.org_keywords_1_3!=null?kwT[0]:''),kwT[1],'keywords')
     +metricCard('Referring domains',fmt(ah.live_refdomains),'','','','refdomains')
     +metricCard('Backlinks',fmt(ah.live_backlinks),'','','','backlinks')
     +metricCard('Paid search',(ads?'Running ads':'None'),(ads&&ah.paid_pages?(ah.paid_pages+' '+(ah.paid_pages===1?'page':'pages')):''),(ads?'Budget signal':''),'ads','paid')
     +(function(){const wp=(ah.site&&typeof ah.site.wordpress==='boolean')?ah.site.wordpress:null;
        return metricCard('Platform',(wp===true?'WordPress':(wp===false?'Not WordPress':'\u2014')),(ah.site&&ah.site.generator&&wp!==true?esc(String(ah.site.generator).split(' ')[0]):''),(wp===true?'TLP fit':''),(wp===true?'ok':''),'platform');})();
    renderLH();renderContact();renderMoney();renderCompetitors();renderRankedFor();
  }
  const sectionsEl=$('sections');
  sectionsEl.querySelectorAll('.bands').forEach(g=>g.querySelectorAll('button').forEach(b=>{const on=sel[g.dataset.item]===b.dataset.v;b.className=on?('on '+b.dataset.zone):'';}));
  const an=$('auto_site');if(an)an.textContent=(auto.age||auto.mobile)?'\u00B7 pre-filled from their homepage':'';
  const sw=siteWeak();const b=$('badge_site');if(b){b.textContent=sw?'Weak':'Strong';b.className='badge '+(sw?'weak':'strong');}
  const sc=score();const stamp=$('stamp');stamp.className='stamp '+sc.grade;
  $('grade').textContent=sc.grade;$('action').textContent=sc.action;$('reason').innerHTML=reasonText(sc);
  const pl=pitchList(sc);$('pitchList').innerHTML=pl.length?pl.map(x=>'<span class="pitch-pill">'+x+'</span>').join(''):'<span class="pitch-pill none">Nothing obvious — low priority</span>';
}

/* ===== Google Lighthouse (PageSpeed Insights API, runs in the browser) ===== */
async function runLighthouse(domain,token){
  lh={status:'loading',scores:null};renderLH();
  try{
    const proto=(ah&&ah.site&&ah.site.fetched&&ah.site.https===false)?'http':'https';
    const {data,error}=await sb.functions.invoke('ahrefs-audit',{body:{lighthouse:true,url:domain,protocol:proto}});
    if(token!==lhToken)return; // a newer audit started — discard
    if(error)throw new Error((data&&data.error)||error.message);
    if(data&&data.error)throw new Error(data.error);
    if(!data||!data.lighthouse)throw new Error('no result');
    lh={status:'done',scores:data.lighthouse};
  }catch(e){if(token!==lhToken)return;lh={status:'error',scores:null};}
  render();
  autoSaveProspect(); // grade is now final — save it to the team list automatically
}

/* ===== run audit ===== */
function setStatus(cls,html){const el=$('status');el.className='status show '+cls;el.innerHTML=html;}
function clearStatus(){$('status').className='status';}
const MONEY_MAX=5;
// Collect the service keyword rows, split any comma lists, combine each with the
// city, de-dupe, cap at MONEY_MAX. Returns an array of money searches.
function moneyTerms(){
  const city=$('city').value.trim().toLowerCase();
  const raw=[];
  document.querySelectorAll('.kw-input').forEach(el=>{
    el.value.split(',').forEach(part=>{const t=part.trim();if(t)raw.push(t);});
  });
  const out=[];
  for(const svc of raw){
    const term=(city?(svc+' '+city):svc).toLowerCase();
    if(term&&!out.includes(term))out.push(term);
    if(out.length>=MONEY_MAX)break;
  }
  return out;
}
// back-compat single term (first keyword)
function moneyTerm(){return moneyTerms()[0]||'';}
// the raw service text of the first keyword row (no city) — for report/email/save
function primaryService(){
  const el=document.querySelector('.kw-input');
  if(!el)return '';
  return (el.value.split(',')[0]||'').trim();
}
// all service keyword rows as raw text (no city), for saving
function serviceRows(){
  const out=[];
  document.querySelectorAll('.kw-input').forEach(el=>{
    el.value.split(',').forEach(p=>{const t=p.trim();if(t)out.push(t);});
  });
  return out;
}
// repopulate keyword rows from a saved list
function setKeywordRows(list){
  const wrap=$('kwRows');if(!wrap)return;
  wrap.innerHTML='';
  const arr=(Array.isArray(list)&&list.length)?list:[''];
  arr.slice(0,MONEY_MAX).forEach(v=>addKeywordRow(v));
  if(!wrap.querySelector('.kw-row'))addKeywordRow('');
  syncAddBtn();
}

// "+ Add keyword" — append a new service row (up to MONEY_MAX)
function addKeywordRow(value){
  const wrap=$('kwRows');if(!wrap)return;
  if(wrap.querySelectorAll('.kw-row').length>=MONEY_MAX)return;
  const row=document.createElement('div');
  row.className='kw-row';
  row.style.cssText='display:flex;gap:7px;align-items:center;margin-top:7px;';
  row.innerHTML='<input class="kw-input" placeholder="e.g., HVAC repair" style="flex:1;" value="'+esc(value||'')+'">'
    +'<button class="ghost kw-del" type="button" title="Remove this keyword" style="padding:8px 11px;">\u00D7</button>';
  wrap.appendChild(row);
  row.querySelector('.kw-del').addEventListener('click',()=>{row.remove();syncAddBtn();});
  syncAddBtn();
}
function syncAddBtn(){
  const btn=$('addKwBtn');if(!btn)return;
  const n=document.querySelectorAll('.kw-row').length;
  btn.style.display=n>=MONEY_MAX?'none':'';
  // hide every delete button when only one row remains (can't remove the last)
  const dels=document.querySelectorAll('.kw-del');
  dels.forEach(d=>d.style.visibility=(n<=1?'hidden':'visible'));
}

async function checkDuplicate(domain){
  const clean=domain.replace(/^https?:\/\//i,'').replace(/^www\./i,'').replace(/\/+$/,'').toLowerCase();
  let q=sb.from('prospects').select('id,client_name,grade,created_at,created_by_email')
    .or('domain.eq.'+clean+',domain.eq.www.'+clean);
  if(partner)q=q.eq('partner',partner.slug);
  const {data}=await q.order('created_at',{ascending:false}).limit(1);
  return (data&&data[0])||null;
}

async function runAudit(){
  const domain=$('domain').value.trim();
  if(!domain){$('domain').focus();setStatus('error','Enter a website to audit.');return;}
  const btn=$('auditBtn');btn.disabled=true;

  try{
    if(!skipDupCheck){
      const dup=await checkDuplicate(domain);
      if(dup){
        const when=new Date(dup.created_at).toLocaleDateString();
        setStatus('error','<b>Already audited.</b> '+esc(dup.client_name)+' was graded <b>'+esc(dup.grade)+'</b> on '+when
          +(savedBy(dup.created_by_email)?(' by '+esc(savedBy(dup.created_by_email))):'')
          +' — it\u2019s in the team list below. <button class="ghost" id="auditAnyway" style="margin-left:8px;">Audit anyway</button>');
        $('auditAnyway').addEventListener('click',()=>{skipDupCheck=true;clearStatus();runAudit();});
        btn.disabled=false;return;
      }
    }
    skipDupCheck=false;
    exitViewMode();
    setStatus('loading','<span class="spin"></span>Running the audit on '+esc(domain)+'… (10–20 seconds)');
    const {data,error}=await sb.functions.invoke('ahrefs-audit',{body:{url:domain,money_keywords:moneyTerms()}});
    if(error) throw new Error((data&&data.error)||error.message);
    if(data&&data.error) throw new Error(data.error);
    ah=data;
    compDismissed=[];
    currentSaveId=null;   // fresh audit → fresh saved record (keep every iteration)
    setSaveStatus('');
    // pre-fill the site checks from the homepage inspection
    Object.assign(sel,{age:'current',mobile:'yes'});auto.age=false;auto.mobile=false;
    if(ah.site&&ah.site.fetched){
      if(ah.site.copyright_year){const diff=new Date().getFullYear()-ah.site.copyright_year;
        sel.age=diff>=5?'dated':(diff>=3?'aging':'current');auto.age=true;}
      if(ah.site.viewport===false){sel.mobile='no';auto.mobile=true;}
      else if(ah.site.viewport===true){sel.mobile='yes';auto.mobile=true;}
    }
    lh={status:'idle',scores:null};
    lhToken++;
    runLighthouse(domain,lhToken); // runs in the background; grade updates when it lands
    $('auditWrap').classList.remove('hidden');
    render();clearStatus();
    $('auditWrap').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(err){setStatus('error','Audit failed: '+esc(err.message));}
  finally{btn.disabled=false;}
}

/* ===== email ===== */
function moneyValue(){
  if(!(ah&&ah.money&&ah.money.volume&&ah.money.cpc))return null;
  const v=ah.money.volume*(ah.money.cpc/100);
  return v>=100?Math.round(v/50)*50:Math.round(v);
}
function buildEmail(){
  const biz=$('clientName').value.trim()||'your business';
  const agency=agencyName('[Your name]');
  const service=primaryService(),city=$('city').value.trim();
  const m=ah&&ah.money,miss=moneyMiss();
  const comp=(ah&&ah.competitors&&ah.competitors[0])||null;
  const val=moneyValue();
  const sc=score();
  $('emailSub').value=miss
    ?(fmt(m.volume)+' people searched \u201C'+m.keyword+'\u201D last month \u2014 '+biz+' wasn\u2019t there')
    :('Quick question about '+biz+'\u2019s website');
  const p=['Hi there,'];
  if(miss){
    let line='I was doing some research on '+(service?service.toLowerCase()+' companies':'local businesses')+(city?' in '+city:'')+' and ran a quick audit on '+biz+'. One thing jumped out: about '+fmt(m.volume)+' people search \u201C'+m.keyword+'\u201D every month, and your website doesn\u2019t appear in those results at all.';
    if(comp)line+=' Right now '+comp.domain+(comp.position?' holds the #'+comp.position+' spot':' is collecting that traffic')+' \u2014 those calls are going to them.';
    p.push(line);
    // TEMP: CPC + $/month value hidden from the email — uncomment to restore
    // if(val&&m.cpc)p.push('To put a number on it: advertisers pay about $'+(m.cpc/100).toFixed(2)+' per click for that search. Across '+fmt(m.volume)+' monthly searches, that\u2019s roughly $'+fmt(val)+' a month worth of traffic Google is handing out \u2014 just not to you.');
  }else if(seoWeak()){
    p.push('I ran a quick audit on '+biz+' and your website shows up for very few of the searches customers'+(city?' in '+city:'')+' actually use \u2014 which usually means the phone is quieter than it should be.');
    if(comp)p.push(comp.domain+' is currently picking up that search traffic instead.');
  }
  const extras=[];
  if(lh.status==='done'&&speedWeakFlag())extras.push('it loads slowly on phones \u2014 Google scores it '+lh.scores.perf+' out of 100');
  if(sel.age==='dated')extras.push('the design hasn\u2019t been refreshed in years');
  else if(sel.age==='aging')extras.push('the design is starting to show its age');
  if(sel.mobile==='no')extras.push('it\u2019s hard to use on a phone, where most local customers search');
  else if(sel.mobile==='partly')extras.push('it doesn\u2019t quite hold up on a phone');
  if(a11yIssues())extras.push('automated testing flags accessibility issues');
  if(extras.length)p.push('A few other things I noticed: '+extras.join('; ')+'. All fixable.');
  if(sc.grade==='C'&&!miss&&!extras.length){
    p.push('Honestly? Your web presence is in better shape than most'+(city?' in '+city:'')+'. If you ever want to push from solid to dominant, I\u2019d be glad to show you where the headroom is.');
  }else{
    p.push('Would you be open to a 15-minute call this week? I\u2019ll walk you through exactly what I found and what it\u2019s likely costing you \u2014 no charge, no hard pitch. Worst case, you walk away knowing precisely where you stand.');
  }
  let body=p.join('\n\n')+'\n\nBest,\n'+agency;
  let ps=null;
  if(ah&&ah.top_keywords&&ah.top_keywords.some(k=>k.position>3&&k.position<=20))
    ps='your site is sitting just outside the top results on a few searches \u2014 those are the quickest wins on the list';
  else if(adsRunning()&&isWordpress())
    ps='I can see you\u2019re paying for Google Ads, and there\u2019s a fix that makes every one of those ad dollars work harder';
  if(ps)body+='\n\nP.S. One more thing I spotted: '+ps+'. Happy to show you on the call.';
  $('emailBody').value=body;
}

/* ===== client-facing report ===== */
function buildReport(){
  if(!ah)return;
  const agency=agencyName('Your Agency');
  const biz=$('clientName').value.trim()||ah.target;
  const city=$('city').value.trim();
  const service=primaryService();
  const moneyList=(ah.money_list&&ah.money_list.length)?ah.money_list:(ah.money?[ah.money]:[]);
  const m=ah.money||moneyList[0]||null,comp=liveCompetitors(),s=(lh.status==='done')?lh.scores:null;
  const today=new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  const ink='#18212F',soft='#5C6779',ln='#E7EAEF',bad='#BC4338',badBg='#FBF0EF',go='#13795A',goBg='#EEF6F2',wait='#A8650F',waitBg='#FBF4E8',blue='#2D4EF5',blueBg='#EEF2FF';
  const clamp=v=>Math.max(2,Math.min(100,v||0));
  const bar=(label,val,sub,color,track)=>'<div style="margin:9px 0;"><div style="display:flex;justify-content:space-between;align-items:baseline;font-size:12.5px;margin-bottom:4px;"><span style="font-weight:700;">'+esc(label)+'</span><span style="color:'+soft+';font-size:11.5px;">'+sub+'</span></div>'
    +'<div style="height:10px;background:'+(track||'#EEF0F4')+';border-radius:6px;overflow:hidden;"><div style="height:100%;width:'+clamp(val)+'%;background:'+color+';border-radius:6px;"></div></div></div>';
  const lhColor=v=>v==null?'#C7CCD6':(v<50?bad:(v<90?wait:go));
  const pill=(ok)=>'<span style="display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:4px 10px;border-radius:20px;white-space:nowrap;background:'+(ok?goBg:badBg)+';color:'+(ok?go:bad)+';">'+(ok?'Looks good':'Needs attention')+'</span>';
  const money=moneyValue();
  const where=city?(' in '+esc(city)):'';
  const svc=service?esc(service.toLowerCase()):'their service';

  /* ---- findings: each carries a plain-language WHY (lost revenue + competitor
        proof) and a WHAT-WE'D-DO tied to a named service from our pitch set, so a
        rep who doesn't live in digital can still explain and sell it ---- */
  const compNames=comp.slice(0,3).map(c=>c.domain).filter(Boolean);
  const compProof=compNames.length
    ?(' Meanwhile '+compNames.slice(0,2).join(' and ')+(compNames.length>2?' and others':'')+' are showing up'+where+' and taking those calls.')
    :'';
  const findings=[]; // {label, ok, problem, why, fix, service, priority}
  const moneyMissReport=moneyMiss();
  findings.push({
    label:'Showing up on Google',
    ok:!seoWeak(),
    service:'SEO',
    priority:moneyMissReport?1:(seoWeak()?2:99),
    lead:'Customers searching'+where+' are finding competitors first, not '+esc(biz)+'.',
    problem:moneyMissReport
      ?('About '+fmt(m.volume)+' people search \u201C'+esc(m.keyword)+'\u201D every month, and '+esc(biz)+' doesn\u2019t appear in those results at all.')
      :(seoWeak()?'The site appears for very few of the searches customers'+where+' actually type into Google.':'The site shows up where it counts.'),
    why:seoWeak()?('When someone searches for '+svc+where+', they call whoever they find first \u2014 and right now that isn\u2019t '+esc(biz)+'. Every one of those searches is a customer with their wallet out, handed to someone else.'+compProof):'',
    fix:seoWeak()?('Search optimization (SEO) gets '+esc(biz)+' found for the terms that actually bring in paying customers \u2014 putting the business in front of people at the exact moment they\u2019re looking to buy.'):''
  });
  findings.push({
    label:'Website freshness',
    ok:sel.age==='current',
    service:'Website',
    priority:3,
    lead:'A dated site costs trust at first glance and ranking with Google.',
    problem:sel.age!=='current'?'The design and content look several years old.':'',
    why:sel.age!=='current'?('A dated site quietly tells every visitor the business may be behind the times \u2014 and first impressions decide whether someone calls or hits the back button. Google also trusts and ranks fresher, well-maintained sites higher, so an old site costs visibility on top of credibility.'):'',
    fix:sel.age!=='current'?('A new website \u2014 modern, fast, and built to convert \u2014 gives '+esc(biz)+' instant credibility the moment a customer lands, and gives Google a reason to rank it higher.'):''
  });
  findings.push({
    label:'Works well on phones',
    ok:sel.mobile==='yes',
    service:'Website',
    priority:2,
    lead:'Most customers search on phones, and the site struggles there.',
    problem:sel.mobile!=='yes'?'The site struggles on phone screens.':'',
    why:sel.mobile!=='yes'?('Most local customers search on their phone. If the site is hard to read or tap, they don\u2019t struggle through it \u2014 they bounce and call the next business in the list. That\u2019s revenue walking out the door on the most common device people use.'):'',
    fix:sel.mobile!=='yes'?('A new website built mobile-first works perfectly on the device most customers actually use \u2014 so the phone calls land with '+esc(biz)+' instead of a competitor.'):''
  });
  if(s&&s.a11y!=null)findings.push({
    label:'Accessibility & ADA risk',
    ok:!a11yIssues(),
    service:'ADA / accessibility',
    priority:a11yIssues()?2:99,
    lead:'Accessibility gaps turn away customers and create real legal exposure.',
    problem:a11yIssues()?('Automated testing scores accessibility '+s.a11y+' out of 100, flagging issues like missing image descriptions, low color contrast, and unlabeled forms.'):'',
    why:a11yIssues()?('Two costs here. First, customers who use screen readers or other assistive technology simply can\u2019t use the site \u2014 that\u2019s business turned away. Second, and bigger: an inaccessible site is real legal exposure. ADA website lawsuits and demand letters against small businesses have become common, and the business almost always pays to settle \u2014 often far more than it would have cost to fix.'):'',
    fix:a11yIssues()?('An accessibility (ADA) remediation pass fixes the flagged issues \u2014 cutting the legal risk and opening the site to every potential customer. A new website from us is built ADA-compliant from the ground up.'):''
  });

  const gaps=findings.filter(f=>!f.ok);
  const gapsCount=gaps.length;

  // findings checklist (detailed)
  let checks='';
  findings.forEach(f=>{
    checks+='<div style="padding:13px 0;border-bottom:1px solid '+ln+';">'
      +'<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;">'
      +'<div style="font-weight:700;font-size:14px;">'+f.label+'</div>'+pill(f.ok)+'</div>';
    if(!f.ok){
      if(f.problem)checks+='<div style="color:'+ink+';font-size:12.5px;margin-top:6px;max-width:60ch;">'+f.problem+'</div>';
      if(f.why)checks+='<div style="font-size:12px;margin-top:7px;max-width:60ch;"><span style="color:'+bad+';font-weight:700;">Why this matters:</span> <span style="color:'+soft+';">'+f.why+'</span></div>';
      if(f.fix)checks+='<div style="font-size:12px;margin-top:4px;max-width:60ch;"><span style="color:'+go+';font-weight:700;">How '+esc(agency)+' fixes it:</span> <span style="color:'+soft+';">'+f.fix+'</span></div>';
      if(f.service)checks+='<div style="margin-top:8px;"><span style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;background:'+ink+';color:#fff;border-radius:6px;padding:4px 9px;">Recommended: '+esc(f.service)+'</span></div>';
    }else if(f.problem){
      checks+='<div style="color:'+soft+';font-size:12px;margin-top:4px;">'+f.problem+'</div>';
    }
    checks+='</div>';
  });

  // priority summary box — tells the rep exactly what to lead with
  let priorityHtml='';
  if(gapsCount){
    const ranked=[...gaps].sort((a,b)=>a.priority-b.priority);
    const items=ranked.map((f,i)=>'<div style="display:flex;gap:11px;align-items:flex-start;padding:8px 0;'+(i<ranked.length-1?('border-bottom:1px solid '+ln+';'):'')+'">'
      +'<div style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:'+ink+';color:#fff;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;">'+(i+1)+'</div>'
      +'<div style="font-size:12.5px;line-height:1.45;"><b>'+f.label+'</b>'+(f.lead?(' \u2014 <span style="color:'+soft+';">'+f.lead+'</span>'):'')+'</div></div>').join('');
    priorityHtml='<div style="background:'+blueBg+';border:1px solid #C9D4FF;border-radius:14px;padding:16px 18px;margin:18px 0;">'
      +'<div style="font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:'+blue+';font-weight:800;margin-bottom:4px;">Where to start</div>'
      +'<div style="font-size:12.5px;color:'+soft+';margin-bottom:10px;">In order of impact on your phone ringing:</div>'
      +items+'</div>';
  }

  // money panel — one row PER keyword (every requested keyword, data or not)
  let moneyHtml='';
  const mlist=moneyList.filter(x=>x&&x.keyword);
  if(mlist.length){
    const rowFor=(mk)=>{
      const hasData=mk.volume!=null;
      if(!hasData){
        return '<div style="background:#F4F5F8;border:1px solid '+ln+';border-radius:13px;padding:15px 17px;margin:10px 0;">'
          +'<div style="font-size:16px;font-weight:800;margin-bottom:6px;">\u201C'+esc(mk.keyword)+'\u201D</div>'
          +'<div style="font-size:12.5px;color:'+soft+';">No measurable search volume for this exact term right now. That usually means few people search it word-for-word \u2014 we\u2019d help '+esc(biz)+' target the phrasing customers actually use.</div>'
          +'</div>';
      }
      const ranks=mk.best_position!=null;
      const related=ranks?null:relatedRankFor(mk.keyword);
      const ok=ranks||!!related;
      const val=(mk.volume&&mk.cpc)?Math.round(mk.volume*(mk.cpc/100)):null;
      const stat=(v,l,c)=>'<div style="flex:1;min-width:92px;"><div style="font-size:22px;font-weight:800;letter-spacing:-.02em;color:'+c+';">'+v+'</div><div style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:'+soft+';margin-top:2px;">'+l+'</div></div>';
      let posLabel,posColor,verdict;
      if(ranks){posLabel='#'+mk.best_position;posColor=go;verdict='Their site appears at <b>#'+mk.best_position+'</b> for this search.'+(mk.best_position>3?' Page-one but below the top 3 \u2014 most clicks go to the first three results, so there\u2019s real room to climb.':'');}
      else if(related){posLabel='#'+related.position+'*';posColor=go;verdict='They don\u2019t rank for this exact phrase, but they appear at <b>#'+related.position+'</b> for the closely related \u201C'+esc(related.keyword)+'\u201D \u2014 so customers searching this way are finding '+esc(biz)+'.';}
      else {posLabel='Not found';posColor=bad;verdict='Their site <b>does not appear</b> for this search \u2014 every one of these customers is finding a competitor instead.';}
      return '<div style="background:'+(ok?goBg:badBg)+';border:1px solid '+(ok?'#CDE5DA':'#F0D4D0')+';border-radius:13px;padding:15px 17px;margin:10px 0;">'
        +'<div style="font-size:16px;font-weight:800;margin-bottom:10px;">\u201C'+esc(mk.keyword)+'\u201D</div>'
        +'<div style="display:flex;gap:16px;flex-wrap:wrap;">'
        +stat(fmt(mk.volume),'searches / month',ink)
        // TEMP: CPC stat hidden from report — uncomment to restore
        // +(mk.cpc!=null?stat('$'+(mk.cpc/100).toFixed(2),'ad cost per click',ink):'')
        +stat(posLabel,'their position',posColor)
        +'</div>'
        +'<div style="font-size:12.5px;margin-top:11px;">'+verdict+'</div>'
        // TEMP: $/month value (derived from CPC) hidden from report — uncomment to restore
        // +((!ok&&val)?('<div style="font-size:12px;margin-top:8px;color:'+ink+';border-top:1px solid #F0D4D0;padding-top:8px;">At what advertisers pay per click, that\u2019s roughly <b>$'+fmt(val)+'/month</b> in customer traffic going elsewhere.</div>'):'')
        +'</div>';
    };
    moneyHtml='<h3 style="font-size:14px;margin:24px 0 4px;">The searches that should bring '+esc(biz)+' customers</h3>'
      +'<p style="color:'+soft+';font-size:12px;margin:0 0 4px;">Each of these is a search a local customer types when they\u2019re ready to buy. We checked the monthly search volume and exactly where '+esc(biz)+' ranks for each.</p>'
      +mlist.map(rowFor).join('');
  }

  // competitor authority bars
  let compHtml='';
  if(comp.length){
    const yourDr=Math.round(ah.dr||0);
    compHtml='<h3 style="font-size:14px;margin:24px 0 4px;">Who\u2019s winning the search</h3>'
      +'<p style="color:'+soft+';font-size:12px;margin:0 0 10px;">Site authority, 0\u2013100 \u2014 Google\u2019s trust in each website. The longer the bar, the harder they are to outrank. These are the businesses showing up'+where+' instead of you.</p>'
      +bar('Your site \u2014 '+esc(ah.target),yourDr,'authority '+yourDr,bad,badBg)
      +comp.map(c=>bar(c.domain,Math.round(c.dr||0),(c.position!=null?('#'+c.position+' in results \u00B7 '):'')+'authority '+(c.dr!=null?Math.round(c.dr):'\u2014'),blue)).join('');
  }

  // site health bars
  let healthHtml='';
  if(s){
    const items=[['Mobile speed',s.perf],['Accessibility',s.a11y],['SEO checks',s.seo],['Best practices',s.best]];
    healthHtml='<h3 style="font-size:14px;margin:24px 0 4px;">Site health \u2014 Google\u2019s live tests</h3>'
      +'<p style="color:'+soft+';font-size:12px;margin:0 0 10px;">Google scores every site 0\u2013100 on these. Under 50 needs work; 90+ is healthy.</p>'
      +items.filter(x=>x[1]!=null).map(x=>bar(x[0],x[1],x[1]+' / 100',lhColor(x[1]))).join('');
  }

  // recommended services — SAME source as the on-screen "services to pitch" card,
  // minus Site speed (kept on screen for reps, left off the client-facing report).
  const svcSet=pitchList(score()).filter(sv=>sv!=='Site speed');
  const svcBlurb={
    'New website':'A fast, modern, ADA-ready website that earns trust the moment a customer lands \u2014 and gives Google a reason to rank '+esc(biz)+' higher.',
    'SEO':'Get found for the searches customers actually use, so the calls come to '+esc(biz)+' instead of competitors.',
    'Site speed':'Speed work so pages load fast on phones, hold the visitor long enough to call, and stop losing Google rankings to slowness.',
    'ADA / accessibility':'Close the accessibility gaps that create real legal exposure and shut out potential customers.',
    'Targeted landing pages':'They\u2019re already paying for Google Ads \u2014 purpose-built landing pages turn those clicks into far more booked jobs for the same spend.'
  };
  // dark service "cards" (matches the on-screen Services to Pitch chips)
  const svcCards=(extraStyle)=>svcSet.map(sv=>'<span style="display:inline-block;background:'+ink+';color:#fff;font-size:12px;font-weight:700;border-radius:9px;padding:7px 13px;margin:0 6px 6px 0;'+(extraStyle||'')+'">'+esc(sv)+'</span>').join('');
  // compact chip row for the top summary
  const pitchChipsTop=svcSet.length
    ?('<div style="margin:16px 0 4px;"><div style="font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:'+soft+';font-weight:700;margin-bottom:8px;">Services to pitch</div><div>'+svcCards()+'</div></div>')
    :'';
  // detailed bundle lower down (cards + what each does)
  let pitchHtml='';
  if(svcSet.length){
    pitchHtml='<div style="background:#fff;border:2px solid '+ink+';border-radius:14px;padding:18px 20px;margin:24px 0;">'
      +'<div style="font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:'+ink+';font-weight:800;margin-bottom:12px;">How '+esc(agency)+' would help</div>'
      +'<div style="margin-bottom:6px;">'+svcCards()+'</div>'
      +svcSet.map((sv,i)=>'<div style="padding:9px 0;'+(i<svcSet.length-1?('border-bottom:1px solid '+ln+';'):'')+'">'
        +'<div style="font-weight:700;font-size:13.5px;">'+esc(sv)+'</div>'
        +'<div style="font-size:12px;color:'+soft+';margin-top:2px;max-width:62ch;">'+(svcBlurb[sv]||'')+'</div></div>').join('')
      +'</div>';
  }

  // closing / next steps — hands the rep the call-to-action language
  const nextHtml='<div style="background:'+ink+';color:#fff;border-radius:14px;padding:18px 20px;margin:24px 0 0;">'
    +'<div style="font-size:14px;font-weight:800;margin-bottom:6px;">What happens next</div>'
    +'<div style="font-size:12.5px;opacity:.85;line-height:1.55;max-width:60ch;">This is a quick outside-in look \u2014 the kind of thing a customer sees before they ever call. '
    +(gapsCount?('There\u2019s a clear fix behind each of the '+gapsCount+' item'+(gapsCount===1?'':'s')+' flagged above.'):'The fundamentals look strong, and there\u2019s always room to push from solid to dominant.')
    +' A 15-minute call is all it takes to walk through what closing these gaps would mean for your calls and leads \u2014 no charge, no pressure.</div></div>';

  const reportInner=
    '<div style="background:'+ink+';color:#fff;border-radius:14px;padding:20px 22px;display:flex;justify-content:space-between;align-items:center;">'
    +'<div><div style="font-size:20px;font-weight:800;letter-spacing:-.01em;">Website Snapshot</div>'
    +'<div style="font-size:12px;opacity:.75;margin-top:3px;">Prepared for '+esc(biz)+(city?(' \u00B7 '+esc(city)):'')+' \u00B7 '+today+'</div></div>'
    +'<div style="font-size:13px;font-weight:700;opacity:.9;text-align:right;">'+esc(agency)+'</div></div>'
    +'<p style="font-size:13px;color:'+soft+';margin:16px 0 0;">We looked at '+esc(biz)+' the way a customer searching Google would \u2014 here\u2019s what we found. '
    +(gapsCount?('<b style="color:'+ink+';">'+gapsCount+' '+(gapsCount===1?'opportunity':'opportunities')+'</b> stood out.'):'Things look strong.')+'</p>'
    +pitchChipsTop
    +priorityHtml+moneyHtml+compHtml+healthHtml
    +'<h3 style="font-size:14px;margin:24px 0 2px;">What we checked, and what it means for you</h3>'+checks
    +pitchHtml
    +nextHtml
    +'<p style="font-size:13.5px;font-weight:700;margin-top:18px;">\u2014 '+esc(agency)+'</p>';
  // Two buttons: Print uses the browser's own engine (sharp, dialog). Download PDF
  // uses html2pdf to generate and auto-save a file with no dialog (one click).
  const safeName=(biz||'website').replace(/[^a-z0-9]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase()||'website';
  const printBar='<div class="noprint" style="position:sticky;top:0;z-index:10;background:#fff;border-bottom:1px solid '+ln+';padding:12px 0;margin:-28px 0 18px;display:flex;justify-content:flex-end;gap:8px;">'
    +'<button id="dlBtn" style="background:'+ink+';color:#fff;border:none;border-radius:9px;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">\u2B07 Download PDF</button>'
    +'<button onclick="window.print()" style="background:#fff;color:'+ink+';border:1px solid '+ln+';border-radius:9px;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">\uD83D\uDDA8 Print</button>'
    +'</div>';
  // download handler + library loader (runs inside the report tab, on user click only)
  const dlScript='<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"><\/script>'
    +'<script>'
    +'(function(){'
    +'var btn=document.getElementById("dlBtn");'
    +'function doDownload(){'
    +'  if(typeof html2pdf==="undefined"){btn.textContent="Loading\u2026";setTimeout(doDownload,400);return;}'
    +'  btn.disabled=true;btn.textContent="Generating\u2026";'
    +'  var el=document.getElementById("reportBody");'
    +'  html2pdf().set({margin:[12,14,12,14],filename:"'+safeName+'-website-snapshot.pdf",'
    +'    image:{type:"jpeg",quality:0.98},html2canvas:{scale:2,useCORS:true,backgroundColor:"#ffffff"},'
    +'    jsPDF:{unit:"mm",format:"a4",orientation:"portrait"},pagebreak:{mode:["css","legacy"]}})'
    +'    .from(el).save().then(function(){btn.disabled=false;btn.textContent="\u2B07 Download PDF";})'
    +'    .catch(function(){btn.disabled=false;btn.textContent="\u2B07 Download PDF";alert("Could not generate the PDF \u2014 try the Print button and choose Save as PDF.");});'
    +'}'
    +'btn.addEventListener("click",doDownload);'
    +'})();'
    +'<\/script>';
  const html='<!DOCTYPE html><html><head><meta charset="utf-8"><title>Website snapshot \u2014 '+esc(biz)+'</title>'
    +'<style>*{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box;}@page{margin:13mm;}@media print{.noprint{display:none!important;}}body{font-family:Helvetica,Arial,sans-serif;color:'+ink+';max-width:660px;margin:0 auto;padding:28px 24px;line-height:1.5;}h3{break-after:avoid;}</style></head><body>'
    +printBar
    +'<div id="reportBody" style="width:600px;max-width:600px;">'+reportInner+'</div>'
    +dlScript
    +'</body></html>';
  // Open the report as a fully independent tab via a Blob URL.
  reportJustOpened=Date.now();
  try{
    const blob=new Blob([html],{type:'text/html'});
    const u=URL.createObjectURL(blob);
    const w=window.open(u,'_blank');
    if(!w){URL.revokeObjectURL(u);alert('Allow pop-ups to generate the report.');return;}
    setTimeout(()=>URL.revokeObjectURL(u),60000); // free the blob once the tab has loaded
  }catch(e){
    const w=window.open('','_blank');
    if(!w){alert('Allow pop-ups to generate the report.');return;}
    w.document.write(html);w.document.close();
  }
}

/* ===== save + team list ===== */
function buildProspectRow(){
  const name=$('clientName').value.trim();if(!name)return null;
  const sc=score();
  return {client_name:name,domain:$('domain').value.trim().replace(/^https?:\/\//i,'').replace(/^www\./i,'').replace(/\/+$/,'').toLowerCase(),
    city:$('city').value.trim(),service:primaryService(),
    created_by_email:(function(){const r=$('repName');const v=r?r.value.trim():'';if(v)localStorage.setItem('mrr_rep',v);return v||savedBy(session?.user?.email)||null;})(),
    dr:ah?.dr??null,org_traffic:ah?.org_traffic??null,org_keywords:ah?.org_keywords??null,org_keywords_1_3:ah?.org_keywords_1_3??null,
    live_refdomains:ah?.live_refdomains??null,live_backlinks:ah?.live_backlinks??null,running_ads:adsRunning(),
    site_age:sel.age,mobile:sel.mobile,grade:sc.grade,action:sc.action,pitch:pitchList(sc),partner:partner?partner.slug:null,
    extras:{money:ah?.money??null,money_list:ah?.money_list??null,service_rows:serviceRows(),competitors:ah?.competitors??null,competitors_dismissed:compDismissed.slice(),top_keywords:ah?.top_keywords??null,site:ah?.site??null,
      lighthouse:(lh.status==='done'?lh.scores:null)}};
}
// Auto-save the current audit. First call inserts (new record per audit/iteration);
// later calls in the same audit (e.g. rep flips a toggle) update that same row.
async function autoSaveProspect(){
  if(viewingSaved||!ah||autoSaving)return;
  const row=buildProspectRow();if(!row)return; // need a client name
  autoSaving=true;
  setSaveStatus('saving');
  try{
    if(currentSaveId){
      let {error}=await sb.from('prospects').update(row).eq('id',currentSaveId);
      if(error&&/extras/.test(error.message||'')){const r2={...row};delete r2.extras;({error}=await sb.from('prospects').update(r2).eq('id',currentSaveId));}
      if(error)throw error;
    }else{
      let {data,error}=await sb.from('prospects').insert(row).select('id').single();
      if(error&&/extras/.test(error.message||'')){const r2={...row};delete r2.extras;({data,error}=await sb.from('prospects').insert(r2).select('id').single());}
      if(error)throw error;
      currentSaveId=data?.id??null;
    }
    setSaveStatus('saved');
    loadRecent();
  }catch(e){console.error('auto-save failed',e);setSaveStatus('error');}
  finally{autoSaving=false;}
}
function setSaveStatus(state){
  const el=$('saveStatus');if(!el)return;
  if(state==='saving'){el.className='savestatus saving';el.innerHTML='<span class="spin"></span>Saving to team list\u2026';}
  else if(state==='saved'){el.className='savestatus saved';el.textContent='\u2713 Saved to team list \u2014 find it below. Delete it there if you don\u2019t want it kept.';}
  else if(state==='error'){el.className='savestatus error';el.textContent='Couldn\u2019t auto-save \u2014 your network may be offline. The audit is still on screen.';}
  else{el.className='savestatus';el.textContent='';}
}
function exitViewMode(){
  viewingSaved=null;
  const b=$('viewBanner');if(b)b.classList.add('hidden');
  const s=$('saveBtn');if(s)s.classList.remove('hidden');
  const rn=$('repName');if(rn&&rn.closest('.field'))rn.closest('.field').classList.remove('hidden');
}
function openSaved(l){
  viewingSaved=l;
  lhToken++; // cancel any in-flight live test
  $('clientName').value=l.client_name||'';
  $('domain').value=l.domain||'';
  $('city').value=l.city||'';
  const ex=l.extras||{};
  setKeywordRows(ex.service_rows&&ex.service_rows.length?ex.service_rows:(l.service?[l.service]:['']));
  ah={target:l.domain,dr:l.dr,org_traffic:l.org_traffic,org_keywords:l.org_keywords,org_keywords_1_3:l.org_keywords_1_3,
    live_refdomains:l.live_refdomains,live_backlinks:l.live_backlinks,
    paid_keywords:l.running_ads?1:0,paid_pages:null,
    money:ex.money||null,money_list:ex.money_list||(ex.money?[ex.money]:null),competitors:ex.competitors||null,top_keywords:ex.top_keywords||null,site:ex.site||null};
  Object.assign(sel,{age:l.site_age||'current',mobile:l.mobile||'yes'});auto.age=false;auto.mobile=false;
  compDismissed=Array.isArray(ex.competitors_dismissed)?ex.competitors_dismissed.slice():[];
  currentSaveId=null;setSaveStatus('');
  lh=ex.lighthouse?{status:'done',scores:ex.lighthouse}:{status:'idle',scores:null};
  $('auditWrap').classList.remove('hidden');
  render();clearStatus();
  const when=l.created_at?new Date(l.created_at).toLocaleDateString():'';
  $('viewBannerText').innerHTML='<b>Viewing saved audit</b> \u2014 '+esc(l.client_name||l.domain)
    +(when?(', saved '+when):'')+(savedBy(l.created_by_email)?(' by '+esc(savedBy(l.created_by_email))):'')
    +'. The email and report below regenerate from this archive.';
  $('viewBanner').classList.remove('hidden');
  const sb2=$('saveBtn');if(sb2)sb2.classList.add('hidden');
  const rn=$('repName');if(rn&&rn.closest('.field'))rn.closest('.field').classList.add('hidden');
  $('auditWrap').scrollIntoView({behavior:'smooth',block:'start'});
}
function resetAudit(){
  exitViewMode();
  ['clientName','domain','city'].forEach(id=>{const el=$(id);if(el)el.value='';});
  setKeywordRows(['']);
  const es=$('emailSub'),eb=$('emailBody');if(es)es.value='';if(eb)eb.value='';
  ah=null;lh={status:'idle',scores:null};lhToken++;compDismissed=[];currentSaveId=null;setSaveStatus('');
  Object.assign(sel,{age:'current',mobile:'yes'});auto.age=false;auto.mobile=false;skipDupCheck=false;
  $('auditWrap').classList.add('hidden');
  clearStatus();
  window.scrollTo({top:0,behavior:'smooth'});
  $('clientName').focus();
}

let recent=[];const ORDER={A:0,B:1,C:2};
async function loadRecent(){
  let q=sb.from('prospects').select('*');
  if(partner)q=q.eq('partner',partner.slug);
  const {data,error}=await q.order('created_at',{ascending:false}).limit(200);
  if(error){console.error(error);return;}
  recent=data||[];renderRecent();
}
function teamView(){
  const list=[...recent].sort((a,b)=>(ORDER[a.grade]??9)-(ORDER[b.grade]??9)||new Date(b.created_at)-new Date(a.created_at));
  const q=$('search').value.trim().toLowerCase();
  return list.filter(l=>!q||((l.client_name||'')+' '+(l.city||'')+' '+(l.service||'')+' '+savedBy(l.created_by_email)).toLowerCase().includes(q));
}
function renderRecent(){
  const view=teamView();
  const rows=$('savedRows');rows.innerHTML='';
  $('savedEmpty').style.display=recent.length?'none':'block';
  view.forEach(l=>{
    const tr=document.createElement('tr');
    tr.classList.add('rowlink');tr.title='Click to view the full saved audit';
    tr.addEventListener('click',()=>openSaved(l));
    const miss=l.extras&&l.extras.money&&l.extras.money.volume&&l.extras.money.best_position==null;
    const lhs=l.extras&&l.extras.lighthouse;
    const mini='Auth '+(l.dr??'—')+' \u00B7 '+fmt(l.org_traffic)+'/mo'
      +(lhs&&lhs.perf!=null?(' \u00B7 speed '+lhs.perf):'')
      +(miss?' \u00B7 invisible for money search':'');
    tr.innerHTML='<td><span class="pill '+(l.grade||'C')+'">'+(l.grade||'?')+'</span></td>'
      +'<td><div class="biz-name">'+esc(l.client_name)+'</div><div class="biz-sub">'+esc(l.domain||'')+'</div></td>'
      +'<td class="mini">'+mini+'</td><td class="mini">'+((l.pitch||[]).join(', ')||'—')+'</td>'
      +'<td><button class="del" aria-label="Remove">×</button></td>';
    tr.querySelector('.del').addEventListener('click',async()=>{await sb.from('prospects').delete().eq('id',l.id);loadRecent();});
    rows.appendChild(tr);
  });
}
function exportXlsx(){
  if(!recent.length)return;
  const list=teamView();
  const head=['Client','Website','City','Service','Phone','Email','Address','Grade','Action','Authority','Traffic','Keywords','Top 3','Referring domains','Backlinks','Paid search','WordPress','Money search','Searches/mo','Their rank','Mobile speed','Accessibility','Google SEO','Best practices','Partner','Pitch','Saved by','Saved at'];
  const rows=list.map(l=>{const m=(l.extras&&l.extras.money)||{};const lhs=(l.extras&&l.extras.lighthouse)||{};const ct=(l.extras&&l.extras.site&&l.extras.site.contact)||{};
    return [l.client_name||'',l.domain||'',l.city||'',l.service||'',fmtPhone(ct.phone)||'',ct.email||'',ct.address||'',l.grade||'',l.action||'',l.dr??'',l.org_traffic??'',l.org_keywords??'',l.org_keywords_1_3??'',l.live_refdomains??'',l.live_backlinks??'',l.running_ads?'Running ads':'None',(l.extras&&l.extras.site&&typeof l.extras.site.wordpress==='boolean'?(l.extras.site.wordpress?'Yes':'No'):''),
      m.keyword||'',m.volume??'',(m.volume!=null?(m.best_position!=null?('#'+m.best_position):'Not found'):''),
      lhs.perf??'',lhs.a11y??'',lhs.seo??'',lhs.best??'',
      l.partner||'',(l.pitch||[]).join('; '),savedBy(l.created_by_email),l.created_at||''];});
  const aoa=[['Prospect List'],[],head,...rows];
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols']=[{wch:24},{wch:24},{wch:14},{wch:12},{wch:15},{wch:26},{wch:32},{wch:7},{wch:18},{wch:10},{wch:10},{wch:10},{wch:8},{wch:17},{wch:10},{wch:12},{wch:11},{wch:22},{wch:11},{wch:10},{wch:12},{wch:13},{wch:11},{wch:13},{wch:12},{wch:30},{wch:24},{wch:22}];
  ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:head.length-1}}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Prospect List');
  const q=$('search').value.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  XLSX.writeFile(wb,q?('prospect-list-'+q+'.xlsx'):'prospect-list.xlsx');
}

/* ===== auth ===== */
function showApp(){
  $('authGate').classList.add('hidden');$('app').classList.remove('hidden');
  const em=session?.user?.email||'';
  $('userEmail').textContent=em;
  // machine accounts (embed + per-partner logins) never show account chrome
  const machine=em.toLowerCase().endsWith('@'+PARTNER_AUTH_DOMAIN);
  const w=document.querySelector('.whoami');
  if(w)w.style.display=(embedMode||machine)?'none':'';
}
function showGate(msg){$('app').classList.add('hidden');$('authGate').classList.remove('hidden');if(msg){const m=$('authMsg');m.className='authmsg err';m.textContent=msg;}}
async function signIn(){
  const email=(partner&&!emailMode)?(partner.slug+'@'+PARTNER_AUTH_DOMAIN):$('email').value.trim();
  const password=$('password').value;
  const m=$('authMsg');m.className='authmsg';m.textContent='Signing in…';
  const {data,error}=await sb.auth.signInWithPassword({email,password});
  if(error){m.className='authmsg err';m.textContent=error.message;return;}
  session=data.session;onSignedIn();
}
async function onSignedIn(){
  // The login's partner tag is the source of truth — it overrides whatever the URL says.
  const tag=session?.user?.app_metadata?.partner;
  if(tag&&(!partner||partner.slug!==tag)){
    const {data}=await sb.from('partners').select('slug,name').eq('slug',tag).maybeSingle();
    partner=data||{slug:tag,name:tag};
    applyPartnerBrand();
  }
  showApp();loadSettings();await loadRecent();
}

/* ===== wire up ===== */
function wire(){
  buildSections();
  S_IDS.forEach(id=>$('t_'+id).addEventListener('input',()=>{render();saveSettings();}));
  $('auditBtn').addEventListener('click',runAudit);
  $('domain').addEventListener('keydown',e=>{if(e.key==='Enter')runAudit();});
  $('genEmail').addEventListener('click',buildEmail);
  $('reportBtn').addEventListener('click',buildReport);
  $('copyEmail').addEventListener('click',async()=>{const txt='Subject: '+$('emailSub').value+'\n\n'+$('emailBody').value;try{await navigator.clipboard.writeText(txt);}catch(e){const t=$('emailBody');t.select();document.execCommand('copy');}const c=$('copied');c.classList.add('show');setTimeout(()=>c.classList.remove('show'),1500);});
  $('search').addEventListener('input',renderRecent);
  $('refreshBtn').addEventListener('click',loadRecent);
  $('exportBtn').addEventListener('click',exportXlsx);
  $('signinBtn').addEventListener('click',signIn);
  $('useEmail').addEventListener('click',()=>{emailMode=true;updateGateMode();$('email').focus();});
  $('password').addEventListener('keydown',e=>{if(e.key==='Enter')signIn();});
  $('newAuditBtn').addEventListener('click',resetAudit);
  $('signoutBtn').addEventListener('click',async()=>{await sb.auth.signOut();session=null;showGate();});
  const addBtn=$('addKwBtn');if(addBtn)addBtn.addEventListener('click',()=>addKeywordRow(''));
  // wire the delete button on the initial static keyword row + set its visibility
  document.querySelectorAll('.kw-del').forEach(d=>d.addEventListener('click',e=>{e.target.closest('.kw-row').remove();syncAddBtn();}));
  syncAddBtn();
  // When the rep leaves the tab on an already-saved audit, clear it so coming back
  // to a STALE tab is a clean slate. But only after the tab has been hidden a good
  // while — opening the print/report tab and coming back must NOT wipe the audit.
  let hiddenTimer=null;
  const IDLE_CLEAR_MS=10*60*1000; // 10 minutes hidden before we consider it abandoned
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){
      // don't arm the clear if the rep just opened the report tab
      const fromReport=(Date.now()-reportJustOpened)<5000;
      if(currentSaveId && !viewingSaved && !autoSaving && !fromReport){
        clearTimeout(hiddenTimer);
        hiddenTimer=setTimeout(()=>{
          // re-check on fire: only clear if still hidden, still a saved audit
          if(document.hidden && currentSaveId && !viewingSaved && !autoSaving){resetAudit();}
        },IDLE_CLEAR_MS);
      }
    }else{
      clearTimeout(hiddenTimer);hiddenTimer=null; // back in the tab — cancel any pending clear
    }
  });
}

/* ===== init ===== */
(async function(){
  if(!initClient())return;
  wire();
  const bt=$('buildTag');if(bt)bt.textContent='Build v32';
  const rn=$('repName');if(rn)rn.value=localStorage.getItem('mrr_rep')||'';
  await loadPartner();
  const {data}=await sb.auth.getSession();
  session=data.session;
  // Embedded mode: a partner link can carry ?k=<password> for silent sign-in,
  // so the tool works inside an already-protected members area with no login screen
  if(!session&&partner){
    const k=new URLSearchParams(location.search).get('k');
    if(k){
      const r=await sb.auth.signInWithPassword({email:partner.slug+'@'+PARTNER_AUTH_DOMAIN,password:k});
      if(!r.error){session=r.data.session;embedMode=true;}
    }
    // No key needed: one shared invisible account signs every partner page in silently.
    // The slug on the URL decides whose branding shows and whose data is read/written.
    if(!session&&window.EMBED_PASS){
      const r=await sb.auth.signInWithPassword({email:'embed@'+PARTNER_AUTH_DOMAIN,password:window.EMBED_PASS});
      if(!r.error){session=r.data.session;embedMode=true;}
    }
  }
  if(new URLSearchParams(location.search).get('k'))history.replaceState(null,'',location.pathname);
  if(session)onSignedIn(); else showGate();

  // Handle auth-state changes so a token refresh on tab-refocus is graceful instead
  // of leaving a hung session. This is the core of the "tab freezes after idle" fix:
  // when the access token expires while the tab is backgrounded, Supabase refreshes
  // it on return — we react to that event rather than letting calls stall.
  sb.auth.onAuthStateChange((event,newSession)=>{
    if(event==='SIGNED_OUT'){
      session=null;
      // In embed mode, silently sign back in so the iframe never dies on a stale tab.
      if(embedMode&&window.EMBED_PASS){
        sb.auth.signInWithPassword({email:'embed@'+PARTNER_AUTH_DOMAIN,password:window.EMBED_PASS})
          .then(r=>{if(!r.error){session=r.data.session;}else{showGate();}})
          .catch(()=>showGate());
      }else{
        showGate();
      }
    }else if(event==='TOKEN_REFRESHED'||event==='SIGNED_IN'){
      session=newSession;   // fresh token in hand — nothing hangs
    }
  });
})();
