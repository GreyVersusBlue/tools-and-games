// Hearth — rng & noise, world constants and shared state, worldgen, terrain painting, and the people primitives. Loaded first.
// Classic scripts sharing one global scope; the load order in index.html is the old single file’s order and it matters.
// ---------- rng & noise ----------
let seed=(Math.random()*1e9)|0;
function mulberry(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
let R;
const rnd=(a=1,b)=>b===undefined?R()*a:a+R()*(b-a), pick=a=>a[(R()*a.length)|0], hash=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0};
function noise2(){const p=[];for(let i=0;i<256;i++)p[i]=R();const h=(x,y)=>p[((x*49+y*131)&255)^((x*7)&255)];const sm=t=>t*t*(3-2*t);
  return(x,y)=>{const xi=Math.floor(x),yi=Math.floor(y),xf=sm(x-xi),yf=sm(y-yi);
  const a=h(xi,yi),b=h(xi+1,yi),c=h(xi,yi+1),d=h(xi+1,yi+1);return a+(b-a)*xf+(c-a)*yf+(a-b-c+d)*xf*yf}}
// ---------- world ----------
const W=110,H=70,T=8,YEAR=20;const cv=document.getElementById('c');cv.width=W*T;cv.height=H*T;const g=cv.getContext('2d');
const ter=document.createElement('canvas');ter.width=W*T;ter.height=H*T;const tg=ter.getContext('2d');
let tiles,elev,trees,houses,farms,people,stumps,fx,wood,food,time,dayLen=140,dayCount,rain,storm,speed=1,center,names,evT,arrivalT,fires,shore,spots,hill,graves,dead,events,saidToday,usedTpl,selected,lastYear;
// sprint 2 state: weather machine, snow/ice, granary & hunger, tides, fog
let wx='clear',wxT=0,fogA=0,flash=0,snowD=0,frozen=false,granary=0,hunger=0,lastSea='spring',tideTiles=[],thunderT=0,paintedKey='',gone=[],leafT=0;
// sprint 3 state: buildings, boats, roads, village name
let bldg=[],bldgTgt=null,boats=[],heat,road,roadV=0,village=null,landings=[],lightSite=null,stream=[],bridgeSite=null,traderDay=0,belled=0,trader=null,smokeT=0;
// sprint 4 state: wildlife, the far island and its voyage, ruins
let deep=[],wild=[],flies=[],gulls=[],geese=null,geeseDay=0,whale=null,whaleT=0,whaleDay=0,farIsle=null,voyage=null,ruin=null,fishSh=[],ruinSeen=0;
// phase 5 state: the far island as a place — the seed of the island out there, the name this one calls it, whether that name has crossed yet, and what has.
let farRec=null;
// sprint 5 state: the watcher's blessings, clouds, the chronicle, time
let springs=[],clouds=[],cloudSp=[],gusts=[],skips=[],chron=[],wind=1,paused=false,storyDay=0,dreamAny=0;
// sprint 7 state: the sack kept against the first hard year
let sackUsed=false;
// sprint 9 state: which water a person may wade (the stream), and whether the bridge is up to carry them over it
let wadeTiles=new Set(),bridgeUp=false;
// sprint 10 state: crafts, the works that come after the buildings, dry ground, bread, the ones who come back
const CRAFTS=['field','wood','sea','frame','store'];
const CRAFT_EPITHET=['who keeps the fields','who reads the trees','who reads the water','who raises the beams','who keeps the store'];
let works=[],dry01=0,breadYr=0,retYr=0;
const hasW=k=>works.some(w=>w.wk===k&&w.done);
// sprint 11 state: the island's temper, the year's fortunes (arcs), the ways the village learns for good, and the quiet account it keeps of the watcher
const TEMPERS=['kind','rainy','dry','windy','cold'];
let temper='kind',arc=null,arcYr=0,wayYr=0,bookYr=0,ways=0,lastStormDay=0,rainedDay=0,wreckYr=0,famDone=false;
let faith=0,faithSt=0,acts=[],prayer=null;
const hasWay=i=>!!(ways>>i&1);
const arcK=()=>arc?arc.k:'';
// sprint 12 state: the things that get handed down, each with its own small history, and the year of the first handing
let things=[],heirYr=0;
// sprint 13 state: the places the grown stories put names on, and the walk that does the naming (walkP is the morning's errand; it is not saved)
let lorePl=[],walkP=null;
// sprint 14 state: how often each named place has been walked (the stones pile up), and the year's walking of the bounds (boundsP is transient)
let loreN={},boundsP=null,boundsYr=0;
// sprint 16 state: the songs the island composes and can lose (kept), the snowmen the children build (kept), the count of stones the
// watcher has skipped (kept — the children copy what they have seen done), and the sky's transient spectacle (never saved)
let songs=[],snowmen=[],skipN=0,rbUntil=0,shoots=[],starDay=0;
// phase 6 state: the winter the store will not cover, and what the village decides about it. `want` is the rationing itself —
// the day it was called, who counted, how many elders have quietly stood down from their measure, whether the store has been raided
// and by whom — and it is null every day the island is not on rations. `wantYr` holds the reckoning to once a year at most.
// Everything hanging off it is undone at the thaw: a famine that outlives its winter is a bug, not a hardship.
let want=null,wantYr=0;
/* what a store has to cover per head between the first frost and the first harvest after it — the number the reckoning is held against */
const COLD=19;
// phase 6 state: the sickness that walks the paths. `ill` is the wave — the day it started, how many have taken it, who had it first
// and how many times somebody sat up with somebody — and it is null on every day nobody on the island is in bed. It is not the fever
// arc: the arc is one bad season for it, the wave is what the arc (or one cough in one house) sets going, and the wave outlives the
// arc by as long as the last person takes to get up. Every wave ends, and it ends by the calendar rather than by a roll, the way the
// thaw does (#70): nobody is ill for more than SICKD days, and after WAVED days the wave has been through everyone it is going to.
// Shaking it off leaves you proof against it for WELLD days, which is what stops one wave from going round the village twice.
let ill=null;
const SICKD=6, WAVED=12, WELLD=14;
/* how near is near enough to hand it over, and the per-step chance at that range — one draw per susceptible person per step, and
   only while somebody is actually in bed, so an island with nobody ill is on exactly the stream it was on before */
