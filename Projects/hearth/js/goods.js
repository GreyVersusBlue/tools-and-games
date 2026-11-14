// Hearth — goods: stock and carried things, drawn from the simulation’s state.
// Classic scripts sharing one global scope; the load order in index.html is the old single file’s order and it matters.
/* B1: stock you can point at. Wood, grain and fish are objects on the ground whose count is the number. Everything here reads the
   simulation and writes only its own variables below; no R(), no Math.random(), nothing the simulation reads. */
const STOCK_STEP=.4; /* one object arrives or leaves per 0.4 s of animT, so a harvest is seen arriving */
const LOG_ROWS=[7,6,5,4,2]; /* 24 logs, bottom row first */
let stockCnt={wood:0,sack:0,fish:0},stockK=0,stockSeed=-1,stockSim=0;
const stockWant=()=>({wood:Math.min(24,Math.ceil(Math.max(0,wood)/4)),sack:Math.min(16,Math.ceil(Math.max(0,granary)/25)),fish:Math.min(8,Math.ceil(Math.max(0,food)/20))});
/* a tile rectangle (x0,y0 up to x1,y1) is free when it is all land and clear of every house, building, plot and work. Reads at(), houses, bAll(), plots, works. */
function stockFree(x0,y0,x1,y1,skip){
  for(let ty=Math.floor(y0);ty<y1;ty++)for(let tx=Math.floor(x0);tx<x1;tx++){const t=at(tx,ty);if(t===WATER||t===ROCK)return false}
  const hit=(a0,b0,a1,b1)=>x0<a1&&x1>a0&&y0<b1&&y1>b0;
  for(const h of houses)if(hit(h.x-.5,h.y-.5,h.x+2.5,h.y+2.5))return false;
  for(const p of plots)if(hit(p.x-.5,p.y-.5,p.x+2.5,p.y+2.5))return false;
  for(const b of bAll())if(b!==skip&&hit(b.x-.5,b.y-1.5,b.x+b.w+.5,b.y+b.h+.5))return false;
  for(const w of works)if(hit(w.x-.5,w.y-1,w.x+1.9,w.y+1))return false;
  return true}
/* the side of the hearth away from the first house; east when there is none */
const stockSide=()=>{const h=houses[0];return h&&h.x>center.x?-1:1};
/* where each pile stands, in world pixels: x,y is the bottom-centre of its box, w and h the box. A pure function of center, the first
   house, the buildings and the works. A blocked spot is mirrored to the other side of the fire, then walked down the rows; if nothing is
   free the first choice stands with ok false. */
function stockSpots(){
  const sd=stockSide(),out={};
  const pick=(cands,w,h,skip)=>{for(const c of cands)if(stockFree(c[0]-w/2/T,c[1]-h/T,c[0]+w/2/T,c[1]+.4,skip))return{x:c[0]*T,y:c[1]*T,w,h,ok:true}
    const c=cands[0];return{x:c[0]*T,y:c[1]*T,w,h,ok:false}};
  const side=(dx,dy,w,h)=>{const c=[];for(const r of [0,1.8,3.6,5.4])for(const k of [0,1.4,-1.4,2.8,-2.8,4.2,-4.2])for(const s of [sd,-sd])c.push([center.x+s*(dx+Math.sign(dx)*r),center.y+dy+k]);return pick(c,w,h)};
  out.wood=side(3.6,1.2,28,10);
  const hall=getB('hall');
  if(hall){const sx=hall.x+hall.w/2,sy=hall.y+hall.h+.55;out.sack=pick([[sx,sy],[sx,sy+1.2],[hall.x+hall.w+1.4,hall.y+hall.h],[hall.x-1.4,hall.y+hall.h]],24,6,hall)}
  else out.sack=side(-2.8,1.0,24,6);
  const racks=works.find(w=>w.wk==='racks'&&w.done),hut=getB('hut');
  if(racks)out.fish={x:Math.round(racks.x*T)+5,y:Math.round(racks.y*T),w:10,h:7,ok:true,on:'racks'};
  else if(hut){const c=[];for(const k of [.7,2.1,3.5,4.9])c.push([hut.x+hut.w+.9,hut.y+k],[hut.x-.9,hut.y+k]);out.fish=Object.assign(pick(c,12,8,hut),{on:'line'})}
  else out.fish=Object.assign(side(-2.4,-1.4,12,8),{on:'line'});
  return out}
/* ease the three counts toward what the numbers say, one object per tick of animT (a tick is 0.4 s); a new island, or sim time running
   backwards (a load), shows its stock at once. Whole ticks, so no sum of 0.4s drifts. */
function stockEase(){
  const want=stockWant(),k=Math.floor(animT/STOCK_STEP+1e-9);
  if(stockSeed!==seed||time<stockSim-.001){stockSeed=seed;stockCnt={wood:want.wood,sack:want.sack,fish:want.fish};stockK=k}
  stockSim=time;
  const n=k-stockK;stockK=k;
  if(n>0)for(const j of ['wood','sack','fish']){const c=stockCnt[j],w=want[j];stockCnt[j]=w>c?Math.min(w,c+n):Math.max(w,c-n)}
  return stockCnt}
function drawStock(ents,snow){
  const cnt=stockEase(),sp=stockSpots(),sr=mulberry(seed^0x57C4),tone=[];
  for(let i=0;i<24;i++)tone.push(sr()>.5); /* a tone for each log, from the seed alone */
  if(cnt.wood>0){const w=sp.wood;ents.push({y:w.y/T+.01,d:()=>{
    let left=cnt.wood,i=0;
    for(let r=0;r<LOG_ROWS.length&&left>0;r++){const cap=LOG_ROWS[r],n=Math.min(cap,left),y=Math.round(w.y)-2*(r+1),x0=Math.round(w.x-cap*2);
      for(let j=0;j<n;j++,i++){const x=x0+j*4;g.fillStyle=tone[i]?'#8a5a2e':'#94622f';g.fillRect(x+1,y,3,1);g.fillStyle='#6b4423';g.fillRect(x,y+1,4,1);g.fillStyle='#c8935a';g.fillRect(x,y,1,1)}
      left-=n;
      if(snow>0&&(left<=0||r===LOG_ROWS.length-1)){g.fillStyle='#eef2f4';g.fillRect(x0,y-1,n*4,1)}}}})}
  if(cnt.sack>0){const s=sp.sack;ents.push({y:s.y/T+.01,d:()=>{
    for(let i=0;i<cnt.sack;i++){const x=Math.round(s.x-12)+(i&7)*3,y=Math.round(s.y)-3*((i>>3)+1);
      g.fillStyle='#d6c79a';g.fillRect(x,y,3,3);g.fillStyle='#b3a273';g.fillRect(x,y+2,3,1);g.fillStyle='#8a7a52';g.fillRect(x+1,y,1,1)}}})}
  if(cnt.fish>0){const f=sp.fish;ents.push({y:f.y/T+.01,d:()=>{
    const x0=Math.round(f.x-f.w/2),y0=Math.round(f.y-f.h),rk=f.on==='racks';
    if(!rk){g.fillStyle='#6f4b32';g.fillRect(x0-1,y0,1,f.h);g.fillRect(x0+f.w,y0,1,f.h);g.fillStyle='#8a6a44';g.fillRect(x0,y0,f.w,1)}
    for(let i=0;i<cnt.fish;i++){const x=x0+1+Math.round(i*(f.w-2)/7),y=rk?y0+4+(i&1):y0+1;
      g.fillStyle='#c9d0c8';g.fillRect(x,y,1,3);g.fillStyle='#7d8c8a';g.fillRect(x,y+3,1,1)}}})}
}
