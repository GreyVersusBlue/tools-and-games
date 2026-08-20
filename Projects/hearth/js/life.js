// Hearth — the turn of village life — newDay, buildings, boats, the works, and the wildlife.
// Classic scripts sharing one global scope; the load order in index.html is the old single file’s order and it matters.
// ---------- life ----------
function newDay(){saidToday=new Set();
  const yr=yearOf(dayCount),s=sea();
  wakeDreams();
  // the island shows its temper early, and once
  if(dayCount===8){const TL={kind:'It is, on the whole, a kind island; the weather forgives more than it punishes. Everyone has privately decided this, and nobody says it out loud, in case that changes it.',
    rainy:'It rains here more than anywhere anyone remembers living. The green is the payment, and the mud is the price.',
    dry:'It is a dry island. The sky here is generous with light and stingy with everything else. A well will matter, when there is one.',
    windy:'The wind never entirely stops on this island. Everything grows leaning slightly the same way, and by now so do the people.',
    cold:'It is a cold island. The winters will be long here, and wood will be worth more than it looks.'};
    say(TL[temper],true);addEvent('temper','the temper of the island',TL[temper])}
  // the year turns up its fortune card, at most one a year
  if(!arc&&yr!==arcYr&&seaDay()===1&&dayCount>YEAR&&R()<.32){const cands=[];
    if(s==='summer'&&temper!=='rainy')cands.push(['drought',temper==='dry'?3:1,6,10]);
    if(s==='winter')cands.push(['longwinter',temper==='cold'?3:1,3,3]);
    if((s==='spring'||s==='autumn')&&people.length>=10)cands.push(['fever',1,4,7]);
    if((s==='spring'||s==='summer')&&hasB('hut'))cands.push(['shoal',temper==='kind'?2:1,4,6]);
    if(cands.length){let sum=cands.reduce((a,c)=>a+c[1],0),r=R()*sum,c=cands[0];for(const cc of cands){r-=cc[1];if(r<=0){c=cc;break}}
      arcYr=yr;startArc(c[0],c[2]+((R()*(c[3]-c[2]+1))|0))}}
  arcDay();
  if(arcK()!=='fever'&&people.some(p=>p.sick))people.forEach(p=>p.sick=0); // no fever, no fevered: stray flags heal
  wayDay(yr);faithDay();
  // the morning after a fire night, someone may walk out to stand where a grown story happens — and the first walk names the ground (sprint 13).
  // walkP only queues the errand; step() launches it once the light is up. An unnamed place is walked for certain; a named one, sometimes, again.
  if(storyDay===dayCount-1){const cand=chron.filter(e=>e.gr&&LORE_PLACE[e.kind]);
    if(cand.length){const un=cand.filter(e=>!lorePl.includes(e.kind));
      const e=un.length?un[0]:(R()<.25?cand[(R()*cand.length)|0]:null);
      if(e){const D=LORE_PLACE[e.kind],pos=D.at();if(pos)walkP={d:dayCount,k:e.kind,l:D.l,x:pos.x,y:pos.y,named:lorePl.includes(e.kind)}}}}
  // and once a year, in spring, with enough named ground and an elder to lead and children to show: the walking of the bounds (sprint 14)
  if(s==='spring'&&seaDay()===3&&yr!==boundsYr&&lorePl.length>=2&&people.some(p=>isElder(p)&&!p.dead)&&people.some(p=>isKid(p)&&ageOf(p)>=5)&&R()<.6){boundsYr=yr;boundsP={d:dayCount}}
  // paths where people walk; cobbles once the village is big
  {let ch=false;const cob=houses.length>=10;for(let i=0;i<W*H;i++){const h=heat[i];heat[i]=h*.8;const t=tiles[i];if(t===WATER||t===FARM||t===ROCK)continue;
      if(h>26&&road[i]===0){road[i]=1;ch=true}else if(cob&&h>60&&road[i]===1){road[i]=2;ch=true}}
    if(ch){roadV++;if(roadV===1)say('There is a path now, worn between the fire and the fields, that nobody made on purpose.');else if(cob&&!saidToday.has('cob')&&road.some(r=>r===2)&&R()<.3)say(`Someone has started laying stones on the muddy stretch by the well. ${V()} has a street.`,false,'cob')}}
  // the old stones get noticed, and named
  if(ruin&&!ruinSeen&&dayCount>=2){ruinSeen=dayCount;const p=pick(people.filter(q=>!q.dead&&!isKid(q))||people);const what=ruin.kind==='circle'?'a ring of standing stones, some fallen, that nobody living set':'a length of old wall, tumbled, that nobody living built';
    say(`Beyond the trees there is ${what}. ${B(p)} says it is ${ruin.legend}, and that is what it will be called.`,true);p.hist.push({d:dayCount,s:`named the old stones: ${ruin.legend}`})}
  // once, someone decides to see the far island
  if(farIsle&&!voyage&&dayCount>=16&&people.length>=8&&landings.length&&R()<.09){const cand=people.filter(p=>!p.dead&&!isKid(p)&&!isElder(p)&&!p.partner&&!people.some(k=>k.parents.includes(p.name)));
    if(cand.length>=2){const wts=cand.map(p=>(has(p,'restless')?3:0)+(has(p,'brave')?2:0)+(has(p,'homesick')?2:0)+(has(p,'dreamy')?1.5:0)+(p.dreamFar?4:0)+.3);let sum=wts.reduce((a,b)=>a+b,0),r=R()*sum,p=cand[0];for(let i=0;i<cand.length;i++){r-=wts[i];if(r<=0){p=cand[i];break}}
      voyage={name:p.name,st:'decided',p,day:dayCount,back:R()<(has(p,'brave')?.75:has(p,'homesick')?.3:has(p,'restless')?.45:.55)}}}
  if(voyage&&voyage.st==='away'&&dayCount>=voyage.day+(voyage.back?voyage.n:4)){
    if(voyage.back){const l=landings[0];spawnBoat('return',l,{p:voyage.p})}
    else{voyage.st='stayed';farIsle.lit=true;say(`${B(voyage.p)} has not come back from the far island. Nobody says it at the fire, but at dusk they look that way.`,true);addEvent('stayed',`the ${sea()} ${voyage.name} did not come back from the far island`,`${voyage.name} did not come back from the far island. After that there was a light out there on clear nights, and everyone had an opinion about it.`);
      for(const q of people){const r=q.rels.find(r=>r.who===voyage.name);if(r)q.hist.push({d:dayCount,s:`stopped waiting for ${voyage.name} to come back from the far island`})}}}
  if(dayCount===10&&!village){village=pick(NAME1)+pick(NAME2);say(`By now the place has a name. Nobody decided it; it is simply ${village}, and has been for a while.`,true);addEvent('name',`the naming of ${village}`,`The place turned out to be called ${village}. Nobody decided it and nobody argued.`);document.getElementById('seedlbl').textContent=village+' · island '+seed.toString(36)}
  // midwinter: the village keeps its own fire night, and the stories get told whether the watcher is watching or not (sprint 12)
  if(s==='winter'&&seaDay()===2&&people.length>=6&&chron.length>=4&&R()<.75)tellStory(true);
  if(s!==lastSea){lastSea=s;say(SEASON_LINE[s],true);if(s==='winter'){const need=people.length*13;say(granary+food>=need?`The store holds ${granary}. It should see the village through.`:granary+food>=need*.5?`The store holds ${granary}. It will be a thin winter.`:`The store holds ${granary}, and that is not enough. Someone will have to go down to the ice with a line.`,true)}}
  // the works: once the village has its buildings, smaller ambitions surface, about one a year
  if(seaDay()===0&&dayCount>YEAR&&bldg.length>=6&&!bldgTgt&&!works.some(w=>!w.done)&&R()<.35){
    for(const k of WORK_ORDER){if(hasW(k))continue;const D=WORKS[k];if(!D.cond())continue;const s0=D.site();if(!s0)continue;
      works.push({wk:k,x:s0.x,y:s0.y,y0:yearOf(dayCount),done:false,prog:0});break}}
  // what the orchard and the hives give
  if(hasW('orchard')&&s==='autumn'){food+=1;if(seaDay()===0)say('The orchard lets go of its first windfalls, and the ground under the three trees is suddenly a place worth checking every morning.',false,'windfall')}
  if(hasW('hives')&&s==='summer'&&seaDay()===2){food+=3;say('The hives are opened, carefully, by whoever has the steadiest nerves this year. There is honey on the bread by evening.',false,'honey')}
  // hunger drives people away
  if(hunger>.7&&R()<hunger*.4){const cand=people.filter(p=>!p.dead&&!isKid(p)&&!people.some(k=>k.parents.includes(p.name)));if(cand.length>1){const wts=cand.map(p=>(has(p,'restless')?2.5:1)*(has(p,'homesick')?2.5:1)*(p.partner?.4:1));let sum=wts.reduce((a,b)=>a+b,0),r=R()*sum,p=cand[0];for(let i=0;i<cand.length;i++){r-=wts[i];if(r<=0){p=cand[i];break}}leave(p)}}
  if(yr!==lastYear){lastYear=yr;const oldest=people.filter(p=>!p.dead).sort((a,b)=>ageOf(b)-ageOf(a))[0];say(`A new year begins. ${oldest?B(oldest)+' is the eldest now, at '+ageI(oldest)+'.':''}`,true);
    if(hasWay(3)&&bookYr!==yr){bookYr=yr;addEvent('book',`the book of days, year ${yr-1}`,`The book of days for year ${yr-1}: ${people.length} people, ${houses.length} ${houses.length===1?'house':'houses'}, ${graves.length} ${graves.length===1?'stone':'stones'} on the hill, ${granary} in the store at the turn. Written fair, and argued over anyway.`)}
    // sometimes, in a kind year, one of the ones who left comes back
    if(gone.length&&retYr!==yr&&people.length<popCap()&&food+granary>people.length*5&&landings.length&&R()<.4){retYr=yr;
      const g=gone[gone.length-1];if(!names.has(g.name))spawnBoat('return2',landings[0],{ret:g})}}
  const alive=people.filter(p=>!p.dead);
  // grow up
  for(const p of alive)if(p.child&&!isKid(p)){p.child=false;p.tr=[];const par=p.parents.map(byName).filter(Boolean);
    if(par.length&&R()<.5)p.tr.push(pick(par[0].tr));while(p.tr.length<2){const t=pick(TRAITS);if(!p.tr.includes(t))p.tr.push(t)}
    p.hist.push({d:dayCount,s:'grown now, and took up work beside the others'});meet(p,0,2);say(`${B(p)} is fourteen and grown, and no longer follows anyone around the fields.`);addEvent('grown',`the year ${p.name} came of age`,`${p.name} turned fourteen and went to work beside the others.`);
    const m0=p.shadN?byName(p.shadN):null; // the years of following someone around, asking why, were an apprenticeship all along
    if(m0&&m0.craft>=0){p.craft=m0.craft;p.cxp=.1;p.hist.push({d:dayCount,s:`took up ${CRAFT_WORK[m0.craft]}, the way ${m0.name} does it`});say(`${B(p)} goes first to ${m0.name}'s work, having watched it for years.`)}}
  // friendships drift into being
  if(alive.length>2&&R()<.35){const a=pick(alive),b=pick(alive);if(a!==b&&!isKid(a)&&!isKid(b)&&a.rels.length<5&&b.rels.length<6&&!a.rels.some(r=>r.who===b.name)){relate(a,b,'friend');say(`${B(a)} and ${B(b)} have started eating together. Nobody comments.`)}}
  // partnerships
  const single=alive.filter(p=>!p.partner&&!isKid(p)&&ageOf(p)>=18&&ageOf(p)<58);
  for(const a of single){if(a.partner)continue;const fr=a.rels.filter(r=>r.k==='friend').map(r=>byName(r.who)).filter(b=>b&&!b.partner&&!isKid(b)&&ageOf(b)>=18&&ageOf(b)<58&&!b.dead&&!a.parents.includes(b.name)&&!b.parents.includes(a.name));
    if(fr.length&&R()<.16){const b=pick(fr);a.partner=b.name;b.partner=a.name;a.rels=a.rels.filter(r=>r.who!==b.name);b.rels=b.rels.filter(r=>r.who!==a.name);relate(a,b,'partner');
      const s=`decided, with ${b.name}, to build a house together`;a.hist.push({d:dayCount,s});b.hist.push({d:dayCount,s:`decided, with ${a.name}, to build a house together`});a.wantHouse=b.wantHouse=true;
      // give up separate homes
      for(const p of[a,b])if(p.home){p.home.owners=p.home.owners.filter(n=>n!==p.name);p.home=null}
      say(`${B(a)} and ${B(b)} have decided to build a house together. There is a lot of nodding around the fire.`);addEvent('partner',`the spring ${a.name} and ${b.name} built their house`.replace('the spring','the '+seasonOf(dayCount)),pick([`${a.name} and ${b.name} decided to build a house together, which surprised nobody.`,`${a.name} and ${b.name} paced out a plot for the two of them, and there was a lot of nodding about it.`,`${a.name} and ${b.name} stopped pretending and started building.`]))}}
  // births
  for(const a of alive){if(!a.partner||a.child)continue;const b=byName(a.partner);if(!b||b.dead||a.name>b.name)continue;
    if(a.home&&a.home===b.home&&ageOf(a)<46&&ageOf(b)<46&&people.length<popCap()+1&&food>people.length*3&&R()<(people.length<28?.025:.01)){
      const kids=people.filter(p=>p.parents.includes(a.name)&&!p.dead).length;if(kids>=3)continue;
      let nm=null;const anc=dead.filter(d=>d.rels.some(r=>r.who===a.name||r.who===b.name)&&!names.has(d.name));
      if(anc.length&&R()<.6)nm=pick(anc).name;
      const k=addPerson(a.home.x+1,a.home.y+2.4,{child:true,age:0,name:nm,parents:[a.name,b.name],how:`born in the ${seasonOf(dayCount)} of year ${yearOf(dayCount)}, to ${a.name} and ${b.name}`+(nm?`, and named for ${nm} who came before`:'')});
      relate(a,k,'child');relate(b,k,'child');k.home=a.home;k.col=R()<.5?a.col:b.col;k.hair=R()<.5?a.hair:b.hair;
      const s=`a child, ${k.name}, was born`;a.hist.push({d:dayCount,s});b.hist.push({d:dayCount,s});
      say(`A child is born to ${B(a)} and ${B(b)}. They call the child ${B(k)}${nm?', after '+nm:''}.`);addEvent('birth',`the ${seasonOf(dayCount)} ${k.name} was born`,`A child, ${k.name}, was born to ${a.name} and ${b.name} in the ${seasonOf(dayCount)}.`)}}
  // old age
  for(const p of alive){const a=ageOf(p);if(a<55)continue;const chance=Math.pow((a-54)/18,3);if(R()<chance)die(p)}
  autoSave();
}
// sprint 9: the island keeps itself. Written at each dawn; read back at boot when no link is pinned in the address bar.
function autoSave(){try{store('auto',lzEnc(JSON.stringify(pack())))}catch(e){}}
function remove(p){p.dead=true;p.alive=false;names.delete(p.name);people=people.filter(q=>q!==p);
  if(p.home){p.home.owners=p.home.owners.filter(n=>n!==p.name)}
  if(p.tgt&&p.tgt.claimed)p.tgt.claimed=false;
  if(selected===p)showCard(null)}
