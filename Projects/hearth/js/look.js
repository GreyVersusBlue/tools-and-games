// Hearth — the look: sky, light, shadow and weather, drawn and never simulated.
// Classic scripts sharing one global scope; the load order in index.html is the old single file’s order and it matters.
/* A2: the hour is a colour. The scene is multiplied by one colour that depends on the hour, the season and the weather (skyAt), and the
   lights are stamped into that colour first, so a lit window shows the true colour of what is round it. Nothing here calls R() or writes
   anything the simulation reads: it reads state, and assigns only its own variables and underscore fields. */
const SKYH=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
/* name, what the hour is counted from (0 sunrise edge, 1 sunset edge, 2 the day itself), offset in day fractions, multiply colour */
const SKY=[['night0',0,-.06,'#34406e'],['first',0,-.04,'#5a5f8a'],['dawn',0,.02,'#f0b292'],['morning',0,.10,'#fff0dc'],['noon',2,.5,'#ffffff'],
  ['afternoon',1,-.16,'#fff3d6'],['golden',1,-.06,'#ffc98a'],['dusk',1,-.005,'#d98a7a'],['blue',1,.04,'#5c6296'],['night1',1,.06,'#34406e']];
const SKYC=SKY.map(r=>SKYH(r[3])),SKYSNOW=SKYH('#46548a'),SKYTINT={winter:SKYH('#f4f8ff'),summer:SKYH('#fffaf0')};
const SKYWX={overcast:[.35,.92],fog:[.35,.92],rain:[0,.84],thunder:[0,.72],snow:[0,.95]};
/* the colour to multiply the world by: f is dayFrac(), season a name, wx a weather, snowLying the depth of snow (0 to 1). Pure. */
function skyAt(f,season,wx,snowLying){
  const e=EDGE[season],sn=Math.max(0,Math.min(1,snowLying/.5));
  const col=i=>(i===0||i===SKY.length-1)&&sn>0?SKYC[i].map((v,k)=>v+(SKYSNOW[k]-v)*sn):SKYC[i];
  const at=i=>{const r=SKY[i];return(r[1]===0?e[0]:r[1]===1?e[1]:0)+r[2]};
  let c;
  if(f<=at(0))c=col(0);else if(f>=at(SKY.length-1))c=col(SKY.length-1);
  else{let i=0;while(f>at(i+1))i++;const a=at(i),b=at(i+1),t=(f-a)/(b-a),c0=col(i),c1=col(i+1);c=[0,1,2].map(k=>c0[k]+(c1[k]-c0[k])*t)}
  const tn=SKYTINT[season];if(tn)c=c.map((v,k)=>v*tn[k]/255);
  const w=SKYWX[wx];if(w){const y=.299*c[0]+.587*c[1]+.114*c[2];c=c.map(v=>(v+(y-v)*w[0])*w[1])}
  return c.map(v=>Math.max(0,Math.min(255,Math.round(v))))}
/* when each of the three warm lights is lit, in the pre-rendered falloff sprites: built the first time they are wanted, never in a frame */
const LSPR={win:'#ffd69a',fire:'#ffb45a',lamp:'#fff2b0'},LRAD=[8,18,28,46];let lightSp=null,lmCv=null,lmG=null,litHouses=new Set(),skyLum=1;
function lightSprites(){
  if(lightSp)return lightSp;lightSp={};
  for(const k in LSPR){const c3=SKYH(LSPR[k]);lightSp[k]={};
    for(const r of LRAD){const cv2=document.createElement('canvas');cv2.width=cv2.height=r*2;const cx=cv2.getContext('2d'),im=cx.createImageData(r*2,r*2),d=im.data;
      for(let y=0;y<r*2;y++)for(let x=0;x<r*2;x++){const dd=Math.hypot(x+.5-r,y+.5-r)/r,a=dd>=1?0:Math.pow(1-dd,1.7),i=(y*r*2+x)*4;d[i]=c3[0];d[i+1]=c3[1];d[i+2]=c3[2];d[i+3]=Math.round(a*255)}
      cx.putImageData(im,0,0);lightSp[k][r]=cv2}}
  return lightSp}
