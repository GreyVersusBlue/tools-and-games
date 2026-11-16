/* Hearth, the public island's page (C4 of DESIGN-arc-three.md). Loaded last, and only by live.html. The server (server/live.mjs) runs the real game at
   a step the wall clock names and publishes a snapshot at every epoch; this page takes the current snapshot, steps the same island forward at the
   server's own pace with the same fixed dt, and at each epoch compares its own pack() with the snapshot's hash before taking the server's. It never
   sends anything and never writes hearth.auto (autoSave() returns at once when LIVE). Every name here starts lv so none can meet another file's. */
const LV_BOOT_STEPS=600;                       /* the most steps a frame while catching up: an island day is 2,800, so a day is five frames */
const LV_FIRST=2240;                           /* global step of epoch 1; epoch k is LV_FIRST+epochSteps*(k-1), and epoch 0 is the founding (server/world.mjs epochStep) */
const lvTune=window.HEARTH_LIVE_TUNE||{};      /* test/live.mjs sets the two waits short; nothing on the site sets it */
const lvRetryMs=lvTune.retry||2000,lvBreathMs=lvTune.breath||90000;
/* C5: the record. At most 40 lines in the away panel; a link longer than 1.5 million characters is not offered; a look back runs 28 steps a frame, which is
   a day of 72 epochs in about two minutes at 60 frames a second (test/live.mjs sets the third to run faster). */
const LV_AWAY_MAX=40,LV_COPY_MAX=1500000,lvBackRate=lvTune.back||28;
let lvCfg=null,lvOff=0,lvStep=0,lvEpoch=0,lvHold=false,lvReady=false,lvDead=false,lvLast=0,lvMis=0,lvLog=[],lvBreath=false,lvStatKey='',lvRebootAt=-1e9,lvBody=null,lvBack=null,lvBackFrom=-1,lvNowDay=0;
const lvEl=id=>document.getElementById(id);
const lvEpochStep=n=>n===0?0:LV_FIRST+lvCfg.epochSteps*(n-1);
const lvSleep=ms=>new Promise(ok=>setTimeout(ok,ms));
function lvFnv(s){let h=2166136261>>>0;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0}return h.toString(16)+':'+s.length}
function lvSay(text,link){const el=lvEl('live-note');el.textContent='';if(!text){el.hidden=true;return}el.hidden=false;el.textContent=text;
  if(link){const a=document.createElement('a');a.href=link[0];a.textContent=link[1];el.appendChild(document.createTextNode(' '));el.appendChild(a)}}
function lvShowBreath(on){if(on===lvBreath)return;lvBreath=on;lvSay(on?'The island is catching its breath.':'')}
function lvOffline(){lvDead=true;lvSay('The public island is kept on the site and cannot be reached from here.',['index.html','Play your own island'])}
async function lvGet(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(url+' '+r.status);return r}
/* the clock offset is the server's Date header less this machine's clock; the header has whole seconds, so half a second is added back */
async function lvFetchLive(){const r=await lvGet('/hearth-live/live.json?'+Date.now()),d=Date.parse(r.headers.get('Date')||'');if(d===d)lvOff=d+500-Date.now();return r.json()}
function lvLoad(body){const o=JSON.parse(lzDec(body.save));if(!canLoad(o))throw new Error('this island cannot be loaded');unpack(o);lvStep=body.step;lvEpoch=body.n;lvBody=body;lvCopyUpdate(body)}
function lvStale(){if(lvCfg.saveV>SAVE_V){lvDead=true;lvSay('The island has changed. Reload the page to see it.');return true}return false}
async function lvStart(){
  try{lvCfg=await lvFetchLive()}catch(e){lvOffline();return}
  if(lvStale())return;
  try{lvLoad(await(await lvGet('/hearth-live/epoch/'+lvCfg.era+'-'+lvCfg.epoch+'.json')).json())}catch(e){lvOffline();return}
  lvReady=true;lvStat();lvAway()}