function leave(p){remove(p);gone.push(p);const s=sea();
  say(`${B(p)} takes the small boat at first light, quietly, so as not to be talked out of it. There was not enough to go round.`,true);addEvent('left',`the ${s} ${p.name} sailed away`,`${p.name} took the small boat and left in a hungry ${s}. There had not been enough to go round.`);
  for(const t of thingsOf(p.name)){t.holder=0;t.hist.push({d:dayCount,s:`left on the shelf in the hall the morning ${p.name} sailed, on purpose, where it would be found`})}
  for(const q of people){const r=q.rels.find(r=>r.who===p.name);if(!r)continue;q.hist.push({d:dayCount,s:`watched ${p.name} sail away in a hungry ${s}`});if(r.k==='partner')q.partner=null}}
function die(p){remove(p);dead.push(p);
  // grave on the hill
  const k=graves.length,gx=hill.x+((k%4)-1.5)*1.6,gy=hill.y+Math.floor(k/4)*1.4;const gr={x:gx,y:gy,name:p.name,d:dayCount,y2:yearOf(dayCount),age:ageI(p),vn:0};graves.push(gr);trees=trees.filter(t=>Math.hypot(t.x-gx,t.y-gy)>1.6);
  const sea=seasonOf(dayCount);say(`${B(p)} died in the night, at ${ageI(p)}. The village carries ${p.name} up the hill in the ${sea} light.`,true);addEvent('death',`the ${sea} ${p.name} died`,`${p.name} died at ${ageI(p)}, and was carried up the hill in the ${sea} light.`);
  for(const q of people){const r=q.rels.find(r=>r.who===p.name);if(!r)continue;q.hist.push({d:dayCount,s:`lost ${r.k==='partner'?'their partner':r.k==='parent'?'their parent':r.k==='child'?'their child':r.k==='rival'?'an old rival':'a friend'}, ${p.name}`});
    if(r.k==='partner')q.partner=null;q.mourn=gr}
  // what p kept is handed down: partner first, then a grown child, then a friend, then the shelf in the hall (sprint 12)
  for(const t of thingsOf(p.name)){let h=p.partner?byName(p.partner):null;
    if(!h||h.dead)h=people.find(q=>!q.dead&&!isKid(q)&&q.parents.includes(p.name))||null;
    if(!h){const fr=p.rels.filter(r=>r.k==='friend').map(r=>byName(r.who)).filter(q=>q&&!q.dead&&!isKid(q));h=fr[0]||null}
    t.holder=h?h.name:0;
    if(h){t.hist.push({d:dayCount,s:`passed to ${h.name} when ${p.name} died`});h.hist.push({d:dayCount,s:`was given ${t.n} when ${p.name} died, and carries it`});
      say(`${Cap(t.n)} that ${p.name} kept goes to ${B(h)}, who holds it a long time before putting it away.`,true);
      if(!heirYr){heirYr=yearOf(dayCount);addEvent('heir','the first handing down',`When ${p.name} died, ${t.n} passed to ${h.name}. It was the first thing in ${V()} old enough to be handed down, and it will not be the last.`)}
      else if(R()<.4)addEvent('heir',`the ${sea} ${t.n} changed hands`,`${Cap(t.n)} — ${p.name}'s once — went to ${h.name}, with everything it remembers.`)}
    else{t.hist.push({d:dayCount,s:`set on the shelf in the hall when ${p.name} died, there being no one to take it`});
      say(`${Cap(t.n)} that ${p.name} kept goes onto the shelf in the hall, where things wait.`,true)}}}