/* A house is lit when the light is low, one of its own is home (asleep or within 2 tiles) and its own lights-out has not come, and again from
   a little before first light; or when somebody is sheltering in it. The lights-out is a fixed function of the house's index. */
function houseLights(L,f,e){
  const out=new Set();if(L>=.5&&!people.some(p=>p.inside&&p.shelterH))return out;
  houses.forEach((h,i)=>{
    if(people.some(p=>p.inside&&p.shelterH===h)){out.add(h);return}
    if(L>=.5)return;
    const lo=e[1]+.04+.12*((i*.618034)%1),evening=f>e[1]*.5&&f<lo,morning=f<.5&&f>=e[0]-.05;
    if(!evening&&!morning)return;
    if(people.some(p=>!p.dead&&p.home===h&&(p.task==='sleep'||Math.hypot(p.x-(h.x+1),p.y-(h.y+2))<2)))out.add(h)});
  return out}
/* the light map: the hour's colour over a canvas the size of the world, the lights stamped on with lighter. Returns the canvas. */
function lightMap(L,f,e,s){
  if(!lmCv){lmCv=document.createElement('canvas');lmCv.width=W*T;lmCv.height=H*T;lmG=lmCv.getContext('2d')}
  const m=lmG,c=skyAt(f,s,wx,snowD),k=flash,fk=1+.5*Math.min(1,fogA),fd=Math.min(1,fogA)*.6; /* A7: fog takes the colour out of the map and swells every light */
  if(fd>0){const y=.299*c[0]+.587*c[1]+.114*c[2];for(let q=0;q<3;q++)c[q]=Math.round(c[q]+(y-c[q])*fd)}skyLum=Math.min(1,(.299*c[0]+.587*c[1]+.114*c[2])/255+k);
  m.globalCompositeOperation='source-over';
  m.fillStyle=`rgb(${Math.round(c[0]+(255-c[0])*k)},${Math.round(c[1]+(255-c[1])*k)},${Math.round(c[2]+(255-c[2])*k)})`;m.fillRect(0,0,W*T,H*T);
  const sp=lightSprites(),stamp=(kind,r,x,y,a)=>{m.globalAlpha=a;m.drawImage(sp[kind][r],Math.round(x-r*fk),Math.round(y-r*fk),Math.round(r*2*fk),Math.round(r*2*fk));m.globalAlpha=1};
  m.globalCompositeOperation='lighter';
  const dark=1-L;
  if(L<.7)stamp('fire',46,center.x*T,center.y*T-2,Math.min(1,(.7-L)/.4));
  for(const h of litHouses)stamp('win',18,h.x*T+8,h.y*T+11.5,1);
  const hall=getB('hall');
  if(hall&&L<.5&&(storyDay===dayCount||people.some(p=>p.task==='abed'&&p.abedH)))stamp('win',28,hall.x*T+8,hall.y*T+10,1);
  const lh=getB('light');
  if(lh&&dark>.35){const lx=lh.x*T+4,ly=lh.y*T-13,a=animT*.9,al=(dark-.35)*.5*(wx==='fog'?1.6:1);stamp('lamp',18,lx,ly,Math.min(1,(dark-.35)*3));
    m.fillStyle=`rgba(255,242,176,${al})`;for(const off of [0,Math.PI]){m.beginPath();m.moveTo(lx,ly);m.arc(lx,ly,120,a+off-.13,a+off+.13);m.closePath();m.fill()}}
  if(farIsle&&farIsle.lit&&fogA<.6&&dark>.3&&(animT*2.3|0)%9!==0)stamp('lamp',8,(farIsle.x+farIsle.w*.6)*T,farIsle.h*1.7*1.5,Math.min(1,(dark-.3)*2));
  for(const fl of flies){const b=RM?.85:Math.sin(animT*2.6+fl.ph);if(b<.2)continue;m.fillStyle=`rgba(150,255,90,${Math.min(1,(b-.2)*1.1*Math.min(1,fl.l/6))})`;m.fillRect(Math.round(fl.x*T-1),Math.round(fl.y*T-3),3,3)}
  if(dark>.65&&speed<FAST)for(const p of people){if(p.dead||p.inside||p.task!=='gohome'&&p.task!=='nurse'&&p.task!=='visit'&&p.task!=='voyage')continue;stamp('fire',8,p.x*T,p.y*T-3,Math.min(1,(dark-.65)*4))}
  m.globalCompositeOperation='source-over';
  return lmCv}
