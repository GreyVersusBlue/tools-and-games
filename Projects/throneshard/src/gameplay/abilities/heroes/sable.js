import { du, fx, slow, applyCrit, prd, safePoint, dirTo, chest, orderAfterCast, THREE } from '../util.js';

export default [
  {
    id: 'sable_throwing_knife', name: 'Throwing Knife', icon: '🔪', targetType: 'unit', targetTeam: 'enemy', castPoint: 0.2,
    description: "Throws a knife that slows an enemy and deals part of Sable's attack damage plus bonus damage. Can trigger attack effects such as Killing Edge.",
    cooldown: [6, 6, 6, 6], manaCost: [30, 30, 30, 30], castRange: [du(700), du(850), du(1000), du(1150)], damageType: 'physical',
    values: { baseDamage: 65, attackFactor: [0.3, 0.45, 0.6, 0.75], slow: 0.5, duration: [1.75, 2.5, 3.25, 4.0], speed: du(1200) },
    hint: { type: 'enemy', harass: true, lastHit: true },
    cast(ab, t) {
      const h = ab.hero, g = ab.game;
      g.projectiles?.launch({
        source: h, target: t, speed: ab.v('speed'), kind: 'throwing_knife',
        onHit: (tt) => {
          if (!tt?.alive || tt.isMagicImmune) return;
          const info = h.rollAttackDamage(tt);
          info.amount = ab.v('baseDamage') * (info.critMult ?? 1) + info.amount * ab.v('attackFactor');
          h.landAttack(tt, info);
          slow(tt, ab.v('slow'), ab.v('duration'), h, { id: 'throwing_knife_slow', name: 'Throwing Knife', icon: '🔪' });
          fx(g, 'hit', { position: chest(tt), color: 0xbb88ff });
        },
      });
    },
  },
  {
    id: 'sable_shadow_step', name: 'Shadow Step', icon: '👻', targetType: 'unit', targetTeam: 'any', castPoint: 0.25,
    description: "Sable steps through the shadows to any unit. When the target is an enemy, her next attacks come faster.",
    cooldown: [11, 9, 7, 5], manaCost: [35, 40, 45, 50], castRange: [du(1000)],
    values: { attackSpeed: [100, 125, 150, 175], duration: 2.5, attacks: 4 },
    hint: { type: 'enemy', gapCloser: true, escapeToAlly: true },
    cast(ab, t) {
      const h = ab.hero, g = ab.game;
      const from = h.position.clone();
      const d = dirTo(t.position, from);
      const back = t.team !== h.team ? d.clone().negate() : d; // land behind enemies
      const dest = safePoint(g, new THREE.Vector3(t.position.x + back.x * (t.radius + h.radius + 0.1), 0, t.position.z + back.z * (t.radius + h.radius + 0.1)), t.position);
      fx(g, 'shadow_step', { position: from, target: dest.clone(), source: h, unit: h });
      h.position.x = dest.x; h.position.z = dest.z; h.path = [];
      h.facing = Math.atan2(t.position.x - dest.x, t.position.z - dest.z);
      if (t.team !== h.team) {
        let n = ab.v('attacks');
        h.addModifier({
          id: 'shadow_step', name: 'Shadow Step', icon: '👻', duration: ab.v('duration'), bonus: { attackSpeed: ab.v('attackSpeed') },
          vfxName: 'shadow_step_buff',
          onAttackLanded() { n--; if (n <= 0) this.remaining = 0; },
        });
        orderAfterCast(h, ab, { type: 'attack', target: t });
        h.attackCooldown = 0;
      }
    },
  },
  {
    id: 'sable_haze', name: 'Haze', icon: '🌫️', targetType: 'passive',
    description: "A shimmering haze surrounds Sable, letting her evade enemy attacks.",
    values: { evasion: [0.2, 0.25, 0.3, 0.35] },
    passive(ab) {
      return {
        vfxName: 'haze',
        onDamageTaken(u, info) {
          if (!info.isAttack || info.amount <= 0) return;
          if (prd(u, 'haze', ab.v('evasion'))) {
            info.amount = 0;
            info.evaded = true;
            ab.game.vfx?.floatingText?.('MISS', chest(u, 1.1), { color: '#d0b0ff', size: 0.9 });
          }
        },
      };
    },
  },
  {
    id: 'sable_killing_edge', name: 'Killing Edge', icon: '🩸', targetType: 'passive', ultimate: true,
    description: "Sable's attacks have a chance to find a vital spot and land as a devastating critical strike.",
    values: { chance: 0.17, crit: [2.0, 3.25, 4.5] },
    scepter: { description: 'Critical strike chance increased to 25%; Killing Edge crits slow the target by 50% for 1.5s.', values: { chance: 0.25 } },
    passive(ab) {
      return {
        onAttackStart(u, t, info) {
          if (t?.isStructure) return;
          if (prd(u, 'coup', ab.v('chance'))) applyCrit(info, ab.v('crit'), 'killing_edge');
        },
        onAttackLanded(u, t, info) {
          if (info.critTag !== 'killing_edge') return;
          if (ab.hasScepter && t?.alive && !t.isMagicImmune) t.addModifier({ id: 'killing_edge_slow', name: 'Killing Edge', icon: '🩸', debuff: true, duration: 1.5, slow: 0.5, source: u });
          fx(ab.game, 'killing_edge', { unit: t, source: u, position: t.position.clone(), direction: dirTo(u.position, t.position), amount: info.dealt });
        },
      };
    },
  },
];
