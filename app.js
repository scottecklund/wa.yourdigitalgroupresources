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
  sb=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_ANON_KEY);
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
  competitors:'The businesses actually on page 1 of their money search — directories and national sites are filtered out, so these are the local rivals taking their customers.',
  contact:'Phone, email, and address pulled from their website (homepage or contact page). Best-effort — give it a quick glance before outreach.',
  rankedfor:'Searches where their site already appears, and at what position. Positions 4–20 are "almost there" — quick wins to pitch.',
  lh:'Four automated checks Google runs on the live site, scored 0–100: speed on a phone, accessibility, basic SEO hygiene, and code best practices.',
  speed:'How fast the site loads on a phone, per Google\u2019s Lighthouse test. Slow sites lose visitors before they ever call — and Google ranks them lower.',
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
  sectionsEl.querySelectorAll('.bands').forEach(g=>g.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{sel[g.dataset.item]=b.dataset.v;auto[g.dataset.item]=false;render();})));
  document.addEventListener('click',e=>{
    const info=e.target.closest('.info');
    if(info){e.stopPropagation();document.querySelectorAll('.info.show').forEach(o=>{if(o!==info)o.classList.remove('show');});info.classList.toggle('show');return;}
    document.querySelectorAll('.info.show').forEach(o=>o.classList.remove('show'));
  });
}

/* ===== scoring ===== */
function isWordpress(){return !!(ah&&ah.site&&ah.site.wordpress);}
function adsRunning(){return ah && ((ah.paid_keywords||0)>0 || (ah.paid_pages||0)>0);}
function moneyMiss(){return !!(ah&&ah.money&&ah.money.volume!=null&&ah.money.volume>0&&ah.money.best_position==null);}
function speedWeakFlag(){return lh.status==='done'&&lh.scores&&lh.scores.perf!=null&&lh.scores.perf<settings().speedWeak;}
function a11yIssues(){return lh.status==='done'&&lh.scores&&lh.scores.a11y!=null&&lh.scores.a11y<90;}
function seoWeak(){if(!ah)return false;const s=settings();const dr=ah.dr,tr=ah.org_traffic,t3=ah.org_keywords_1_3;
  return (dr!=null&&dr<s.drWeak)||(tr!=null&&tr<s.trafficWeak)||(t3!=null&&t3<s.top3Weak)||moneyMiss();}
