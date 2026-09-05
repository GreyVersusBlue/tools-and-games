// Hearth — the chronicle panel, pack/unpack and the migration ladder — the whole island in the address bar (save v16, back to v5).
// Classic scripts sharing one global scope; the load order in index.html is the old single file’s order and it matters.
// ---------- the chronicle ----------
const chronEl=document.getElementById('chron'),rollEl=document.getElementById('chron-roll');
function showChron(v){chronEl.hidden=!v;document.getElementById('b-chron').classList.toggle('on',!!v);if(v){if(innerWidth<=520)showCard(null);renderChron()}}
// A song's story is a chron entry, held by index, so the panel and the saga both need chron-index -> song. Rebuilt on every render:
// a song can be made, or lost, between two of them, and a stale map would keep singing a tune nobody has.
const songAt=()=>{const m=new Map();for(const s of songs)m.set(s.ci,s);return m};
const carriers=sg=>sg.kn.filter(n=>people.some(p=>p.name===n));
function songLine(sg){const kn=carriers(sg);
  if(sg.lost)return `the song of it is lost — ${sg.comp} made the tune and nobody left can find it`;
  return `made into a song by ${sg.comp} · carried by ${kn.length?kn.join(', '):'nobody now'}`}
function renderChron(){let h='',cy=0;const SG=songAt();
  chron.forEach((e,i)=>{if(e.y!==cy){cy=e.y;const yn=yearName(cy);h+=`<h4>year ${cy}${yn?` <span>${yn}</span>`:''}</h4>`}
    const sg=SG.get(i),cls=[e.gr?'gr':'',sg?(sg.lost?'sg lost':'sg'):''].filter(Boolean).join(' ');
    h+=`<p${cls?` class="${cls}"`:''}><i>day ${e.d}</i>${e.st||e.label}${e.gr?' <em class="tl">— as it is told now</em>':''}`+
      (sg?`<em class="sgl">${songLine(sg)}</em>`:'')+'</p>'});
  rollEl.innerHTML=h||'<p>Nothing has happened yet that anyone will remember.</p>';
  document.getElementById('chron-t').firstChild.textContent=village?`The Chronicle of ${village}`:'The Chronicle';
  document.getElementById('chron-s').textContent=`island ${seed.toString(36)} · year ${yearOf(dayCount)}, day ${dayCount}`+(hasWay(3)?' · written in the book of days':'');
  document.getElementById('chron-n').textContent=chron.length===1?'one thing remembered':`${chron.length} things remembered`;
  rollEl.scrollTop=rollEl.scrollHeight}
// The .txt is 14 lines and somebody will want it. It stays what it was; only the download plumbing is shared with the saga now.
function exportChron(){const L=[`The chronicle of ${village||'an island with no name'}`,`island ${seed.toString(36)}`,''];let cy=0;
  for(const e of chron){if(e.y!==cy){cy=e.y;const yn=yearName(cy);L.push('',`YEAR ${cy}${yn?' — '+yn:''}`,'')}L.push(`  day ${String(e.d).padStart(4)}   ${(e.st||e.label).replace(/<[^>]+>/g,'')}${e.gr?' (as it is told now)':''}`)}
  L.push('','',`It is year ${yearOf(dayCount)}, day ${dayCount}. There are ${people.length} people here, ${houses.length} houses, and ${graves.length} stones on the hill.`);
  dlFile(L.join('\n'),'text/plain','-chronicle.txt')}
function dlFile(body,type,suffix){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([body],{type}));
  a.download=(village||'island-'+seed.toString(36)).toLowerCase()+suffix;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
// ---------- the saga: the chronicle as a page, not a dump ----------
// One self-contained HTML file, zero dependencies, opens out of a download folder. Everything in it is already in state or derived
// from it, so the save does not change. The chron labels carry <b>Name</b> and nothing else, so the escape keeps that one tag,
// takes every other tag to text, and escapes what is left.
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const sagaText=s=>String(s).split(/(<\/?b>)/).map(t=>t==='<b>'||t==='</b>'?t:esc(t.replace(/<[^>]+>/g,''))).join('');
const plural=(n,one,many)=>`${n} ${n===1?one:many}`;
// Where the saga's link points. On http(s) it is this page, so a saga exported from a fork or a preview channel comes back to the
// build it came out of; from file:// there is no shareable path to use, so it is the live site (locked decision #62).
const SITE='https://greyversusblue.com/Projects/hearth/';
function islandLink(){let h;try{h=islandHash()}catch(err){return null}
  const p=location.protocol;return((p==='http:'||p==='https:')?location.href.split('#')[0]:SITE)+'#'+h}
// And where the island over the water is. It is a seed, not a save, because nothing over there has ever been simulated — the link
// opens a fresh island at that seed, which has this one on *its* horizon by the same rule. Same protocol reasoning as islandLink.
function farLink(){if(!farRec)return null;
  const p=location.protocol;return((p==='http:'||p==='https:')?location.href.split('#')[0]:SITE)+'#s='+farRec.s.toString(36)}
