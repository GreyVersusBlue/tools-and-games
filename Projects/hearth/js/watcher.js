// Hearth — the watcher’s blessings, dreams and stories, the year’s fortunes, the ways, the noticing, and the weather.
// Classic scripts sharing one global scope; the load order in index.html is the old single file’s order and it matters.
// ---------- the watcher (sprint 5): clouds, blessings, dreams, stories ----------
function mkCloudSprites(){cloudSp=[];const rr=mulberry(seed^0x5a17);
  for(let i=0;i<3;i++){const c=document.createElement('canvas');c.width=112;c.height=64;const x=c.getContext('2d');
    for(let k=0;k<11;k++){const cx=18+rr()*76,cy=16+rr()*32,r=9+rr()*17;const gr=x.createRadialGradient(cx,cy,0,cx,cy,r);
      gr.addColorStop(0,'rgba(12,20,38,.30)');gr.addColorStop(.55,'rgba(12,20,38,.16)');gr.addColorStop(1,'rgba(12,20,38,0)');x.fillStyle=gr;x.fillRect(cx-r,cy-r,r*2,r*2)}
    cloudSp.push(c)}}
const cloudW=c=>112*c.s/T, cloudH=c=>64*c.s/T;
const CLOUDN={clear:2,overcast:6,rain:7,thunder:8,snow:5,fog:0};
const CLOUDV={clear:.32,overcast:.5,rain:.7,thunder:1.5,snow:.45,fog:.15};
function addCloud(edge){const s=rnd(.65,1.5),w=112*s/T;
  clouds.push({x:edge?(wind>0?-w*.6:W+w*.6):rnd(w*.5,W-w*.5),y:rnd(2,H-3),s,i:(R()*3)|0,r:0,rt:0,ph:rnd(6.28)})}
function stepClouds(dt){const n=CLOUDN[wx]||0,v=(CLOUDV[wx]||.3)*wind;
  if(clouds.length<n&&R()<dt*.5)addCloud(true);
  for(const c of clouds){c.x+=v*dt;c.y+=Math.sin(time*.04+c.ph)*dt*.12;
    if(c.r>0){c.r-=dt;const w=cloudW(c)*.42,h=cloudH(c)*.4;
      if(R()<dt*10){const rx=c.x+rnd(-w,w),ry=c.y+rnd(-h,h);if(rx>0&&ry>0&&rx<W&&ry<H&&at(rx|0,ry|0)!==WATER)fx.push({x:rx,y:ry,vx:0,vy:0,c:'#cfe6ff',l:.3})}
      for(const f of farms)if(f.g<1&&Math.abs(f.x+.5-c.x)<w&&Math.abs(f.y+.5-c.y)<h)f.g=Math.min(1,f.g+dt*.03);
      if(c.r<=0)c.rt=60}
    else if(c.rt>0)c.rt-=dt}
  clouds=clouds.filter(c=>c.x>-cloudW(c)&&c.x<W+cloudW(c))}
function cloudAt(x,y){for(const c of clouds){if(c.r>0||c.rt>0)continue;if(Math.abs(x-c.x)<cloudW(c)*.34&&Math.abs(y-c.y)<cloudH(c)*.32)return c}return null}
function rainOn(c){c.r=rnd(16,26);whoosh(c.x,c.y,1.8);actDone('cloudrain');noteAct('cloudrain',.06);rainedDay=dayCount;dry01=Math.max(0,dry01-.3); // a rained cloud counts as rain: it eases the dry ground, and the stone gets the credit
  const near=people.filter(p=>!p.inside&&Math.abs(p.x-c.x)<cloudW(c)*.5&&Math.abs(p.y-c.y)<cloudH(c)*.5);
  const dry=farms.some(f=>f.g<1&&Math.abs(f.x-c.x)<cloudW(c)*.5&&Math.abs(f.y-c.y)<cloudH(c)*.5);
  say(dry?'One cloud stops over the fields and lets go of everything it was holding.':near.length?`One cloud out of a whole sky rains, and it rains on ${B(pick(near))}, who looks up.`:'A single cloud lets go of its rain, in one place, for no reason anyone can see.',true)}
