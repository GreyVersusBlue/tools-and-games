import { du, fx, damage, enemiesIn, slow, prd, dirTo, forceMove, stun, chest } from '../util.js';

export default [
  {
    id: 'pell_scattershot', name: 'Scattershot', icon: '💣', targetType: 'point', castPoint: 0.3,
    description: "Lobs a canister that rains pellets over an area, damaging and slowing enemies inside. Holds up to 3 charges.",
    cooldown: [0], manaCost: [50, 50, 50, 50], castRange: [du(1800)], radius: du(450), damageType: 'magical',
    charges: { max: 3, restore: [35, 35, 35, 35] },
    values: { dps: [20, 45, 70, 95], slow: [0.12, 0.18, 0.24, 0.3], duration: 10, delay: 1.2 },
    hint: { type: 'aoe' },
    cast(ab, p) {
      const h = ab.hero, g = ab.game, r = ab.getRadius();
      const delay = ab.v('delay'), dur = ab.v('duration'), dps = ab.v('dps'), sl = ab.v('slow');
      fx(g, 'scattershot', { position: p.clone(), radius: r, duration: delay + dur, delay, source: h });
      let t = 0, acc = 0, sacc = 0;
      g.abilities.addTask((dt) => {
        t += dt;
        if (t < delay) return false;
        acc += dt; sacc += dt;
        if (sacc >= 0.25) {
          sacc = 0;
          for (const e of enemiesIn(g, h, p, r)) slow(e, sl, 0.5, h, { id: 'scattershot_slow', name: 'Scattershot', icon: '💣' });
        }
        if (acc >= 1) {
          acc -= 1;
          for (const e of enemiesIn(g, h, p, r)) damage(e, dps, 'magical', h, ab);
        }
        return t >= delay + dur;
      });
    },
  },
  {
    id: 'pell_deadeye', name: 'Deadeye', icon: '🎯', targetType: 'passive',
    description: "Pell's shots sometimes find a weak spot, dealing extra damage and briefly knocking the target back and slowing it.",
    values: { chance: 0.4, damage: [20, 40, 60, 80], knockback: du(10), slowDuration: 0.5 },
    passive(ab) {
      return {
        onAttackStart(u, t, info) {
          if (t?.isStructure) return;
          if (prd(u, 'deadeye', ab.v('chance'))) { info.deadeye = true; info.amount += ab.v('damage'); }
        },
        onAttackLanded(u, t, info) {
          if (!info.deadeye || !t.alive) return;
          fx(ab.game, 'deadeye', { unit: t, position: chest(t), source: u });
          slow(t, 1.0, ab.v('slowDuration') * 0.4, u, { id: 'deadeye_slow', name: 'Deadeye', icon: '🎯' });
          const d = dirTo(u.position, t.position);
          if (!t.immobile && !t.isMagicImmune) forceMove(ab.game, t, t.position.clone().addScaledVector(d, ab.v('knockback') + 0.3), 0.1, { disable: false, id: 'deadeye_knock' });
        },
      };
    },
  },
  {
    id: 'pell_steady_sights', name: 'Steady Sights', icon: '🔭', targetType: 'passive',
    description: "Pell braces his rifle and fires from further away.",
    values: { range: [du(75), du(150), du(225), du(300)] },
    passive(ab) {
      return { bonus: { get attackRange() { return ab.v('range'); } }, vfxName: null };
    },
  },
  {
    id: 'pell_final_round', name: 'Final Round', icon: '☠️', targetType: 'unit', targetTeam: 'enemy', ultimate: true, castPoint: 2.0,
    description: "Pell takes careful aim at one enemy, then fires a slow, heavy shot across a huge range that briefly stuns.",
    cooldown: [20, 15, 10], manaCost: [175, 225, 275], castRange: [du(3000)], damageType: 'magical', aim: 'final_round_aim',
    values: { damage: [320, 485, 650], speed: du(2500) },
    scepter: { description: 'Final Round stuns for 1.5s and deals 50% of its damage to enemies within 400 of the target.', values: { stunDuration: 1.5, splash: du(400) } },
    hint: (ab) => ({ type: 'enemy', finisher: ab.v('damage') }),
    cast(ab, t) {
      const h = ab.hero, g = ab.game;
      fx(g, 'final_round_fire', { unit: h, position: chest(h, 0.7), target: t.position.clone() });
      g.projectiles?.launch({
        source: h, target: t, speed: ab.v('speed'), kind: 'final_round',
        onHit: (tt) => {
          if (!tt?.alive) return;
          damage(tt, ab.v('damage'), 'magical', h, ab);
          if (tt.alive) { tt.interrupt?.(); if (ab.hasScepter) stun(tt, ab.v('stunDuration'), h); else stun(tt, 0.05, h, { id: 'ministun', vfxName: null }); }
          if (ab.hasScepter) {
            for (const e of enemiesIn(g, h, tt.position, ab.v('splash'))) {
              if (e === tt) continue;
              damage(e, ab.v('damage') * 0.5, 'magical', h, ab);
              fx(g, 'hit', { position: chest(e), unit: e, color: 0xffaa55 });
            }
          }
          fx(g, 'final_round_hit', { position: chest(tt), unit: tt });
        },
      });
    },
  },
];
