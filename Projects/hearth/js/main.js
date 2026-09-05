// Hearth — time controls, hints, the view and input, the boot sequence, and window.__hearth for the harness. Loaded last.
// Classic scripts sharing one global scope; the load order in index.html is the old single file’s order and it matters.
// ---------- time ----------
// The generational speed (phase 2). Four systems the island has — heirlooms passing, the walking of the bounds, elders telling children
// of the dead, a song being lost — want a generation, and at 10x a generation is forty minutes of sitting there. A 500-day island on
// seed 7 measured 0.020 ms in step() and 9.2 ms in draw(): drawing is 450 times the cost of simulating, so the way to a decade is not
// a faster simulation, it is a rarer paint. FAST steps 240 times between frames and paints every fourth one, which is about half a
// second a day, or a decade in two minutes. Nothing skipped below draws from R() — draw() and audio.js have never touched the stream —
// so the island it produces is the same island, which the harness's `decade` mode asserts by hash rather than by argument.
const FAST=240;
function syncCtl(){for(const [id,v] of [['b-s1',1],['b-s3',3],['b-s10',10],['b-sf',FAST]])document.getElementById(id).classList.toggle('on',!paused&&speed===v);
  const b=document.getElementById('b-pause');b.classList.toggle('on',paused);b.textContent=paused?'▶':'❚❚';b.setAttribute('aria-label',paused?'resume':'pause')}
function setSpeed(v){const was=speed;speed=v;paused=false;syncCtl();
  if(was>=FAST&&v<FAST)autoSave()} // the throttled autosave writes every tenth day up there; coming down, the island is put away as it stands
function skipToMorning(){const e=edges(),f=dayFrac(),d0=Math.floor(time/dayLen);
  const tgt=(d0+(f<e[0]?0:1))*dayLen+(e[0]+.03)*dayLen;
  let n=0;while(time<tgt&&n<3400){step(.05);n++}
  paused=false;syncCtl();say('The night goes over the island quickly, the way nights do when you are not in them.',false,'skip')}
// ---------- sprint 9: the watcher, told what a watcher can do ----------
// small screens hide the hint line, so the log teaches instead: one quiet line at a time, only for acts never yet used, never again once they have been
const HINTS=[
 ['card','Any islander, looked at closely, will hold still for it.'],
 ['sapling','The grass would take a seed, if something planted one.'],
 ['stone','The water would take a stone, if something skipped it.'],
 ['spring','Held long enough, the ground might give up water.'],
 ['gust','A hand drawn across the water would move what floats on it.'],
 ['cloudrain','A cloud\'s shadow, pressed, would let its rain down early.'],
 ['dream','At night, a sleeper gently touched is given a dream.'],
 ['lullaby','A sleeping child, touched, hears a hum from nowhere.'],
 ['story','The fire, touched, remembers out loud.']];
const hintsDone=new Set((pref('hints')||'').split(',').filter(Boolean));
function actDone(k){if(hintsDone.has(k))return;hintsDone.add(k);store('hints',Array.from(hintsDone).join(','))}
let hintT=75,hintIdx=0; // real seconds, not sim time: hints are presentation and never touch the island
function hintTick(rdt){if(paused||innerWidth>520||hintsDone.size>=HINTS.length||hintIdx>=HINTS.length)return;
  hintT-=rdt;if(hintT>0)return;hintT=60;
  while(hintIdx<HINTS.length&&hintsDone.has(HINTS[hintIdx][0]))hintIdx++;
  if(hintIdx>=HINTS.length)return;
  const el=document.createElement('p');el.className='h';el.textContent=HINTS[hintIdx++][1];
  logEl.appendChild(el);while(logEl.children.length>9)logEl.removeChild(logEl.firstChild)}
