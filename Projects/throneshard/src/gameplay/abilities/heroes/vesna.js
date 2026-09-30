import { du, fx, damage, slow, silence, dirTo, dist2d, forceMove, validEnemy, armorMultiplier, prd, chest, enemiesIn, THREE } from '../util.js';

function frostSlow(h, t) {
  const fa = h.abilities?.find((a) => a.def.id === 'vesna_chill_arrows');
  if (!fa || fa.level <= 0 || !t.alive) return;
  slow(t, fa.v('slow'), fa.v('duration'), h, { id: 'chill_arrows_slow', name: 'Chill Arrows', icon: '🥶', vfxName: 'frost_slow' });
}

export default [
  {
    id: 'vesna_chill_arrows', name: 'Chill Arrows', icon: '🥶', targetType: 'toggle', autocast: true, castPoint: 0,
    description: "Autocast. Vesna's arrows carry a biting cold that slows the target and deals bonus damage. Costs mana per arrow.",
    cooldown: [0], manaCost: [9, 10, 11, 12],
    values: { slow: [0.16, 0.28, 0.4, 0.52], duration: 1.5, damage: [10, 20, 30, 40] },
    hint: { type: 'toggle', autocast: true },
    onLearn(ab) { ab.toggled = true; },
    passive(ab) {
      return {
        onAttackStart(u, t, info) {
          const cost = ab.getManaCost();
          if (ab.toggled && t && !t.isStructure && t.alive && !u.isSilenced && u.mana >= cost) {
            u.spendMana(cost);
            info.frost = true;
            info.amount += ab.v('damage');
          }
          u.data.projectileKind = info.pierce ? 'vesna_hunters_eye' : info.frost ? 'vesna_chill_arrow' : 'vesna';
        },
        onAttackLanded(u, t, info) {
          if (info.frost) frostSlow(u, t);
        },
      };
    },
  },
  {
    id: 'vesna_hush_wind', name: 'Hush Wind', icon: '🌬️', targetType: 'point', castPoint: 0.25,
    description: "A rush of silent wind that silences enemies and pushes them away. Enemies closer to Vesna are pushed further.",
    cooldown: [16, 15, 14, 13], manaCost: [90, 90, 90, 90], castRange: [du(900)], radius: du(125),
    values: { silence: [3, 4, 5, 6], knockback: du(350), distance: du(900), speed: du(2000) },
    hint: { type: 'point', line: true, escape: true },
    cast(ab, p) {
      const h = ab.hero, g = ab.game;
      const dir = dirTo(h.position, p);
      const from = h.position.clone(); from.y += 1;
      const origin = h.position.clone();
      g.projectiles?.launch({
        source: h, from, direction: dir, distance: ab.v('distance'), width: ab.getRadius() * 1.6, speed: ab.v('speed'), kind: 'hush_wind',
        filter: (u) => validEnemy(h, u),
        onUnitHit: (u) => {
          silence(u, ab.v('silence'), h);
          const d = dist2d(origin, u.position);
          const kb = Math.max(du(100), ab.v('knockback') * (1 - d / ab.v('distance')));
          if (!u.immobile) forceMove(g, u, u.position.clone().addScaledVector(dir, kb), 0.35, { id: 'hush_wind_knockback' });
          fx(g, 'frost', { position: chest(u), small: true });
        },
      });
    },
  },
  {
    id: 'vesna_arrow_fan', name: 'Arrow Fan', icon: '🎇', targetType: 'point', castPoint: 0.1,
    description: "Vesna looses arrows in a cone over a short channel. Each arrow deals attack damage and applies Chill Arrows.",
    cooldown: [26, 24, 22, 20], manaCost: [50, 70, 90, 110], castRange: [0],
    values: { damagePct: [0.6, 0.8, 1.0, 1.2], waves: 3, arrows: 5, angle: Math.PI * 0.22, rangeMult: 1.75, speed: du(1500) },
    hint: { type: 'point', cone: true, channel: true },
    channel: {
      duration: 1.75,
      tick(ab, dt, t) {
        const times = [0.2, 0.75, 1.3];
        while ((ab.data.wave ?? 0) < times.length && t >= times[ab.data.wave]) {
          fireWave(ab);
          ab.data.wave++;
        }
      },
    },
    cast(ab, p) {
      ab.data.wave = 0;
      ab.data.dir = dirTo(ab.hero.position, p);
    },
  },
  {
    id: 'vesna_hunters_eye', name: "Hunter's Eye", icon: '🏹', targetType: 'passive', ultimate: true,
    description: "Vesna gains bonus agility, and her arrows sometimes ignore armor for bonus damage. Suppressed while an enemy hero is close.",
    values: { agiPct: [0.16, 0.24, 0.32], chance: [0.2, 0.3, 0.4], bonusDamage: [60, 70, 80], disableRange: du(400) },
    scepter: { description: "Vesna's attacks split, hitting one more enemy within 375 range of the target for 60% damage.", values: { splitRange: du(375), splitPct: 0.6 } },
    passive(ab) {
      const h = ab.hero;
      return {
        vfxName: 'hunters_eye',
        bonus: { get agi() { return (h.def.agi + h.def.agiGain * (h.level - 1)) * ab.v('agiPct'); } },
        onAttackStart(u, t, info) {
          if (!t || t.isStructure) return;
          const g = ab.game;
          if (g.heroes.some((e) => e.alive && e.team !== u.team && dist2d(e.position, u.position) <= ab.v('disableRange'))) return;
          if (!prd(u, 'marksman', ab.v('chance'))) return;
          info.pierce = true;
          info.amount += ab.v('bonusDamage');
          const mult = armorMultiplier(t.getStat('armor'));
          if (mult < 1 && mult > 0.05) info.amount /= mult;
          u.data.projectileKind = 'vesna_hunters_eye';
        },
        onAttackLanded(u, t, info) {
          if (!ab.hasScepter || info.split || !t || t.isStructure) return;
          const g = ab.game;
          const cands = enemiesIn(g, u, t.position, ab.v('splitRange')).filter((e) => e !== t && e.kind !== 'ward' && g.canSee(u.team, e));
          if (!cands.length) return;
          cands.sort((a, b) => (b.kind === 'hero') - (a.kind === 'hero') || a.distanceTo(t) - b.distanceTo(t));
          const e = cands[0];
          const amount = (info.amount ?? 0) * ab.v('splitPct');
          g.projectiles?.launch({
            source: u, from: chest(t, 0.6), target: e, speed: u.getStat('projectileSpeed') || du(1250), kind: 'vesna_chill_arrow', isAttack: true,
            onHit: (x) => { if (x?.alive) x.takeDamage(amount, 'physical', u, { isAttack: true, split: true }); },
          });
        },
      };
    },
  },
];