const CATCH=1.9, CATCHR=.004;
// phase 6 state: the feud. `feud` is a rival pair given somewhere to live — the day it started, the two names, whether it has outlived
// a thaw, and how many nights at the store it has in it — and it is null on every day nobody on the island is not speaking to somebody
// on purpose. The raid opens one and nothing else does. While it lives the two work at .8, neither goes where the other is standing
// (within FEUDR tiles), the two never stop to talk, and their children keep the same distance without being told. It ends squared,
// walked, parted or worn, and FEUDD is the cap the way SICKD is the sickness's (#73): no feud is older than FEUDD days on any island,
// ever — a thing two people have kept up for two years is a habit, not a feud, and the village stops counting it.
let feud=null;
const FEUDD=40, FEUDR=4;
/* who carries a tune: from the seed alone, no rnd() — old links get their singers retroactively and identically */
const musical=p=>((p.seed>>>4)%5)===0;
/* whether tonight is an aurora night: pure function of seed and day, so every device that opens this island agrees */
const auroraNight=()=>sea()==='winter'&&(((seed^Math.imul(dayCount,2654435761))>>>0)%100)<(temper==='cold'?45:12);
const thingsOf=n=>things.filter(t=>t.holder===n);
const wayN=()=>(ways&1)+(ways>>1&1)+(ways>>2&1)+(ways>>3&1);
const Cap=s=>s[0].toUpperCase()+s.slice(1);
// what a master makes, once, in the year of the mastering — per craft, three ways it might come out (sprint 13: which one is the island's,
// from the seed alone — no rnd(), so old links keep their exact streams). MADE(ci) -> [the full first description, the short name it goes by after]
const MADEV=[
 [['a seed jar with a lid worked like weather','the seed jar'],['a seed jar with a lid carved as a wave about to land','the wave-lid jar'],['a seed jar rubbed with green ochre, the colour of the first shoots','the green jar']],
 [['a bowl turned from a burl, thin as an eggshell','the burl bowl'],['a bowl turned from the storm-oak, dark as the night it fell','the storm-oak bowl'],['a bowl turned so thin the light comes through it','the pale bowl']],
 [['a knife with a whalebone handle','the whalebone knife'],['a knife with a driftwood handle worn to silk','the driftwood knife'],['a knife hafted in cord, waxed till it might as well be stone','the corded knife']],
 [['a child\'s chair, joined without one peg showing','the little chair'],['a child\'s chair with arms carved like two gulls\' heads','the gull chair'],['a cradle that rocks true in any draught','the cradle']],
 [['a balance-scale small enough for a pocket','the pocket scale'],['a measuring-cup marked in rings, honest to a grain','the honest cup'],['a counting-frame whose beads click like rain starting','the counting frame']]];
const MADE=ci=>MADEV[ci][(seed>>>(ci*2+1))%3];
// how the big stories grow, once they have been told at the fire enough times
const GROW={
  drought:['By now the dust in the story stands higher than it ever stood on the fields.','In the telling, the well never once ran dry, which is nearly true.'],
  rainscame:['The storm that broke it gets bigger every winter it is told.','Half the village now remembers standing out in that rain. It was not half the village. It is now.'],
  hardwinter:['The snow in that story has been getting deeper for years.','Every telling, one more wolf is heard in it. No wolf was ever seen.'],
  fever:['In the telling now, nobody was ever really afraid, which is not how it was.'],
  ill:['The number who took it goes up by one most years it is told, and the number who sat up with them by two.','In the telling it went round every house on the island. It went round rather fewer, and every house heard about it.'],
  nursed:['By now the story has them sitting up three nights. It was one night, and it was enough.'],
  want:['The number in that story gets smaller every year it is told, and the winter longer.','By now the story has the store down to one lid and a handful, which it was not, quite.'],
  raid:['Nobody in the story is named any more. Everybody listening knows anyway, and that is how it is kept.'],
  kept:['Every year the story adds a winter to it. By now it has lasted longer than any two people could have kept it up.'],
  squared:['In the telling now the two of them were never really at odds, only busy, which everyone listening knows to be false.'],
  parted:['The one left holding both halves of it holds them a little more lightly each time it is told.'],
  walked:['In the story the children knew what the walk was for before the elder did, and led the way.'],
  worn:['By now nobody in the telling can say what it was about either, which is exactly how it ended.'],
  gave:['In the telling now, the plate goes round three times before it comes back full. It went round once.'],
  shoal:['The fish in that story have grown a hand-span since it happened.','By now the story says you could walk across the bay on them, and nobody says otherwise.'],
  left:['The sea in that story has grown rougher with the years, to make the going kinder.'],
  stayed:['The light on the far island burns brighter in the story than it ever does on the water.'],
  found:['In the story now, the stones give it up on purpose, into the right hands.'],
  answered:['Each telling, the asking and the coming stand a little closer together.'],
  noticed:['The first saplings in that story are a whole wood now.'],
  way:['In the story it came all at once, in one morning, like weather. It did not. It is better that way.'],
  back:['The boat that came back rides lower in the story every year, loaded with everything the years away were supposed to have been.'],
  keeper:['The fire in that story burns three nights now. It was one. It has earned the other two.'],
  shrine:['The flat stone has grown in the telling; by now it took four to raise it. It took one.'],
  build:['The raising of it goes quicker in the story than it went in the weather.'],
  heir:['The list of hands it has passed through gets one hand longer every few tellings.'],
  landing:['The boat in that story has been getting smaller, and the sea bigger, for years now.','In the telling there was nothing here at all when they landed, not even the birds. The birds were here.'],
  name:['By now the story insists the name was always there, waiting under the grass to be found.'],
  temper:['The island in that story grows a little kinder every year, or a little fiercer, depending on who is telling.'],
  death:['The hill is a little higher each time it is climbed in the telling.'],
  mastery:['In the story nobody ever taught them; the hands simply knew. There was teaching. The story has no room for it.'],
  bread:['Every winter the loaves in that story come out bigger, and the night outside them colder.'],
  place:['In the story the name was always there, the way the hill was, and the walk out to it only went to check.'],
  farname:['In the telling now the name came across on its own, on the wind, and nobody had to be told it twice.'],
  farcame:['The crossing gets longer in that story every year, and the boat in it smaller.'],
  fartrade:['What came off that boat gets rarer every telling, and from further off than anywhere anyone has been.'],
  bounds:['Each spring the walk gets longer in the telling, and the stone in the pocket heavier, and the children better behaved than any children have ever been.']};
// sprint 13: the ground under the big stories. When a story has grown, the place it happened can take a name and join the island's
// geography for good. at() reads live world state and must stay rnd()-free — it is re-run at load to put the named places back.
const LORE_PLACE={
 landing:{l:'where the boat first came in',at:()=>landings.length?{x:landings[0].x,y:landings[0].y}:(nearestShore(center.x,center.y)||center)},
 back:{l:'where they watch for boats',at:()=>landings.length?{x:landings[0].x,y:landings[0].y}:(nearestShore(center.x,center.y)||center)},
 rainscame:{l:'where they stood in the rain',at:()=>farms.length?{x:farms[0].x+.5,y:farms[0].y+.5}:center},
 shoal:{l:'where the fish came in',at:()=>{const h=getB('hut');return(h?nearestShore(h.x,h.y):nearestShore(center.x,center.y))||center}},
 stayed:{l:'the shore that faces the far island',at:()=>{if(!farIsle)return null;const fx=farIsle.x+farIsle.w/2;let b=null,bd=1e9;for(const s of shore){const d=Math.hypot(s.x-fx,s.y);if(d<bd){bd=d;b=s}}return b}},
 found:{l:'where the ground gave it up',at:()=>ruin?{x:ruin.x,y:ruin.y+1.6}:null},
 bread:{l:'the mill path',at:()=>{const m=getB('mill');return m?{x:m.x+1,y:m.y+2.6}:null}},
 way:{l:'where the new way was tried first',at:()=>{const e=chron.find(x=>x.kind==='way'&&x.gr);if(!e)return null;
   if(e.label.includes('the sail')){const h=getB('hut');return h?nearestShore(h.x,h.y):null}
   if(e.label.includes('the plough'))return farms.length?{x:farms[0].x+.5,y:farms[0].y+.5}:null;
   return null}}}; /* the kiln and the book have no one place; that is allowed — some stories happen everywhere */