const hintEl=document.getElementById('hint');
document.getElementById('b-help').onclick=()=>hintEl.classList.toggle('show');
hintEl.addEventListener('click',()=>hintEl.classList.remove('show'));
// ---------- input, and the view (sprint 11: the watcher can lean in) ----------
let zoom=1,camX=W/2,camY=H/2,vw=1,vh=1,dprE=1,fitS=1,pinch=null;
const ptrs=new Map();
function fit(){vw=Math.max(1,innerWidth);vh=Math.max(1,innerHeight);
  const dpr=Math.min(devicePixelRatio||1,3);dprE=Math.max(1,Math.min(dpr,2,Math.sqrt(2.6e6/(vw*vh)))); // sharper than before, capped so mid phones stay smooth
  cv.width=Math.round(vw*dprE);cv.height=Math.round(vh*dprE);cv.style.width=vw+'px';cv.style.height=vh+'px';
  fitS=Math.min(vw/(W*T),vh/(H*T));g.imageSmoothingEnabled=false;clampCam()}
const vScale=()=>fitS*zoom*dprE;
function clampCam(){const k=vScale(),hw=cv.width/2/(k*T),hh=cv.height/2/(k*T);
  camX=hw>=W/2?W/2:Math.max(hw,Math.min(W-hw,camX));
  camY=hh>=H/2?H/2:Math.max(hh,Math.min(H-hh,camY))}
function setZoom(z,wx,wy){const z0=zoom;zoom=Math.max(1,Math.min(4,z));if(zoom===z0)return;
  if(wx!==undefined){camX=wx-(wx-camX)*z0/zoom;camY=wy-(wy-camY)*z0/zoom}clampCam()}
addEventListener('resize',fit);fit();
let press=null,lpT=0;
const toWorld=e=>{const r=cv.getBoundingClientRect(),k=vScale();
  return{x:((e.clientX-r.left)*dprE-(cv.width/2-camX*T*k))/(k*T),y:((e.clientY-r.top)*dprE-(cv.height/2-camY*T*k))/(k*T)}};
cv.addEventListener('wheel',e=>{e.preventDefault();const w=toWorld(e);setZoom(zoom*Math.exp(-e.deltaY*.0016),w.x,w.y)},{passive:false});
cv.addEventListener('pointerdown',e=>{ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  try{cv.setPointerCapture(e.pointerId)}catch(err){}
  if(ptrs.size>=2){if(lpT){clearTimeout(lpT);lpT=0}press=null; // a second finger means the view, not a blessing
    const a=[...ptrs.values()];pinch={d0:Math.max(20,Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)),z0:zoom,mx:(a[0].x+a[1].x)/2,my:(a[0].y+a[1].y)/2};return}
  const w=toWorld(e);cur.x=w.x;cur.y=w.y;
  press={x0:w.x,y0:w.y,x:w.x,y:w.y,cx:e.clientX,cy:e.clientY,sm:0,moved:0,done:false,water:at(w.x|0,w.y|0)===WATER};
  if(at(w.x|0,w.y|0)===GRASS){lpT=setTimeout(()=>{lpT=0;if(!press||press.moved>1.1)return;press.done=true;
    if(!makeSpring(press.x0,press.y0)){for(let i=0;i<7;i++)fx.push({x:press.x0,y:press.y0,vx:rnd(-.7,.7),vy:-rnd(.3,1),c:'#9fd66a',l:.5});
      say('The ground here holds its water, and keeps it.',false,'nospring')}},520)}});
cv.addEventListener('pointermove',e=>{const pt=ptrs.get(e.pointerId);if(pt){pt.x=e.clientX;pt.y=e.clientY}
  if(pinch&&ptrs.size>=2){const a=[...ptrs.values()],k=vScale();
    const d=Math.max(20,Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)),mx=(a[0].x+a[1].x)/2,my=(a[0].y+a[1].y)/2;
    camX-=(mx-pinch.mx)*dprE/(k*T);camY-=(my-pinch.my)*dprE/(k*T);pinch.mx=mx;pinch.my=my;
    setZoom(pinch.z0*d/pinch.d0);clampCam();return}
  const w=toWorld(e);cur.x=w.x;cur.y=w.y;if(!press)return;
  const sdx=e.clientX-press.cx,sdy=e.clientY-press.cy;press.cx=e.clientX;press.cy=e.clientY;press.sm+=Math.abs(sdx)+Math.abs(sdy);
  if(press.sm>8&&lpT){clearTimeout(lpT);lpT=0}
  if(!press.water&&zoom>1.02&&press.sm>8){press.pan=true;const k=vScale();camX-=sdx*dprE/(k*T);camY-=sdy*dprE/(k*T);clampCam();return} // dragging the land drags the view; the water keeps its gust
  press.moved=Math.max(press.moved,Math.hypot(w.x-press.x0,w.y-press.y0));press.x=w.x;press.y=w.y;
  if(press.moved>1.1&&lpT){clearTimeout(lpT);lpT=0}
  if(press.water&&press.moved>1.5&&R()<.35)fx.push({x:w.x,y:w.y,vx:0,vy:0,c:'#dceeff',l:.3})});
