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
const S_IDS=['drWeak','trafficWeak','top3Weak','agency'];
function settings(){const o={};S_IDS.forEach(id=>{const el=$('t_'+id);o[id]=el.type==='number'?(parseFloat(el.value)||0):el.value;});return o;}
function saveSettings(){const o={};S_IDS.forEach(id=>o[id]=$('t_'+id).value);try{localStorage.setItem('aa_settings',JSON.stringify(o));}catch(e){}}
function loadSettings(){try{const o=JSON.parse(localStorage.getItem('aa_settings')||'{}');S_IDS.forEach(id=>{if(o[id]!=null&&o[id]!=='')$('t_'+id).value=o[id];});}catch(e){}}

/* ===== state ===== */
let ah=null;            // audit payload from the edge function
let session=null;
let skipDupCheck=false; // set by the "Audit anyway" button
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
  paid:'Whether they\u2019re currently running Google Ads. If yes, they\u2019re paying for clicks — a strong budget signal and a fit for dedicated landing pages.',
  money:'The search every month that should be bringing them customers. We check how many people search it and whether their site shows up at all.',
  competitors:'The businesses winning the Google traffic in their space — directories like Yelp are filtered out so these are real rivals.',
  rankedfor:'Searches where their site already appears, and at what position. Positions 4–20 are "almost there" — quick wins to pitch.'
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
function adsRunning(){return ah && ((ah.paid_keywords||0)>0 || (ah.paid_pages||0)>0);}
function moneyMiss(){return !!(ah&&ah.money&&ah.money.volume!=null&&ah.money.volume>0&&ah.money.best_position==null);}
function seoWeak(){if(!ah)return false;const s=settings();const dr=ah.dr,tr=ah.org_traffic,t3=ah.org_keywords_1_3;
  return (dr!=null&&dr<s.drWeak)||(tr!=null&&tr<s.trafficWeak)||(t3!=null&&t3<s.top3Weak)||moneyMiss();}
function siteWeak(){return sel.age!=='current'||sel.mobile!=='yes';}
function score(){const weak=[];if(siteWeak())weak.push('site');if(seoWeak())weak.push('seo');
  let grade,action;
  if(weak.length===0){grade='C';action='Low priority';}
  else if(weak.length===2){grade='A';action='Contact immediately';}
  else{grade='B';action='Secondary priority';}
  return{grade,action,weak};}
function gapLabels(ids){const m={site:'outdated website',seo:'weak SEO'};return ids.map(i=>m[i]);}
function pitchList(s){const out=[];if(s.weak.includes('site'))out.push('New website');if(s.weak.includes('seo'))out.push('SEO');if(adsRunning())out.push('Targeted landing pages');return out;}
function reasonText(s){const gaps=gapLabels(s.weak);const ads=adsRunning()?' They\u2019re already running Google Ads, so there\u2019s budget to work with.':'';
  const miss=moneyMiss()?' They\u2019re invisible for their money search — the clearest proof point you have.':'';
  if(s.grade==='A')return 'Both gaps present: <b>'+gaps.join(' and ')+'</b>. Clear opportunity — top priority.'+miss+ads;
  if(s.grade==='C')return 'Website and SEO both look solid. Little to sell — deprioritize.'+ads;
  return 'Opportunity: <b>'+gaps.join(', ')+'</b>. Solid prospect worth pursuing.'+miss+ads;}