// ---------- buildings, boats, roads ----------
function nextBuild(){if(bldgTgt)return null;for(const k in BLD){if(hasB(k))continue;const d=BLD[k];if(wood<d.wood||!d.cond())continue;let s=null;
    if(k==='hut'){const l=landings[0];s={x:l.x,y:l.y}}
    else if(k==='light')s=lightSite;else if(k==='bridge')s=bridgeSite;
    else if(k==='smoke'){const h=getB('hut');for(let n=0;n<60&&!s;n++){const x=h.x+((rnd(-4,5))|0),y=h.y+((rnd(-4,5))|0),t=at(x,y),t2=at(x+1,y);if((t===SAND||t===GRASS)&&(t2===SAND||t2===GRASS)&&Math.hypot(x-h.x,y-h.y)>=2&&!bAll().some(b=>x>=b.x-2&&x<=b.x+b.w&&y>=b.y-1&&y<=b.y+b.h)&&!houses.some(hh=>Math.abs(hh.x-x)<3&&Math.abs(hh.y-y)<3))s={x,y}}}
    else if(k==='well')s=freeSpot(2,5,1)||freeSpot(2,8,1);else if(k==='mill')s=freeSpot(5,11,2)||freeSpot(4,14,2);else if(k==='market')s=freeSpot(2,7,3)||freeSpot(2,12,3)||freeSpot(2,16,3);else if(k==='hall')s=freeSpot(3,9,3)||freeSpot(3,14,3)||freeSpot(3,18,3);
    if(s)return{kind:k,x:s.x,y:s.y,w:d.w,h:d.h,prog:0,work:d.work,done:false}}return null}
function finishBuilding(p,t){t.done=true;bldgTgt=null;bldg.push(t);craftUp(p,3);const nm=BLD[t.kind].name;
  const lines={hut:`${B(p)} hangs the last net on ${nm}. There is a boat now, and the sea is a little less far away.`,well:`${B(p)} draws the first bucket from ${nm}. It is cold and tastes of stone, and everyone has some.`,
    market:`${B(p)} sets the last stone of ${nm}. By noon there are three stalls and an argument about prices.`,mill:`${B(p)} lets go of the brake and the sail of ${nm} turns for the first time. The children run under it.`,
    smoke:`${B(p)} lights ${nm}. From now on the fish keep, and everything smells faintly of it.`,bridge:`${B(p)} lays the last plank of ${nm}. Nobody has to wade the stream any more, and several people do anyway.`,
    hall:`${B(p)} hangs the bell in ${nm}. It rings once, badly, and then rings properly at dawn.`,light:`${B(p)} climbs ${nm} at dusk and lights the lamp. Out on the water, something that was dark is not dark now.`};
  say(lines[t.kind],true);addEvent('build',`the ${sea()} ${nm} was built`,pick([`${p.name} finished ${nm}, and the place was different afterwards.`,`${nm} went up, and it was ${p.name} who set the last of it.`,`${p.name} put the last hand to ${nm}, and everyone found a reason to walk past it.`]));p.hist.push({d:dayCount,s:`finished ${nm}`});
  if(t.kind==='market'){for(let j=0;j<3;j++)for(let i=0;i<3;i++)road[idx(t.x+i,t.y+j)]=2;roadV++;spots.push({l:'the market',x:t.x+1.5,y:t.y+1.5})}
  if(t.kind==='well')spots.push({l:'the well',x:t.x+.5,y:t.y+.8});if(t.kind==='light')spots.push({l:'the lighthouse',x:t.x+.5,y:t.y+.8});if(t.kind==='bridge'){spots.push({l:'the bridge',x:t.x+.5,y:t.y+.5});bridgeUp=true}
  if(t.kind==='hall')bell(1);}