// a spring, from a long press on the grass
function makeSpring(cx,cy){const r=rnd(1.3,2.1),hit=[];
  for(let y=Math.floor(cy-r-1);y<=cy+r+1;y++)for(let x=Math.floor(cx-r-1);x<=cx+r+1;x++){
    if(x<1||y<1||x>=W-1||y>=H-1)continue;if(Math.hypot(x+.5-cx,(y+.5-cy)*1.3)>r)continue;if(at(x,y)!==GRASS)continue;
    if(Math.hypot(center.x-x,center.y-y)<3.5)return false;
    if(houses.some(h=>x>=h.x-1&&x<=h.x+2&&y>=h.y-1&&y<=h.y+3)||bAll().some(b=>x>=b.x-1&&x<=b.x+b.w&&y>=b.y-1&&y<=b.y+b.h)||graves.some(gr=>Math.hypot(gr.x-x,gr.y-y)<2.2))return false;
    hit.push(idx(x,y))}
  if(hit.length<4)return false;
  for(const i of hit){tiles[i]=WATER;elev[i]=.19;road[i]=0}
  trees=trees.filter(t=>Math.hypot(t.x-cx,t.y-cy)>r+.3);stumps=stumps.filter(t=>Math.hypot(t.x-cx,t.y-cy)>r+.3);
  springs.push({x:cx,y:cy,r,ph:R()});spots.push({l:'the spring',x:cx,y:cy+1.6});actDone('spring');noteAct('spring',.07);
  if(R()<.5)fishSh.push({x:cx,y:cy,tx:cx,ty:cy,n:2,t:0,ph:R()*6,st:true});
  paintTerrain();splash(cx,cy);
  for(let i=0;i<16;i++)fx.push({x:cx+rnd(-r,r),y:cy+rnd(-r*.7,r*.7),vx:rnd(-.4,.4),vy:-rnd(.4,1.3),c:'#cfe6ff',l:rnd(.5,1.3)});
  say(springs.length===1?'Water comes up through the grass where there was none, finds a shape to sit in, and stays.':'Somewhere else the ground gives up more water, and there is another pool by evening.',true);
  addEvent('spring','the day the spring came up',`Water came up through the grass ${springs.length===1?'where there had never been any':'a second time'}, and the ground has been wet there ever since.`);
  return true}
// a stone, skipped
const ring=(x,y)=>fx.push({x,y,vx:0,vy:0,rg:1,l:.9,l0:.9,c:'#cfe6ff'});
function skipStone(x,y){let dx=x-center.x,dy=y-center.y;const d=Math.hypot(dx,dy)||1;
  skips.push({x,y,vx:dx/d*11,vy:dy/d*7.5,n:2+((R()*4)|0),t:.14});plink(.15);actDone('stone');noteAct('stone',.01)}
function stepSkips(dt){for(const k of skips){k.x+=k.vx*dt;k.y+=k.vy*dt;k.t-=dt;
    if(k.t<=0){k.n--;k.t=.13+R()*.07;k.vx*=.86;k.vy*=.86;ring(k.x,k.y);if(k.n>0)plink(.05+R()*.04)}
    if(k.n<=0||k.x<0||k.y<0||k.x>=W||k.y>=H||at(k.x|0,k.y|0)!==WATER)k.gone=true}
  skips=skips.filter(k=>!k.gone)}
// a gust, dragged across the water
function gustAt(x0,y0,x1,y1){const dx=x1-x0,dy=y1-y0,d=Math.hypot(dx,dy)||1,ux=dx/d,uy=dy/d;
  gusts.push({x:x0,y:y0,ux,uy,len:d,t:1.8});whoosh((x0+x1)/2,(y0+y1)/2,1.1);actDone('gust');noteAct('gust',.025);
  let pushed=null;
  for(const b of boats){if(Math.hypot(b.x-x1,b.y-y1)>9)continue;b.gvx=(b.gvx||0)+ux*3.2;b.gvy=(b.gvy||0)+uy*3.2;pushed=b}
  for(const gl of gulls){if(Math.hypot(gl.cx-x1,gl.cy-y1)>10)continue;gl.cx+=ux*1.6;gl.cy+=uy*1.6}
  for(const f of fishSh)if(Math.hypot(f.x-x1,f.y-y1)<5){f.tx=f.x+ux*2.5;f.ty=f.y+uy*2.5}
  if(pushed&&pushed.p)say(`A gust comes off the water and takes the boat sideways. ${B(pushed.p)} leans into it and lets it.`,true);
  else if(pushed)say('A gust comes off the water and shoves the boat along faster than anyone is rowing.',true);
  else say('Something moves over the water in a line, and the water goes dark under it, and then light again.',false,'gust')}
