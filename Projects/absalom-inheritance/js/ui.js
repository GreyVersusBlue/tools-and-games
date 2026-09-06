// ui.js — panels, log, modals, input. Everything that touches the DOM.
//
// Two things here are not cosmetic:
//
//   Keyboard play. The shipped build had seven focusable buttons and no way to
//   reach any of the things they needed: moving, targeting and reading a pillar
//   were all canvas clicks, and the canvas was not focusable. Six of the seven
//   buttons were dead ends without a mouse. There is now a keyboard cursor —
//   arrows to move it, Enter to act on it, Tab to jump between things worth
//   acting on — and the whole adventure is finishable without a pointer.
//
//   The save bar lives on the board, not behind a title screen. v7 §9 has an
//   item open because The Fourth Quarter's bar is only on its start overlay, so
//   exporting mid-campaign means reloading the page. This one is in the left
//   panel, reachable on every turn.

import { mountSaveBar } from "../../../assets/js/gvb-save.js";
import { DEG_NAME } from "./rules.js";
import { TILE } from "./world.js";
import { CONDITIONS, describe } from "./conditions.js";

const $ = id => document.getElementById(id);

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
const fmtMod = n => (n >= 0 ? "+" : "") + n;

/**
 * The character picker. Called once, before `mountUI`, and only when there is
 * no save to load — `main.js` never shows this and a loaded save in the same
 * boot. Resolves with the chosen build's id.
 *
 * Takes the *unresolved* content (pcOptions plural, commandById covering every
 * build's commands) rather than a game, because there is no game yet: nothing
 * has been chosen for `selectPc` to resolve onto. Card copy is built from the
 * pack, same as every other panel in this file, so a third build never needs
 * a matching edit here.
 */
export function pickCharacter(content) {
  const veil = $("create-veil");
  const grid = $("create-grid");
  grid.innerHTML = "";
  return new Promise(resolve => {
    for (const pc of content.pcOptions) {
      const card = document.createElement("div");
      card.className = "pc-card";
      const cmdNames = pc.commands.map(id => content.commandById[id].name).join(" · ");
      card.innerHTML =
        `<h3 class="serif">${escapeHtml(pc.name)}</h3>` +
        `<div class="pc-title">${escapeHtml(pc.title)}</div>` +
        `<div class="pc-blurb">${escapeHtml(pc.blurb)}</div>` +
        `<div class="pc-stats">` +
        `<span>HP <b>${pc.hp}</b></span>` +
        `<span>AC <b>${pc.ac}</b></span>` +
        `<span>Speed <b>${pc.speed} ft</b></span>` +
        `<span>Fort <b>${fmtMod(pc.saves.fort)}</b></span>` +
        `<span>Ref <b>${fmtMod(pc.saves.ref)}</b></span>` +
        `<span>Will <b>${fmtMod(pc.saves.will)}</b></span>` +
        `</div>` +
        `<div class="pc-cmds">${escapeHtml(cmdNames)}</div>`;
      const begin = document.createElement("button");
      begin.type = "button";
      begin.className = "pc-begin";
      begin.textContent = `Begin as ${pc.name} →`;
      begin.addEventListener("click", () => {
        veil.classList.remove("open");
        resolve(pc.id);
      });
      card.appendChild(begin);
      grid.appendChild(card);
    }
    veil.classList.add("open");
    grid.querySelector(".pc-begin")?.focus();
  });
}

