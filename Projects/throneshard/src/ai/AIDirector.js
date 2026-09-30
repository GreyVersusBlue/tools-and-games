import { TEAM, enemyOf, GRIMMAW_LAIR } from '../core/constants.js';
import { Structures } from './Structures.js';
import { CreepWaves } from './Creeps.js';
import { Neutrals } from './Neutrals.js';
import { BotBrain, DIFFICULTY } from './BotBrain.js';
import { LANE_PATHS } from './LanePath.js';

const TEAMS = [TEAM.SUNWARD, TEAM.DUSKWARD];
const LANES = ['top', 'mid', 'bot'];
const LANING_END = 540; // 9:00 — bots start grouping / pushing

// Per-team strategic layer: laning → pushes / defending / farming / Grimmaw. Updated once per second.
class TeamAI {
  constructor(director, team) {
    this.d = director;
    this.game = director.game;
    this.team = team;
    this.enemy = enemyOf(team);
    this.plan = { type: 'lane', since: 0 };
    this.focus = null;
    this.focusTime = -99;
    this.nextPushAt = LANING_END;
    this.threat = null;
    this.campClaims = new Map(); // hero -> camp
    this.laneClaims = new Map(); // hero -> lane
    this.lastSeen = new Map(); // enemy hero -> { x, z, t } (map awareness)
    this.warders = [];
    this.wardersT = -99;
    this.nextGrimmawCheck = 0;
  }

  get diff() { return DIFFICULTY[this.difficulty ?? this.game.difficulty] ?? DIFFICULTY.normal; }

  // Supports ward: every bot hero with the Support role, else the poorest bot (2 warders after 15:00).
  updateWarders() {
    const g = this.game;
    if (g.time - this.wardersT < 60) return;
    this.wardersT = g.time;
    const bots = this.heroes().filter((h) => h.isBot && !h.isPlayerControlled);
    const nw = (h) => g.rules?.netWorth?.(h) ?? h.gold;
    const sup = bots.filter((h) => (h.def?.roles ?? []).includes('Support')).sort((a, b) => nw(a) - nw(b));
    const rest = bots.filter((h) => !sup.includes(h)).sort((a, b) => nw(a) - nw(b));
    const n = g.time > 900 ? 2 : 1;
    this.warders = [...sup, ...rest].slice(0, n);
  }

  // Enemy heroes last seen near pos within `recent` seconds.
  dangerAt(pos, r = 30, recent = 20) {
    const t = this.game.time;
    let n = 0;
    for (const [e, s] of this.lastSeen) {
      if (!e.alive || t - s.t > recent) continue;
      if (Math.hypot(s.x - pos.x, s.z - pos.z) < r) n++;
    }
    return n;
  }

  // Dead bots buy back when it matters: the base is under attack by heroes, or late game when the enemy
  // is pushing high ground. Not on easy.
  considerBuybacks() {
    const g = this.game, t = g.time;
    if (t < 1200 || (this.difficulty ?? g.difficulty) === 'easy' || !g.rules?.buyback) return;
    const th = this.threat;
    const enemyPlan = this.d.teams[this.enemy]?.plan;
    const highGround = enemyPlan?.type === 'push' && (() => { const tg = this.d.structures.nextTarget(this.enemy, enemyPlan.lane); return tg && (tg.kind === 'building' || (tg.data?.tier ?? 0) >= 3); })();
    const baseThreat = th && th.base && th.heroes >= 1;
    const throneshard = this.d.structures.throneshard?.[this.team];
    const throneHit = throneshard?.alive && throneshard.healthPct < 0.85 && t - (throneshard.lastDamagedTime ?? -99) < 3;
    if (!baseThreat && !throneHit && !(highGround && t > 1800)) return;
    const alive = this.heroes().filter((h) => h.alive).length;
    for (const h of this.heroes()) {
      if (h.alive || !h.isBot || h.isPlayerControlled) continue;
      if (h.respawnTimer < (throneHit ? 8 : 18)) continue;
      if (alive >= 4 && !throneHit) continue;
      const r = g.rules.buyback(h);
      if (r?.ok) return; // one per second is plenty
    }
  }