function bell(n){if(!AC||!audioOn)return;const m=storm?.3:rain?.6:wx==='fog'?.75:1;for(let i=0;i<n;i++){const t=AC.currentTime+i*1.6;for(const [f,v0] of [[880,.09],[1318,.04],[587,.03]]){const v=v0*m;const o=AC.createOscillator(),gn=AC.createGain();o.type='sine';o.frequency.value=f;gn.gain.setValueAtTime(v,t);gn.gain.exponentialRampToValueAtTime(.001,t+1.4);o.connect(gn).connect(sfxG||AC.destination);o.start(t);o.stop(t+1.5)}}}
function spawnBoat(kind,land,o){const b={kind,land,x:land.x+land.dx*17,y:land.y+land.dy*17,tx:land.x+land.dx*.9,ty:land.y+land.dy*.9,st:'in',t:0,...o};boats.push(b);return b}
// ---------- the works (sprint 10): what a village wants once it has what it needs ----------
const WORKS={
  orchard:{name:'an orchard',cond:()=>true,site:()=>freeSpot(6,14,2)},
  racks:{name:'drying racks by the hut',cond:()=>hasB('hut'),site:()=>{const h=getB('hut');return freeSpotNear(h.x,h.y,2,5,1)}},
  swing:{name:'a swing in the old tree',cond:()=>people.some(p=>isKid(p)),site:()=>{const o=spots.find(s=>s.l==='the old tree');return o?{x:o.x,y:o.y}:null}},
  ring:{name:'a ring of stones for the fire',cond:()=>true,site:()=>({x:center.x,y:center.y+1})},
  boat2:{name:'a second boat',cond:()=>hasB('hut')&&landings.length>1,site:()=>{const h=getB('hut');return{x:h.x,y:h.y+1}}},
  hives:{name:'beehives by the orchard',cond:()=>hasW('orchard'),site:()=>{const o=works.find(w=>w.wk==='orchard');return freeSpotNear(o.x,o.y,2,4,1)||freeSpot(6,14,1)}},
  bench:{name:'a bench at the lighthouse',cond:()=>hasB('light'),site:()=>{const l=getB('light');return freeSpotNear(l.x,l.y,1,4,1)}},
  shrine:{name:'the quiet stone',cond:()=>false,site:()=>freeSpot(2,5,1)||freeSpot(2,8,1)||{x:center.x+2,y:center.y+1}}, // never chosen by ambition — only by the noticing
  ruin1:{name:'the raising of the fallen stones',cond:()=>!!ruin&&ruinSeen>0,site:()=>({x:ruin.x,y:ruin.y+1.5})},
  ruin2:{name:'the mending of the old stones',cond:()=>hasW('ruin1')&&yearOf(dayCount)>workYear('ruin1'),site:()=>({x:ruin.x,y:ruin.y+1.5})},
  ruin3:{name:'a roof over the old stones',cond:()=>hasW('ruin2')&&yearOf(dayCount)>workYear('ruin2'),site:()=>({x:ruin.x,y:ruin.y+1.5})}};
const WORK_ORDER=['orchard','racks','swing','ring','boat2','hives','bench','ruin1','ruin2','ruin3'];
const workYear=k=>{const w=works.find(w=>w.wk===k&&w.done);return w?w.y0:99};
// state effects of a finished work, applied both at the finish and again on load (must be idempotent, no rnd())
function applyWork(w){
  if(w.wk==='orchard'){if(!trees.some(t=>t.o)){for(let i=0;i<3;i++)trees.push({x:w.x+.5+i*1.4,y:w.y+.8,s:.55,hp:3,b:true,a:.2+i*.3,o:1})}spots.push({l:'the orchard',x:w.x+1.5,y:w.y+1.6})}
  else if(w.wk==='bench')spots.push({l:'the bench',x:w.x+.5,y:w.y+.8});
  else if(w.wk==='shrine')spots.push({l:'the quiet stone',x:w.x+.5,y:w.y+1.2});
  else if(w.wk==='ruin1'){if(ruin)for(const st of ruin.st)st.f=false}
  else if(w.wk==='ruin2'){if(ruin&&!ruin.mended){ruin.mended=1;ruin.st.push({x:ruin.x-1.2,y:ruin.y+.6,h:2,f:false,w:1},{x:ruin.x+1.4,y:ruin.y-.8,h:2,f:false,w:1})}}
  else if(w.wk==='ruin3'){if(ruin){ruin.roof=1;spots.push({l:'the old house',x:ruin.x,y:ruin.y+1.6})}}}
const FOUND=['a bone comb, worked all over with waves','a child\'s wooden horse, smooth with handling','a blue glass bead on a rotted cord'];
function finishWork(p,w){w.done=true;w.y0=yearOf(dayCount);applyWork(w);
  const L={orchard:`${B(p)} firms the ground around the third sapling and stands back. Three trees in a row. An orchard, ${p.name} says, trying the word on.`,
    racks:`${B(p)} lashes the last of the drying racks by the hut. The catch will keep now, and the gulls have already noticed and been disappointed.`,
    swing:`${B(p)} hangs a swing from the old tree and tests it, alone, at some length, before any child is told.`,
    ring:`${B(p)} rolls the last stone in against the fire pit. The fire sits in its ring now like something kept, which it is.`,
    boat2:`${B(p)} turns the new boat over on the sand and steps back. Two boats. The sea is about to become half the larder.`,
    hives:`${B(p)} stands very still while the bees decide about the new hives, and they decide to stay.`,
    bench:`${B(p)} sets a bench by the lighthouse, facing the water, for whoever turns out to need it.`,
    ruin1:`${B(p)} levers the last of the fallen stones upright. They stand the way someone once meant them to stand, and the grass moves around them differently now.`,
    ruin2:`${B(p)} fits the last stone into the old work. Whole, for the first time in anyone's memory, or their grandmother's.`,
    ruin3:`${B(p)} lays the last of the roof over the old stones. There is an old house now, and it does not feel empty any more.`,
    shrine:`${B(p)} stands the flat stone upright and sets a hollowed stone at its foot, for whatever wants leaving, and does not explain, and is not asked to.`};
  say(L[w.wk],true);p.hist.push({d:dayCount,s:`made ${WORKS[w.wk].name} for ${V()}`});
  if(w.wk==='shrine'){faith=Math.min(1,faith+.1);stoneTap(w.x,w.y);
    addEvent('shrine','the raising of the quiet stone',`${p.name} set a flat stone upright near the hearth, with a hollow at its foot for whatever wants leaving. Nobody called it anything but the quiet stone, and nobody had to be told what it was for.`)}
  else addEvent('work',`the ${sea()} ${WORKS[w.wk].name.replace(/^(an?|the) /,'the ')} was made`,`${p.name} made ${WORKS[w.wk].name} in the ${sea()} of year ${yearOf(dayCount)}, because nobody needed it and everybody wanted it.`);
  if(w.wk==='ruin1'||w.wk==='ruin3'){const av=FOUND.filter(f=>!things.some(t=>t.full===f)),f=av[(R()*av.length)|0]||FOUND[0],sn=f.split(',')[0];
    say(`Under the stones there was ${f}. Everyone has held it once. It should go on the shelf in the hall, and it will, eventually; for now it stays in ${B(p)}'s pocket, and everyone pretends not to know.`,true);
    addEvent('found',`the finding of ${sn}`,`Working on the old stones, they turned up ${f}. Whoever it belonged to is long past asking for it back. It was ${p.name} who lifted it out, and ${p.name} who kept it.`);
    things.push({n:sn,full:f,holder:p.name,src:'found',hist:[{d:dayCount,s:`came up out of the old stones, into ${p.name}'s hands`}]});
    p.hist.push({d:dayCount,s:`lifted ${sn} out of the old stones, and kept it`})}}