let RM=false;try{const mq=matchMedia('(prefers-reduced-motion: reduce)');RM=mq.matches;
  if(mq.addEventListener)mq.addEventListener('change',e=>{RM=e.matches});else if(mq.addListener)mq.addListener(e=>{RM=e.matches})}catch(e){}
const V=()=>village||'the village';
const BLD={
  hut:{name:'the fishing hut',w:2,h:1,wood:16,work:36,cond:()=>people.length>=7&&landings.length>0},
  well:{name:'the well',w:1,h:1,wood:8,work:24,cond:()=>people.length>=10},
  market:{name:'the market square',w:3,h:3,wood:12,work:44,cond:()=>people.length>=13&&houses.length>=6},
  mill:{name:'the mill',w:2,h:2,wood:24,work:60,cond:()=>farms.length>=8&&people.length>=11},
  smoke:{name:'the smokehouse',w:2,h:1,wood:18,work:44,cond:()=>hasB('hut')&&people.length>=15},
  bridge:{name:'the bridge',w:1,h:1,wood:12,work:30,cond:()=>!!bridgeSite&&dayCount>=12},
  hall:{name:'the hall',w:3,h:2,wood:30,work:80,cond:()=>people.length>=17},
  light:{name:'the lighthouse',w:1,h:1,wood:30,work:70,cond:()=>people.length>=20&&!!lightSite}};
const hasB=k=>bldg.some(b=>b.kind===k), getB=k=>bldg.find(b=>b.kind===k);
const NAME1=['Salt','Grey','Fen','Low','High','Bell','Stone','Ash','Wyn','Rook','Little','Hearth','Gull','Elm','Cold','Fair','Nether','Wend'],NAME2=['wick','ford','stead','holm','ness','mere','by','combe','stow','haven','strand','hollow','thorpe','sea','shaw'];
const fogCv=document.createElement('canvas');fogCv.width=W*T;fogCv.height=H*T;const fg=fogCv.getContext('2d');
// ---------- phase 5: the far island is a place ----------
// The silhouette on the horizon gets a seed of its own, and it is this island's, flipped. seed^FI_K is an involution, so the island
// the link opens has *this* one on its horizon and calls it back by the same rule — two islands that name each other, out of one
// constant and no stored pair. Nothing over there is simulated: the record is a name, a seed, and a list of what has crossed. It is
// derived from the seed alone with no R() draws, because worldgen's stream is the contract every old link is standing on.
const FI_K=0x5f1a1e;
const farSeed=s=>((s^FI_K)>>>0);
const farNameOf=s=>NAME1[(s>>>5)%NAME1.length]+NAME2[(s>>>13)%NAME2.length];
const farKnown=()=>!!(farRec&&farRec.kn);
const farN=()=>farRec?farRec.n:'the far island';
// What has crossed, in order, capped at 24: this rides in the address bar, and a hundred crossings would be a hundred lines of it.
function farCross(k,st){if(!farRec)return;farRec.cr.push({d:dayCount,k,s:st});if(farRec.cr.length>24)farRec.cr.shift()}
// The name comes across once, in somebody's mouth, and after that everyone uses it. Returns true the once.
function farLearn(who){if(!farRec||farRec.kn)return false;farRec.kn=1;
  say(`${who} says the place out there has a name, and the name is ${farRec.n}. By evening nobody is calling it the far island any more.`,true);
  addEvent('farname',`the ${sea()} the far island turned out to be ${farRec.n}`,`The island on the horizon stopped being the far island and became ${farRec.n}, which is what the people on it have always called it. Nothing about the water changed. Everything about looking at it did.`);
  farCross('name',`the name of ${farRec.n} came across the water`);return true}
// Things this island cannot make, which is the whole of the point of them: they only ever arrive over water. [full description, the name it goes by]
const FARGOODS=[['a copper pot, beaten thin and mended twice before it ever got here','the copper pot'],
 ['a hand-mirror of bronze, spotted with age, that shows a face darker than it is','the bronze mirror'],
 ['a roll of iron needles in oiled cloth, finer than anything the forge could draw','the needle-roll'],
 ['a length of cloth dyed a red nothing on this island grows','the red cloth'],
 ['a small brass bell with a crack in its voice','the cracked bell'],
 ['a book of ruled paper, empty, that nobody here could make and everybody wanted','the empty book']];
// One far thing a year, from either route, and it is asked of the things themselves rather than a counter — the store is already saved.
const farRecent=()=>things.some(t=>t.src==='far'&&t.hist.length&&dayCount-t.hist[0].d<YEAR);
const SEASONS=['spring','summer','autumn','winter'];
const SEASON_LINE={spring:'The first green comes back to the trees, and somewhere on the island something is in blossom.',summer:'The days stretch long and gold. It is summer.',autumn:'The canopy turns. Leaves come down on the paths, and the store begins to matter.',winter:'The first hard frost. Winter has come to the island and the days are short.'};
const WATER=0,SAND=1,GRASS=2,ROCK=3,FARM=4;
const idx=(x,y)=>y*W+x, at=(x,y)=>(x<0||y<0||x>=W||y>=H)?WATER:tiles[idx(x,y)];
const SYL=['ma','ri','en','tho','bel','wyn','ar','os','ka','lin','dor','fen','ha','yv','tam','ro','sel','ing','ula','bra','nis','eo','gwen','ily'];
const TRAITS=['patient','restless','gossipy','gentle','proud','dreamy','stubborn','brave','homesick','funny'];
function mkName(){let n=pick(SYL)+pick(SYL);if(R()<.4)n+=pick(SYL);return n[0].toUpperCase()+n.slice(1)}
const yearOf=d=>Math.floor((d-1)/YEAR)+1, seasonOf=d=>SEASONS[Math.floor(((d-1)%YEAR)/5)], seaDay=()=>((dayCount-1)%YEAR)%5, sea=()=>seasonOf(dayCount);
// sprint 16: a finished year gets the name the village will use for it, read straight out of the chronicle it left behind.
// Pure and re-derivable — nothing saved; first match wins, so the loudest thing that happened is what the year is called.
function yearName(yr){if(!yr||yr>=yearOf(dayCount))return null;const E=chron.filter(e=>e.y===yr);if(!E.length)return 'a quiet year';
  const k=kk=>E.some(e=>e.kind===kk),n=kk=>{let c=0;for(const e of E)if(e.kind===kk)c++;return c};
  if(k('fever'))return 'the year of the fever';
  if(k('drought'))return k('rainscame')?'the year the rain broke':'the dry year';
  if(k('want'))return 'the year of the short winter';
  if(k('hardwinter'))return 'the year of the long winter';
  if(k('ill'))return 'the year of the sickness';
  if(k('kept'))return 'the year of the feud';
  if(k('shoal'))return 'the year the fish came in';
  if(n('death')>=2)return 'the year of the partings';
  if(k('stayed')||k('voyage')||k('returned')||k('farname')||k('farcame'))return 'the year of the far island';
  if(k('way')){const e=E.find(e=>e.kind==='way'),m=e.label.match(/^the year (.+?) came to /);if(m)return 'the year of '+m[1]}
  if(n('birth')>=2)return 'the year of the cradles';
  if(k('washed')||k('wreck'))return 'the year of the wreck';
  if(k('bounds'))return 'the year of the first walking';
  if(n('build')>=2)return 'the year of the raising';
  if(k('landing'))return 'the year of the landing';
  return 'a quiet year'}