function siteWeak(){return sel.age!=='current'||sel.mobile!=='yes'||speedWeakFlag();}
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
  const miss=moneyMiss()?' They\u2019re invisible for their money search — the clearest proof point you have.':'';
  const slow=speedWeakFlag()?(' Google scores their mobile speed '+lh.scores.perf+'/100.'):'';
  if(s.grade==='A')return 'Both gaps present: <b>'+gaps.join(' and ')+'</b>. Clear opportunity — top priority.'+miss+slow+ads;
  if(s.grade==='C')return 'Website and SEO both look solid. Little to sell — deprioritize.'+ads;
  return 'Opportunity: <b>'+gaps.join(', ')+'</b>. Solid prospect worth pursuing.'+miss+slow+ads;}

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
function renderMoney(){
  const box=$('moneyBox');
  if(!ah||!ah.money||ah.money.volume==null){box.classList.add('hidden');return;}
  const m=ah.money;box.classList.remove('hidden');
  const ranks=m.best_position!=null;
  const cpc=m.cpc!=null?('$'+(m.cpc/100).toFixed(2)):null;
  $('moneyHead').innerHTML='The money search '+infoIcon('money','the money search');
  $('moneyBody').innerHTML=
    '<div class="money '+(ranks?'money-ok':'money-miss')+'">'
    +'<div class="money-kw">\u201C'+esc(m.keyword)+'\u201D</div>'
    +'<div class="money-stats"><b>'+fmt(m.volume)+'</b> searches/mo'+(cpc?' \u00B7 advertisers pay <b>'+cpc+'</b> per click':'')+'</div>'
    +'<div class="money-verdict">'+(ranks
      ?'Their site ranks <b>#'+m.best_position+'</b> for this search.'
      :'Their site was <b>not found</b> in the results for this search.')+'</div>'
    +'</div>';
}
function renderCompetitors(){
  const box=$('compBox');
  if(!ah||!ah.competitors||!ah.competitors.length){box.classList.add('hidden');return;}
  box.classList.remove('hidden');
  $('compHead').innerHTML='Who\u2019s winning instead '+infoIcon('competitors','competitors');
  $('compBody').innerHTML=ah.competitors.map(c=>{
    const meta=c.position!=null
      ?('#'+c.position+' for the money search \u00B7 authority '+(c.dr!=null?Math.round(c.dr):'—'))
      :(fmt(c.traffic)+' visits/mo \u00B7 authority '+(c.dr!=null?Math.round(c.dr):'—'));
    return '<div class="comp-row"><div class="comp-dom">'+esc(c.domain)+'</div><div class="comp-meta">'+meta+'</div></div>';
  }).join('');
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
    $('readout').innerHTML=
      metricCard('Site authority',(ah.dr!=null?ah.dr:'—'),'',(ah.dr!=null?(drW?'Weak':'OK'):''),(drW?'weak':'ok'),'authority')
     +metricCard('Organic traffic',fmt(ah.org_traffic),(ah.org_traffic!=null?'/mo':''),(ah.org_traffic!=null?(trW?'Weak':'OK'):''),(trW?'weak':'ok'),'traffic')
     +metricCard('Keywords',fmt(ah.org_keywords),(ah.org_keywords_1_3!=null?(ah.org_keywords_1_3+' in top 3'):''),(ah.org_keywords_1_3!=null?(kwW?'Weak':'OK'):''),(kwW?'weak':'ok'),'keywords')
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
}

