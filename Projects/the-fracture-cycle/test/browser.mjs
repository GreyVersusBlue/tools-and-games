// test/browser.mjs — The Fracture Cycle's page suite, its first.
//
// smoke.mjs walks the story in bare Node: it reads the `nodes` literal out of
// the page as text and never opens the page. This file opens it, in real
// Chromium, and plays it the way a player does: real clicks and real key
// presses, with what is on screen compared at every step with what story.mjs's
// walker (the one smoke.mjs uses) says that step shows (#39: the DOM for what
// just happened, the save for what a reload has to keep).
//
//   node Projects/the-fracture-cycle/test/browser.mjs
//
// Borrows Tools/board-check's harness for the server and the browser, the way
// Absalom's browser.mjs does (#880): the one install is `npm ci` in
// Tools/board-check, nothing is installed under Projects/. On Linux that is
// puppeteer-core driving @sparticuz/chromium, which is what CI has; elsewhere
// it is Playwright driving the Chrome or Edge already on the machine.
//
// Nothing here waits on a clock. The page draws on input and sits still
// between clicks, so a screen is read in the step after the click that made
// it. The two things that take real time are an imported file being read and
// an exported one being fetched back; both are polled from here, not timed.
// The one animation the page has is the smooth scroll to the top after a
// choice, and a click aimed at a button while that runs can miss it, so every
// walk by mouse is in a window taller than the page (asserted), where there is
// nothing to scroll. Nothing is random and no date is pinned: the export's
// file name carries today's and is matched by shape.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, launch, prepPage } from "../../../Tools/board-check/harness.mjs";
import { setFiles } from "../../../Tools/board-check/drive.mjs";
import { loadStory } from "./story.mjs";
import { SAVE_KEY, SAVE_VERSION, ENDING_IDS } from "../save-config.js";