const mkTree=(x,y,s,o)=>({x,y,s,hp:3,b:R()<.45,a:R(),o:o||0});
/* Two lists that used to grow for as long as the island did. A 500-day island on seed 7 carried 1,102 stumps — 17,677 bytes, 12% of
   the whole save — lying several deep on the same worked ground, and nothing in the simulation has ever read one: a stump is a 3x2
   brown rectangle. The oldest go back to grass. A person's story is every line they ever earned, and a long life earns more than the
   card can show; the first line, how they came to be here, stays, and the most recent HIST_MAX-1 stay with it. Both are trimmed where
   the world changes rather than in pack(), so an island reloaded from a link looks like the one that ran straight through. */
const STUMP_MAX=240, HIST_MAX=60;
function addStump(x,y){stumps.push({x,y});if(stumps.length>STUMP_MAX)stumps.splice(0,stumps.length-STUMP_MAX)}
function trimHist(p){if(p.hist.length>HIST_MAX)p.hist.splice(1,p.hist.length-HIST_MAX)}
function newWorld(s){
  seed=s;R=mulberry(seed);document.getElementById('seedlbl').textContent='island '+seed.toString(36);
  const n1=noise2(),n2=noise2();tiles=new Uint8Array(W*H);elev=new Float32Array(W*H);trees=[];houses=[];farms=[];people=[];stumps=[];fx=[];fires=[];graves=[];dead=[];events=[];shore=[];
  wood=12;food=20;granary=0;hunger=0;time=dayLen*.22;dayCount=1;lastYear=1;lastSea='spring';rain=false;storm=false;wx='clear';wxT=rnd(60,180);fogA=0;flash=0;snowD=0;frozen=false;gone=[];paintedKey='';works=[];dry01=0;breadYr=0;retYr=0;bldg=[];bldgTgt=null;boats=[];heat=new Float32Array(W*H);road=new Uint8Array(W*H);roadV=0;village=null;landings=[];lightSite=null;stream=[];bridgeSite=null;traderDay=0;belled=0;trader=null;wild=[];flies=[];gulls=[];geese=null;geeseDay=0;whale=null;whaleT=rnd(60,200);farIsle=null;farRec=null;voyage=null;ruin=null;fishSh=[];ruinSeen=0;springs=[];clouds=[];gusts=[];skips=[];chron=[];storyDay=0;dreamAny=0;sackUsed=false;things=[];heirYr=0;lorePl=[];walkP=null;loreN={};boundsP=null;boundsYr=0;songs=[];snowmen=[];skipN=0;rbUntil=0;shoots=[];starDay=0;want=null;wantYr=0;ill=null;feud=null;wind=R()<.5?-1:1;evT=14;arrivalT=90;names=new Set();saidToday=new Set();usedTpl=new Map();selected=null;
  faith=0;faithSt=0;acts=[];prayer=null;arc=null;arcYr=0;wayYr=0;bookYr=0;ways=0;lastStormDay=0;rainedDay=0;wreckYr=0;famDone=false;temper=TEMPERS[(seed>>>0)%5]; // temper from the seed alone: no rnd(), so old links keep their terrain
  const cx=W/2,cy=H/2;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const dx=(x-cx)/cx,dy=(y-cy)/cy;const d=Math.sqrt(dx*dx*.9+dy*dy*1.5);
    let e=n1(x/14,y/14)*.6+n1(x/6,y/6)*.3+n2(x/3,y/3)*.1;e=e-d*d*1.1+.18;elev[idx(x,y)]=e;
    let t=WATER;if(e>.55)t=ROCK;else if(e>.29)t=GRASS;else if(e>.24)t=SAND;
    tiles[idx(x,y)]=t;
    if(t===GRASS&&n2(x/9,y/9)>.55&&R()<.55)trees.push(mkTree(x+rnd(.2,.8),y+rnd(.2,.8),rnd(.6,1)));
  }
  // a stream on some islands: from a high inland tile, downhill to the sea (or a pond where it gives up)
  if(R()<.65){let sx=-1,sy=-1,se=-1;for(let k=0;k<300;k++){const x=(R()*W)|0,y=(R()*H)|0;const e=elev[idx(x,y)];if(at(x,y)!==WATER&&e>se&&e<.6){se=e;sx=x;sy=y}}
    let x=sx,y=sy,seen=new Set();for(let k=0;k<45&&x>0&&y>0&&x<W-1&&y<H-1;k++){if(at(x,y)===WATER&&!seen.has(idx(x,y)))break;seen.add(idx(x,y));stream.push({x,y});
      let bx=x,by=y,be=1e9;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const e=elev[idx(x+dx,y+dy)]+(seen.has(idx(x+dx,y+dy))?9:0);if(e<be){be=e;bx=x+dx;by=y+dy}}if(be>8)break;x=bx;y=by}
    if(stream.length<8)stream=[];for(const s of stream){tiles[idx(s.x,s.y)]=WATER;elev[idx(s.x,s.y)]=.19}trees=trees.filter(t=>!stream.some(s=>Math.hypot(s.x+.5-t.x,s.y+.5-t.y)<1))}
  wadeTiles=new Set();for(const s of stream)wadeTiles.add(idx(s.x,s.y));bridgeUp=false;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(at(x,y)===SAND&&(at(x+1,y)===WATER||at(x-1,y)===WATER||at(x,y+1)===WATER||at(x,y-1)===WATER))shore.push({x,y});
  // tide band: sand/water tiles within a hair of the waterline; fog mask: low ground and water
  tideTiles=[];fg.clearRect(0,0,W*T,H*T);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const e=elev[idx(x,y)],t=at(x,y);
    if(e>.215&&e<.265&&(t===WATER||t===SAND))tideTiles.push({x,y,e,t});
    const a=e<.36?Math.min(1,(.36-e)/.14):0;if(a>0){fg.fillStyle=`rgba(226,232,238,${(a*.85).toFixed(2)})`;fg.fillRect(x*T,y*T,T,T)}}
  // village site: grass tile with lots of grass around, near middle
  let best=null,bs=-1;
  for(let y=6;y<H-6;y+=2)for(let x=6;x<W-6;x+=2){if(at(x,y)!==GRASS)continue;let c=0;
    for(let j=-5;j<=5;j++)for(let i=-5;i<=5;i++)if(at(x+i,y+j)===GRASS)c++;
    const sc=c-Math.hypot(x-cx,y-cy)*.6;if(sc>bs){bs=sc;best={x,y}}}
  center=best||{x:cx|0,y:cy|0};cur.x=center.x;cur.y=center.y;
  trees=trees.filter(t=>Math.hypot(t.x-center.x,t.y-center.y)>3.5);
  // hill for graves: highest grass tile 8–22 tiles from the hearth
  hill=null;let he=-1;for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++){if(at(x,y)!==GRASS)continue;const d=Math.hypot(x-center.x,y-center.y);if(d<8||d>22)continue;const e=elev[idx(x,y)];if(e>he){he=e;hill={x,y}}}
  if(!hill)hill={x:center.x+6,y:center.y-4};
  // ruins on some islands: a broken stone circle or an old wall, on grass away from the hearth
  if(R()<.55){let site=null;for(let k=0;k<400&&!site;k++){const x=(R()*(W-8)+4)|0,y=(R()*(H-8)+4)|0;if(at(x,y)!==GRASS)continue;const d=Math.hypot(x-center.x,y-center.y);if(d<9||d>26||Math.hypot(x-hill.x,y-hill.y)<5)continue;let ok=true;for(let j=-3;j<=3&&ok;j++)for(let i=-3;i<=3;i++)if(at(x+i,y+j)!==GRASS){ok=false;break}if(ok)site={x,y}}
    if(site){const kind=R()<.55?'circle':'wall',st=[];
      if(kind==='circle'){const n=7+((R()*3)|0);for(let i=0;i<n;i++){if(R()<.3)continue;const a=i/n*6.283;st.push({x:site.x+.5+Math.cos(a)*2.6,y:site.y+.5+Math.sin(a)*1.8,h:2+((R()*3)|0),f:R()<.3,w:1})}}
      else{const dx=R()<.5?1:0,dy=1-dx,n=8+((R()*4)|0);for(let i=0;i<n;i++){if(R()<.15)continue;st.push({x:site.x+.5+(i-n/2)*dx*.8+rnd(-.05,.05),y:site.y+.5+(i-n/2)*dy*.7+rnd(-.05,.05),h:1+((R()*2)|0),f:R()<.3,w:dx?1:0})}}
      const legend=kind==='circle'?pick(['the ring the giants left','the ring where the first fires were lit','the ring of the ones who were here before','the dancing stones']):pick(['the wall the sea people built','the old wall nobody finished','the wall the ones before us raised against something']);
      ruin={kind,x:site.x+.5,y:site.y+.5,st,legend};trees=trees.filter(t=>Math.hypot(t.x-ruin.x,t.y-ruin.y)>3.4)}}
  // the far island: only ever a silhouette on the horizon (the top edge, over open water), on the side away from the hearth
  {const w=8+((R()*5)|0);let best=null,bs=-1;for(let x0=3;x0<W-w-3;x0++){let c=0;for(let i=0;i<w;i++)for(let j=0;j<7;j++)if(at(x0+i,j)===WATER)c++;const sc=c+Math.abs(x0+w/2-center.x)*.4+R()*3;if(c>=w*6&&sc>bs){bs=sc;best=x0}}
    if(best===null){best=center.x<W/2?W-w-4:4}farIsle={x:best,w,h:5+((R()*4)|0),lit:false,k:R()};
    farRec={s:farSeed(seed),n:farNameOf(farSeed(seed)),kn:0,cr:[]};   /* phase 5: no R() draw — the neighbour is a function of the seed, so an old link keeps its exact terrain */
    // deep water for the whale: well out from any land
    deep=[];for(let y=6;y<H-6;y+=2)for(let x=6;x<W-6;x+=2){if(elev[idx(x,y)]<.02){let ok=true;for(let j=-6;j<=6&&ok;j+=2)for(let i=-6;i<=6;i+=2)if(at(x+i,y+j)!==WATER){ok=false;break}if(ok)deep.push({x,y})}}}
  // favourite spots
  const far=shore.reduce((a,b)=>Math.hypot(b.x-center.x,b.y-center.y)>Math.hypot(a.x-center.x,a.y-center.y)?b:a,shore[0]||center);
  const near=shore.reduce((a,b)=>Math.hypot(b.x-center.x,b.y-center.y)<Math.hypot(a.x-center.x,a.y-center.y)?b:a,shore[0]||center);
  let rock=null;for(let k=0;k<400&&!rock;k++){const x=(R()*W)|0,y=(R()*H)|0;if(at(x,y)===ROCK)rock={x,y}}
  const oak=trees.reduce((a,b)=>b.s>a.s?b:a,trees[0]||{x:center.x+2,y:center.y+2});
  spots=[{l:'the far shore',x:far.x,y:far.y},{l:'the near beach',x:near.x,y:near.y},{l:'the hilltop',x:hill.x,y:hill.y},{l:'the fire',x:center.x,y:center.y},{l:'the old tree',x:oak.x,y:oak.y+.6},{l:'the fields',x:center.x+4,y:center.y+3}];
  if(rock)spots.push({l:'the grey rocks',x:rock.x,y:rock.y});
  if(ruin)spots.push({l:'the old stones',x:ruin.x,y:ruin.y+1.6});
  // landings: shore tiles with open water straight out to sea (boats row in along the ray from the hearth)
  for(const s of shore){let dx=s.x-center.x,dy=s.y-center.y;const d=Math.hypot(dx,dy)||1;dx/=d;dy/=d;let ok=true;for(let k=1;k<=14&&ok;k++){const x=Math.round(s.x+dx*k),y=Math.round(s.y+dy*k);if(x>=0&&y>=0&&x<W&&y<H&&at(x,y)!==WATER)ok=false}
    if(ok)landings.push({x:s.x,y:s.y,dx,dy,d})}
  landings.sort((a,b)=>a.d-b.d);
  // lighthouse: the rock (or sand) tile with the most sea around it, well away from the hearth
  {let best=null,bs=-1;for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++){const t=at(x,y);if(t!==ROCK&&t!==SAND)continue;let w=0;for(let j=-3;j<=3;j++)for(let i=-3;i<=3;i++)if(at(x+i,y+j)===WATER)w++;if(w<14)continue;const sc=w+(t===ROCK?12:0)-Math.hypot(x-center.x,y-center.y)*.15;if(sc>bs){bs=sc;lightSite={x,y}}}}
  if(stream.length){let bd=1e9;for(const s of stream){const d=Math.hypot(s.x-center.x,s.y-center.y);if(d<bd&&d>2){bd=d;bridgeSite=s}}}
  // reachability from the hearth (people refuse the sea now): landings must be walkable, and a lighthouse
  // on an islet nobody can reach is no lighthouse at all. Pure flood-fill — no rnd(), replays unaffected.
  {const reach=new Uint8Array(W*H);const qx=[center.x],qy=[center.y];reach[idx(center.x,center.y)]=1;
    while(qx.length){const x=qx.pop(),y=qy.pop();for(const dd of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dd[0],ny=y+dd[1];if(nx<0||ny<0||nx>=W||ny>=H)continue;const i=idx(nx,ny);if(reach[i]||(tiles[i]===WATER&&!wadeTiles.has(i)))continue;reach[i]=1;qx.push(nx);qy.push(ny)}}
    landings=landings.filter(l=>reach[idx(l.x,l.y)]);
    if(lightSite&&!(reach[idx(lightSite.x,lightSite.y)]||[[1,0],[-1,0],[0,1],[0,-1]].some(dd=>{const nx=lightSite.x+dd[0],ny=lightSite.y+dd[1];return nx>=0&&ny>=0&&nx<W&&ny<H&&reach[idx(nx,ny)]})))lightSite=null}
  for(let i=0;i<4;i++)addPerson(center.x+rnd(-2,2),center.y+rnd(-2,2),{age:i===0?rnd(54,61)|0:rnd(20,38)|0,born:1,how:i===0?'waded ashore with the first four, the eldest of them':'waded ashore with the first four'});
  people.forEach(p=>meet(p,1,3));
  paintTerrain();document.getElementById('log').innerHTML='';showCard(null);showChron(false);
  addEvent('landing','the day the four of them came ashore','Four of them waded ashore out of a small boat and chose a clearing for a fire.');
  if(ruin){addEvent('ruin',ruin.legend,`They found ${ruin.kind==='circle'?'a ring of standing stones':'a length of old wall'} standing on the grass, older than anyone, and called it ${ruin.legend}.`)}
  spawnWildlife();mkCloudSprites();for(let i=0;i<2;i++)addCloud(false);
  say(`Four travellers wade ashore and choose a clearing for their hearth.`);
}
function addPerson(x,y,o={}){let n=o.name;if(!n){do n=mkName();while(names.has(n))}names.add(n);
  const age=o.age!==undefined?o.age:rnd(18,44)|0, born=dayCount, tr=[];
  if(o.child){/* children get traits when grown */}else{tr.push(pick(TRAITS));let t2;do t2=pick(TRAITS);while(t2===tr[0]);tr.push(t2)}
  const p={x,y,name:n,age0:age,born,tr,spot:pick(spots),rels:[],hist:[],task:'idle',t:rnd(1,3),tx:x,ty:y,carry:0,col:pick(['#c96b4a','#5b8db8','#c9a24a','#7fa85b','#a06fb8','#d08fa0','#6ab0a8']),
    hair:pick(['#2a1c12','#4a2f1a','#6b3d1f','#8a5a2b','#b07a3a','#c9a24a','#7a2e1e','#1a1a1e']),home:null,off:rnd(6.28),seed:hash(n)^seed,partner:null,parents:o.parents||[],alive:true,dead:false,fishRain:0,visits:0,craft:-1,cxp:0};
  if(o.child)p.child=true;
  p.hist.push({d:dayCount,s:o.how||(o.child?'born here':'came ashore in a small boat')});
  people.push(p);return p}
