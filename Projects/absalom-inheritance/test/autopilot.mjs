// autopilot.mjs — a competent player, expressed as code.
//
// Shared by test/balance.mjs (ten thousand runs, is it winnable) and
// test/smoke.mjs (one run, does it reach the end). It is deliberately not an
// optimal player: it spends resources roughly the way a person who has read the
// spell list would, and it never reads state a player cannot see. If the
// autopilot's win rate is the number we tune against, an autopilot that cheats
// tunes the game for a cheater.

import { feetBetween, isAdjacent } from "../js/rules.js";
import { TILE } from "../js/world.js";

/** Walk toward a square through the fog, one visible leg at a time. */
export function travel(game, tx, ty, { maxLegs = 80 } = {}) {
  const startArea = game.run.areaId;
  for (let leg = 0; leg < maxLegs; leg++) {
    if (game.run.outcome) return "over";
    // Mode before position: the last step of a walk can both arrive and wake
    // something, and the caller needs to hear about the encounter. Reporting
    // "arrived" there loses the fight entirely.
    if (game.mode === "combat") return "combat";
    // A stairway can redirect the walk into another area entirely — (tx, ty)
    // was a square in the area the PC just left, so it cannot still be the
    // destination once the area has changed under it.
    if (game.run.areaId !== startArea) return "arrived";
    if (game.run.pc.x === tx && game.run.pc.y === ty) return "arrived";

    const path = game.world.findPath(game.run.pc.x, game.run.pc.y, tx, ty, {
      gateOpen: game.run.gateOpen,
      occupied: (x, y) => game.occupied(x, y, "pc"),
    });
    if (!path || path.length < 2) return "no-path";

    // Furthest waypoint already explored — the engine refuses to path into
    // squares the PC has never seen, same as a clicking player.
    let pick = null;
    for (const n of path.slice(1)) if (game.explored.has(n.x + "," + n.y)) pick = n;
    if (!pick) return "fogged";

    const before = game.run.pc.x + "," + game.run.pc.y;
    game.walkTo(pick.x, pick.y);
    if (game.run.pc.x + "," + game.run.pc.y === before) return "stuck";
  }
  return "too-many-legs";
}

/** One PC turn's worth of decisions. Returns true if it spent an action. */
export function combatPolicy(game) {
  const pc = game.run.pc;
  const maxHp = game.content.pc.hp;
  const live = game.awake();
  if (!live.length) return false;

  const dist = c => feetBetween(pc.x, pc.y, c.x, c.y);
  const canSee = c => game.world.hasLoS(pc.x, pc.y, c.x, c.y, game.run.gateOpen);
  const actions = game.actionsLeft;

  // Bleeding out beats everything.
  if (pc.hp <= maxHp * 0.4 && game.potionCount() && !game.commandBlocked("potion")) {
    return game.useCommand("potion").ok;
  }

  // Breathe Fire when it catches somebody. Aim at the closest target in range;
  // anything else inside the cone is a bonus.
  if (!game.commandBlocked("breathe")) {
    const cone = game.content.commandById.breathe.coneFeet;
    const inCone = live.filter(c => dist(c) <= cone && canSee(c))
      .sort((a, b) => dist(a) - dist(b));
    if (inCone.length) return game.useCommand("breathe", { x: inCone[0].x, y: inCone[0].y }).ok;
  }

  // Force Fang never misses, so spend it on whatever is closest to dying.
  if (!game.commandBlocked("fang")) {
    const reach = game.content.commandById.fang.rangeFeet;
    const targets = live.filter(c => dist(c) <= reach && canSee(c)).sort((a, b) => a.hp - b.hp);
    if (targets.length) return game.useCommand("fang", targets[0].key).ok;
  }

  const adj = live.find(c => isAdjacent(c, pc));
  if (adj && !game.commandBlocked("strike")) {
    // A third Strike at −8 is worth less than the Shield it displaces.
    if (actions === 1 && game.mapPenaltyNow(true) >= 8 && !game.commandBlocked("shield")) {
      return game.useCommand("shield").ok;
    }
    return game.useCommand("strike", adj.key).ok;
  }

  // Nothing in reach: close on the nearest one.
  const target = [...live].sort((a, b) => dist(a) - dist(b))[0];
  const squares = game.world.adjacentOpen(target.x, target.y, {
    gateOpen: game.run.gateOpen,
    occupied: (x, y) => game.occupied(x, y, "pc"),
  });
  let best = null;
  for (const sq of squares) {
    const p = game.world.findPath(pc.x, pc.y, sq.x, sq.y, {
      gateOpen: game.run.gateOpen,
      occupied: (x, y) => game.occupied(x, y, "pc"),
    });
    if (p && (!best || p[p.length - 1].g < best[best.length - 1].g)) best = p;
  }
  if (best) {
    let cut = best.length - 1;
    while (cut > 0 && best[cut].g > game.content.pc.speed * actions) cut--;
    if (cut > 0 && game.walkTo(best[cut].x, best[cut].y).ok) return true;
  }

  // Boxed in or out of reach: brace.
  if (!game.commandBlocked("shield")) return game.useCommand("shield").ok;
  return false;
}