/* ===== render ===== */
function metricCard(k,main,sub,tagLabel,tagCls,tipKey){
  const tip=tipKey?METRIC_TIPS[tipKey]:'';
  const info=tip?'<span class="info" tabindex="0" role="button" aria-label="About '+k+'"><span class="tipbubble">'+tip+'</span>i</span>':'';
  const subhtml=sub?' <small>'+sub+'</small>':'';
  const tag=tagLabel?'<div class="tag '+tagCls+'">'+tagLabel+'</div>':'';
  return '<div class="metric"><div class="k">'+k+info+'</div><div class="v">'+main+subhtml+'</div>'+tag+'</div>';
}
function infoIcon(key,label){return '<span class="info" tabindex="0" role="button" aria-label="About '+label+'"><span class="tipbubble">'+METRIC_TIPS[key]+'</span>i</span>';}

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
  $('compBody').innerHTML=ah.competitors.map(c=>
    '<div class="comp-row"><div class="comp-dom">'+esc(c.domain)+'</div>'
    +'<div class="comp-meta">'+fmt(c.traffic)+' visits/mo \u00B7 authority '+(c.dr!=null?Math.round(c.dr):'—')+'</div></div>'
  ).join('');
}
function renderRankedFor(){
  const box=$('rankedBox');
  const rows=(ah&&ah.top_keywords||[]).filter(k=>k.volume!=null&&k.volume>0);
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
     +metricCard('Paid search',(ads?'Running ads':'None'),(ads&&ah.paid_pages?(ah.paid_pages+' '+(ah.paid_pages===1?'page':'pages')):''),(ads?'Budget signal':''),'ads','paid');
    renderMoney();renderCompetitors();renderRankedFor();
  }
  const sectionsEl=$('sections');
  sectionsEl.querySelectorAll('.bands').forEach(g=>g.querySelectorAll('button').forEach(b=>{const on=sel[g.dataset.item]===b.dataset.v;b.className=on?('on '+b.dataset.zone):'';}));
  const an=$('auto_site');if(an)an.textContent=(auto.age||auto.mobile)?'\u00B7 pre-filled from their homepage':'';
  const sw=siteWeak();const b=$('badge_site');if(b){b.textContent=sw?'Weak':'Strong';b.className='badge '+(sw?'weak':'strong');}
  const sc=score();const stamp=$('stamp');stamp.className='stamp '+sc.grade;
  $('grade').textContent=sc.grade;$('action').textContent=sc.action;$('reason').innerHTML=reasonText(sc);
  const pl=pitchList(sc);$('pitchList').innerHTML=pl.length?pl.map(x=>'<span class="pitch-pill">'+x+'</span>').join(''):'<span class="pitch-pill none">Nothing obvious — low priority</span>';
}

/* ===== run audit ===== */
function setStatus(cls,html){const el=$('status');el.className='status show '+cls;el.innerHTML=html;}
function clearStatus(){$('status').className='status';}
function moneyTerm(){const city=$('city').value.trim(),service=$('service').value.trim();
  return (service&&city)?(service+' '+city).toLowerCase():'';}

async function checkDuplicate(domain){
  const clean=domain.replace(/^https?:\/\//i,'').replace(/^www\./i,'').replace(/\/+$/,'').toLowerCase();
  const {data}=await sb.from('prospects').select('id,client_name,grade,created_at,created_by_email')
    .or('domain.eq.'+clean+',domain.eq.www.'+clean).order('created_at',{ascending:false}).limit(1);
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
          +(dup.created_by_email?(' by '+esc(dup.created_by_email)):'')
          +' — it\u2019s in the team list below. <button class="ghost" id="auditAnyway" style="margin-left:8px;">Audit anyway</button>');
        $('auditAnyway').addEventListener('click',()=>{skipDupCheck=true;clearStatus();runAudit();});
        btn.disabled=false;return;
      }
    }
    skipDupCheck=false;
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
    $('auditWrap').classList.remove('hidden');
    render();clearStatus();
    $('auditWrap').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(err){setStatus('error','Audit failed: '+esc(err.message));}
  finally{btn.disabled=false;}
}

/* ===== email ===== */
function findingPhrases(){const out=[];
  if(moneyMiss())out.push('doesn\u2019t show up at all when people search \u201C'+ah.money.keyword+'\u201D — and about '+fmt(ah.money.volume)+' people run that search every month');
  else if(seoWeak())out.push('ranks for very few of the searches your customers actually use');
  if(sel.age==='dated')out.push('looks like it hasn\u2019t been refreshed in a few years');else if(sel.age==='aging')out.push('is starting to show its age next to competitors');
  if(sel.mobile==='no')out.push('is tough to use on a phone, where most local customers search');else if(sel.mobile==='partly')out.push('doesn\u2019t quite hold up on a phone');
  return out;}
function buildEmail(){const biz=$('clientName').value.trim()||'your business';const agency=settings().agency||'[Your name]';const f=findingPhrases();
  $('emailSub').value='Quick question about '+biz+'\u2019s website';let body;
  const comp=(ah&&ah.competitors&&ah.competitors[0])?ah.competitors[0].domain:null;
  if(f.length===0){body='Hi there,\n\nI took a close look at '+biz+' online and your presence is in good shape overall. If you ever want to grow leads from your site or Google, I\u2019d be glad to share a few ideas.\n\nBest,\n'+agency;}
  else{const lead=f.length>=2?('your website '+f[0]+', and it '+f[1]):('your website '+f[0]);
    const compLine=comp?(' Meanwhile, '+comp+' is picking up that traffic.'):' I found a couple of other quick opportunities too.';
    body='Hi there,\n\nI ran a quick audit on '+biz+' and noticed a few things that may be costing you leads — for example, '+lead+'.'+compLine+'\n\nWould you be open to a short call where I walk you through what I found? No hard pitch — I just want to show you where the gaps are.\n\nBest,\n'+agency;}
  $('emailBody').value=body;}

