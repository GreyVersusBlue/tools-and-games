// Hearth — the chronicle panel, pack/unpack and the migration ladder — the whole island in the address bar (save v:12, back to v5).
// Classic scripts sharing one global scope; the load order in index.html is the old single file’s order and it matters.
// ---------- the chronicle ----------
const chronEl=document.getElementById('chron'),rollEl=document.getElementById('chron-roll');
function showChron(v){chronEl.hidden=!v;document.getElementById('b-chron').classList.toggle('on',!!v);if(v){if(innerWidth<=520)showCard(null);renderChron()}}
function renderChron(){let h='',cy=0;
  for(const e of chron){if(e.y!==cy){cy=e.y;const yn=yearName(cy);h+=`<h4>year ${cy}${yn?' — '+yn:''}</h4>`}h+=`<p><i>day ${e.d}</i>${e.st||e.label}${e.gr?' <em class="tl">— as it is told now</em>':''}</p>`}
  rollEl.innerHTML=h||'<p>Nothing has happened yet that anyone will remember.</p>';
  document.getElementById('chron-t').firstChild.textContent=village?`The Chronicle of ${village}`:'The Chronicle';
  document.getElementById('chron-s').textContent=`island ${seed.toString(36)} · year ${yearOf(dayCount)}, day ${dayCount}`+(hasWay(3)?' · written in the book of days':'');
  document.getElementById('chron-n').textContent=chron.length===1?'one thing remembered':`${chron.length} things remembered`;
  rollEl.scrollTop=rollEl.scrollHeight}
function exportChron(){const L=[`The chronicle of ${village||'an island with no name'}`,`island ${seed.toString(36)}`,''];let cy=0;
  for(const e of chron){if(e.y!==cy){cy=e.y;const yn=yearName(cy);L.push('',`YEAR ${cy}${yn?' — '+yn:''}`,'')}L.push(`  day ${String(e.d).padStart(4)}   ${(e.st||e.label).replace(/<[^>]+>/g,'')}${e.gr?' (as it is told now)':''}`)}
  L.push('','',`It is year ${yearOf(dayCount)}, day ${dayCount}. There are ${people.length} people here, ${houses.length} houses, and ${graves.length} stones on the hill.`);
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([L.join('\n')],{type:'text/plain'}));
  a.download=(village||'island-'+seed.toString(36)).toLowerCase()+'-chronicle.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
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
const packP=p=>[+p.x.toFixed(2),+p.y.toFixed(2),p.name,p.age0,p.born,p.tr,p.rels.map(r=>[r.who,r.k]),p.hist.map(h=>[h.d,h.s]),p.col,p.hair,houses.indexOf(p.home),p.partner||0,p.parents,p.child?1:0,[p.spot.l,+p.spot.x.toFixed(1),+p.spot.y.toFixed(1)],+p.off.toFixed(2),p.fishRain||0,p.boats||0,p.wantHouse?1:0,p.dreamFar?1:0,p.luck?1:0,p.pend?[p.pend.k,p.pend.who||0,p.pend.gr?p.pend.gr.name:0]:0,p.keeper?1:0,p.craft===undefined?-1:p.craft,+(p.cxp||0).toFixed(2),p.shadN?[p.shadN,p.shadC|0]:0,p.sick?1:0,p.heard?[p.heard.l,p.heard.d,p.heard.f||0]:0,p.fSk===undefined?-1:p.fSk]; /* v12 adds 27 (news carried) and 28 (inherited skin) */
function pack(){const rd=[];{let v=road[0],n=0;for(let i=0;i<W*H;i++){if(road[i]===v)n++;else{rd.push(v,n);v=road[i];n=1}}rd.push(v,n)}
  return{v:SAVE_V,s:seed,t:+time.toFixed(2),d:dayCount,ly:lastYear,ls:lastSea,w:wood,f:food,g:granary,hu:+hunger.toFixed(3),lp:lorePl,ln:Object.keys(loreN).map(k=>[k,loreN[k]]),by:boundsYr,
    sg:songs.map(s=>[s.ci,s.comp,s.kn,s.lost?1:0,s.d]),sm:snowmen.map(s=>[+s.x.toFixed(1),+s.y.toFixed(1),+s.s.toFixed(2),s.d]),ss:skipN,
    dr:+dry01.toFixed(2),br:breadYr,ry:retYr,wk:works.map(w=>[w.wk,+w.x.toFixed(1),+w.y.toFixed(1),w.y0,w.done?1:0,+(w.prog||0).toFixed(1),w.paid?1:0,w.said?1:0]),
    hl:things.map(t=>[t.n,t.full,t.holder||0,t.src,t.ci===undefined?-1:t.ci,t.hist.map(h=>[h.d,h.s])]),hy:heirYr,
    fa:+faith.toFixed(2),fs:faithSt,py:prayer?[prayer.k,prayer.d,prayer.who||0]:0,ay:ways,ax:arc?[arc.k,arc.d0,arc.end]:0,az:arcYr,aw:wayYr,ab:bookYr,al:lastStormDay,am:rainedDay,an:wreckYr,af:famDone?1:0,
    wx,wt:+wxT.toFixed(1),sn:+snowD.toFixed(3),fz:frozen?1:0,fo:+fogA.toFixed(2),vn:village||0,rv:roadV,td:traderDay,be:belled,rs:ruinSeen,
    gd:geeseDay,wd:whaleDay,ar:+arrivalT.toFixed(1),sp:speed,wi:wind,sy:storyDay,sk:sackUsed?1:0,
    pe:people.map(packP),de:dead.map(p=>[p.name,p.rels.map(r=>[r.who,r.k])]),go:gone.map(p=>p.name),
    ho:houses.map(h=>[h.x,h.y,h.r,h.owners]),fm:farms.map(f=>[f.x,f.y,+f.g.toFixed(2)]),
    tr:trees.map(t=>[+t.x.toFixed(2),+t.y.toFixed(2),+t.s.toFixed(2),t.hp,t.b?1:0,+t.a.toFixed(2),t.o?1:0]),
    su:stumps.map(t=>[+t.x.toFixed(1),+t.y.toFixed(1)]),
    bl:bldg.map(b=>[b.kind,b.x,b.y]),bt:bldgTgt?[bldgTgt.kind,bldgTgt.x,bldgTgt.y,+bldgTgt.prog.toFixed(1)]:0,
    gv:graves.map(g=>[+g.x.toFixed(2),+g.y.toFixed(2),g.name,g.d,g.y2,g.age,g.vn||0]),
    sr:springs.map(s=>[+s.x.toFixed(2),+s.y.toFixed(2),+s.r.toFixed(2),+s.ph.toFixed(2)]),
    ch:chron.map(e=>[e.d,e.y,e.kind,e.label,e.st||0,e.tl||0,e.gr?1:0]),ev:events.map(e=>[e.d,e.y,e.kind,e.label]),
    vo:voyage?[voyage.name,voyage.st,voyage.day,voyage.back?1:0,voyage.n||0,voyage.st==='away'?packP(voyage.p):0]:0,
    rb:ruin&&ruin.built?1:0,fl:farIsle&&farIsle.lit?1:0,rd}}