function fireWave(ab) {
  const h = ab.hero, g = ab.game;
  if (!h.alive) return;
  const base = ab.data.dir ?? new THREE.Vector3(Math.sin(h.facing), 0, Math.cos(h.facing));
  const n = ab.v('arrows'), spread = ab.v('angle');
  const baseAng = Math.atan2(base.x, base.z);
  const dist = h.getStat('attackRange') * ab.v('rangeMult');
  const hitThisWave = new Set();
  h.playAnim?.('attack', { once: true, speed: 2 });
  for (let i = 0; i < n; i++) {
    const a = baseAng + (n === 1 ? 0 : (i / (n - 1) - 0.5) * spread * 2);
    const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const from = h.position.clone().addScaledVector(dir, 0.6); from.y += 1.4;
    g.projectiles?.launch({
      source: h, from, direction: dir, distance: dist, width: 0.35, speed: ab.v('speed'), kind: 'vesna_chill_arrow', stopOnHit: true,
      filter: (u) => validEnemy(h, u) && !hitThisWave.has(u),
      onUnitHit: (u) => {
        hitThisWave.add(u);
        const info = h.rollAttackDamage(u);
        damage(u, info.amount * ab.v('damagePct'), 'physical', h, ab);
        frostSlow(h, u);
      },
    });
  }
}