/* ===== client-facing report ===== */
function buildReport(){
  if(!ah)return;
  const sc=score();const agency=settings().agency||'Your Agency';
  const biz=$('clientName').value.trim()||ah.target;const city=$('city').value.trim();
  const m=ah.money;const comp=ah.competitors||[];
  const today=new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  const gap=(label,bad,note)=>'<tr><td style="padding:9px 0;border-bottom:1px solid #E7EAEF;font-weight:600;">'+label
    +'</td><td style="padding:9px 0;border-bottom:1px solid #E7EAEF;text-align:right;color:'+(bad?'#BC4338':'#13795A')+';font-weight:700;">'
    +(bad?'Needs attention':'Looks good')+'</td></tr>'
    +(note?'<tr><td colspan="2" style="padding:2px 0 10px;color:#5C6779;font-size:12.5px;border-bottom:1px solid #E7EAEF;">'+note+'</td></tr>':'');
  let notes='';
  notes+=gap('Showing up on Google',seoWeak(),
    m&&m.volume!=null&&m.best_position==null
      ?('About '+fmt(m.volume)+' people search \u201C'+esc(m.keyword)+'\u201D every month. Your site doesn\u2019t appear in those results.')
      :(seoWeak()?'Your site appears for very few of the searches customers in your area use.':''));
  notes+=gap('Website freshness',sel.age!=='current',sel.age!=='current'?'The site\u2019s design and content appear to be several years old, which affects both trust and Google ranking.':'');
  notes+=gap('Works well on phones',sel.mobile!=='yes',sel.mobile!=='yes'?'Most local customers search on a phone. Your site has issues on mobile screens.':'');
  const compHtml=comp.length?('<h3 style="font-family:Georgia,serif;font-size:15px;margin:22px 0 6px;">Who\u2019s getting the traffic instead</h3>'
    +comp.map(c=>'<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #E7EAEF;font-size:13.5px;"><span>'+esc(c.domain)+'</span><span style="color:#5C6779;">'+fmt(c.traffic)+' visits/mo</span></div>').join('')):'';
  const html='<!DOCTYPE html><html><head><meta charset="utf-8"><title>Website snapshot — '+esc(biz)+'</title></head>'
    +'<body style="font-family:Helvetica,Arial,sans-serif;color:#18212F;max-width:640px;margin:40px auto;padding:0 24px;line-height:1.5;">'
    +'<div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:3px solid #18212F;padding-bottom:12px;">'
    +'<div style="font-size:21px;font-weight:700;">Website snapshot</div><div style="color:#5C6779;font-size:13px;">'+esc(agency)+'</div></div>'
    +'<p style="color:#5C6779;font-size:13px;margin:10px 0 26px;">Prepared for <b style="color:#18212F;">'+esc(biz)+'</b>'+(city?(' \u00B7 '+esc(city)):'')+' \u00B7 '+today+'</p>'
    +'<table style="width:100%;border-collapse:collapse;font-size:14px;">'+notes+'</table>'
    +compHtml
    +'<p style="margin-top:28px;font-size:13.5px;">This is a quick outside-in snapshot — there\u2019s more detail behind each item. We\u2019d be glad to walk you through it and what fixing it would do for your phone calls and leads.</p>'
    +'<p style="font-size:13.5px;font-weight:600;">— '+esc(agency)+'</p>'
    +'<script>window.print();<\/script></body></html>';
  const w=window.open('','_blank');if(!w){alert('Allow pop-ups to generate the report.');return;}
  w.document.write(html);w.document.close();
}