const SAGA_CSS=`:root{--ink:#e8dcc4;--dim:#9a8b6d;--gold:#f0b35a;--line:#3a3020}
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0b0d12;color:var(--ink);font:16px/1.6 Georgia,'Iowan Old Style',serif;padding:40px 20px 80px}
main,header,footer,.app{max-width:38em;margin:0 auto}
h1{font-size:22px;font-weight:normal;letter-spacing:.14em;text-transform:uppercase;color:var(--gold)}
header .sub,header .link{font-size:13px;color:var(--dim);font-style:italic;margin-top:6px}
header .link a{color:var(--gold)}
header{border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:10px}
h2{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);font-weight:normal;margin:34px 0 8px;border-bottom:1px solid var(--line);padding-bottom:4px}
h2 span{text-transform:none;letter-spacing:.04em;font-style:italic;color:var(--dim);font-size:13px}
main p{padding-left:64px;text-indent:-64px;margin-bottom:8px}
main p .d{color:var(--dim);font-size:12px;font-style:italic;display:inline-block;width:64px;text-indent:0}
main p b{font-weight:normal;color:#fff2d8}
main p em{font-style:italic;color:var(--dim);font-size:13px}
main p.gr{border-left:2px solid var(--line);margin-left:-12px;padding-left:74px}
main p.sg em.s{display:block;text-indent:0;color:var(--gold);opacity:.8;font-size:13px}
main p.sg.lost em.s{color:var(--dim);opacity:1}
.app ul{list-style:none}
.app li{margin-bottom:7px;font-size:14px;padding-left:16px;text-indent:-16px}
.app li b{font-weight:normal;color:#fff2d8}
.app li i{font-style:italic;color:var(--dim)}
.app li .h{display:block;padding-left:16px;text-indent:0;color:var(--dim);font-size:13px;font-style:italic}
.app .sub{font-size:13px;color:var(--dim);margin-top:8px}
footer{margin-top:44px;padding-top:14px;border-top:1px solid var(--line);font-size:12px;color:var(--dim);font-style:italic}
@media print{:root{--ink:#20180e;--dim:#6a5c46;--gold:#6a4a12;--line:#c9bda4}
 body{background:#fff;color:#20180e;padding:0}
 h1,h2,header .link a{color:#3a2a10}
 main p b,.app li b{color:#20180e}
 main p.sg em.s{color:#6a4a12}}`;