// ---------- the migration ladder ----------
// SAVE_V is the shape pack() writes. SAVE_MIN is the oldest shape the ladder can still bring forward. Both readers — the link in the
// address bar and the autosave at boot — used to carry their own copy of that range, and sprint 12 shipped with one of the two stale;
// canLoad() is the only copy there is now.
const SAVE_V=12, SAVE_MIN=5;
const canLoad=o=>!!(o&&o.v>=SAVE_MIN&&o.v<=SAVE_V&&o.pe);
// One hop per version, in order. `up` takes a save shaped `from` and makes it shaped `to`, filling in exactly what unpack() used to
// synthesize with a `||` at the point of reading; `down` is the same hop walked backwards, and is what the harness's `migrate` mode
// forges its fixtures with. The two halves live next to each other on purpose: six hand-written forgeries scattered across five
// harness modes could not be kept honest, and one of them (v7) had already drifted — it left the sprint-10 keys in.
// A packed person is a positional array of 29 slots; these are the defaults for the slots the ladder has had to add, by index.
const P_DEF={23:-1,24:0,25:0,26:0,27:0,28:-1};
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
              down:o=>{delete o.sg;delete o.sm;delete o.ss;cutP(o,27)}}];
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
    if(a[27])p.heard={l:a[27][0],d:a[27][1],f:a[27][2]||0};if(a[28]>=0)p.fSk=a[28];return p};
  names=new Set();people=o.pe.map(mk);people.forEach(p=>names.add(p.name));
  dead=o.de.map(a=>({name:a[0],rels:a[1].map(r=>({who:r[0],k:r[1]})),dead:true,hist:[],tr:[]}));
  gone=o.go.map(n=>({name:n}));
  voyage=o.vo?{name:o.vo[0],st:o.vo[1],day:o.vo[2],back:!!o.vo[3],n:o.vo[4],p:o.vo[5]?mk(o.vo[5]):byName(o.vo[0])}:null;
  if(voyage&&!voyage.p)voyage=null;
  if(voyage&&voyage.st==='going')voyage.p.task='voyage';
  if(ruin&&o.rb)ruin.built=true;
  if(farIsle)farIsle.lit=!!o.fl;
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
function loadHash(){const h=(location.hash||'').replace(/^#/,'');if(h.length<40)return false;
  const o=JSON.parse(lzDec(h));if(!canLoad(o))return false;unpack(o);return true}
function saveHash(){let str;
  try{str=lzEnc(JSON.stringify(pack()))}catch(err){say('Something about this island will not fit in a link.',true);return}
  try{history.replaceState(null,'','#'+str)}catch(err){location.hash=str}
  const done=ok=>say(ok?'This island is copied. The link holds everyone in it, exactly as they are now.':'This island is in the address bar now. Copy that line to keep it.',true);
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(location.href).then(()=>done(true),()=>done(false));else done(false)}
