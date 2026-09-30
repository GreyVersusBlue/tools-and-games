import { du, fx, damage, enemiesIn, alliesIn, prd } from '../util.js';

function taunt(g, u, brakka, duration) {
  const saved = u.controller;
  u.addModifier({
    id: 'taunted', name: "Taunting Roar", icon: '😤', debuff: true, duration, source: brakka, taunt: true,
    vfxName: 'taunt',
    onApply(t) { if (t.kind !== 'hero' || t.isBot) t.controller = null; t.issueOrder({ type: 'attack', target: brakka }); },
    onTick(t) {
      if (!brakka.alive) { this.remaining = 0; return; }
      if (t.order.type !== 'attack' || t.order.target !== brakka) t.issueOrder({ type: 'attack', target: brakka });
    },
    onExpire(t) {
      if (t.controller == null && saved) t.controller = saved;
      if (t.alive && t.order.target === brakka) t.issueOrder({ type: 'idle' });
    },
  });
}

export default [
  {
    id: 'brakka_taunting_roar', name: "Taunting Roar", icon: '😤', targetType: 'none', castPoint: 0.4,
    description: "Brakka roars a challenge. Nearby enemies are forced to attack him, and he gains bonus armor while they do.",
    cooldown: [17, 15, 13, 11], manaCost: [80, 90, 100, 110], radius: du(315), pierceImmunity: true,
    values: { duration: [2.0, 2.4, 2.8, 3.2], armor: [12, 13, 14, 15] },
    hint: { type: 'self', minEnemies: 1 },
    cast(ab) {
      const h = ab.hero, g = ab.game, r = ab.getRadius();
      fx(g, 'taunting_roar', { unit: h, position: h.position.clone(), radius: r });
      h.addModifier({ id: 'taunting_roar_armor', name: "Taunting Roar", icon: '🛡️', duration: ab.v('duration'), bonus: { armor: ab.v('armor') } });
      for (const u of enemiesIn(g, h, h.position, r, { pierceImmunity: true })) {
        if (u.immobile) continue;
        taunt(g, u, h, ab.v('duration'));
      }
    },
  },
  {
    id: 'brakka_bloodfever', name: 'Bloodfever', icon: '🩸', targetType: 'unit', targetTeam: 'enemy', castPoint: 0.3,
    description: "Curses an enemy with a fever that burns it over time and slows it. Brakka moves faster for every enemy suffering from Bloodfever.",
    cooldown: [20, 16, 12, 8], manaCost: [50, 60, 70, 80], castRange: [du(700), du(775), du(850), du(925)], damageType: 'magical',
    values: { dps: [16, 24, 32, 40], slow: 0.12, duration: 12, speedPerTarget: 0.12 },
    cast(ab, t) {
      const h = ab.hero, g = ab.game;
      const dps = ab.v('dps');
      let acc = 0;
      fx(g, 'bloodfever_cast', { unit: t, source: h });
      t.addModifier({
        id: 'bloodfever', name: 'Bloodfever', icon: '🩸', debuff: true, duration: ab.v('duration'), slow: ab.v('slow'), source: h,
        vfxName: 'bloodfever',
        onTick(u, dt) {
          acc += dt;
          if (acc >= 1) { acc -= 1; damage(u, dps, 'magical', h, ab); }
        },
      });
      let recount = 0;
      h.addModifier({
        id: 'bloodfever_speed', name: 'Bloodfever', icon: '🏃', duration: ab.v('duration'), bonus: { moveSpeedPct: ab.v('speedPerTarget') },
        onTick(u, dt) {
          recount -= dt;
          if (recount > 0) return;
          recount = 0.5;
          let n = 0;
          for (const x of g.units) if (x.alive && x.modifiers.some((m) => m.id === 'bloodfever' && m.source === h)) n++;
          this.bonus.moveSpeedPct = ab.v('speedPerTarget') * n;
          if (n === 0) this.remaining = 0;
        },
      });
    },
  },
  {
    id: 'brakka_whirling_riposte', name: 'Whirling Riposte', icon: '🌀', targetType: 'passive',
    description: "Each time Brakka is attacked he may spin on his heel, dealing pure damage to every enemy around him.",
    radius: du(275), damageType: 'pure', values: { chance: 0.2, damage: [70, 100, 130, 160], cooldown: 0.3 },
    passive(ab) {
      return {
        onDamageTaken(u, info) {
          if (!info.isAttack || !info.source || info.source.team === u.team || u.isStunned) return;
          if (ab.game.time < (ab.data.next ?? 0)) return;
          if (!prd(u, 'helix', ab.v('chance'))) return;
          ab.data.next = ab.game.time + ab.v('cooldown');
          fx(ab.game, 'whirling_riposte', { unit: u, position: u.position.clone(), radius: ab.getRadius() });
          u.playAnim?.('attack', { once: true, speed: 2 });
          const dmg = ab.v('damage');
          for (const e of enemiesIn(ab.game, u, u.position, ab.getRadius(), { pierceImmunity: true })) damage(e, dmg, 'pure', u, ab);
        },
      };
    },
  },
  {
    id: 'brakka_executioners_cleave', name: "Executioner's Cleave", icon: '🪓', targetType: 'unit', targetTeam: 'enemy', ultimate: true, castPoint: 0.3,
    description: "A single brutal chop that kills an enemy outright if its health is under the threshold. A kill refreshes the cooldown and hastes Brakka and nearby allies.",
    cooldown: [75, 65, 55], manaCost: [60, 120, 180], castRange: [du(150)], pierceImmunity: true, damageType: 'magical', radius: du(900),
    values: { threshold: [250, 350, 450], damage: [150, 250, 300], speed: 0.3, speedDuration: 6, attackSpeed: 30 },
    scepter: { description: 'Kill threshold +100, cooldown reduced to 30s and the speed bonus lasts 10s.', values: { threshold: [350, 450, 550], speedDuration: 10 }, cooldown: [30, 30, 30] },
    hint: (ab) => ({ type: 'enemy', executeBelowHp: ab.v('threshold') }),
    cast(ab, t) {
      const h = ab.hero, g = ab.game;
      if (t.hp <= ab.v('threshold')) {
        fx(g, 'executioners_cleave', { unit: t, source: h, position: t.position.clone(), kill: true });
        t.takeDamage(t.hp * 20 + 5000, 'pure', h, { ability: ab, cull: true });
        if (!t.alive) {
          for (const a of alliesIn(g, h, h.position, ab.getRadius())) {
            a.addModifier({ id: 'executioners_cleave_boost', name: "Executioner's Cleave", icon: '💨', duration: ab.v('speedDuration'), bonus: { moveSpeedPct: ab.v('speed'), attackSpeed: ab.v('attackSpeed') }, vfxName: 'speed_boost' });
          }
          ab.resetCooldown();
        }
      } else {
        fx(g, 'executioners_cleave', { unit: t, source: h, position: t.position.clone(), kill: false });
        damage(t, ab.v('damage'), 'magical', h, ab);
      }
    },
  },
];

