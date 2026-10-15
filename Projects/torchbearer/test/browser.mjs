// test/browser.mjs — Torchbearer's page check, its first: what the grid lights
// while an area is armed.
//
// smoke.mjs asserts the hit list in Node off `previewCells` and reads the page
// as text. Nothing opened the page with an area armed, so a CSS rule that lit
// every other square (#grid's highlights lost to `.cell.floor.alt` until
// 2026-10-14) passed 1,800 assertions. This file opens the page in real
// Chromium, starts the Chapel Yard fight with a level-3 wizard, and for a cone
// (Breathe Fire), a line (Grim Tendrils) and a burst (a Fireball like the one
// smoke.mjs arms; no shipped player spell is a burst) hovers two aims with the
// mouse and compares the lit squares with the engine's own lists. Then it casts
// once and checks what the cast did. Seek (the other radius aim) and Stride
// are armed too, for the checkerboard on their own highlights.
//
//   node Projects/torchbearer/test/browser.mjs
//
// Borrows Tools/board-check's harness for the server and the browser, as
// Absalom's and The Fracture Cycle's browser.mjs do: the one install is
// `npm ci` in Tools/board-check. Positions and dice come from the page's own
// Math.random, so every check here is a relation (lit == engine list), never a
// pinned square.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve, launch, prepPage } from "../../../Tools/board-check/harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Tools/board-check/README.md lists the ports in use; 8177 was free on
// 2026-10-14 and is this file's.
const PORT = 8177;
const server = await serve(PORT);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? "  " + detail : ""}`); }
};
const eq = (label, actual, want) => ok(label, JSON.stringify(actual) === JSON.stringify(want),
  `got ${JSON.stringify(actual)}, want ${JSON.stringify(want)}`);
const group = t => console.log(`\n${t}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(page, fn, ms = 15000) {
  for (const t0 = Date.now(); ;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(50);
  }
}

// The committed save, with the hero swapped for a wizard carrying the three
// area spells (the build smoke.mjs's WIZARD() forges; a made-up name), and put
// in front of the Chapel Yard fight in the core adventure.
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, "sera-voss.torchsave.json"), "utf8")).state;
const state = {
  ...fixture,
  build: {
    name: "Testcase Wren", ancestry: "human", heritage: "skilled-human", background: "soldier",
    cls: "wizard", subclass: "school-battle-magic", level: 3, advances: {},
    boosts: { ancestry: ["con", "dex"], bgA: "con", bgFree: "str", key: "int", free: ["dex", "wis", "int", "cha"] },
    skills: [], loreExtra: [], feats: {}, extraPicks: [], focusChoices: {},
    spells: { cantrips: ["electric-arc", "ignition", "frostbite", "shield"], r1: ["force-barrage", "grim-tendrils", "breathe-fire", "sure-strike"], r2: ["blazing-bolt", "false-life", "blur"] },
    gear: { weapon: null, weapon2: null, ranged: null, armor: "explorers-clothing", shield: false },
    skillIncrease: null
  },
  advId: "barrowmoor", sceneId: "yard-open", flags: {}, hero: null, companions: [],
  campaignId: null, campaignFlags: {}, completed: [], chronicle: []
};
const FIREBALL = { id: "fireball", name: "Fireball", actions: 2, range: 20, traits: ["fire"], area: { shape: "burst", radius: 5 },
  save: "reflex", basic: true, desc: "A test burst.", rankEffects: { 3: { damage: [{ formula: "3d6", type: "fire" }] } } };