function stepGusts(dt){for(const gu of gusts){gu.t-=dt;
    if(R()<dt*26){const k=rnd(0,gu.len);fx.push({x:gu.x+gu.ux*k+rnd(-.8,.8),y:gu.y+gu.uy*k+rnd(-.6,.6),vx:gu.ux*3.5,vy:gu.uy*3.5,c:'#dceeff',l:rnd(.3,.6)})}}
  gusts=gusts.filter(gu=>gu.t>0)}
// dreams, given at night, that sometimes come true by morning
const DREAMS=[
  {k:'heal',c:p=>!!p.sick,t:p=>`${B(p)} dreams of cold spring water moving over stones, and of drinking it, and of being told — by whom? — to sleep now.`},
  {k:'mend',c:p=>!!relOf(p,'rival'),t:(p,q)=>`${B(p)} dreams of ${q.name}, of all people, holding a rope out from a boat, and takes it.`},
  {k:'tool',c:p=>dayCount>6&&!isKid(p),t:p=>`${B(p)} dreams of the axe head that went missing, lying in the grass exactly where it was left.`},
  {k:'settle',c:p=>has(p,'homesick'),t:p=>`${B(p)} dreams of the house with the blue door. Nobody in it is waiting up, and that turns out to be all right.`},
  {k:'visit',c:p=>graves.length>0,t:(p,q,gr)=>`${B(p)} dreams of ${gr.name}, who is not at all surprised, and says nothing worth remembering, kindly.`},
  {k:'far',c:p=>!!farIsle&&!voyage&&!isKid(p),t:p=>`${B(p)} dreams the far island is close enough to wade to, and wakes up certain of it.`},
  {k:'fish',c:p=>shore.length>0,t:p=>`${B(p)} dreams the shallows are so thick with silver you could walk out on the backs of them.`},
  {k:'grow',c:p=>trees.length>4,t:p=>`${B(p)} dreams of a tree that was not there yesterday, already taller than the house.`},
  {k:'calling',c:p=>!isKid(p)&&p.craft>=0,t:p=>`${B(p)} dreams of doing different work with the same hands, and in the dream the hands already know how.`},
  {k:'',c:p=>isKid(p),t:p=>`${B(p)} dreams of being tall enough to reach the high shelf, and of what turns out to be on it.`},
  {k:'',c:p=>has(p,'dreamy'),t:p=>`${B(p)} dreams in weather: a long green wind, and a hill that turns over in its sleep.`},
  {k:'',c:p=>events.length>0,t:p=>`${B(p)} dreams of ${eventLabel()} again, but the ending is different, and better.`},
  {k:'',c:p=>!!p.partner&&!!byName(p.partner),t:p=>`${B(p)} dreams of ${p.partner} coming up the path with both hands full, and nothing else happens in it at all.`},
  {k:'',c:p=>true,t:p=>`${B(p)} dreams of the island from above, the way a gull has it, with everyone on it very small and very busy.`},
];
function dreamOf(p){if(p.dreamt===dayCount||p.dead)return false;
  const q=relOf(p,'rival'),gr=graves.length?pick(graves):null;
  const ok=DREAMS.filter(d=>d.c(p));if(!ok.length)return false;
  const d=p.sick&&ok[0].k==='heal'?ok[0]:pick(ok);p.dreamt=dayCount;dreamAny=dayCount;actDone('dream');noteAct('dream',.035);
  say(d.t(p,q,gr),true);
  if(d.k&&(R()<.5||d.k==='heal'))p.pend={k:d.k,who:q?q.name:null,gr};
  return true}
