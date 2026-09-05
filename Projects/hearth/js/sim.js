// Hearth — step() — the simulation tick that moves everyone and everything.
// Classic scripts sharing one global scope; the load order in index.html is the old single file’s order and it matters.
// ---------- simulation ----------
function step(dt){
  const d0=Math.floor(time/dayLen);time+=dt;if(Math.floor(time/dayLen)>d0){dayCount++;newDay()} // > not !==: a backward wobble across a boundary must not run a day twice
  const s=sea();
  // weather fronts
  wxT-=dt;if(wxT<=0){let n;
    if(wx==='thunder')n=R()<.6?'rain':'clear';
    else if(wx==='clear'||wx==='overcast'){n=pickWx();if(n===wx)n=wx==='clear'?'overcast':'clear';if(wx==='clear'&&(n==='rain'||n==='thunder')&&R()<.35)n='overcast'}
    else n=R()<.5?'clear':'overcast';
    const f=dayFrac();if(n==='fog'&&f>.35&&f<.72)n='overcast';
    if(n==='rain'&&s==='winter')n='snow';if(n==='snow'&&s!=='winter'&&!(s==='autumn'&&seaDay()===4))n=R()<.5?'rain':'overcast';
    setWx(n)}
  flash=Math.max(0,flash-dt*5);fogA+=((wx==='fog'?1:0)-fogA)*Math.min(1,dt*.12);
  if(storm){thunderT-=dt;if(thunderT<=0){thunderT=rnd(1.5,7);flash=RM?.3:1;thunder(rnd(.3,3.2))}
    // storms flatten crops and take down the odd tree
    if(farms.length&&R()<dt*.02){const cand=farms.filter(f=>f.g>.3);if(cand.length){const f=pick(cand);f.g*=.2;say('The wind lays a field flat. Someone will have to start it again.',false,'flat')}}
    if(trees.length>5&&R()<dt*.006){const cand=trees.filter(t=>t.s>.8&&t.hp>0);if(cand.length){const t=pick(cand);t.hp=0;addStump(t.x,t.y);wood+=3;say('A crack in the dark: the storm takes a tree down. In the morning there will be wood to gather.',false,'treefall')}}}
  // snow lies, and melts
  if(wx==='snow')snowD=Math.min(1,snowD+dt*(arcK()==='longwinter'?.01:.006));else if(rain)snowD=Math.max(0,snowD-dt*.006);else if(s!=='winter')snowD=Math.max(0,snowD-dt*.0025*(temper==='cold'?.6:1));else snowD=Math.max(0,snowD-dt*.0002);
  const fr=snowD>.3;if(fr!==frozen){frozen=fr;if(fr)say('The shallows have frozen over. The water goes still and white at the edges.',true);else say('The ice goes out of the shallows with a sound like something breaking a long way off.',true)}
  // a snowman is only ever as tall as the snow it stands in (sprint 16); when the ground lets go, so does the snowman
  if(snowmen.length){for(const s2 of snowmen)s2.s=Math.min(s2.s,Math.max(.2,snowD*1.6));
    if(snowD<.05){snowmen=[];say('The snow lets go of its people: the snowman slumps into the grass, and nobody sees the moment it stops being one.',false,'snowmelt')}}
  // dry spells: the ground remembers how long since rain — and a drought arc turns the screw hard
  if((s==='spring'||s==='summer')&&!rain)dry01=Math.min(1,dry01+dt*.0016*(temper==='dry'?1.5:1)*(arcK()==='drought'?3.2:1));else dry01=Math.max(0,dry01-dt*(rain?.02:.004));
  // farms grow — not in winter, slowly in autumn, not under snow, grudgingly when the ground is dry, and better behind the plough
  const grow={spring:1,summer:1.15,autumn:.65,winter:0}[s]*(snowD>.5?0:1)*(dry01>.85?.25:dry01>.7?.5:1)*(hasWay(1)?1.25:1);
  if(grow>0)for(const f of farms)if(f.g<1)f.g+=dt*(rain?.022:.011)*(isNight()?.4:1)*grow;
  // leaves and petals
  if(s==='autumn'&&trees.length&&R()<dt*8){const t=pick(trees);if(t.s>.5)fx.push({x:t.x+rnd(-.5,.5),y:t.y-.9,vx:rnd(-.7,.2),vy:rnd(.25,.5),c:t.a<.35?'#c47a2a':t.a<.7?'#b8402a':'#b09a2c',l:rnd(1.5,2.6)})}
  if(s==='spring'&&seaDay()<=3&&trees.length&&R()<dt*2){const t=pick(trees);if(t.b&&t.s>.6)fx.push({x:t.x+rnd(-.5,.5),y:t.y-.9,vx:rnd(-.5,.3),vy:rnd(.2,.4),c:'#e8a0b8',l:rnd(1.5,2.5)})}
  // winter fires eat wood (kiln-dried, it burns longer)
  if(s==='winter'&&isNight()&&R()<dt*.02*houses.length*(hasWay(2)?.7:1))wood=Math.max(0,wood-1);
  // saplings grow / regrow forest
  for(const t of trees)if(t.hp>0&&t.s<1)t.s+=dt*.012;
  if(sea()!=='winter'&&trees.length<260&&R()<dt*.3){const s=freeSpot(11,40);if(s&&(R()<.3||trees.some(t=>Math.hypot(t.x-s.x,t.y-s.y)<3)))trees.push(mkTree(s.x+.5,s.y+.5,.15))}
  // arrivals
  arrivalT-=dt;if(arrivalT<=0){arrivalT=rnd(70,140)*(1+people.length/10)*(hasB('light')?.75:1)*(1+wayN()*.35);/* a village that has learned its ways fills slower, and stays a village longer */if(people.length<popCap()&&people.length<48&&food>people.length*2&&!storm&&!boats.some(b=>b.kind==='arrival')){
    const age=R()<.2?rnd(50,64)|0:rnd(18,42)|0;
    const fam=!famDone&&people.length>=8&&people.length<popCap()-2&&R()<.14; // once, a whole family in one boat
    if(landings.length){const l=landings[(R()*Math.min(landings.length,6))|0];if(fam)famDone=true;spawnBoat('arrival',l,{age,fam})}
    else{let s=null;for(let k=0;k<200&&!s;k++){const x=(R()*W)|0,y=(R()*H)|0;if(at(x,y)===SAND)s={x,y}}
      if(s){const p=addPerson(s.x,s.y,{age});meet(p,1,3);say(`A stranger named ${B(p)} lands on the shore and asks to stay.`);addEvent('arrival',`the day ${p.name} came ashore`,ARRIVED(p))}}}}
  // the trader comes once a season, on the third day, in the morning
  if(seaDay()===2&&traderDay!==dayCount&&dayFrac()>.32&&!storm&&!frozen&&people.length>=6&&landings.length){traderDay=dayCount;const h=getB('hut');const l=h?landings.find(l=>l.x===h.x&&l.y===h.y)||landings[0]:landings[0];spawnBoat('trade',l,{})}
  // the fishing boat goes out
  {const h=getB('hut');if(h&&!frozen&&!storm&&wx!=='fog'&&!isNight()&&dayFrac()<edges()[1]-.16&&boats.filter(b=>b.kind==='fish').length<(hasW('boat2')?2:1)&&R()<dt*.08){
    const cand=people.filter(p=>p.task==='idle'&&!isKid(p)&&!p.inside&&Math.hypot(p.x-h.x,p.y-h.y)<40);if(cand.length){const p=cand.reduce((a,b)=>(has(b,'brave')?0:1)+R()<(has(a,'brave')?0:1)+R()?b:a);const l=landings.find(l=>l.x===h.x&&l.y===h.y)||landings[0];
      const k=rnd(6,11);spawnBoat('fish',l,{p,x:l.x+l.dx*.9,y:l.y+l.dy*.9,tx:l.x+l.dx*k+rnd(-2,2),ty:l.y+l.dy*k+rnd(-2,2)});p.task='boat';p.inBoat=true;if(p.tgt&&p.tgt.claimed)p.tgt.claimed=false;p.tgt=null}}}
  if(voyage&&(voyage.st==='decided'||(voyage.st==='going'&&voyage.p.task!=='voyage'))&&!isNight()&&!storm&&dayFrac()>edges()[0]+.06&&voyage.p.task!=='boat'){const p=voyage.p;const first=voyage.st==='decided';voyage.st='going';const l=landings[0];if(p.tgt&&p.tgt.claimed)p.tgt.claimed=false;p.tgt=null;p.inside=false;goTo(p,l.x,l.y,'voyage',0);
    if(first)say(`${B(p)} says, at breakfast, that ${p.name} is going to see the far island, and that it is not up for discussion.`,true)}
  // the story walk (sprint 13): queued at dawn by newDay, launched once the light is up. Children first — it is their kind of errand —
  // then the dreamy, then whoever is youngest; the first walk to a place is what gives the ground its story-name, for good.
  if(walkP&&walkP.d===dayCount&&!isNight()&&!storm&&dayFrac()>edges()[0]+.05){const e=walkP;walkP=null;
    const free=q=>!q.dead&&!q.inside&&q.task!=='boat'&&q.task!=='voyage'&&!q.sick;
    const kids=people.filter(q=>isKid(q)&&ageOf(q)>=5&&free(q)),dr=people.filter(q=>!isKid(q)&&has(q,'dreamy')&&free(q));
    const w=kids.length?kids[(R()*kids.length)|0]:dr.length?dr[(R()*dr.length)|0]:(e.named?null:people.filter(q=>!isKid(q)&&!isElder(q)&&free(q)).sort((a,b)=>ageOf(a)-ageOf(b))[0]);
    if(w){if(w.tgt&&w.tgt.claimed)w.tgt.claimed=false;w.tgt=null;w.pilgL=e.l;goTo(w,e.x,e.y,'pilgrim',rnd(8,14));
      loreN[e.k]=(loreN[e.k]||0)+1; /* every walk leaves a stone (sprint 14) */
      if(!e.named){lorePl.push(e.k);if(!spots.some(sp=>sp.l===e.l))spots.push({l:e.l,x:e.x,y:e.y,lore:1,k:e.k});
        say(`${B(w)} is up and out at first light, to stand where the story happens with both feet. By evening the place has the name the fire gave it: ${e.l}.`,true);
        addEvent('place',`the naming of ${e.l}`,`After the story had grown big enough, ${w.name} walked out at first light to stand in it. The ground has been called ${e.l} ever since, and the children can point to it.`);
        w.hist.push({d:dayCount,s:`walked out at first light and gave the ground its story-name: ${e.l}`})}
      else if(R()<.4)say(`${B(w)} walks out to ${e.l} before the day starts properly, to stand in the story a moment.`,false,'walkstory')}}
  // the walking of the bounds, launched once the light is up (sprint 14)
  if(boundsP&&boundsP.d===dayCount&&!isNight()&&!storm&&dayFrac()>edges()[0]+.07){boundsP=null;boundsOut()}
  stepBoats(dt);stepWild(dt);stepClouds(dt);stepSkips(dt);stepGusts(dt);
  // a star lets go of the sky on a clear night (sprint 16), and sometimes somebody is out late enough to see it
  if(isNight()&&wx==='clear'&&R()<dt*.005){shoots.push({x:rnd(8,W-8),y:rnd(3,H*.4),vx:rnd(14,22)*(R()<.5?-1:1),vy:rnd(4,8),l:.7});starDay=dayCount;
    const awake=people.filter(p=>!p.dead&&!p.inside&&p.task!=='sleep');
    if(awake.length&&R()<.5){const p=awake[(R()*awake.length)|0];
      say(`A star lets go of the sky and is gone before the eye is sure of it. ${B(p)} saw it, and wishes, and tells nobody what.`,false,'shoot');
      if(R()<.15)p.hist.push({d:dayCount,s:'saw a star fall, and told no one the wish'})}}
  if(shoots.length){for(const s2 of shoots){s2.x+=s2.vx*dt;s2.y+=s2.vy*dt;s2.l-=dt}shoots=shoots.filter(s2=>s2.l>0)}
  // smokehouse smoke; winter chimneys
  {const sm=getB('smoke');if(sm&&R()<dt*3)fx.push({x:sm.x+1.7,y:sm.y-.4,vx:rnd(-.2,.2)+(storm?.8:0),vy:-.35,c:'#8c8478',l:rnd(1.5,2.5)});
    if(s==='winter'&&houses.length&&R()<dt*houses.length*.35){const h=pick(houses);fx.push({x:h.x+1.6,y:h.y-.2,vx:rnd(-.15,.15)+(storm?.6:0),vy:-.3,c:'#a09890',l:rnd(1.2,2)})}
    // a sheltering house shows it is lived in: smoke torn sideways off the chimney
    if(storm){const occ=houses.filter(h=>people.some(p=>p.inside&&p.shelterH===h));
      if(occ.length&&R()<dt*occ.length*.5){const h=pick(occ);fx.push({x:h.x+1.6,y:h.y-.2,vx:rnd(-.2,.2)+wind*.9,vy:-.18,c:'#a09890',l:rnd(.8,1.4)})}}}
  // the hall bell at dawn
  if(hasB('hall')&&belled!==dayCount&&dayFrac()>edges()[0]+.02&&!isNight()){belled=dayCount;bell(3);if(R()<.15)say(`The bell rings the sun up over ${V()}.${people.some(p=>has(p,'restless'))?' Someone was already awake.':''}`)}
  // bread, in the deep of winter, at dusk, if the mill and the store allow
  if(s==='winter'&&seaDay()>=1&&hasB('mill')&&breadYr!==yearOf(dayCount)&&granary>=10&&isDusk()){breadYr=yearOf(dayCount);granary-=6;hunger=Math.max(0,hunger-.3);
    say(`The mill has been turning for two days on the winter store, and tonight there is bread — actual bread — and the whole of ${V()} finds a reason to be near the fire while it is warm.`,true);
    addEvent('bread',`the winter bread of year ${yearOf(dayCount)}`,`In the deep of winter of year ${yearOf(dayCount)} the store went up to the mill and came back as bread, and for one evening the cold was nothing.`);
    for(const q of people){if(q.dead||q.task==='boat'||q.task==='voyage'||q.task==='sleep'||q.inside)continue;if(q.tgt&&q.tgt.claimed)q.tgt.claimed=false;q.tgt=null;goTo(q,center.x+rnd(-2.5,2.5),center.y+rnd(-2,2),'gather',rnd(16,28))}}
  // flavor lines
  evT-=dt;if(evT<=0){evT=rnd(16,34)/(1+people.filter(p=>has(p,'gossipy')).length*.25);flavor()}
  for(const f of fires){f.t+=dt}
  // people
  const night=isNight(),dusk=isDusk();
  for(const p of people){
    // seen once in a long soak and never reproduced: a person whose position went non-finite walks forever and never arrives.
    // heal them at the hearth and leave a breadcrumb naming the task, so the next sighting identifies its cause.
    if(!isFinite(p.x)||!isFinite(p.y)||!isFinite(p.tx)||!isFinite(p.ty)){
      try{console.warn('hearth: non-finite position on',p.name,'during',p.task)}catch(e){}
      p.x=center.x;p.y=center.y;p.tx=center.x;p.ty=center.y;p.inBoat=false;p.inside=false;if(p.tgt&&p.tgt.claimed)p.tgt.claimed=false;p.tgt=null;p.task='idle';p.t=1}
    // and, like the animals: anyone stranded in open water steps out at the nearest shore (deterministic — no rnd())
    if(!p.inBoat&&at(p.x|0,p.y|0)===WATER&&!canWade(p.x,p.y)&&!canWalk(p.x,p.y)){const sh=nearestShore(p.x,p.y);if(sh){p.x=sh.x+.5;p.y=sh.y+.5}else{p.x=center.x;p.y=center.y}}
    if(p.mourn&&!night&&p.task!=='mourn'){p.vg=p.mourn;goTo(p,p.mourn.x,p.mourn.y+.7,'mourn',rnd(6,12));p.tgt=null;p.mourn=null;continue}
    // storms send everyone but the brave indoors
    const shelt=storm&&!(has(p,'brave')&&!isKid(p));
    if(p.task==='boat')continue;
    // phase 6: the second day of it and you are in bed, whether you agree or not. The first day you are up and out and working badly,
    // which is exactly how it gets round the island — an illness nobody walks about with cannot walk anywhere.
    if(p.sick&&dayCount>p.sickD&&p.task!=='abed'&&p.task!=='voyage'){
      if(p.tgt&&p.tgt.claimed)p.tgt.claimed=false;p.tgt=null;p.inside=false;p.stops=null;
      const bd=sickBed(p);p.task='abed';p.abedH=bd.hall;p.tx=bd.x;p.ty=bd.y;
      if(bd.hall&&!saidToday.has('sickhall'))say(`The ones with it are carried up to the hall and laid out along one wall, where there is a fire going anyway and one person can watch all of them at once.`,false,'sickhall');
      continue}
    if(shelt&&p.task!=='shelter'&&p.task!=='sleep'&&p.task!=='gohome'&&p.task!=='voyage'&&p.task!=='abed'){p.task='shelter';let h=homeOf(p);if(!h&&houses.length)h=houses.reduce((a,b)=>Math.hypot(b.x-p.x,b.y-p.y)<Math.hypot(a.x-p.x,a.y-p.y)?b:a);
      p.inside=false;p.shelterH=h;p.tx=h?h.x+1+rnd(-.5,.5):center.x+rnd(-1.5,1.5);p.ty=h?h.y+2.2:center.y+rnd(-1,1);if(p.tgt&&p.tgt.claimed)p.tgt.claimed=false;p.tgt=null;continue}
    if(!storm&&p.task==='shelter'){p.task='idle';p.inside=false;p.t=rnd(.5,2)}
    if(night&&p.task!=='sleep'&&p.task!=='gohome'&&p.task!=='shelter'&&p.task!=='wave'&&p.task!=='voyage'&&p.task!=='gather'&&p.task!=='abed'){p.task='gohome';const h=homeOf(p);const hx=h?h.x+1:center.x,hy=h?h.y+2.2:center.y;p.tx=hx+rnd(-.6,.6);p.ty=hy+rnd(-.4,.4);if(p.tgt&&p.tgt.claimed)p.tgt.claimed=false;p.tgt=null;continue}
    if(!night&&p.task==='sleep'){p.task='idle';p.t=rnd(.5,2)}
    // homesick islanders go to the shore at dusk
    if(dusk&&has(p,'homesick')&&!p.dusked&&p.task==='idle'){p.dusked=dayCount;const s=nearestShore(p.x,p.y);if(s)goTo(p,s.x,s.y,'look',rnd(8,14))}
    if(!dusk&&p.dusked&&p.dusked!==dayCount)p.dusked=0;
    switch(p.task){
      case 'gohome': if(walk(p,dt))p.task='sleep';break;
      case 'shelter': if(walk(p,dt)&&p.shelterH)p.inside=true;break;
      case 'sleep': break;
      case 'abed': walk(p,dt);break;   // there is nowhere to be but here, and getting up again is illDay's to decide
      case 'nurse':{const q=byName(p.nursW);
        if(!q||q.dead||!q.sick){p.task='idle';p.t=1;break}
        if(walk(p,dt)){p.dwell-=dt;if(p.dwell<=0){p.task='idle';p.t=rnd(1,2)}
          else if(!p.said){p.said=true;if(q.nursed!==dayCount){q.nursed=dayCount;if(ill)ill.nu++;nursedBy(p,q)}}}
        else p.said=false;break}
      case 'mourn': case 'look': case 'wander': case 'visit': case 'linger': case 'wave': case 'market': case 'gather': case 'pilgrim': case 'chat': case 'kidskip':
        if(walk(p,dt)){p.dwell-=dt;if(p.dwell<=0){p.task='idle';p.t=rnd(1,2)}
          else if(!p.said){p.said=true;
            if(p.task==='mourn'){if(p.vg)p.vg.vn=(p.vg.vn||0)+1;say(`${B(p)} stands a while on the hill, and comes down slowly.`,false,'mourn')}
            else if(p.task==='look')say(`${B(p)} stands at the water's edge at dusk, looking the way the boat came.`,false,'look');
            else if(p.task==='wander')say(`${B(p)} walks out to the far shore alone and stands looking at the water.`,false,'wander');
            else if(p.task==='visit'&&p.vg){p.vg.vn=(p.vg.vn||0)+1;say(`${B(p)} stops at ${p.vg.name}'s stone and straightens it, though it was straight.`,false,'visit')}
            else if(p.task==='pilgrim')say(`${B(p)} stands a while at ${p.pilgL||'the place in the story'}, matching the ground to the telling, and the ground holds still for it.`,false,'pilg');
            else if(p.task==='chat'){const q=byName(p.chatW); /* the first of the pair to arrive with the other in reach does the talking for both */
              if(q&&!q.dead&&q.task==='chat'&&!p.chatSd&&Math.hypot(q.x-p.x,q.y-p.y)<2.4){p.chatSd=q.chatSd=1;chatNews(p,q);
                if(R()<.2)say(`${B(p)} and ${B(q)} stop mid-path to talk, which is how this island gets its news around.`,false,'chat')}}
            else if(p.task==='kidskip'){let wt=null;const px=p.x|0,py=p.y|0; /* a child skips a stone the way the watcher showed the island how */
              for(const dd of[[1,0],[-1,0],[0,1],[0,-1]])if(at(px+dd[0],py+dd[1])===WATER&&!wadeTiles.has(idx(px+dd[0],py+dd[1]))){wt=dd;break}
              if(wt){skips.push({x:px+.5+wt[0]*.9,y:py+.5+wt[1]*.9,vx:wt[0]*8,vy:wt[1]*5.5,n:1+((R()*2)|0),t:.14});plink(.07);
                say(`${B(p)} sends a stone out low over the water, spinning, the way it is done here. Two skips. It is a start.`,false,'kidskip')}}}}
        else p.said=false;break;
      case 'play':{p.t-=dt;if(p.t<=0){p.t=rnd(2,5);let anchor=null;
        if(ageOf(p)>=5){ /* sprint 16: play that reads as play — a chase, a snowman, a stone sent the way the island's stones get sent */
          if(R()<.22){let m=null,md=36;for(const o of people){if(o===p||o.dead||!isKid(o)||ageOf(o)<5||o.inside||o.task!=='play')continue;
              const d2=(o.x-p.x)*(o.x-p.x)+(o.y-p.y)*(o.y-p.y);if(d2<md){md=d2;m=o}}
            if(m){p.task='tag';p.tagW=m.name;p.tagIt=1;p.tagN=0;p.tagT=0;p.tagR=0;m.task='tag';m.tagW=p.name;m.tagIt=0;m.tagN=0;m.tagT=0;m.tagR=0;
              if(R()<.25)say(`${B(p)} slaps ${B(m)} on the shoulder and runs. The chase is on before anyone agreed to one.`,false,'tag');break}}
          if(snowD>.5&&snowmen.length<2&&R()<.15&&!snowmen.some(s2=>Math.hypot(s2.x-p.x,s2.y-p.y)<7)){const s0=freeSpotNear(p.x,p.y,1,3,1);
            if(s0){p.task='snowman';p.snT=0;p.tx=s0.x+.5;p.ty=s0.y+.5;break}}
          if(skipN>0&&R()<.08){const sh=nearestShore(p.x,p.y);if(sh&&Math.hypot(sh.x-p.x,sh.y-p.y)<9){goTo(p,sh.x,sh.y,'kidskip',rnd(3,5));break}}}
        if(ageOf(p)>=5&&R()<.4){ // old enough to follow the work around, asking why
          const wkers=people.filter(q=>!isKid(q)&&!q.dead&&!q.inside&&(q.task==='chop'||q.task==='till'||q.task==='harvest'||q.task==='fish'||q.task==='build'||q.task==='carry'||q.task==='water'));
          if(wkers.length){const q=wkers[(R()*wkers.length)|0];anchor=q;
            if(p.shadN===q.name)p.shadC=(p.shadC||0)+1;else if(!p.shadN||R()<.4){p.shadN=q.name;p.shadC=1}}}
        if(hasW('swing')&&!anchor&&R()<.25){const sw=works.find(w=>w.wk==='swing');anchor=sw}
        if(hasW('ring')&&!anchor&&R()<.12)anchor=works.find(w=>w.wk==='ring');
        if(!anchor){const par=p.parents.map(byName).find(q=>q&&!q.dead);anchor=R()<.5&&par?par:(homeOf(p)?{x:homeOf(p).x+1,y:homeOf(p).y+2.5}:center)}
        /* two or more children at the swing or the fire ring go round it instead of past it: each keeps an angle and walks it forward */
        if(anchor&&anchor.wk&&people.some(o=>o!==p&&!o.dead&&isKid(o)&&(o.task==='play'||o.task==='tag')&&Math.hypot(o.x-anchor.x,o.y-anchor.y)<4)){
          p.rA=(p.rA===undefined?p.off:p.rA+.9);p.tx=anchor.x+.5+Math.cos(p.rA)*2;p.ty=anchor.y+.9+Math.sin(p.rA)*1.4}
        else{p.tx=anchor.x+rnd(-2.5,2.5);p.ty=anchor.y+rnd(-2,2)}}walk(p,dt);break}
      case 'tag':{const m=byName(p.tagW);
        if(!m||m.dead||m.task!=='tag'){p.task='play';p.t=rnd(.5,1.5);break}
        p.tagT=(p.tagT||0)+dt;if(p.tagT>15){p.task='play';p.t=1;m.task='play';m.t=1;break}
        p.tagR-=dt;
        if(p.tagIt){if(p.tagR<=0){p.tagR=.4;p.tx=m.x;p.ty=m.y}
          walk(p,dt);
          if(Math.hypot(m.x-p.x,m.y-p.y)<.7){p.tagIt=0;m.tagIt=1;m.tagR=0;p.tagN=(p.tagN||0)+1; /* tagged: the roles swap, up to three times, then the grass gets them */
            if(p.tagN>=3){p.task='play';p.t=1;m.task='play';m.t=1;if(R()<.2)say('The chase ends the way the good ones do: both of them flat in the grass, out of breath, entirely satisfied.',false,'tagend')}}}
        else{if(p.tagR<=0){p.tagR=.5;const dx=p.x-m.x,dy=p.y-m.y,d=Math.hypot(dx,dy)||1;let tx=p.x+dx/d*4+rnd(-1.2,1.2),ty=p.y+dy/d*3+rnd(-1,1);
            if(!canWalk(tx,ty)&&!canWade(tx,ty)){tx=center.x+rnd(-2,2);ty=center.y+rnd(-1.5,1.5)}p.tx=tx;p.ty=ty}
          walk(p,dt)}break}
      case 'snowman':{if(snowD<.4){p.task='play';p.t=1;break}
        if(walk(p,dt)){p.snT=(p.snT||0)+dt;if(R()<dt*3)fx.push({x:p.x+rnd(-.6,.6),y:p.y+rnd(-.4,.2),vx:rnd(-.3,.3),vy:-rnd(.2,.6),c:'#eef2f4',l:.5});
          if(p.snT>14){p.snT=0;snowmen.push({x:p.tx,y:p.ty,s:1,d:dayCount});p.task='play';p.t=rnd(1,3);
            say(`${B(p)} rolls the yard's snow into a person-shaped person, gives it a stone eye and a stick arm, and steps back to be judged.`,false,'snowman');
            if(R()<.4)p.hist.push({d:dayCount,s:'built a snowman, and defended it from the thaw for as long as that can be done'})}}break}
      case 'tend':{if(people.some(q=>q!==p&&!isKid(q))){p.task='idle';p.t=1;break} // a grown-up again: back to being a child
        if(walk(p,dt)){p.dwell-=dt;if(p.dwell<=0){
          if(p.tendOut){p.tendOut=0;const lean=sea()==='winter'||frozen;let got=lean?(R()<.35?1:0):1; // the tideline gives little under the ice
            if(!got&&granary>0){granary-=1;got=1;
              if(granary===0)say(`${B(p)} takes the last measure from the store and sets the empty lid down beside it, gently.`,true);
              else if(granary<4)say(`${B(p)} takes a careful measure and stands a while looking at what is left. ${granary===1?'One measure more.':granary+' measures more.'}`,false,'tendlow');
              else if(R()<.3)say(`${B(p)} takes a careful measure from the store, the way the grown ones did, and puts the lid back.`,false,'tendstore')}
            else if(got&&R()<.2)say(lean?`${B(p)} finds little under the ice, and brings the little back.`:`${B(p)} lays what the tide left down beside the fire. Not much, and enough.`,false,'tend');
            food+=got;goTo(p,center.x+rnd(-1.5,1.5),center.y+rnd(-1,1),'tend',rnd(5,9))}
          else{p.tendOut=1;const sh=nearestShore(p.x,p.y)||center;goTo(p,sh.x,sh.y,'tend',rnd(2,4))}}}break}
      case 'idle':{if(p.child){
        // a child with nobody grown left does not only play: someone has to keep the fire
        if(!people.some(q=>q!==p&&!isKid(q))){
          if(!p.keeper){p.keeper=1;say(`${B(p)} builds the fire up alone, the way the grown ones did it.`,true);p.hist.push({d:dayCount,s:'was left to keep the fire alone, and kept it'});addEvent('keeper',`the ${sea()} ${p.name} kept the fire alone`,`Everyone grown was gone, and ${p.name}, a child, kept the fire going alone until a boat should come.`)}
          p.tendOut=1;const sh=nearestShore(p.x,p.y)||center;goTo(p,sh.x,sh.y,'tend',rnd(2,4));break}
        p.task='play';p.t=0;break}
        p.t-=dt;if(p.t>0){if(R()<dt*.6){p.tx=p.x+rnd(-2,2);p.ty=p.y+rnd(-2,2)}walk(p,dt);break}
        // somebody is in bed and nobody has been to them today (phase 6). Their partner first, then their own people, then a friend,
        // then whoever is gentle about it — and nearness breaks the tie, because this is an errand, not a vocation.
        if(ill&&!p.sick&&p.nursD!==dayCount&&R()<(has(p,'gentle')?.5:.22)){
          const need=people.filter(q=>q!==p&&q.sick&&!q.dead&&q.task==='abed'&&q.nursed!==dayCount);
          if(need.length){const sc=q=>(q.name===p.partner?6:0)+((p.parents.includes(q.name)||q.parents.includes(p.name))?4:0)+
              (p.rels.some(r=>r.who===q.name&&r.k==='friend')?2:0)+(p.rels.some(r=>r.who===q.name&&r.k==='rival')?(has(p,'gentle')?1:-1):0)+
              (has(p,'gentle')?1.5:0)-Math.hypot(q.x-p.x,q.y-p.y)*.06;
            const q=need.reduce((a,b)=>sc(b)>sc(a)?b:a);
            p.nursD=dayCount;p.nursW=q.name;goTo(p,q.x,q.y,'nurse',rnd(10,18));break}}
        // trait detours
        if(has(p,'restless')&&R()<.22){const far=spots[0];goTo(p,far.x,far.y,'wander',rnd(6,12));break}
        if(has(p,'gentle')&&graves.length&&R()<.1){const gr=pick(graves);p.vg=gr;goTo(p,gr.x,gr.y+.7,'visit',rnd(4,8));break}
        if(graves.length&&p.rels.length===0&&dead.some(d=>d.rels.some(r=>r.who===p.name))&&R()<.06){const gr=pick(graves);p.vg=gr;goTo(p,gr.x,gr.y+.7,'visit',rnd(4,8));break}
        if((has(p,'dreamy')||has(p,'homesick'))&&R()<.1){goTo(p,p.spot.x,p.spot.y,'linger',rnd(5,9));break}
        // a word on the way past (sprint 16): two idle grown-ups stop and talk, and what one of them knows walks with the other
        if(p.chatD!==dayCount&&R()<(has(p,'gossipy')?.16:.07)){let q=null,qd=49;
          for(const o of people){if(o===p||o.dead||isKid(o)||o.inside||o.task!=='idle'||o.chatD===dayCount)continue;
            const d2=(o.x-p.x)*(o.x-p.x)+(o.y-p.y)*(o.y-p.y);if(d2<qd){qd=d2;q=o}}
          if(q){p.chatD=q.chatD=dayCount;p.chatW=q.name;q.chatW=p.name;
            const mx=(p.x+q.x)/2,my=(p.y+q.y)/2,dw=rnd(5,9)+((has(p,'gossipy')||has(q,'gossipy'))?3:0);
            if(q.tgt&&q.tgt.claimed)q.tgt.claimed=false;q.tgt=null;
            goTo(p,mx,my,'chat',dw);goTo(q,mx,my,'chat',dw);p.chatSd=q.chatSd=0;break}}
        // the market at midday
        {const m=getB('market');const f=dayFrac();if(m&&f>.45&&f<.56&&!p.marketed&&R()<.5){p.marketed=dayCount;goTo(p,m.x+1.5+rnd(-1,1),m.y+1.6+rnd(-.8,.8),'market',rnd(8,16));break}if(p.marketed&&p.marketed!==dayCount&&f>.6)p.marketed=0}
        // choose job
        const needFood=food<people.length*4, needWood=wood<14, canBuild=wood>=18&&(people.length>=popCap()-1||p.wantHouse), proud=has(p,'proud');
        const uw=works.find(w=>!w.done);
        const ripe=farms.filter(f=>f.g>=1&&!f.claimed), keen=needFood||s==='autumn'||(s==='summer'&&seaDay()>=3)||R()<.45+(p.craft===0?.3*p.cxp:0);
        const nb=wood>=8&&!p.child?nextBuild():null;
        if(nb){wood-=BLD[nb.kind].wood;bldgTgt=nb;p.tgt=nb;p.tx=nb.x+nb.w/2;p.ty=nb.y+nb.h+.3;p.task='build';say(`${B(p)} paces out ground for ${BLD[nb.kind].name}, and explains the idea to anyone who will listen.`,true)}
        else if(bldgTgt&&!bldgTgt.done&&R()<.35){p.tgt=bldgTgt;p.tx=bldgTgt.x+bldgTgt.w/2+rnd(-.8,.8);p.ty=bldgTgt.y+bldgTgt.h+.3;p.task='build'}
        else{
        const site=canBuild?((ruin&&ruinSeen&&R()<.4&&freeSpotNear(ruin.x,ruin.y,4,7,2))||freeSpot(3,11,2)||freeSpot(3,15,2)):null;
        if(site){const s=site;{wood-=18;p.tgt={x:s.x,y:s.y,prog:0,forCouple:p.wantHouse?[p.name,p.partner]:null};if(p.wantHouse){p.wantHouse=false;const q=byName(p.partner);if(q)q.wantHouse=false}p.tx=s.x+1;p.ty=s.y+2.2;p.task='build';const nearR=ruin&&Math.hypot(s.x-ruin.x,s.y-ruin.y)<8&&!ruin.built;if(nearR){ruin.built=true;p.hist.push({d:dayCount,s:'built the first house in the lee of the old stones'})}say(nearR?`${B(p)} paces out a plot in the lee of the old stones. It is out of the wind there, ${p.name} says, and it is not only that.`:p.wantHouse?`${B(p)} paces out a plot for a house of their own.`:`${B(p)} paces out a plot for a new house.`)}}
        else if(uw&&!isElder(p)&&wood>=4&&R()<.3){if(!uw.paid){uw.paid=1;wood-=4}p.tgt=uw;p.tx=uw.x+.5+rnd(-.6,.6);p.ty=uw.y+1.2;p.task='build';if(!uw.said){uw.said=1;say(`${B(p)} has decided ${V()} should have ${WORKS[uw.wk].name}, and starts on it before anyone can weigh in.`)}}
        else if(dry01>.6&&hasB('well')&&s!=='winter'&&farms.some(f=>f.g<1)&&R()<.3){const w=getB('well');p.wtgt=farms.filter(f=>f.g<1).sort((a,b)=>a.g-b.g)[0];p.waterSt=0;goTo(p,w.x+.5,w.y+1.4,'water',0)}
        else if(ripe.length&&!proud&&keen){const f=ripe.sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];f.claimed=true;p.tgt=f;p.tx=f.x+.5;p.ty=f.y+.5;p.task='harvest'}
        else if(needFood&&(storm?has(p,'brave'):R()<(hunger>.2?.7:s==='winter'?.45:.35)+(p.craft===2?.3*p.cxp:0))&&shore.length){const s=nearestShore(p.x,p.y);if(s){p.tgt=s;p.tx=s.x+.5;p.ty=s.y+.5;p.task='fish';p.work=0}else p.t=1}
        else if(needFood&&!proud&&s!=='winter'&&snowD<.4&&farms.length<people.length*.7+2&&R()<.7){const s=freeSpot(3,9);if(s){p.tgt=s;p.tx=s.x+.5;p.ty=s.y+.5;p.task='till'}else p.t=1}
        else if(wood<70&&(needWood||proud||R()<.4+(p.craft===1?.3*p.cxp:0))){const t=nearestTree(p.x,p.y);if(t&&(needWood||trees.length>12)){p.tgt=t;p.tx=t.x;p.ty=t.y+.4;p.task='chop'}else p.t=2}
        else{p.tx=center.x+rnd(-4,4);p.ty=center.y+rnd(-3,3);p.t=rnd(2,4)}}
        break}
      case 'chop': if(walk(p,dt)){if(!p.tgt||p.tgt.hp<=0){p.tgt=null;p.task='idle';p.t=1;break}p.work=(p.work||0)+dt*workRate(p);
        p.swing=(p.swing||0)+dt;if(p.swing>.58){p.swing=0;thock(p.x,p.y)}if(R()<dt*3)fx.push({x:p.tgt.x,y:p.tgt.y,vx:rnd(-1,1),vy:-rnd(.5,1.5),c:'#8a5a2b',l:.5});
        if(p.work>4){p.work=0;p.tgt.hp=0;addStump(p.tgt.x,p.tgt.y);wood+=4;p.tgt=null;craftUp(p,1);p.task='idle';p.t=rnd(1,2)}}break;
      case 'till': if(walk(p,dt)){p.work=(p.work||0)+dt*workRate(p);if(p.work>2.5){p.work=0;const s=p.tgt;tiles[idx(s.x,s.y)]=FARM;farms.push({x:s.x,y:s.y,g:0});if(farms.length===1){say(`${B(p)} breaks the first ground for a field.`);p.hist.push({d:dayCount,s:'broke the first ground for a field'});addEvent('field','the day the first field was dug',`${p.name} broke the first ground for a field, which was the beginning of eating properly.`)}craftUp(p,0);p.task='idle';p.t=1}}break;
      case 'harvest': if(walk(p,dt)){p.work=(p.work||0)+dt*workRate(p);if(R()<dt*4)fx.push({x:p.x,y:p.y-.5,vx:rnd(-.5,.5),vy:-1,c:'#e8c86a',l:.6});
        if(p.work>2){p.work=0;p.tgt.g=0;p.tgt.claimed=false;const store=(s==='autumn'||(s==='summer'&&seaDay()>=4))&&granary<people.length*12;if(store)granary+=4;else food+=4;craftUp(p,0);p.tgt=null;
          const ml=getB('mill');
          if(ml&&!store&&!storm&&granary<people.length*14&&R()<.6){p.carrySt=0;goTo(p,ml.x+1,ml.y+ml.h+.3,'carry',0);break} // grain goes up the mill path instead, while the store has room
          p.task='idle';p.t=1;if(R()<.25)say(store?`${B(p)} carries a basket of grain to the store, against the winter.`:`${B(p)} brings in a basket of grain.`,false,'basket')}}break;
      case 'carry': if(walk(p,dt)){if(p.carrySt===0){p.carrySt=1;goTo(p,center.x,center.y,'carry',0);if(R()<.2)say(`${B(p)} tips the basket into the hopper and waits while the stones do their slow work.`,false,'hopper')}
        else{granary+=2;craftUp(p,4);p.task='idle';p.t=1;if(R()<.2)say(`${B(p)} carries the meal down from the mill to the store, dusted white to the elbows.`,false,'meal')}}break;
      case 'water': if(walk(p,dt)){if(p.waterSt===0){p.waterSt=1;const f=p.wtgt;if(f)goTo(p,f.x+.5,f.y+.5,'water',0);else{p.task='idle';p.t=1}}
        else{const f=p.wtgt;if(f&&f.g<1)f.g=Math.min(1,f.g+.15);p.wtgt=null;craftUp(p,0);p.task='idle';p.t=1;if(R()<.25)say(`${B(p)} carries well water to the fields, two buckets at a time, and the rows drink it standing up.`,false,'water')}}break;
      case 'fish': if(storm&&!has(p,'brave')){p.task='idle';p.t=1;break} // light rain is only water; work goes on
        if(walk(p,dt)){p.work=(p.work||0)+dt;if(R()<dt*.8)fx.push({x:p.x+rnd(-1,1),y:p.y+rnd(.5,1.5),vx:0,vy:-.3,c:'#cfe6ff',l:.4});
          if(p.work>7){p.work=0;let n=rain?4:frozen?(R()<.25?1:0):s==='winter'?(R()<.4?1:0):2;if(arcK()==='shoal')n+=3;if(p.luck){p.luck=0;n=n*3+3;say(`${B(p)} comes up from the water with more fish than the line should hold, and says nothing about a dream.`,true)}food+=n;craftUp(p,2);p.task='idle';p.t=1;if(storm){p.fishRain++;if(p.fishRain===1){p.hist.push({d:dayCount,s:'first went out fishing in a storm, and came back'})}}if(R()<.3)say(rain?`${B(p)} comes back from the water soaked through, with fish.`:`${B(p)} comes up from the shore with a few fish on a string.`)}}break;
      case 'boat': break;
      case 'bounds':{if(!p.stops){p.task='idle';p.t=1;break}
        if(walk(p,dt)){p.dwell-=dt;if(p.dwell<=0){
          const st=p.stops[p.si];
          if(p.bLead){if(st.grave){for(const gr of graves)gr.vn=(gr.vn||0)+1; /* the last stop: every stone on the hill gets touched too */
              if(graves.length){const names=graves.slice().sort((a,b)=>a.d-b.d).map(g=>g.name);
                const said=names.length<=4?names.join(', '):names.slice(0,4).join(', ')+`, and ${names.length-4} more before them`;
                say(`${B(p)} stops at the hill and says the names, oldest first: ${said}.`,true)}}
            else loreN[st.k]=(loreN[st.k]||0)+1} /* the leader leaves the stone */
          p.si++;
          if(p.si>=p.stops.length){p.stops=null;p.task='idle';p.t=1;
            if(p.bLead)say(`${B(p)} comes back from the bounds with empty pockets, having left a stone at every place, and sits down like someone who has finished something.`,true)}
          else{const s2=p.stops[p.si];goTo(p,s2.x,s2.y,'bounds',rnd(5,9))}}}break}
      case 'voyage': if(walk(p,dt)){const l=landings[0];const b=spawnBoat('away',l,{p,x:l.x+l.dx*.9,y:l.y+l.dy*.9,st:'out',tx:l.x+l.dx*24,ty:l.y+l.dy*24});p.task='boat';p.inBoat=true;voyage.st='away';voyage.day=dayCount;voyage.n=2+((R()*3)|0);
        p.hist.push({d:dayCount,s:'took the boat out alone to see the far island'});addEvent('voyage',`the ${sea()} ${p.name} sailed for the far island`,`${p.name} rowed out alone for the far island, and five people stood on the shore and watched it happen.`);
        const w=people.filter(q=>q!==p&&!q.dead&&q.task!=='sleep'&&q.task!=='boat'&&q.task!=='bounds'&&!q.inside).sort(()=>R()-.5).slice(0,5);for(const q of w){const s=nearestShore(l.x+rnd(-3,3),l.y+rnd(-3,3))||l;goTo(q,s.x,s.y,'wave',rnd(10,20));if(q.tgt&&q.tgt.claimed)q.tgt.claimed=false;q.tgt=null;q.hist.push({d:dayCount,s:`watched ${p.name} row out toward the far island`})}
        say(`${B(p)} pushes off from the landing and rows straight out, and does not look back until ${p.name} is small.`,true)}break;
      case 'build': if(!p.tgt||p.tgt.done){p.task='idle';p.t=1;break}if(walk(p,dt)){p.tgt.prog+=dt*workRate(p);
        p.cw=(p.cw||0)+dt;if(p.cw>9){p.cw=0;craftUp(p,3)} // long hours at the frame teach the frame
        p.swing=(p.swing||0)+dt;if(p.swing>.74){p.swing=0;hammer(p.x+.2,p.y-.2)}if(R()<dt*2)fx.push({x:p.tgt.x+rnd(0,p.tgt.w||2),y:p.tgt.y+rnd(0,p.tgt.h||2),vx:0,vy:-.6,c:'#ddd',l:.7});
        if(p.tgt.wk){if(p.tgt.prog>14){finishWork(p,p.tgt);craftUp(p,3);p.task='idle';p.t=2}break}
        if(p.tgt.kind){if(p.tgt.prog>p.tgt.work){finishBuilding(p,p.tgt);p.task='idle';p.t=2}break}
        if(p.tgt.prog>12){const h={x:p.tgt.x,y:p.tgt.y,r:pick(['#8a3d2f','#6f4b32','#4c5f78']),owners:[]};houses.push(h);fires.push({x:center.x,y:center.y,t:0});craftUp(p,3);
          if(p.tgt.forCouple){for(const n of p.tgt.forCouple){const q=byName(n);if(q){if(q.home)q.home.owners=q.home.owners.filter(m=>m!==n);q.home=h;h.owners.push(n);q.wantHouse=false;q.hist.push({d:dayCount,s:`moved into the house they built with ${n===p.name?p.partner:p.name}`})}}
            say(`${B(p)} sets the last beam on the house for ${p.tgt.forCouple.join(' and ')}. Someone hangs a bit of green over the door.`)}
          else{say(`${B(p)} sets the last beam. ${houses.length===1?'The first house stands.':V()+' grows to '+houses.length+' houses.'}`);if(houses.length===1){addEvent('house','the raising of the first house',`${p.name} set the last beam on the first house. Before that everyone had slept beside the fire.`);p.hist.push({d:dayCount,s:'raised the first house'})}else if(R()<.5)p.hist.push({d:dayCount,s:`raised the ${['','','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth'][houses.length]||houses.length+'th'} house`})}
          p.task='idle';p.t=2}}break;
    }
  }
  /* phase 6: the wave ends the moment there is nobody left in it — whether they got up, sailed, or died of something else entirely.
     A wave with nobody in bed is not a wave nearly over, it is a record that has outlived its subject, and `strain` asserts against
     one every day of its run. Otherwise the sickness walks the paths: one draw per susceptible person per step, and only while there
     is somebody to catch it from, so an island with nobody in bed is on exactly the stream it was on before this existed. Nearness is
     the whole mechanism — the fire, the market and the hall matter because they are where everyone stands close together, not because
     they are named here. After WAVED days the wave stops finding anybody new, which is what bounds it. */
  if(ill&&!people.some(p=>p.sick&&!p.dead))endIll();
  else if(ill&&dayCount<ill.d0+WAVED){
    const src=people.filter(p=>p.sick&&!p.dead&&!p.inBoat);
    if(src.length)for(const q of people){if(q.inBoat||!canTake(q))continue;
      let near=0;for(const p of src){if(p===q)continue;if(Math.abs(p.x-q.x)<CATCH&&Math.abs(p.y-q.y)<CATCH)near++}
      if(near&&R()<dt*CATCHR*near*(isKid(q)?1.4:isElder(q)?1.2:1)*(hunger>.4?1.3:1)){
        const from=src.find(p=>p!==q&&Math.abs(p.x-q.x)<CATCH&&Math.abs(p.y-q.y)<CATCH);
        if(takeSick(q,from)&&R()<.5)say(`${B(q)} has it now too, and knew before anyone said so.`,false,'took')}}}
  /* phase 6: rations are the whole of the decision — the store lasts longer and the work goes slower (workRate), and the elder who
     stood down from a measure draws half as often. One R() draw per person per step either way, so a village not on rations is on
     exactly the stream it was on before. */
  people.forEach(p=>{if(people.length>1&&R()<dt*(arcK()==='longwinter'?.027:.02)*(want?.62:1)*(p.short?.5:1)){if(food>0)food-=1;else if(granary>0)granary-=1}});
  if(food>40&&R()<dt*food*.0025*(hasWay(2)?.5:1))food-=1; // fresh food does not keep — though fired pots slow the damp's stealing
  // once, in the first year only: the boat they came in had one more sack in it
  if(food<=0&&granary<=0&&people.length>1&&!sackUsed&&dayCount<=YEAR){sackUsed=true;food+=10;
    say('The bottom of the boat turns out to hold one more sack, kept against exactly this, and nobody asks why it was not mentioned before.',true);
    addEvent('sack','the sack from the boat','The store ran out in the first year, and the last sack from the boat, kept against exactly this, was opened.')}
  const starving=food<=0&&granary<=0&&people.length>1;
  hunger=Math.max(0,Math.min(1,hunger+dt*(starving?.005:want?.0008:-.004)));
  /* a lean winter is not starvation, and must not read as it: hunger climbs on rations, and stops well under the .7 that puts
     somebody in a boat. The empty store is still the only thing that empties the island. */
  if(want&&!starving)hunger=Math.min(hunger,.45);
  if(starving&&R()<dt*.02)say(hunger>.6?'The store is empty. Nobody says so at the fire, which is how everyone knows.':'The store is empty. Whatever the sea gives today is dinner.',false,'empty');
  food=Math.max(0,food);
  trees=trees.filter(t=>t.hp>0);
  for(const f of fx){f.x+=f.vx*dt;f.y+=f.vy*dt;f.l-=dt}fx=fx.filter(f=>f.l>0);
}
