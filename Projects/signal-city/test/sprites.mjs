// node test/sprites.mjs
//
// Checks the half of the car sprites that is arithmetic and bookkeeping: the
// archetype table, the palettes, the length and width ordering, and that every
// draw() actually lays down the paint, the gloss and the parts each archetype
// is supposed to have. Exits non-zero on any failure.
//
// Nothing here renders a pixel. The drawing calls go into a recording fake ctx
// that keeps every method call, every argument and every style assignment in
// order, so a claim like "the emergency light bar alternates" is answered by
// comparing two colour sequences rather than by looking at an image.
//
// WHAT THIS CANNOT SEE, so you still open sprites.html after touching this
// file: whether any of it looks like a car.

import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { ARCHETYPES, SPRITES, drawCar, spriteFor, clearSpriteCache } = await import(
  pathToFileURL(path.join(HERE, '..', 'js', 'sprites.js')).href);

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { passed++; console.log(`  ok    ${what}${detail ? '  ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
};
const group = name => console.log(`\n${name}`);

/* ------------------------------------------------------- the recording ctx -- */

const METHODS = [
  'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc',
  'ellipse', 'rect', 'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke', 'clip',
  'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'translate',
  'scale', 'rotate', 'transform', 'setTransform', 'resetTransform', 'setLineDash',
  'drawImage',
];
const STYLE_PROPS = [
  'fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'font',
  'textAlign', 'textBaseline', 'globalAlpha', 'globalCompositeOperation',
  'shadowBlur', 'shadowColor',
];

// Deliberately no roundRect: the fake exercises rr()'s manual arc fallback,
// which is the path old browsers take too.
function recorder() {
  const ops = [];
  const state = { fillStyle: '#000000', strokeStyle: '#000000' };
  const ctx = { ops };
  const rec = (op, args) => {
    ops.push({ op, args, fillStyle: state.fillStyle, strokeStyle: state.strokeStyle });
  };
  for (const name of METHODS) ctx[name] = (...args) => rec(name, args);
  ctx.createLinearGradient = (...args) => { rec('createLinearGradient', args); return { addColorStop() {} }; };
  ctx.createRadialGradient = (...args) => { rec('createRadialGradient', args); return { addColorStop() {} }; };
  ctx.createPattern = (...args) => { rec('createPattern', args); return null; };
  ctx.measureText = (...args) => { rec('measureText', args); return { width: 0 }; };
  for (const prop of STYLE_PROPS) {
    Object.defineProperty(ctx, prop, {
      get: () => state[prop],
      set: v => { state[prop] = v; ops.push({ op: `set ${prop}`, args: [v], fillStyle: state.fillStyle, strokeStyle: state.strokeStyle }); },
    });
  }
  return ctx;
}

const FILLS = new Set(['fill', 'fillRect', 'fillText']);
const filledWith = (ops, colour) =>
  ops.some(o => FILLS.has(o.op) && typeof o.fillStyle === 'string' &&
    o.fillStyle.toLowerCase() === colour.toLowerCase());
const fillColourSequence = ops =>
  ops.filter(o => o.op === 'set fillStyle' && typeof o.args[0] === 'string')
    .map(o => o.args[0]).join(' ');

const record = (archetype, variant, t = 0) => {
  const ctx = recorder();
  drawCar(ctx, archetype, variant, t);
  return ctx.ops;
};

/* -------------------------------------------------------------- the table -- */

group('the archetype table');

{
  const want = ['standard', 'granny', 'aggressive', 'tourist', 'trucker', 'student', 'rideshare', 'emergency', 'motorcade', 'procession'];
  ok(ARCHETYPES.length === want.length && ARCHETYPES.every((a, i) => a === want[i]),
    'the ten archetypes are there, in order: the eight drivers, then the two platoons (M7)', ARCHETYPES.join(', '));
  const keys = Object.keys(SPRITES);
  ok(keys.length === want.length && keys.every((k, i) => k === want[i]),
    'and SPRITES carries exactly those keys', keys.join(', '));
}

group('the palettes');

{
  const HEX = /^#[0-9a-f]{6}$/i;
  let counts = true, hexes = true, unique = true, firstBad = '';
  for (const a of ARCHETYPES) {
    const ps = SPRITES[a].palettes;
    if (ps.length !== 4) { counts = false; firstBad ||= `${a} has ${ps.length}`; }
    for (const p of ps) {
      for (const field of ['body', 'glass', 'accent']) {
        if (!HEX.test(p[field])) { hexes = false; firstBad ||= `${a}/${p.name}.${field} = ${p[field]}`; }
      }
    }
    if (new Set(ps.map(p => p.name)).size !== ps.length) {
      unique = false; firstBad ||= `${a} repeats a palette name`;
    }
  }
  ok(counts, 'every archetype has four palettes', counts ? '' : firstBad);
  ok(hexes, 'every body, glass and accent is a 6-digit hex', hexes ? '' : firstBad);
  ok(unique, 'and no archetype repeats a palette name', unique ? '' : firstBad);
}

group('the sizes');

{
  const L = a => SPRITES[a].length;
  const rig = L('trucker') + SPRITES.trucker.trailer.length;
  ok(rig > L('granny'), 'the rig is the longest thing on the road',
    `${rig.toFixed(1)} m against the land yacht's ${L('granny').toFixed(1)} m`);
  ok(L('granny') > L('emergency'), 'the land yacht outmeasures the emergency van',
    `${L('granny').toFixed(1)} vs ${L('emergency').toFixed(1)} m`);
  ok(L('emergency') >= L('standard'), 'the van is at least a sedan long',
    `${L('emergency').toFixed(1)} vs ${L('standard').toFixed(1)} m`);
  ok(L('standard') > L('rideshare'), 'the mid sedan is longer than the compact',
    `${L('standard').toFixed(1)} vs ${L('rideshare').toFixed(1)} m`);
  ok(L('rideshare') > L('student'), 'and the compact longer than the hatchback',
    `${L('rideshare').toFixed(1)} vs ${L('student').toFixed(1)} m`);

  const widths = ARCHETYPES.map(a => [a, SPRITES[a].width])
    .concat([['trucker trailer', SPRITES.trucker.trailer.width]]);
  const offLane = widths.filter(([, w]) => !(w >= 1.5 && w <= 2.6));
  ok(offLane.length === 0, 'everything fits a lane: widths stay between 1.5 and 2.6 m',
    offLane.length ? offLane.map(([a, w]) => `${a} ${w}`).join(', ')
      : `${Math.min(...widths.map(w => w[1]))} to ${Math.max(...widths.map(w => w[1]))} m`);
}

/* --------------------------------------------------------------- the draws -- */

group('every car draws');

{
  let threw = '', noGloss = '', noBody = '';
  for (const a of ARCHETYPES) {
    for (let v = 0; v < SPRITES[a].palettes.length; v++) {
      const p = SPRITES[a].palettes[v];
      let ops;
      try { ops = record(a, v); } catch (e) { threw ||= `${a}/${p.name}: ${e.message}`; continue; }
      if (!ops.some(o => o.op === 'createLinearGradient')) noGloss ||= `${a}/${p.name}`;
      if (!filledWith(ops, p.body)) noBody ||= `${a}/${p.name} never fills ${p.body}`;
    }
  }
  ok(threw === '', 'all 40 archetype-by-palette draws run without throwing', threw);
  ok(noGloss === '', 'every one of them lays down the gloss gradient',
    noGloss ? `${noGloss} drew no linear gradient` : '');
  ok(noBody === '', 'and fills the body in its palette\'s body colour', noBody);
}

group('the details each archetype owes');

{
  const ops = record('student', 0);
  const signs = ops.filter(o => o.op === 'fillText' && String(o.args[0]).includes('STUDENT'));
  ok(signs.length > 0, 'the student car carries a STUDENT placard',
    signs.length ? signs.map(o => `"${o.args[0]}"` ).join(' ') : 'no fillText said STUDENT');
}

{
  const a = fillColourSequence(record('emergency', 0, 0));
  const b = fillColourSequence(record('emergency', 0, 0.3));
  ok(a !== b, 'the emergency light bar alternates between t 0 and t 0.3',
    a === b ? 'both frames laid down the same colours' : 'the colour sequences differ');
  const red = '#e8332b', blue = '#2f6fe6';
  ok(a.includes(red) && a.includes(blue) && b.includes(red) && b.includes(blue),
    'and both frames light red and blue', `${red} and ${blue}`);
}

{
  const h = record('procession', 0);
  ok(filledWith(h, '#fff4c2'), 'the hearse runs its headlamps', 'looked for the lamp colour #fff4c2 in a fill');
  ok(h.some(o => o.op === 'quadraticCurveTo'), 'and carries landau bars on its flanks');
  const m = record('motorcade', 0);
  const pennants = m.filter(o => o.op === 'closePath').length;
  ok(pennants >= 4 && filledWith(m, SPRITES.motorcade.palettes[0].accent), 'the motorcade car flies a pennant on each wing in the palette\'s accent', `${pennants} closed paths`);
  ok(SPRITES.motorcade.palettes.every(p => p.body < '#40') && SPRITES.procession.palettes.filter(p => p.body < '#40').length >= 3, 'both platoons are painted dark, the hearse with one silver exception', SPRITES.procession.palettes.map(p => p.body).join(' '));
}

{
  const trailer = SPRITES.trucker.trailer;
  ok(trailer.length === 9, 'the trailer is nine metres of box', `${trailer.length} m`);
  let allPainted = true, firstBad = '';
  for (const p of SPRITES.trucker.palettes) {
    const ctx = recorder();
    trailer.draw(ctx, p);
    if (!filledWith(ctx.ops, p.accent)) { allPainted = false; firstBad ||= `${p.name} never fills ${p.accent}`; }
  }
  ok(allPainted, 'and it is painted in the palette\'s accent, not the cab\'s colour', firstBad);
}

group('spriteFor in Node');

{
  clearSpriteCache();
  let message = '';
  try {
    spriteFor('standard', 0, 12);
  } catch (e) { message = e.message; }
  ok(/no canvas/i.test(message), 'with no OffscreenCanvas and no document it says so plainly',
    message ? `"${message}"` : 'it did not throw at all');
}

/* --------------------------------------------------------------------------- */

console.log(`\n${passed + failed} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