function wakeDreams(){for(const p of people){const d=p.pend;if(!d)continue;p.pend=null;
    if(d.k==='mend'){const q=byName(d.who);if(!q)continue;const r=p.rels.find(r=>r.who===q.name),r2=q.rels.find(r=>r.who===p.name);
      if(r&&r.k==='rival'){r.k='friend';if(r2)r2.k='friend';
        say(`${B(p)} and ${B(q)}, who have not agreed about anything in a year, walk down to the fields together. Neither of them mentions a dream.`,true);
        p.hist.push({d:dayCount,s:`made it up with ${q.name}, and could not say why`});q.hist.push({d:dayCount,s:`made it up with ${p.name}, and could not say why`});
        addEvent('mend',`the ${sea()} ${p.name} and ${q.name} made it up`,`${p.name} and ${q.name} stopped being rivals overnight, and neither would explain it.`)}}
    else if(d.k==='tool'){wood+=6;say(`${B(p)} goes out before breakfast and comes back with the axe head that has been lost since the storm.`,true);p.hist.push({d:dayCount,s:'found the axe head that had been lost since the storm'})}
    else if(d.k==='settle'){const i=p.tr.indexOf('homesick');if(i>=0){p.tr[i]=pick(['patient','gentle','funny','dreamy']);
      say(`${B(p)} does not go down to the water at dusk tonight, and does not notice not going.`,true);p.hist.push({d:dayCount,s:'stopped counting the days since leaving home'})}}
    else if(d.k==='visit'){if(d.gr&&graves.includes(d.gr)){p.mourn=d.gr;p.hist.push({d:dayCount,s:`went up the hill to sit with ${d.gr.name}, for no particular reason`})}}
    else if(d.k==='calling'){const old=p.craft;if(old>=0){let nc=(R()*4)|0;if(nc>=old)nc++;p.craft=nc;p.cxp=Math.max(.1,+(p.cxp*.4).toFixed(2));
      say(`${B(p)} spends the morning at ${CRAFT_WORK[nc]}, and does not go back to ${CRAFT_WORK[old]}.`,true);
      p.hist.push({d:dayCount,s:'changed work overnight, and could not say why'})}}
    else if(d.k==='heal'){if(p.sick){p.sick=0;say(`${B(p)} wakes with the fever broken and an appetite, and tells the dream to everyone, twice.`,true);p.hist.push({d:dayCount,s:'dreamed the fever away, or so it is told'})}}
    else if(d.k==='far')p.dreamFar=1;
    else if(d.k==='fish')p.luck=1;
    else if(d.k==='grow'){const sp=freeSpot(3,14);if(sp){trees.push(mkTree(sp.x+.5,sp.y+.5,.6));say('There is a young tree at the edge of the clearing that nobody remembers being that tall.',false,'growtree')}}
  }}
