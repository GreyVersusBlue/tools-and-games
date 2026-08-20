// Hearth — portraits, the person card, and draw().
// Classic scripts sharing one global scope; the load order in index.html is the old single file’s order and it matters.
// ---------- portraits ----------
const SKIN=[['#f1cfa5','#d9ac7c'],['#e6b98d','#c48f63'],['#c98a5c','#a56a3f'],['#a86a44','#87502e'],['#7a4b2e','#5c351d']];
const EYES=['#2a2a3a','#3d5a3a','#4a5f8a','#5a3a2a'];
function drawFace(ctx,p){const rr=mulberry(p.seed);const kid=isKid(p),eld=isElder(p),age=ageOf(p);
  ctx.clearRect(0,0,16,16);
  const skin=SKIN[(rr()*SKIN.length)|0],eye=EYES[(rr()*EYES.length)|0];const style=(rr()*4)|0;
  let hair=p.hair;if(age>52){const t=Math.min(1,(age-52)/20);hair=t>.6?'#d9d4c8':'#8c8478'}
  const shade=c=>{const n=parseInt(c.slice(1),16);const f=.72;return'#'+[(n>>16)&255,(n>>8)&255,n&255].map(v=>Math.round(v*f).toString(16).padStart(2,'0')).join('')};
  const px=(x,y,w,h,c)=>{ctx.fillStyle=c;ctx.fillRect(x,y,w,h)};
  // background wash + subtle vignette
  px(0,0,16,16,'#221a12');px(0,0,16,1,'#2b2117');
  // shoulders / shirt (person colour)
  px(3,13,10,3,p.col);px(3,13,10,1,shade(p.col));px(7,13,2,3,shade(p.col));
  const hy=kid?4:3, hh=kid?8:9; // head top, height
  // head outline (dark, one rule: right & bottom get the outline, top-left gets light)
  px(4,hy,8,hh,skin[0]);px(11,hy+1,1,hh-2,skin[1]);px(5,hy+hh-1,6,1,skin[1]);px(4,hy+1,1,hh-2,'#f7dcb8');
  px(3,hy+1,1,hh-2,'#1a120c');px(12,hy+1,1,hh-2,'#1a120c');px(5,hy+hh,6,1,'#1a120c');px(4,hy+hh-1,1,1,'#1a120c');px(11,hy+hh-1,1,1,'#1a120c');
  // hair
  const hd=shade(hair);
  if(style===0){px(4,hy-1,8,2,hair);px(3,hy,1,2,hair);px(12,hy,1,3,hd);px(11,hy,1,2,hd)}
  else if(style===1){px(4,hy-1,8,2,hair);px(3,hy,1,hh-2,hair);px(12,hy,1,hh-2,hd);px(3,hy-1,1,1,hd)}
  else if(style===2){px(4,hy-1,8,2,hair);px(6,hy-2,4,1,hair);px(11,hy,1,2,hd);px(3,hy,1,1,hair)}
  else{if(eld&&rr()<.5){px(3,hy+1,1,4,hair);px(12,hy+1,1,4,hd)}else{px(4,hy-1,8,1,hair);px(3,hy,1,3,hair);px(12,hy,1,3,hd);px(11,hy-1,1,1,hd)}}
  px(3,hy-1,1,1,'#1a120c');px(12,hy-1,1,1,'#1a120c');
  // hat / headband by trait
  if(has(p,'proud')&&rr()<.6){px(3,hy-1,10,1,'#4c5f78');px(4,hy-3,8,2,'#4c5f78');px(11,hy-3,1,2,'#33435a');px(4,hy-2,1,1,'#6c7f98')}
  else if(has(p,'brave')&&rr()<.6){px(3,hy+1,10,1,'#8a3d2f');px(12,hy+1,1,1,'#5c2820')}
  else if(!kid&&rr()<.18){px(3,hy-1,10,1,'#6f4b32');px(4,hy-3,8,2,'#6f4b32');px(11,hy-3,1,2,'#4a3221')}
  // eyes
  const ey=hy+(kid?4:4);px(6,ey,1,1,eye);px(9,ey,1,1,eye);px(6,ey-1,1,1,skin[1]);px(9,ey-1,1,1,skin[1]);
  if(has(p,'dreamy'))px(9,ey,1,1,'#7a9ac9');
  // brows: stubborn/proud heavier
  if(has(p,'stubborn')||has(p,'proud')){px(5,ey-1,2,1,hd);px(9,ey-1,2,1,hd)}
  // mouth
  const my=hy+hh-3;if(has(p,'funny')||has(p,'gentle')){px(6,my,1,1,skin[1]);px(7,my+1,2,1,skin[1]);px(9,my,1,1,skin[1])}
  else if(has(p,'proud')||has(p,'stubborn'))px(6,my+1,4,1,skin[1]);else px(7,my+1,2,1,skin[1]);
  // freckles / wrinkles / blush
  if(kid){px(5,ey+2,1,1,'#e39a8a');px(10,ey+2,1,1,'#e39a8a')}
  if(eld){px(5,ey+1,1,1,skin[1]);px(10,ey+1,1,1,skin[1]);px(4,hy+3,1,1,skin[1])}
  // beard for some non-kids
  if(!kid&&rr()<.3&&style!==2){px(5,hy+hh-2,6,2,hair);px(6,hy+hh,4,1,hd)}
}
// ---------- card ----------
const cardEl=document.getElementById('card'),faceCv=document.getElementById('face'),faceCtx=faceCv.getContext('2d');
let cardT=0;
function whyText(p){const w=WX();
  if(p.sick)return `Should be lying down. The fever is going round, and ${p.name} has it, and is being ${has(p,'stubborn')?'exactly as stubborn about it as you would expect':'stubborn about it'}.`;
  switch(p.task){
    case 'sleep':return `Asleep${homeOf(p)?' at home':' by the fire'}. ${has(p,'restless')?'Lightly.':has(p,'dreamy')?'Dreaming, probably.':''}`;
    case 'gohome':return `Heading home for the night${p.partner&&byName(p.partner)?', where '+p.partner+' will be':''}.`;
    case 'chop':return `Chopping a tree. ${has(p,'proud')?'Would rather do this than farm.':wood<14?'The woodpile is low.':'It needs doing.'}`;
    case 'till':return `Breaking new ground for a field. Food is short and someone has to.`;
    case 'harvest':return sea()==='autumn'?`Bringing in a ripe field for the store. Winter is coming.`:`Bringing in a ripe field before the birds do.`;
    case 'fish':return storm?`Fishing in ${w}. Brave enough not to mind, and the fish bite better.`:rain?`Fishing in the rain, which is only water. The fish bite better for it.`:frozen?`Fishing through a hole in the ice. Not much is biting.`:`Down at the shore with a line. Food is short.`;
    case 'shelter':return p.inside?`Indoors, waiting out the storm.`:`Hurrying to get under a roof before the worst of it.`;
    case 'boat':return voyage&&voyage.p===p?`Rowing for the far island, alone. ${has(p,'brave')?'Not afraid, or not admitting it.':'It is further than it looks.'}`:`Out in the boat past the shallows, where the water goes dark and the fish are bigger.`;
    case 'voyage':return `Walking down to the landing to take the boat out to the far island. Nobody has, before. ${p.name} may not come back.`;
    case 'wave':return `Down on the shore because the trader's boat is in. Waving, mostly.`;
    case 'gather':return `At the fire with everyone else, because a story is being told and this one is long.`;
    case 'market':return `At the market at midday, buying nothing, hearing everything.`;
    case 'build':return p.tgt&&p.tgt.wk?`Making ${WORKS[p.tgt.wk].name}. Nobody needs it, and everybody wants it.`:p.tgt&&p.tgt.kind?`Working on ${BLD[p.tgt.kind].name}. ${V()} is becoming a place with things in it.`:p.tgt&&p.tgt.forCouple?`Building a house to share with ${p.partner}.`:`Raising a new house. The village has outgrown its roofs.`;
    case 'wander':return `Walking to the far shore. Restless, as always. Will be back before dark.`;
    case 'look':return `Standing at the water at dusk, looking the way the boat came. Homesick.`;
    case 'linger':return `Lingering at ${p.spot.l}, which is where ${p.name} goes to think.`;
    case 'visit':return p.vg?`Visiting ${p.vg.name}'s stone on the hill.`:'On the hill.';
    case 'mourn':return `On the hill, at the burying.`;
    case 'play':return p.shadN&&byName(p.shadN)?`Following ${p.shadN} around the work, asking why. Learning, though neither of them is calling it that.`:`Playing near ${p.parents.length?p.parents[0]:'the fire'}, in the way of children.`;
    case 'carry':return `Carrying grain up to the mill and meal down to the store. The mill only matters if someone feeds it.`;
    case 'water':return `Hauling well water to the fields, two buckets at a time. The sky has not been helping.`;
    case 'tend':return `Keeping the fire and walking the tideline for food, because there is nobody grown left to do it.`;
    case 'pilgrim':return `Walking out to ${p.pilgL||'a place out of the stories'}, to stand where the story happens. The story is better there.`;
    case 'bounds':return p.bLead?`Leading the walking of the bounds: every named place, in order, with the children. Someone must show them where everything happened.`:`Being walked round the named places, and shown where everything happened. There will be questions.`;
    default:return isKid(p)?'Wandering after the grown-ups.':`Between tasks, deciding what needs doing${has(p,'patient')?', unhurried':''}.`}}