// The saga itself: the years the island has finished, and then five appendices of things it already knows.
function sagaHTML(){const SG=songAt(),link=islandLink(),T=`The chronicle of ${village||'an island with no name'}`,L=[];
  L.push('<!DOCTYPE html>','<html lang="en">','<head>','<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',`<title>${esc(T)}</title>`,
    `<style>${SAGA_CSS}</style>`,'</head>','<body>','<header>',`<h1>${esc(T)}</h1>`,
    `<p class="sub">island ${seed.toString(36)} · year ${yearOf(dayCount)}, day ${dayCount} · `+
      `${plural(people.length,'person','people')}, ${plural(houses.length,'house','houses')}, ${plural(graves.length,'stone','stones')} on the hill</p>`,
    link?`<p class="link"><a href="${esc(link)}">Open the island as it stood when this was written</a></p>`:
      '<p class="link">This island would not fit in a link.</p>','</header>','<main>');
  let cy=0,inYr=false;
  chron.forEach((e,i)=>{if(e.y!==cy){cy=e.y;if(inYr)L.push('</section>');const yn=yearName(cy);
      L.push(`<section class="yr"><h2>year ${cy}${yn?` <span>${esc(yn)}</span>`:''}</h2>`);inYr=true}
    const sg=SG.get(i),cls=['e',e.gr?'gr':'',sg?(sg.lost?'sg lost':'sg'):''].filter(Boolean).join(' ');
    L.push(`<p class="${cls}"><span class="d">day ${e.d}</span>${sagaText(e.st||e.label)}`+
      (e.gr?' <em class="tl">as it is told now</em>':'')+(sg?`<em class="s">${esc(songLine(sg))}</em>`:'')+'</p>')});
  if(inYr)L.push('</section>');else L.push('<p>Nothing has happened yet that anyone will remember.</p>');
  L.push('</main>');
  // one: the people, oldest first, with what the island calls them
  L.push('<section class="app" id="app-people"><h2>The people</h2><ul>');
  for(const p of people.slice().sort((a,b)=>ageOf(b)-ageOf(a))){
    const bits=[String(ageI(p)),isKid(p)?'a child':isElder(p)?'an elder':'grown'];
    if(p.craft>=0&&p.cxp>=1)bits.push(CRAFT_EPITHET[p.craft]);
    if(p.tr&&p.tr.length)bits.push(p.tr.join(', '));
    L.push(`<li><b>${esc(p.name)}</b> <i>${esc(bits.join(' · '))}</i></li>`)}
  L.push('</ul>');
  if(gone.length)L.push(`<p class="sub">Away over the water: ${esc(gone.map(p=>p.name).join(', '))}.</p>`);
  L.push('</section>');
  // two: the hill, and what has been left on it
  L.push('<section class="app" id="app-hill"><h2>The hill</h2>');
  if(!graves.length)L.push('<p class="sub">Nobody is under the hill yet.</p>');
  else{L.push('<ul>');
    for(const g of graves.slice().sort((a,b)=>a.d-b.d)){const v=g.vn||0;
      L.push(`<li><b>${esc(g.name)}</b> <i>year ${g.y2}, aged ${g.age} · ${v?plural(v,'visit','visits'):'not visited yet'}</i></li>`)}
    L.push('</ul>')}
  L.push('</section>');
  // three: the ground the island has named, and the cairn each name has grown
  const named=spots.filter(s=>s.lore);
  L.push('<section class="app" id="app-ground"><h2>The named ground</h2>');
  if(!named.length)L.push('<p class="sub">No ground has been named yet.</p>');
  else{L.push('<ul>');
    for(const s of named){const n=loreN[s.k]||0;
      L.push(`<li><b>${esc(s.l)}</b> <i>${n?plural(n,'stone on the cairn','stones on the cairn'):'no cairn yet'}</i></li>`)}
    L.push('</ul>')}
  L.push('</section>');
  // four: the things, and every hand each one has been through
  L.push('<section class="app" id="app-things"><h2>The things</h2>');
  if(!things.length)L.push('<p class="sub">Nothing has been made or found that outlasted the making of it.</p>');
  else{L.push('<ul>');
    for(const t of things){L.push(`<li><b>${esc(t.full)}</b> <i>${t.holder?'held by '+esc(t.holder):'on the shelf in the hall'}</i>`);
      for(const h of t.hist)L.push(`<span class="h">day ${h.d} · ${esc(h.s)}</span>`);
      L.push('</li>')}
    L.push('</ul>')}
  L.push('</section>');
  // five: the island over the water, which is a place now, and everything that has crossed either way
  L.push('<section class="app" id="app-far"><h2>Over the water</h2>');
  if(!farRec||!farRec.kn)L.push('<p class="sub">There is an island on the horizon. Nobody here has been to it and come back with a name for it.</p>');
  else{const fl=farLink();
    L.push(`<p class="sub">The island over the water is <b>${esc(farRec.n)}</b> — island ${farRec.s.toString(36)}`+
      (fl?`, <a href="${esc(fl)}">which can be opened from here</a>`:'')+`. This one is on its horizon, the way it is on this one's.</p>`);
    if(farRec.cr.length){L.push('<ul>');
      for(const c of farRec.cr)L.push(`<li><b>day ${c.d}</b> <i>${esc(c.s)}</i></li>`);
      L.push('</ul>')}
    else L.push('<p class="sub">Nothing has crossed yet but the name.</p>')}
  L.push('</section>');
  L.push(`<footer>Written out of ${plural(chron.length,'thing','things')} remembered on island ${seed.toString(36)}, on day ${dayCount}. Hearth.</footer>`,
    '</body>','</html>');
  return L.join('\n')}
function exportSaga(){dlFile(sagaHTML(),'text/html','-saga.html');
  say('The saga is written out: one page, needing nothing, carrying the way back here.',true)}