// the fire, and the story told at it
function tellStory(nat){if(storyDay===dayCount)return false;
  const cand=people.filter(p=>!p.dead&&p.task!=='boat'&&p.task!=='voyage');if(!cand.length)return false;
  storyDay=dayCount;if(!nat){actDone('story');noteAct('story',.05)} // a midwinter fire is the village's own doing; the stone gets no credit for it
  for(const q of cand){if(q.task==='shelter')continue;if(q.tgt&&q.tgt.claimed)q.tgt.claimed=false;q.tgt=null;q.inside=false;
    goTo(q,center.x+rnd(-3,3),center.y+rnd(-2.2,2.2),'gather',rnd(24,44))}
  const grown=cand.filter(p=>!isKid(p)),teller=grown.sort((a,b)=>ageOf(b)-ageOf(a))[0]||cand[0];
  const big=chron.filter(e=>e.st&&e.kind!=='arrival'&&e.kind!=='trade'),src=big.length>=4?big:chron.filter(e=>e.st),
    L=['Somebody puts more wood on the fire than it needs, and the island comes to it.'];
  if(src.length<2)L.push('There is not much to tell yet. They sit with the fire anyway, which is most of it.');
  else{L.push(`${B(teller)} tells it, and gets to tell it, having been here for most of it.`);
    const n=Math.min(5,src.length),seen=new Set(),ch=[];
    for(let i=0;i<n;i++){const e=src[Math.round(i*(src.length-1)/(n-1))];if(!seen.has(e)){seen.add(e);ch.push(e)}}
    const last=src[src.length-1];if(!seen.has(last))ch.push(last);
    // the teller comes back around to a favorite, if the island has grown one (sprint 12)
    const leg=src.filter(e=>e.gr&&!seen.has(e));if(leg.length&&R()<.6){const e=leg[(R()*leg.length)|0];seen.add(e);ch.push(e)}
    let grew=null;
    for(const e of ch){e.tl=(e.tl||0)+1; // every telling leaves a thumbprint on the story
      if(!grew&&!e.gr&&e.tl>=3&&GROW[e.kind]){e.gr=1;const g=GROW[e.kind];e.st=e.st+' '+g[(R()*g.length)|0];grew=e}
      L.push(`<i>year ${e.y}</i>${e.st}`)}
    if(grew)L.push(`That part is longer than it used to be. Nobody minds. That is what the good parts are for.`);
    L.push(pick(['Nobody corrects any of it. Most of it is true.','When it is done the fire has burned low, and somebody builds it up again anyway.','Then it is late, and nobody moves for a while.','The children have heard it before and listen anyway, in case it changes.']));
    if(R()<.5)teller.hist.push({d:dayCount,s:'told the whole story of the island at the fire, from the landing on'})}
  say(L.join('<br>'),true);
  return true}
// ---------- the year's fortunes (sprint 11): every year turns up its own card ----------
function startArc(k,len){arc={k,d0:dayCount,end:dayCount+(len||6)};
  if(k==='drought'){say('The rain has stopped coming. Not dramatically — it simply does not come, and after enough days of that everyone is watching the sky the same way.',true);
    addEvent('drought',`the dry ${sea()} of year ${yearOf(dayCount)}`,`The rain stopped for most of a ${sea()} in year ${yearOf(dayCount)}, and the fields cracked, and the well earned its digging.`)}
  else if(k==='longwinter'){say('This winter has teeth. The cold gets into the walls in the first week and does not leave, and the store is counted more often than it changes.',true);
    addEvent('hardwinter',`the hard winter of year ${yearOf(dayCount)}`,`The winter of year ${yearOf(dayCount)} was the kind that gets talked about in other winters. The store was counted daily, and everyone came out of it lean.`)}
  else if(k==='fever'){const cand=people.filter(p=>!p.dead&&!isKid(p));const n=Math.min(cand.length,2+((people.length/8)|0));
    for(let i=0;i<n;i++){const p=pick(cand);if(!p.sick){p.sick=1;p.hist.push({d:dayCount,s:'took the fever, and was made to lie down, eventually'})}}
    say('A fever comes into the village with the turn of the weather. It starts as a cough in one house and is in three houses by evening. The pot of broth at the fire stops being anyone\'s in particular.',true);
    addEvent('fever',`the fever of year ${yearOf(dayCount)}`,`A fever went through ${V()} in year ${yearOf(dayCount)}. Broth was carried, doors were left open for listening, and the village held its breath a while.`)}
  else if(k==='shoal'){say('The first boat back can hardly lift its own catch. Something has driven the silver fish inshore in a body, and for a few days the sea is a field that harvests itself.',true);
    addEvent('shoal',`the ${sea()} the fish came inshore`,`In year ${yearOf(dayCount)} the fish came inshore in a great shoal, and for days every line came up heavy, and the racks were full.`)}}