/* A5: the sun casts shadows. sunAt reads the hour and the weather and answers where a shadow falls: dir is -1 in the morning (the sun is east, so the
   shadow goes west) and +1 in the evening, easing through 0 across the few minutes round noon so nothing jumps; len is the shadow as a multiple of the
   height of what casts it, .4 at noon up to 3 at the edges; str is how dark, 0 at night and in any weather but clear, .28 in clear light. Pure. */
function sunAt(f,season,wx){
  const e=EDGE[season],u=(f-e[0])/(e[1]-e[0]);
  if(u<=0||u>=1)return{dir:0,len:0,str:0};
  const s=2*u-1,a=Math.abs(s),dir=Math.max(-1,Math.min(1,s/.06)),len=Math.min(3,.4+2.6*a*a),fade=Math.min(1,Math.min(u,1-u)/.06);
  return{dir,len,str:wx==='clear'?.28*fade:0}}
/* shadows: the things that do not move go on a world-sized canvas once per change of sun (black, opaque, so two shadows that overlap are not twice as
   dark) and it is laid over the ground at the sun's strength; people, who move, are three-by-one marks put straight on the picture. */
let shCv=null,shG=null,shKey='';const SILS={};
function silhouette(name){
  if(SILS[name])return SILS[name];const f=BSHEET.frames[name],cv2=document.createElement('canvas');cv2.width=f.w;cv2.height=f.h;
  const c=cv2.getContext('2d');c.drawImage(BIMG,f.x,f.y,f.w,f.h,0,0,f.w,f.h);c.globalCompositeOperation='source-in';c.fillStyle='#000';c.fillRect(0,0,f.w,f.h);
  let top=0;try{const d=c.getImageData(0,0,f.w,f.h).data;top=f.h;for(let i=3;i<d.length;i+=4)if(d[i]>0){top=Math.floor(i/4/f.w);break}}catch(e){top=0} /* the first row with anything in it: the height a shadow is measured from */
  cv2.top=top;return SILS[name]=cv2}