// Tools/board-check/README.md lists the ports in use; 8175 was free on
// 2026-10-13 and is this file's.
const PORT = 8175;
const server = await serve(PORT);
const BASE = `http://127.0.0.1:${PORT}`;
const URL_ = `${BASE}/Projects/the-fracture-cycle.html`;

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? "  " + detail : ""}`); }
};
const eq = (label, actual, want) => ok(label, JSON.stringify(actual) === JSON.stringify(want),
  `got ${JSON.stringify(actual)}, want ${JSON.stringify(want)}`);
const none = (label, list) => ok(label, list.length === 0, `${list.length}: ${list.slice(0, 3).join(" ; ")}`);
const group = t => console.log(`\n${t}`);

/* ---------------- the story, from the one walker ---------------- */

const story = loadStory();
const { paths, deadEnds } = story.enumerate();
const prongOf = p => p.steps[1].id.split("_")[0];
const endTitle = id => story.nodes[id].title.replace(/^Ending:\s*/, "");
const OLD_ENDINGS = ENDING_IDS.slice(0, 5);

// Which of the 519 paths get played. Clicking all of them is ten minutes of
// browser for nothing new, so the set is the smallest greedy cover of: every
// choice at every node, every distinct list of choices a node ever offers
// (side_hub, the socket and the hollow build theirs from the state), every
// ending from every prong that reaches it, and every count of fragments
// carried. Greedy over a fixed order, so it is the same set every run.
function marksOf(p) {
  const m = new Set();
  p.picks.forEach((k, i) => {
    m.add(`took ${p.steps[i].id} > ${p.lists[i][k].next} > ${p.lists[i][k].label}`);
    m.add(`offered ${p.steps[i].id}: ${p.lists[i].map(c => c.label).join(" | ")}`);
  });
  m.add(`end ${prongOf(p)} ${p.end}`);
  m.add(`carry ${prongOf(p) === "seam" ? "seam" : "old"} ${p.state.fragments.length}`);
  if (p.state.seam) m.add(`name ${p.state.seam.name} ${p.end}`);
  return m;
}
const universe = new Set(paths.flatMap(p => [...marksOf(p)]));
const chosen = [];
{
  const left = new Set(universe);
  while (left.size) {
    let best = null, gain = 0;
    for (const p of paths) {
      let g = 0;
      for (const m of marksOf(p)) if (left.has(m)) g++;
      if (g > gain) { gain = g; best = p; }
    }
    chosen.push(best);
    for (const m of marksOf(best)) left.delete(m);
  }
}

/* ---------------- the browser ---------------- */

const browser = await launch();
const puppeteer = p => p.__engine === "puppeteer";
const setSize = (p, width, height) => puppeteer(p)
  ? p.setViewport({ width, height, deviceScaleFactor: 1 })
  : p.setViewportSize({ width, height });
const setReduce = (p, on) => puppeteer(p)
  ? p.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: on ? "reduce" : "no-preference" }])
  : p.emulateMedia({ reducedMotion: on ? "reduce" : "no-preference" });

// Every response of every page this file opens. The harness's own listener
// hears a request that failed on the wire and never an HTTP status, so a 404
// is counted here.
const responses = [];
const pages = [];
async function open(view) {
  const page = await prepPage(browser, BASE, { dsf: 1, ...view });
  page.on("response", r => responses.push({ url: r.url(), status: r.status() }));
  pages.push(page);
  return page;
}
const boot = (page, url = URL_) => page.goto(url, { waitUntil: "load" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(page, fn, ms = 5000) {
  for (const t0 = Date.now(); ;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(25);
  }
}

/** Everything a check reads off the page, in one trip. */
const snap = page => page.evaluate(KEY => {
  const q = id => document.getElementById(id);
  const shown = el => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  const buttons = [...document.querySelectorAll("#choices .choice-btn")];
  const a = document.activeElement;
  const ring = a ? getComputedStyle(a) : null;
  const tag = document.querySelector("#choices .ending-tag");
  return {
    title: q("nodeTitle").textContent, titleTag: q("nodeTitle").tagName, titleClass: q("nodeTitle").className,
    titleShown: shown(q("nodeTitle")),
    text: q("nodeText").textContent, html: q("nodeText").innerHTML, textShown: shown(q("nodeText")),
    choices: buttons.map(b => ({
      mark: b.children[0].textContent, label: b.children[1].textContent, shown: shown(b),
      button: b.tagName === "BUTTON" && !b.disabled,
    })),
    extra: q("choices").children.length - buttons.length,
    tag: tag ? tag.textContent : null,
    align: q("alignLabel").textContent, marker: q("alignMarker").style.left,
    favor: [q("favR").textContent, q("favD").textContent, q("favI").textContent],
    chips: ["chipR", "chipD", "chipI"].map(id => q(id).classList.contains("have")),
    dots: ["fragR", "fragD", "fragI"].map(id => q(id).style.opacity),
    tracker: q("trackerCount").textContent,
    trackerChips: [...q("trackerChips").children].map(c => [c.textContent, c.classList.contains("have")]),
    active: {
      id: a ? a.id : "", tag: a ? a.tagName : "", choice: buttons.indexOf(a), gvb: a && a.dataset ? a.dataset.gvb || "" : "",
      ring: ring ? `${ring.outlineStyle} ${ring.outlineWidth}` : "",
    },
    h2: document.querySelectorAll("h2").length,
    pageTall: document.documentElement.scrollHeight, winTall: window.innerHeight, scrollY: window.scrollY,
    stored: localStorage.getItem(KEY),
    msg: (document.querySelector(".gvb-save-msg") || {}).textContent || "",
  };
}, SAVE_KEY);

// The story's prose is HTML. What it reads as, and what the browser's own
// parser makes of it, is asked of the browser once per distinct screen.
const asParsed = new Map();
async function learnProse(page) {
  const texts = [...new Set(paths.flatMap(p => p.steps.map(s => s.text)))];
  const got = await page.evaluate(list => list.map(h => {
    const d = document.createElement("div");
    d.innerHTML = h;
    return { text: d.textContent, html: d.innerHTML };
  }), texts);
  texts.forEach((t, i) => asParsed.set(t, got[i]));
}

// The status bar for a state, from a table written by hand: what a player at
// that allegiance is called. Not the page's thresholds read back.
const WORD = { "-5": "Dire Sworn", "-4": "Dire Sworn", "-3": "Dire Leaning", "-2": "Dire Leaning", "-1": "Dire Curious",
  0: "Unaligned", 1: "Radiant Curious", 2: "Radiant Leaning", 3: "Radiant Leaning", 4: "Radiant Sworn", 5: "Radiant Sworn" };
function statusBad(s, st, ending, where) {
  const out = [];
  const a = Math.max(-5, Math.min(5, st.align));
  const say = (what, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) out.push(`${where}: ${what} ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
  say("allegiance", s.align, WORD[a]);
  say("marker", s.marker, `${(a + 5) * 10}%`);
  say("favor", s.favor, [st.favor.radiant, st.favor.dire, st.favor.invoker].map(String));
  const have = ["radiant", "dire", "invoker"].map(f => st.fragments.includes(f));
  say("fragment chips", s.chips, have);
  say("fragment dots", s.dots, have.map(h => (h ? "1" : "0.25")));
  say("title class", s.titleClass, "node-title" + (st.align <= -2 && !ending ? " dire-tone" : ""));
  return out;
}

