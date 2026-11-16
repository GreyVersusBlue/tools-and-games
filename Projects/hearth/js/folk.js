// Hearth — the folk on the map: how people are drawn and told apart.
// Classic scripts sharing one global scope; the load order in index.html is the old single file’s order and it matters.
/* A8: people you can tell apart. The figure is still 3 px wide and 8 tall for an adult; what it gains is the portrait's own choices (faceSpec in
   render.js, one answer for the card and the map): skin, hair and its grey, the hat or headband, a beard pixel, a stride while walking, a side
   to face, a stick for the old and a dark rim on lying snow. Reads state and assigns only underscore fields (p._f); never calls R(). */
/* A9: who is who, and who is singing. Name tags (div#tags, a pool of six, placed from world coordinates once a frame by updateTags(), which
   draw() calls last): the selected person always, and at zoom 2 or more anyone within 3 tiles of the pointer. While someone is selected a 1 px
   line runs from them to each tie that is out of doors. A singer's note is three frames rising, in a colour that belongs to the song; the teller
   at a fire night stands a pixel taller with an arm that moves. Reads state and assigns only its own variables; never calls R(). */
const TIEC={partner:'rgba(240,179,90,.9)',parent:'rgba(232,228,218,.75)',child:'rgba(232,228,218,.75)',friend:'rgba(122,196,112,.75)',rival:'rgba(222,92,80,.9)'};
const kOf=p=>isKid(p)?.55+ageOf(p)/31:1;
/* who p is tied to and can be seen: partner, parents and children, friends, rivals, and the one p is not speaking to (a feud's other half, drawn as a rival) */
function tiesOf(p){const out=[],seen=new Set(),add=(q,k)=>{if(!q||q===p||q.inside||q.dead||seen.has(q.name))return;seen.add(q.name);out.push({q,k})};
  const fw=feudWith(p);if(fw)add(fw,'rival');for(const r of p.rels)add(byName(r.who),r.k);return out}
function drawTies(p){const x=p.x*T+.5,y=p.y*T-3*kOf(p)+.5;g.lineWidth=1;
  for(const t of tiesOf(p)){g.strokeStyle=TIEC[t.k]||TIEC.friend;if(t.k==='rival'){g.setLineDash([2,2]);g.lineDashOffset=.5} /* the .5 puts the dashes on whole pixels: the line starts at a pixel's centre */
    g.beginPath();g.moveTo(x,y);g.lineTo(t.q.x*T+.5,t.q.y*T-3*kOf(t.q)+.5);g.stroke();if(t.k==='rival'){g.setLineDash([]);g.lineDashOffset=0}}}
/* a song's colour is a function of the song: its chronicle index round the wheel in steps of 47 degrees. Returned as hex so a check can read it */
function noteCol(sg){const h=((sg.ci*47)%360)/360,s=.75,l=.7,a=s*Math.min(l,1-l),f=n=>{const k=(n+h*12)%12,c=l-a*Math.max(-1,Math.min(k-3,9-k,1));return Math.round(c*255)};
  return'#'+[f(0),f(8),f(4)].map(v=>(v<16?'0':'')+v.toString(16)).join('')}
const songOf=p=>songs.find(sg=>!sg.lost&&sg.kn.includes(p.name))||null;
/* the teller is the oldest grown person at the fire, which is who tellStory() picks from everyone it sent there */
function tellerNow(){let best=null;if(storyDay!==dayCount)return null;
  for(const q of people)if(!q.dead&&!q.inside&&q.task==='gather'&&!isKid(q)&&(!best||ageOf(q)>ageOf(best)))best=q;return best}
const tagsEl=document.getElementById('tags'),tagPool=[];
function updateTags(){if(!tagsEl)return;
  const want=[];if(selected&&!selected.inside&&!selected.dead)want.push(selected);
  if(zoom>=2){const near=people.filter(p=>p!==selected&&!p.inside&&!p.dead&&Math.hypot(p.x-cur.x,p.y-cur.y)<3).sort((a,b)=>Math.hypot(a.x-cur.x,a.y-cur.y)-Math.hypot(b.x-cur.x,b.y-cur.y));
    for(const p of near)want.push(p)}
  const r=cv.getBoundingClientRect(),k=vScale();
  for(let i=0;i<6;i++){let el=tagPool[i]; /* six is the most there are */if(!el){if(i>=want.length)continue;el=tagPool[i]=document.createElement('div');el.className='tag';tagsEl.appendChild(el)}
    const p=want[i];if(!p){if(!el.hidden)el.hidden=true;continue}
    const cx=r.left+(p.x*T*k+cv.width/2-camX*T*k)/dprE,cy=r.top+((p.y*T-8*kOf(p)-(p.inBoat?1:0))*k+cv.height/2-camY*T*k)/dprE-2,key=p.name+'|'+(p===selected)+'|'+Math.round(cx)+'|'+Math.round(cy);
    if(el._k===key&&!el.hidden)continue;el._k=key;el.hidden=false;el.textContent=p.name;el.className=p===selected?'tag sel':'tag';el.style.left=Math.round(cx)+'px';el.style.top=Math.round(cy)+'px'}}