const SHADOW_FRAME={hut:'hut',well:'well',market:'market',mill:'mill',smoke:'smoke',hall:'hall',light:'light'};
function drawShadows(){
  if(typeof lookQ!=='undefined'&&lookQ<2)return;
  const sun=sunAt(dayFrac(),sea(),wx);if(sun.str<=.005)return;
  const dq=Math.round(sun.dir*sun.len*24)/24,off=dq,s=sea(),shrink=s==='autumn'&&seaDay()===4?.85:1;
  let ts=0;for(const t of trees)ts+=t.s*20+t.x*13+t.y*7;let hs=0;for(const h of houses)hs+=h.x*31+h.y*17;
  let nb=0;const bl=bAll();for(const b of bl)if(b.done)nb++;
  const key=`${dq}|${trees.length}|${Math.round(ts)}|${houses.length}|${hs}|${bl.length}|${nb}|${shrink}|${s==='winter'}`;
  if(!shCv){shCv=document.createElement('canvas');shCv.width=W*T;shCv.height=H*T;shG=shCv.getContext('2d')}
  if(key!==shKey){shKey=key;const m=shG;m.setTransform(1,0,0,1,0,0);m.clearRect(0,0,W*T,H*T);m.fillStyle='#000';
    /* a tree: an ellipse from the trunk out along the ground, as long as len times the tree is tall; a bare winter tree casts a thinner one */
    for(const t of trees){const r=T*.7*t.s*shrink,ls=Math.abs(off)*2.6*r,ry=Math.max(1.5,r*(s==='winter'?.28:.45));
      m.beginPath();m.ellipse(t.x*T+Math.sign(off)*ls/2,t.y*T+1,Math.max(ls/2,r*.5),ry,0,0,6.283);m.fill()}
    /* a building: its own frame's black copy, sheared along the ground and squashed to half its height, standing on the foot of its footprint */
    const C=-off,D=.5,cast=(name,x,y,fy,w)=>{const f=BSHEET.frames[name];if(!f)return;const sl=silhouette(name),hv=fy-(y-f.ay+sl.top),ls=Math.abs(off)*hv,dp=Math.min(8,Math.max(4,w*T*.5)),x1=x+w*T;
      m.setTransform(1,0,C,D,-C*fy,(1-D)*fy);m.drawImage(sl,x-f.ax,y-f.ay);m.setTransform(1,0,0,1,0,0);
      /* and the ground the building stands on, swept along the same way: the silhouette gives the roof, this gives the shadow its depth */
      if(ls>1){const e=off<0?x-ls:x1+ls,a=off<0?x1:x;m.beginPath();m.moveTo(a,fy-dp);m.lineTo(e,fy-dp*.85);m.lineTo(e,fy-dp*.15);m.lineTo(a,fy);m.fill()}};
    for(const h of houses)cast(roofFrame(h.r),h.x*T,h.y*T,h.y*T+2*T,2);
    for(const b of bl)if(b.done&&SHADOW_FRAME[b.kind])cast(SHADOW_FRAME[b.kind],b.x*T,b.y*T,(b.y+b.h)*T,b.w);
    m.setTransform(1,0,0,1,0,0)}
  g.globalAlpha=sun.str;g.drawImage(shCv,0,0);
  g.fillStyle='#000';for(const p of people){if(p.dead||p.inside||p.inBoat)continue;g.fillRect(Math.round(p.x*T+off*1.2)-1,Math.round(p.y*T),3,1)}
  g.globalAlpha=1}
/* A6: weather that lands. The rain is not only streaks over the picture: it rings the water, it darkens the ground and the ground keeps it a while, it
   shines in the road, and it picks out the top edge of every roof. Everything here is a function of animT, the weather and a local mulberry, so it stands
   still when the game is paused and never touches R(). wetA is how wet the land looks, 0 to 1: 20 seconds of animT to wet, 90 to dry. */
let wetA=0,wetLast=-1,wetCv=null,wetKey=null,puddles=[],puddleKey='';const WETC='#a4adbc',ROOFPTS={};
function wetStep(){
  const dt=wetLast<0?0:Math.max(0,Math.min(200,animT-wetLast));wetLast=animT;
  wetA=rain?Math.min(1,wetA+dt/20):Math.max(0,wetA-dt/90)}
