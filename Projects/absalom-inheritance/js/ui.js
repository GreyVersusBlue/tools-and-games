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

const $ = id => document.getElementById(id);

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
    const key = i + 1;
    b.innerHTML = `<span><kbd>${key}</kbd> ${escape(cmd.name)}` +
      (cmd.flavour ? ` <i class="subtle">(${escape(cmd.flavour)})</i>` : "") +
      `</span><span class="cost">${escape(cmd.costGlyph)}</span>`;
    b.title = cmd.note || cmd.hint;
    b.addEventListener("click", () => pickCommand(cmd.id));
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
      b.disabled = !!why;
      b.classList.toggle("armed", armed === id);
      const cmd = content.commandById[id];
      if (cmd.consumes === "potion") {
        b.querySelector(".cost").textContent = `${cmd.costGlyph} ×${game.potionCount()}`;
      }
    }
    endBtn.disabled = !(inCombat && mine);

    $("hint").textContent = game.hint;
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
      pickCommand(content.commands[n - 1].id);
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
    if (c) { announce(`${game.def(c).name}, ${c.hp} of ${game.def(c).hp} HP, ${c.awake ? "awake" : "dormant"}.`); return; }
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
  mountSaveBar($("save-bar"), slot, {
    buttons: ["export", "import", "reset"],
    getState: () => game.snapshot(),
    setState: state => onAdopt(state),
    onMessage: text => { $("save-msg").textContent = text; announce(text); },
  });

  return { refresh, buildInventory, replayLog, showEnd, announce };
}