  netWorthRatio() {
    const g = this.game;
    const nw = (team) => g.heroes.filter((h) => h.team === team).reduce((a, h) => a + (g.rules?.netWorth?.(h) ?? h.gold), 0);
    return nw(this.team) / Math.max(1, nw(this.enemy));
  }

  // Do we notice the enemy taking Grimmaw? Vision of the pit / Grimmaw, or (without vision) his health dropping
  // for a while — the "heard the fight" guess, likelier for aware (hard) bots.
  noticeGrimmaw(grim) {
    const g = this.game;
    const ep = this.d.teams[this.enemy]?.plan;
    if (!grim?.alive || ep?.type !== 'grimmaw' || ep.contest) return false;
    const maxHp = grim.getStat('maxHp');
    if (grim.hp > maxHp * 0.97) return false;
    const pit = grim.position;
    const attackers = g.heroes.filter((h) => h.alive && h.team === this.enemy && h.distanceTo(pit) < 16);
    if (!attackers.length) return false;
    if (g.canSee(this.team, grim) || attackers.some((a) => g.canSee(this.team, a))) return true;
    const chance = this.diff.aware ? 0.5 : 0.25;
    return grim.hp < maxHp * 0.85 && Math.random() < chance;
  }

  heroes() { return this.game.heroes.filter((h) => h.team === this.team); }

  update() {
    const g = this.game, t = g.time;
    const heroes = this.heroes();
    const alive = heroes.filter((h) => h.alive);
    const enemies = g.heroes.filter((h) => h.team === this.enemy);
    this.threat = this.findThreat();
    this.updateWarders();
    this.considerBuybacks();

    // Defend structures under hero pressure (always for base, from 10 min for outer towers)
    const th = this.threat;
    if (th && (th.heroes > 0 && (t >= LANING_END - 120 || th.structure.kind === 'building' || th.structure.data.tier >= 2) || th.base)) {
      if (this.plan.type !== 'defend' || this.plan.structure !== th.structure) this.plan = { type: 'defend', structure: th.structure, since: t, base: th.base };
      return;
    }
    if (this.plan.type === 'defend') this.plan = { type: t < LANING_END ? 'lane' : 'farm', since: t };

    if (t < LANING_END) { this.plan = { type: 'lane', since: t }; return; }

    const avgHp = alive.reduce((a, h) => a + h.healthPct, 0) / Math.max(1, alive.length);
    const enemyAlive = enemies.filter((h) => h.alive).length;
    const grim = this.d.neutrals.grimmaw;
    const canContest = grim?.alive && alive.length >= 2 && alive.length >= enemyAlive - 2;
    const startContest = () => {
      this.plan = { type: 'grimmaw', contest: true, since: t, count: alive.length };
      this.d.stats.grimmawContests = (this.d.stats.grimmawContests ?? 0) + 1;
    };

    // Continue / abort an ongoing push
    if (this.plan.type === 'push') {
      const target = this.d.structures.nextTarget(this.team, this.plan.lane);
      const tooLong = t - this.plan.since > 180;
      const weak = alive.length < 3 && alive.length < enemyAlive;
      if (!target || tooLong || weak || alive.length <= 1) {
        this.nextPushAt = t + (weak ? 35 : 15);
        this.plan = { type: 'farm', since: t };
      } else {
        // Gathered once ≥3 heroes are near the rally point
        if (!this.plan.gathered) {
          const near = alive.filter((h) => h.distanceTo(this.plan.rally) < 22).length;
          if (near >= Math.min(3, alive.length) || t - this.plan.since > 30) this.plan.gathered = true;
        }
        // A push gives way to contesting Grimmaw (this branch used to return first, so a team that was pushing never noticed)
        if (canContest && this.noticeGrimmaw(grim)) { startContest(); return; }
        // Rally follows our wave front so we push with creeps
        return;
      }
    }

    // Grimmaw: a team attempt when ahead (numbers / net worth) with 3+ alive and enough levels; the other team
    // contests if it notices (see noticeGrimmaw).
    if (this.plan.type === 'grimmaw') {
      const p = this.plan;
      const tooLong = t - p.since > (p.contest ? 50 : 110);
      if (!grim?.alive || tooLong || alive.length < (p.contest ? 2 : 3)) { this.plan = { type: 'farm', since: t }; this.nextPushAt = t + 5; this.nextGrimmawCheck = t + 60; }
      else return;
    }
    if (canContest && this.noticeGrimmaw(grim)) { startContest(); return; }
    const avgLvl = alive.reduce((a, h) => a + h.level, 0) / Math.max(1, alive.length);
    const ahead = alive.length - enemyAlive >= 1 || enemyAlive <= 2 || this.netWorthRatio() > 1.12;
    if (t > 900 && t >= this.nextGrimmawCheck && grim?.alive && alive.length >= 3 && avgLvl >= 11 && ahead && avgHp > 0.6) {
      this.nextGrimmawCheck = t + 20;
      if (Math.random() < (this.diff.aware ? 0.8 : 0.6)) {
        this.plan = { type: 'grimmaw', since: t, count: alive.length };
        this.d.stats.grimmawAttempts = (this.d.stats.grimmawAttempts ?? 0) + 1;
        return;
      }
    }

    // Start a push when healthy enough (or when enemies are dead)
    const ready = (alive.length >= 3 && avgHp > 0.6) || (alive.length >= 2 && enemyAlive <= 1);
    if (t >= this.nextPushAt && ready) {
      const lane = this.choosePushLane(alive);
      if (lane) {
        const rally = this.rallyPoint(lane);
        this.plan = { type: 'push', lane, since: t, rally, gathered: false };
        return;
      }
    }
    if (this.plan.type !== 'farm') this.plan = { type: 'farm', since: t };
  }