/* the land, multiplied by the wet colour: one world-sized mask of every tile that is not water, built when the island changes */
function drawWet(){
  wetStep();
  if(wetA>.004){
    if(wetKey!==tiles){wetKey=tiles;if(!wetCv){wetCv=document.createElement('canvas');wetCv.width=W*T;wetCv.height=H*T}
      const m=wetCv.getContext('2d');m.clearRect(0,0,W*T,H*T);m.fillStyle=WETC;
      for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(tiles[idx(x,y)]!==WATER)m.fillRect(x*T,y*T,T,T)}
    g.globalCompositeOperation='multiply';g.globalAlpha=wetA;g.drawImage(wetCv,0,0);g.globalAlpha=1;g.globalCompositeOperation='source-over';
    /* puddles: thirty road tiles, fixed for the island, each with a pale glint that comes and goes */
    const pk=seed+'|'+roadV;
    if(puddleKey!==pk){puddleKey=pk;puddles=[];const rd=[];for(let i=0;i<W*H;i++)if(road[i]===1)rd.push(i);
      const r=mulberry(seed^0x5ad1e);for(let i=rd.length-1;i>0;i--){const j=(r()*(i+1))|0,t=rd[i];rd[i]=rd[j];rd[j]=t}
      for(const i of rd.slice(0,30))puddles.push({x:(i%W)*T+((r()*4)|0),y:((i/W)|0)*T+1+((r()*5)|0),ph:r()*6.283})}
    if(wetA>.25)for(const p of puddles){const a=wetA*(.3+.3*Math.sin(animT*1.6+p.ph));g.fillStyle=`rgba(214,230,250,${a.toFixed(2)})`;g.fillRect(p.x,p.y,3,1);g.fillRect(p.x+1,p.y+1,2,1)}}
  if(rain)drawSplashes()}
/* rings on open water, only in view: up to sixty (forty in plain rain, half that under reduced motion) from a stream that is reseeded every quarter second,
   each growing through three frames, 2 then 3 then 4 px, in that quarter second */
function drawSplashes(){
  const vk=vScale(),vw=cv.width/vk,vh=cv.height/vk,x0=Math.max(0,camX*T-vw/2),y0=Math.max(0,camY*T-vh/2),x1=Math.min(W*T-1,x0+vw),y1=Math.min(H*T-1,y0+vh);
  const win=Math.floor(animT*4),fr=Math.min(2,Math.floor((animT*4-win)*3)),n=Math.round((storm?60:40)*(RM?.5:1)),r=mulberry(win*2654435761+seed);
  const w=4+fr,h=(fr+2>>1)+1;g.fillStyle='#e6f2ff';
  for(let i=0;i<n;i++){const x=Math.floor(x0+r()*(x1-x0)),y=Math.floor(y0+r()*(y1-y0));
    if(at((x/T)|0,(y/T)|0)!==WATER||at(((x+w)/T)|0,((y+h)/T)|0)!==WATER)continue;
    g.fillRect(x,y,w,1);g.fillRect(x,y+h,w,1);g.fillRect(x-1,y+1,1,h-1);g.fillRect(x+w,y+1,1,h-1)}}
/* the streaks, slanted by the wind table (3 px in rain, 5 in a storm, a storm's gusts leaning them a pixel more or less), and in a storm four pale lines
   that cross the water from east to west, as the wind goes */
function drawRain(wind){
  const dx=Math.round(wind*2)+(storm?Math.round(Math.sin(animT*.7)):0),ln=storm?8:6;
  g.strokeStyle=storm?'rgba(200,220,255,.5)':'rgba(200,220,255,.35)';g.beginPath();const n=(storm?300:180)*(RM?.5:1);
  for(let i=0;i<n;i++){const x=(i*97+((animT*300)|0)*(i%3+1))%(W*T),y=(i*61+((animT*400)|0))%(H*T);g.moveTo(x,y);g.lineTo(x-dx,y+ln)}g.stroke();
  if(storm){const span=W*T+160,k=RM?3:4,win=Math.floor(animT/8);g.fillStyle='rgba(220,232,244,.5)';
    for(let i=0;i<k;i++){const r=mulberry(win*7919+i*104729+seed),y=Math.floor(r()*(H*T-8)),x=(((r()*span-animT*170)%span)+span)%span-80;
      for(let j=0;j<8;j++){const sx=Math.floor(x+j*2);if(sx<0||sx>=W*T)continue;if(at((sx/T)|0,(y/T)|0)===WATER)g.fillRect(sx,y,2,1)}}}}
