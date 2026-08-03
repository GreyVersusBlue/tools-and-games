// game.js — the run. State, turns, triggers, and every rules call the player
// can make. Headless: no DOM, no canvas, no timers.
//
// Two things follow from headless, and both of them are the point:
//
//   1. test/balance.mjs can play ten thousand encounters under Node in a few
//      seconds, with a seeded RNG, and answer "is this fight winnable" with a
//      number instead of an adjective. It is: the shipped build was not, and
//      nothing short of measuring it would have said so.
//   2. Animation is the renderer's problem. An action that moves a creature
//      resolves instantly here and hands back the squares it crossed; ui.js
//      plays that back at whatever speed it likes. Nothing in the rules waits
//      on a setTimeout, so nothing in the rules can be raced by one.

import {
  DEG, DEG_NAME, check, rollDamage, basicSaveDamage, mapPenalty,
  feetBetween, isAdjacent, stridesFor,
} from "./rules.js";
import { makeWorld, TILE, packExplored, unpackExplored } from "./world.js";

export const LOG_MEMORY = 200;   // entries kept in RAM
export const LOG_SAVED = 60;     // entries written to a save

/**
 * Stable identity for a placed creature: the area, the id, and where it was
 * placed. The area has to be in the key now that more than one of them
 * exists — two areas can otherwise place the same creature id at the same
 * coordinates and collide.
 */
const placementKey = (areaId, pl) => `${areaId}:${pl.creature}@${pl.x},${pl.y}`;

/** Every creature in every area, flattened, each tagged with its area id. */
function allPlacements(content) {
  const out = [];
  for (const areaId of content.areaOrder) {
    for (const pl of content.areas[areaId].placements) out.push({ areaId, ...pl });
  }
  return out;
}