/** Play an encounter out to its end. */
export function fight(game, { maxTurns = 200 } = {}) {
  let guard = 0;
  while (game.mode === "combat" && !game.run.outcome) {
    if (++guard > maxTurns) throw new Error("fight(): encounter did not terminate");
    if (game.isPCTurn()) {
      const spent = combatPolicy(game);
      if (!spent || game.actionsLeft <= 0) {
        let r = game.endTurn();
        while (r && r.actor !== "pc") r = game.advance();
      }
    } else {
      let r = game.advance();
      while (r && r.actor !== "pc") r = game.advance();
    }
  }
}

/**
 * Every goal worth walking to, area by area, in the order the adventure
 * intends them to be visited (`content.areaOrder`). A stairway is a goal like
 * any other square — walking onto it is what fires the transition — and it
 * has to come before the goals in whatever area it leads to, or the autopilot
 * would try to path to a square in a room it has not entered yet.
 */
function collectGoals(content) {
  const goals = [];
  for (const areaId of content.areaOrder) {
    const a = content.areas[areaId];
    for (const key of Object.keys(a.pillars)) {
      const [x, y] = key.split(",").map(Number);
      goals.push({ kind: "pillar", x, y });
    }
    // One goal per destination, not one per stairway square — two squares
    // leading to the same place (a wide stairway, like the vault's) would
    // otherwise queue a second travel to a square in the area the first one
    // already left.
    const seenDest = new Set();
    for (const key of Object.keys(a.stairs || {})) {
      const dest = a.stairs[key].area;
      if (seenDest.has(dest)) continue;
      seenDest.add(dest);
      const [x, y] = key.split(",").map(Number);
      goals.push({ kind: "stairs", x, y });
    }
    let treasureTaken = false;
    for (let y = 0; y < a.height && !treasureTaken; y++) {
      for (let x = 0; x < a.width; x++) {
        if (a.tiles[y][x] === TILE.TREASURE) { goals.push({ kind: "treasure", x, y }); treasureTaken = true; break; }
      }
    }
  }
  return goals;
}

/**
 * Play the whole adventure: every pillar, the gate, every stairway, the
 * casket, fighting whatever wakes on the way. Returns how it ended and what
 * it cost.
 */
export function playThrough(game, { maxPhases = 60 } = {}) {
  game.begin();
  const goals = collectGoals(game.content);

  let phases = 0;
  for (const goal of goals) {
    while (!game.run.outcome) {
      if (++phases > maxPhases) return summarise(game, "stalled");
      if (game.mode === "combat") { fight(game); continue; }

      if (goal.kind === "pillar") {
        // Stand next to the pillar, not on it.
        const spots = game.world.adjacentOpen(goal.x, goal.y, {
          gateOpen: game.run.gateOpen,
          occupied: (x, y) => game.occupied(x, y, "pc"),
        }).sort((a, b) =>
          feetBetween(game.run.pc.x, game.run.pc.y, a.x, a.y) -
          feetBetween(game.run.pc.x, game.run.pc.y, b.x, b.y));
        if (!spots.length) break;
        const r = travel(game, spots[0].x, spots[0].y);
        if (r === "combat") continue;
        if (r !== "arrived") break;
        game.readPillar(goal.x, goal.y);
        break;
      }

      const r = travel(game, goal.x, goal.y);
      if (r === "combat") continue;
      if (r !== "arrived" && !game.run.outcome) break;
      break;
    }
    if (game.run.outcome) break;
  }
  return summarise(game, game.run.outcome || "unfinished");
}

function summarise(game, outcome) {
  return {
    outcome,
    hp: game.run.pc.hp,
    slots: game.run.pc.slots,
    focus: game.run.pc.focus,
    potions: game.potionCount(),
    lore: game.run.loreRead.length,
    gateOpen: game.run.gateOpen,
    slain: game.run.stats.slain,
    woken: game.run.stats.woken,
    rounds: game.run.stats.rounds,
    dealt: game.run.stats.dealt,
    taken: game.run.stats.taken,
  };
}
