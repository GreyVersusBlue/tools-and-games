/* Hearth, the public island's page (C4 of DESIGN-arc-three.md). Loaded last, and only by live.html. The server (server/live.mjs) runs the real game at
   a step the wall clock names and publishes a snapshot at every epoch; this page takes the current snapshot, steps the same island forward at the
   server's own pace with the same fixed dt, and at each epoch compares its own pack() with the snapshot's hash before taking the server's. It never
   sends anything and never writes hearth.auto (autoSave() returns at once when LIVE). Every name here starts lv so none can meet another file's. */
const LV_BOOT_STEPS=600;                       /* the most steps a frame while catching up: an island day is 2,800, so a day is five frames */
const LV_FIRST=2240;                           /* global step of epoch 1; epoch k is LV_FIRST+epochSteps*(k-1), and epoch 0 is the founding (server/world.mjs epochStep) */
const lvTune=window.HEARTH_LIVE_TUNE||{};      /* test/live.mjs sets the two waits short; nothing on the site sets it */
const lvRetryMs=lvTune.retry||2000,lvBreathMs=lvTune.breath||90000;
let lvCfg=null,lvOff=0,lvStep=0,lvEpoch=0,lvHold=false,lvReady=false,lvDead=false,lvLast=0,lvMis=0,lvLog=[],lvBreath=false,lvStatKey='',lvRebootAt=-1e9;
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
function lvLoad(body){const o=JSON.parse(lzDec(body.save));if(!canLoad(o))throw new Error('this island cannot be loaded');unpack(o);lvStep=body.step;lvEpoch=body.n}
function lvStale(){if(lvCfg.saveV>SAVE_V){lvDead=true;lvSay('The island has changed. Reload the page to see it.');return true}return false}
async function lvStart(){
  try{lvCfg=await lvFetchLive()}catch(e){lvOffline();return}
  if(lvStale())return;
  try{lvLoad(await(await lvGet('/hearth-live/epoch/'+lvCfg.era+'-'+lvCfg.epoch+'.json')).json())}catch(e){lvOffline();return}
  lvReady=true;lvStat()}
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
  const yr=yearOf(dayCount);lvEl('live-status').textContent=(village||'The island')+' · year '+yr+', '+yearName(yr)+' · day '+dayCount+' · '+alive+' people'}
/* one frame: the steps the wall clock says are due, at the server's fixed dt and never the frame's own, then the picture and the sound */
function liveFrame(now){
  const rdt=lvLast?Math.max(0,Math.min(.05,(now-lvLast)/1000)):0;lvLast=now;
  if(!lvReady||lvDead)return;
  animT+=rdt;
  if(!lvHold){
    const due=lvCfg.clock.step+Math.max(0,Math.floor((Date.now()+lvOff-lvCfg.clock.at)/lvCfg.clock.stepMs));
    if(due-lvStep>lvCfg.epochSteps&&performance.now()-lvRebootAt>10000)lvReboot();
    else{
      const next=lvEpochStep(lvEpoch+1),n=Math.max(0,Math.min(due-lvStep,LV_BOOT_STEPS,next-lvStep));
      for(let i=0;i<n;i++)step(lvCfg.dt);
      lvStep+=n;
      if(lvStep===next)lvBoundary(lvEpoch+1)}}
  audioTick(rdt);cardT-=rdt;renderCard(false);draw();lvStat()}
window.__hearthLive={get step(){return lvStep},get epoch(){return lvEpoch},get log(){return lvLog},get mismatches(){return lvMis},get ready(){return lvReady},get breath(){return lvBreath},get dead(){return lvDead}};
lvStart();
