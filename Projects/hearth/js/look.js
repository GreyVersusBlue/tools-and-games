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
  const m=lmG,c=skyAt(f,s,wx,snowD),k=flash;skyLum=Math.min(1,(.299*c[0]+.587*c[1]+.114*c[2])/255+k);
  m.globalCompositeOperation='source-over';
  m.fillStyle=`rgb(${Math.round(c[0]+(255-c[0])*k)},${Math.round(c[1]+(255-c[1])*k)},${Math.round(c[2]+(255-c[2])*k)})`;m.fillRect(0,0,W*T,H*T);
  const sp=lightSprites(),stamp=(kind,r,x,y,a)=>{m.globalAlpha=a;m.drawImage(sp[kind][r],Math.round(x-r),Math.round(y-r));m.globalAlpha=1};
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