const HATCOL={proud:'#4c5f78',brave:'#8a3d2f',plain:'#6f4b32'};
/* B2: what is in someone's hands, 2 to 3 px, drawn from carryOf() in goods.js. The axe and the rod are drawn below, where they always were. */
function drawItem(it,x,y,f,k){const h=f>0?x+2:x-3,t=y-4*k;
  switch(it.k){
    case 'basket':g.fillStyle='#6b4a2a';g.fillRect(h,t+1,3,1);g.fillStyle='#a0723a';g.fillRect(h,t+2,3,1);g.fillStyle='#e8c86a';g.fillRect(h+1,t,1,1);break;
    case 'sack':g.fillStyle='#d6c79a';g.fillRect(h,t,3,3);g.fillStyle='#b3a273';g.fillRect(h,t+2,3,1);break;
    case 'bucket':for(const bx of [x-3,x+2]){g.fillStyle='#7a5a38';g.fillRect(bx,t+2,2,2);if(it.full){g.fillStyle='#4a90d9';g.fillRect(bx,t+1,2,1)}}break;
    case 'sheaf':g.fillStyle='#e8c86a';g.fillRect(h,t,3,3);g.fillStyle='#b8943a';g.fillRect(h,t+2,3,1);break;
    case 'plank':g.fillStyle='#c8935a';g.fillRect(f>0?x+1:x-4,t+1,4,1);break;
    case 'hammer':g.fillStyle='#6b4423';g.fillRect(h+1,t,1,3);g.fillStyle='#999';g.fillRect(h,t,3,1);break;
    case 'fishstring':g.fillStyle='#8a6a44';g.fillRect(h+1,t,1,1);g.fillStyle='#c9d0c8';g.fillRect(h,t+1,1,2);g.fillRect(h+2,t+1,1,2);g.fillStyle='#7d8c8a';g.fillRect(h,t+3,1,1);g.fillRect(h+2,t+3,1,1);break;
    case 'bowl':g.fillStyle='#d9d4c8';g.fillRect(h,t+2,3,1);g.fillStyle='#8c8478';g.fillRect(h+1,t+3,1,1);break;
    case 'staff':g.fillStyle='#6b4a2a';g.fillRect(f>0?x-3:x+2,y-9*k,1,9*k);break;
    case 'firewood':g.fillStyle='#6b4423';g.fillRect(h,t+1,3,1);g.fillStyle='#8a5a2e';g.fillRect(h,t,1,1);break}}