const ageOf=p=>p.age0+(dayCount-p.born)/YEAR, ageI=p=>Math.floor(ageOf(p)), isKid=p=>ageOf(p)<14, isElder=p=>ageOf(p)>=60;
const B=p=>`<b>${p.name}</b>`;
const byName=n=>people.find(p=>p.name===n);
function relate(a,b,k){if(a===b||a.rels.some(r=>r.who===b.name))return;a.rels.push({who:b.name,k});const inv={friend:'friend',rival:'rival',partner:'partner',parent:'child',child:'parent'}[k];b.rels.push({who:a.name,k:inv})}
function meet(p,lo,hi){const others=people.filter(q=>q!==p&&!isKid(q)&&!q.dead);const n=Math.min(others.length,lo+(R()*(hi-lo+1))|0);
  for(let i=0;i<n;i++){const q=pick(others);if(q.rels.some(r=>r.who===p.name))continue;const k=R()<.72?'friend':'rival';relate(p,q,k)}}
function relOf(p,k){const r=p.rels.filter(r=>(!k||r.k===k)&&byName(r.who));return r.length?byName(pick(r).who):null}
function addEvent(kind,label,st){const e={d:dayCount,y:yearOf(dayCount),kind,label,st:st||null};events.push({d:e.d,y:e.y,kind,label});if(events.length>40)events.shift();
  chron.push(e);if(chronEl&&!chronEl.hidden)renderChron()}