  findThreat() {
    const g = this.game;
    let best = null;
    for (const s of this.d.structures.aliveStructures(this.team)) {
      if (s.subtype === 'fountain') continue;
      const r = (s.kind === 'tower' ? s.getStat('attackRange') : 12) + 5;
      let heroes = 0, creeps = 0;
      for (const u of g.unitsInRadius(s.position, r)) {
        if (u.team !== this.enemy) continue;
        if (u.kind === 'hero' && g.canSee(this.team, u)) heroes++;
        else if (u.kind === 'creep' || u.kind === 'summon') creeps++;
      }
      if (!heroes && creeps < 3) continue;
      const base = s.kind === 'building' || s.data?.tier >= 3;
      const sev = heroes * 3 + creeps * 0.4 + (base ? 3 : 0) + (s.data?.tier ?? 3);
      if (!best || sev > best.sev) best = { structure: s, heroes, creeps, base, sev };
    }
    if (best && best.base && best.heroes === 0 && best.creeps < 3) return null;
    return best;
  }

  choosePushLane(alive) {
    let best = null, bestS = Infinity;
    const cx = alive.reduce((a, h) => a + h.position.x, 0) / Math.max(1, alive.length);
    const cz = alive.reduce((a, h) => a + h.position.z, 0) / Math.max(1, alive.length);
    for (const lane of LANES) {
      const tgt = this.d.structures.nextTarget(this.team, lane);
      if (!tgt || tgt.isInvulnerable) continue;
      const tier = tgt.kind === 'tower' ? tgt.data.tier : tgt.subtype === 'throneshard' ? 5 : 3.5;
      // Prefer weak/outer targets, closeness, and lanes where our wave is pushing
      const f = this.d.laneFront(this.team, lane);
      const waveBonus = f.myN > 0 ? Math.min(1.5, f.my / 100) : 0;
      const s = tier * 1.0 + tgt.healthPct * 1.2 + Math.hypot(tgt.position.x - cx, tgt.position.z - cz) / 80 - waveBonus + Math.random() * 0.6;
      if (s < bestS) { bestS = s; best = lane; }
    }
    return best;
  }

  rallyPoint(lane) {
    const path = LANE_PATHS[this.team][lane];
    const tgt = this.d.structures.nextTarget(this.team, lane);
    const ts = tgt ? path.project(tgt.position.x, tgt.position.z).s : path.length / 2;
    const p = path.pointAt(ts - 26);
    return new this.game.THREE.Vector3(p.x, 0, p.z);
  }