function stepBoats(dt){for(const b of boats){
    if(!isFinite(b.x)||!isFinite(b.y)){try{console.warn('hearth: non-finite boat',b.kind)}catch(e){}b.gone=true;if(b.p){b.p.inBoat=false;b.p.x=b.land.x;b.p.y=b.land.y;b.p.task='idle';b.p.t=1}continue}
    if(b.gvx){const nx=b.x+b.gvx*dt,ny=b.y+b.gvy*dt;if(at(nx|0,ny|0)===WATER){b.x=nx;b.y=ny;if(b.p){b.p.x=nx;b.p.y=ny}}const k=Math.pow(.12,dt);b.gvx*=k;b.gvy*=k;if(Math.abs(b.gvx)+Math.abs(b.gvy)<.08)b.gvx=b.gvy=0}
    if(b.st==='in'||b.st==='out'||b.st==='back'){const dx=b.tx-b.x,dy=b.ty-b.y,d=Math.hypot(dx,dy),sp=(b.kind==='trade'?2.2:b.kind==='away'||b.kind==='return'?2.4:2.8)*(hasWay(0)&&b.kind==='fish'?1.35:1)*dt*(storm?.6:1);
      if(d<sp){b.x=b.tx;b.y=b.ty;boatArrive(b)}else{b.x+=dx/d*sp;b.y+=dy/d*sp;if(R()<dt*6)fx.push({x:b.x-dx/d*.6,y:b.y-dy/d*.6+.2,vx:0,vy:0,c:'#cfe6ff',l:.8})}
      if(b.p){b.p.x=b.x;b.p.y=b.y}}
    else if(b.st==='wait'){b.t-=dt;if(b.t<=0){b.st='out';b.tx=b.land.x+b.land.dx*20;b.ty=b.land.y+b.land.dy*20;if(b.kind==='trade'){trader=null;say(`The trader's boat pulls out into the channel. A few people stay on the shore until it is small.`,false,'tradeout')}}}
    else if(b.st==='fishing'){b.t-=dt;if(R()<dt*.6)fx.push({x:b.x+rnd(-1,1),y:b.y+rnd(.4,1.2),vx:0,vy:-.3,c:'#cfe6ff',l:.4});if(b.t<=0||storm){b.st='back';b.tx=b.land.x+b.land.dx*.9;b.ty=b.land.y+b.land.dy*.9}}
  }
  boats=boats.filter(b=>!b.gone)}
