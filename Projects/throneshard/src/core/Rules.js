import * as THREE from 'three';
import { TEAM, enemyOf, XP_SHARE_RADIUS, heroKillGold, heroKillXp, PASSIVE_GOLD_PER_SEC, FOUNTAIN } from './constants.js';

export const BUYBACK_COOLDOWN = 480;

// Core match rules: bounties, XP sharing, kill/assist credit, passive gold, fountain regen, win condition.
export class Rules {
  constructor(game) {
    this.game = game;
    this.score = { sunward: 0, duskward: 0 };
    this.firstBlood = false;
    const bus = game.bus;
    bus.on('unit:damaged', ({ unit, source }) => {
      const srcHero = source?.kind === 'hero' ? source : source?.owner;
      if (unit.kind === 'hero' && srcHero && srcHero.team !== unit.team) unit.damageContributors.set(srcHero, game.time);
    });
    bus.on('unit:died', (e) => this.onDeath(e));
  }

  onDeath({ unit, killer }) {
    const g = this.game;
    const killerHero = killer?.kind === 'hero' ? killer : killer?.owner?.kind === 'hero' ? killer.owner : null;
    const denied = killer && killer.team === unit.team;

    if (unit.kind === 'hero') {
      g.bus.emit('hero:killed', { victim: unit, killer, killerHero, assists: this.assistsFor(unit, killerHero), firstBlood: !this.firstBlood && !!killerHero });
      if (!denied) {
        const team = enemyOf(unit.team);
        this.score[team]++;
        this.firstBlood = true;
        const assisters = this.assistsFor(unit, killerHero);
        const gold = heroKillGold(unit.level, unit.streak);
        if (killerHero) {
          killerHero.kills++;
          killerHero.streak++;
          killerHero.addGold(gold, 'kill');
        }
        for (const a of assisters) { a.assists++; a.addGold(Math.round(60 + unit.level * 6), 'assist'); }
        // death gold loss
        unit.addGold?.(-Math.min(unit.gold, 30 + unit.level * 4), 'death');
        this.shareXp(unit, heroKillXp(unit.level), team);
      }
      unit.damageContributors.clear();
      return;
    }

    if (unit.kind === 'ward') return;
    const bountyGold = unit.baseStats.bountyGold ?? [0, 0];
    const gold = Math.round(bountyGold[0] + Math.random() * (bountyGold[1] - bountyGold[0]));
    if (killerHero) {
      if (denied) killerHero.denies++;
      else { killerHero.lastHits++; if (gold > 0) killerHero.addGold(gold, 'lastHit'); g.bus.emit('gold:popup', { unit, hero: killerHero, amount: gold }); }
    }
    if (unit.isStructure && !denied) {
      // Team-wide structure bounty
      for (const h of g.heroes) if (h.team !== unit.team) h.addGold(unit.kind === 'tower' ? 90 : 120, 'structure');
      g.bus.emit('building:destroyed', { unit, killer });
      if (unit.subtype === 'throneshard') this.endMatch(enemyOf(unit.team));
    }
    const xp = unit.baseStats.bountyXp ?? 0;
    if (xp > 0) this.shareXp(unit, denied ? xp * 0.3 : xp, denied ? unit.team : enemyOf(unit.team) ?? killer?.team);
  }

  assistsFor(victim, killerHero) {
    const out = [];
    for (const [h, t] of victim.damageContributors) if (h !== killerHero && this.game.time - t < 18) out.push(h);
    for (const h of this.game.heroes) {
      if (h === killerHero || out.includes(h) || h.team === victim.team || !h.alive) continue;
      if (h.distanceTo(victim) < XP_SHARE_RADIUS) out.push(h);
    }
    return out;
  }

  shareXp(victim, xp, team) {
    if (!team) return;
    const recipients = this.game.heroes.filter((h) => h.alive && h.team === team && h.distanceTo(victim) <= XP_SHARE_RADIUS);
    if (!recipients.length) return;
    for (const h of recipients) h.addXp(xp / recipients.length);
  }

  update(dt) {
    const g = this.game;
    if (g.matchOver) return;
    for (const h of g.heroes) {
      if (g.time > 0) h.gold += PASSIVE_GOLD_PER_SEC * dt;
      // fountain regen
      const f = FOUNTAIN[h.team];
      if (h.alive && Math.hypot(h.position.x - f[0], h.position.z - f[1]) < 12) {
        h.heal(h.getStat('maxHp') * 0.06 * dt);
        h.restoreMana(h.getStat('maxMana') * 0.06 * dt);
      }
      h.buybackCooldown = Math.max(0, h.buybackCooldown - dt);
    }
  }

  // ---- Buyback (200 + net worth / 13 gold, 8 minute cooldown) ----
  netWorth(h) {
    let nw = h.gold ?? 0;
    for (const it of [...(h.inventory ?? []), ...(h.backpack ?? [])]) if (it?.def?.cost) nw += it.def.cost;
    return nw;
  }
  buybackCost(h) { return Math.round(200 + this.netWorth(h) / 13); }
  canBuyback(h) {
    if (!h || h.kind !== 'hero') return { ok: false, reason: 'No hero' };
    if (h.alive) return { ok: false, reason: 'Hero is alive' };
    if (this.game.matchOver) return { ok: false, reason: 'Match is over' };
    if ((h.buybackCooldown ?? 0) > 0) return { ok: false, reason: `Buyback on cooldown (${Math.ceil(h.buybackCooldown)}s)` };
    const cost = this.buybackCost(h);
    if (h.gold < cost) return { ok: false, reason: `Not enough gold (${cost})` };
    return { ok: true, cost };
  }
  buyback(h) {
    const chk = this.canBuyback(h);
    if (!chk.ok) return chk;
    h.addGold(-chk.cost, 'buyback');
    h.buybackCooldown = BUYBACK_COOLDOWN;
    h.buybacks = (h.buybacks ?? 0) + 1;
    h.respawnTimer = 0;
    h.respawn();
    this.game.vfx?.spawn?.('teleport', { position: h.position.clone(), unit: h, color: 0xffd040 });
    this.game.bus.emit('hero:buyback', { hero: h, cost: chk.cost });
    this.game.bus.emit('ui:message', { text: `${h.name} bought back!`, color: '#ffd040' });
    return { ok: true, cost: chk.cost };
  }

  endMatch(winner) {
    const g = this.game;
    if (g.matchOver) return;
    g.matchOver = true;
    g.winner = winner;
    g.bus.emit('match:end', { winner, playerWon: winner === g.player.team });
  }
}

export { TEAM, THREE };