  // Tailor the team plan for one hero
  planFor(hero) {
    const g = this.game;
    const p = this.plan;
    if (p.type === 'defend') {
      const s = p.structure;
      if (p.base || hero.distanceTo(s) < 75 || this.threat?.heroes >= 2) return p;
      return { type: 'lane', lane: hero.lane };
    }
    if (p.type === 'lane') return { type: 'lane', lane: hero.lane };
    if (p.type === 'push' || p.type === 'grimmaw') return p;
    // Farm: lanes with enemy creeps on our side first, then jungle camps
    return this.farmAssignment(hero);
  }

  farmAssignment(hero) {
    const g = this.game;
    // Keep an existing claim while valid
    const claimedLane = this.laneClaims.get(hero);
    if (claimedLane) {
      const f = this.d.laneFront(this.team, claimedLane);
      if (f.enN > 0) return { type: 'farm', lane: claimedLane };
      this.laneClaims.delete(hero);
    }
    const claimedCamp = this.campClaims.get(hero);
    if (claimedCamp && (claimedCamp.units.some((u) => u.alive)) && !(claimedCamp.skipUntil > g.time)) return { type: 'farm', camp: claimedCamp };
    this.campClaims.delete(hero);

    // Lane farming: pick the lane with an unclaimed enemy wave, nearest first
    const taken = new Set(this.laneClaims.values());
    let bestLane = null, bestD = Infinity;
    for (const lane of LANES) {
      if (taken.has(lane)) continue;
      const f = this.d.laneFront(this.team, lane);
      if (!f.enN) continue;
      const pt = f.path.pointAt(f.en);
      const d = Math.hypot(pt.x - hero.position.x, pt.z - hero.position.z) + (lane === hero.lane ? -20 : 0);
      if (d < bestD) { bestD = d; bestLane = lane; }
    }
    if (bestLane && bestD < 90) { this.laneClaims.set(hero, bestLane); return { type: 'farm', lane: bestLane }; }

    // Jungle
    const takenCamps = new Set(this.campClaims.values());
    let bestCamp = null, bestC = Infinity;
    for (const c of this.d.neutrals.camps) {
      if (takenCamps.has(c) || c.skipUntil > g.time || !c.units.some((u) => u.alive)) continue;
      let d = hero.distanceTo(c.pos) + (c.side === this.team ? 0 : 35);
      if (this.diff.aware) { const dz = this.dangerAt(c.pos, 32); if (dz >= 2 || (dz && c.side !== this.team)) continue; d += dz * 40; }
      const ok = hero.level >= ({ small: 1, medium: 4, large: 7, elder: 11 }[c.kind] ?? 1);
      if (ok && d < bestC) { bestC = d; bestCamp = c; }
    }
    if (bestCamp) { this.campClaims.set(hero, bestCamp); return { type: 'farm', camp: bestCamp }; }
    return { type: 'lane', lane: hero.lane };
  }
}

// AI entry point: structures, creep waves, neutrals, Grimmaw and bot heroes.
export class AIDirector {
  constructor(game) {
    this.game = game;
    this.structures = new Structures(this);
    this.creeps = new CreepWaves(this);
    this.neutrals = new Neutrals(this);
    this.teams = { sunward: new TeamAI(this, TEAM.SUNWARD), duskward: new TeamAI(this, TEAM.DUSKWARD) };
    this.brains = new Map();
    this.heroAggro = []; // { attacker, victim, time }
    this.teamT = 0;
    this.started = false;
    this.stats = { matchEnd: null };
    this._laneFrontCache = new Map();
  }