function arcDay(){if(!arc)return;
  if(arc.k==='fever'){let any=false;
    for(const p of people){if(!p.sick)continue;any=true;
      if(R()<.35){p.sick=0;say(`${B(p)} is up again, thin and cross about the lost days, and goes back to work too early, and is watched.`,false,'feverup');p.hist.push({d:dayCount,s:'shook the fever off'})}
      else if(isElder(p)&&R()<.07){p.hist.push({d:dayCount,s:'was taken by the fever'});die(p)}}
    if(!any){arc=null;say('The fever burns itself out the way they do: one morning there is simply nobody left in bed, and the broth pot goes back to being somebody\'s.',true);return}}
  if(dayCount>=arc.end){const k=arc.k;arc=null;
    if(k==='drought'){setWx('thunder');say('The sky goes the colour of a bruise all in one afternoon, and breaks. People stand out in the rain on purpose. Nobody hurries indoors, not even the sensible ones.',true);
      addEvent('rainscame','the day the rain came back',`The drought of year ${yearOf(dayCount)} broke in one great storm, and people stood out in it on purpose, and the fields drank for two days straight.`)}
    else if(k==='longwinter')say('The worst of the winter lets go. It will still snow, but the cold has stopped meaning it, and everyone can feel the difference through the walls.',true);
    else if(k==='fever'){for(const p of people)p.sick=0;say('The fever burns itself out the way they do: one morning there is simply nobody left in bed.',true)}
    else if(k==='shoal')say('The shoal moves on as suddenly as it came. The racks are full, the store smells of the sea, and the gulls take a few days to accept it.',true)}}
// ---------- the ways (sprint 11): what the village learns for good, in whatever order its masters come ----------
const WAYS=[
 {n:'the sail',ci:2,cond:()=>hasB('hut')&&people.some(p=>!p.dead&&p.craft===2&&p.cxp>=1),
  l:p=>`${B(p)} steps a short mast in the boat and hangs a woven square from it, and the boat leans and goes without anyone pulling. The children run the shoreline to keep up. ${V()} has the sail now, and the sea is smaller than it was this morning.`},
 {n:'the plough',ci:0,cond:()=>hasB('well')&&farms.length>=5&&people.some(p=>!p.dead&&p.craft===0&&p.cxp>=1),
  l:p=>`${B(p)} binds a shaped blade to a beam and walks it down a field in one morning that used to take three. People come just to watch the ground turn over in a long clean wave. The plough has come to ${V()}, and the fields will not go back.`},
 {n:'the kiln',ci:3,cond:()=>houses.length>=6&&people.some(p=>!p.dead&&p.craft===3&&p.cxp>=1),
  l:p=>`${B(p)} builds a fire inside a hill of clay and keeps it fed for two days, and what comes out rings when it is tapped: fired pots, hard as stone. The damp has been stealing from the store for years. The kiln puts a stop to it.`},
 {n:'the book of days',ci:4,cond:()=>hasB('hall')&&people.some(p=>!p.dead&&p.craft===4&&p.cxp>=.66),
  l:p=>`${B(p)} rules lines on a boiled hide and begins setting down the store's counts, and then the days, and then the years. ${V()} has a book now. From here on, what happened is written, not only remembered.`}];
function wayDay(yr){if(wayYr===yr||seaDay()!==3||dayCount<=YEAR||R()>=.3)return;
  for(let i=0;i<WAYS.length;i++){if(hasWay(i))continue;const D=WAYS[i];if(!D.cond())continue;
    ways|=1<<i;wayYr=yr;const m=people.filter(p=>!p.dead&&p.craft===D.ci&&p.cxp>=.66).sort((a,b)=>b.cxp-a.cxp)[0]||people.filter(p=>!p.dead&&!isKid(p))[0];if(!m)return;
    say(D.l(m),true);wayTune();m.hist.push({d:dayCount,s:`worked out ${D.n}, and gave it to everyone`});
    addEvent('way',`the year ${D.n} came to ${V()}`,`In year ${yr}, ${m.name} worked out ${D.n}, and after that nothing was done the old way again.`);break}}