/* more than an epoch behind (a tab that was hidden, a laptop that slept): take the newest snapshot instead of stepping a long way */
async function lvReboot(){lvHold=true;lvRebootAt=performance.now();
  try{const c=await lvFetchLive();lvCfg=c;if(!lvStale())lvLoad(await(await lvGet('/hearth-live/epoch/'+c.era+'-'+c.epoch+'.json')).json())}catch(e){lvShowBreath(true)}
  lvHold=false}
/* the island is at the step of epoch k: its own hash, then the server's snapshot. The server's wins, whatever the hash said. */
async function lvBoundary(k){lvHold=true;
  const mine=lvFnv(JSON.stringify(pack())),t0=performance.now();let body=null;
  while(!body){
    try{const r=await fetch('/hearth-live/epoch/'+lvCfg.era+'-'+k+'.json',{cache:'no-store'});if(r.ok)body=await r.json()}catch(e){}
    if(body)break;
    if(performance.now()-t0>lvBreathMs)lvShowBreath(true);
    await lvSleep(lvRetryMs)}
  lvLog.push({n:k,step:lvStep,mine,theirs:body.hash});
  if(mine!==body.hash){lvMis++;console.info('hearth live: epoch '+k+' differs, here '+mine+' and on the server '+body.hash)}
  try{lvLoad(body)}catch(e){lvDead=true;lvSay('The island has changed. Reload the page to see it.')}
  lvShowBreath(false);
  try{const c=await lvFetchLive();lvCfg=c;lvStale()}catch(e){} /* the same file again keeps the clock offset fresh and notices a new save version */
  lvHold=false}
function lvStat(){const alive=people.filter(p=>!p.dead).length,key=village+'|'+dayCount+'|'+alive;if(key===lvStatKey)return;lvStatKey=key;
  if(!lvBack)lvNowDay=dayCount;const yr=yearOf(dayCount);lvEl('live-status').textContent=(village||'The island')+' · year '+yr+', '+yearName(yr)+' · day '+dayCount+' · '+alive+' people'}
/* ---- C5: what happened while you were away, the way to keep it, and yesterday at speed ---- */
/* hearth.liveSeen is "era:day" of the last visit. It is read here and written here and by nothing else; the simulation never sees it. */
function lvSeenGet(){try{const m=/^(\d+):(\d+)$/.exec(localStorage.getItem('hearth.liveSeen')||'');return m?{era:+m[1],day:+m[2]}:null}catch(e){return null}}
function lvSeenPut(){if(!lvReady||!lvNowDay)return;try{localStorage.setItem('hearth.liveSeen',lvCfg.era+':'+lvNowDay)}catch(e){}}
/* the lines of the chronicle a visitor has not seen: every entry whose day is later than the day they last saw (a new era is all unseen), the last 40, oldest first */
function lvUnseen(seen){return chron.filter(e=>!seen||seen.era!==lvCfg.era||e.d>seen.day).slice(-LV_AWAY_MAX)}
function lvAway(){
  const seen=lvSeenGet();lvNowDay=dayCount;
  if(!seen){lvSeenPut();return}
  const L=seen.era===lvCfg.era&&seen.day>=dayCount?[]:lvUnseen(seen);
  if(!L.length){lvSeenPut();return}
  let h='',cy=0;
  for(const e of L){if(e.y!==cy){cy=e.y;const yn=yearName(cy);h+=`<h4>year ${cy}${yn?` <span>${yn}</span>`:''}</h4>`}
    h+=`<p><i>day ${e.d}</i>${sagaText(e.st||e.label)}</p>`}
  lvEl('lv-away-roll').innerHTML=h;
  lvEl('lv-away-s').textContent=L.length===1?'one thing since you were last here':L.length+' things since you were last here';
  lvEl('live-away').hidden=false}