  async init() {
    const bus = this.game.bus;
    bus.on('unit:died', ({ unit, killer }) => this.onUnitDied(unit, killer));
    bus.on('unit:attack', ({ unit, target }) => {
      if (unit?.kind === 'hero' && target?.kind === 'hero' && unit.team !== target.team) {
        this.heroAggro.push({ attacker: unit, victim: target, time: this.game.time });
        if (this.heroAggro.length > 40) this.heroAggro.splice(0, this.heroAggro.length - 40);
        this.creeps.onHeroAttack(unit, target);
      }
    });
    bus.on('unit:damaged', ({ unit, amount }) => {
      if (!unit || unit.isStructure) return;
      const log = unit.data._dmg ?? (unit.data._dmg = []);
      log.push(this.game.time, amount);
      if (log.length > 40) log.splice(0, log.length - 40);
    });
    bus.on('unit:spawned', ({ unit }) => {
      if (this.started && unit.kind === 'hero' && unit.isBot && !unit.controller) this.attachBot(unit);
    });
    bus.on('match:end', ({ winner }) => {
      this.stats.matchEnd = { winner, time: this.game.time };
      console.info(`[AI] match ended at ${(this.game.time / 60).toFixed(1)} min, winner: ${winner}`);
    });
  }

  onMatchStart() {
    this.started = true;
    this.structures.spawnAll();
    this.creeps.onMatchStart();
    this.neutrals.onMatchStart();
    const lanes = ['mid', 'top', 'bot', 'top', 'bot'];
    for (const team of TEAMS) {
      this.game.heroes.filter((h) => h.team === team).forEach((h, i) => { if (!h.lane) h.lane = lanes[i % 5]; });
    }
    for (const h of this.game.heroes) if (h.isBot && !h.isPlayerControlled) this.attachBot(h);
  }

  attachBot(hero) {
    hero.isBot = true;
    const b = new BotBrain(this, hero);
    const td = this.teams?.[hero.team]?.difficulty;
    if (td && DIFFICULTY[td]) b.diff = DIFFICULTY[td];
    hero.controller = b;
    this.brains.set(hero, b);
    if (!hero.lane) hero.lane = 'mid';
    return b;
  }
  detachBot(hero) {
    if (hero.controller === this.brains.get(hero)) hero.controller = null;
    this.brains.delete(hero);
    hero.removeModifier?.('bot_control');
  }
  // Let the AI play the player's hero too (spectate / autoplay / tests)
  setPlayerAutoplay(on) {
    const h = this.game.player.hero;
    if (!h) return;
    if (on) { h.isPlayerControlled = false; this.attachBot(h); } else { this.detachBot(h); h.isBot = false; h.isPlayerControlled = true; }
  }

  update(dt) {
    const g = this.game;
    if (!this.started || g.matchOver) return;
    this._laneFrontCache.clear();
    this.creeps.update(dt);
    this.neutrals.update(dt);
    this.structures.update(dt);
    this.teamT -= dt;
    if (this.teamT <= 0) {
      this.teamT = 1;
      for (const team of TEAMS) {
        try { this.teams[team].update(); } catch (e) { if (!this._teamErr) { console.error('[AI team]', e); this._teamErr = true; } }
      }
      for (const c of this.creeps.creeps) if (!c.alive) this.creeps.creeps.delete(c);
      const cutoff = g.time - 3;
      if (this.heroAggro.length && this.heroAggro[0].time < cutoff) this.heroAggro = this.heroAggro.filter((a) => a.time >= cutoff);
    }
  }

  onUnitDied(unit, killer) {
    if (unit.isStructure) this.structures.onStructureDied(unit);
    else if (unit.kind === 'creep') this.creeps.onUnitDied(unit);
    else if (unit.kind === 'grimmaw') this.neutrals.onGrimmawDied(unit, killer);
    if (this.teams) for (const t of TEAMS) if (this.teams[t].focus === unit) this.teams[t].focus = null;
  }

  // --- queries used by controllers ---
  heroAggroFor(team, pos, range) {
    const t = this.game.time;
    for (let i = this.heroAggro.length - 1; i >= 0; i--) {
      const a = this.heroAggro[i];
      if (t - a.time > 1.5) break;
      if (a.victim.team !== team || !a.attacker.alive) continue;
      const dx = a.attacker.position.x - pos.x, dz = a.attacker.position.z - pos.z;
      const vx = a.victim.position.x - pos.x, vz = a.victim.position.z - pos.z;
      if (dx * dx + dz * dz <= range * range && vx * vx + vz * vz <= range * range) return a.attacker;
    }
    return null;
  }

