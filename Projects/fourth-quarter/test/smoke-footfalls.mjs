// smoke-footfalls.mjs — node test/smoke-footfalls.mjs
//
// walk.js's Footfalls (TG-37): which walking bodies are heard taking a step.
// audio.playSfx() clones an <audio> element per play, so a full floor must not
// start one per stride per body. Pure logic on synthetic bodies: no scene, no
// audio, no decoder. Nobody has heard what it lets through.

import { Footfalls, STRIDE, STEP_EARSHOT, STEP_NEAREST, STEP_RATE, STEP_BURST } from "../js/walk.js";

let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error("FAIL:", name)); };

const me = { x: 0, z: 0 };
// the listener walks with the crowd, so nobody leaves earshot in a long run
const body = (x, z, over = {}) => ({ pos: { x, z }, walking: true, ...over });
// walk every body `speed` m/s along +x for `seconds`, calling update every 1/60 s; returns the steps heard
function run(f, bodies, seconds, { speed = 1.5, listener = { ...me }, follow = true, dt = 1 / 60, realDt = dt } = {}) {
  const heard = [];
  for (let t = 0; t < seconds; t += dt) {
    // each body a little faster than the last so their strides do not land in lockstep
    bodies.forEach((b, i) => { b.pos.x += speed * (1 + 0.03 * (i % 11)) * dt; });
    if (follow) listener.x += speed * dt;
    for (const s of f.update(bodies, listener, realDt)) heard.push({ ...s, t });
  }
  return heard;
}

// ---- one body: a step per stride walked ----
{
  const b = body(2, 0), heard = run(new Footfalls(), [b], 10);
  const metres = 1.5 * 10, want = Math.floor(metres / STRIDE);
  ok(Math.abs(heard.length - want) <= 1, `a body walking ${metres} m is heard ${heard.length} times, one per ${STRIDE} m (${want})`);
}
{
  const b = body(2, 0, { walking: false }), heard = run(new Footfalls(), [b], 10);
  ok(heard.length === 0, "a body that is not walking is silent even if it is moved");
}
{
  const f = new Footfalls(), b = body(2, 0);
  f.update([b], me, 1 / 60);
  let heard = 0;
  for (let i = 0; i < 600; i++) heard += f.update([b], me, 1 / 60).length; // held still by separate()
  ok(heard === 0, "a body that is walking but not getting anywhere makes no sound");
}
{
  const f = new Footfalls(), b = body(2, 0);
  f.update([b], me, 1 / 60);
  b.pos.x = 7; // put back on its post: not a stride
  ok(f.update([b], me, 1 / 60).length === 0, "a jump of more than a stride is not a step");
}
{
  const bs = [body(1, 0, { fixed: true }), body(1, 1, { solid: false })], heard = run(new Footfalls(), bs, 5);
  ok(heard.length === 0, "the boss (fixed) and a body with solid:false are never heard");
}

// ---- earshot and volume ----
{
  const near = body(2, 0), far = body(STEP_EARSHOT + 3, 0);
  const heard = run(new Footfalls(), [near, far], 6);
  ok(heard.length > 0 && heard.every((s) => s.body === near), "a body beyond earshot is never heard");
  const vols = heard.map((s) => s.vol);
  ok(vols.every((v) => v > 0 && v <= 1), `every volume is over 0 and at most 1 (${Math.min(...vols).toFixed(2)} to ${Math.max(...vols).toFixed(2)})`);
}
{
  const f = new Footfalls(), a = body(1, 0), z = body(7, 0);
  const s = run(f, [a, z], 6);
  const va = s.filter((x) => x.body === a)[0], vz = s.filter((x) => x.body === z)[0];
  ok(va && vz && va.vol > vz.vol, `a nearer step is louder (${va?.vol.toFixed(2)} at ${va?.d.toFixed(1)} m, ${vz?.vol.toFixed(2)} at ${vz?.d.toFixed(1)} m)`);
}

// ---- the crowd: sixty bodies all walking in earshot ----
{
  const crowd = Array.from({ length: 60 }, (_, i) => body(-3 + (i % 10) * 0.5, -3 + Math.floor(i / 10) * 0.6)); // within ~5 m of me
  // every body strides 2 times a second, so the unthrottled count is ~7,200 over a minute
  const heard = run(new Footfalls(), crowd, 60, { speed: 1.5 });
  const perSec = heard.length / 60;
  ok(perSec <= STEP_RATE + 0.1, `60 walkers in earshot are heard ${perSec.toFixed(2)} times a second, at most ${STEP_RATE}`);
  ok(perSec >= STEP_RATE - 1, `and the room is not silent: ${perSec.toFixed(2)} a second`);
  const byFrame = new Map();
  for (const s of heard) byFrame.set(s.t, (byFrame.get(s.t) || 0) + 1);
  ok(Math.max(...byFrame.values()) <= STEP_NEAREST, `never more than ${STEP_NEAREST} in one frame (${Math.max(...byFrame.values())})`);
  // a burst on the first frame is the bucket's size and no more
  const f = new Footfalls(), c2 = Array.from({ length: 60 }, (_, i) => body(-3 + (i % 10) * 0.5, -3 + Math.floor(i / 10) * 0.6));
  f.update(c2, me, 1 / 60);
  for (const b of c2) b.pos.x += STRIDE;
  ok(STEP_BURST > STEP_NEAREST, "the bucket holds more than the nearest-few rule lets through, so each limit can bind alone");
  ok(f.update(c2, me, 1 / 60).length === STEP_NEAREST, `60 strides landing on one frame with a full bucket let through ${STEP_NEAREST}`);
}
{
  // of those due the nearest are the ones heard
  const f = new Footfalls();
  const bs = [body(8, 0), body(6, 0), body(1, 0), body(2, 0), body(4, 0), body(3, 0)];
  f.update(bs, me, 1 / 60);
  for (const b of bs) b.pos.x += STRIDE;
  f.tokens = STEP_BURST; // a full bucket (4 tokens), so the nearest-N rule is the one under test
  const got = f.update(bs, me, 1 / 60).map((s) => s.body.pos.x - STRIDE).sort((p, q) => p - q);
  ok(got.length === STEP_NEAREST && got.join() === "1,2,3", `with six due, the ${STEP_NEAREST} nearest are heard (${got.join(",")})`);
}
{
  // the clock is the wall clock, not the sim's: a speed-up cannot raise the cap
  const crowd = Array.from({ length: 60 }, (_, i) => body(-3 + (i % 10) * 0.5, -3 + Math.floor(i / 10) * 0.6));
  const heard = run(new Footfalls(), crowd, 30, { speed: 1.5 * 4, dt: 1 / 60, realDt: 1 / 60 }); // fourfold sim speed: bodies cover four times the ground per real second
  ok(heard.length / 30 <= STEP_RATE + 0.1, `at four times sim speed it is still at most ${STEP_RATE} a second (${(heard.length / 30).toFixed(2)})`);
}
{
  // a quiet floor gets every step: the cap only bites on a crowd
  const lone = body(3, 0), heard = run(new Footfalls(), [lone], 20, { speed: 1.5 });
  ok(heard.length >= Math.floor(30 / STRIDE) - 1, `one walker loses none of its steps to the cap (${heard.length})`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