function lvAwayClose(){lvEl('live-away').hidden=true;lvSeenPut()}
/* the copy is the epoch's own save string, the same one the snapshot file holds, so loadHash on index.html opens exactly that island */
function lvCopyUpdate(body){const a=lvEl('lv-copy'),long=body.save.length>LV_COPY_MAX;
  a.hidden=long;lvEl('lv-long').hidden=!long;if(!long)a.href='index.html#'+body.save}
/* yesterday: the epoch a real day back, or the oldest one kept. Epochs in a real day follow from the clock, so a different pace needs no change here. */
async function lvLookBack(){
  if(lvBack||!lvReady||lvDead)return;
  for(let i=0;lvHold&&i<50;i++)await lvSleep(200);   /* an epoch or a reboot is being taken: wait for it, ten seconds at most */
  if(lvBack||lvHold||lvDead)return;
  lvHold=true;
  const per=Math.max(1,Math.round(86400e3/(lvCfg.clock.stepMs*lvCfg.epochSteps))),cur=lvEpoch;let n=Math.max(0,cur-per),body=null;
  while(n<cur&&!body){try{const r=await fetch('/hearth-live/epoch/'+lvCfg.era+'-'+n+'.json',{cache:'no-store'});if(r.ok)body=await r.json()}catch(e){break}
    if(!body)n++}
  if(!body){lvHold=false;lvSay('Nothing earlier than this is kept yet.');return}
  lvSeenPut();
  try{lvLoad(body)}catch(e){lvHold=false;return}
  lvBack={to:lvEpochStep(cur)};lvBackFrom=body.step;lvSay('');
  lvEl('live-back').hidden=false;lvEl('live-tools').style.visibility='hidden';
  lvHold=false}
/* back to the present by fetching it again, never by trusting what the look back computed */
async function lvBackEnd(){
  if(!lvBack)return;
  lvBack=null;lvEl('live-back').hidden=true;lvEl('live-tools').style.visibility='';
  await lvReboot()}
/* one frame: the steps the wall clock says are due, at the server's fixed dt and never the frame's own, then the picture and the sound */
function liveFrame(now){
  const rdt=lvLast?Math.max(0,Math.min(.05,(now-lvLast)/1000)):0;lvLast=now;
  if(!lvReady||lvDead)return;
  animT+=rdt;
  if(lvBack&&!lvHold){const m=Math.max(0,Math.min(lvBackRate,lvBack.to-lvStep));for(let i=0;i<m;i++)step(lvCfg.dt);lvStep+=m;if(lvStep>=lvBack.to)lvBackEnd()}
  else if(!lvHold){
    const due=lvCfg.clock.step+Math.max(0,Math.floor((Date.now()+lvOff-lvCfg.clock.at)/lvCfg.clock.stepMs));
    if(due-lvStep>lvCfg.epochSteps&&performance.now()-lvRebootAt>10000)lvReboot();
    else{
      const next=lvEpochStep(lvEpoch+1),n=Math.max(0,Math.min(due-lvStep,LV_BOOT_STEPS,next-lvStep));
      for(let i=0;i<n;i++)step(lvCfg.dt);
      lvStep+=n;
      if(lvStep===next)lvBoundary(lvEpoch+1)}}
  audioTick(rdt);cardT-=rdt;renderCard(false);draw();lvStat()}
/* the saga lives in the server's folder, not in this repo, so the links are set here and the site's link check does not look for a file that is not there */
lvEl('lv-saga').href=lvEl('lv-away-saga').href='/hearth-live/saga.html';
lvEl('lv-away-x').onclick=lvEl('lv-away-ok').onclick=lvAwayClose;lvEl('lv-back').onclick=lvLookBack;lvEl('lv-now').onclick=lvBackEnd;
addEventListener('pagehide',lvSeenPut);
window.__hearthLive={get step(){return lvStep},get epoch(){return lvEpoch},get log(){return lvLog},get mismatches(){return lvMis},get ready(){return lvReady},get breath(){return lvBreath},get dead(){return lvDead},get back(){return !!lvBack},get backFrom(){return lvBackFrom},get nowDay(){return lvNowDay}};
lvStart();