// ---------- the noticing (sprint 11): the island keeps a quiet account of what the watcher does ----------
function noteAct(k,amt){acts.push({d:dayCount,k});if(acts.length>40)acts.shift();faith=Math.min(1,faith+(amt||.03)*(hasW('shrine')?1.5:1))}
const OFFER=['a heel of bread','a smooth blue stone','a carved bird no bigger than a thumb','a knot of dried flowers','the best of the windfalls','a good fish hook'];
const PRAYW={rain:'rain on the fields',food:'a full pot',calm:'a kind sea under the boat',heal:'the fever to pass',dream:'a good dream for the child'};
function faithDay(){const yr=yearOf(dayCount);faith=Math.max(0,faith-.005);
  const adults=people.filter(p=>!p.dead&&!isKid(p));if(!adults.length)return;
  const recent=acts.filter(a=>a.d>=dayCount-3).length;
  if(faithSt===0&&faith>=.14){faithSt=1;const p=pick(adults);
    say(`${B(p)} says, quietly, at the fire, that this island answers. Saplings nobody planted. Rain that comes when the fields want it. Nobody laughs, and nobody quite argues either.`,true);
    addEvent('noticed','the year the island was first thanked','People had begun to notice that the island answers — small things, kindly done, never seen being done. Nobody named it. Everyone thanked it anyway, each in their own way.')}
  else if(faithSt===1&&faith>=.34&&!hasW('shrine')&&!works.some(w=>w.wk==='shrine')){faithSt=2;
    const s0=WORKS.shrine.site();works.push({wk:'shrine',x:s0.x,y:s0.y,y0:yr,done:false,prog:0,paid:1,said:1});
    say(`${B(pick(adults))} spends a morning choosing a flat stone from the shore, and pacing the grass near the hearth, and does not explain. Everyone already knows what the stone will be for.`,true)}
  if(faithSt>=2&&!hasW('shrine')&&!works.some(w=>w.wk==='shrine')){const s0=WORKS.shrine.site();works.push({wk:'shrine',x:s0.x,y:s0.y,y0:yr,done:false,prog:0,paid:1,said:1})}
  // what is asked at the stone, and whether it comes — by the watcher's hand or by weather, and nobody can tell the difference, which is the point
  if(prayer){const q=prayer.who?byName(prayer.who):null;
    const got=(prayer.k==='rain'&&rainedDay>=prayer.d)||(prayer.k==='food'&&food+granary>people.length*5)||(prayer.k==='calm'&&dayCount>=prayer.d+2&&lastStormDay<=prayer.d)||(prayer.k==='heal'&&q&&!q.sick&&!q.dead)||(prayer.k==='dream'&&q&&q.dreamt>=prayer.d);
    if(got){faith=Math.min(1,faith+.12);const p=pick(adults);
      say(`What was asked at the quiet stone has come, the way asked-for things sometimes do. ${B(p)} goes and stands by the stone a moment, and touches the top of it, and leaves.`,true);
      if(R()<.5)addEvent('answered',`the ${sea()} the stone answered`,`Something asked at the quiet stone — ${PRAYW[prayer.k]} — came. Whether it would have come anyway is not the kind of question anyone asks out loud.`);
      prayer=null}
    else if(dayCount>prayer.d+4){faith=Math.max(0,faith-.05);
      say('The stone keeps its own counsel this time. The offering is lifted off it gently, and eaten, because times are what they are.',false,'unanswered');prayer=null}}
  else if(hasW('shrine')&&R()<.3){let k=null,who=null;
    const sickP=people.find(p=>p.sick),kid=people.find(p=>isKid(p)&&!p.dead);
    if(sickP){k='heal';who=sickP.name}
    else if(dry01>.5)k='rain';
    else if(hunger>.25)k='food';
    else if(dayCount-lastStormDay<=2&&hasB('hut'))k='calm';
    else if(kid&&R()<.35){k='dream';who=kid.name}
    if(k){prayer={k,d:dayCount,who};const sw=works.find(w=>w.wk==='shrine'&&w.done);if(sw)stoneTap(sw.x,sw.y);
      say(`${B(pick(adults))} leaves ${pick(OFFER)} in the hollow at the foot of the quiet stone, and asks, not out loud, for ${k==='heal'&&who?`the fever to leave ${who}`:k==='dream'&&who?`a good dream for ${who}`:PRAYW[k]}.`,true)}}
  // too much, or exactly enough
  if(faith>=.5&&recent>=9&&R()<.25)say('The talk at the fire has gone strange lately: less of what anyone will do tomorrow, more of what the island will do for them. Somebody says the fields should probably still be weeded either way, and is right.',false,'depend');
  if(faith>=.55&&recent===0&&R()<.1){const eld=adults.filter(isElder);
    if(eld.length)say(`${B(pick(eld))} says whatever keeps this island keeps it the right way: you are never quite sure it has done anything at all.`,false,'kept')}}