function drawFolk(p){carryTrack(p);
  if(p._set&&!p.dead){const it=p._set,x=Math.round(it.x*T),y=Math.round(it.y*T);g.fillStyle='rgba(0,0,0,.22)';g.fillRect(x-1,y+3,4,1);if(it.k!=='staff')drawItem(it,x-2,y+4,1,1)}
  if(p.inside)return;
  const x=p.x*T,y=p.y*T+(p.inBoat?-1:0),busy=p.task==='chop'||p.task==='build'||p.task==='till'||p.task==='harvest',bob=busy?Math.sin(animT*12+p.off)*1.2:0;
  const k=kOf(p);
  if(p===selected){drawTies(p);g.fillStyle='rgba(240,179,90,.55)';g.fillRect(x-4,y+1,9,1);g.fillRect(x-4,y-1,1,2);g.fillRect(x+4,y-1,1,2)}
  if(p.task==='sleep'){g.fillStyle=p.col;g.fillRect(x-2,y-2,5,3);return}
  const sp=faceSpec(p),sk=SKIN[sp.skin],el=isElder(p)?1:0,dx=p.tx-p.x,mv=Math.hypot(dx,p.ty-p.y)>.05;
  if(Math.abs(dx)>.02)p._f=dx>0?1:-1;const f=p._f||1;
  const tl=p.task==='gather'&&tellerNow()===p?1:0; /* the teller at a fire night stands a pixel taller */
  const top=y-8*k+el+bob-tl,sh=y-5*k+el+bob-tl; /* head top, shirt top: an elder is one pixel shorter */
  g.fillStyle='rgba(0,0,0,.25)';g.fillRect(x-2,y,5,1);
  if(snowD>.15){g.fillStyle='rgba(26,30,48,.6)';g.fillRect(x-2.5,top-1,5,y-top+1)} /* a rim behind and under, so a pale shirt does not vanish on snow */
  g.fillStyle=p.col;g.fillRect(x-1.5,sh,3,(4*k-el)-(mv?1:0)+tl);
  if(mv){g.fillStyle='#3a2a1a';if(Math.sin(animT*10+p.off)>0){g.fillRect(x-1.5,y-1*k,1,1);g.fillRect(x+.5,y-1*k,1,1)}else g.fillRect(x-.5,y-1*k,1,1)}
  g.fillStyle=sk[0];g.fillRect(x-1.5,top,3,3);g.fillStyle=sk[1];g.fillRect(x+.5*f-.5,top+2,1,1);
  g.fillStyle=sp.hair;g.fillRect(x-1.5,top,3,1);
  if(sp.hat){g.fillStyle=HATCOL[sp.hat];g.fillRect(x-1.5,top+(sp.hat==='brave'?1:0),3,1)}
  if(sp.beard){g.fillStyle=sp.hair;g.fillRect(x-.5,top+2,1,1)}
  if(el){g.fillStyle='#6f4b32';g.fillRect(f>0?x+1.5:x-2.5,y-3,1,3)}
  if(tl){g.fillStyle=sk[0];g.fillRect(f>0?x-2.5:x+1.5,sh+1-(Math.sin(animT*4+p.off)>0?1:0),1,2)} /* an arm that moves, on the side away from where the teller faces */
  if(p.sick&&p.task!=='abed'){g.fillStyle='rgba(236,236,226,.3)';g.fillRect(x-1.5,top,3,y-top-1)} /* still up, and a shade paler for it */
  {const it=p._c;if(it&&it.k!=='axe'&&it.k!=='rod')drawItem(it,x,y,f,k);const bc=beltOf(p);if(bc){g.fillStyle=bc;g.fillRect(x-1.5,y-2*k,1,1)}}
  if(p.task==='chop'){g.fillStyle='#999';g.fillRect(x+2,y-7+bob*2,2,2)}
  if(p.task==='fish'){g.fillStyle='#e8dcc4';g.fillRect(x+2,y-6,1,7)}
  if(p.task==='wave'&&Math.hypot(p.tx-p.x,p.ty-p.y)<.05){g.fillStyle=sk[0];g.fillRect(x+2,y-9*k+Math.sin(animT*9+p.off)*1.5,1,3)}
  /* sprint 16: a talk you can see — the pip leans toward whoever it is for, and carries a bright grain when there is news in it */
  if(p.task==='chat'&&p.chatSd&&Math.hypot(p.tx-p.x,p.ty-p.y)<.2&&Math.sin(animT*2.3+p.off)>.25){const q=byName(p.chatW),ox=q&&q.x<p.x?-4:4;
    g.fillStyle='#e8e4da';g.fillRect(x+ox-1,y-11*k,3,2);g.fillRect(x+(ox>0?2:-2),y-9*k,1,1);
    if(p.heard){g.fillStyle='#f0b35a';g.fillRect(x+ox,y-10*k,1,1)}}
  /* and a song you can hear: three frames of note rising over each singer, in the colour of the song they know. Everyone at the fire who knows one
     sings it while the story is told; at work it is now and then, as it was */
  const sg=songs.length?songOf(p):null,sn=singNow&&animT>=singNow.a&&animT<singNow.end?singNow:null;
  /* A13: while a tune is sounding the note belongs to the beat you hear, not to a clock of its own: only who is singing right now shows one, and it
     rises through its three frames once per beat, a little higher for a higher degree. Outside a hearing nothing here changes. */
  const one=sn&&animT<sn.second,t0=one?sn.a:sn?sn.second:0,bt=sn?(animT-t0)/sn.beat:0;
  if(sn&&sg&&(one?p.name===sn.names[0]:sn.names.includes(p.name))){
    if(bt<0||bt>=sn.deg.length+1)return; /* before its first note and after its last has died away: not singing */
    const i=Math.min(sn.deg.length-1,Math.floor(bt)),fr=Math.min(2,(((bt-Math.floor(bt))*3)|0)),by=y-12*k-fr*2-(sn.deg[i]>4?1:0);g.fillStyle=noteCol(sg);
    g.fillRect(x+4,by,1,4);g.fillRect(x+3,by+3,2,1);g.fillRect(x+5,by,1,1);return}
  if(!sn&&sg&&((p.task==='gather'&&storyDay===dayCount)||((p.task==='chop'||p.task==='till'||p.task==='harvest'||p.task==='fish')&&Math.sin(animT*.7+p.off*3)>.94))){
    const ph=((animT*1.4+p.off)%1+1)%1,fr=Math.min(2,(ph*3)|0),by=y-12*k-fr*2;g.fillStyle=noteCol(sg);
    g.fillRect(x+4,by,1,4);g.fillRect(x+3,by+3,2,1);g.fillRect(x+5,by,1,1)}}