/* the top edge of a roof: the first opaque pixel in each column of the frame, found once per frame name */
function roofEdge(name){
  if(ROOFPTS[name])return ROOFPTS[name];const sl=silhouette(name),pts=[];
  try{const d=sl.getContext('2d').getImageData(0,0,sl.width,sl.height).data;
    for(let i=0;i<sl.width;i++)for(let j=0;j<sl.height;j++)if(d[(j*sl.width+i)*4+3]>0){pts.push([i,j]);break}}catch(e){}
  return ROOFPTS[name]=pts}
function drawRoofWet(){
  if(wetA<.02||typeof BSHEET==='undefined')return;
  g.fillStyle=`rgba(234,243,255,${(.65*wetA).toFixed(2)})`;
  for(const h of houses){const name=roofFrame(h.r),f=BSHEET.frames[name];if(!f)continue;const ox=h.x*T-f.ax,oy=h.y*T-f.ay;for(const p of roofEdge(name))g.fillRect(ox+p[0],oy+p[1],1,1)}}
/* A7: weather that lands, the cold half. Fog has depth (look.js: the light map loses colour and its lights swell; render.js: a ring of fog that is thickest at the
   edge of the view), snow falls in two depths and leans with the wind, a thinning roof of snow sheds a few pixels at its south eave, every house with somebody home
   sends up a column of smoke in the cold, and people working out of doors breathe. Presentation only: animT, the weather and a local mulberry. The old
   smoke in the fx list is still made by the simulation (it spends the stream) and is simply not drawn any more, so the picture has one smoke. */
/* switches for the picture's own parts, so a check can take one away and see what it was: only the test reads or sets them */
const lookOff={smoke:false,shed:false};
const WINDK={clear:.7,overcast:1,rain:1.3,thunder:2.4,fog:.4,snow:.9},SMOKEC={day:'#cfc8be',night:'#6a6f8e'},WORKT=['chop','harvest','till','build','fish','water','carry'];
/* is somebody home: sheltering in the house, or one of its own asleep or within two tiles of its door (the rule the windows use). Reads, never writes. */
function houseOccupied(h){return people.some(p=>!p.dead&&(p.inside&&p.shelterH===h||p.home===h&&(p.task==='sleep'||Math.hypot(p.x-(h.x+1),p.y-(h.y+2))<2)))}
/* one column of smoke from (x,y): n puffs on a slow cycle, each rising as it ages. In still air it is tall and thin and goes straight up; the wind bends it, and in a storm it is
   short, wide and torn sideways. Pixels in the world's space, after the hour's colour so the smoke keeps its own. */
function smokeColumn(x,y,n,k,col,wk,dir){
  const storm2=wk>=2,rise=storm2?11:wk>=1.3?15:24,lean=wk*(storm2?9:5);
  g.fillStyle=col;
  for(let i=0;i<n;i++){const t=(animT*.3+i/n+k)%1,sw=Math.round(Math.sin(animT*.8+i*1.9+k*9)*(.4+wk*.5)),sz=t>(storm2?.3:.7)?2:1;
    g.globalAlpha=.9*(1-t*.75);g.fillRect(Math.round(x+dir*t*t*lean+sw),Math.round(y-t*rise),sz,sz)}
  g.globalAlpha=1}
function drawSmoke(L,s){
  if(speed>=FAST||lookOff.smoke)return;
  const wk=WINDK[wx]||1,dir=wind<0?-1:1,dark=L<.5,col=dark?SMOKEC.night:SMOKEC.day,n0=RM?5:8;
  if(s==='winter'||dark&&s!=='summer')houses.forEach((h,i)=>{if(houseOccupied(h))smokeColumn(h.x*T+12,h.y*T+1,5+((i*3+h.x)%4)*(n0-5)/3|0,i*.37,col,wk,dir)});
  const sm=getB('smoke');if(sm&&sm.done)smokeColumn(sm.x*T+13,sm.y*T+1,n0-1,.5,col,wk,dir);
  if(s==='winter'){g.fillStyle='#e8eef4';for(const p of people){if(p.dead||p.inside||p.inBoat||!WORKT.includes(p.task))continue;
    const b=Math.sin(animT*2.2+(p.seed%7));if(b<.1)continue;const f=p.tgt&&p.tgt.x<p.x?-1:1;g.globalAlpha=Math.min(.7,b);g.fillRect(Math.round(p.x*T+f*3),Math.round(p.y*T-7),1,1)}g.globalAlpha=1}}