/* ===== run audit ===== */
function setStatus(cls,html){const el=$('status');el.className='status show '+cls;el.innerHTML=html;}
function clearStatus(){$('status').className='status';}
function moneyTerm(){const city=$('city').value.trim(),service=$('service').value.trim();
  return (service&&city)?(service+' '+city).toLowerCase():'';}

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
    const {data,error}=await sb.functions.invoke('ahrefs-audit',{body:{url:domain,money_keyword:moneyTerm()}});
    if(error) throw new Error((data&&data.error)||error.message);
    if(data&&data.error) throw new Error(data.error);
    ah=data;
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
  const service=$('service').value.trim(),city=$('city').value.trim();
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
    if(val&&m.cpc)p.push('To put a number on it: advertisers pay about $'+(m.cpc/100).toFixed(2)+' per click for that search. Across '+fmt(m.volume)+' monthly searches, that\u2019s roughly $'+fmt(val)+' a month worth of traffic Google is handing out \u2014 just not to you.');
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
  const m=ah.money,comp=ah.competitors||[],s=(lh.status==='done')?lh.scores:null;
  const today=new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  const ink='#18212F',soft='#5C6779',ln='#E7EAEF',bad='#BC4338',badBg='#FBF0EF',go='#13795A',goBg='#EEF6F2',wait='#A8650F',blue='#2D4EF5';
  const clamp=v=>Math.max(2,Math.min(100,v||0));
  const bar=(label,val,sub,color,track)=>'<div style="margin:9px 0;"><div style="display:flex;justify-content:space-between;align-items:baseline;font-size:12.5px;margin-bottom:4px;"><span style="font-weight:700;">'+esc(label)+'</span><span style="color:'+soft+';font-size:11.5px;">'+sub+'</span></div>'
    +'<div style="height:10px;background:'+(track||'#EEF0F4')+';border-radius:6px;overflow:hidden;"><div style="height:100%;width:'+clamp(val)+'%;background:'+color+';border-radius:6px;"></div></div></div>';
  const lhColor=v=>v==null?'#C7CCD6':(v<50?bad:(v<90?wait:go));
  const pill=(ok)=>'<span style="display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:4px 10px;border-radius:20px;background:'+(ok?goBg:badBg)+';color:'+(ok?go:bad)+';">'+(ok?'Looks good':'Needs attention')+'</span>';

  // findings checklist
  let checks='';
  const row=(label,okFlag,note)=>{checks+='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;padding:11px 0;border-bottom:1px solid '+ln+';"><div><div style="font-weight:700;font-size:13.5px;">'+label+'</div>'+(note?'<div style="color:'+soft+';font-size:12px;margin-top:2px;max-width:46ch;">'+note+'</div>':'')+'</div>'+pill(okFlag)+'</div>';};
  row('Showing up on Google',!seoWeak(),
    (m&&m.volume!=null&&m.best_position==null)
      ?('About '+fmt(m.volume)+' people search \u201C'+esc(m.keyword)+'\u201D every month \u2014 your site doesn\u2019t appear in those results.')
      :(seoWeak()?'Your site appears for very few of the searches customers in your area use.':'Your site shows up where it counts.'));
  row('Website freshness',sel.age==='current',sel.age!=='current'?'The design and content appear several years old \u2014 it affects both trust and ranking.':'');
  row('Works well on phones',sel.mobile==='yes',sel.mobile!=='yes'?'Most local customers search on a phone, and the site struggles on mobile screens.':'');
  if(s&&s.perf!=null)row('Loads fast on phones',!speedWeakFlag(),speedWeakFlag()?('Google\u2019s mobile speed test scores the site '+s.perf+' out of 100. Slow pages lose visitors before they call.'):'');
  if(s&&s.a11y!=null)row('Usable by all visitors',!a11yIssues(),a11yIssues()?('Automated checks score accessibility at '+s.a11y+' out of 100 \u2014 fixable issues that make the site harder for some visitors to use.'):'');
  const gapsCount=(checks.match(/Needs attention/g)||[]).length;

  // money feature panel
  let moneyHtml='';
  if(m&&m.volume!=null){
    const ranks=m.best_position!=null;
    const stat=(v,l)=>'<div style="flex:1;min-width:110px;"><div style="font-size:26px;font-weight:800;letter-spacing:-.02em;color:'+(ranks?go:bad)+';">'+v+'</div><div style="font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:'+soft+';margin-top:2px;">'+l+'</div></div>';
    moneyHtml='<div style="background:'+(ranks?goBg:badBg)+';border:1px solid '+(ranks?'#CDE5DA':'#F0D4D0')+';border-radius:14px;padding:18px 20px;margin:20px 0;">'
      +'<div style="font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:'+soft+';font-weight:700;">The search that should bring you customers</div>'
      +'<div style="font-size:21px;font-weight:800;margin:5px 0 12px;">\u201C'+esc(m.keyword)+'\u201D</div>'
      +'<div style="display:flex;gap:18px;flex-wrap:wrap;">'
      +stat(fmt(m.volume),'searches every month')
      +(m.cpc!=null?stat('$'+(m.cpc/100).toFixed(2),'advertisers pay per click'):'')
      +stat(ranks?('#'+m.best_position):'Not found','your position')
      +'</div>'
      +'<div style="font-size:13px;margin-top:12px;">'+(ranks?'Your site appears at <b>#'+m.best_position+'</b> for this search.':'Your website <b>does not appear</b> in these results \u2014 every one of those searches is finding someone else.')+'</div>'
      +'</div>';
  }

  // competitor authority bars
  let compHtml='';
  if(comp.length){
    const yourDr=Math.round(ah.dr||0);
    compHtml='<h3 style="font-size:14px;margin:24px 0 4px;">Who\u2019s winning the search</h3>'
      +'<p style="color:'+soft+';font-size:12px;margin:0 0 10px;">Site authority, 0\u2013100 \u2014 Google\u2019s trust in each website. Longer bar = harder to outrank.</p>'
      +bar('Your site \u2014 '+esc(ah.target),yourDr,'authority '+yourDr,bad,badBg)
      +comp.map(c=>bar(c.domain,Math.round(c.dr||0),(c.position!=null?('#'+c.position+' in results \u00B7 '):'')+'authority '+(c.dr!=null?Math.round(c.dr):'\u2014'),blue)).join('');
  }

  // site health bars
  let healthHtml='';
  if(s){
    const items=[['Mobile speed',s.perf],['Accessibility',s.a11y],['SEO checks',s.seo],['Best practices',s.best]];
    healthHtml='<h3 style="font-size:14px;margin:24px 0 4px;">Site health \u2014 Google\u2019s live tests</h3>'
      +'<p style="color:'+soft+';font-size:12px;margin:0 0 10px;">Scored 0\u2013100 by Google. Under 50 needs work; 90+ is healthy.</p>'
      +items.filter(x=>x[1]!=null).map(x=>bar(x[0],x[1],x[1]+' / 100',lhColor(x[1]))).join('');
  }

  const html='<!DOCTYPE html><html><head><meta charset="utf-8"><title>Website snapshot \u2014 '+esc(biz)+'</title>'
    +'<style>*{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box;}@page{margin:13mm;}body{font-family:Helvetica,Arial,sans-serif;color:'+ink+';max-width:660px;margin:0 auto;padding:28px 24px;line-height:1.5;}</style></head><body>'
    +'<div style="background:'+ink+';color:#fff;border-radius:14px;padding:20px 22px;display:flex;justify-content:space-between;align-items:center;">'
    +'<div><div style="font-size:20px;font-weight:800;letter-spacing:-.01em;">Website Snapshot</div>'
    +'<div style="font-size:12px;opacity:.75;margin-top:3px;">Prepared for '+esc(biz)+(city?(' \u00B7 '+esc(city)):'')+' \u00B7 '+today+'</div></div>'
    +'<div style="font-size:13px;font-weight:700;opacity:.9;text-align:right;">'+esc(agency)+'</div></div>'
    +'<p style="font-size:13px;color:'+soft+';margin:16px 0 0;">We looked at '+esc(biz)+' the way a customer searching Google would \u2014 here\u2019s what we found. '
    +(gapsCount?('<b style="color:'+ink+';">'+gapsCount+' '+(gapsCount===1?'opportunity':'opportunities')+'</b> stood out.'):'Things look strong.')+'</p>'
    +moneyHtml+compHtml+healthHtml
    +'<h3 style="font-size:14px;margin:24px 0 2px;">What we checked</h3>'+checks
    +'<p style="margin-top:22px;font-size:13px;">This is a quick outside-in snapshot \u2014 there\u2019s a fix behind every item above. We\u2019d be glad to walk you through what closing these gaps would do for your calls and leads.</p>'
    +'<p style="font-size:13.5px;font-weight:700;">\u2014 '+esc(agency)+'</p>'
    +'<script>window.print();<\/script></body></html>';
  const w=window.open('','_blank');if(!w){alert('Allow pop-ups to generate the report.');return;}
  w.document.write(html);w.document.close();
}

