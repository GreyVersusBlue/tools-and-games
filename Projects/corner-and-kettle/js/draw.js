// draw.js — the pictures and the words for them. The customer sprite, the
// cup, the order's icon bubble and the customer's accessible name, each built
// as a string from the tables in content.js and the object handed in.
//
// A leaf over content.js and the sheet's atlas: it reads no `state`, calls no
// sim function and touches no DOM, so anything that draws a cup can import it
// without dragging the shop along.
//
// The cup and the food are frames of assets/sprites/cups.png, drawn by
// tools/blender/cups.py (WISHLIST.md B1 to B3). The atlas is a module so this
// file can import it in Node as well as in the page; the picture itself is an
// <image> inside the SVG string, so nothing here waits on it loading. ui.js
// loads SHEET_URL once at boot and says so if it cannot.

import { MILKS, SYRUPS, TOPPINGS, BASE_COLORS, RECIPES, FOODS } from "./content.js";
import { CUP_SHEET } from "../assets/sprites/cups.js";

export { CUP_SHEET };
export const SHEET_URL = new URL("../assets/sprites/cups.png", import.meta.url).href;

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

/** The speech bubble over a waiting customer: the recipe's icon and the cup
 *  they want, built from their order, or the plate they want. */
export function orderIconsHtml(order){
  if(order.isFood){
    return `<span class="bubbleArt">${foodSvg(order.foodId, 18)}</span>`;
  }
  const r = RECIPES.find(x=>x.id===order.recipeId);
  return `<span>${r.icon}</span><span class="bubbleArt">${cupSvg(orderCup(order), 22)}</span>`;
}

/** The cup an order asks for, as a cup object (newCup()'s shape in sim.js):
 *  what the bubble draws, so the picture is the ticket's requirements. */