/* two depths of flake: the far ones small, slow and dim, the near ones larger, quick and bright, both carried sideways by the wind */
function drawSnowfall(wk){
  const dir=wind<0?-1:1,far=RM?40:90,near=RM?30:60,sw=dir*wk*14,WT=W*T,HT=H*T;
  g.fillStyle='rgba(255,255,255,.5)';for(let i=0;i<far;i++){const x=((i*97+animT*(8+sw*.4)+Math.sin(animT*.5+i)*3)%WT+WT)%WT,y=(i*61+animT*16)%HT;g.fillRect(Math.floor(x),Math.floor(y),1,1)}
  g.fillStyle='rgba(255,255,255,.92)';for(let i=0;i<near;i++){const x=((i*131+500+animT*(18+sw)+Math.sin(animT*.8+i)*5)%WT+WT)%WT,y=(i*83+animT*44)%HT;g.fillRect(Math.floor(x),Math.floor(y),2,2)}}
/* the south eave of the roof's snow cap: the lowest opaque pixel in each column of the cap's own frame, once per frame name */
const EAVEPTS={};
function eavePts(name){
  if(EAVEPTS[name])return EAVEPTS[name];const sl=silhouette(name),pts=[];
  try{const d=sl.getContext('2d').getImageData(0,0,sl.width,sl.height).data;
    for(let i=0;i<sl.width;i++)for(let j=sl.height-1;j>=0;j--)if(d[(j*sl.width+i)*4+3]>0){pts.push([i,j]);break}}catch(e){}
  return EAVEPTS[name]=pts}
/* while the snow is going (it is not snowing, it lies under .3 and there is some), six white pixels per roof slide off the south eave and drop three */
function snowSheds(){return !lookOff.shed&&wx!=='snow'&&snowD>.01&&snowD<.3&&typeof BSHEET!=='undefined'&&!!BSHEET.frames['house-snow']}
function drawRoofSlide(h,x,y){
  const f=BSHEET.frames['house-snow'],pts=eavePts('house-snow');if(!pts.length)return;
  const r=mulberry(h.x*131+h.y*7+seed),ox=x-f.ax,oy=y-f.ay;g.fillStyle='#f4f8ff';
  for(let i=0;i<6;i++){const p=pts[(r()*pts.length)|0],t=(animT*.6+i/6+r())%1;g.globalAlpha=1-t*.8;g.fillRect(ox+p[0],oy+p[1]+1+Math.floor(t*3),1,1)}
  g.globalAlpha=1}
/* fog's ring: a small sprite, transparent at the middle and grey at the corners, built once and stretched over the view */
let fogRad=null;
function fogRing(){
  if(fogRad)return fogRad;fogRad=document.createElement('canvas');fogRad.width=220;fogRad.height=140;const c=fogRad.getContext('2d'),gr=c.createRadialGradient(110,70,25,110,70,132);
  gr.addColorStop(0,'rgba(222,230,236,0)');gr.addColorStop(.55,'rgba(222,230,236,.25)');gr.addColorStop(1,'rgba(222,230,236,1)');c.fillStyle=gr;c.fillRect(0,0,220,140);return fogRad}
function drawFogRing(skyY){
  const vk=vScale(),vw=cv.width/vk,vh=cv.height/vk;g.globalAlpha=Math.min(1,fogA)*.7*skyY;
  g.drawImage(fogRing(),Math.round(camX*T-vw/2),Math.round(camY*T-vh/2),Math.round(vw),Math.round(vh));g.globalAlpha=1}