const choiceSel = k => `#choices > .choice-btn:nth-child(${k + 1})`;

/**
 * Play one path from the first screen of a fresh run to its ending. `how` is
 * "click" or "keys". `fromLoad` says the run starts on a page nobody has
 * touched (focus on the body, the save bar's two buttons ahead of the first
 * choice in tab order) and not after Begin the Cycle Anew.
 */
async function play(page, p, how, { fromLoad = false, log = null } = {}) {
  const bad = { prose: [], choices: [], status: [], focus: [], keys: [], ending: [] };
  let st = story.initialState();
  for (let i = 0; i < p.steps.length; i++) {
    const step = p.steps[i], node = story.nodes[step.id], at = `step ${i + 1} ${step.id}`;
    const s = await snap(page);
    const want = asParsed.get(step.text);
    if (s.title !== step.title || s.titleTag !== "H2" || !s.titleShown) bad.prose.push(`${at}: title reads "${s.title}"`);
    if (s.text !== want.text || s.html !== want.html || !s.textShown) bad.prose.push(`${at}: the prose on screen is not the story's (${s.text.slice(0, 50)}...)`);
    if (s.h2 !== 1) bad.prose.push(`${at}: ${s.h2} h2 on the screen`);
    if (how === "click" && s.pageTall > s.winTall) bad.prose.push(`${at}: the page (${s.pageTall}) is taller than the window (${s.winTall}), so a click could race the scroll`);
    bad.status.push(...statusBad(s, st, !!node.ending, at));
    if (i === 0 && fromLoad) { if (s.active.tag !== "BODY") bad.focus.push(`${at}: the page took focus on load (${s.active.tag}#${s.active.id})`); }
    else if (s.active.id !== "nodeTitle") bad.focus.push(`${at}: focus is on ${s.active.tag}${s.active.id ? "#" + s.active.id : ""}, not the new screen's title`);
    // The title is focused by script. A keyboard player is shown where they
    // are; a mouse player is not handed an outline round a heading.
    else if ((how === "keys") === s.active.ring.startsWith("none")) bad.focus.push(`${at}: by ${how}, the focused title's outline is "${s.active.ring}"`);

    if (i === p.steps.length - 1) {
      if (s.tag !== "Cycle Complete") bad.ending.push(`${at}: no Cycle Complete tag`);
      if (s.choices.length || s.extra !== 1) bad.ending.push(`${at}: an ending shows ${s.choices.length} choices and ${s.extra} other things`);
      if (!/^Ending: /.test(s.title)) bad.ending.push(`${at}: the title does not say Ending`);
      break;
    }
    const list = p.lists[i], k = p.picks[i];
    const got = s.choices.map(c => `${c.mark} | ${c.label}`), wanted = list.map(c => `${c.mark || "→"} | ${c.label}`);
    if (JSON.stringify(got) !== JSON.stringify(wanted)) bad.choices.push(`${at}: offers [${got.join("; ")}], the walker says [${wanted.join("; ")}]`);
    if (s.choices.some(c => !c.shown || !c.button) || s.extra !== 0 || s.tag) bad.choices.push(`${at}: a choice is hidden, disabled or not a button`);
    if (log) log.push({ id: step.id, labels: s.choices.map(c => c.label), list });

    if (how === "click") await page.click(choiceSel(k));
    else {
      // Tab to the choice, counting. From a fresh load the save bar's two
      // buttons come first; after any choice focus is on the title, so the
      // first Tab is the first choice.
      const lead = i === 0 && fromLoad ? 2 : 0;
      let presses = 0, on = null;
      while (presses < 14) {
        await page.keyboard.press("Tab");
        presses++;
        on = (await snap(page)).active;
        if (on.choice === k) break;
      }
      if (on.choice !== k) bad.keys.push(`${at}: ${presses} Tabs never reached choice ${k + 1}`);
      else if (presses !== lead + k + 1) bad.keys.push(`${at}: choice ${k + 1} took ${presses} Tabs, want ${lead + k + 1}`);
      if (on.ring !== "solid 2px") bad.keys.push(`${at}: the focused choice shows no ring (${on.ring})`);
      await page.keyboard.press(i % 2 ? "Space" : "Enter");
    }
    st = JSON.parse(step.after);
  }
  return bad;
}

