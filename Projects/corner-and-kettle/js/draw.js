// draw.js — the pictures and the words for them. The customer sprite, the
// cup, the order's icon bubble and the customer's accessible name, each built
// as a string from the tables in content.js and the object handed in.
//
// A leaf over content.js: it reads no `state`, calls no sim function and
// touches no DOM, so anything that draws a cup can import it without dragging
// the shop along.

import { MILKS, SYRUPS, TOPPINGS, BASE_COLORS, RECIPES, FOODS } from "./content.js";

/* ---------- the pixel customer ---------- */
// 10 cols x 14 rows grid. h=hair s=skin S=shirt p=pants b=shoe e=eye .=empty
const SPRITE_PATTERN = [
"..hhhhhh..",
".hhhhhhhh.",
".hssssssh.",
".hs.ee.sh.",
".hssssssh.",
"..ssssss..",
"..SSSSSS..",
".SSSSSSSS.",
".SSSSSSSS.",
".SSSSSSSS.",
"..pppppp..",
"..pppppp..",
"..pp..pp..",
"..bb..bb..",
];

/** A customer's look ({hair, skin, shirt, pants}, picked by the sim) as an SVG string. */
export function makeSpriteSvg(sprite, px){
  const { hair, skin, shirt, pants } = sprite;
  const size = px || 6;
  let rects = '';
  for(let r=0;r<SPRITE_PATTERN.length;r++){
    const row = SPRITE_PATTERN[r];
    for(let c=0;c<row.length;c++){
      const ch = row[c];
      if(ch==='.') continue;
      let color;
      if(ch==='h') color=hair;
      else if(ch==='s') color=skin;
      else if(ch==='e') color='#2a1a10';
      else if(ch==='S') color=shirt;
      else if(ch==='p') color=pants;
      else if(ch==='b') color='#1c1208';
      rects += `<rect x="${c*size}" y="${r*size}" width="${size}" height="${size}" fill="${color}"/>`;
    }
  }
  const w = 10*size, h = SPRITE_PATTERN.length*size;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="image-rendering:pixelated;">${rects}</svg>`;
}

/* ---------- the order, as icons and as words ---------- */

/** The speech bubble over a waiting customer. */
export function orderIconsHtml(order){
  if(order.isFood){
    const f = FOODS.find(x=>x.id===order.foodId);
    return `<span>${f.icon}</span>`;
  }
  const r = RECIPES.find(x=>x.id===order.recipeId);
  let s = `<span>${r.icon}</span>`;
  if(order.custom.milk){
    const m = MILKS.find(x=>x.id===order.custom.milk);
    s += `<span title="${m.name}">🥛</span>`;
  }
  if(order.custom.syrup){
    s += `<span title="syrup">💧</span>`;
  }
  order.custom.toppings.forEach(()=> s += `<span>✨</span>`);
  if(order.custom.ice) s += `<span>🧊</span>`;
  return s;
}

// Taking an order off the queue is the game's core verb, and it used to be a
// click on a bare <div> with no role and no tab stop — so the one thing a
// player has to do most was the one thing a keyboard could not do. Each
// customer is a real button now, named with what they actually want, because
// "customer" repeated five times is not a queue you can read out loud.
export function customerLabel(c){
  const what = c.isFood
    ? FOODS.find(f=>f.id===c.foodId).name
    : (()=>{
        const r = RECIPES.find(x=>x.id===c.recipeId);
        const bits = [r.name];
        if(c.custom.milk) bits.push(MILKS.find(m=>m.id===c.custom.milk).name);
        if(c.custom.syrup) bits.push(SYRUPS.find(s=>s.id===c.custom.syrup).name+' syrup');
        c.custom.toppings.forEach(t=> bits.push(TOPPINGS.find(x=>x.id===t).name));
        if(c.custom.ice) bits.push('iced');
        return bits.join(', ');
      })();
  const who = c.isRegular ? `${c.regularName} (regular)` : 'Customer';
  const patience = Math.round((c.patience/c.patienceMax)*100);
  return `${who} waiting for ${what}. ${patience}% patience left. Take this order.`;
}

/** A regular's mood, off their satisfaction (0-100) — a queue-card readout, not a rule (#349). */
export function regularMoodEmoji(satisfaction){
  if(satisfaction>=80) return '😄';
  if(satisfaction>=50) return '🙂';
  if(satisfaction>=25) return '😐';
  return '😠';
}

/** The ticket: the order's name over its requirement lines, struck through when done. */
export function orderDescriptionHtml(order, reqs, slot){
  const title = order.isFood ? FOODS.find(x=>x.id===order.foodId).name : RECIPES.find(x=>x.id===order.recipeId).name;
  const items = reqs.map(req=>{
    const done = slot ? req.check(slot) : false;
    return `<li class="${done?'done':''}">${req.label}</li>`;
  }).join('');
  return `<b>${title}</b><ul class="want">${items}</ul>`;
}

/* ---------- the cup ---------- */

/** A cup object (see newCup() in sim.js) as the SVG a station shows. */
export function cupSvg(cup){
  const w=100,h=130;
  let liquidColor = '#e9e2d3';
  if(cup.base){
    liquidColor = BASE_COLORS[cup.base] || '#5a3a24';
  }
  if(cup.milk){
    const m = MILKS.find(x=>x.id===cup.milk);
    liquidColor = mixColor(liquidColor, m.color, cup.milkSteamed?0.45:0.35);
  }
  if(cup.syrup){
    const s = SYRUPS.find(x=>x.id===cup.syrup);
    liquidColor = mixColor(liquidColor, s.color, 0.18);
  }
  let fillLevel = cup.base ? 92 : (cup.milk? 92: 20);
  const liquidHeight = (fillLevel/100) * 82;
  const liquidY = 112 - liquidHeight;

  let foam = '';
  if(cup.milk && cup.milkSteamed && !cup.ice){
    foam = `<ellipse cx="50" cy="${liquidY}" rx="34" ry="7" fill="#fffdf6" opacity="0.95"/>`;
  }
  let ice = '';
  if(cup.ice || cup.blended){
    let cubes='';
    const n = cup.blended? 0 : 4;
    for(let i=0;i<n;i++){
      const cx = 30+i*12+randSeed(i)*4;
      const cy = liquidY+10+ (i%2)*14;
      cubes += `<rect x="${cx}" y="${cy}" width="10" height="10" rx="2" fill="#dff2f5" opacity="0.55" stroke="#bfe0e6" stroke-width="1"/>`;
    }
    ice = cubes;
  }
  let whip = '';
  if(cup.toppings.includes('whip')){
    whip = `<path d="M28 ${liquidY-2} q6 -14 12 -2 q6 -14 12 0 q6 -14 12 -2 q4 -10 8 0 l0 10 l-44 0 z" fill="#fffdf8" stroke="#eee0c8" stroke-width="1"/>`;
  }
  let drizzle = '';
  if(cup.toppings.includes('caramelDrizzle')){
    drizzle += `<path d="M20 ${liquidY-4} q15 8 10 16 M35 ${liquidY-8} q15 10 8 20 M55 ${liquidY-4} q15 8 8 18" stroke="#c98a3a" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  }
  if(cup.toppings.includes('chocoDrizzle')){
    drizzle += `<path d="M25 ${liquidY-6} q12 10 4 18 M45 ${liquidY-10} q12 10 4 20 M60 ${liquidY-6} q10 8 4 16" stroke="#4a2a1c" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  }
  let cinnamon='';
  if(cup.toppings.includes('cinnamon')){
    cinnamon = `<g opacity="0.7">
      <circle cx="35" cy="${liquidY-1}" r="1.4" fill="#a5652b"/>
      <circle cx="45" cy="${liquidY+1}" r="1.4" fill="#a5652b"/>
      <circle cx="55" cy="${liquidY-2}" r="1.4" fill="#a5652b"/>
      <circle cx="40" cy="${liquidY+3}" r="1.2" fill="#a5652b"/>
      <circle cx="60" cy="${liquidY+2}" r="1.2" fill="#a5652b"/>
    </g>`;
  }
  let sprinkles='';
  if(cup.toppings.includes('sprinkles')){
    const cols=['#e15b64','#f8b400','#4bc0c8','#845ec2'];
    for(let i=0;i<8;i++){
      sprinkles += `<rect x="${25+i*6}" y="${liquidY-3-((i%3)*2)}" width="3" height="1.5" fill="${cols[i%cols.length]}" transform="rotate(${i*20} ${25+i*6} ${liquidY-3})"/>`;
    }
  }
  let straw='';
  if(cup.ice || cup.blended){
    straw = `<rect x="66" y="6" width="6" height="60" rx="2" fill="#ff6b81"/><rect x="66" y="6" width="6" height="8" rx="2" fill="#e34d63"/>`;
  }
  let steam='';
  if(cup.base && !cup.ice && !cup.blended){
    steam = `<g class="steamg" opacity="0.5">
      <path d="M40 30 q-6 -10 0 -18 q6 -8 0 -16" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M58 30 q6 -10 0 -18 q-6 -8 0 -16" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>
    </g>`;
  }

  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    ${steam}
    <path d="M22 40 L28 116 Q50 124 72 116 L78 40 Z" fill="#fff" stroke="#3B2418" stroke-width="2.5"/>
    <clipPath id="cupclip"><path d="M22 40 L28 116 Q50 124 72 116 L78 40 Z"/></clipPath>
    <g clip-path="url(#cupclip)">
      <rect x="18" y="${liquidY}" width="64" height="60" fill="${liquidColor}"/>
      ${ice}
      ${foam}
      ${cinnamon}
      ${drizzle}
      ${sprinkles}
      ${whip}
    </g>
    <path d="M22 40 L28 116 Q50 124 72 116 L78 40 Z" fill="none" stroke="#3B2418" stroke-width="2.5"/>
    <ellipse cx="50" cy="40" rx="28" ry="6" fill="none" stroke="#3B2418" stroke-width="2"/>
    <path d="M78 48 q16 2 14 20 q-2 16 -16 16" fill="none" stroke="#3B2418" stroke-width="3"/>
    ${straw}
  </svg>`;
}

// Not a random number: a fixed jitter per ice cube, so the same cup draws the
// same way every frame.
function randSeed(i){ return ((i*137)%7)/7; }

function mixColor(c1, c2, amt){
  const a = hexToRgb(c1), b = hexToRgb(c2);
  if(!a||!b) return c1;
  const r = Math.round(a.r + (b.r-a.r)*amt);
  const g = Math.round(a.g + (b.g-a.g)*amt);
  const bl = Math.round(a.b + (b.b-a.b)*amt);
  return `rgb(${r},${g},${bl})`;
}

function hexToRgb(hex){
  if(hex.startsWith('rgb')){
    const m = hex.match(/\d+/g).map(Number);
    return {r:m[0],g:m[1],b:m[2]};
  }
  const h = hex.replace('#','');
  const bigint = parseInt(h.length===3? h.split('').map(c=>c+c).join(''):h,16);
  return {r:(bigint>>16)&255, g:(bigint>>8)&255, b:bigint&255};
}
