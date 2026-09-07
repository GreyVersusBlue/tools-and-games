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

/**
 * Find this build's command of a given kind, if it has one and it is usable
 * right now. A build lists which commands it has in `content.pc.commands`
 * (content.js's `selectPc` has already narrowed `content.commandById` to just
 * those), so this reads off the resolved content rather than a fixed id —
 * the same policy plays a Wizard's cone-and-unerring kit or a Fighter's bare
 * Strike without knowing which build it was handed. Ids are not a safe way to
 * pick "the attack command": two builds' attacks are named differently
 * (`strike`, `strike-sword`) precisely because their numbers differ.
 */
function findUsable(game, kind) {
  for (const cmd of game.content.commands) {
    if (cmd.kind === kind && !game.commandBlocked(cmd.id)) return cmd;
  }
  return null;
}

/** Every command in this build that heals the heir and can be used right now. */
function healers(game) {
  return game.content.commands.filter(cmd =>
    (cmd.kind === "consume" || cmd.kind === "self-heal") && cmd.healing && !game.commandBlocked(cmd.id));
}

/** The mean of a parsed damage spec — `{ n, s, plus }`, as rules.js writes it. */
function meanDamage(spec) {
  return spec.n * (spec.s + 1) / 2 + spec.plus;
}

/**
 * This build's buff, if it has one and it is not already standing.
 *
 * `game.shielded` used to answer the second half, and it names the Shield
 * cantrip's own condition: the day a second build shipped a second buff, the
 * policy would have recast it every single turn and nothing about the line
 * would have looked wrong. What the condition is comes off the command's own
 * `applies` block, so no build is named here either.
 */
function buffWorthCasting(game) {
  const cmd = findUsable(game, "buff");
  if (!cmd) return null;
  return game.conditionsOf("pc").some(c => c.id === cmd.applies.condition) ? null : cmd;
}

/**
 * How an area command would land, best aim first.
 *
 * One creature per candidate aim — a cone pointed at it, or a burst centred on
 * it — scored by how many creatures the *engine* says that shape covers.
 * Centring on a creature is not the optimal placement; the true optimum for a
 * burst is somewhere between two of them. But it is what a person clicking
 * does, and it never has to guess, because the count comes from
 * `game.templateSquares` — the same call the resolution makes. A shape this
 * scores as catching two cannot resolve as catching one, and the old policy
 * could not say that: it counted "within coneFeet and visible", which is a
 * circle, and the cone is a quarter of one.
 *
 * An emanation has no aim at all, so it gets exactly one entry.
 */
function placements(game, cmd, live) {
  const aims = cmd.kind === "emanation"
    ? [null]
    : live.map(c => ({ x: c.x, y: c.y }));
  const out = [];
  for (const aim of aims) {
    if (cmd.kind === "burst" && !game.canPlaceBurst(cmd, aim)) continue;
    const squares = game.templateSquares(cmd, aim);
    if (!squares) continue;
    const covered = new Set(squares.map(s => s.x + "," + s.y));
    out.push({ aim, caught: live.filter(t => covered.has(t.x + "," + t.y)).length });
  }
  return out.sort((a, b) => b.caught - a.caught);
}

const bestPlacement = (game, cmd, live) => (cmd ? placements(game, cmd, live)[0] : null) || { caught: 0 };

/**
 * One PC turn's worth of decisions. Returns true if it spent an action.
 *
 * `tally` is an optional counter of which commands got cast, so balance.mjs
 * can report that a shape the pack ships actually goes off. Last phase found
 * two pieces of content that validated at load and were never once reached in
 * a number this project had quoted; counting is cheaper than finding that out
 * again.
 */
export function combatPolicy(game, tally = null) {
  const use = (id, target) => {
    const r = game.useCommand(id, target);
    if (r.ok && tally) tally[id] = (tally[id] || 0) + 1;
    return r.ok;
  };
  return decide(game, use);
}