const restart = page => page.click("#restartBtn");
const seed = (page, value) => page.evaluate((k, v) => { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); }, SAVE_KEY, value);
const trackerFor = seen => ENDING_IDS.map(id => (seen.includes(id) ? [endTitle(id), true] : ["???", false]));
const savedEndings = s => { try { return JSON.parse(s.stored).seenEndings; } catch { return null; } };

const TALL = { width: 1280, height: 2600 };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fracture-cycle-"));

try {

  /* ================= 1. the page loads ================= */
  group("1. the page loads");
  const page = await open(TALL);
  const first = await boot(page);
  eq("the page answers 200", first.status(), 200);
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => ({
    title: document.title, lang: document.documentElement.lang, h1: document.querySelector("h1").textContent,
    fonts: [...document.fonts].map(f => `${f.family.replace(/["']/g, "")} ${f.weight} ${f.style} ${f.status}`).sort(),
    save: [...document.querySelectorAll("#saveControls button")].map(b => b.textContent),
    restart: document.getElementById("restartBtn").textContent,
  }));
  eq("its title and language", [loaded.title, loaded.lang, loaded.h1], ["The Fracture Cycle — A Dota 2 Lore CYOA", "en", "THE FRACTURE CYCLE"]);
  eq("all five vendored faces load on the first screen", loaded.fonts, [
    "Cinzel 700 normal loaded", "Cinzel 900 normal loaded", "EB Garamond 400 italic loaded",
    "EB Garamond 400 normal loaded", "JetBrains Mono 400 normal loaded"]);
  none("no console error, page error or failed request on load", page.__errs);
  none("no request off the site, refused or shimmed", [...page.__blocked, ...page.__shimmed]);
  none("no response over 399", responses.filter(r => r.status > 399).map(r => `${r.status} ${r.url}`));
  ok("the page, the shared save module, save-config.js and the fonts were all asked for here",
    ["/Projects/the-fracture-cycle.html", "/assets/js/gvb-save.js", "/Projects/the-fracture-cycle/save-config.js", ".woff2"]
      .every(f => responses.some(r => r.url.startsWith(BASE) && r.url.includes(f) && r.status === 200)));
  eq("the save bar is Export and Import, and the restart button is there", [...loaded.save, loaded.restart], ["Export save", "Import save", "Begin the Cycle Anew"]);
  const s0 = await snap(page);
  eq("first paint: no ending discovered, seven unknown chips", [s0.tracker, s0.trackerChips], ["0 / 7", trackerFor([])]);
  eq("first paint: nothing is in storage", s0.stored, null);
  await learnProse(page);

  /* ================= 2. every ending by real clicks ================= */
  group(`2. every ending by real clicks (${chosen.length} of the walker's ${paths.length} paths)`);
  none("the walker has no dead end", deadEnds);
  eq("the walker still finds 519 paths", paths.length, 519);
  eq("the paths played reach all seven endings", ENDING_IDS.filter(id => chosen.some(p => p.end === id)), ENDING_IDS);
  eq("and show every one of the 32 screens",
    Object.keys(story.nodes).filter(id => !chosen.some(p => p.steps.some(s => s.id === id))), []);
  ok("and take every choice the story has",
    [...universe].filter(m => m.startsWith("took ")).length === new Set(chosen.flatMap(p => [...marksOf(p)].filter(m => m.startsWith("took ")))).size);

  const seen = [];
  const log = [];
  const totals = { prose: [], choices: [], status: [], focus: [], ending: [], tracker: [], restart: [] };
  for (let n = 0; n < chosen.length; n++) {
    const p = chosen[n], name = `path ${n + 1} (${prongOf(p)} to ${p.end}, ${p.picks.length} choices)`;
    const bad = await play(page, p, "click", { fromLoad: n === 0, log });
    for (const k of ["prose", "choices", "status", "focus", "ending"]) totals[k].push(...bad[k].map(b => `${name}, ${b}`));
    if (!seen.includes(p.end)) seen.push(p.end);
    const s = await snap(page);
    if (s.tracker !== `${seen.length} / 7` || JSON.stringify(s.trackerChips) !== JSON.stringify(trackerFor(seen)))
      totals.tracker.push(`${name}: tracker reads ${s.tracker} ${JSON.stringify(s.trackerChips.filter(c => c[1]).map(c => c[0]))}`);
    if (JSON.stringify(savedEndings(s)) !== JSON.stringify(seen) || JSON.parse(s.stored).__v !== SAVE_VERSION)
      totals.tracker.push(`${name}: the save holds ${s.stored}`);
    await restart(page);
    const r = await snap(page);
    const again = statusBad(r, story.initialState(), false, "after restart");
    if (r.title !== story.nodes.intro.title || again.length || r.tracker !== `${seen.length} / 7` || r.stored !== s.stored)
      totals.restart.push(`${name}: restart left "${r.title}" ${again.join(", ")} tracker ${r.tracker}`);
    if (r.active.id !== "nodeTitle") totals.focus.push(`${name}, after restart: focus is on ${r.active.tag}#${r.active.id}`);
  }
  none("every screen's title and prose are the story's, at every step", totals.prose);
  none("every screen offers the walker's choices, in order, with their marks, as buttons", totals.choices);
  none("the status bar shows the walker's state after every choice", totals.status);
  none("every ending shows Cycle Complete and no choice", totals.ending);
  none("each new ending lights its chip, moves the count and is written to the save at once", totals.tracker);
  none("Begin the Cycle Anew goes back to the first screen with a clean status and the endings kept", totals.restart);
  none("after every choice and every restart, focus is on the new screen's title", totals.focus);
  const sAll = await snap(page);
  eq("all seven are discovered", [sAll.tracker, sAll.trackerChips], ["7 / 7", trackerFor(ENDING_IDS)]);

  /* ================= 3. the seam, offered when the walker says ================= */
  group("3. the seam is offered exactly when the walker says");
  {
    const labelTo = next => { for (const e of log) for (const c of e.list) if (c.next === next) return c.label; return null; };
    const HOLLOW = labelTo("seam_answer"), NAME = labelTo("end_named"), ENTRANCE = labelTo("seam_walk");
    const split = (id, label, next) => {
      const at = log.filter(e => e.id === id);
      const on = at.filter(e => e.labels.includes(label)), says = at.filter(e => e.list.some(c => c.next === next));
      return { at: at.length, on: on.length, says: says.length, agree: at.every(e => e.labels.includes(label) === e.list.some(c => c.next === next)) };
    };
    const intro = log.filter(e => e.id === "intro");
    ok("the first screen offers it as its fourth and last choice, every time", !!ENTRANCE && intro.length === chosen.length &&
      intro.every(e => e.labels.length === 4 && e.labels[3] === ENTRANCE), `${intro.length} first screens`);
    const sock = split("core_confrontation", HOLLOW, "seam_answer");
    ok(`the socket offers the hollow to the walkers of the seam and to nobody else (${sock.on} of ${sock.at} arrivals)`,
      !!HOLLOW && sock.agree && sock.on > 0 && sock.on < sock.at && sock.on === sock.says, JSON.stringify(sock));
    const hol = split("seam_answer", NAME, "end_named");
    ok(`the hollow offers the name to a walker with a name of their own and empty hands, and to no other (${hol.on} of ${hol.at})`,
      !!NAME && hol.agree && hol.on > 0 && hol.on < hol.at && hol.on === hol.says, JSON.stringify(hol));
    const road = chosen.filter(p => prongOf(p) !== "seam");
    ok("a run down one of the three roads is never shown a seam screen",
      road.length > 0 && road.every(p => p.steps.every(s => !s.id.startsWith("seam_") && !["end_witness", "end_named"].includes(s.id))));
  }

  /* ================= 4. the save ================= */
  group("4. the save");
  await page.reload({ waitUntil: "load" });
  let s = await snap(page);
  eq("seven endings seen survive a reload", [s.tracker, s.trackerChips], ["7 / 7", trackerFor(ENDING_IDS)]);

  // The page keeps no place in a run, on purpose (its own comment at the
  // tracker: the save is which endings were seen, nothing else). Pinned as it
  // is: a reload part way through is the first screen again.
  await seed(page, null);
  await page.reload({ waitUntil: "load" });
  const part = chosen.find(p => p.picks.length >= 6);
  for (let i = 0; i < 3; i++) await page.click(choiceSel(part.picks[i]));
  s = await snap(page);
  ok("three choices in, the screen is the walker's fourth and nothing has been written",
    s.title === part.steps[3].title && s.stored === null && statusBad(s, JSON.parse(part.steps[2].after), false, "").length === 0, `"${s.title}" stored ${s.stored}`);
  await page.reload({ waitUntil: "load" });
  s = await snap(page);
  ok("a reload part way through is the first screen with a clean status: the page keeps no place in a run",
    s.title === story.nodes.intro.title && statusBad(s, story.initialState(), false, "").length === 0 && s.tracker === "0 / 7" && s.active.tag === "BODY",
    `"${s.title}" ${s.tracker}`);

  // A save from before the fourth prong: the five old endings, same key, same
  // version. The literal smoke.mjs loads through the slot, loaded by the page.
  const before958 = JSON.stringify({ seenEndings: [...OLD_ENDINGS], __v: SAVE_VERSION });
  await seed(page, before958);
  await page.reload({ waitUntil: "load" });
  s = await snap(page);
  eq("a save from before the fourth prong loads with its five, as 5 / 7", [s.tracker, s.trackerChips], ["5 / 7", trackerFor(OLD_ENDINGS)]);
  eq("and loading it rewrites nothing", s.stored, before958);
  const toWitness = chosen.find(p => p.end === "end_witness");
  none("that player walks the seam to The Count Kept", Object.values(await play(page, toWitness, "click", { fromLoad: true })).flat());
  s = await snap(page);
  eq("which is a sixth ending, written after the old five", [s.tracker, savedEndings(s)], ["6 / 7", [...OLD_ENDINGS, "end_witness"]]);

  await seed(page, JSON.stringify({ seenEndings: ["end_dire", "end_named"] }));
  await page.reload({ waitUntil: "load" });
  s = await snap(page);
  eq("a save with no version stamp loads", [s.tracker, s.trackerChips], ["2 / 7", trackerFor(["end_dire", "end_named"])]);

  await seed(page, JSON.stringify({ seenEndings: ["end_dire", "end_dire", "end_of_the_world", 7], __v: SAVE_VERSION }));
  await page.reload({ waitUntil: "load" });
  s = await snap(page);
  eq("an ending id the game does not have, and one listed twice, are dropped", [s.tracker, s.trackerChips], ["1 / 7", trackerFor(["end_dire"])]);

  await seed(page, "{not a save");
  await page.reload({ waitUntil: "load" });
  s = await snap(page);
  ok("a corrupt save is a fresh tracker and a page that still plays", s.tracker === "0 / 7" && s.title === story.nodes.intro.title && s.choices.length === 4, s.tracker);
  none("and no error on the way", page.__errs);

  /* ================= 5. Export and Import ================= */
  group("5. Export and Import through the save bar");
  // The bar builds an <a download> on a blob: URL and clicks it. The name and
  // the bytes are read off that anchor in place of a download folder, which
  // the two engines expose differently (Anathema's suite does the same).
  const armExport = p => p.evaluate(() => {
    window.__dl = null;
    const real = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (!this.download) return real.call(this);
      const dl = { name: this.download, text: null };
      window.__dl = dl;
      fetch(this.href).then(r => r.text()).then(t => { dl.text = t; });
    };
  });
  const importFile = (p, file) => setFiles(p, file, () => p.click('#saveControls [data-gvb="import"]'));

  const two = ["end_convergence", "end_witness"];
  await seed(page, JSON.stringify({ seenEndings: two, __v: SAVE_VERSION }));
  await page.reload({ waitUntil: "load" });
  await armExport(page);
  await page.click('#saveControls [data-gvb="export"]');
  const file = await until(page, () => window.__dl && window.__dl.text !== null && window.__dl);
  ok("Export hands over a file named for the game and the day", !!file && /^fracture-cycle-save-\d{4}-\d\d-\d\d\.json$/.test(file.name), file && file.name);
  let env = null;
  try { env = JSON.parse(file.text); } catch { /* reported below */ }
  ok("the file names the game and the version and holds the two endings seen",
    !!env && env.game === "fracture-cycle" && env.version === SAVE_VERSION && JSON.stringify(env.state.seenEndings) === JSON.stringify(two), file && file.text.slice(0, 120));
  s = await snap(page);
  eq("the bar says where it went", s.msg, "Saved to " + (file && file.name));

  const exported = path.join(tmp, "exported.json");
  fs.writeFileSync(exported, file ? file.text : "");
  await seed(page, null);
  await page.reload({ waitUntil: "load" });
  s = await snap(page);
  eq("with storage cleared the tracker is empty again", [s.tracker, s.stored], ["0 / 7", null]);
  await importFile(page, exported);
  await until(page, () => (document.querySelector(".gvb-save-msg") || {}).textContent);
  s = await snap(page);
  eq("Import shows the file's two endings at once and says so", [s.tracker, s.trackerChips, s.msg], ["2 / 7", trackerFor(two), "Save loaded."]);
  await page.reload({ waitUntil: "load" });
  s = await snap(page);
  eq("and they are there after a reload", [s.tracker, savedEndings(s)], ["2 / 7", two]);

  const junk = path.join(tmp, "junk.json");
  fs.writeFileSync(junk, "the count is finished");
  const keep = s.stored;
  await importFile(page, junk);
  await until(page, () => (document.querySelector(".gvb-save-msg") || {}).textContent);
  s = await snap(page);
  eq("a file that is not a save is refused by name and changes nothing", [s.msg, s.tracker, s.stored], ["That is not a valid fracture-cycle save.", "2 / 7", keep]);

  const old = path.join(tmp, "before-the-fourth-prong.json");
  fs.writeFileSync(old, before958);
  await page.reload({ waitUntil: "load" });
  await importFile(page, old);
  await until(page, () => (document.querySelector(".gvb-save-msg") || {}).textContent);
  s = await snap(page);
  eq("a file saved before the fourth prong imports as 5 / 7", [s.tracker, s.trackerChips, savedEndings(s)], ["5 / 7", trackerFor(OLD_ENDINGS), OLD_ENDINGS]);
  none("nothing in sections 4 and 5 raised an error", page.__errs);

  /* ================= 6. the keyboard alone ================= */
  group("6. the keyboard alone");
  {
    // An ordinary window, shorter than the page: keys do not care where a
    // button is. Storage is the browser's, shared with the page above.
    const kb = await open({ width: 1280, height: 800 });
    await boot(kb);
    await seed(kb, null);
    await kb.reload({ waitUntil: "load" });
    const routes = [chosen.find(p => p.end === "end_named"), [...chosen].filter(p => prongOf(p) !== "seam").sort((a, b) => b.picks.length - a.picks.length)[0]];
    for (let n = 0; n < routes.length; n++) {
      const p = routes[n], name = `${prongOf(p)} to ${p.end}, ${p.picks.length} choices`;
      const bad = await play(kb, p, "keys", { fromLoad: n === 0 });
      none(`${name}: every screen is the story's, by Tab, Enter and Space alone`, [...bad.prose, ...bad.choices, ...bad.status, ...bad.ending]);
      none(`${name}: each choice is as many Tabs away as its place in the list, and shows a ring`, bad.keys);
      none(`${name}: focus is on the new screen's title after every choice`, bad.focus);
      await kb.keyboard.press("Tab");
      let k = await snap(kb);
      eq(`${name}: from an ending, one Tab is Begin the Cycle Anew`, k.active.id, "restartBtn");
      await kb.keyboard.press("Enter");
      k = await snap(kb);
      eq(`${name}: Enter there is the first screen, with focus on its title`, [k.title, k.active.id, k.choices.length], [story.nodes.intro.title, "nodeTitle", 4]);
    }
    const k = await snap(kb);
    eq("both endings reached by keyboard are on the tracker", k.tracker, "2 / 7");
    none("no error on the keyboard page", kb.__errs);
  }

  /* ================= 7. reduced motion ================= */
  group("7. reduced motion");
  {
    const rm = await open({ width: 1280, height: 500 });
    const read = async on => {
      await setReduce(rm, on);
      await boot(rm);
      return rm.evaluate(() => {
        const moving = [...document.querySelectorAll("*")].filter(el =>
          getComputedStyle(el).transitionDuration.split(",").some(t => parseFloat(t) > 0) || getComputedStyle(el).animationName !== "none");
        window.scrollTo(0, 300);
        const asked = [];
        const real = window.scrollTo;
        window.scrollTo = function (...a) { asked.push(a[0] && typeof a[0] === "object" ? a[0].behavior || "auto" : "auto"); return real.apply(this, a); };
        const from = window.scrollY;
        document.querySelector("#choices .choice-btn").click();
        return { matches: matchMedia("(prefers-reduced-motion: reduce)").matches, moving: moving.length, from, to: window.scrollY, asked,
          title: document.getElementById("nodeTitle").textContent };
      });
    };
    const off = await read(false);
    ok("control, motion allowed: the page has transitions, and a choice asks for a smooth scroll to the top",
      !off.matches && off.moving > 5 && off.from === 300 && JSON.stringify(off.asked) === '["smooth"]', JSON.stringify(off));
    const on = await read(true);
    ok("under reduce no element has a transition or an animation", on.matches && on.moving === 0, JSON.stringify(on));
    ok("under reduce a choice goes to the top at once, not by a smooth scroll",
      on.from === 300 && on.to === 0 && on.asked.length === 1 && on.asked[0] !== "smooth", JSON.stringify(on));
    eq("and the choice is still taken", on.title, story.nodes.radiant_gate.title);
    none("no error on the reduced-motion page", rm.__errs);
  }

  /* ================= 8. nothing overflows ================= */
  group("8. nothing overflows at 360 px and at 1920 px");
  {
    const fits = p => p.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const name = el => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className ? "." + el.className.split(" ")[0] : "");
      const out = [];
      for (const el of document.querySelectorAll(".app, .app *")) {
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        if (r.right > w + 0.5 || r.left < -0.5) out.push(`${name(el)} ${Math.round(r.left)} to ${Math.round(r.right)} of ${w}`);
      }
      for (const el of document.querySelectorAll(".choice-btn, .tracker-chip, .frag-chip, #saveControls button, .restart-btn, .node-title, .node-text p"))
        if (el.scrollWidth > el.clientWidth + 1) out.push(`${name(el)} clips its text (${el.scrollWidth} in ${el.clientWidth})`);
      if (document.documentElement.scrollWidth > w) out.push(`the page is ${document.documentElement.scrollWidth} wide in ${w}`);
      const app = document.querySelector(".app").getBoundingClientRect();
      return { out, w, app: [Math.round(app.left), Math.round(app.width)], title: document.getElementById("nodeTitle").textContent };
    });
    const longest = pick => [...chosen].filter(pick).sort((a, b) => b.picks.length - a.picks.length)[0];
    const routes = [longest(p => p.end === "end_ascension"), longest(p => prongOf(p) === "seam")];
    for (const [width, height] of [[360, 5200], [1920, 2600]]) {
      const pg = await open({ width, height });
      // every ending already seen, so the tracker is at its widest throughout
      await boot(pg);
      await seed(pg, JSON.stringify({ seenEndings: ENDING_IDS, __v: SAVE_VERSION }));
      await pg.reload({ waitUntil: "load" });
      await pg.evaluate(() => document.fonts.ready);
      const bad = [];
      let screens = 0;
      for (const p of routes) {
        for (let i = 0; i < p.steps.length; i++) {
          const f = await fits(pg);
          screens++;
          if (f.title !== p.steps[i].title) bad.push(`step ${i + 1}: on "${f.title}", not "${p.steps[i].title}"`);
          bad.push(...f.out.map(o => `${p.steps[i].id}: ${o}`));
          if (i < p.picks.length) await pg.click(choiceSel(p.picks[i]));
        }
        await restart(pg);
      }
      none(`${width} px: nothing leaves the window or clips on any of ${screens} screens, with all seven chips lit`, bad);
      await armExport(pg);
      await pg.click('#saveControls [data-gvb="export"]');
      const f = await fits(pg);
      const msg = (await snap(pg)).msg;
      ok(`${width} px: nor with the save bar's message showing`, /^Saved to /.test(msg) && f.out.length === 0, `"${msg}" ${f.out.slice(0, 3).join(" ; ")}`);
      if (width === 1920) eq("1920 px: the column is 960 wide and centred", f.app, [480, 960]);
      else ok("360 px: the column is the window less its margins", f.app[0] === 16 && f.app[1] === 328, JSON.stringify(f.app));
      none(`no error on the ${width} px page`, pg.__errs);
    }
  }

  /* ================= 9. the whole run ================= */
  group("9. the whole run");
  none("no console error, page error or failed request on any page", pages.flatMap(p => p.__errs));
  none("no request off the site on any page", pages.flatMap(p => [...p.__blocked, ...p.__shimmed]));
  none("no response over 399 on any page", responses.filter(r => r.status > 399).map(r => `${r.status} ${r.url}`));
  none("every response came from this server", responses.filter(r => /^https?:/.test(r.url) && !r.url.startsWith(BASE + "/")).map(r => r.url));

} catch (e) {
  fail++;
  console.log(`  FAIL  the suite threw: ${e && e.stack || e}`);
} finally {
  await browser.close().catch(() => {});
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