// ---------- save & load: the whole island, in the address bar ----------
function lzEnc(str){const s=unescape(encodeURIComponent(str)),d=new Map(),codes=[];let n=256,w='';
  for(const c of s){const wc=w+c;if(d.has(wc))w=wc;else{if(w){codes.push(d.has(w)?d.get(w):w.charCodeAt(0));if(n<65536)d.set(wc,n++)}w=c}}
  if(w)codes.push(d.has(w)?d.get(w):w.charCodeAt(0));
  let bits=9,cap=256,buf=0,nb=0,out='';                                   // codes widen from 9 to 16 bits as the dictionary fills
  for(const v of codes){buf=(buf<<bits)|v;nb+=bits;while(nb>=8){nb-=8;out+=String.fromCharCode((buf>>nb)&255)}buf&=(1<<nb)-1;
    cap++;if(cap===(1<<bits)&&bits<16)bits++}
  if(nb>0)out+=String.fromCharCode((buf<<(8-nb))&255);
  const L=codes.length;out=String.fromCharCode((L>>16)&255,(L>>8)&255,L&255)+out;
  return btoa(out).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function lzDec(b64){const b=atob(b64.replace(/-/g,'+').replace(/_/g,'/'));
  const L=(b.charCodeAt(0)<<16)|(b.charCodeAt(1)<<8)|b.charCodeAt(2);if(!L)return '';
  let bits=9,pos=3,buf=0,nb=0;
  const get=()=>{while(nb<bits){buf=(buf<<8)|(pos<b.length?b.charCodeAt(pos++):0);nb+=8}nb-=bits;const v=(buf>>nb)&((1<<bits)-1);buf&=(1<<nb)-1;return v};
  const d=new Map();let n=256,w=String.fromCharCode(get()),out=w;
  for(let i=1;i<L;i++){if(n+1===(1<<bits)&&bits<16)bits++;
    const k=get();let e;if(k<256)e=String.fromCharCode(k);else if(d.has(k))e=d.get(k);else e=w+w[0];
    out+=e;if(n<65536)d.set(n++,w+e[0]);w=e}
  return decodeURIComponent(escape(out))}
const packP=p=>[+p.x.toFixed(2),+p.y.toFixed(2),p.name,p.age0,p.born,p.tr,p.rels.map(r=>[r.who,r.k]),p.hist.map(h=>[h.d,h.s]),p.col,p.hair,houses.indexOf(p.home),p.partner||0,p.parents,p.child?1:0,[p.spot.l,+p.spot.x.toFixed(1),+p.spot.y.toFixed(1)],+p.off.toFixed(2),p.fishRain||0,p.boats||0,p.wantHouse?1:0,p.dreamFar?1:0,p.luck?1:0,p.pend?[p.pend.k,p.pend.who||0,p.pend.gr?p.pend.gr.name:0]:0,p.keeper?1:0,p.craft===undefined?-1:p.craft,+(p.cxp||0).toFixed(2),p.shadN?[p.shadN,p.shadC|0]:0,p.sick?1:0,p.heard?[p.heard.l,p.heard.d,p.heard.f||0]:0,p.fSk===undefined?-1:p.fSk,p.short?1:0,p.sick?p.sickD|0:0,p.wellD|0]; /* v12 adds 27 (news carried) and 28 (inherited skin); v14 adds 29 (eating last, on purpose); v15 adds 30 (the day it was taken) and 31 (the day it was shaken off, which is what proof against it is counted from) */
function pack(){const rd=[];{let v=road[0],n=0;for(let i=0;i<W*H;i++){if(road[i]===v)n++;else{rd.push(v,n);v=road[i];n=1}}rd.push(v,n)}
  return{v:SAVE_V,s:seed,t:+time.toFixed(2),d:dayCount,ly:lastYear,ls:lastSea,w:wood,f:food,g:granary,hu:+hunger.toFixed(3),lp:lorePl,ln:Object.keys(loreN).map(k=>[k,loreN[k]]),by:boundsYr,
    sg:songs.map(s=>[s.ci,s.comp,s.kn,s.lost?1:0,s.d]),sm:snowmen.map(s=>[+s.x.toFixed(1),+s.y.toFixed(1),+s.s.toFixed(2),s.d]),ss:skipN,
    dr:+dry01.toFixed(2),br:breadYr,ry:retYr,wk:works.map(w=>[w.wk,+w.x.toFixed(1),+w.y.toFixed(1),w.y0,w.done?1:0,+(w.prog||0).toFixed(1),w.paid?1:0,w.said?1:0]),
    hl:things.map(t=>[t.n,t.full,t.holder||0,t.src,t.ci===undefined?-1:t.ci,t.hist.map(h=>[h.d,h.s])]),hy:heirYr,
    fa:+faith.toFixed(2),fs:faithSt,py:prayer?[prayer.k,prayer.d,prayer.who||0]:0,ay:ways,ax:arc?[arc.k,arc.d0,arc.end]:0,az:arcYr,aw:wayYr,ab:bookYr,al:lastStormDay,am:rainedDay,an:wreckYr,af:famDone?1:0,wa:want?[want.d0,want.by,want.gave,want.raid,want.rv||0]:0,wy:wantYr,iw:ill?[ill.d0,ill.n,ill.by,ill.nu]:0,fd:feud?[feud.d0,feud.rv[0],feud.rv[1],feud.kept?1:0,feud.n||1]:0,
    wx,wt:+wxT.toFixed(1),sn:+snowD.toFixed(3),fz:frozen?1:0,fo:+fogA.toFixed(2),vn:village||0,rv:roadV,td:traderDay,be:belled,rs:ruinSeen,
    gd:geeseDay,wd:whaleDay,ar:+arrivalT.toFixed(1),sp:speed,wi:wind,sy:storyDay,sk:sackUsed?1:0,
    pe:people.map(packP),de:dead.map(p=>[p.name,p.rels.map(r=>[r.who,r.k])]),go:gone.map(p=>[p.name,p.far?1:0]),
    ho:houses.map(h=>[h.x,h.y,h.r,h.owners]),fm:farms.map(f=>[f.x,f.y,+f.g.toFixed(2)]),
    tr:trees.map(t=>[+t.x.toFixed(2),+t.y.toFixed(2),+t.s.toFixed(2),t.hp,t.b?1:0,+t.a.toFixed(2),t.o?1:0]),
    su:stumps.map(t=>[+t.x.toFixed(1),+t.y.toFixed(1)]),
    bl:bldg.map(b=>[b.kind,b.x,b.y]),bt:bldgTgt?[bldgTgt.kind,bldgTgt.x,bldgTgt.y,+bldgTgt.prog.toFixed(1)]:0,
    gv:graves.map(g=>[+g.x.toFixed(2),+g.y.toFixed(2),g.name,g.d,g.y2,g.age,g.vn||0]),
    sr:springs.map(s=>[+s.x.toFixed(2),+s.y.toFixed(2),+s.r.toFixed(2),+s.ph.toFixed(2)]),
    ch:chron.map(e=>[e.d,e.y,e.kind,e.label,e.st||0,e.tl||0,e.gr?1:0]),ev:events.map(e=>[e.d,e.y,e.kind,e.label]),
    vo:voyage?[voyage.name,voyage.st,voyage.day,voyage.back?1:0,voyage.n||0,voyage.st==='away'?packP(voyage.p):0]:0,
    rb:ruin&&ruin.built?1:0,fl:farIsle&&farIsle.lit?1:0,
    fi:farRec?[farRec.s,farRec.n,farRec.kn?1:0,farRec.cr.map(c=>[c.d,c.k,c.s])]:0,rd}}   /* v13: the island over the water — its seed, the name this one calls it, whether that name has crossed, and what has */
// ---------- the migration ladder ----------
// SAVE_V is the shape pack() writes. SAVE_MIN is the oldest shape the ladder can still bring forward. Both readers — the link in the
// address bar and the autosave at boot — used to carry their own copy of that range, and sprint 12 shipped with one of the two stale;
// canLoad() is the only copy there is now.
const SAVE_V=16, SAVE_MIN=5;
const canLoad=o=>!!(o&&o.v>=SAVE_MIN&&o.v<=SAVE_V&&o.pe);
// One hop per version, in order. `up` takes a save shaped `from` and makes it shaped `to`, filling in exactly what unpack() used to
// synthesize with a `||` at the point of reading; `down` is the same hop walked backwards, and is what the harness's `migrate` mode
// forges its fixtures with. The two halves live next to each other on purpose: six hand-written forgeries scattered across five
// harness modes could not be kept honest, and one of them (v7) had already drifted — it left the sprint-10 keys in.
// A packed person is a positional array of 32 slots; these are the defaults for the slots the ladder has had to add, by index.
const P_DEF={23:-1,24:0,25:0,26:0,27:0,28:-1,29:0,30:0,31:0};
const growP=(o,n)=>{const g=a=>{while(a.length<n)a.push(P_DEF[a.length]===undefined?0:P_DEF[a.length])};
  for(const a of o.pe)g(a);if(o.vo&&o.vo[5])g(o.vo[5])};                 // the one away on a voyage is packed with packP too
const cutP=(o,n)=>{for(const a of o.pe)a.length=n;if(o.vo&&o.vo[5])o.vo[5].length=n};
const V11=['fa','fs','py','ay','ax','az','aw','ab','al','am','an','af']; // faith, the ways, the year's fortune card
const LADDER=[
 {from:5,to:6,up:o=>o,down:o=>o},                                       // no field unpack() has ever read differs between the two
 {from:6,to:7,up:o=>{for(const k of V11)if(o[k]===undefined)o[k]=0;growP(o,27)},
             down:o=>{for(const k of V11)delete o[k];cutP(o,26);o.wk=(o.wk||[]).filter(w=>w[0]!=='shrine')}},
 {from:7,to:8,up:o=>{if(!o.hl)o.hl=[];if(o.hy===undefined)o.hy=0;
             o.wk=(o.wk||[]).map(a=>a.length>=8?a:[a[0],a[1],a[2],a[3],1,99,0,0]);   // v7 only ever recorded the finished ones
             o.ch=(o.ch||[]).map(a=>a.length>=7?a:[a[0],a[1],a[2],a[3],a[4]||0,0,0])},
             down:o=>{delete o.hl;delete o.hy;o.wk=(o.wk||[]).filter(a=>a[4]).map(a=>a.slice(0,4));o.ch=(o.ch||[]).map(a=>a.slice(0,5))}},
 {from:8,to:9,up:o=>{if(!o.lp)o.lp=[]},down:o=>{delete o.lp}},
 {from:9,to:10,up:o=>{if(!o.ln)o.ln=[];if(o.by===undefined)o.by=0},down:o=>{delete o.ln;delete o.by}},
 {from:10,to:11,up:o=>{o.gv=(o.gv||[]).map(a=>a.length>=7?a:a.concat([0]))},down:o=>{o.gv=(o.gv||[]).map(a=>a.slice(0,6))}},
 {from:11,to:12,up:o=>{if(!o.sg)o.sg=[];if(!o.sm)o.sm=[];if(o.ss===undefined)o.ss=0;growP(o,29)},
              down:o=>{delete o.sg;delete o.sm;delete o.ss;cutP(o,27)}},
 {from:12,to:13,up:o=>{if(o.fi===undefined)o.fi=0;o.go=(o.go||[]).map(a=>Array.isArray(a)?a:[a,0])},
              down:o=>{delete o.fi;o.go=(o.go||[]).map(a=>Array.isArray(a)?a[0]:a)}},
 {from:13,to:14,up:o=>{if(o.wa===undefined)o.wa=0;if(o.wy===undefined)o.wy=0;growP(o,30)},
              down:o=>{delete o.wa;delete o.wy;cutP(o,29)}},     /* v14: the short winter, and the one eating last through it */
 {from:14,to:15,up:o=>{if(o.iw===undefined)o.iw=0;growP(o,32)},
              down:o=>{delete o.iw;cutP(o,30)}},                /* v15: the wave of sickness, and each person's own clock inside it */
 {from:15,to:16,up:o=>{if(o.fd===undefined)o.fd=0},down:o=>{delete o.fd}}];   /* v16: the feud — the day, the two names, whether it outlived a thaw, how many nights at the store */
// Up the ladder, one hop at a time, in place. unpack() calls this first and then reads only the current shape, which is why there is
// no `o.v` test left below this line. What a new field costs, in four lines: append the slot or key to pack(); add a hop here, with
// its up and its down; add the version to FIXTURES in test/harness.mjs; bump SAVE_V.
function migrate(o){for(const h of LADDER)if(o.v===h.from){h.up(o);o.v=h.to}return o}
// The same ladder walked backwards, to forge a save of shape v out of a current one. Test-only, and it lives here rather than in the
// harness so a hop cannot be added without its inverse.
function forge(o,v){for(let i=LADDER.length-1;i>=0;i--){const h=LADDER[i];if(o.v===h.to&&h.to>v){h.down(o);o.v=h.from}}return o}
function unpack(o){
  migrate(o);
  newWorld(o.s);
  time=o.t;dayCount=o.d;lastYear=o.ly;lastSea=o.ls;wood=o.w;food=o.f;granary=o.g;hunger=o.hu;
  wx=o.wx;rain=wx==='rain'||wx==='thunder';storm=wx==='thunder';wxT=o.wt;snowD=o.sn;frozen=!!o.fz;fogA=o.fo;
  village=o.vn||null;roadV=o.rv;traderDay=o.td;belled=o.be;ruinSeen=o.rs;geeseDay=o.gd;whaleDay=o.wd;arrivalT=o.ar;speed=o.sp||1;wind=o.wi||1;storyDay=o.sy||0;sackUsed=!!o.sk;
  dry01=o.dr||0;breadYr=o.br||0;retYr=o.ry||0;
  faith=o.fa||0;faithSt=o.fs||0;prayer=o.py?{k:o.py[0],d:o.py[1],who:o.py[2]||null}:null;ways=o.ay||0;
  arc=o.ax?{k:o.ax[0],d0:o.ax[1],end:o.ax[2]}:null;arcYr=o.az||0;wayYr=o.aw||0;bookYr=o.ab||0;lastStormDay=o.al||0;rainedDay=o.am||0;wreckYr=o.an||0;famDone=!!o.af;
  want=o.wa?{d0:o.wa[0],by:o.wa[1],gave:o.wa[2]||0,raid:o.wa[3]||0,rv:o.wa[4]||0}:null;wantYr=o.wy||0;
  ill=o.iw?{d0:o.iw[0],n:o.iw[1]||0,by:o.iw[2],nu:o.iw[3]||0}:null;
  feud=o.fd?{d0:o.fd[0],rv:[o.fd[1],o.fd[2]],kept:o.fd[3]||0,n:o.fd[4]||1}:null;
  houses=o.ho.map(h=>({x:h[0],y:h[1],r:h[2],owners:h[3].slice()}));
  farms=o.fm.map(f=>({x:f[0],y:f[1],g:f[2]}));
  trees=o.tr.map(t=>({x:t[0],y:t[1],s:t[2],hp:t[3],b:!!t[4],a:t[5],o:t[6]||0}));
  stumps=o.su.map(t=>({x:t[0],y:t[1]}));
  graves=o.gv.map(a=>({x:a[0],y:a[1],name:a[2],d:a[3],y2:a[4],age:a[5],vn:a[6]}));
  songs=o.sg.filter(a=>a[0]>=0).map(a=>({ci:a[0],comp:a[1],kn:a[2].slice(),lost:!!a[3],d:a[4]}));
  snowmen=o.sm.map(a=>({x:a[0],y:a[1],s:a[2],d:a[3]}));skipN=o.ss;rbUntil=0;shoots=[];starDay=0;
  springs=o.sr.map(a=>({x:a[0],y:a[1],r:a[2],ph:a[3]}));
  bldg=o.bl.map(a=>({kind:a[0],x:a[1],y:a[2],w:BLD[a[0]].w,h:BLD[a[0]].h,prog:BLD[a[0]].work,work:BLD[a[0]].work,done:true}));
  bldgTgt=o.bt?{kind:o.bt[0],x:o.bt[1],y:o.bt[2],w:BLD[o.bt[0]].w,h:BLD[o.bt[0]].h,prog:o.bt[3],work:BLD[o.bt[0]].work,done:false}:null;
  chron=o.ch.map(a=>({d:a[0],y:a[1],kind:a[2],label:a[3],st:a[4]||null,tl:a[5]||0,gr:!!a[6]}));
  songs=songs.filter(s=>s.ci<chron.length); /* a song's story is its chron entry; an index past the rebuilt chronicle is no song at all */
  things=o.hl.map(a=>({n:a[0],full:a[1],holder:a[2]||0,src:a[3],ci:a[4]>=0?a[4]:undefined,hist:a[5].map(h=>({d:h[0],s:h[1]}))}));heirYr=o.hy;
  events=o.ev.map(a=>({d:a[0],y:a[1],kind:a[2],label:a[3]}));
  for(const s of springs){for(let y=Math.floor(s.y-s.r-1);y<=s.y+s.r+1;y++)for(let x=Math.floor(s.x-s.r-1);x<=s.x+s.r+1;x++){
      if(x<1||y<1||x>=W-1||y>=H-1)continue;if(Math.hypot(x+.5-s.x,(y+.5-s.y)*1.3)>s.r)continue;if(at(x,y)!==GRASS)continue;
      tiles[idx(x,y)]=WATER;elev[idx(x,y)]=.19}
    spots.push({l:'the spring',x:s.x,y:s.y+1.6})}
  for(const f of farms)tiles[idx(f.x,f.y)]=FARM;
  road=new Uint8Array(W*H);{let i=0;for(let k=0;k+1<o.rd.length;k+=2){const v=o.rd[k],n=o.rd[k+1];for(let j=0;j<n&&i<W*H;j++)road[i++]=v}}
  const mk=a=>{const p={x:a[0],y:a[1],name:a[2],age0:a[3],born:a[4],tr:a[5],rels:a[6].map(r=>({who:r[0],k:r[1]})),hist:a[7].map(h=>({d:h[0],s:h[1]})),
      col:a[8],hair:a[9],home:a[10]>=0?houses[a[10]]:null,partner:a[11]||null,parents:a[12]||[],alive:true,dead:false,
      spot:{l:a[14][0],x:a[14][1],y:a[14][2]},off:a[15],fishRain:a[16]||0,boats:a[17]||0,
      task:'idle',t:rnd(.5,2),tx:a[0],ty:a[1],carry:0,seed:hash(a[2])^seed,visits:0};
    if(a[13])p.child=true;if(a[18])p.wantHouse=true;if(a[19])p.dreamFar=1;if(a[20])p.luck=1;
    if(a[21])p.pend={k:a[21][0],who:a[21][1]||null,gr:a[21][2]?graves.find(g=>g.name===a[21][2]):null};if(a[22])p.keeper=1;
    p.craft=a[23];p.cxp=a[24];if(a[25]){p.shadN=a[25][0];p.shadC=a[25][1]}if(a[26])p.sick=1;
    if(a[27])p.heard={l:a[27][0],d:a[27][1],f:a[27][2]||0};if(a[28]>=0)p.fSk=a[28];if(a[29])p.short=1;
    if(a[30])p.sickD=a[30];if(a[31])p.wellD=a[31];return p};
  names=new Set();people=o.pe.map(mk);people.forEach(p=>names.add(p.name));
  // repair, not migrate (#37): every load, not only an old one. A v14 save can carry somebody sick with no wave to belong to and no
  // day to count from, and so can a v15 one written before the wave existed on that island — give them today, so the caps that end
  // an illness have something to measure. A wave with nobody in it is no wave.
  {const sk=people.filter(p=>p.sick&&!p.dead);
    for(const p of sk)if(!p.sickD)p.sickD=dayCount;
    if(sk.length&&!ill)ill={d0:dayCount,n:sk.length,by:sk[0].name,nu:0};
    if(!sk.length)ill=null}
  // and the feud, the same way: a pair with one of them not on the island is no feud, and the pair that is here had better be rivals
  // both ways whatever else the save says, because that is what the daily checks hold it to
  if(feud){const a=byName(feud.rv[0]),b=byName(feud.rv[1]);if(!a||!b||a===b)feud=null;
    else for(const [x,y] of [[a,b],[b,a]]){const r=x.rels.find(r2=>r2.who===y.name);if(r)r.k='rival';else x.rels.push({who:y.name,k:'rival'})}}
  dead=o.de.map(a=>({name:a[0],rels:a[1].map(r=>({who:r[0],k:r[1]})),dead:true,hist:[],tr:[]}));
  gone=o.go.map(a=>({name:a[0],far:a[1]||0}));
  voyage=o.vo?{name:o.vo[0],st:o.vo[1],day:o.vo[2],back:!!o.vo[3],n:o.vo[4],p:o.vo[5]?mk(o.vo[5]):byName(o.vo[0])}:null;
  if(voyage&&!voyage.p)voyage=null;
  if(voyage&&voyage.st==='going')voyage.p.task='voyage';
  if(ruin&&o.rb)ruin.built=true;
  if(farIsle)farIsle.lit=!!o.fl;
  // newWorld() has already re-derived the far island's record from the seed; the save carries the parts of it the island has lived
  // through — the name it settled on, whether that name has crossed yet, and the crossings. A save with no fi reads as a horizon
  // nobody has a name for, which is exactly what it was.
  if(farRec&&o.fi)farRec={s:o.fi[0],n:o.fi[1],kn:o.fi[2]?1:0,cr:(o.fi[3]||[]).map(a=>({d:a[0],k:a[1],s:a[2]}))};
  for(const b of bldg){if(b.kind==='market')spots.push({l:'the market',x:b.x+1.5,y:b.y+1.5});
    else if(b.kind==='well')spots.push({l:'the well',x:b.x+.5,y:b.y+.8});
    else if(b.kind==='light')spots.push({l:'the lighthouse',x:b.x+.5,y:b.y+.8});
    else if(b.kind==='bridge'){spots.push({l:'the bridge',x:b.x+.5,y:b.y+.5});bridgeUp=true}}
  works=o.wk.map(a=>({wk:a[0],x:a[1],y:a[2],y0:a[3],done:!!a[4],prog:a[5]||0,paid:a[6]?1:0,said:a[7]?1:0}));
  for(const w of works)if(w.done)applyWork(w);
  // the named places come back from the list of kinds alone: at() reads the rebuilt world, so no coordinates need saving (v9)
  lorePl=o.lp.filter(k=>LORE_PLACE[k]);walkP=null;
  for(const k of lorePl){const D=LORE_PLACE[k],pos=D.at();if(pos&&!spots.some(sp=>sp.l===D.l))spots.push({l:D.l,x:pos.x,y:pos.y,lore:1,k})}
  loreN={};for(const a of o.ln)if(LORE_PLACE[a[0]])loreN[a[0]]=a[1];
  boundsYr=o.by;boundsP=null;
  heat=new Float32Array(W*H);boats=[];fx=[];skips=[];gusts=[];fires=houses.length?[{x:center.x,y:center.y,t:0}]:[];
  saidToday=new Set();usedTpl=new Map();
  paintedKey='';paintTerrain();spawnWildlife();clouds=[];for(let i=0;i<2;i++)addCloud(false);
  selected=null;showCard(null);document.getElementById('log').innerHTML='';
  document.getElementById('seedlbl').textContent=(village?village+' · ':'')+'island '+seed.toString(36);
  say(`The island is as it was left. ${village?village+', year':'Year'} ${yearOf(dayCount)}, day ${dayCount}: ${people.length} people, ${houses.length} ${houses.length===1?'house':'houses'}, ${graves.length} ${graves.length===1?'stone':'stones'} on the hill.`,true)}
function loadHash(){const h=(location.hash||'').replace(/^#/,'');
  // Phase 5: a short `#s=<seed in base 36>` opens a fresh island at that seed, and it is the only way the far island is reachable —
  // the record on the horizon holds a seed, not a save, because nothing over there has been simulated. Checked before the length
  // gate, since a seed link is far shorter than any packed island and would otherwise fall through to the autosave.
  const m=/^s=([0-9a-z]+)$/i.exec(h);
  if(m){const n=parseInt(m[1],36);if(isFinite(n)&&n>0){newWorld(n>>>0);return true}}
  if(h.length<40)return false;
  const o=JSON.parse(lzDec(h));if(!canLoad(o))return false;unpack(o);return true}
// The whole island as one hash string. Two callers now: the keep button, and the saga's way back (phase 4).
const islandHash=()=>lzEnc(JSON.stringify(pack()));
function saveHash(){let str;
  try{str=islandHash()}catch(err){say('Something about this island will not fit in a link.',true);return}
  try{history.replaceState(null,'','#'+str)}catch(err){location.hash=str}
  const done=ok=>say(ok?'This island is copied. The link holds everyone in it, exactly as they are now.':'This island is in the address bar now. Copy that line to keep it.',true);
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(location.href).then(()=>done(true),()=>done(false));else done(false)}
