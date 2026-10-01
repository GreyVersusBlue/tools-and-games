import { du, fx, damage, enemiesIn, slow, THREE } from '../util.js';

export default [
  {
    id: 'isolde_rime_burst', name: 'Rime Burst', icon: '❄️', targetType: 'point', castPoint: 0.3,
    description: "An explosion of frost damages enemies in an area and slows their movement and attacks.",
    cooldown: [11, 10, 9, 8], manaCost: [100, 120, 140, 160], castRange: [du(700)], radius: du(425), damageType: 'magical',
    values: { damage: [110, 160, 210, 260], slow: [0.2, 0.3, 0.4, 0.5], attackSlow: [20, 30, 40, 50], duration: 4.5 },
    cast(ab, p) {
      const h = ab.hero, g = ab.game, r = ab.getRadius();
      fx(g, 'rime_burst', { position: p.clone(), radius: r });
      for (const e of enemiesIn(g, h, p, r)) {
        damage(e, ab.v('damage'), 'magical', h, ab);
        slow(e, ab.v('slow'), ab.v('duration'), h, { id: 'rime_burst_slow', name: 'Rime Burst', icon: '❄️', attackSlow: ab.v('attackSlow'), vfxName: 'frost_slow' });
      }
    },
  },
  {
    id: 'isolde_ice_shackles', name: 'Ice Shackles', icon: '🧊', targetType: 'unit', targetTeam: 'enemy', castPoint: 0.3,
    description: "Locks an enemy in ice. It cannot move or attack and takes damage while frozen.",
    cooldown: [9, 8, 7, 6], manaCost: [140, 145, 150, 155], castRange: [du(550)], damageType: 'magical',
    values: { duration: [1.5, 2.0, 2.5, 3.0], totalDamage: [100, 150, 200, 250], creepDuration: 10 },
    cast(ab, t) {
      const h = ab.hero, g = ab.game;
      const dur = t.kind === 'hero' || t.kind === 'grimmaw' ? ab.v('duration') : Math.min(ab.v('creepDuration'), ab.v('duration') * 2.5);
      const dps = ab.v('totalDamage') / ab.v('duration');
      let acc = 0;
      fx(g, 'ice_shackles_cast', { unit: t, source: h, position: t.position.clone() });
      t.removeModifier('ice_shackles');
      t.addModifier({
        id: 'ice_shackles', name: 'Ice Shackles', icon: '🧊', debuff: true, duration: dur, root: true, disarm: true, source: h,
        vfxName: 'ice_shackles',
        onApply(u) { u.interrupt?.(); },
        onTick(u, dt) {
          acc += dt;
          if (acc >= 0.5) { acc -= 0.5; damage(u, dps * 0.5, 'magical', h, ab); }
        },
      });
    },
  },
  {
    id: 'isolde_wellspring_aura', name: 'Wellspring Aura', icon: '🔷', targetType: 'passive',
    description: "Every allied hero on the map regenerates mana faster. Isolde gets three times the bonus.",
    values: { regen: [0.5, 1.0, 1.5, 2.0], selfMult: 3 },
    aura: {
      interval: 0.25,
      targets: (ab) => ab.game.heroes.filter((x) => x.alive && x.team === ab.hero.team),
      modifier: (ab, u) => {
        const isSelf = u === ab.hero;
        return {
          id: 'wellspring_aura', name: 'Wellspring Aura', icon: '🔷', aura: true,
          bonus: { get manaRegen() { return ab.v('regen') * (isSelf ? ab.v('selfMult') : 1); } },
        };
      },
    },
  },
  {
    id: 'isolde_blizzard_veil', name: 'Blizzard Veil', icon: '🌨️', targetType: 'none', ultimate: true, castPoint: 0.3,
    description: "Isolde channels a storm around herself for up to 10 seconds. Icy blasts land at random, damaging and slowing enemies, and she gains armor.",
    cooldown: [110, 100, 90], manaCost: [200, 400, 600], radius: du(810), damageType: 'magical',
    values: { explosionDamage: [105, 170, 250], explosionRadius: du(300), interval: 0.1, slow: 0.3, attackSlow: 30, armor: 20, duration: 10 },
    scepter: { description: "Explosions deal +60 damage, and every 2 seconds Isolde casts Ice Shackles on the nearest enemy hero within 600 range.", values: { explosionDamage: [165, 230, 310] } },
    hint: { type: 'self', minEnemies: 1, channel: true },
    channel: {
      duration: (ab) => ab.v('duration'),
      tick(ab, dt) {
        const h = ab.hero, g = ab.game;
        const d = ab.data;
        d.acc = (d.acc ?? 0) + dt;
        d.slowAcc = (d.slowAcc ?? 0) + dt;
        if (d.slowAcc >= 0.25) {
          d.slowAcc = 0;
          for (const e of enemiesIn(g, h, h.position, ab.getRadius())) slow(e, ab.v('slow'), 1.0, h, { id: 'blizzard_veil_slow', name: 'Blizzard Veil', icon: '🌨️', attackSlow: ab.v('attackSlow'), vfxName: 'frost_slow' });
        }
        // Ascendant Scepter: periodic Ice Shackles on the nearest enemy hero (uses the learned Ice Shackles level, min 1)
        if (ab.hasScepter) {
          d.fbAcc = (d.fbAcc ?? 1.5) + dt;
          if (d.fbAcc >= 2) {
            const fb = h.abilities.find((a) => a?.def.id === 'isolde_ice_shackles');
            const cands = enemiesIn(g, h, h.position, du(600), { heroesOnly: true }).filter((e) => !e.hasModifier('ice_shackles') && g.canSee(h.team, e));
            cands.sort((a, b) => a.distanceTo(h) - b.distanceTo(h));
            if (fb && cands[0]) {
              d.fbAcc = 0;
              const lvl = fb.level;
              if (!fb.level) fb.level = 1;
              try { fb.def.cast(fb, cands[0]); } finally { fb.level = lvl; }
            }
          }
        }
        while (d.acc >= ab.v('interval')) {
          d.acc -= ab.v('interval');
          d.q = ((d.q ?? 0) + 1) % 4;
          const ang = (d.q * Math.PI) / 2 + Math.random() * (Math.PI / 2);
          const dist = du(195) + Math.random() * (du(785) - du(195));
          const p = new THREE.Vector3(h.position.x + Math.cos(ang) * dist, 0, h.position.z + Math.sin(ang) * dist);
          const r = ab.v('explosionRadius');
          fx(g, 'blizzard_veil_explosion', { position: p, radius: r });
          g.delay(0.1, () => {
            if (!h.alive) return;
            for (const e of enemiesIn(g, h, p, r)) damage(e, ab.v('explosionDamage'), 'magical', h, ab);
          });
        }
      },
      end(ab) {
        ab.data.fieldFx?.remove?.();
        ab.data.fieldFx = null;
        ab.hero.removeModifier('blizzard_veil_armor');
      },
    },
    cast(ab) {
      const h = ab.hero, g = ab.game;
      ab.data.acc = 0;
      h.addModifier({ id: 'blizzard_veil_armor', name: 'Blizzard Veil', icon: '🌨️', duration: ab.v('duration') + 0.2, bonus: { armor: ab.v('armor') } });
      ab.data.fieldFx?.remove?.();
      ab.data.fieldFx = g.vfx?.attachToUnit?.(h, 'blizzard_veil', { radius: ab.getRadius(), duration: ab.v('duration') + 0.5 }) ?? null;
    },
  },
];