export function mountUI({ game, renderer, slot, onAdopt, onReset }) {
  const { content } = game;
  const canvas = $("game");

  /* ------------------------------------------------------------------ *
   * Static chrome from content, so the sheet cannot drift from the pack *
   * ------------------------------------------------------------------ */
  $("char-name").textContent = content.pc.name;
  $("char-sub").textContent = `${content.pc.title} · ${content.pc.note}`;
  $("ac-val").textContent = content.pc.ac;
  $("fort-val").textContent = fmt(content.pc.saves.fort);
  $("ref-val").textContent = fmt(content.pc.saves.ref);
  $("will-val").textContent = fmt(content.pc.saves.will);
  $("spell-val").textContent = `${content.pc.spellDC} / ${fmt(content.pc.spellAttack)}`;
  $("speed-val").textContent = `${content.pc.speed} ft`;
  $("slots-label").textContent = `Spell Slots · Rank 1`;
  $("bulk-note").textContent = content.bulkLimitNote;
  $("bulk-limit").textContent = content.bulkLimit;

  function fmt(n) { return (n >= 0 ? "+" : "") + n; }

  /* ------------------------------------------------------------------ *
   * Slot and focus gems, built from content rather than hardcoded       *
   * ------------------------------------------------------------------ */
  const slotGems = [], focusGems = [];
  const slotRow = $("slot-row"), focusRow = $("focus-row");
  for (let i = 0; i < content.pc.slots; i++) {
    const g = document.createElement("div");
    g.className = "slot-gem"; slotRow.appendChild(g); slotGems.push(g);
  }
  for (let i = 0; i < content.pc.focus; i++) {
    const g = document.createElement("div");
    g.className = "slot-gem focus"; focusRow.appendChild(g); focusGems.push(g);
  }

  /* ------------------------------------------------------------------ *
   * Command buttons, built from content                                *
   * ------------------------------------------------------------------ */
  const cmdButtons = new Map();
  const cmdCol = $("cmd-col");
  content.commands.forEach((cmd, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.cmd = cmd.id;
    b.id = "cmd-" + cmd.id;
    // A reaction has no number key, because there is nothing to press: it
    // fires from the trigger bus on somebody else's turn or it does not fire.
    // The row is here so a player can see what they own and whether it is
    // still up, which is the whole of what the panel can say about it.
    const reaction = cmd.kind === "reaction";
    if (reaction) b.classList.add("reaction");
    b.innerHTML = `<span>${reaction ? "" : `<kbd>${i + 1}</kbd> `}${escape(cmd.name)}` +
      (cmd.flavour ? ` <i class="subtle">(${escape(cmd.flavour)})</i>` : "") +
      `</span><span class="cost">${escape(cmd.costGlyph)}</span>`;
    b.title = cmd.note || cmd.hint;
    if (!reaction) b.addEventListener("click", () => pickCommand(cmd.id));
    cmdCol.appendChild(b);
    cmdButtons.set(cmd.id, b);
  });

  const endBtn = document.createElement("button");
  endBtn.type = "button";
  endBtn.id = "cmd-end";
  endBtn.innerHTML = `<span><kbd>E</kbd> End Turn</span><span class="cost">↻</span>`;
  endBtn.addEventListener("click", doEndTurn);
  cmdCol.appendChild(endBtn);

  function escape(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  /* ------------------------------------------------------------------ *
   * Log                                                                *
   * ------------------------------------------------------------------ */
  const logEl = $("log");
  function renderLogEntry(entry) {
    const div = document.createElement("div");
    div.className = "log-entry " + (entry.kind === "narrative" ? "narrative" : entry.kind === "info" ? "" : "dice");
    if (entry.kind === "dice" && entry.deg !== undefined) {
      div.innerHTML = `<span>${escape(entry.text)} — <span class="deg-${entry.deg}">${DEG_NAME[entry.deg]}</span></span>` +
        `<span class="math">${escape(entry.math || "")}</span>`;
    } else if (entry.math) {
      div.innerHTML = `<span>${escape(entry.text)}</span><span class="math">${escape(entry.math)}</span>`;
    } else {
      div.textContent = entry.text;
    }
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }
  /** Replay a loaded save's log so a reopened tab is not a blank page. */
  function replayLog() {
    logEl.innerHTML = "";
    for (const e of game.run.log) renderLogEntry(e);
  }

  /* ------------------------------------------------------------------ *
   * Panel refresh                                                      *
   * ------------------------------------------------------------------ */
  let armed = null;      // the id of a command waiting for a target

  function refresh() {
    const pc = game.run.pc, max = content.pc.hp;
    $("hp-label").textContent = `${pc.hp} / ${max}`;
    $("hp-bar").style.width = Math.max(0, 100 * pc.hp / max) + "%";
    $("ac-val").textContent = game.pcAC() + (game.shielded ? " ▲" : "");
    renderConditions();

    const inCombat = game.mode === "combat";
    const mine = game.isPCTurn();
    const left = game.actionsLeft;
    for (let i = 0; i < 3; i++) {
      $("pip" + i).classList.toggle("on", !inCombat || (mine && left > i));
    }
    $("action-note").textContent = !inCombat ? "Exploration"
      : mine ? `${left} left (MAP −${game.mapPenaltyNow(true)})`
        : "Enemy turn…";

    slotGems.forEach((g, i) => g.classList.toggle("full", pc.slots > i));
    focusGems.forEach((g, i) => g.classList.toggle("full", pc.focus > i));

    const banner = $("mode-banner");
    banner.textContent = game.mode === "over"
      ? (game.run.outcome === "victory" ? "The Inheritance is yours" : "The vault keeps its secret")
      : inCombat ? "⚔ Encounter — 3-Action Economy" : "Exploration Mode";
    banner.classList.toggle("combat", inCombat);

    for (const [id, b] of cmdButtons) {
      const why = game.commandBlocked(id);
      const cmd = content.commandById[id];
      if (cmd.kind === "reaction") {
        // Never clickable, and never greyed out for the ordinary reason an
        // action is: "not your turn" is exactly when a reaction is useful.
        // It dims only when it is genuinely unavailable — spent, or the disc
        // it needs is down.
        b.disabled = true;
        b.classList.toggle("spent", !!why);
        b.querySelector(".cost").textContent = why === "reaction-spent" ? "spent" : cmd.costGlyph;
      } else {
        b.disabled = !!why;
      }
      b.classList.toggle("armed", armed === id);
      if (cmd.consumes === "potion") {
        b.querySelector(".cost").textContent = `${cmd.costGlyph} ×${game.potionCount()}`;
      }
    }
    endBtn.disabled = !(inCombat && mine);

    $("hint").textContent = game.hint;
  }

  /**
   * The chips.
   *
   * Rebuilt whole on every refresh rather than diffed: there are never more
   * than a handful, and a diff is where "the chip that would not go away"
   * comes from. A chip carries its own value in its text because "Frightened"
   * and "Frightened 2" are different numbers on every roll the heir makes,
   * and the tooltip carries the rule so the sheet does not have to be read
   * next to the book.
   */
  const condRow = $("cond-row");
  function renderConditions() {
    condRow.innerHTML = "";
    for (const c of game.conditionsOf("pc")) {
      const def = CONDITIONS[c.id];
      const el = document.createElement("span");
      // Helpful and harmful chips read differently at a glance: the disc of
      // force is the gold the rest of the sheet is, a debuff is not.
      el.className = "chip" + (def && def.affects && def.affects.ac < 0 ? " bad" : "");
      el.textContent = describe(c);
      el.title = def ? def.note : "";
      condRow.appendChild(el);
    }
  }

  /* ------------------------------------------------------------------ *
   * Modals                                                             *
   * ------------------------------------------------------------------ */
  let lastFocus = null;
  function openModal(id) {
    lastFocus = document.activeElement;
    const veil = $(id);
    veil.classList.add("open");
    const focusable = veil.querySelector("button, [tabindex]");
    if (focusable) focusable.focus();
  }
  function closeModal(id) {
    $(id).classList.remove("open");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    else canvas.focus();
  }
  const anyModalOpen = () => !!document.querySelector(".modal-veil.open");

  for (const b of document.querySelectorAll("[data-close]")) {
    b.addEventListener("click", () => closeModal(b.dataset.close));
  }
  $("restart-btn").addEventListener("click", () => { closeModal("end-veil"); onReset(); });
  // One reset path, not two: mountSaveBar's own built-in "reset" button (below)
  // calls slot.reset() with no build id and hands back a default-build state,
  // which would restart silently as pcOptions[0] with no chance to pick again.
  // This button and the end screen's both go through the same onReset() —
  // clear the save, reload, and let the character picker fire like a fresh
  // visit — so "start over" means the same thing everywhere it appears.
  $("btn-restart").addEventListener("click", () => {
    if (!confirm("Erase this save and start over? This cannot be undone.")) return;
    onReset();
  });

  /* ------------------------------------------------------------------ *
   * Inventory                                                          *
   * ------------------------------------------------------------------ */
  function buildInventory() {
    const grid = $("inv-grid");
    grid.innerHTML = "";
    for (let s = 0; s < content.inventorySlots; s++) {
      const cell = document.createElement("div");
      cell.className = "inv-slot";
      cell.dataset.slot = s;
      cell.addEventListener("dragover", ev => { ev.preventDefault(); cell.classList.add("dragover"); });
      cell.addEventListener("dragleave", () => cell.classList.remove("dragover"));
      cell.addEventListener("drop", ev => {
        ev.preventDefault(); cell.classList.remove("dragover");
        const from = Number(ev.dataTransfer.getData("text/plain"));
        if (game.moveItem(from, s)) { buildInventory(); onAdopt(); }
      });
      const slotted = game.run.inventory.find(i => i.slot === s);
      if (slotted) {
        const item = content.items[slotted.item];
        const el = document.createElement("div");
        el.className = "inv-item";
        el.draggable = true;
        el.tabIndex = 0;
        el.setAttribute("role", "button");
        el.setAttribute("aria-label", `${item.name}, Bulk ${item.bulk}, slot ${s + 1}. Press Delete to discard.`);
        el.innerHTML = `<div class="glyph">${escape(item.glyph)}</div>` +
          `<div class="iname">${escape(item.name)}</div>` +
          `<div class="ibulk">Bulk ${escape(item.bulk)}</div>`;
        el.addEventListener("dragstart", ev => ev.dataTransfer.setData("text/plain", String(s)));
        // Keyboard equivalents for drag and drop: move with the arrows, discard
        // with Delete. A grid you can only reorder by dragging is a grid a
        // keyboard user cannot reorder.
        el.addEventListener("keydown", ev => {
          const cols = 4;
          const map = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
          if (map[ev.key] !== undefined) {
            ev.preventDefault(); ev.stopPropagation();
            const to = s + map[ev.key];
            if (to >= 0 && to < content.inventorySlots && game.moveItem(s, to)) {
              buildInventory(); onAdopt();
              const moved = $("inv-grid").querySelector(`[data-slot="${to}"] .inv-item`);
              if (moved) moved.focus();
            }
          } else if (ev.key === "Delete" || ev.key === "Backspace") {
            ev.preventDefault(); ev.stopPropagation();
            if (game.dropItem(s)) { buildInventory(); refresh(); onAdopt(); }
          }
        });
        cell.appendChild(el);
      }
      grid.appendChild(cell);
    }
    const drop = $("inv-drop");
    drop.ondragover = ev => { ev.preventDefault(); drop.classList.add("dragover"); };
    drop.ondragleave = () => drop.classList.remove("dragover");
    drop.ondrop = ev => {
      ev.preventDefault(); drop.classList.remove("dragover");
      const from = Number(ev.dataTransfer.getData("text/plain"));
      if (game.dropItem(from)) { buildInventory(); refresh(); onAdopt(); }
    };
    const bulk = game.bulkCarried();
    $("bulk-val").textContent = bulk.exact.toFixed(1);
    $("bulk-readout").classList.toggle("over", bulk.forEncumbrance > content.bulkLimit);
    refresh();
  }

  $("btn-inv").addEventListener("click", () => { buildInventory(); openModal("inv-veil"); });

  /* ------------------------------------------------------------------ *
   * Commands and targeting                                             *
   * ------------------------------------------------------------------ */
  function pickCommand(id) {
    const cmd = content.commandById[id];
    if (!cmd || game.commandBlocked(id)) return;

    // Commands that need no target fire immediately.
    if (["self-buff", "self-heal", "consume"].includes(cmd.kind)) {
      disarm();
      resolve(game.useCommand(id));
      return;
    }
    if (armed === id) { disarm(); game.setHint("Command cancelled."); refresh(); return; }
    armed = id;
    game.setHint(cmd.hint);
    if (cmd.kind === "cone") renderer.setAim(cursor);
    refresh();
    announce(cmd.hint);
  }

  function disarm() { armed = null; renderer.setAim(null); }

  /** Apply an armed command to a square. */
  function fireAt(x, y) {
    const cmd = content.commandById[armed];
    if (!cmd) return false;
    if (cmd.kind === "cone") {
      const r = game.useCommand(armed, { x, y });
      disarm(); resolve(r);
      return true;
    }
    const c = game.creatureAt(x, y);
    if (!c) { game.setHint("Pick a sentinel."); refresh(); return true; }
    const r = game.useCommand(armed, c.key);
    if (r.ok) disarm();
    resolve(r);
    return true;
  }

  /** After anything that changed the world: redraw, save, run enemy turns. */
  function resolve(result) {
    refresh();
    onAdopt();
    if (result && result.next) pumpEnemies(result.next);
    else if (game.mode === "combat" && !game.isPCTurn()) pumpEnemies(null);
  }

  function doEndTurn() {
    if (game.mode !== "combat" || !game.isPCTurn()) return;
    disarm();
    pumpEnemies(game.endTurn());
  }

  /**
   * Play back creature turns.
   *
   * The engine has already resolved them; this only paces the redraw so a
   * player can see a sentinel cross the floor. Nothing in the rules depends on
   * these timers, which is why an interrupted or throttled animation cannot
   * desynchronise the game from its own state (v7 §6: Chrome throttles a window
   * nobody is looking at, and this game used to animate inside the rules).
   */
  let pumping = false;
  async function pumpEnemies(first) {
    if (pumping) return;
    pumping = true;
    try {
      let step = first;
      if (!step && game.mode === "combat" && !game.isPCTurn()) step = game.advance();
      let guard = 0;
      while (step && step.actor !== "pc" && guard++ < 200) {
        refresh();
        renderer.draw();
        await sleep(280);
        step = game.advance();
      }
      refresh();
      onAdopt();
      if (game.mode === "over") showEnd();
    } finally {
      pumping = false;
    }
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ------------------------------------------------------------------ *
   * Pointer input                                                      *
   * ------------------------------------------------------------------ */
  canvas.addEventListener("mousemove", ev => {
    const r = canvas.getBoundingClientRect();
    const g = renderer.screenToGrid(ev.clientX - r.left, ev.clientY - r.top);
    renderer.setHover(g);
    if (armed && content.commandById[armed].kind === "cone") renderer.setAim(g);
  });
  canvas.addEventListener("mouseleave", () => renderer.setHover(null));

  canvas.addEventListener("click", ev => {
    const r = canvas.getBoundingClientRect();
    const g = renderer.screenToGrid(ev.clientX - r.left, ev.clientY - r.top);
    act(g.x, g.y);
  });

  /* ------------------------------------------------------------------ *
   * The one place a square gets acted on, whatever pointed at it        *
   * ------------------------------------------------------------------ */
  function act(x, y) {
    if (game.mode === "over" || pumping) return;
    if (x < 0 || y < 0 || x >= game.area.width || y >= game.area.height) return;

    if (armed && fireAt(x, y)) return;

    if (game.isPillar(x, y)) { const r = game.readPillar(x, y); refresh(); if (r.ok) onAdopt(); return; }
    if (game.tileAt(x, y) === TILE.GATE && !game.run.gateOpen) { game.touchGate(); refresh(); return; }

    const r = game.walkTo(x, y);
    refresh();
    if (r.ok) {
      cursor = { x: game.run.pc.x, y: game.run.pc.y };
      renderer.setCursor(cursor);
      onAdopt();
      if (game.mode === "over") { showEnd(); return; }
      if (game.mode === "combat" && !game.isPCTurn()) pumpEnemies(null);
    }
  }

  /* ------------------------------------------------------------------ *
   * Keyboard                                                           *
   * ------------------------------------------------------------------ */
  let cursor = { x: game.run.pc.x, y: game.run.pc.y };
  renderer.setCursor(cursor);

  canvas.setAttribute("tabindex", "0");
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label",
    "The vault floor. Arrow keys move the cursor, Enter acts on it, Tab cycles between " +
    "things worth acting on, number keys choose a command.");

  const STEP = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    // The board is isometric, so "up" on screen is diagonal on the grid. Both
    // readings are useful; the numpad gives the diagonals.
    Home: [-1, -1], PageUp: [1, -1], End: [-1, 1], PageDown: [1, 1],
  };

  /** Squares a keyboard player would plausibly want next. */
  function interestingSquares() {
    const out = [];
    for (const c of game.living()) {
      if (game.visible.has(c.x + "," + c.y)) out.push({ x: c.x, y: c.y, why: game.def(c).name });
    }
    for (const key of Object.keys(game.area.pillars)) {
      const [x, y] = key.split(",").map(Number);
      if (!game.explored.has(key)) continue;
      if (game.run.loreRead.includes(game.area.pillars[key])) continue;
      out.push({ x, y, why: content.lore[game.area.pillars[key]].title });
    }
    for (let y = 0; y < game.area.height; y++) {
      for (let x = 0; x < game.area.width; x++) {
        if (game.tileAt(x, y) !== TILE.TREASURE) continue;
        if (game.explored.has(x + "," + y)) out.push({ x, y, why: "the casket" });
      }
    }
    for (const key of Object.keys(game.area.stairs)) {
      const [x, y] = key.split(",").map(Number);
      if (game.explored.has(key)) out.push({ x, y, why: "a stairway" });
    }
    return out;
  }
  let cycle = -1;

  window.addEventListener("keydown", ev => {
    if (ev.key === "Escape") {
      if (anyModalOpen()) {
        for (const m of document.querySelectorAll(".modal-veil.open")) {
          if (m.id !== "end-veil") closeModal(m.id);
        }
      } else if (armed) { disarm(); game.setHint("Command cancelled."); refresh(); }
      return;
    }
    if (anyModalOpen()) {
      if (ev.key === "i" || ev.key === "I") { ev.preventDefault(); closeModal("inv-veil"); }
      return;
    }
    if (ev.key === "i" || ev.key === "I") {
      ev.preventDefault(); buildInventory(); openModal("inv-veil"); return;
    }
    if (ev.target.tagName === "BUTTON" && (ev.key === " " || ev.key === "Enter")) return;

    // Number keys pick a command.
    const n = Number(ev.key);
    if (n >= 1 && n <= content.commands.length) {
      ev.preventDefault();
      const cmd = content.commands[n - 1];
      if (cmd.kind !== "reaction") pickCommand(cmd.id);
      return;
    }
    if (ev.key === "e" || ev.key === "E") { ev.preventDefault(); doEndTurn(); return; }

    if (STEP[ev.key]) {
      ev.preventDefault();
      const [dx, dy] = STEP[ev.key];
      const nx = Math.max(0, Math.min(game.area.width - 1, cursor.x + dx));
      const ny = Math.max(0, Math.min(game.area.height - 1, cursor.y + dy));
      cursor = { x: nx, y: ny };
      renderer.setCursor(cursor);
      if (armed && content.commandById[armed].kind === "cone") renderer.setAim(cursor);
      describeCursor();
      return;
    }

    if (ev.key === "Tab") {
      const spots = interestingSquares();
      if (!spots.length) return;
      ev.preventDefault();
      cycle = (cycle + (ev.shiftKey ? -1 : 1) + spots.length) % spots.length;
      const s = spots[cycle];
      cursor = { x: s.x, y: s.y };
      renderer.setCursor(cursor);
      if (armed && content.commandById[armed].kind === "cone") renderer.setAim(cursor);
      announce(`Cursor on ${s.why}.`);
      return;
    }

    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      act(cursor.x, cursor.y);
      return;
    }
  });

  /** Say what the cursor is over, for a screen reader and for everyone else. */
  function describeCursor() {
    const { x, y } = cursor;
    const key = x + "," + y;
    if (!game.explored.has(key)) { announce("Unexplored dark."); return; }
    const c = game.creatureAt(x, y);
    if (c) {
      const bag = game.conditionsOf(c).map(describe).join(", ");
      announce(`${game.def(c).name}, ${c.hp} of ${game.def(c).hp} HP, ` +
        `${c.awake ? "awake" : "dormant"}${bag ? `, ${bag.toLowerCase()}` : ""}.`);
      return;
    }
    if (game.isPillar(x, y)) { announce("A carved pillar."); return; }
    const t = game.tileAt(x, y);
    if (t === TILE.WALL) { announce("Wall."); return; }
    if (t === TILE.GATE) { announce(game.run.gateOpen ? "The open gate." : "The sealed gate."); return; }
    if (t === TILE.TREASURE) { announce("The casket."); return; }
    if (t === TILE.STAIRS) { announce("A stairway onward."); return; }
    if (x === game.run.pc.x && y === game.run.pc.y) { announce("You are here."); return; }
    announce("Floor.");
  }

  const live = $("live");
  function announce(text) { live.textContent = text; }

  /* ------------------------------------------------------------------ *
   * End screen                                                         *
   * ------------------------------------------------------------------ */
  function showEnd() {
    const outcome = game.run.outcome;
    const block = outcome === "victory" ? content.treasure : content.defeat;
    $("end-title").textContent = block.title;
    $("end-body").innerHTML = block.body.map(p => `<p>${escape(p)}</p>`).join("") +
      `<p class="subtle">Rounds fought ${game.run.stats.rounds} · sentinels felled ` +
      `${game.run.stats.slain} · damage dealt ${game.run.stats.dealt} · taken ${game.run.stats.taken}.</p>`;
    openModal("end-veil");
  }

  /* ------------------------------------------------------------------ *
   * Engine events                                                      *
   * ------------------------------------------------------------------ */
  game.on(ev => {
    if (ev.type === "log") renderLogEntry(ev.entry);
    if (ev.type === "lore") {
      $("lore-title").textContent = ev.lore.title;
      $("lore-body").innerHTML = ev.lore.body.map(p => `<p>${escape(p)}</p>`).join("");
      openModal("lore-veil");
    }
    if (ev.type === "end") showEnd();
    if (ev.type === "hint") $("hint").textContent = ev.text;
    if (ev.type === "woke" || ev.type === "slept" || ev.type === "gate") refresh();
    if (ev.type === "condition") {
      refresh();
      // Out loud, both ways. A debuff a screen-reader user cannot hear is not
      // a mechanic — the chip and the marker are both silent, and the log
      // scrolls past. The creature's name rather than its key: "vault:
      // vault-keeper@11,1 is frightened 1" is a line nobody can use.
      const c = ev.actor === "pc" ? null : game.byKey(ev.actor);
      const who = ev.actor === "pc" ? content.pc.name : (c ? game.def(c).name : ev.actor);
      const what = CONDITIONS[ev.condition]?.name || ev.condition;
      announce(ev.value > 0
        ? `${who} is ${describe({ id: ev.condition, value: ev.value }).toLowerCase()}.`
        : `${who} is no longer ${what.toLowerCase()}.`);
    }
    if (ev.type === "area") {
      // A stairway swaps the whole board out from under the player. Any armed
      // command was aimed at the room they just left, and the keyboard cursor
      // has to land on the PC's new square rather than wherever it was parked.
      disarm();
      cycle = -1;
      cursor = { x: game.run.pc.x, y: game.run.pc.y };
      renderer.setCursor(cursor);
      refresh();
    }
  });

  /* ------------------------------------------------------------------ *
   * The save bar — in the panel, reachable during play                  *
   * ------------------------------------------------------------------ */
  // "reset" is deliberately not in this list — see the #btn-restart wiring
  // above for why the built-in one is the wrong shape for a game with more
  // than one buildable PC.
  mountSaveBar($("save-bar"), slot, {
    buttons: ["export", "import"],
    getState: () => game.snapshot(),
    setState: state => onAdopt(state),
    onMessage: text => { $("save-msg").textContent = text; announce(text); },
  });

  return { refresh, buildInventory, replayLog, showEnd, announce };
}
