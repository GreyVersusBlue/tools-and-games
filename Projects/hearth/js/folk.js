// Hearth — the folk on the map: how people are drawn and told apart.
// Classic scripts sharing one global scope; the load order in index.html is the old single file’s order and it matters.
/* A8: people you can tell apart. The figure is still 3 px wide and 8 tall for an adult; what it gains is the portrait's own choices (faceSpec in
   render.js, one answer for the card and the map): skin, hair and its grey, the hat or headband, a beard pixel, a stride while walking, a side
   to face, a stick for the old and a dark rim on lying snow. Reads state and assigns only underscore fields (p._f); never calls R(). */
const HATCOL={proud:'#4c5f78',brave:'#8a3d2f',plain:'#6f4b32'};
function drawFolk(p){if(p.inside)return;
  const x=p.x*T,y=p.y*T+(p.inBoat?-1:0),busy=p.task==='chop'||p.task==='build'||p.task==='till'||p.task==='harvest',bob=busy?Math.sin(animT*12+p.off)*1.2:0;
  const k=isKid(p)?.55+ageOf(p)/31:1;
  if(p===selected){g.fillStyle='rgba(240,179,90,.55)';g.fillRect(x-4,y+1,9,1);g.fillRect(x-4,y-1,1,2);g.fillRect(x+4,y-1,1,2)}
  if(p.task==='sleep'){g.fillStyle=p.col;g.fillRect(x-2,y-2,5,3);return}
  const sp=faceSpec(p),sk=SKIN[sp.skin],el=isElder(p)?1:0,dx=p.tx-p.x,mv=Math.hypot(dx,p.ty-p.y)>.05;
  if(Math.abs(dx)>.02)p._f=dx>0?1:-1;const f=p._f||1;
  const top=y-8*k+el+bob,sh=y-5*k+el+bob; /* head top, shirt top: an elder is one pixel shorter */
  g.fillStyle='rgba(0,0,0,.25)';g.fillRect(x-2,y,5,1);
  if(snowD>.15){g.fillStyle='rgba(26,30,48,.6)';g.fillRect(x-2.5,top-1,5,y-top+1)} /* a rim behind and under, so a pale shirt does not vanish on snow */
  g.fillStyle=p.col;g.fillRect(x-1.5,sh,3,(4*k-el)-(mv?1:0));
  if(mv){g.fillStyle='#3a2a1a';if(Math.sin(animT*10+p.off)>0){g.fillRect(x-1.5,y-1*k,1,1);g.fillRect(x+.5,y-1*k,1,1)}else g.fillRect(x-.5,y-1*k,1,1)}
  g.fillStyle=sk[0];g.fillRect(x-1.5,top,3,3);g.fillStyle=sk[1];g.fillRect(x+.5*f-.5,top+2,1,1);
  g.fillStyle=sp.hair;g.fillRect(x-1.5,top,3,1);
  if(sp.hat){g.fillStyle=HATCOL[sp.hat];g.fillRect(x-1.5,top+(sp.hat==='brave'?1:0),3,1)}
  if(sp.beard){g.fillStyle=sp.hair;g.fillRect(x-.5,top+2,1,1)}
  if(el){g.fillStyle='#6f4b32';g.fillRect(f>0?x+1.5:x-2.5,y-3,1,3)}
  if(p.task==='chop'){g.fillStyle='#999';g.fillRect(x+2,y-7+bob*2,2,2)}
  if(p.task==='fish'){g.fillStyle='#e8dcc4';g.fillRect(x+2,y-6,1,7)}
  if(p.task==='wave'&&Math.hypot(p.tx-p.x,p.ty-p.y)<.05){g.fillStyle=sk[0];g.fillRect(x+2,y-9*k+Math.sin(animT*9+p.off)*1.5,1,3)}
  /* sprint 16: a talk you can see — the pip leans toward whoever it is for, and carries a bright grain when there is news in it */
  if(p.task==='chat'&&p.chatSd&&Math.hypot(p.tx-p.x,p.ty-p.y)<.2&&Math.sin(animT*2.3+p.off)>.25){const q=byName(p.chatW),ox=q&&q.x<p.x?-4:4;
    g.fillStyle='#e8e4da';g.fillRect(x+ox-1,y-11*k,3,2);g.fillRect(x+(ox>0?2:-2),y-9*k,1,1);
    if(p.heard){g.fillStyle='#f0b35a';g.fillRect(x+ox,y-10*k,1,1)}}
  /* and a song you can almost hear: note pips over the singers at a fire night, and now and then over the work */
  if(songs.length){const sings=(p.task==='gather'&&storyDay===dayCount&&Math.sin(animT*1.8+p.off)>.55)||
      ((p.task==='chop'||p.task==='till'||p.task==='harvest'||p.task==='fish')&&Math.sin(animT*.7+p.off*3)>.94);
    if(sings&&songs.some(sg=>!sg.lost&&sg.kn.includes(p.name))){g.fillStyle='#f0d488';g.fillRect(x+3,y-10*k,1,1);g.fillRect(x+4,y-12*k,1,2);g.fillRect(x+4,y-12*k,2,1)}}}