/* ===== save + team list ===== */
async function saveProspect(){
  if(viewingSaved)return;
  const name=$('clientName').value.trim();if(!name){$('clientName').focus();return;}
  const sc=score();
  const row={client_name:name,domain:$('domain').value.trim().replace(/^https?:\/\//i,'').replace(/^www\./i,'').replace(/\/+$/,'').toLowerCase(),
    city:$('city').value.trim(),service:$('service').value.trim(),
    created_by_email:(function(){const r=$('repName');const v=r?r.value.trim():'';if(v)localStorage.setItem('mrr_rep',v);return v||savedBy(session?.user?.email)||null;})(),
    dr:ah?.dr??null,org_traffic:ah?.org_traffic??null,org_keywords:ah?.org_keywords??null,org_keywords_1_3:ah?.org_keywords_1_3??null,
    live_refdomains:ah?.live_refdomains??null,live_backlinks:ah?.live_backlinks??null,running_ads:adsRunning(),
    site_age:sel.age,mobile:sel.mobile,grade:sc.grade,action:sc.action,pitch:pitchList(sc),partner:partner?partner.slug:null,
    extras:{money:ah?.money??null,competitors:ah?.competitors??null,top_keywords:ah?.top_keywords??null,site:ah?.site??null,
      lighthouse:(lh.status==='done'?lh.scores:null)}};
  const btn=$('saveBtn');btn.disabled=true;btn.textContent='Saving…';
  let {error}=await sb.from('prospects').insert(row);
  if(error&&/extras/.test(error.message||'')){delete row.extras;({error}=await sb.from('prospects').insert(row));}
  btn.disabled=false;
  if(error){btn.textContent='Save failed';console.error(error);setTimeout(()=>btn.textContent='Save to team list',1500);return;}
  btn.textContent='Saved \u2713';
  loadRecent();
  setTimeout(()=>{btn.textContent='Save to team list';resetAudit();},900);
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
  $('service').value=l.service||'';
  const ex=l.extras||{};
  ah={target:l.domain,dr:l.dr,org_traffic:l.org_traffic,org_keywords:l.org_keywords,org_keywords_1_3:l.org_keywords_1_3,
    live_refdomains:l.live_refdomains,live_backlinks:l.live_backlinks,
    paid_keywords:l.running_ads?1:0,paid_pages:null,
    money:ex.money||null,competitors:ex.competitors||null,top_keywords:ex.top_keywords||null,site:ex.site||null};
  Object.assign(sel,{age:l.site_age||'current',mobile:l.mobile||'yes'});auto.age=false;auto.mobile=false;
  lh=ex.lighthouse?{status:'done',scores:ex.lighthouse}:{status:'idle',scores:null};
  $('auditWrap').classList.remove('hidden');
  render();clearStatus();
  const when=l.created_at?new Date(l.created_at).toLocaleDateString():'';
  $('viewBannerText').innerHTML='<b>Viewing saved audit</b> \u2014 '+esc(l.client_name||l.domain)
    +(when?(', saved '+when):'')+(savedBy(l.created_by_email)?(' by '+esc(savedBy(l.created_by_email))):'')
    +'. The email and report below regenerate from this archive.';
  $('viewBanner').classList.remove('hidden');
  $('saveBtn').classList.add('hidden');
  const rn=$('repName');if(rn&&rn.closest('.field'))rn.closest('.field').classList.add('hidden');
  $('auditWrap').scrollIntoView({behavior:'smooth',block:'start'});
}
function resetAudit(){
  exitViewMode();
  ['clientName','domain','city','service'].forEach(id=>{const el=$(id);if(el)el.value='';});
  const es=$('emailSub'),eb=$('emailBody');if(es)es.value='';if(eb)eb.value='';
  ah=null;lh={status:'idle',scores:null};lhToken++;
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
  $('saveBtn').addEventListener('click',saveProspect);
  $('search').addEventListener('input',renderRecent);
  $('refreshBtn').addEventListener('click',loadRecent);
  $('exportBtn').addEventListener('click',exportXlsx);
  $('signinBtn').addEventListener('click',signIn);
  $('useEmail').addEventListener('click',()=>{emailMode=true;updateGateMode();$('email').focus();});
  $('password').addEventListener('keydown',e=>{if(e.key==='Enter')signIn();});
  $('newAuditBtn').addEventListener('click',resetAudit);
  $('signoutBtn').addEventListener('click',async()=>{await sb.auth.signOut();session=null;showGate();});
}

/* ===== init ===== */
(async function(){
  if(!initClient())return;
  wire();
  const bt=$('buildTag');if(bt)bt.textContent='Build v21';
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
})();