export function orderCup(order){
  const r = RECIPES.find(x=>x.id===order.recipeId);
  const c = order.custom;
  return {
    base: r.base, shots: r.shots || 0,
    milk: c.milk || null, milkSteamed: !!c.milk && !c.ice && !r.blended,
    syrup: c.syrup || null, toppings: [...c.toppings],
    ice: !!c.ice, blended: !!r.blended,
  };
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

/* ---------- the sheet ---------- */

/** One frame of the sheet as an <svg> placed at (x, y), w x h in the parent's
 *  units: a window onto the whole sheet, cropped to the frame. */
function frameSvg(name, x, y, w, h){
  const f = CUP_SHEET.frames[name];
  if(!f) throw new Error(`cups.png has no frame "${name}"`);
  const { w: sw, h: sh } = CUP_SHEET.sheet;
  return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${f.x} ${f.y} ${f.w} ${f.h}" overflow="hidden">`
    + `<image href="${SHEET_URL}" width="${sw}" height="${sh}"/></svg>`;
}

// A tinted frame is drawn in white and greys; this multiplies it by a colour
// and keeps its own alpha. The id is the colour, so two cups of one colour
// share a definition and the page never holds two that disagree.
function tintDef(hex){
  const id = `ckTint${hex.slice(1)}`;
  return { id, def: `<filter id="${id}" color-interpolation-filters="sRGB"><feFlood flood-color="${hex}"/>`
    + `<feBlend in2="SourceGraphic" mode="multiply"/><feComposite in2="SourceGraphic" operator="in"/></filter>` };
}

/** A FOODS entry as its plate, `px` square. */
export function foodSvg(foodId, px){
  const f = FOODS.find(x=>x.id===foodId);
  const side = CUP_SHEET.sheet.food;
  return `<svg viewBox="0 0 ${side} ${side}" width="${px}" height="${px}" role="img" aria-label="${f.name}">`
    + frameSvg(`food_${foodId}`, 0, 0, side, side) + `</svg>`;
}

/* ---------- the cup ---------- */

// The toppings' frames, and the sauce a drizzle is tinted to: the old SVG's
// two strokes. tools/blender/spec.mjs TOPPING_FRAMES says the same, and
// smoke-sim checks the two agree.
export const TOPPING_FRAMES = {
  whip: { frame: 'whip' },
  cinnamon: { frame: 'cinnamon' },
  caramelDrizzle: { frame: 'drizzle', tint: '#c98a3a' },
  chocoDrizzle: { frame: 'drizzle', tint: '#4a2a1c' },
  sprinkles: { frame: 'sprinkles' },
};

/** The colour of a cup's liquid: its base, then its milk and its syrup mixed
 *  in, as the old SVG worked it out. An empty cup is the old pale fill. */
export function liquidColor(cup){
  let c = '#e9e2d3';
  if(cup.base) c = BASE_COLORS[cup.base] || '#5a3a24';
  if(cup.milk){
    const m = MILKS.find(x=>x.id===cup.milk);
    c = mixColor(c, m.color, cup.milkSteamed?0.45:0.35);
  }
  if(cup.syrup){
    const s = SYRUPS.find(x=>x.id===cup.syrup);
    c = mixColor(c, s.color, 0.18);
  }
  return c;
}

/** The frames a cup is drawn from, back to front, each {frame, tint, dy}:
 *  the layer order tools/blender/spec.mjs LAYERS renders them for. Something
 *  on the surface moves down by the sheet's low level when the cup is low. */
export function cupLayers(cup){
  const level = (cup.base || cup.milk) ? 'full' : 'low';
  const dy = CUP_SHEET.sheet.levels[level];
  const out = [{ frame: 'cup_back' }];
  if(cup.ice || cup.blended) out.push({ frame: 'straw' });
  out.push({ frame: `liquid_${level}`, tint: liquidColor(cup) });
  if(cup.ice && !cup.blended) out.push({ frame: 'ice', dy });
  if(cup.milk && cup.milkSteamed && !cup.ice) out.push({ frame: 'foam', dy });
  for(const id of ['cinnamon', 'caramelDrizzle', 'chocoDrizzle', 'sprinkles', 'whip']){
    if(cup.toppings.includes(id)) out.push({ ...TOPPING_FRAMES[id], dy });
  }
  out.push({ frame: 'cup_front' });
  return out;
}

/** A cup object (see newCup() in sim.js) as the SVG a station shows, 130 px
 *  tall, or `px` tall in a bubble. A hot drink steams at station size. */
export function cupSvg(cup, px){
  const { w, h } = CUP_SHEET.sheet.view;
  const tall = px || h;
  const defs = [];
  let body = '';
  for(const l of cupLayers(cup)){
    let art = frameSvg(l.frame, 0, l.dy || 0, w, h);
    if(l.tint){
      const t = tintDef(l.tint);
      if(!defs.includes(t.def)) defs.push(t.def);
      art = `<g filter="url(#${t.id})">${art}</g>`;
    }
    body += art;
  }
  let steam = '';
  if(!px && cup.base && !cup.ice && !cup.blended){
    steam = `<g class="steamg" opacity="0.5">
      <path d="M40 30 q-6 -10 0 -18 q6 -8 0 -16" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M58 30 q6 -10 0 -18 q-6 -8 0 -16" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>
    </g>`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" width="${Math.round(tall * w / h)}" height="${tall}" aria-hidden="true">`
    + (defs.length ? `<defs>${defs.join('')}</defs>` : '') + steam + body + `</svg>`;
}

function mixColor(c1, c2, amt){
  const a = hexToRgb(c1), b = hexToRgb(c2);
  if(!a||!b) return c1;
  const r = Math.round(a.r + (b.r-a.r)*amt);
  const g = Math.round(a.g + (b.g-a.g)*amt);
  const bl = Math.round(a.b + (b.b-a.b)*amt);
  return '#' + [r, g, bl].map(v=>v.toString(16).padStart(2,'0')).join('');
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