function boatArrive(b){
  if(b.kind==='arrival'&&b.st==='in'){b.gone=true;
    if(b.fam){const a=addPerson(b.land.x,b.land.y,{age:rnd(24,38)|0,how:'came ashore with a whole family in one boat'}),c=addPerson(b.land.x,b.land.y,{age:rnd(24,38)|0,how:'came ashore with a whole family in one boat'});
      a.partner=c.name;c.partner=a.name;relate(a,c,'partner');a.wantHouse=c.wantHouse=true;
      const kd=addPerson(b.land.x+.5,b.land.y,{child:true,age:rnd(2,8)|0,parents:[a.name,c.name],how:'came ashore asleep in the bottom of the family\'s boat'});
      relate(a,kd,'child');relate(c,kd,'child');kd.col=R()<.5?a.col:c.col;kd.hair=R()<.5?a.hair:c.hair;
      meet(a,1,2);meet(c,1,2);
      say(`A boat comes in carrying a whole family: ${B(a)}, ${B(c)}, and small ${B(kd)}, who sleeps through the entire business of arriving somewhere forever.`,true);
      addEvent('family',`the day ${a.name} and ${c.name} brought their boat in`,`${a.name} and ${c.name} came ashore with everything they had and a sleeping child, ${kd.name}, and by the next evening it was as if they had always been coming.`)}
    else{const p=addPerson(b.land.x,b.land.y,{age:b.age});meet(p,1,3);const f=p.rels[0]?byName(p.rels[0].who):null;
      say(`A stranger named ${B(p)} pulls a boat up on the sand and asks to stay.${f?' '+f.name+' is the first to walk down.':''}`);addEvent('arrival',`the day ${p.name} came ashore`,ARRIVED(p))}}
  else if(b.kind==='trade'&&b.st==='in'){b.st='wait';b.t=45;trader=b;
    // the trade answers the stock now, and whoever keeps the store does the talking
    const talker=people.filter(q=>!q.dead&&q.craft===4).sort((a,c)=>c.cxp-a.cxp)[0]||null;
    const bump=talker?1+talker.cxp*.15:1;let eff;
    if(food+granary<people.length*4){granary+=Math.round(14*bump);if(wood>=4)wood-=4;
      eff='sees how the store stands, says nothing about it, and leaves more meal than the timber was worth'}
    else if(wood>=30){wood-=10;granary+=Math.round(12*bump);
      eff='takes ten lengths of good timber and pays in meal, fairly, after a long conversation about it'}
    else{wood+=4;granary+=Math.round(5*bump);
      eff='trades small things for smaller ones and leaves everyone feeling they did well out of it'}
    if(talker){craftUp(talker,4);if(R()<.5)talker.hist.push({d:dayCount,s:'did the talking when the trader came, and did it well'})}
    say(`A trader's boat comes in to ${V()} and everyone who can finds a reason to be on the shore. The trader ${eff}.`,true);addEvent('trade',`the ${sea()} the trader came`,pick([`The trader's boat came in and everyone who could find a reason was on the shore for it.`,`The trader came, and went, and the store was a little different after.`,`A trading boat put in for a day and left news behind as well as goods.`]));
    const wav=people.filter(p=>!p.dead&&p.task!=='sleep'&&p.task!=='boat'&&p.task!=='voyage'&&p.task!=='build'&&!p.inside).sort(()=>R()-.5).slice(0,8);
    for(const q of wav){const s=nearestShore(b.land.x+rnd(-3,3),b.land.y+rnd(-3,3))||b.land;goTo(q,s.x,s.y,'wave',rnd(12,30));if(q.tgt&&q.tgt.claimed)q.tgt.claimed=false;q.tgt=null}
    if(R()<.5&&wav.length){const q=pick(wav);q.hist.push({d:dayCount,s:pick(['bought a length of red cloth off the trader','traded a carved bird to the trader for a knife','asked the trader for news of home and got some'])})}}
  else if(b.kind==='fish'){if(b.st==='in'){b.st='fishing';b.t=rnd(10,16)}else if(b.st==='back'){b.gone=true;const p=b.p;if(p){p.task='idle';p.t=1;p.inBoat=false;p.x=b.land.x;p.y=b.land.y;p.tx=p.x;p.ty=p.y;/* step ashore, not out at the mooring */const n=(sea()==='winter'?3:6)+(hasW('racks')?1:0)+(hasWay(0)?1:0)+(arcK()==='shoal'?5:0);if(hasB('smoke')&&(sea()==='autumn'||sea()==='winter'))granary+=n;else food+=n;craftUp(p,2);p.boats=(p.boats||0)+1;if(p.boats===1)p.hist.push({d:dayCount,s:'first took the boat out past the shallows'});if(R()<.3)say(`${B(p)} rows in with the bottom of the boat silver, and hands the fish up the beach.`,false,'boatin')}}}
  else if(b.kind==='return2'&&b.st==='in'){b.gone=true;const g=b.ret;gone=gone.filter(x=>x!==g);
    const aged=g.age0!==undefined?Math.min(72,(g.age0+(dayCount-g.born)/YEAR)|0):undefined;
    const p=addPerson(b.land.x,b.land.y,{name:g.name,age:aged,how:'came back, older, in a kind season, and was given bread before any questions, the same as the first day'});
    for(const q of people){if(q===p)continue;const r=q.rels.find(r=>r.who===p.name);if(!r)continue; // the village never forgot; now the memory runs both ways again
      if(r.k==='partner')r.k='friend';
      p.rels.push({who:q.name,k:{friend:'friend',rival:'rival',parent:'child',child:'parent'}[r.k]||'friend'})}
    say(`A boat comes in that nobody sent for. It is ${B(p)}, older, asking if the house is still short a pair of hands.`,true);
    addEvent('back',`the ${sea()} ${p.name} came back`,`${p.name}, who left in a hungry season, came back when the seasons turned kind, and was given bread before any questions.`);
    for(const t of things){if(t.holder===0&&t.hist.some(h=>h.s.includes(p.name+' sailed'))){t.holder=p.name; // what was left on the shelf goes back into the pocket it knows
      t.hist.push({d:dayCount,s:`came back off the shelf the day ${p.name} returned, from exactly where it was left`});
      say(`${B(p)} goes into the hall before going anywhere else, and comes out with ${t.n}, which has been waiting the whole time.`,true)}}
    for(const q of people){if(q===p)continue;const r=q.rels.find(r=>r.who===p.name);if(r)q.hist.push({d:dayCount,s:`was on the shore the day ${p.name} came back`})}}
  else if(b.kind==='away'&&b.st==='out'){b.gone=true;const p=b.p;p.inBoat=false;people=people.filter(q=>q!==p);if(selected===p)showCard(null)}
  else if(b.kind==='return'&&b.st==='in'){b.gone=true;const p=b.p;p.x=b.land.x;p.y=b.land.y;p.task='idle';p.t=2;p.inBoat=false;p.inside=false;p.tgt=null;people.push(p);voyage.st='back';farIsle.lit=false;
    const found=pick(['a stone in each pocket, and says there is nothing there but gulls and a wall, and will not say more','a bird\'s skull and a story about a cold fire pit, older than any of ours','less than went out, and says the far island is only rock, and does not sound sure','a bit of green glass and says the sea goes on past it, further than anyone thought']);
    say(`A boat comes in from the far island. It is ${B(p)}, back with ${found}.`,true);p.hist.push({d:dayCount,s:`came back from the far island with ${found.split(',')[0]}`});addEvent('returned',`the ${sea()} ${p.name} came back from the far island`,`${p.name} came back from the far island, with ${found.split(',')[0]}.`);
    for(const q of people){const r=q.rels.find(r=>r.who===p.name);if(r&&q!==p)q.hist.push({d:dayCount,s:`was on the shore when ${p.name} came back from the far island`})}}
  else if(b.st==='out')b.gone=true}
// ---------- wildlife (sprint 4) ----------
const landAt=(x,y)=>{const t=at(x|0,y|0);return t===GRASS||t===SAND||t===ROCK||t===FARM};
function forestTree(){for(let k=0;k<30;k++){const t=pick(trees);if(t&&t.hp>0&&t.s>.6&&Math.hypot(t.x-center.x,t.y-center.y)>9&&!houses.some(h=>Math.hypot(h.x-t.x,h.y-t.y)<5))return t}return null}
function spawnWildlife(){wild=[];const nd=Math.min(5,1+((trees.length/45)|0));for(let i=0;i<nd;i++){const t=forestTree();if(t)wild.push({k:'deer',x:t.x+rnd(-1,1),y:t.y+rnd(.5,1.5),tx:0,ty:0,home:t,st:'graze',t:rnd(1,5),chk:R(),f:R()<.5?1:-1})}
  for(let i=0;i<4;i++){const s=freeSpot(6,22);if(s)wild.push({k:'rabbit',x:s.x+.5,y:s.y+.5,tx:0,ty:0,home:{x:s.x+.5,y:s.y+.5},st:'sit',t:rnd(1,3),chk:R(),f:1})}
  gulls=[];for(let i=0;i<4;i++)addGull();fishSh=[];const shal=[];for(let y=2;y<H-2;y+=2)for(let x=2;x<W-2;x+=2){const e=elev[idx(x,y)];if(at(x,y)===WATER&&e>.13&&e<.235&&(at(x-1,y)===WATER&&at(x+1,y)===WATER))shal.push({x,y})}
  for(let i=0;i<9&&shal.length;i++){const s=pick(shal);fishSh.push({x:s.x+.5,y:s.y+.5,tx:s.x+.5,ty:s.y+.5,n:2+((R()*3)|0),t:0,ph:R()*6})}
  for(let i=0;i<2&&stream.length>10;i++){const s=stream[(R()*stream.length)|0];fishSh.push({x:s.x+.5,y:s.y+.5,tx:s.x+.5,ty:s.y+.5,n:2,t:0,ph:R()*6,st:true})}}