export function createGame({ content, rng = Math.random, state = null }) {
  const { tuning } = content;

  const listeners = new Set();
  const emit = ev => { for (const fn of listeners) fn(ev); };

  /* ------------------------------------------------------------------ *
   * Persistent state — everything a reload has to survive.             *
   * Runtime-only fields (turn order, actions left, the armed command)  *
   * live in `turn` below and are deliberately not saved.               *
   * ------------------------------------------------------------------ */
  const run = state || freshState();

  // The area the PC is currently in, and its world. Both are reassigned by
  // transitionTo() on a stairway; every function below reads them through
  // these closures rather than a value captured once at boot, which is what
  // lets a transition change the board under the renderer without it having
  // to know anything happened.
  let area = content.areas[run.areaId] || content.areas[content.startArea];
  let world = makeWorld(area);

  function freshState() {
    const startArea = content.areas[content.startArea];
    return {
      packId: content.pack.id,
      // content.pc is already the one build a caller resolved via selectPc()
      // before constructing this game — see content.js. Stamping its id here
      // keeps this internal fallback (used when no explicit state is passed,
      // mostly by tests) shaped the same as save.js's freshRun().
      buildId: content.pc.id,
      areaId: content.startArea,
      pc: {
        x: startArea.pcSpawn.x, y: startArea.pcSpawn.y,
        hp: content.pc.hp, slots: content.pc.slots, focus: content.pc.focus,
      },
      // Every area's creatures exist in the state from the start, not just the
      // one the PC is standing in — a construct in a room you have not opened
      // the door to yet still has to be there, dormant, when you arrive.
      creatures: allPlacements(content).map(pl => ({
        key: placementKey(pl.areaId, pl), area: pl.areaId, creature: pl.creature, wakesOn: pl.wakesOn,
        x: pl.x, y: pl.y, hp: content.creatures[pl.creature].hp,
        awake: false, dead: false,
      })),
      loreRead: [],
      gateOpen: false,
      fog: {},
      inventory: content.startingInventory.map((item, slot) => ({ item, slot })),
      log: [],
      stats: { rounds: 0, dealt: 0, taken: 0, woken: 0, slain: 0 },
      outcome: null,
    };
  }

  /* ------------------------------------------------------------------ *
   * Runtime turn state.                                                *
   * ------------------------------------------------------------------ */
  const turn = {
    mode: "explore",         // "explore" | "combat" | "over"
    queue: [],               // creature keys plus "pc", in initiative order
    idx: 0,
    actions: 3,
    attacks: 0,              // this turn's Multiple Attack Penalty counter
    shielded: false,         // Shield cantrip, until the start of your next turn
  };

  let explored = unpackExplored(run.fog[run.areaId], area.width, area.height);
  let visible = new Set();

  /* ------------------------------------------------------------------ *
   * Log                                                                *
   * ------------------------------------------------------------------ */
  function push(kind, text, math, deg) {
    const entry = { kind, text };
    if (math) entry.math = math;
    if (deg !== undefined) entry.deg = deg;
    run.log.push(entry);
    if (run.log.length > LOG_MEMORY) run.log.splice(0, run.log.length - LOG_MEMORY);
    emit({ type: "log", entry });
    return entry;
  }
  const narrative = t => push("narrative", t);
  const info = t => push("info", t);
  const dice = (t, math, deg) => push("dice", t, math, deg);

  /* ------------------------------------------------------------------ *
   * Actors                                                             *
   * ------------------------------------------------------------------ */
  const def = c => content.creatures[c.creature];
  // Scoped to the area the PC is standing in. A creature's state persists
  // while you are elsewhere, but it cannot occupy a square, wake, or fight
  // in a room its body is not in.
  const living = () => run.creatures.filter(c => c.area === run.areaId && !c.dead);
  const awake = () => run.creatures.filter(c => c.area === run.areaId && c.awake && !c.dead);
  const byKey = k => (k === "pc" ? null : run.creatures.find(c => c.key === k));

  function occupied(x, y, ignoreKey) {
    if (run.pc.x === x && run.pc.y === y && ignoreKey !== "pc") return true;
    return living().some(c => c.x === x && c.y === y && c.key !== ignoreKey);
  }
  const creatureAt = (x, y) => living().find(c => c.x === x && c.y === y) || null;

  const pathOpts = ignoreKey => ({
    gateOpen: run.gateOpen,
    occupied: (x, y) => occupied(x, y, ignoreKey),
  });

  /** Effective AC, including the Shield cantrip if it is up. */
  const pcAC = () => content.pc.ac + (turn.shielded ? (content.commandById.shield?.acBonus || 0) : 0);

  /* ------------------------------------------------------------------ *
   * Vision                                                             *
   * ------------------------------------------------------------------ */
  function recomputeVision() {
    visible = world.fieldOfView(run.pc.x, run.pc.y, tuning.visionFeet, run.gateOpen);
    for (const k of visible) explored.add(k);
    run.fog[run.areaId] = packExplored(explored, area.width, area.height);
  }

  /* ------------------------------------------------------------------ *
   * Damage and healing                                                 *
   * ------------------------------------------------------------------ */
  function hurtCreature(c, amount, math, type) {
    c.hp = Math.max(0, c.hp - amount);
    run.stats.dealt += amount;
    push("damage", `→ ${def(c).name} takes ${amount} ${type}`,
      `${math}  |  HP ${c.hp}/${def(c).hp}`);
    if (c.hp === 0) {
      c.dead = true; c.awake = false;
      run.stats.slain++;
      narrative(def(c).deathLine.replace("{name}", def(c).name));
      emit({ type: "died", key: c.key });
      checkTreasure();
      // Kill the last thing that was awake and the encounter is over now, not
      // when you get round to ending your turn. Waiting left the banner reading
      // "Encounter" over an empty floor, and left ordinary walking still being
      // charged as Strides.
      if (turn.mode === "combat" && !run.outcome && !awake().length) endCombat("cleared");
    }
  }

  function hurtPC(amount, math, type) {
    run.pc.hp = Math.max(0, run.pc.hp - amount);
    run.stats.taken += amount;
    push("damage", `→ ${content.pc.name} takes ${amount} ${type}`,
      `${math}  |  HP ${run.pc.hp}/${content.pc.hp}`);
    if (run.pc.hp === 0) finish("defeat");
  }

  function healPC(amount, math) {
    const before = run.pc.hp;
    run.pc.hp = Math.min(content.pc.hp, run.pc.hp + amount);
    push("damage", `→ ${content.pc.name} regains ${run.pc.hp - before} HP`,
      `${math}  |  HP ${run.pc.hp}/${content.pc.hp}`);
  }

  function finish(outcome) {
    if (run.outcome) return;
    run.outcome = outcome;
    turn.mode = "over";
    const block = outcome === "victory" ? content.treasure : content.defeat;
    emit({ type: "end", outcome, title: block.title, body: block.body });
  }

  /* ------------------------------------------------------------------ *
   * Waking, initiative, disengaging                                    *
   * ------------------------------------------------------------------ */

  /** Does this dormant creature notice the PC from where it stands? */
  function notices(c) {
    if (c.wakesOn !== "notice") return false;
    return feetBetween(c.x, c.y, run.pc.x, run.pc.y) <= tuning.noticeFeet
      && world.hasLoS(c.x, c.y, run.pc.x, run.pc.y, run.gateOpen);
  }

  /**
   * Wake one creature.
   *
   * The shipped build woke every sentinel the moment any one of them saw you,
   * which put a solo level-1 wizard against two creatures at once — 30 XP
   * against a 20 XP moderate budget for a one-PC party, and measurably a rout.
   * Creatures notice the PC one at a time now, and a fight already in progress
   * takes the newcomer into the existing initiative order rather than starting
   * over.
   */
  function wake(c) {
    if (c.awake || c.dead) return;
    c.awake = true;
    run.stats.woken++;
    narrative(def(c).wakeLine.replace("{name}", def(c).name));
    emit({ type: "woke", key: c.key });
    if (turn.mode === "combat") {
      const roll = check(def(c).perception, 0, rng);
      dice(`Initiative — ${def(c).name}`, `Perception: d20(${roll.natural}) +${def(c).perception} = ${roll.total}`, DEG.SUCC);
      // Slot it in after whoever is acting, so a creature that wakes mid-round
      // does not get a free turn ahead of the PC who just walked past it.
      turn.queue.splice(turn.idx + 1, 0, c.key);
    } else {
      startCombat();
    }
  }

  function startCombat() {
    turn.mode = "combat";
    run.stats.rounds++;
    const rolls = [];
    const pcRoll = check(content.pc.perception, 0, rng);
    dice(`Initiative — ${content.pc.name}`,
      `Perception: d20(${pcRoll.natural}) +${content.pc.perception} = ${pcRoll.total}`, DEG.SUCC);
    rolls.push({ key: "pc", total: pcRoll.total, isPC: true });
    for (const c of awake()) {
      const r = check(def(c).perception, 0, rng);
      dice(`Initiative — ${def(c).name}`,
        `Perception: d20(${r.natural}) +${def(c).perception} = ${r.total}`, DEG.SUCC);
      rolls.push({ key: c.key, total: r.total, isPC: false });
    }
    rolls.sort((a, b) => b.total - a.total || (a.isPC ? -1 : 1)); // PC wins ties
    turn.queue = rolls.map(r => r.key);
    turn.idx = -1;
    emit({ type: "mode", mode: "combat" });
    advance();
  }

  /**
   * A woken creature that cannot see the PC at the end of the PC's turn loses
   * interest, settles, and reknits to full HP.
   *
   * The full heal is the anti-cheese: without it, "wake it, hit it twice, step
   * behind a pillar, repeat" grinds any creature down at zero risk. With it,
   * breaking line of sight is an escape rather than an exploit, and the four
   * wall blocks flanking the pillars become cover worth using.
   */
  function checkDisengage() {
    let any = false;
    for (const c of awake()) {
      if (world.hasLoS(c.x, c.y, run.pc.x, run.pc.y, run.gateOpen)) continue;
      c.awake = false;
      c.hp = def(c).hp;
      narrative(def(c).sleepLine.replace("{name}", def(c).name));
      emit({ type: "slept", key: c.key });
      any = true;
    }
    if (any && !awake().length && turn.mode === "combat") endCombat("lost");
  }

  function endCombat(why) {
    turn.mode = "explore";
    turn.queue = []; turn.idx = 0; turn.actions = 3; turn.attacks = 0; turn.shielded = false;
    if (why === "cleared") narrative("Silence returns to the vault.");
    emit({ type: "mode", mode: "explore" });
    setHint(run.gateOpen ? content.gate.openHint : "The way is clear, for now.");
    // A standing condition, not an event, for the same reason checkTreasure()
    // below already is: a Stride taken mid-fight can land the PC exactly on a
    // stairway, and checkStairs() (by design) refuses to fire while combat is
    // still under way. `turn.mode` is "explore" again as of the top of this
    // function, so this is the first point it is safe to ask.
    if (checkStairs()) return;
    checkTreasure();
  }

  let hint = "";
  function setHint(t) { hint = t; emit({ type: "hint", text: t }); }

  /* ------------------------------------------------------------------ *
   * Turn order                                                         *
   * ------------------------------------------------------------------ */

  /**
   * Move to the next actor.
   *
   * Returns `{ actor: "pc" }` when it is the player's turn, or
   * `{ actor: key, script }` for a creature, where `script` is the list of
   * things it did — strides with their squares, strikes with their rolls — for
   * the renderer to play back. Nothing here sleeps.
   */
  function advance() {
    if (turn.mode !== "combat") return null;
    if (!awake().length) { endCombat("cleared"); return null; }

    for (let guard = 0; guard <= turn.queue.length + 1; guard++) {
      turn.idx = (turn.idx + 1) % turn.queue.length;
      if (turn.idx === 0) run.stats.rounds++;
      const key = turn.queue[turn.idx];
      if (key === "pc") {
        if (run.outcome) return null;
        turn.actions = 3;
        turn.attacks = 0;
        turn.shielded = false;      // Shield lapses at the start of your turn
        emit({ type: "turn", actor: "pc" });
        setHint("Your turn: 3 actions. Stride, Strike, or cast.");
        return { actor: "pc" };
      }
      const c = byKey(key);
      if (!c || c.dead || !c.awake) {
        // Dead or settled: drop it from the order rather than skipping it
        // every round forever.
        turn.queue.splice(turn.idx, 1);
        turn.idx--;
        if (!turn.queue.length || !awake().length) { endCombat("cleared"); return null; }
        continue;
      }
      emit({ type: "turn", actor: key });
      return { actor: key, script: runCreatureTurn(c) };
    }
    return null;
  }

  /** Resolve one creature's whole turn. Returns a playback script. */
  function runCreatureTurn(c) {
    const script = [];
    let actions = 3, attacks = 0;
    const d = def(c);

    while (actions > 0 && !c.dead && !run.outcome) {
      if (isAdjacent(c, run.pc)) {
        actions--;
        const pen = mapPenalty(attacks, false);
        attacks++;
        const r = check(d.attackBonus - pen, pcAC(), rng);
        dice(`${d.name} — ${d.attackName} vs ${content.pc.name} (AC ${pcAC()})`, r.math, r.deg);
        const step = { kind: "strike", target: "pc", deg: r.deg };
        if (r.deg >= DEG.SUCC) {
          const dmg = rollDamage(d.damage, rng);
          let total = dmg.total, math = dmg.math;
          if (r.deg === DEG.CRIT_SUCC) { total *= 2; math += ` ×2 (crit) = ${total}`; }
          step.damage = total;
          hurtPC(total, math, d.damageType);
        }
        script.push(step);
        continue;
      }

      // Stride toward the closest open square beside the PC.
      let best = null;
      for (const sq of world.adjacentOpen(run.pc.x, run.pc.y, pathOpts(c.key))) {
        const p = world.findPath(c.x, c.y, sq.x, sq.y, pathOpts(c.key));
        if (p && (!best || p[p.length - 1].g < best[best.length - 1].g)) best = p;
      }
      if (!best || best.length < 2) break;   // boxed in: end the turn
      let cut = best.length - 1;
      while (cut > 0 && best[cut].g > d.speed) cut--;
      if (cut === 0) break;
      actions--;
      const leg = best.slice(0, cut + 1);
      c.x = leg[leg.length - 1].x; c.y = leg[leg.length - 1].y;
      info(`${d.name} Strides ${leg[leg.length - 1].g} ft.`);
      script.push({ kind: "stride", path: leg.map(n => ({ x: n.x, y: n.y })) });
    }
    return script;
  }

  /** The player ends their turn. Disengage is checked here and nowhere else. */
  function endTurn() {
    if (turn.mode !== "combat") return null;
    checkDisengage();
    if (turn.mode !== "combat") return null;
    return advance();
  }

  const isPCTurn = () => turn.mode !== "combat" || turn.queue[turn.idx] === "pc";

  /* ------------------------------------------------------------------ *
   * Movement                                                           *
   * ------------------------------------------------------------------ */

  /**
   * Walk the PC toward (tx, ty).
   *
   * In exploration the walk is free and stops the moment something notices.
   * In an encounter it costs one Stride per Speed's worth of feet, refuses if
   * that is more actions than are left, and still stops on a trigger.
   */
  function walkTo(tx, ty) {
    if (run.outcome) return { ok: false, reason: "over" };
    if (!isPCTurn()) return { ok: false, reason: "not-your-turn" };
    if (!explored.has(tx + "," + ty)) {
      setHint("You can't see a path into the dark.");
      return { ok: false, reason: "unexplored" };
    }
    const path = world.findPath(run.pc.x, run.pc.y, tx, ty, pathOpts("pc"));
    if (!path || path.length < 2) {
      setHint("No path — the way is blocked.");
      return { ok: false, reason: "no-path" };
    }
    const feet = path[path.length - 1].g;

    if (turn.mode === "combat") {
      const strides = stridesFor(feet, content.pc.speed);
      if (strides > turn.actions) {
        setHint(`Too far: ${feet} ft needs ${strides} actions (you have ${turn.actions}).`);
        return { ok: false, reason: "too-far", feet, strides };
      }
      turn.actions -= strides;
      info(`Stride ×${strides} — ${feet} ft of movement (Speed ${content.pc.speed}).`);
    }

    // Walk it square by square so a trigger fires where it actually happens.
    const walked = [{ x: run.pc.x, y: run.pc.y }];
    let stoppedBy = null;
    for (let i = 1; i < path.length; i++) {
      run.pc.x = path[i].x; run.pc.y = path[i].y;
      walked.push({ x: path[i].x, y: path[i].y });
      recomputeVision();
      const trig = checkTriggers();
      if (trig) { stoppedBy = trig; break; }
    }
    recomputeVision();
    emit({ type: "moved", path: walked, stoppedBy });
    const spent = turn.mode === "combat" && turn.actions === 0;
    return { ok: true, path: walked, stoppedBy, exhausted: spent };
  }

  /**
   * Is the PC standing on the casket with nothing left guarding it?
   *
   * Called on every step, and also whenever a creature dies or an encounter
   * ends, because the winning condition is a standing state rather than an
   * event. The treasure chamber is four squares by four and two of them are the
   * casket, so a player who kills the Keeper while standing on the lid is the
   * common case, not the corner case. Checking this only on movement — which is
   * what it did first — left a third of the balance harness's runs finishing the
   * fight, standing on the prize, and never being told they had won.
   */
  function checkTreasure() {
    if (run.outcome) return null;
    if (area.tiles[run.pc.y][run.pc.x] !== TILE.TREASURE) return null;
    const guarded = content.treasure.requiresDown
      .some(id => run.creatures.some(c => c.creature === id && !c.dead));
    if (guarded) {
      setHint(content.treasure.blockedHint);
      return "treasure-blocked";
    }
    finish("victory");
    return "victory";
  }

  /**
   * Take the stairs, if the PC is standing on one.
   *
   * Only outside an encounter — leaving mid-fight is not a move the engine
   * offers a way to trigger by accident, since the only way onto a stairway
   * square during combat would be a Stride that also happened to end a fight,
   * and a creature disengaging when its target vanishes into another area is
   * a state nothing downstream is built to describe.
   */
  function checkStairs() {
    if (run.outcome || turn.mode === "combat") return null;
    const dest = area.stairs[run.pc.x + "," + run.pc.y];
    if (!dest) return null;
    transitionTo(dest);
    return "transitioned";
  }

  /**
   * Move the PC to another area.
   *
   * The current area's fog is banked under its own id in `run.fog` before the
   * switch, `area` and `world` are reassigned so every closure in this module
   * that reads them sees the new area on its next call, and vision is
   * recomputed fresh from the arrival square.
   */
  function transitionTo(dest) {
    const from = area;
    run.fog[from.id] = packExplored(explored, from.width, from.height);

    area = content.areas[dest.area];
    world = makeWorld(area);
    run.areaId = area.id;
    run.pc.x = dest.x;
    run.pc.y = dest.y;
    explored = unpackExplored(run.fog[area.id], area.width, area.height);
    visible = new Set();

    narrative(`— ${area.name} —`);
    recomputeVision();
    emit({ type: "area", areaId: area.id });
    checkTreasure();
  }

  /**
   * Everything that can happen because the PC is standing somewhere new.
   * Returns a reason string if the walk should stop here.
   */
  function checkTriggers() {
    for (const c of run.creatures) {
      if (c.area !== run.areaId) continue;
      if (!c.dead && !c.awake && notices(c)) { wake(c); return "noticed"; }
    }
    const stairs = checkStairs();
    if (stairs) return stairs;
    return checkTreasure();
  }

  /* ------------------------------------------------------------------ *
   * Pillars and the gate                                               *
   * ------------------------------------------------------------------ */
  function readPillar(x, y) {
    const loreId = area.pillars[x + "," + y];
    if (!loreId) return { ok: false, reason: "not-a-pillar" };
    if (feetBetween(run.pc.x, run.pc.y, x, y) > 5) {
      setHint("Move adjacent to the pillar to read it.");
      return { ok: false, reason: "too-far" };
    }
    if (run.loreRead.includes(loreId)) {
      info("You have already read this pillar.");
      return { ok: false, reason: "already-read" };
    }
    run.loreRead.push(loreId);
    const l = content.lore[loreId];
    if (l.logLine) narrative(l.logLine);
    emit({ type: "lore", lore: l });
    maybeOpenGate();
    return { ok: true, lore: l };
  }

  function maybeOpenGate() {
    if (run.gateOpen) return false;
    const need = content.gate.requiresLore;
    if (!need.length || !need.every(id => run.loreRead.includes(id))) return false;
    run.gateOpen = true;
    narrative(content.gate.openNarrative);

    // The seal's release is also the adventure's only rest. It exists so the
    // Keeper beyond the gate is a fight the player arrives at with spells, not
    // a fight they lose because they spent them on the way in.
    const restored = [];
    if (content.gate.restore.includes("slots") && run.pc.slots < content.pc.slots) {
      run.pc.slots = content.pc.slots; restored.push("slots");
    }
    if (content.gate.restore.includes("focus") && run.pc.focus < content.pc.focus) {
      run.pc.focus = content.pc.focus; restored.push("focus");
    }
    if (content.gate.restore.includes("hp") && run.pc.hp < content.pc.hp) {
      const amount = content.gate.restoreHp ?? content.pc.hp;
      const before = run.pc.hp;
      run.pc.hp = Math.min(content.pc.hp, run.pc.hp + amount);
      push("damage", `→ ${content.pc.name} regains ${run.pc.hp - before} HP`,
        `the seal's rest  |  HP ${run.pc.hp}/${content.pc.hp}`);
      restored.push("hp");
    }
    if (restored.length && content.gate.restoreNarrative) narrative(content.gate.restoreNarrative);

    for (const c of run.creatures) if (c.wakesOn === "gate-opened" && !c.dead) c.wakesOn = "notice";
    recomputeVision();
    setHint(content.gate.openHint);
    emit({ type: "gate", open: true });
    return true;
  }

  function touchGate() {
    if (run.gateOpen) return { ok: true };
    setHint(content.gate.sealedHint);
    info(content.gate.sealedLog);
    return { ok: false };
  }

  /* ------------------------------------------------------------------ *
   * Commands                                                           *
   * ------------------------------------------------------------------ */
  const potionCount = () => run.inventory.filter(i => i.item === "potion").length;

  /** Why a command is unavailable right now, or null if it is fine. */
  function commandBlocked(id) {
    const cmd = content.commandById[id];
    if (!cmd) return "unknown";
    if (run.outcome) return "over";
    if (turn.mode === "combat") {
      if (!isPCTurn()) return "not-your-turn";
      if (turn.actions < cmd.cost) return "actions";
    } else if (cmd.kind !== "consume") {
      return "explore";     // out of combat, only Interact-style commands apply
    }
    if (cmd.spendSlot && run.pc.slots < 1) return "slots";
    if (cmd.spendFocus && run.pc.focus < 1) return "focus";
    if (cmd.consumes && !run.inventory.some(i => i.item === cmd.consumes)) return "supply";
    return null;
  }

  function spend(cmd) {
    if (turn.mode === "combat") turn.actions -= cmd.cost;
    if (cmd.spendSlot) run.pc.slots--;
    if (cmd.spendFocus) run.pc.focus--;
    if (cmd.consumes) {
      const i = run.inventory.findIndex(it => it.item === cmd.consumes);
      if (i >= 0) run.inventory.splice(i, 1);
    }
  }

  /**
   * Run a command. `target` is a creature key for attack/unerring, or {x,y}
   * for a cone. Returns { ok, reason } — a refusal never mutates anything.
   */
  function useCommand(id, target) {
    const blocked = commandBlocked(id);
    if (blocked) return { ok: false, reason: blocked };
    const cmd = content.commandById[id];

    if (cmd.kind === "attack") {
      const c = byKey(target);
      if (!c || c.dead) return { ok: false, reason: "no-target" };
      if (!isAdjacent(c, run.pc)) { setHint("Not adjacent — Stride closer first."); return { ok: false, reason: "range" }; }
      spend(cmd);
      const pen = mapPenalty(turn.attacks, cmd.agile);
      turn.attacks++;
      const r = check(cmd.attackBonus - pen, def(c).ac, rng);
      dice(`${cmd.name} vs ${def(c).name} (AC ${def(c).ac})`, r.math, r.deg);
      if (r.deg >= DEG.SUCC) {
        const dmg = rollDamage(cmd.damage, rng);
        let total = dmg.total, math = dmg.math;
        if (r.deg === DEG.CRIT_SUCC) { total *= 2; math += ` ×2 (crit) = ${total}`; }
        hurtCreature(c, total, math, cmd.damageType);
      }
      return after(cmd, { ok: true, deg: r.deg });
    }

    if (cmd.kind === "unerring") {
      const c = byKey(target);
      if (!c || c.dead) return { ok: false, reason: "no-target" };
      const feet = feetBetween(run.pc.x, run.pc.y, c.x, c.y);
      if (feet > cmd.rangeFeet || !world.hasLoS(run.pc.x, run.pc.y, c.x, c.y, run.gateOpen)) {
        setHint(`No line of effect within ${cmd.rangeFeet} ft.`);
        return { ok: false, reason: "range" };
      }
      spend(cmd);
      info(`Cast ${cmd.name} (${cmd.costGlyph}${cmd.spendFocus ? ", 1 Focus Point" : ""}) — unerring.`);
      const dmg = rollDamage(cmd.damage, rng);
      hurtCreature(c, dmg.total, dmg.math, cmd.damageType);
      return after(cmd, { ok: true });
    }

    if (cmd.kind === "cone") {
      if (!target || typeof target.x !== "number") return { ok: false, reason: "no-target" };
      spend(cmd);
      info(`Cast ${cmd.name} (${cmd.costGlyph}${cmd.spendSlot ? ", spends a rank-1 slot" : ""}) — a ${cmd.coneFeet}-foot cone.`);
      // Cone approximation: within range, and within ±45° of the clicked
      // bearing. A true PF2e cone template is a different shape; this is close
      // enough on a 22-square grid and is documented rather than pretended.
      const ang = Math.atan2(target.y - run.pc.y, target.x - run.pc.x);
      const dmg = rollDamage(cmd.damage, rng);
      let hitAny = false;
      for (const c of living()) {
        if (feetBetween(run.pc.x, run.pc.y, c.x, c.y) > cmd.coneFeet) continue;
        let da = Math.atan2(c.y - run.pc.y, c.x - run.pc.x) - ang;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        if (Math.abs(da) > Math.PI / 4 + 0.01) continue;
        if (!world.hasLoS(run.pc.x, run.pc.y, c.x, c.y, run.gateOpen)) continue;
        hitAny = true;
        // A creature caught in a spell notices the caster, whatever it was doing.
        if (!c.awake) wake(c);
        const r = check(def(c).saves[cmd.save], content.pc.spellDC, rng);
        dice(`${def(c).name} — basic ${cmd.save === "ref" ? "Reflex" : cmd.save} save`, r.math, r.deg);
        const dealt = basicSaveDamage(r.deg, dmg.total);
        if (dealt > 0) {
          hurtCreature(c, dealt, `${dmg.math} → ${DEG_NAME[r.deg]} → ${dealt}`, cmd.damageType);
        } else {
          push("damage", `→ ${def(c).name} takes no damage`, "critical success on the save");
        }
      }
      if (!hitAny) info("The flames scorch empty stone — no creature in the cone.");
      return after(cmd, { ok: true });
    }

    if (cmd.kind === "self-buff") {
      spend(cmd);
      turn.shielded = true;
      info(`Cast ${cmd.name} (${cmd.costGlyph}) — AC ${content.pc.ac} → ${pcAC()} until your next turn.`);
      return after(cmd, { ok: true });
    }

    if (cmd.kind === "self-heal" || cmd.kind === "consume") {
      spend(cmd);
      info(turn.mode === "combat" && cmd.kind === "consume"
        ? `Interact (${cmd.costGlyph}): ${cmd.name.toLowerCase()}.`
        : `${cmd.name}.`);
      const h = rollDamage(cmd.healing, rng);
      healPC(h.total, h.math);
      return after(cmd, { ok: true });
    }

    return { ok: false, reason: "unhandled" };
  }

  /** Shared tail: an action that used the last action ends the turn. */
  function after(cmd, result) {
    emit({ type: "acted", command: cmd.id });
    if (turn.mode === "combat" && turn.actions <= 0 && !run.outcome) {
      result.turnEnded = true;
      result.next = endTurn();
    }
    return result;
  }

  /* ------------------------------------------------------------------ *
   * Inventory                                                          *
   * ------------------------------------------------------------------ */
  function bulkCarried() {
    let whole = 0, lights = 0;
    for (const slotted of run.inventory) {
      const it = content.items[slotted.item];
      if (!it) continue;
      if (it.bulk === "L") lights++; else whole += it.bulk;
    }
    // 10 Light items make 1 Bulk (Player Core p.271). The leftover tenths are
    // shown so the readout moves when you pick something up; encumbrance uses
    // the whole number.
    return { exact: whole + lights / 10, forEncumbrance: whole + Math.floor(lights / 10) };
  }

  function moveItem(fromSlot, toSlot) {
    const item = run.inventory.find(i => i.slot === fromSlot);
    if (!item) return false;
    if (toSlot < 0 || toSlot >= content.inventorySlots) return false;
    const occupant = run.inventory.find(i => i.slot === toSlot);
    if (occupant) occupant.slot = fromSlot;
    item.slot = toSlot;
    return true;
  }

  function dropItem(fromSlot) {
    const i = run.inventory.findIndex(it => it.slot === fromSlot);
    if (i < 0) return false;
    info(`Discarded: ${content.items[run.inventory[i].item].name}.`);
    run.inventory.splice(i, 1);
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Boot                                                               *
   * ------------------------------------------------------------------ */
  function begin() {
    recomputeVision();
    // A save could in principle land the PC exactly on a stairway (mid-combat
    // autosave, or a hand-built state in a test) with nothing awake to trigger
    // a re-check of it. checkStairs() re-runs recomputeVision() for the new
    // area itself when it fires, so nothing here needs to know which area it
    // ends up looking at next.
    checkStairs();
    // A save can have been written with the PC already standing on an unguarded
    // casket — the win is a standing state, so booting has to look at it too.
    checkTreasure();
    if (run.outcome) { emit({ type: "mode", mode: "over" }); return; }
    // A restored save can land mid-encounter. Rather than trying to rebuild a
    // half-finished round, initiative is re-rolled: the creatures that were
    // awake are still awake, still hurt, still where they stood.
    if (awake().length) startCombat();
    else emit({ type: "mode", mode: turn.mode });
  }

  return {
    content, run, turn,
    // world and area are getters, not plain fields, because transitionTo()
    // reassigns both when the PC takes a stairway — a plain field captured
    // once at construction would still point at the area the PC left.
    get world() { return world; },
    get area() { return area; },

    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    begin,

    // queries
    get mode() { return run.outcome ? "over" : turn.mode; },
    get hint() { return hint; },
    get visible() { return visible; },
    get explored() { return explored; },
    get actionsLeft() { return turn.mode === "combat" ? turn.actions : 3; },
    get shielded() { return turn.shielded; },
    get currentActor() { return turn.mode === "combat" ? turn.queue[turn.idx] : null; },
    pcAC, isPCTurn, creatureAt, byKey, def, living, awake, occupied,
    potionCount, bulkCarried, commandBlocked,
    isPillar: (x, y) => !!area.pillars[x + "," + y],
    tileAt: (x, y) => area.tiles[y]?.[x],
    mapPenaltyNow: agile => mapPenalty(turn.attacks, agile),

    // actions
    walkTo, useCommand, endTurn, advance, readPillar, touchGate,
    moveItem, dropItem, setHint,

    // for the save layer
    snapshot() {
      return {
        ...run,
        log: run.log.slice(-LOG_SAVED),
        creatures: run.creatures.map(c => ({ ...c })),
        pc: { ...run.pc },
        inventory: run.inventory.map(i => ({ ...i })),
        stats: { ...run.stats },
        // A fresh object, not the live one — run.fog keeps mutating after this
        // is handed to the save layer, and an aliased object would let a later
        // move rewrite a snapshot an autosave has not flushed yet.
        fog: { ...run.fog },
      };
    },
  };
}