// ---------- terrain painting ----------
const GRASS_PAL={spring:['#5f8f3e','#5a8a3b','#659745','#568437'],summer:['#6c923f','#678d3c','#729a46','#618639'],autumn:['#7c8a3d','#76853a','#838f45','#6f7f36'],winter:['#5c7a45','#587643','#617f4a','#546f40']};
const TUFT={spring:'#4e7a31',summer:'#5a7a2e',autumn:'#8a7a2e',winter:'#4a6638'};
function paintTerrain(){
  const s=sea(),sq=Math.round(snowD*6)/6;paintedKey=s+'|'+sq+'|'+frozen+'|'+roadV;
  const pal={[WATER]:['#274c78','#2b5687','#2f5f93'],[SAND]:['#cdb98a','#d4c294','#c6ad7c'],[GRASS]:GRASS_PAL[s],[ROCK]:['#6f6a60','#7b756a','#645f56']};
  const ICE=['#b9d3e3','#c4dbe8','#adc9dc'];
  const rr=mulberry(seed^99);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const t=tiles[idx(x,y)],e=elev[idx(x,y)];const r1=rr(),r2=rr(),r3=rr(),r4=rr(),r5=rr(),r6=rr(),r7=rr(); // fixed draw per tile so repaints don't shuffle the ground
    const c=pal[t]||pal[GRASS];tg.fillStyle=c[(r1*c.length)|0];tg.fillRect(x*T,y*T,T,T);
    // a little more grain in the ground (sprint 11): depth in the water, mottle and flowers in the grass, speckle in the sand, cracks in the rock
    if(t===WATER){if(e<.06){tg.fillStyle='#22436b';tg.fillRect(x*T,y*T,T,T);if(r6<.2){tg.fillStyle='#274c78';tg.fillRect(x*T+((r7*5)|0),y*T+((r3*6)|0),3,1)}}
      else if(r6<.12){tg.fillStyle='#3a6ba3';tg.fillRect(x*T+((r7*6)|0),y*T+((r4*7)|0),2,1)}}
    if(t===GRASS&&r6<.14){tg.fillStyle=GRASS_PAL[s][3];tg.fillRect(x*T+((r7*5)|0),y*T+((r5*5)|0),3,2)}
    if(t===GRASS&&(s==='spring'||s==='summer')&&r7<.045){tg.fillStyle=s==='spring'?(r6<.5?'#e8a0b8':'#e6e2d8'):'#e2c25a';tg.fillRect(x*T+((r3*6)|0)+1,y*T+((r4*6)|0)+1,1,1)}
    if(t===SAND&&r6<.3){tg.fillStyle=r7<.5?'#b8a172':'#e0d2a8';tg.fillRect(x*T+((r3*6)|0),y*T+((r4*6)|0),1,1);tg.fillRect(x*T+((r7*6)|0),y*T+((r5*6)|0),1,1)}
    if(t===ROCK&&r6<.22){tg.fillStyle='#54504a';tg.fillRect(x*T+((r7*4)|0),y*T+2+((r3*4)|0),3,1)}
    if(t===GRASS&&r2<.12){tg.fillStyle=TUFT[s];tg.fillRect(x*T+((r3*6)|0),y*T+((r4*6)|0),2,1)}
    if(t===WATER&&frozen&&e>.16){tg.fillStyle=ICE[(r1*3)|0];tg.fillRect(x*T,y*T,T,T);if(r5<.15){tg.fillStyle='#8fb0c8';tg.fillRect(x*T+((r3*5)|0),y*T+((r4*7)|0),3,1)}}
    else if(t===WATER&&at(x,y-1)!==WATER){tg.fillStyle='#8fb6d6';tg.fillRect(x*T,y*T,T,1)}
    if(t===ROCK&&r2<.3){tg.fillStyle='#e6e2d8';tg.fillRect(x*T+2,y*T+1,3,2)}
    const rd=road[idx(x,y)];if(rd===1){tg.fillStyle=r1<.5?'#8a7248':'#7e6841';tg.fillRect(x*T,y*T,T,T);tg.fillStyle='#6b5735';tg.fillRect(x*T+((r3*6)|0),y*T+((r4*7)|0),2,1)}
    else if(rd===2){tg.fillStyle=r1<.5?'#a39682':'#968a76';tg.fillRect(x*T,y*T,T,T);tg.fillStyle='#b5a892';tg.fillRect(x*T+1,y*T+1,3,2);tg.fillRect(x*T+5,y*T+4,2,2);tg.fillStyle='#7a6f5e';tg.fillRect(x*T+4,y*T+1,1,2);tg.fillRect(x*T+1,y*T+5,2,1);tg.fillRect(x*T+3,y*T+6,3,1)}
    if(sq>0&&t!==WATER&&t!==FARM){const cover=(t===ROCK?1.2:t===SAND?.8:rd?.6:1)*sq;if(r5<cover*1.05){tg.fillStyle=r4<.8?'#eef2f4':'#dfe6ea';tg.fillRect(x*T,y*T,T,T);if(r3<.2){tg.fillStyle='#f8fafb';tg.fillRect(x*T+((r4*6)|0),y*T+((r1*6)|0),2,1)}}
      else if(r5<cover*1.6){tg.fillStyle='#eef2f4';tg.fillRect(x*T+((r4*4)|0),y*T+((r1*4)|0),4,3)}}
  }
}
// ---------- log ----------
const logEl=document.getElementById('log');
function say(s,force,tag){const key=tag||s.replace(/<[^>]+>/g,'');if(!force&&saidToday.has(key))return false;saidToday.add(key);
  const p=document.createElement('p');p.innerHTML=`<i>day ${dayCount}</i>${s}`;logEl.appendChild(p);while(logEl.children.length>9)logEl.removeChild(logEl.firstChild);return true}