function endPress(e){if(!press)return;const pr=press;press=null;if(lpT){clearTimeout(lpT);lpT=0}
  if(pr.done||pr.pan)return;
  const x=pr.x0,y=pr.y0;
  // a gust, dragged across the water
  if(pr.water&&pr.moved>2.2&&at(pr.x|0,pr.y|0)===WATER){gustAt(x,y,pr.x,pr.y);return}
  if(pr.moved>1.4)return;
  // an islander, and at night a dream
  let best=null,bd=1.4;for(const p of people){if(p.inside)continue;const d=Math.hypot(p.x-x,p.y-y+.6);if(d<bd){bd=d;best=p}}
  if(best){showCard(best);
    if(isNight()){if(isKid(best)&&best.task==='sleep'){lullaby(best.x,best.y);actDone('lullaby');noteAct('lullaby',.03);
        say(`Somewhere in the dark somebody is humming, very quietly, and ${B(best)} turns over and sleeps on.`,true)}
      dreamOf(best)}
    return}
  // the fire, and the story at it
  if(Math.hypot(x-center.x,y-center.y)<2.3){if(!tellStory())say('The fire has already had its story out of tonight.',false,'toldalready');return}
  // a cloud's shadow
  const c=cloudAt(x,y);if(c){rainOn(c);return}
  const t=at(x|0,y|0);
  if(t===GRASS){trees.push(mkTree((x|0)+.5,(y|0)+.5,.2));actDone('sapling');noteAct('sapling',.025);for(let i=0;i<6;i++)fx.push({x,y,vx:rnd(-1,1),vy:rnd(-1.5,-.3),c:'#9fd66a',l:.6});
    if(R()<.3)say('Someone unseen plants a sapling. The islanders do not question it.')}
  else if(t===WATER)skipStone(x,y)}
cv.addEventListener('pointerup',e=>{ptrs.delete(e.pointerId);if(ptrs.size<2)pinch=null;endPress(e)});
cv.addEventListener('pointercancel',e=>{ptrs.delete(e.pointerId);pinch=null;press=null;if(lpT){clearTimeout(lpT);lpT=0}});
addEventListener('pointerup',e=>{if(e.target!==cv){ptrs.delete(e.pointerId);if(ptrs.size<2)pinch=null;if(press)endPress(e)}});
document.getElementById('b-pause').onclick=()=>{paused=!paused;syncCtl()};
document.getElementById('b-s1').onclick=()=>setSpeed(1);
document.getElementById('b-s3').onclick=()=>setSpeed(3);
document.getElementById('b-s10').onclick=()=>setSpeed(10);
document.getElementById('b-sf').onclick=()=>setSpeed(FAST);
document.getElementById('b-morning').onclick=skipToMorning;
document.getElementById('b-chron').onclick=()=>showChron(chronEl.hidden);
document.getElementById('chron-x').onclick=()=>showChron(false);
document.getElementById('chron-dl').onclick=exportChron;
document.getElementById('chron-saga').onclick=exportSaga;
document.getElementById('b-share').onclick=saveHash;
document.getElementById('b-new').onclick=()=>{try{history.replaceState(null,'',location.pathname+location.search)}catch(err){}
  try{localStorage.removeItem('hearth.auto')}catch(e){} // a new island is chosen on purpose; the old one must not come back at the next boot
  newWorld((Math.random()*1e9)|0)};
document.getElementById('b-audio').onclick=e=>{if(!AC)startAudio();audioOn=!audioOn;if(AC.state==='suspended')AC.resume();
  master.gain.setTargetAtTime(audioOn?1:0,AC.currentTime,.12);
  e.target.textContent=audioOn?'sound on':'sound off';e.target.classList.toggle('on',audioOn);store('snd',audioOn?'1':'0');
  document.getElementById('b-music').classList.toggle('dim',!audioOn)};