function decide(game, use) {
  const pc = game.run.pc;
  const maxHp = game.content.pc.hp;
  const live = game.awake();
  if (!live.length) return false;

  const dist = c => feetBetween(pc.x, pc.y, c.x, c.y);
  // Line of *effect*, not sight, because that is what the engine refuses an
  // unerring spell on: the gate is bars now, and a policy that picked a target
  // it could see through them would spend the turn on a refusal.
  const canReach = c => game.world.hasLoE(pc.x, pc.y, c.x, c.y, game.run.gateOpen);
  const actions = game.actionsLeft;

  // Bleeding out beats everything, and what it drinks or casts is whichever
  // of this build's healing commands puts the most back. It used to name
  // "potion" — the one command id every build listed — and a Cleric whose
  // rank-1 Heal returns twelve and a half points would have drunk a potion
  // for four and a half because the policy had learned a word. The two kinds
  // that heal the heir are `consume` and `self-heal`, and `commandBlocked`
  // already refuses the one with no potion left and the one with no slot.
  if (pc.hp <= maxHp * 0.4) {
    const heal = healers(game).sort((a, b) => meanDamage(b.healing) - meanDamage(a.healing))[0];
    if (heal) return use(heal.id);
  }

  // On fire, with something in the kit that puts it out. Rousing Splash heals
  // a little and rolls a better flat check than standing there does, and it is
  // the only command in this pack whose worth a policy reading HP alone could
  // never see: the heir is not low, she is burning, and the two are different
  // reasons to spend two actions. Read off `ends` rather than the id, the same
  // way everything else here reads off `kind`.
  const dousing = findUsable(game, "self-heal");
  if (dousing && dousing.ends
      && game.conditionsOf("pc").some(c => c.id === dousing.ends.condition)) {
    return use(dousing.id);
  }

  // The two slot spells, weighed against each other rather than in a fixed
  // order. Breathe Fire rolls 2d6 and Ember Burst 1d6, and they come out of
  // the same two slots, so the burst has to catch twice as many to be worth
  // one: two in the burst against one in the cone, or anything at all when the
  // cone reaches nobody. That last case is the one that matters most to a
  // 15 HP wizard — a cone starts at her, so "nothing is in the cone" usually
  // means "the sentinel is still crossing the floor", and thirty feet of burst
  // range is how she answers it without walking into reach.
  const cone = findUsable(game, "cone");
  const burst = findUsable(game, "burst");
  const coneAim = bestPlacement(game, cone, live);
  const burstAim = bestPlacement(game, burst, live);
  if (burstAim.caught >= 1 && burstAim.caught >= 2 * coneAim.caught) {
    return use(burst.id, burstAim.aim);
  }
  if (coneAim.caught >= 1) return use(cone.id, coneAim.aim);

  // An emanation, if this build has one. Centred on the heir, so there is
  // nothing to aim, and its case is not reach — it is that a basic save rolls
  // no attack and so takes no multiple attack penalty. She leads with the
  // dagger and follows with the ring, because the swing the ring displaces is
  // the one at −4.
  //
  // The rule this replaces was "two in the ring, or one the dagger cannot
  // reach", and it cast the spell zero times in 2,000 runs. Sampling 9,100
  // wizard decisions says why: an awake construct stood at 5 feet or at 25 and
  // beyond, and never once at 10, 15 or 20. A sentinel's Stride closes the
  // whole floor in one turn, so "inside the ring, outside the dagger" is a
  // square this adventure never produces, and two constructs on her at once is
  // a fight it never starts. Both halves of that rule were describing a
  // different adventure.
  const pulse = findUsable(game, "emanation");
  if (pulse) {
    const ring = bestPlacement(game, pulse, live);
    // Only the zero matters here, so the agile flag does not: what is being
    // asked is whether she has already swung this turn.
    const swungAlready = game.mapPenaltyNow(false) > 0;
    // Never with the last action, so long as this build has a disc to put up
    // with it. The ring is worth more than the swing it displaces and less
    // than the disc, and a three-action turn holds all three: Strike, ring,
    // disc. Without this the pulse takes the last action too and Shield goes
    // back to being a thing the policy owns and does not use.
    const keepLastForDisc = actions <= pulse.cost && !!buffWorthCasting(game);
    if (!keepLastForDisc && (ring.caught >= 2 || (ring.caught >= 1 && swungAlready))) return use(pulse.id);
  }

  // An unerring command, if this build has one — never misses, so spend it on
  // whatever is closest to dying.
  const unerring = findUsable(game, "unerring");
  if (unerring) {
    const targets = live.filter(c => dist(c) <= unerring.rangeFeet && canReach(c)).sort((a, b) => a.hp - b.hp);
    if (targets.length) return use(unerring.id, targets[0].key);
  }

  const adj = live.find(c => isAdjacent(c, pc));
  const attack = findUsable(game, "attack");
  if (adj && attack) {
    // The last action of a melee turn goes to the disc, whenever the disc is
    // down. It used to go there only at a MAP of 8 or worse, on the argument
    // that a third swing is worth less than the buff it displaces. True, and
    // too narrow: Shield is a one-action cantrip that costs nothing but the
    // action and arms Shield Block, so a wizard with a construct in reach
    // wants it up every round, whatever her MAP is.
    //
    // What made the difference visible was a one-action emanation landing in
    // the middle of the same turn. With the pulse taking the second action and
    // this rule still asking for a MAP of 8, Shield measured zero casts and
    // Shield Block zero fires across 2,000 runs — a whole subsystem displaced
    // in silence by a change that read as an improvement because the win rate
    // went up. balance.mjs is what said so, and that is the argument for a
    // never-cast line that exits non-zero rather than printing a note.
    const buff = buffWorthCasting(game);
    if (actions === 1 && buff) return use(buff.id);
    // A debuff before the swings that profit from it, never after: one action
    // spent making the target wrong is worth more than the swing it displaces
    // only while there are swings left to take. Read off `inflicts` rather
    // than the id, so a build whose debuff leaves something other than
    // off-guard behind gets the same rule.
    const debuff = findUsable(game, "debuff");
    if (debuff && actions > debuff.cost
        && debuff.inflicts.some(spec => !game.conditionsOf(adj).some(c => c.id === spec.condition))) {
      return use(debuff.id, adj.key);
    }
    return use(attack.id, adj.key);
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

  // Boxed in or out of reach: brace, if this build has anything to brace with.
  const brace = buffWorthCasting(game);
  if (brace) return use(brace.id);
  return false;
}

/** Play an encounter out to its end. */
export function fight(game, { maxTurns = 200, tally = null } = {}) {
  let guard = 0;
  while (game.mode === "combat" && !game.run.outcome) {
    if (++guard > maxTurns) throw new Error("fight(): encounter did not terminate");
    if (game.isPCTurn()) {
      const spent = combatPolicy(game, tally);
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
 * Everything a report wants to say about a run that `run.stats` cannot,
 * watched off the engine's own events rather than reconstructed from outside.
 *
 * The four aggregate counters answer "how did the run go" and nothing else.
 * "Which fight killed you" is a different question, and it needs the run cut
 * into encounters and areas while it is happening: the deltas are only
 * knowable at the boundary, and by the end there is one total.
 *
 * Every boundary here is an event the engine already emits — `mode` for an
 * encounter opening and closing, `woke` for what started it, `area` for a
 * stairway, `end` for the run itself. Nothing measures a boundary a second
 * way, which is the whole reason this reads events instead of watching
 * `game.mode` from the loop below: a fight that ends because every construct
 * settled back into stone (endCombat("lost")) never passes through the loop's
 * combat branch at all.
 */
function watchRun(game) {
  const encounters = [];
  const areas = [];
  const reactions = {};
  const conditions = {};
  const abilities = {};

  // A creature key is "<area>:<creature>@<x>,<y>". Read the creature id off
  // the state rather than parsing the key: the key's shape is game.js's
  // business, and a report that parses it goes quietly wrong the day it gains
  // a field.
  const whoIs = key => {
    if (key === "pc") return "pc";
    const c = game.run.creatures.find(c => c.key === key);
    return c ? c.creature : key;
  };

  const stats = () => ({ ...game.run.stats });
  let fight = null;
  let woke = null;
  let here = { area: game.run.areaId, taken: 0, from: stats() };

  function openFight() {
    if (fight) return;
    // The creature that started it: whatever woke immediately before combat
    // began. A save restored mid-encounter starts combat with nothing waking
    // at all, so fall back to whoever is already on their feet.
    const starter = woke || game.awake()[0]?.key || null;
    woke = null;
    fight = { area: game.run.areaId, starter: starter ? whoIs(starter) : "unknown", from: stats() };
  }

  function closeFight(ended) {
    if (!fight) return;
    const now = stats();
    encounters.push({
      area: fight.area,
      starter: fight.starter,
      ended,
      rounds: now.rounds - fight.from.rounds,
      dealt: now.dealt - fight.from.dealt,
      taken: now.taken - fight.from.taken,
    });
    fight = null;
  }

  function closeArea() {
    here.taken = stats().taken - here.from.taken;
    delete here.from;
    areas.push(here);
  }

  game.on(ev => {
    if (ev.type === "ability") abilities[ev.command] = (abilities[ev.command] || 0) + 1;
    else if (ev.type === "reaction") tick(reactions, whoIs(ev.actor) + " " + ev.command);
    // value 0 is a condition coming off; only the ones going on are news.
    else if (ev.type === "condition" && ev.value > 0) tick(conditions, whoIs(ev.actor) + " " + ev.condition);
    else if (ev.type === "woke") woke = ev.key;
    else if (ev.type === "mode" && ev.mode === "combat") openFight();
    // endCombat() says which of the two ways a fight ended; a "mode" event
    // that carries no `why` at all is begin()'s opening one, and there is no
    // encounter open for it to close.
    else if (ev.type === "mode" && ev.mode !== "combat") closeFight(ev.why === "lost" ? "settled" : "cleared");
    else if (ev.type === "end") { closeFight(ev.outcome === "defeat" ? "died" : "cleared"); }
    else if (ev.type === "area") {
      closeArea();
      here = { area: ev.areaId, taken: 0, from: stats() };
    }
  });

  return {
    abilities,
    close() {
      // A run that stalls or runs out of goals leaves both open, and an
      // encounter dropped on the floor is exactly the one worth seeing.
      closeFight("unfinished");
      closeArea();
      return { encounters, areas, reactionsBy: reactions, conditionsBy: conditions, abilities };
    },
  };
}

const tick = (bag, key) => { bag[key] = (bag[key] || 0) + 1; };

/**
 * Play the whole adventure: every pillar, the gate, every stairway, the
 * casket, fighting whatever wakes on the way. Returns how it ended and what
 * it cost.
 */
export function playThrough(game, { maxPhases = 60 } = {}) {
  const goals = collectGoals(game.content);
  const cast = {};
  // What the *creatures* put on the board, counted the same way and for the
  // same reason. A creature ability is content nothing in the player's policy
  // can reach, so the only way to find out it never fires is to listen for it
  // — off the engine's own event rather than a second guess at when a cone
  // goes off.
  //
  // Subscribed before begin(), not after: begin() rolls initiative itself for
  // a save restored mid-encounter, and a watcher attached afterwards would
  // miss the encounter it is standing in.
  const watch = watchRun(game);
  const abilities = watch.abilities;
  game.begin();

  let phases = 0;
  for (const goal of goals) {
    while (!game.run.outcome) {
      if (++phases > maxPhases) return summarise(game, "stalled", cast, watch.close());
      if (game.mode === "combat") { fight(game, { tally: cast }); continue; }

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
  return summarise(game, game.run.outcome || "unfinished", cast, watch.close());
}

/**
 * `detail` is watchRun()'s close(): the per-encounter, per-area, per-reaction
 * and per-condition breakdown. It defaults to an empty one so the shape is the
 * same for a caller that built the summary by hand — balance.mjs reads these
 * arrays without checking, and a missing key there would read as "this run
 * fought nothing" rather than as the crash it is.
 */
function summarise(game, outcome, cast = {}, detail = {}) {
  const { encounters = [], areas = [], reactionsBy = {}, conditionsBy = {} } = detail;
  return {
    outcome,
    cast,
    abilities: detail.abilities || {},
    encounters,
    areas,
    // `reactionsBy` and `reactions` are different questions and the names have
    // to say so: one is "who fired what, how often", the other is the run's
    // single total, which balance.mjs has printed since round two.
    reactionsBy,
    conditionsBy,
    hp: game.run.pc.hp,
    slots: game.run.pc.slots,
    focus: game.run.pc.focus,
    potions: game.potionCount(),
    lore: game.run.loreRead.length,
    // The ids, not just the count. "Read three pillars" was a stand-in for
    // "read the reliquary plaque" that held only while the plaque was the
    // third one; the undercroft's mark made it the fourth and the count went
    // on reading 100% of wins without meaning anything. A report that wants to
    // know whether an optional room was visited has to name the pillar.
    loreRead: [...game.run.loreRead],
    gateOpen: game.run.gateOpen,
    slain: game.run.stats.slain,
    woken: game.run.stats.woken,
    reactions: game.run.stats.reactions,
    rounds: game.run.stats.rounds,
    dealt: game.run.stats.dealt,
    taken: game.run.stats.taken,
  };
}