// ---------- helpers ----------
const dayFrac=()=>(time%dayLen)/dayLen; // 0 midnight .. .5 noon
const EDGE={spring:[.2,.8],summer:[.15,.86],autumn:[.2,.8],winter:[.27,.73]}; // when night ends / begins, by season (winter days are short)
const edges=()=>EDGE[sea()];
const isNight=()=>{const f=dayFrac(),e=edges();return f<e[0]||f>e[1]};
const isDusk=()=>{const f=dayFrac(),e=edges();return f>e[1]-.1&&f<e[1]};
const light=()=>{const f=dayFrac(),e=edges();const t=Math.max(-.15,Math.min(1.15,(f-e[0])/(e[1]-e[0])));return Math.max(0,Math.min(1,(Math.sin(t*Math.PI)+.45)/1.15))};
const tide=()=>Math.sin(dayFrac()*4*Math.PI+(seed%7)); // two tides a day; +1 high, -1 low
function nearestTree(x,y){let b=null,bd=1e9;for(const t of trees){if(t.hp<=0||t.s<.5||t.o)continue;const d=Math.hypot(t.x-x,t.y-y);if(d<bd){bd=d;b=t}}return b} // nobody fells the orchard
function nearestShore(x,y){let b=null,bd=1e9;for(const s of shore){const d=Math.hypot(s.x-x,s.y-y);if(d<bd){bd=d;b=s}}return b}
const bAll=()=>bldgTgt?bldg.concat([bldgTgt]):bldg;
function freeSpot(r0,r1,need=1){for(let k=0;k<80;k++){const a=rnd(6.28),r=rnd(r0,r1);const x=Math.round(center.x+Math.cos(a)*r),y=Math.round(center.y+Math.sin(a)*r*.75);
  let ok=true;for(let j=0;j<need&&ok;j++)for(let i=0;i<need;i++){if(at(x+i,y+j)!==GRASS){ok=false;break}
    if(houses.some(h=>Math.abs(h.x-x-i)<2.6&&Math.abs(h.y-y-j)<2.6)||bAll().some(b=>x+i>=b.x-1&&x+i<=b.x+b.w&&y+j>=b.y-1&&y+j<=b.y+b.h)||farms.some(f=>f.x===x+i&&f.y===y+j)||(ruin&&Math.hypot(ruin.x-x-i-.5,ruin.y-y-j-.5)<3.6)||graves.some(gr=>Math.hypot(gr.x-x-i,gr.y-y-j)<3)||trees.some(t=>t.hp>0&&Math.hypot(t.x-x-i-.5,t.y-y-j-.5)<1.2)){ok=false;break}}
  if(ok)return{x,y}}return null}
function freeSpotNear(cx,cy,r0,r1,need){for(let k=0;k<60;k++){const a=rnd(6.28),r=rnd(r0,r1);const x=Math.round(cx+Math.cos(a)*r),y=Math.round(cy+Math.sin(a)*r*.75);
  let ok=true;for(let j=0;j<need&&ok;j++)for(let i=0;i<need;i++){if(at(x+i,y+j)!==GRASS){ok=false;break}
    if(houses.some(h=>Math.abs(h.x-x-i)<2.6&&Math.abs(h.y-y-j)<2.6)||bAll().some(b=>x+i>=b.x-1&&x+i<=b.x+b.w&&y+j>=b.y-1&&y+j<=b.y+b.h)||farms.some(f=>f.x===x+i&&f.y===y+j)||(ruin&&Math.hypot(ruin.x-x-i-.5,ruin.y-y-j-.5)<3.6)||graves.some(gr=>Math.hypot(gr.x-x-i,gr.y-y-j)<3)||trees.some(t=>t.hp>0&&Math.hypot(t.x-x-i-.5,t.y-y-j-.5)<1.2)){ok=false;break}}
  if(ok)return{x,y}}return null}