// ---------- weather ----------
function pickWx(){const s=sea(),r=R();let w;
  if(s==='winter')w=r<.32?'clear':r<.55?'overcast':r<.9?'snow':'fog';
  else if(s==='spring')w=r<.33?'clear':r<.5?'overcast':r<.8?'rain':r<.9?'thunder':'fog';
  else if(s==='summer')w=r<.5?'clear':r<.62?'overcast':r<.78?'rain':r<.94?'thunder':'fog';
  else w=r<.3?'clear':r<.5?'overcast':r<.78?'rain':r<.86?'thunder':'fog';
  // the island's temper leans on the dial, and a drought holds the rain off entirely
  if(temper==='rainy'&&w==='clear'&&R()<.25)w=s==='winter'?'snow':'rain';
  else if(temper==='dry'&&w==='rain'&&R()<.45)w='overcast';
  else if(temper==='windy'&&w==='overcast'&&R()<.18)w='thunder';
  else if(temper==='cold'&&w==='clear'&&R()<.15)w='overcast';
  if(arc&&arc.k==='drought'&&(w==='rain'||w==='thunder'))w=R()<.5?'clear':'overcast';
  return w}
function setWx(n){const o=wx;wx=n;rain=n==='rain'||n==='thunder';storm=n==='thunder';
  if(storm)lastStormDay=dayCount;if(rain)rainedDay=dayCount;
  wxT=n==='clear'?rnd(70,200):n==='overcast'?rnd(40,110):n==='rain'?rnd(40,90):n==='thunder'?rnd(30,50):n==='fog'?rnd(30,70):rnd(35,90);
  // sometimes a storm leaves the tide line paid: wreck-wood, and once in a while somebody clinging to it
  if(o==='thunder'&&n!=='thunder'&&yearOf(dayCount)!==wreckYr&&dayCount>YEAR&&R()<.3){wreckYr=yearOf(dayCount);wood+=8;
    say('When the storm lets go, the tide line is a scatter of planks and rope out of somebody else\'s bad night. The wood is carried up before the sea changes its mind.',true);
    addEvent('wreck',`the wreck-wood of year ${yearOf(dayCount)}`,`After the storm the sea left planks and rope along the tide line — some other boat's bad night, made into firewood and shelf.`);
    if(R()<.35&&people.length<popCap()&&landings.length){const l=landings[0];const p=addPerson(l.x,l.y,{age:rnd(19,40)|0,how:'washed ashore alive from a wreck, and was wrapped in a blanket before being asked anything'});meet(p,1,2);
      say(`Down among the wreck-wood there is a person, half-drowned and all the way alive: ${B(p)}, who will not talk about the boat yet.`,true);
      addEvent('washed',`the ${sea()} the sea gave up ${p.name}`,`${p.name} washed ashore alive from a wreck, and stayed, and never did say much about the boat.`)}}
  if(n==='thunder'){say('The sky goes the colour of slate and the wind gets up. This is a storm.',true);addEvent('storm',`the storm of year ${yearOf(dayCount)}`,`A storm came over in the ${sea()} of year ${yearOf(dayCount)}, and is still brought up.`);thunderT=rnd(2,6)}
  else if(n==='rain')say(o==='thunder'?'The storm settles into a steady rain.':'Rain moves in from the west. The fields drink.');
  else if(n==='snow')say(o==='overcast'?'Snow begins, quietly, and keeps on.':'Snow comes in off the sea, sideways at first, then straight down.');
  else if(n==='fog')say('Fog comes in off the water and the far shore is gone.');
  else if(n==='overcast'){if(o==='clear')say('Cloud closes over the island, low and grey.',false,'overcast');else if(o==='snow')say('The snow thins out to nothing under a low sky.')}
  else if(n==='clear'){if(o==='thunder')say('The storm blows itself out. Everything drips and shines.');else if(o==='rain')say('The rain lifts. Everything drips and shines.');else if(o==='snow')say('The snow stops. The island is very quiet under it.');else if(o==='fog')say('The fog burns off and the sea comes back.');else if(o==='overcast')say('The cloud breaks up and the light comes through in pieces.',false,'clear')}}