document.getElementById('b-music').onclick=e=>{musOn=!musOn;e.target.textContent=musOn?'music on':'music off';e.target.classList.toggle('on',musOn);store('mus',musOn?'1':'0');
  if(AC&&!musOn)musG.gain.setTargetAtTime(0,AC.currentTime,.5)};
addEventListener('keydown',e=>{if(e.target&&e.target.tagName==='INPUT')return;
  const k=e.key.toLowerCase();
  if(k===' '||e.code==='Space'){paused=!paused;syncCtl();e.preventDefault()}
  else if(k==='1')setSpeed(1);else if(k==='3')setSpeed(3);else if(k==='0')setSpeed(10);else if(k==='y')setSpeed(FAST);
  else if(k==='m')skipToMorning();
  else if(k==='c')showChron(chronEl.hidden);
  else if(k==='s')document.getElementById('b-audio').click();
  else if(k==='n')document.getElementById('b-music').click()
  else if(k==='+'||k==='=')setZoom(zoom*1.25,camX,camY);
  else if(k==='-'||k==='_')setZoom(zoom/1.25,camX,camY);
  else if(e.key==='ArrowLeft'){camX-=5/zoom;clampCam();e.preventDefault()}
  else if(e.key==='ArrowRight'){camX+=5/zoom;clampCam();e.preventDefault()}
  else if(e.key==='ArrowUp'){camY-=4/zoom;clampCam();e.preventDefault()}
  else if(e.key==='ArrowDown'){camY+=4/zoom;clampCam();e.preventDefault()}});
// ---------- loop ----------
{const mb=document.getElementById('b-music');if(pref('mus')==='0'){musOn=false;mb.textContent='music off'}else mb.classList.add('on');
  if(pref('snd')!=='1')mb.classList.add('dim')}
{const ab=document.getElementById('b-audio');                                  // the sound toggle is remembered, but the browser still wants a gesture first
  if(pref('snd')==='1'){audioOn=true;ab.textContent='sound on';ab.classList.add('on');
    const kick=()=>{if(!AC)startAudio();if(AC&&AC.state==='suspended')AC.resume();
      removeEventListener('pointerdown',kick,true);removeEventListener('keydown',kick,true)};
    addEventListener('pointerdown',kick,true);addEventListener('keydown',kick,true)}}
{let ok=false;try{ok=loadHash()}catch(err){ok=false}
  if(!ok){const a=pref('auto');if(a)try{const o=JSON.parse(lzDec(a));if(canLoad(o)){unpack(o);say('The island kept itself while you were away.',true);ok=true}}catch(err){ok=false}}
  if(!ok)newWorld(seed);syncCtl()}
let last=performance.now(),frameN=0,genAcc=0;
// One frame of the world: the steps, then everything that is only there to be seen or heard. Split out of loop() so the harness can
// drive real frames at either speed and compare the two islands. The log and the chronicle are written inside step() and newDay(),
// which is why the generational speed keeps them for nothing.
function frame(dt,run){
  if(run)for(let i=0;i<speed;i++)step(dt);
  if(speed<FAST){audioTick(dt);hintTick(dt);cardT-=dt;renderCard(false);draw();return}
  genAcc+=dt;
  // at 240x a person crosses ten tiles between frames, so three paints in four buy nothing; the hints are for somebody who has just
  // arrived, and this is not their speed. audioTick gets the whole accumulated dt, so its timers run at the wall clock they always did.
  if((++frameN&3)===0){audioTick(genAcc);cardT-=genAcc;genAcc=0;renderCard(false);draw()}}
function loop(now){let dt=Math.max(0,Math.min(.05,(now-last)/1000));last=now; // clamped at 0: the first frame's timestamp can predate performance.now(), and time must never run backward
  frame(dt,!paused);requestAnimationFrame(loop)}