// people walk on land. The stream can be waded — slowly, feeling for the stones — and once the bridge is up it carries them over dry. The sea refuses.
const canWalk=(x,y)=>at(x|0,y|0)!==WATER||(bridgeUp&&bridgeSite&&(x|0)===bridgeSite.x&&(y|0)===bridgeSite.y);
const canWade=(x,y)=>wadeTiles.has(idx(x|0,y|0));
// if the straight line to a target crosses the stream and the bridge is up, go round by the bridge (no rnd() in here: replays depend on it)
function routeVia(x0,y0,x1,y1){if(!bridgeUp||!bridgeSite)return null;const d=Math.hypot(x1-x0,y1-y0);if(d<5)return null;
  const n=Math.ceil(d);let cross=false;for(let i=1;i<n&&!cross;i++){const k=i/n;if(canWade(x0+(x1-x0)*k,y0+(y1-y0)*k))cross=true}
  return cross?{x:bridgeSite.x+.5,y:bridgeSite.y+.5}:null}
// a person with nowhere left to step lets the task go where they stand (deterministic: no rnd())
function blockedStop(p){if(p.tgt&&p.tgt.claimed)p.tgt.claimed=false;p.tgt=null;p.via=null;p.task=p.task==='gohome'?'sleep':'idle';p.t=1;return false}
function walk(p,dt){
  if(p.tx!==p._vx||p.ty!==p._vy){p._vx=p.tx;p._vy=p.ty;p.via=routeVia(p.x,p.y,p.tx,p.ty)}
  const txx=p.via?p.via.x:p.tx,tyy=p.via?p.via.y:p.ty;
  const dx=txx-p.x,dy=tyy-p.y,d=Math.hypot(dx,dy);let sp=(isNight()?1.6:2.6)*dt*(1-hunger*.3);if(isElder(p))sp*=.7;if(isKid(p))sp*=.85;if(p.sick)sp*=.65;if(snowD>.5&&at(p.x|0,p.y|0)!==WATER)sp*=.85;
  const wading=at(p.x|0,p.y|0)===WATER&&canWade(p.x,p.y);
  if(wading){sp*=.55;if(p.waded!==dayCount){p.waded=dayCount;say(`${B(p)} hitches up and wades the stream, feeling for the stones.`,false,'wade')}}
  if(d<sp){if(p.via){p.x=txx;p.y=tyy;p.via=null;return false}
    if(canWalk(p.tx,p.ty)||canWade(p.tx,p.ty)){p.x=p.tx;p.y=p.ty}
    return true}
  if(!p.via&&d<1.2&&!canWalk(p.tx,p.ty)&&!canWade(p.tx,p.ty))return true; // the target tile is sea: the water's edge is close enough
  const nx=p.x+dx/d*sp,ny=p.y+dy/d*sp;
  if(canWalk(nx,ny)||canWade(nx,ny)){p.x=nx;p.y=ny}
  else if(canWalk(nx,p.y)||canWade(nx,p.y))p.x=nx;
  else if(canWalk(p.x,ny)||canWade(p.x,ny))p.y=ny;
  else return blockedStop(p);
  const hi=idx(p.x|0,p.y|0);if(hi>=0&&hi<W*H)heat[hi]+=dt;return false}
function popCap(){return 4+houses.length*2}
const has=(p,t)=>p.tr.includes(t);
// which craft a task teaches (and is sped by): field, wood, sea, frame, store
const CRAFT_TASK={till:0,harvest:0,water:0,chop:1,fish:2,boat:2,build:3,carry:4};
const workRate=p=>(has(p,'patient')?1.15:1)*(isElder(p)?.7:1)*(1-hunger*.5)*(p.sick?.45:1)*(want?.85:1)*(p.short?.9:1)*(feud&&(p.name===feud.rv[0]||p.name===feud.rv[1])?.8:1)*(p.craft>=0&&CRAFT_TASK[p.task]===p.craft?1+.35*p.cxp:1); /* phase 6: rations are the decision that slows everyone, and the elder eating last is slower again */
// what the hands learn: a finished cycle of work teaches. The craftless drift into whatever they do most; the crafted deepen.
const CRAFT_WORK=['the fields','the woodpile','the nets','the framing','the store'];
const MILE=[
 ['{A} can tell ripe from nearly ripe by the sound the stalks make.','{A} walks the rows and knows which field wants what, without stopping.','{A} opens a hand of seed, smells the wind, and names the day the harvest will come. It comes that day.'],
 ['{A} fells a tree now so that it lands where {A} was already looking.','{A} taps a trunk twice and knows what the inside is doing.','{A} touches the axe to the bark, once, like a greeting. The tree goes over as if it had agreed to.'],
 ['{A} has started reading the water the way other people read faces.','{A} knows where the fish will be from the colour of the morning.','{A} brings the boat in on a line nobody else can see.'],
 ['{A} sights along a beam, shaves it twice, and it is straight.','{A} can tell a good joint by the sound it makes going home.','{A} walks past a house and knows which beam will complain next winter, and is right.'],
 ['{A} counts the sacks by lamplight and is never off by one.','{A} knows what the store holds the way other people know their own pockets.','{A} can say to the day how long the winter store will last, and the winter proves it.']];
function craftUp(p,ci){if(!p||p.dead||isKid(p))return;
  if(p.craft===-1){if(R()<.15){p.craft=ci;p.cxp=.02;p.hist.push({d:dayCount,s:`settled into ${CRAFT_WORK[ci]}, the way water finds a level`})}return}
  if(p.craft!==ci)return;
  const was=p.cxp;p.cxp=Math.min(1,+(p.cxp+.012).toFixed(3));
  const th=[.33,.66,1];for(let i=0;i<3;i++)if(was<th[i]&&p.cxp>=th[i]){
    say(MILE[ci][i].replace(/{A}/g,B(p)),true);
    if(i===2){p.hist.push({d:dayCount,s:`known now as the one ${CRAFT_EPITHET[ci]}`});
      addEvent('mastery',`the ${sea()} ${p.name} mastered ${CRAFT_WORK[ci]}`,`By the ${sea()} of year ${yearOf(dayCount)} there was no one better at ${CRAFT_WORK[ci]} than ${p.name}, and everyone knew it, and ${p.name} never said it.`);
      // once per craft per island, the mastering leaves a thing behind — the kind that outlives its maker (sprint 12)
      if(!things.some(t=>t.src==='made'&&t.ci===ci)&&R()<.6){const [f,sn]=MADE(ci);
        things.push({n:sn,full:f,holder:p.name,src:'made',ci,hist:[{d:dayCount,s:`made by ${p.name}, in the year of the mastering`}]});
        say(`${B(p)} spends the quiet ends of a month's evenings making ${f}, and does not say who it is for, and keeps it.`,true);
        p.hist.push({d:dayCount,s:`made ${sn}, the best thing those hands have made`})}}
    break}}
function homeOf(p){if(p.home&&houses.includes(p.home))return p.home;if(p.child){const par=p.parents.map(byName).find(q=>q&&q.home);if(par){p.home=par.home;return p.home}}
  const h=houses.find(h=>h.owners.length<2&&!h.owners.some(n=>{const q=byName(n);return q&&q.partner&&q.partner!==p.name}));if(h&&!isKid(p)){h.owners.push(p.name);p.home=h;return h}return null}
function goTo(p,x,y,task,dwell){p.tx=x+rnd(-.4,.4);p.ty=y+rnd(-.3,.3);p.task=task;p.dwell=dwell||0}