/* ===== save + team list ===== */
async function saveProspect(){
  const name=$('clientName').value.trim();if(!name){$('clientName').focus();return;}
  const sc=score();
  const row={client_name:name,domain:$('domain').value.trim().replace(/^https?:\/\//i,'').replace(/^www\./i,'').replace(/\/+$/,'').toLowerCase(),
    city:$('city').value.trim(),service:$('service').value.trim(),
    created_by_email:session?.user?.email||null,
    dr:ah?.dr??null,org_traffic:ah?.org_traffic??null,org_keywords:ah?.org_keywords??null,org_keywords_1_3:ah?.org_keywords_1_3??null,
    live_refdomains:ah?.live_refdomains??null,live_backlinks:ah?.live_backlinks??null,running_ads:adsRunning(),
    site_age:sel.age,mobile:sel.mobile,grade:sc.grade,action:sc.action,pitch:pitchList(sc),
    extras:{money:ah?.money??null,competitors:ah?.competitors??null,top_keywords:ah?.top_keywords??null,site:ah?.site??null}};
  const btn=$('saveBtn');btn.disabled=true;btn.textContent='Saving…';
  let {error}=await sb.from('prospects').insert(row);
  if(error&&/extras/.test(error.message||'')){delete row.extras;({error}=await sb.from('prospects').insert(row));}
  btn.disabled=false;
  if(error){btn.textContent='Save failed';console.error(error);setTimeout(()=>btn.textContent='Save to team list',1500);return;}
  btn.textContent='Saved \u2713';setTimeout(()=>btn.textContent='Save to team list',1200);
  loadRecent();
}

let recent=[];const ORDER={A:0,B:1,C:2};
async function loadRecent(){
  const {data,error}=await sb.from('prospects').select('*').order('created_at',{ascending:false}).limit(200);
  if(error){console.error(error);return;}
  recent=data||[];renderRecent();
}
function renderRecent(){
  const list=[...recent].sort((a,b)=>(ORDER[a.grade]??9)-(ORDER[b.grade]??9)||new Date(b.created_at)-new Date(a.created_at));
  const q=$('search').value.trim().toLowerCase();
  const view=list.filter(l=>!q||((l.client_name||'')+' '+(l.city||'')+' '+(l.service||'')).toLowerCase().includes(q));
  const rows=$('savedRows');rows.innerHTML='';
  $('savedEmpty').style.display=recent.length?'none':'block';
  view.forEach(l=>{
    const tr=document.createElement('tr');
    const miss=l.extras&&l.extras.money&&l.extras.money.volume&&l.extras.money.best_position==null;
    const mini='Auth '+(l.dr??'—')+' \u00B7 '+fmt(l.org_traffic)+'/mo'+(miss?' \u00B7 invisible for money search':'');
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
  const list=[...recent].sort((a,b)=>(ORDER[a.grade]??9)-(ORDER[b.grade]??9));
  const head=['Client','Website','City','Service','Grade','Action','Authority','Traffic','Keywords','Top 3','Referring domains','Backlinks','Paid search','Money search','Searches/mo','Their rank','Pitch','Saved by','Saved at'];
  const rows=list.map(l=>{const m=(l.extras&&l.extras.money)||{};
    return [l.client_name||'',l.domain||'',l.city||'',l.service||'',l.grade||'',l.action||'',l.dr??'',l.org_traffic??'',l.org_keywords??'',l.org_keywords_1_3??'',l.live_refdomains??'',l.live_backlinks??'',l.running_ads?'Running ads':'None',
      m.keyword||'',m.volume??'',(m.volume!=null?(m.best_position!=null?('#'+m.best_position):'Not found'):''),
      (l.pitch||[]).join('; '),l.created_by_email||'',l.created_at||''];});
  const aoa=[['Prospect List'],[],head,...rows];
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols']=[{wch:24},{wch:24},{wch:14},{wch:12},{wch:7},{wch:18},{wch:10},{wch:10},{wch:10},{wch:8},{wch:17},{wch:10},{wch:12},{wch:22},{wch:11},{wch:10},{wch:30},{wch:24},{wch:22}];
  ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:head.length-1}}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Prospect List');
  XLSX.writeFile(wb,'prospect-list.xlsx');
}

/* ===== auth ===== */
function showApp(){$('authGate').classList.add('hidden');$('app').classList.remove('hidden');$('userEmail').textContent=session?.user?.email||'';}
function showGate(msg){$('app').classList.add('hidden');$('authGate').classList.remove('hidden');if(msg){const m=$('authMsg');m.className='authmsg err';m.textContent=msg;}}
async function signIn(){
  const email=$('email').value.trim(),password=$('password').value;
  const m=$('authMsg');m.className='authmsg';m.textContent='Signing in…';
  const {data,error}=await sb.auth.signInWithPassword({email,password});
  if(error){m.className='authmsg err';m.textContent=error.message;return;}
  session=data.session;onSignedIn();
}
async function onSignedIn(){showApp();loadSettings();await loadRecent();}

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
  $('password').addEventListener('keydown',e=>{if(e.key==='Enter')signIn();});
  $('signoutBtn').addEventListener('click',async()=>{await sb.auth.signOut();session=null;showGate();});
}

/* ===== init ===== */
(async function(){
  if(!initClient())return;
  wire();
  const {data}=await sb.auth.getSession();
  session=data.session;
  if(session)onSignedIn(); else showGate();
})();