const browser = await launch();
const page = await prepPage(browser, BASE, { width: 1400, height: 1000, dsf: 1 });
try {
  await page.goto(`${BASE}/Projects/torchbearer.html`, { waitUntil: "load" });
  await until(page, () => !!(window.__torchbearer && window.__torchbearer.slot));

  group("the Chapel Yard, a wizard's turn");
  await page.evaluate(s => window.__torchbearer.loadSave(s), state);
  const choice = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".choice-btn")].find(e => /Break the congregation/.test(e.textContent));
    if (!b) return null;
    const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  ok("the scene offers the fight", !!choice);
  if (choice) await page.mouse.click(choice.x, choice.y);
  const turn = await until(page, () => {
    const C = window.__torchbearerCombat, cb = C && C.cbs && C.cur && C.cur();
    return !!(cb && cb.id === "hero" && document.querySelector('#action-bar [data-act="spells"]'));
  }, 30000);
  ok("the hero's turn comes and the bar offers Spells", !!turn);
  if (!turn) throw new Error("no hero turn; nothing below can run");

  /** Everything a check reads off the grid, in one trip. */
  const grid = () => page.evaluate(() => {
    const C = window.__torchbearerCombat, cb = C.cur(), a = C.armed;
    const cells = cls => [...document.querySelectorAll(`#grid .cell.${cls}`)].map(e => `${e.dataset.x},${e.dataset.y}`).sort();
    const look = cls => [...new Set([...document.querySelectorAll(`#grid .cell.${cls}`)]
      .filter(e => cls === "hl-hit" || !e.classList.contains("hl-hit"))
      .map(e => { const s = getComputedStyle(e); return s.backgroundColor + " | " + s.boxShadow; }))];
    const floor = [...new Set([...document.querySelectorAll("#grid .cell.floor:not([class*=hl-])")].map(e => getComputedStyle(e).backgroundColor))];
    const aimable = [];
    if (a && a.kind === "cell") for (let y = 0; y < C.mapH; y++) for (let x = 0; x < C.mapW; x++) if (C.aimable(cb, a, x, y)) aimable.push(`${x},${y}`);
    return { armed: a ? { kind: a.kind, wedge: a.wedge || null, mode: a.mode, radius: a.radius || 0 } : null,
      aoe: cells("hl-aoe"), hit: cells("hl-hit"), move: cells("hl-move"),
      aoeLook: look("hl-aoe"), hitLook: look("hl-hit"), moveLook: look("hl-move"), floor, aimable: aimable.sort(),
      hero: { x: cb.x, y: cb.y }, actions: C.actions, slots: { ...cb.resources.slots } };
  });
  /** The engine's hit list for an aim, as the page's keys. */
  const preview = (x, y) => page.evaluate((x, y) => {
    const C = window.__torchbearerCombat;
    return C.previewCells(C.cur(), C.armed, x, y).map(p => `${p.x},${p.y}`).sort();
  }, x, y);
  /** Two aims for the armed area: the aimable squares whose lists are the two
      longest and differ, so the hover is seen to move the lit set. */
  const aims = () => page.evaluate(() => {
    const C = window.__torchbearerCombat, cb = C.cur(), a = C.armed, out = [];
    for (let y = 0; y < C.mapH; y++) for (let x = 0; x < C.mapW; x++) {
      const l = C.previewCells(cb, a, x, y); if (l.length) out.push({ x, y, n: l.length, k: l.map(p => p.x + "," + p.y).sort().join(" ") });
    }
    out.sort((p, q) => q.n - p.n || p.y - q.y || p.x - q.x);
    const first = out[0], second = first && out.find(o => o.k !== first.k);
    return [first, second].filter(Boolean);
  });
  const hover = async (x, y) => {
    const box = await page.evaluate((x, y) => {
      const r = document.querySelector(`#grid .cell[data-x="${x}"][data-y="${y}"]`).getBoundingClientRect();
      r.x; return { x: r.x + r.width / 2, y: r.y + r.height / 2, inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth };
    }, x, y);
    if (!box.inView) await page.evaluate((x, y) => document.querySelector(`#grid .cell[data-x="${x}"][data-y="${y}"]`).scrollIntoView({ block: "center", inline: "center" }), x, y);
    const b2 = await page.evaluate((x, y) => { const r = document.querySelector(`#grid .cell[data-x="${x}"][data-y="${y}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, x, y);
    await page.mouse.move(1, 1); await page.mouse.move(b2.x, b2.y);
    return b2;
  };
  /** Put the pointer somewhere that is not the grid: the status box under
      it. A hover may have scrolled the page, so (1,1) can be a square. */
  const offGrid = async () => {
    const p = await page.evaluate(() => {
      const e = document.getElementById("combat-status"); e.scrollIntoView({ block: "nearest" });
      const r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      const under = document.elementFromPoint(x, y);
      return { x, y, clear: !!under && !under.closest("#grid") };
    });
    if (!p.clear) throw new Error("no point off the grid to rest the pointer on");
    await page.mouse.move(p.x, p.y + 1); await sleep(50); await page.mouse.move(p.x, p.y);
  };
  const clickAct = async act => {
    const b = await page.evaluate(act => { const e = document.querySelector(`#action-bar [data-act="${act}"]`); if (!e || e.disabled) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, act);
    if (b) await page.mouse.click(b.x, b.y);
    return !!b;
  };
  const castFromMenu = async name => {
    if (!await clickAct("spells")) return false;
    await until(page, () => document.querySelectorAll("#modal-body .opt-card").length > 0, 5000);
    const b = await page.evaluate(n => { const e = [...document.querySelectorAll("#modal-body .opt-card:not(.disabled)")].find(c => c.querySelector("h3").textContent.startsWith(n)); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, name);
    if (b) await page.mouse.click(b.x, b.y);
    return !!b;
  };

  /** One armed area: the aim squares are the engine's, solid and alike; two
      hovers light exactly the engine's list for each, in a second style. */
  async function checkArea(label, shape) {
    // The pointer off the grid first: arming from the spell menu leaves it
    // over whatever square sits under the closed modal, and that square is
    // rightly previewed. Chrome sends that square its mouseover a frame after
    // the modal goes, so wait for it and then leave.
    await sleep(150); await offGrid();
    await until(page, () => document.querySelectorAll("#grid .cell.hl-hit").length === 0, 1500);
    const g = await grid();
    eq(`${label}: armed as a ${shape}`, g.armed && (g.armed.wedge || (g.armed.mode === "seek" ? "seek" : "burst")), shape);
    ok(`${label}: the squares lit to aim at are the engine's aimable squares`, g.aoe.length > 0 && JSON.stringify(g.aoe) === JSON.stringify(g.aimable),
      `lit ${g.aoe.length}, aimable ${g.aimable.length}`);
    eq(`${label}: every aim square is drawn alike, not in a checkerboard`, g.aoeLook.length, 1);
    ok(`${label}: …and not like the floor`, g.aoeLook.length === 1 && !g.floor.some(f => g.aoeLook[0].startsWith(f + " |")), `${g.aoeLook} vs ${g.floor}`);
    // The pointer was over the grid when the menu closed, so this is the
    // preview clearing when it leaves: a preview of (-1,-1), which lit a
    // line to the map's edge from a caster near the corner until #966.
    eq(`${label}: nothing is lit as hit with the pointer off the grid`, g.hit, []);
    const two = shape === "seek" ? [] : await aims();
    if (shape !== "seek") eq(`${label}: two aims with different hit lists`, two.length, 2);
    for (const [i, t] of two.entries()) {
      await hover(t.x, t.y);
      const after = await grid(), want = await preview(t.x, t.y);
      ok(`${label}: hover ${i + 1} at ${t.x},${t.y} lights exactly previewCells (${want.length} squares)`,
        want.length > 0 && JSON.stringify(after.hit) === JSON.stringify(want), `lit ${after.hit.join(" ")} | engine ${want.join(" ")}`);
      eq(`${label}: hover ${i + 1}: the hit squares are drawn alike`, after.hitLook.length, 1);
      ok(`${label}: hover ${i + 1}: and unlike the aim squares and the floor`,
        after.hitLook.length === 1 && after.aoeLook.length === 1 && after.hitLook[0] !== after.aoeLook[0]
        && !after.floor.some(f => after.hitLook[0].startsWith(f + " |")), `${after.hitLook} vs ${after.aoeLook}`);
    }
    if (shape === "seek") {
      const t = g.aimable[g.aimable.length - 1].split(",").map(Number);
      await hover(t[0], t[1]);
      eq(`${label}: Seek's point lights no hit list under the pointer`, (await grid()).hit, []);
    }
    return two;
  }

  group("Stride: the move highlight");
  ok("Stride arms", await clickAct("stride"));
  { const g = await grid();
    ok("Stride lights squares to move to", g.move.length > 0, `${g.move.length}`);
    eq("…all drawn alike, not in a checkerboard", g.moveLook.length, 1); }

  group("Seek: a radius point with nothing to hit");
  ok("Seek arms", await clickAct("seek"));
  await checkArea("Seek", "seek");

  group("Breathe Fire: a cone");
  ok("Breathe Fire is on the menu and arms", await castFromMenu("Breathe Fire"));
  const coneAims = await checkArea("Breathe Fire", "cone");

  group("Grim Tendrils: a line");
  ok("Grim Tendrils is on the menu and arms", await castFromMenu("Grim Tendrils"));
  const lineAims = await checkArea("Grim Tendrils", "line");

  group("a burst (radius 1), armed through the engine");
  await page.evaluate(sp => { const C = window.__torchbearerCombat; C.armSpell(C.cur(), { sp, rank: 3, pool: "r2" }); }, FIREBALL);
  const burstAims = await checkArea("Fireball", "burst");

  group("one cast: the line, at the aim that covers the most");
  ok("Grim Tendrils arms again", await castFromMenu("Grim Tendrils"));
  // The aim whose line covers the most creatures, so the cast has someone to
  // answer it when the fight's layout allows.
  const aim = await page.evaluate(() => {
    const C = window.__torchbearerCombat, cb = C.cur(), a = C.armed; let best = null;
    for (let y = 0; y < C.mapH; y++) for (let x = 0; x < C.mapW; x++) {
      const l = C.previewCells(cb, a, x, y); if (!l.length) continue;
      const n = C.cbs.filter(c => !c.dead && c !== cb && l.some(p => p.x === c.x && p.y === c.y)).length;
      if (!best || n > best.n) best = { x, y, n };
    }
    return best;
  });
  if (aim) {
    const from = await page.evaluate(() => window.__torchbearerCombat.events.length);
    const at = await hover(aim.x, aim.y);
    const before = await grid();
    const lit = before.hit;
    const foesLit = await page.evaluate(lit => window.__torchbearerCombat.cbs
      .filter(c => !c.dead && c.id !== "hero" && lit.includes(`${c.x},${c.y}`)).map(c => c.name).sort(), lit);
    await page.mouse.click(at.x, at.y);
    const after = await grid();
    // Every die the engine rolls is a `roll` event on `events` (js/combat.js's `seal`).
    const evs = await page.evaluate(from => window.__torchbearerCombat.events.slice(from).map(e => ({ kind: e.kind, text: String(e.text).replace(/<[^>]+>/g, "") })), from);
    const rolled = evs.filter(e => e.kind === "roll").map(e => e.text);
    eq("the cast spends two actions", before.actions - after.actions, 2);
    eq("…and one rank-1 slot", before.slots[1] - after.slots[1], 1);
    eq("…and disarms: nothing is lit after it", [after.armed, after.aoe.length, after.hit.length], [null, 0, 0]);
    // A creature under the line either rolls its save or is named as immune
    // ("Grave Wisp has no life to drain": void does nothing to the undead).
    // Every other creature on the map goes unnamed.
    const others = await page.evaluate(lit => window.__torchbearerCombat.cbs
      .filter(c => !c.dead && c.id !== "hero" && !lit.includes(`${c.x},${c.y}`)).map(c => c.name), lit);
    const texts = evs.slice(1).map(e => e.text);
    // The yard has two Skeleton Guards, so this counts lines per name: as
    // many as there are creatures of that name on the lit squares.
    // A creature answers once: its save's roll, or the line saying the
    // spell cannot hurt it. Damage and condition lines come after and are
    // not counted.
    const named = n => texts.filter(x => x.startsWith(n + ": ") && / save vs /.test(x) || x === `${n} has no life to drain.`).length;
    const litCount = n => foesLit.filter(m => m === n).length;
    eq("everybody standing on a lit square is answered by the cast",
      foesLit.map(n => named(n) >= litCount(n)), foesLit.map(() => true));
    eq("…and nobody off it", [...new Set(others)].filter(n => named(n) > litCount(n)), []);
    eq("…one save for each creature under the line that can be hurt by it", rolled.length,
      foesLit.filter(n => !texts.some(x => x.startsWith(n) && /no life to drain/.test(x))).length);
    if (fail) console.log("  events of the cast:", JSON.stringify(evs).slice(0, 1500));
    const chron = await page.evaluate(() => document.body.textContent.includes("casts Grim Tendrils"));
    ok("the Chronicle says the spell was cast", chron);
    console.log(`  (the cast caught ${foesLit.length}: ${foesLit.join(", ") || "nobody"})`);
  } else ok("the line had an aim to cast at", false);

  group("the page");
  eq("no console error, page error or failed request", page.__errs, []);
  eq("no offsite request", page.__blocked, []);
  ok("cone, line and burst each had two aims", coneAims.length === 2 && lineAims.length === 2 && burstAims.length === 2);
} catch (e) {
  fail++; console.log(`  FAIL  threw: ${e && e.stack || e}`);
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