requestAnimationFrame(loop);
// exposed for headless testing only
window.__hearth={step,draw,frame,FAST,get speed(){return speed},set speed(v){speed=v},get paused(){return paused},get trees(){return trees},get people(){return people},get graves(){return graves},get dead(){return dead},get gone(){return gone},get bldg(){return bldg},get boats(){return boats},get village(){return village},get road(){return road},get stream(){return stream},get landings(){return landings},get heat(){return heat},get bldgTgt(){return bldgTgt},get wild(){return wild},get gulls(){return gulls},get flies(){return flies},get geese(){return geese},get whale(){return whale},get farIsle(){return farIsle},get voyage(){return voyage},get ruin(){return ruin},get fishSh(){return fishSh},get events(){return events},get chron(){return chron},get springs(){return springs},get clouds(){return clouds},get skips(){return skips},get houses(){return houses},get farms(){return farms},get dayCount(){return dayCount},get food(){return food},get granary(){return granary},get hunger(){return hunger},get wx(){return wx},get snowD(){return snowD},get frozen(){return frozen},get wood(){return wood},get time(){return time},get seed(){return seed},setTime:t=>time=t,setWhaleT:v=>whaleT=v,setGeeseDay:v=>geeseDay=v,setWx,setSnow:v=>snowD=v,setSpeed,setFood:v=>food=v,setGranary:v=>granary=v,landAt,canWalk,canWade,routeVia,autoSave,get wadeTiles(){return wadeTiles},get bridgeUp(){return bridgeUp},get bridgeSite(){return bridgeSite},get works(){return works},get dry01(){return dry01},setDry:v=>dry01=v,get breadYr(){return breadYr},WORKS,WORK_ORDER,hasW,get spots(){return spots},
get faith(){return faith},setFaith:v=>faith=v,get faithSt(){return faithSt},get prayer(){return prayer},faithDay,get arc(){return arc},startArc,get ways(){return ways},setWays:v=>ways=v,hasWay,get temper(){return temper},noteAct,get acts(){return acts},get sickCount(){return people.filter(p=>p.sick).length},
get want(){return want},get wantYr(){return wantYr},setWantYr:v=>wantYr=v,declareWant,wantRaid,wantShort,endWant,workRateOf:workRate,
get ill(){return ill},takeSick,illDay,endIll,wellAgain,canTake,nursedBy,sickBed,illChanceOf:illChance,SICKD,WAVED,WELLD,
get things(){return things},get heirYr(){return heirYr},thingsOf,craftUp,finishWork,die,stoneTap,wayTune,wayN,
get lorePl(){return lorePl},get walkP(){return walkP},madeOf:ci=>MADE(ci),LORE_PLACE,
get loreN(){return loreN},setLoreN:(k,n)=>loreN[k]=n,boundsOut,get boundsYr(){return boundsYr},get boundsP(){return boundsP},
get farRec(){return farRec},farSeed,farLearn,farCross,farReturn,farTrade,farLink,leave,spawnBoat,setVoyage:v=>voyage=v,setWood:v=>wood=v,FARGOODS,
get songs(){return songs},get snowmen(){return snowmen},get skipN(){return skipN},setSkipN:v=>skipN=v,yearName,musical,auroraNight,kinOf,skinOf,chatNews,loseSongs,get shoots(){return shoots},get starDay(){return starDay},get rbUntil(){return rbUntil},rbSet:v=>rbUntil=v,get storyDay(){return storyDay},
migrate,forge,canLoad,SAVE_V,SAVE_MIN,setZoom,get zoom(){return zoom},get view(){return{zoom,camX,camY,dprE,fitS}},toWorld,fit,get sackUsed(){return sackUsed},get musOn(){return musOn},set musOn(v){musOn=v},newWorld,flavor,drawFace,byName,startAudio,audioTick,lullaby,thock,hammer,creak,gullCry,whoosh,splash,bell,chirp,plink,thunder,place,cur,songTune,songDegrees,get audioOn(){return audioOn},set audioOn(v){audioOn=v},get AC(){return AC},get buses(){return{master,ambG,sfxG,musG,windG,waveG,rainG,sprG,crickG,padG}},get RM(){return RM},get lastKnock(){return lastKnock},set RM(v){RM=v},tellStory,dreamOf,wakeDreams,makeSpring,skipStone,gustAt,rainOn,cloudAt,addCloud,skipToMorning,pack,unpack,lzEnc,lzDec,saveHash,loadHash,islandHash,renderChron,exportChron,exportSaga,sagaHTML,showChron};