function addGull(near){const s=near||(hasB('hut')&&R()<.5?getB('hut'):pick(shore))||center;gulls.push({cx:s.x+.5,cy:s.y+.5,r:rnd(2,5),a:rnd(6.28),sp:rnd(.7,1.3)*(R()<.5?1:-1),x:0,y:0,t:rnd(4,12),ph:rnd(6.28)})}
function stepWild(dt){const s=sea(),night=isNight();
  // nothing walks into the sea: take the step if it lands, slide along the shore if one axis does, refuse otherwise
  const slide=(w,nx,ny)=>{if(landAt(nx,ny)){w.x=nx;w.y=ny;return true}if(landAt(nx,w.y)){w.x=nx;return true}if(landAt(w.x,ny)){w.y=ny;return true}return false};
  // deer, rabbits, fox
  const ndeer=s==='winter'?2:Math.min(5,1+((trees.length/45)|0)), nrab=snowD>.6?2:5;
  const cd=wild.filter(w=>w.k==='deer').length,cr=wild.filter(w=>w.k==='rabbit').length;
  if(cd<ndeer&&R()<dt*.008){const t=forestTree();if(t)wild.push({k:'deer',x:t.x+rnd(-1,1),y:t.y+rnd(.5,1.5),tx:0,ty:0,home:t,st:'graze',t:rnd(1,5),chk:R(),f:1})}
  if(cr<nrab&&R()<dt*.012){const s=(farms.length&&R()<.6)?freeSpotNear(pick(farms).x,pick(farms).y,2,5,1):freeSpot(6,22);if(s)wild.push({k:'rabbit',x:s.x+.5,y:s.y+.5,tx:0,ty:0,home:{x:s.x+.5,y:s.y+.5},st:'sit',t:rnd(1,3),chk:R(),f:1})}
  const fox=wild.find(w=>w.k==='fox');
  if(!fox&&night&&!storm&&s!=='winter'&&R()<dt*.02){const t=forestTree();if(t){wild.push({k:'fox',x:t.x,y:t.y+.8,tx:t.x,ty:t.y+.8,st:'trot',t:0,chk:R(),f:1});if(R()<.25)say('A fox comes down through the trees after dark, low and quick, and the rabbits are already gone.',false,'fox')}}
  else if(fox&&!night){fox.st='leave';fox.tx=fox.x+(fox.x<center.x?-30:30);fox.ty=fox.y}
  for(const w of wild){w.chk-=dt;
    // anything that somehow ended up in the sea goes home (a fox just leaves)
    if(!landAt(w.x,w.y)&&w.st!=='leave'){if(w.k==='fox'){w.gone=true;continue}const hm=w.home||center;w.x=hm.x;w.y=hm.y;w.tx=hm.x;w.ty=hm.y;w.st=w.k==='deer'?'graze':'sit';w.t=rnd(1,3)}
    if(w.k==='deer'){if(w.chk<=0){w.chk=.35;if(w.st!=='flee'){let th=null;for(const p of people){if(p.inside||p.task==='sleep')continue;const d=Math.hypot(p.x-w.x,p.y-w.y);if(d<(p.task==='chop'?5.5:3.2)){th=p;break}}
          if(!th&&fox&&Math.hypot(fox.x-w.x,fox.y-w.y)<3)th=fox;
          if(th){w.st='flee';const dx=w.x-th.x,dy=w.y-th.y,d=Math.hypot(dx,dy)||1;let tx=w.x+dx/d*8,ty=w.y+dy/d*6;for(let k=0;k<6&&!landAt(tx,ty);k++){const a=rnd(6.28);tx=w.x+Math.cos(a)*7;ty=w.y+Math.sin(a)*5}w.tx=tx;w.ty=ty;w.f=dx<0?-1:1;if(th.task==='chop'&&R()<.15)say(`A deer breaks from the trees at the sound of the axe and is gone before ${B(th)} has looked up.`,false,'deerflee')}}
        if(w.home&&(w.home.hp<=0||!trees.includes(w.home))){w.home=forestTree()}}
      if(w.st==='graze'){w.t-=dt;if(w.t<=0){w.st='move';const h=w.home||center;let tx=h.x+rnd(-4,4),ty=h.y+rnd(-2.5,3.5);for(let k=0;k<5&&!landAt(tx,ty);k++){tx=h.x+rnd(-4,4);ty=h.y+rnd(-2.5,3.5)}w.tx=tx;w.ty=ty;w.f=tx<w.x?-1:1;if(R()<.12&&w.home){w.home=forestTree()||w.home}}}
      else{const sp=(w.st==='flee'?7:night?.6:1.3)*dt,dx=w.tx-w.x,dy=w.ty-w.y,d=Math.hypot(dx,dy);if(d<sp){if(landAt(w.tx,w.ty)){w.x=w.tx;w.y=w.ty}w.st='graze';w.t=rnd(2,7)}
        else if(!slide(w,w.x+dx/d*sp,w.y+dy/d*sp)){w.st='graze';w.t=rnd(1,3)}}} // a deer with nowhere to run stands at the edge
    else if(w.k==='rabbit'){if(w.chk<=0){w.chk=.3;if(w.st!=='hide'&&w.st!=='flee'){let th=null;for(const p of people){if(p.inside||p.task==='sleep')continue;if(Math.hypot(p.x-w.x,p.y-w.y)<2.6){th=p;break}}if(!th&&fox&&Math.hypot(fox.x-w.x,fox.y-w.y)<5)th=fox;
          if(th){w.st='flee';const dx=w.x-th.x,dy=w.y-th.y,d=Math.hypot(dx,dy)||1;let tx=w.x+dx/d*5,ty=w.y+dy/d*3.5;for(let k=0;k<5&&!landAt(tx,ty);k++){tx=w.home.x+rnd(-2,2);ty=w.home.y+rnd(-2,2)}w.tx=tx;w.ty=ty;w.f=dx<0?-1:1}}}
      if(w.st==='hide'){w.t-=dt;if(w.t<=0&&!(snowD>.6&&R()<.7)){w.st='sit';w.t=rnd(1,3);const sx=w.home.x+rnd(-1,1),sy=w.home.y+rnd(-1,1);if(landAt(sx,sy)){w.x=sx;w.y=sy}else{w.x=w.home.x;w.y=w.home.y}}}
      else if(w.st==='sit'){w.t-=dt;if(w.t<=0){w.st='hop';let tx=w.home.x+rnd(-2.5,2.5),ty=w.home.y+rnd(-2,2);if(!landAt(tx,ty)){tx=w.home.x;ty=w.home.y}w.tx=tx;w.ty=ty;w.f=tx<w.x?-1:1;if(R()<.06){const s=farms.length&&R()<.6?freeSpotNear(pick(farms).x,pick(farms).y,2,5,1):freeSpot(6,22);if(s)w.home={x:s.x+.5,y:s.y+.5}}}}
      else{const sp=(w.st==='flee'?6:2.2)*dt,dx=w.tx-w.x,dy=w.ty-w.y,d=Math.hypot(dx,dy);if(d<sp){if(landAt(w.tx,w.ty)){w.x=w.tx;w.y=w.ty}if(w.st==='flee'){w.st='hide';w.t=rnd(3,9);w.sc=(w.sc||0)+1;if(w.sc>3){w.sc=0;const s=freeSpot(9,24);if(s)w.home={x:s.x+.5,y:s.y+.5}}}else{w.st='sit';w.t=rnd(.6,3)}}else if(!slide(w,w.x+dx/d*sp,w.y+dy/d*sp)){w.tx=w.x;w.ty=w.y}}} // a blocked rabbit goes to ground where it is
    else if(w.k==='fox'){if(w.st==='leave'){const dx=w.tx-w.x,dy=w.ty-w.y,d=Math.hypot(dx,dy),sp=4*dt;w.x+=dx/d*sp;w.y+=dy/d*sp;w.f=dx<0?-1:1;if(d<sp||w.x<0||w.x>W||!landAt(w.x,w.y))w.gone=true;continue}
      let prey=null;if(w.chk<=0){w.chk=.3;let bd=5;for(const r of wild)if(r.k==='rabbit'&&r.st!=='hide'){const d=Math.hypot(r.x-w.x,r.y-w.y);if(d<bd){bd=d;prey=r}}if(prey){w.prey=prey;w.st='chase'}else if(w.st==='chase'){w.st='trot';w.t=0}}
      if(w.st==='chase'&&w.prey){if(w.prey.st==='hide'||w.prey.gone){w.st='trot';w.t=0;w.prey=null}else{w.tx=w.prey.x;w.ty=w.prey.y;const dx=w.tx-w.x,dy=w.ty-w.y,d=Math.hypot(dx,dy),sp=5.5*dt;if(d<.4){w.prey.gone=true;w.prey=null;w.st='eat';w.t=rnd(4,8);if(R()<.4)say('Out past the fields something small stops running. The fox has one of the rabbits, and the night goes on.',false,'foxeat')}else if(slide(w,w.x+dx/d*sp,w.y+dy/d*sp)){w.f=dx<0?-1:1}else{w.st='trot';w.t=0;w.prey=null}}} // a fox does not swim for a rabbit
      else if(w.st==='eat'){w.t-=dt;if(w.t<=0){w.st='trot';w.t=0}}
      else{w.t-=dt;if(w.t<=0){w.t=rnd(2,5);let tx=w.x+rnd(-7,7),ty=w.y+rnd(-5,5);for(let k=0;k<6&&(!landAt(tx,ty)||houses.some(h=>Math.hypot(h.x+1-tx,h.y+1-ty)<3)||Math.hypot(tx-center.x,ty-center.y)<4);k++){tx=w.x+rnd(-7,7);ty=w.y+rnd(-5,5)}w.tx=tx;w.ty=ty;w.f=tx<w.x?-1:1}
        const dx=w.tx-w.x,dy=w.ty-w.y,d=Math.hypot(dx,dy),sp=2.4*dt;if(d>sp&&!slide(w,w.x+dx/d*sp,w.y+dy/d*sp))w.t=0}}
  }
  wild=wild.filter(w=>!w.gone);
  // gulls
  const fb=boats.find(b=>b.kind==='fish'&&(b.st==='back'||b.st==='fishing'));const ng=storm?1:wx==='fog'?2:night?2:(fb?7:5)+(arcK()==='shoal'?3:0);
  if(gulls.length<ng&&R()<dt*.6)addGull(fb&&R()<.7?fb:null);else if(gulls.length>ng&&R()<dt*.4)gulls.pop();
  for(const gl of gulls){gl.a+=gl.sp*dt;gl.t-=dt;if(gl.t<=0){gl.t=rnd(5,14);const s=fb&&R()<.6?fb:R()<.4&&hasB('hut')?getB('hut'):pick(shore)||center;gl.nx=s.x+.5;gl.ny=s.y+.5}
    if(gl.nx!==undefined){const dx=gl.nx-gl.cx,dy=gl.ny-gl.cy,d=Math.hypot(dx,dy),sp=1.6*dt;if(d<sp){gl.cx=gl.nx;gl.cy=gl.ny;gl.nx=undefined}else{gl.cx+=dx/d*sp;gl.cy+=dy/d*sp}}
    else if(fb&&R()<dt*.5){gl.nx=fb.x;gl.ny=fb.y}
    gl.x=gl.cx+Math.cos(gl.a)*gl.r;gl.y=gl.cy+Math.sin(gl.a)*gl.r*.55}
  // fish shadows: drift about the shallows
  if(!frozen)for(const f of fishSh){f.t-=dt;if(f.t<=0){f.t=rnd(3,8);for(let k=0;k<6;k++){const tx=f.x+rnd(-3,3),ty=f.y+rnd(-2,2);const e=elev[idx(tx|0,ty|0)]||0;if(at(tx|0,ty|0)===WATER&&(f.st?e<.2:(e>.11&&e<.235))){f.tx=tx;f.ty=ty;break}}}
    const dx=f.tx-f.x,dy=f.ty-f.y,d=Math.hypot(dx,dy),sp=.7*dt;if(d>sp){f.x+=dx/d*sp;f.y+=dy/d*sp}
    for(const p of people)if(p.task==='fish'&&Math.hypot(p.x-f.x,p.y-f.y)<1.5){f.tx=f.x+(f.x-p.x)*2;f.ty=f.y+(f.y-p.y)*2;break}}
  // fireflies: summer twilight over the grass
  const fl=s==='summer'&&!rain&&wx!=='fog'&&light()<.45&&light()>0&&!isNight()||(s==='summer'&&!rain&&isNight()&&dayFrac()>edges()[1]&&dayFrac()<edges()[1]+.06);
  if(fl&&flies.length<36&&R()<dt*20){const sp=freeSpot(3,20);if(sp)flies.push({x:sp.x+rnd(),y:sp.y+rnd(),ph:rnd(6.28),vx:0,vy:0,l:rnd(30,80)})}
  for(const f of flies){f.vx+=rnd(-.6,.6)*dt;f.vy+=rnd(-.4,.4)*dt;f.vx*=.98;f.vy*=.98;f.x+=f.vx*dt;f.y+=f.vy*dt;f.l-=dt*(fl?1:6)}flies=flies.filter(f=>f.l>0);
  // geese in autumn, at dawn or dusk
  if(!geese&&s==='autumn'&&geeseDay!==dayCount&&!storm&&wx!=='fog'&&!rain){const f=dayFrac(),e=edges();if(((f>e[0]+.02&&f<e[0]+.1)||(f>e[1]-.12&&f<e[1]-.02))&&R()<dt*.08){geeseDay=dayCount;const fromLeft=R()<.5;geese={x:fromLeft?-6:W+6,y:rnd(6,H*.5),vx:(fromLeft?1:-1)*rnd(4.5,6),vy:rnd(1.2,2.4),n:7+((R()*5)|0),ph:R()*6};
      say(pick(['A long V of geese goes over, high, calling to each other about the way south.','Geese go over in a ragged V, and everyone stops what they are doing to watch until they are gone.']),false,'geese')}}
  if(geese){geese.x+=geese.vx*dt;geese.y+=geese.vy*dt;if(geese.x<-14||geese.x>W+14||geese.y>H+8)geese=null}
  // the whale, far out
  if(!whale){whaleT-=dt;if(whaleT<=0){whaleT=rnd(140,420);if(deep.length&&!frozen&&!storm&&wx!=='fog'&&!night&&s!=='winter'){const d=pick(deep);whale={x:d.x+.5,y:d.y+.5,t:0,dur:rnd(5,8),dir:R()<.5?1:-1};whaleDay=dayCount;
      if(R()<.4)say(pick(['Far out past the shallows, something breathes. A spout goes up white against the water, hangs, and is gone.','Out where the water is dark, a back like a wet hill rolls over and goes under, and a while later the spout drifts off on the wind.']),false,'whale')}}}
  else{whale.t+=dt;if(whale.t<2.2&&R()<dt*40)fx.push({x:whale.x+rnd(-.2,.2),y:whale.y-.3-whale.t*.4,vx:rnd(-.3,.3)+(storm?.6:0),vy:-rnd(.6,1.4),c:'#eaf3ff',l:rnd(.5,1.1)});whale.x+=whale.dir*dt*.25;if(whale.t>whale.dur)whale=null}
}