  incomingDps(u) {
    const log = u.data?._dmg;
    if (!log?.length) return 0;
    const t = this.game.time;
    let sum = 0;
    for (let i = 0; i < log.length; i += 2) if (t - log[i] <= 1.5) sum += log[i + 1];
    return sum / 1.5;
  }

  laneFront(team, lane) {
    const key = team + lane;
    let f = this._laneFrontCache.get(key);
    if (f) return f;
    const path = LANE_PATHS[team][lane];
    let my = -Infinity, en = Infinity, myN = 0, enN = 0;
    for (const c of this.creeps.creeps) {
      if (!c.alive || c.lane !== lane) continue;
      const p = path.project(c.position.x, c.position.z);
      if (p.dist > 12) continue;
      if (c.team === team) { if (p.s > my) my = p.s; myN++; } else { if (p.s < en) en = p.s; enN++; }
    }
    f = { path, my, en, myN, enN };
    this._laneFrontCache.set(key, f);
    return f;
  }

  planFor(hero) { return this.teams[hero.team]?.planFor(hero) ?? { type: 'lane', lane: hero.lane }; }
  // Per-team difficulty override (tests / asymmetric matches): setTeamDifficulty('sunward', 'hard')
  setTeamDifficulty(team, level) {
    if (!DIFFICULTY[level] || !this.teams[team]) return false;
    this.teams[team].difficulty = level;
    for (const [h, b] of this.brains) if (h.team === team) b.diff = DIFFICULTY[level];
    return true;
  }
  isWarder(hero) { return !!this.teams[hero.team]?.warders.includes(hero); }
  noteSeen(team, e) { this.teams[team]?.lastSeen.set(e, { x: e.position.x, z: e.position.z, t: this.game.time }); }
  dangerAt(team, pos, r, recent) { return this.teams[team]?.dangerAt(pos, r, recent) ?? 0; }
  teamFocus(team) {
    const tm = this.teams[team];
    if (!tm?.focus?.alive || this.game.time - tm.focusTime > 4) return null;
    return tm.focus;
  }
  reportFocus(team, target) {
    const tm = this.teams[team];
    if (!tm) return;
    if (!tm.focus?.alive || this.game.time - tm.focusTime > 4 || target.hp < tm.focus.hp) { tm.focus = target; }
    if (tm.focus === target) tm.focusTime = this.game.time;
  }
  botStuck(brain) {
    const tm = this.teams[brain.team];
    const camp = tm?.campClaims.get(brain.hero);
    if (camp) { camp.skipUntil = this.game.time + 60; tm.campClaims.delete(brain.hero); }
  }

  // Debug snapshot (used by tests / UI dev overlay)
  snapshot() {
    const g = this.game;
    const towers = {};
    for (const team of TEAMS) towers[team] = this.structures.towers[team].filter((t) => t.alive).length;
    const rax = {};
    for (const team of TEAMS) rax[team] = this.structures.barracks[team].filter((t) => t.alive).length;
    return {
      time: +g.time.toFixed(1), units: g.units.length, creeps: this.creeps.creeps.size, wave: this.creeps.waveIndex,
      towers, rax, throneshard: TEAMS.map((t) => Math.round(this.structures.throneshard[t]?.hp ?? 0)),
      plans: TEAMS.map((t) => this.teams[t].plan.type + (this.teams[t].plan.lane ? ':' + this.teams[t].plan.lane : '')),
      score: g.rules?.score, grimmawKills: this.neutrals.grimmawKills,
      heroes: g.heroes.map((h) => `${h.team[0]}:${h.heroId}${h.isBot ? '' : '*'} L${h.level} ${h.kills}/${h.deaths}/${h.assists} lh${h.lastHits} dn${h.denies} g${Math.round(h.gold)} ${h.alive ? Math.round(h.healthPct * 100) + '%' : 'dead'} ${this.brains.get(h)?.mode ?? ''}`),
    };
  }
}