function showCard(p){selected=p;if(!p){cardEl.hidden=true;return}actDone('card');cardEl.hidden=false;renderCard(true)}
function renderCard(full){const p=selected;if(!p||cardEl.hidden)return;
  if(full||cardT<=0){cardT=1;drawFace(faceCtx,p);
    document.getElementById('c-name').firstChild.textContent=p.name;
    document.getElementById('c-sub').textContent=`${ageI(p)} · ${isKid(p)?'a child':isElder(p)?'an elder':'grown'} · loves ${p.spot.l}`+(p.craft>=0&&p.cxp>=1?` · ${CRAFT_EPITHET[p.craft]}`:'');
    document.getElementById('c-traits').innerHTML=p.tr.length?p.tr.map(t=>`<span>${t}</span>`).join(''):'<span>still becoming someone</span>';
    document.getElementById('c-doing').textContent=whyText(p);
    const RW={friend:'friend of',rival:'rival of',partner:'partner of',child:'parent of',parent:'child of'};const rels=p.rels.map(r=>{const q=byName(r.who);return`${RW[r.k]||r.k} ${q?`<button data-n="${r.who}">${r.who}</button>`:r.who+' (gone)'}`});
    document.getElementById('c-rels').innerHTML=rels.length?rels.join(' · '):'<i>knows no one well yet</i>';
    const kp=thingsOf(p.name); // what this one keeps, and where it has been (sprint 12)
    document.getElementById('c-hist').innerHTML=kp.map(t=>`<li><i>keeps</i>${t.full}${t.hist.length>1?'; it '+t.hist[t.hist.length-1].s:''}</li>`).join('')+p.hist.map(h=>`<li><i>day ${h.d}</i>${h.s}</li>`).join('')}
}
cardEl.querySelector('.rels').addEventListener('click',e=>{const b=e.target.closest('button');if(b){const q=byName(b.dataset.n);if(q)showCard(q)}});
document.getElementById('card-x').onclick=()=>showCard(null);
addEventListener('keydown',e=>{if(e.key==='Escape')showCard(null)});
// ---------- render ----------
function draw(){
  const s=sea(),sd=seaDay();
  if(paintedKey!==s+'|'+Math.round(snowD*6)/6+'|'+frozen+'|'+roadV)paintTerrain();
  // the view: everything below draws in world pixels; one transform carries the zoom and the look-around
  g.setTransform(1,0,0,1,0,0);g.fillStyle='#0b0d12';g.fillRect(0,0,cv.width,cv.height);
  const vk=vScale();g.setTransform(vk,0,0,vk,cv.width/2-camX*T*vk,cv.height/2-camY*T*vk);g.imageSmoothingEnabled=false;
  g.drawImage(ter,0,0);
  const L=light();
  // tide: the sand ring breathes twice a day
  if(!frozen){const th=.24+tide()*.018;for(const t of tideTiles){if(t.t===SAND&&t.e<th){g.fillStyle='#3d6a9a';g.fillRect(t.x*T,t.y*T,T,T)}else if(t.t===WATER&&t.e>=th){g.fillStyle='#b39f78';g.fillRect(t.x*T,t.y*T,T,T)}}}
  const wt=time*2;g.fillStyle='rgba(180,220,255,.25)';
  if(!frozen)for(let i=0;i<60;i++){const x=(i*37+((wt*13)|0))%(W*T),y=(i*53+((Math.sin(wt+i)*8)|0)+400)%(H*T);if(at((x/T)|0,(y/T)|0)===WATER&&elev[idx((x/T)|0,(y/T)|0)]<.16)g.fillRect(x,y,3,1)}
  for(const sp of springs){for(let j=0;j<2;j++){const k=(time*.45+sp.ph+j*.5)%1;g.strokeStyle=`rgba(196,228,255,${(.4*(1-k)*Math.max(.25,L)).toFixed(2)})`;g.lineWidth=1;g.beginPath();g.arc(sp.x*T,sp.y*T,1+k*sp.r*7,0,6.283);g.stroke()}}
  if(!frozen&&L>.15){g.fillStyle=`rgba(14,30,58,${(.42*L).toFixed(2)})`;for(const f of fishSh){const dx=f.tx-f.x,dy=f.ty-f.y,hz=Math.abs(dx)>=Math.abs(dy);for(let i=0;i<f.n;i++){const o=Math.sin(time*2.2+f.ph+i)*1.5;const x=f.x*T+(hz?i*3-3:o),y=f.y*T+(hz?o:i*2-2);g.fillRect(x,y,hz?3:1,hz?1:3)}}}
  for(const f of farms){g.fillStyle=snowD>.4?'#dfe6ea':'#7a5a37';g.fillRect(f.x*T,f.y*T,T,T);if(snowD>.4)continue;g.fillStyle=f.g>=1?'#e2c25a':s==='autumn'?'#a8a04a':'#7fb64c';const n=Math.min(4,1+(f.g*4)|0);for(let i=0;i<n;i++)g.fillRect(f.x*T+1+i*2,f.y*T+6-(f.g*4|0),1,1+(f.g*4|0))}
  for(const s of stumps){g.fillStyle='#5a3a1e';g.fillRect(s.x*T-1,s.y*T-1,3,2)}
  const ents=[];
  const CAN={spring:['#2f6a2b','#3f8a37'],summer:['#2c6a2a','#3f9038'],winter:['#28452a','#375a33']};
  const canopy=t=>s==='autumn'?(t.a<.35?['#8a4a1e','#c47a2a']:t.a<.7?['#8a2e1e','#b8402a']:['#7a6a20','#b09a2c']):CAN[s];
  const shrink=s==='autumn'&&sd===4?.85:1, blossom=s==='spring'&&sd<=3, cap=snowD>.15?Math.min(1,snowD*1.4):0;
  for(const t of trees)ents.push({y:t.y,d:()=>{const r=T*.7*t.s*shrink,c=canopy(t);g.fillStyle='#4a2f16';g.fillRect(t.x*T-1,t.y*T-r*.6,2,r*.9);g.fillStyle=c[0];g.beginPath();g.arc(t.x*T,t.y*T-r,r,0,6.283);g.fill();g.fillStyle=c[1];g.beginPath();g.arc(t.x*T-r*.3,t.y*T-r*1.2,r*.6,0,6.283);g.fill();
    if(blossom&&t.b&&t.s>.6){g.fillStyle='#e8a0b8';g.fillRect(t.x*T-r*.6,t.y*T-r*1.1,2,2);g.fillRect(t.x*T+r*.3,t.y*T-r*1.5,2,2);g.fillRect(t.x*T+r*.1,t.y*T-r*.6,2,2)}
    if(cap>0&&t.s>.4){g.fillStyle='#eef2f4';g.beginPath();g.arc(t.x*T-r*.2,t.y*T-r*1.35,r*.55*cap,0,6.283);g.fill()}}});
  const occSet=new Set();for(const p of people)if(p.inside&&p.shelterH)occSet.add(p.shelterH); // a house someone is waiting out the storm in shows a light
  for(const h of houses)ents.push({y:h.y+2,d:()=>{const x=h.x*T,y=h.y*T;g.fillStyle='#b8a17e';g.fillRect(x+1,y+7,14,9);g.fillStyle=h.r;g.beginPath();g.moveTo(x-1,y+8);g.lineTo(x+8,y);g.lineTo(x+17,y+8);g.fill();
    if(cap>0){g.fillStyle='#eef2f4';g.beginPath();g.moveTo(x+8-7*cap,y+7*cap);g.lineTo(x+8,y);g.lineTo(x+8+7*cap,y+7*cap);g.fill();g.fillRect(x+1,y+7,14,1)}
    if(hasWay(2)){g.fillStyle='#a34a2a';g.fillRect(x+11,y+1,2,3);g.fillStyle='#6b2f1e';g.fillRect(x+11,y+1,2,1)} // kiln-fired chimney pots
    g.fillStyle=(L<.5||occSet.has(h))?'#f5c463':'#2b2b3a';g.fillRect(x+4,y+10,3,3);g.fillRect(x+10,y+10,3,3);g.fillStyle='#4a2f16';g.fillRect(x+7,y+11,3,5)}});
  // buildings (bridge and hut sit low; the lighthouse sorts by its foot)
  const wind={clear:.7,overcast:1,rain:1.3,thunder:2.4,fog:.4,snow:.9}[wx];
  for(const b of bAll())ents.push({y:b.y+b.h,d:()=>{const x=b.x*T,y=b.y*T,done=b.done,pr=done?1:Math.min(1,b.prog/b.work);
    if(!done){g.fillStyle='rgba(60,45,25,.5)';g.fillRect(x,y,b.w*T,b.h*T);g.fillStyle='#8a6a44';for(let i=0;i<b.w*T;i+=4)g.fillRect(x+i,y+b.h*T-2-pr*6,2,2+pr*6);return}
    switch(b.kind){
      case 'hut':g.fillStyle='#8a6a44';g.fillRect(x+1,y-1,14,8);g.fillStyle='#6f4b32';g.fillRect(x,y-4,16,4);g.fillStyle='#4a3a2a';g.fillRect(x+6,y+2,3,5);g.fillStyle='#3a3a30';g.fillRect(x+11,y+1,3,4);g.fillRect(x+12,y-6,1,6);if(cap>0){g.fillStyle='#eef2f4';g.fillRect(x,y-4,16,Math.ceil(2*cap))}
        if(!boats.some(bb=>bb.kind==='fish')){const bx=x+(b.x>center.x?b.w*T+1:-10),by=y+8; // the boat, pulled up on the sand beside the hut
          g.fillStyle='rgba(0,0,0,.2)';g.fillRect(bx,by+3,9,1);
          g.fillStyle='#8a6a44';g.fillRect(bx+1,by,7,1);g.fillRect(bx+7,by-4,1,4);g.fillRect(bx+6,by-5,2,1);
          g.fillStyle='#6b4a2a';g.fillRect(bx,by+1,9,1);
          g.fillStyle='#4a2f16';g.fillRect(bx+1,by+2,7,1);g.fillRect(bx+3,by,1,1)}break;
      case 'well':g.fillStyle='#8c8478';g.fillRect(x+1,y+2,6,5);g.fillStyle='#3a3a30';g.fillRect(x+2,y+3,4,3);g.fillStyle='#6f4b32';g.fillRect(x+1,y-2,1,5);g.fillRect(x+6,y-2,1,5);g.fillRect(x,y-3,8,1);g.fillStyle='#d9d4c8';g.fillRect(x+1,y+2,6,1);if(cap>0){g.fillStyle='#eef2f4';g.fillRect(x,y-4,8,1)}break;
      case 'market':for(let i=0;i<3;i++){const sx=x+2+i*8,sy=y+(i===1?14:2);g.fillStyle=['#8a3d2f','#4c5f78','#c9a24a'][i];g.fillRect(sx,sy,6,3);g.fillStyle='#6f4b32';g.fillRect(sx,sy+3,1,4);g.fillRect(sx+5,sy+3,1,4);g.fillStyle='#b8a17e';g.fillRect(sx+1,sy+5,4,2)}break;
      case 'mill':{g.fillStyle='#a89880';g.fillRect(x+3,y+3,10,13);g.fillStyle='#8c8478';g.fillRect(x+12,y+3,1,13);g.fillStyle='#4c5f78';g.beginPath();g.moveTo(x+2,y+4);g.lineTo(x+8,y-2);g.lineTo(x+14,y+4);g.fill();if(cap>0){g.fillStyle='#eef2f4';g.beginPath();g.moveTo(x+8-6*cap,y+4-6*(1-cap));g.lineTo(x+8,y-2);g.lineTo(x+8+6*cap,y+4-6*(1-cap));g.fill()}g.fillStyle='#4a2f16';g.fillRect(x+7,y+11,3,5);
        const cx=x+8,cy=y+2,a=time*(.5+wind*.9);g.strokeStyle='#e8dcc4';g.lineWidth=1.5;g.beginPath();for(let i=0;i<4;i++){const an=a+i*Math.PI/2;g.moveTo(cx,cy);g.lineTo(cx+Math.cos(an)*9,cy+Math.sin(an)*9)}g.stroke();g.strokeStyle='#8a6a44';g.lineWidth=1;g.beginPath();for(let i=0;i<4;i++){const an=a+i*Math.PI/2+.25;g.moveTo(cx+Math.cos(an)*3,cy+Math.sin(an)*3);g.lineTo(cx+Math.cos(an)*8,cy+Math.sin(an)*8)}g.stroke();g.fillStyle='#4a2f16';g.fillRect(cx-1,cy-1,2,2);break}
      case 'smoke':g.fillStyle='#4a3a2a';g.fillRect(x+1,y,14,7);g.fillStyle='#3a2a1a';g.fillRect(x,y-3,16,3);g.fillStyle='#2a1c12';g.fillRect(x+6,y+2,3,5);g.fillStyle='#8c8478';g.fillRect(x+12,y-6,2,3);break;
      case 'bridge':{const hz=at(b.x-1,b.y)===WATER&&at(b.x+1,b.y)===WATER;g.fillStyle='#8a6a44';if(hz){g.fillRect(x-1,y+1,10,6);g.fillStyle='#6b4a2a';for(let i=0;i<5;i++)g.fillRect(x-1,y+1+i*1.5,10,.6);g.fillStyle='#4a2f16';g.fillRect(x-1,y,10,1);g.fillRect(x-1,y+7,10,1)}
        else{g.fillRect(x+1,y-1,6,10);g.fillStyle='#6b4a2a';for(let i=0;i<5;i++)g.fillRect(x+1+i*1.5,y-1,.6,10);g.fillStyle='#4a2f16';g.fillRect(x,y-1,1,10);g.fillRect(x+7,y-1,1,10)}break}
      case 'hall':g.fillStyle='#b8a17e';g.fillRect(x+1,y+5,22,11);g.fillStyle='#6f4b32';g.beginPath();g.moveTo(x-1,y+6);g.lineTo(x+12,y-2);g.lineTo(x+25,y+6);g.fill();g.fillStyle='#8c8478';g.fillRect(x+10,y-7,4,7);g.fillStyle='#6f4b32';g.fillRect(x+9,y-8,6,1);g.fillStyle='#f0b35a';g.fillRect(x+11,y-5,2,2);
        g.fillStyle=L<.5?'#f5c463':'#2b2b3a';g.fillRect(x+4,y+8,3,3);g.fillRect(x+17,y+8,3,3);g.fillStyle='#4a2f16';g.fillRect(x+10,y+10,4,6);
        {const sh=things.filter(t=>!t.holder);if(sh.length){/* the shelf where things wait (sprint 13): a plank between the windows, and what sits on it */
          g.fillStyle='#6b4a2a';g.fillRect(x+9,y+8,6,1);const TC=['#d9d4c8','#c9a24a','#4a5f8a'];
          for(let i=0;i<Math.min(3,sh.length);i++){g.fillStyle=TC[i%3];g.fillRect(x+10+i*2,y+7,1,1)}}}
        if(cap>0){g.fillStyle='#eef2f4';g.beginPath();g.moveTo(x+12-11*cap,y+6-8*(1-cap));g.lineTo(x+12,y-2);g.lineTo(x+12+11*cap,y+6-8*(1-cap));g.fill()}break;
      case 'light':g.fillStyle='#e6e2d8';g.fillRect(x+1,y-10,6,16);g.fillStyle='#8a3d2f';g.fillRect(x+1,y-6,6,3);g.fillRect(x+1,y,6,3);g.fillStyle='#c9c4b8';g.fillRect(x+6,y-10,1,16);g.fillStyle='#4a4640';g.fillRect(x,y-11,8,1);g.fillStyle=L<.55?'#fff2b0':'#5a5a60';g.fillRect(x+2,y-14,4,3);g.fillStyle='#4a4640';g.fillRect(x+1,y-15,6,1);break;
    }}});
  for(const w of works)ents.push({y:w.y+1,d:()=>{const x=Math.round(w.x*T),y=Math.round(w.y*T);
    if(!w.done){if(w.paid){g.fillStyle='rgba(60,45,25,.45)';g.fillRect(x,y,14,8);g.fillStyle='#8a6a44';const pr=Math.min(1,w.prog/14);for(let i=0;i<14;i+=4)g.fillRect(x+i,y+6-pr*5,2,2+pr*5)}return}
    switch(w.wk){
      case 'racks':g.fillStyle='#6f4b32';g.fillRect(x,y-4,1,6);g.fillRect(x+9,y-4,1,6);g.fillStyle='#8a6a44';g.fillRect(x,y-4,10,1);g.fillRect(x,y-2,10,1);g.fillStyle='#b8c4c9';for(let i=1;i<9;i+=3)g.fillRect(x+i,y-3,1,2);break;
      case 'ring':g.fillStyle='#8c8478';for(let i=0;i<7;i++){const a=i/7*6.283+.4;g.fillRect(center.x*T+Math.cos(a)*7-1,center.y*T+Math.sin(a)*5,2,2)}break;
      case 'swing':g.fillStyle='#d9d4c8';g.fillRect(x+3,y-7,1,6);g.fillStyle='#6f4b32';g.fillRect(x+2,y-1,3,1);break;
      case 'boat2':if(boats.filter(bb=>bb.kind==='fish').length<2){g.fillStyle='rgba(0,0,0,.2)';g.fillRect(x,y+3,9,1);g.fillStyle='#8a6a44';g.fillRect(x+1,y,7,1);g.fillStyle='#6b4a2a';g.fillRect(x,y+1,9,1);g.fillStyle='#4a2f16';g.fillRect(x+1,y+2,7,1)}break;
      case 'hives':g.fillStyle='#c9a24a';g.fillRect(x,y-2,3,3);g.fillRect(x+5,y-2,3,3);g.fillStyle='#8a6a2a';g.fillRect(x,y-2,3,1);g.fillRect(x+5,y-2,3,1);g.fillStyle='#2a1c12';g.fillRect(x+1,y,1,1);g.fillRect(x+6,y,1,1);break;
      case 'bench':g.fillStyle='#8a6a44';g.fillRect(x,y,6,1);g.fillStyle='#6f4b32';g.fillRect(x,y+1,1,2);g.fillRect(x+5,y+1,1,2);break;
      case 'shrine':g.fillStyle='rgba(0,0,0,.22)';g.fillRect(x-2,y+1,8,1);
        g.fillStyle='#8c8478';g.fillRect(x,y-6,3,7);g.fillStyle='#a49e92';g.fillRect(x,y-6,1,7);g.fillRect(x,y-6,3,1);g.fillStyle='#5e5850';g.fillRect(x+2,y-5,1,6);
        g.fillStyle='#6f6a60';g.fillRect(x+4,y-1,3,2);g.fillStyle='#3a3a30';g.fillRect(x+5,y-1,1,1);
        if(faith>.45){g.fillStyle='#c9a24a';g.fillRect(x+5,y-2,1,1);g.fillStyle='#8a3d2f';g.fillRect(x-2,y-1,1,1)}break;
    }}});
  if(ruin&&ruin.roof)ents.push({y:ruin.y+1.2,d:()=>{const x=Math.round(ruin.x*T),y=Math.round(ruin.y*T);g.fillStyle='#6f4b32';g.beginPath();g.moveTo(x-13,y+2);g.lineTo(x,y-8);g.lineTo(x+13,y+2);g.fill();g.fillStyle='#4a2f16';g.fillRect(x-12,y+2,24,1);if(snowD>.15){g.fillStyle='#eef2f4';g.beginPath();g.moveTo(x-11,y+1);g.lineTo(x,y-8);g.lineTo(x+11,y+1);g.fill()}}});
  for(const b of boats)ents.push({y:b.y+.4,d:()=>{const x=b.x*T,y=b.y*T;const bob=Math.sin(time*3+b.x)*.6;
    if(b.kind==='trade'){g.fillStyle='#5a3a1e';g.fillRect(x-6,y+bob,12,4);g.fillStyle='#8a6a44';g.fillRect(x-6,y+bob,12,1);g.fillStyle='#4a2f16';g.fillRect(x,y-9+bob,1,9);g.fillStyle='#e8dcc4';g.beginPath();g.moveTo(x+1,y-9+bob);g.lineTo(x+7,y-2+bob);g.lineTo(x+1,y-2+bob);g.fill();g.fillStyle='#c96b4a';g.fillRect(x-4,y-3+bob,3,3);g.fillStyle='#f1cfa5';g.fillRect(x-4,y-5+bob,3,2)}
    else{g.fillStyle='#6b4a2a';g.fillRect(x-4,y+bob,8,3);g.fillStyle='#4a2f16';g.fillRect(x-4,y+bob,8,1);g.fillStyle='#8a6a44';g.fillRect(x-5,y+1+bob,1,1);g.fillRect(x+4,y+1+bob,1,1);
      if(b.kind==='fish'&&hasWay(0)){g.fillStyle='#4a2f16';g.fillRect(x,y-7+bob,1,7);g.fillStyle='#e8dcc4';g.beginPath();g.moveTo(x+1,y-7+bob);g.lineTo(x+5,y-2+bob);g.lineTo(x+1,y-2+bob);g.fill()}
      if(b.kind==='arrival'){g.fillStyle='#7fa85b';g.fillRect(x-1,y-3+bob,3,3);g.fillStyle='#f1cfa5';g.fillRect(x-1,y-5+bob,3,2)}}}});
  // a stone gets visited more than it gets forgotten (sprint 15): a pebble at two visits, a flower at six, moss softening the stone by twelve
  for(const gr of graves)ents.push({y:gr.y,d:()=>{const x=gr.x*T,y=gr.y*T,vn=gr.vn||0;g.fillStyle='#8c8478';g.fillRect(x-1,y-4,3,5);g.fillStyle='#d9d4c8';g.fillRect(x-1,y-4,1,4);g.fillStyle='#4a4640';g.fillRect(x+1,y-3,1,4);g.fillStyle='#5a7a3a';g.fillRect(x-2,y,5,1);
    if(vn>=2){g.fillStyle='#8c8478';g.fillRect(x-3,y,1,1);g.fillRect(x+3,y,1,1)}
    if(vn>=6){g.fillStyle='#7fa85b';g.fillRect(x-3,y-1,1,1);g.fillStyle='#c96b8a';g.fillRect(x-3,y-2,1,1)}
    if(vn>=12){g.fillStyle='rgba(122,150,90,.4)';g.fillRect(x-1,y-2,2,2)}
    if(cap>0){g.fillStyle='#eef2f4';g.fillRect(x-1,y-5,3,1)}}});
  // the named ground shows its walking (sprint 14): worn grass first, then the stones the walks leave, then a small cairn
  for(const sp of spots){if(!sp.lore)continue;const n=loreN[sp.k]||0;if(!n)continue;
    ents.push({y:sp.y-.1,d:()=>{const x=Math.round(sp.x*T),y=Math.round(sp.y*T);
      g.fillStyle='rgba(74,58,38,.3)';g.fillRect(x-3,y-1,6,2);g.fillRect(x-1,y-2,3,1);
      if(n>=2){g.fillStyle='#8c8478';g.fillRect(x-2,y-1,2,1);g.fillRect(x+1,y,1,1)}
      if(n>=4){g.fillStyle='#8c8478';g.fillRect(x-1,y-2,3,1);g.fillStyle='#a49e92';g.fillRect(x-1,y-2,1,1);g.fillStyle='#5e5850';g.fillRect(x+1,y-1,1,1)}
      if(n>=7){g.fillStyle='#8c8478';g.fillRect(x,y-3,1,1);g.fillStyle='#a49e92';g.fillRect(x-2,y-1,1,1);g.fillStyle='#5e5850';g.fillRect(x+1,y-2,1,1);if(cap>0){g.fillStyle='#eef2f4';g.fillRect(x-1,y-4,3,1)}}}})}
  if(ruin)for(const st of ruin.st)ents.push({y:st.y,d:()=>{const x=Math.round(st.x*T),y=Math.round(st.y*T);g.fillStyle='rgba(0,0,0,.22)';g.fillRect(x-3,y+1,8,1);
    if(st.f){g.fillStyle='#8c8478';g.fillRect(x-4,y-2,8,3);g.fillStyle='#a49e92';g.fillRect(x-4,y-2,8,1);g.fillStyle='#5e5850';g.fillRect(x-4,y,8,1);g.fillStyle='#5a7a3a';g.fillRect(x-2,y-3,2,1);g.fillRect(x+2,y,1,1);if(cap>0){g.fillStyle='#eef2f4';g.fillRect(x-4,y-3,8,1)}}
    else{const h=st.h*3+3;g.fillStyle='#8c8478';g.fillRect(x-2,y-h,5,h+1);g.fillStyle='#a49e92';g.fillRect(x-2,y-h,2,h);g.fillRect(x-2,y-h,5,1);g.fillStyle='#5e5850';g.fillRect(x+2,y-h+1,1,h);g.fillStyle='#4a4640';g.fillRect(x-1,y-h+3,1,1);g.fillStyle='#5a7a3a';g.fillRect(x-2,y-2,1,2);g.fillRect(x+1,y-1,1,1);if(cap>0){g.fillStyle='#eef2f4';g.fillRect(x-2,y-h-1,5,1)}}}});
  for(const w of wild){if(w.st==='hide')continue;ents.push({y:w.y,d:()=>{const x=w.x*T,y=w.y*T,f=w.f||1,mv=(w.st==='move'||w.st==='flee'||w.st==='hop'||w.st==='trot'||w.st==='chase'||w.st==='leave');
    if(w.k==='deer'){const bob=mv?Math.sin(time*(w.st==='flee'?18:8))*1:0,lie=isNight()&&w.st==='graze';g.fillStyle='rgba(0,0,0,.22)';g.fillRect(x-4,y,8,1);
      if(lie){g.fillStyle='#8a6a44';g.fillRect(x-4,y-3,8,3);g.fillStyle='#a58252';g.fillRect(x-4,y-3,8,1);g.fillStyle='#6b4a2a';g.fillRect(x+f*3-1,y-5,2,3);g.fillRect(x+f*3,y-6,1,1);return}
      g.fillStyle='#8a6a44';g.fillRect(x-4,y-5+bob,8,4);g.fillStyle='#a58252';g.fillRect(x-4,y-5+bob,8,1);g.fillStyle='#e8dcc4';g.fillRect(x-f*4,y-3+bob,1,2);
      g.fillStyle='#6b4a2a';g.fillRect(x-4+bob*0,y-1,1,2);g.fillRect(x-1,y-1,1,2);g.fillRect(x+1,y-1,1,2);g.fillRect(x+3,y-1,1,2);g.fillRect(x+f*4-(f>0?0:1),y-8+bob,2,4);g.fillRect(x+f*5-(f>0?0:1),y-7+bob,1,1);g.fillStyle='#4a2f16';g.fillRect(x+f*4,y-9+bob,1,1);g.fillRect(x+f*4-f,y-10+bob,1,2)}
    else if(w.k==='rabbit'){const bob=mv?Math.abs(Math.sin(time*14))*2:0;g.fillStyle='rgba(0,0,0,.2)';g.fillRect(x-2,y,4,1);g.fillStyle=snowD>.5?'#e8e8e4':'#a89880';g.fillRect(x-2,y-3-bob,4,3);g.fillRect(x+f*1,y-5-bob,1,2);g.fillStyle=snowD>.5?'#d0d0cc':'#8c8478';g.fillRect(x-f*2,y-2-bob,1,1)}
    else if(w.k==='fox'){const bob=mv?Math.sin(time*12)*1:0;g.fillStyle='rgba(0,0,0,.2)';g.fillRect(x-4,y,8,1);g.fillStyle='#b8552a';g.fillRect(x-3,y-3+bob,6,2);g.fillRect(x+f*3,y-4+bob,2,2);g.fillStyle='#e8dcc4';g.fillRect(x-f*4,y-2+bob,2,1);g.fillStyle='#4a2f16';g.fillRect(x-3,y-1,1,1);g.fillRect(x+2,y-1,1,1);g.fillRect(x+f*3,y-5+bob,1,1);g.fillStyle='#e8dcc4';g.fillRect(x+f*3+(f>0?1:0),y-3+bob,1,1)}
  }})}
  if(whale)ents.push({y:whale.y,d:()=>{const x=whale.x*T,y=whale.y*T,k=Math.sin(Math.min(1,whale.t/whale.dur)*Math.PI);if(k<.05)return;const w=Math.round(12*k),h=Math.max(1,Math.round(4*k));g.fillStyle='#2b3542';g.fillRect(x-w,y-h,w*2,h);g.fillRect(x-w+2,y-h-1,w*2-4,1);g.fillStyle='#4a5868';g.fillRect(x-w+2,y-h,w*2-4,1);g.fillStyle='#1e2630';g.fillRect(x-w,y-1,w*2,1);if(whale.t>whale.dur*.55){g.fillStyle='#2b3542';g.fillRect(x+whale.dir*(w+1),y-h-3*k,2,Math.round(4*k))}g.fillStyle='rgba(220,235,255,.35)';g.fillRect(x-w-2,y,w*2+4,1)}});
  for(const p of people)ents.push({y:p.y+(p.inBoat?.5:0),d:()=>{if(p.inside)return;const x=p.x*T,y=p.y*T+(p.inBoat?-1:0),busy=p.task==='chop'||p.task==='build'||p.task==='till'||p.task==='harvest',bob=busy?Math.sin(time*12+p.off)*1.2:0;const k=isKid(p)?.55+ageOf(p)/31:1;
    if(p===selected){g.fillStyle='rgba(240,179,90,.55)';g.fillRect(x-4,y+1,9,1);g.fillRect(x-4,y-1,1,2);g.fillRect(x+4,y-1,1,2)}
    if(p.task==='sleep'){g.fillStyle=p.col;g.fillRect(x-2,y-2,5,3);return}
    g.fillStyle='rgba(0,0,0,.25)';g.fillRect(x-2,y,5,1);g.fillStyle=p.col;g.fillRect(x-1.5,y-5*k+bob,3,4*k);g.fillStyle='#f1cfa5';g.fillRect(x-1.5,y-8*k+bob,3,3);g.fillStyle=p.hair;g.fillRect(x-1.5,y-8*k+bob,3,1);
    if(p.task==='chop'){g.fillStyle='#999';g.fillRect(x+2,y-7+bob*2,2,2)}
    if(p.task==='fish'){g.fillStyle='#e8dcc4';g.fillRect(x+2,y-6,1,7)}
    if(p.task==='wave'&&Math.hypot(p.tx-p.x,p.ty-p.y)<.05){g.fillStyle='#f1cfa5';g.fillRect(x+2,y-9*k+Math.sin(time*9+p.off)*1.5,1,3)}}});
  ents.push({y:center.y,d:()=>{const x=center.x*T,y=center.y*T;g.fillStyle='#3a2a1a';g.fillRect(x-4,y-1,8,3);const fl=isNight()||L<.6;
    if(fl){for(let i=0;i<4;i++){g.fillStyle=i%2?'#ffb347':'#ff6a2b';const s=RM?2.2:2+Math.sin(time*10+i)*1.5;g.fillRect(x-1+(RM?0:Math.sin(time*7+i)*1.5),y-3-i*1.5-s,2,s)}}}});
  ents.sort((a,b)=>a.y-b.y).forEach(e=>e.d());
  for(const f of fx){if(f.rg){const k=1-f.l/f.l0;g.strokeStyle=`rgba(200,230,255,${(.55*(1-k)).toFixed(2)})`;g.lineWidth=1;g.beginPath();g.arc(f.x*T,f.y*T,1+k*9,0,6.283);g.stroke()}else{g.fillStyle=f.c;g.fillRect(f.x*T,f.y*T,2,2)}}
  for(const k of skips){g.fillStyle='#3a3a34';g.fillRect(k.x*T-1,k.y*T-2,2,2)}
  if(clouds.length&&cloudSp.length){const cl=Math.max(.16,L*.95);
    for(const c of clouds){const w=112*c.s,h=64*c.s;g.globalAlpha=Math.min(1,(c.r>0?1.15:.75)*cl);g.drawImage(cloudSp[c.i],Math.round(c.x*T-w/2),Math.round(c.y*T-h/2),w,h)}
    g.globalAlpha=1;
    for(const c of clouds){if(c.r<=0)continue;const w=112*c.s*.42,h=64*c.s*.42,cx=c.x*T,cy=c.y*T;g.strokeStyle='rgba(200,220,255,.42)';g.beginPath();
      for(let i=0;i<46;i++){const x=cx-w+((i*53+((time*300)|0)*(i%3+1))%(w*2)),y=cy-h+((i*37+((time*400)|0))%(h*2));g.moveTo(x,y);g.lineTo(x-2,y+6)}g.stroke()}}
  for(const gl of gulls){const x=gl.x*T,y=gl.y*T,up=Math.sin(time*(RM?2.5:7)+gl.ph)>0;g.fillStyle='rgba(0,0,0,.12)';g.fillRect(x-2,y+9,5,1);g.fillStyle='#f0f0ea';if(up){g.fillRect(x-3,y-1,2,1);g.fillRect(x-1,y,3,1);g.fillRect(x+2,y-1,2,1)}else{g.fillRect(x-3,y+1,2,1);g.fillRect(x-1,y,3,1);g.fillRect(x+2,y+1,2,1)}g.fillStyle='#8c8478';g.fillRect(x,y,1,1)}
  if(geese){g.fillStyle='#2a2620';const dir=Math.sign(geese.vx);for(let i=0;i<geese.n;i++){const k=Math.ceil(i/2),side=i%2?1:-1;const x=(geese.x-dir*k*1.35)*T,y=(geese.y+side*k*.75)*T,fl=Math.sin(time*9+geese.ph+i)>0?0:1;g.fillRect(x-1,y+fl,3,1);g.fillRect(x-2,y-fl+1,1,1);g.fillRect(x+2,y-fl+1,1,1)}}
  if(rain){g.strokeStyle=storm?'rgba(200,220,255,.5)':'rgba(200,220,255,.35)';g.beginPath();const n=(storm?300:180)*(RM?.5:1);for(let i=0;i<n;i++){const x=(i*97+((time*300)|0)*(i%3+1))%(W*T),y=(i*61+((time*400)|0))%(H*T);g.moveTo(x,y);g.lineTo(x-(storm?4:2),y+6)}g.stroke()}
  if(wx==='snow'){g.fillStyle='rgba(255,255,255,.85)';const sn=RM?70:150;for(let i=0;i<sn;i++){const x=(i*97+((time*20)|0)*(i%3+1)+((Math.sin(time*.8+i)*5)|0)+2000)%(W*T),y=(i*61+((time*34)|0))%(H*T);g.fillRect(x,y,i%4?1:2,i%4?1:2)}}
  // sky: season tint, cloud, fog
  const f=dayFrac(),e=edges();
  if(s==='summer'&&L>.5){g.fillStyle=`rgba(255,200,90,${(L-.5)*.14})`;g.fillRect(0,0,W*T,H*T)}
  if(s==='winter'){g.fillStyle='rgba(150,180,220,.10)';g.fillRect(0,0,W*T,H*T)}
  if(wx==='overcast'||wx==='snow'||wx==='fog'){g.fillStyle=`rgba(120,130,150,${wx==='snow'?.28:.2})`;g.fillRect(0,0,W*T,H*T)}
  if(fogA>.01){const dx=Math.sin(time*.06)*10;g.globalAlpha=fogA*.55;g.drawImage(fogCv,dx,0);g.globalAlpha=fogA*.4;g.drawImage(fogCv,-dx*.6,Math.cos(time*.05)*4);g.globalAlpha=1;
    g.fillStyle=`rgba(230,236,240,${(fogA*.16).toFixed(3)})`;for(let i=0;i<10;i++){const y=(i*67+13)%(H*T),x=((i*151+time*(6+i%3)*3)%(W*T*1.4))-W*T*.2;g.fillRect(x,y,120+i*20,7);g.fillRect(x+30,y+7,80+i*10,4)}}
  if(farIsle&&fogA<.9){const fi=farIsle,x0=fi.x*T,w=fi.w*T,h=fi.h*1.7,al=(1-fogA)*(wx==='overcast'||rain||wx==='snow'?.55:.8);g.fillStyle=L>.5?`rgba(44,58,86,${(al*.85).toFixed(2)})`:`rgba(18,24,44,${al.toFixed(2)})`;
    g.beginPath();g.moveTo(x0,0);g.quadraticCurveTo(x0+w*.22,h*1.5,x0+w*.42,h*.7);g.quadraticCurveTo(x0+w*.6,h*2.1,x0+w*.8,h*.9);g.quadraticCurveTo(x0+w*.92,h*.4,x0+w,0);g.closePath();g.fill();
    g.fillStyle=`rgba(200,214,232,${(al*.18*(L>.5?1:.3)).toFixed(3)})`;g.fillRect(x0-6,h*1.9,w+12,1)}
  const dark=1-L;g.fillStyle=`rgba(12,16,48,${(dark*.72+(storm?.12:rain?.06:0))*(1-flash*.9)})`;g.fillRect(0,0,W*T,H*T);
  if(flash>0){g.fillStyle=`rgba(255,255,255,${flash*.35})`;g.fillRect(0,0,W*T,H*T)}
  const gold=Math.max(0,1-Math.abs(f-(e[0]+.02))*9)+Math.max(0,1-Math.abs(f-(e[1]-.01))*9);if(gold>0&&wx!=='fog'&&!rain){g.fillStyle=`rgba(255,140,60,${gold*(s==='summer'?.22:.18)})`;g.fillRect(0,0,W*T,H*T)}
  if(dark>.3){g.globalCompositeOperation='lighter';const glow=(x,y,r,a)=>{const gr=g.createRadialGradient(x,y,0,x,y,r);gr.addColorStop(0,`rgba(255,180,90,${a})`);gr.addColorStop(1,'rgba(255,180,90,0)');g.fillStyle=gr;g.fillRect(x-r,y-r,r*2,r*2)};
    glow(center.x*T,center.y*T-2,40,.5*dark);for(const h of houses)glow(h.x*T+8,h.y*T+11,18,.35*dark);
    if(farIsle&&farIsle.lit&&fogA<.6&&(time*2.3|0)%9!==0){const lx=(farIsle.x+farIsle.w*.6)*T,ly=farIsle.h*1.7*1.5;g.fillStyle=`rgba(255,190,110,${(.9*(dark-.3)).toFixed(2)})`;g.fillRect(lx,ly,1,1);glow(lx,ly,7,.5*(dark-.3))}
    g.globalCompositeOperation='source-over'}
  if(flies.length){g.globalCompositeOperation='lighter';for(const fl of flies){const b=RM?.85:Math.sin(time*2.6+fl.ph);if(b<.2)continue;const a=(b-.2)*1.1*Math.min(1,fl.l/6);const x=fl.x*T,y=fl.y*T-2;g.fillStyle=`rgba(190,255,120,${(a*.35).toFixed(2)})`;g.fillRect(x-1,y-1,3,3);g.fillStyle=`rgba(230,255,170,${a.toFixed(2)})`;g.fillRect(x,y,1,1)}g.globalCompositeOperation='source-over'}
  {const lh=getB('light');if(lh&&dark>.35){const lx=lh.x*T+4,ly=lh.y*T-13,a=time*.9,al=(dark-.35)*.22*(wx==='fog'?1.6:1);g.globalCompositeOperation='lighter';g.fillStyle=`rgba(255,240,180,${al})`;
    for(const off of [0,Math.PI]){g.beginPath();g.moveTo(lx,ly);g.arc(lx,ly,120,a+off-.13,a+off+.13);g.closePath();g.fill()}g.globalCompositeOperation='source-over'}}
  if(dark>.5&&wx==='clear'){g.fillStyle=`rgba(255,255,255,${(dark-.5)*1.2})`;const rr=mulberry(seed^7);for(let i=0;i<70;i++){const x=rr()*W*T,y=rr()*H*T;if(at((x/T)|0,(y/T)|0)===WATER&&(time*3+i)%7<6)g.fillRect(x,y,1,1)}}
  document.getElementById('s-pop').textContent=people.length;document.getElementById('s-wood').textContent=wood;document.getElementById('s-food').textContent=food;document.getElementById('s-store').textContent=granary;
  const lbl=f<e[0]?'night':f<e[0]+.1?'dawn':f<.5?'morning':f<e[1]-.1?'afternoon':f<e[1]?'dusk':'night';const wxl={clear:'',overcast:' · overcast',rain:' · rain',thunder:' · storm',fog:' · fog',snow:' · snow'}[wx]+(hunger>.3?' · hungry':'');
  document.getElementById('s-time').textContent=`year ${yearOf(dayCount)} · day ${dayCount} · ${s} · ${lbl}${wxl}`;document.getElementById('s-time-s').textContent=`d${dayCount} · ${s} · ${lbl}${wxl}`;
}
