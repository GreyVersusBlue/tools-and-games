import { du, fx, damage, enemiesIn, slow, dirTo, dist2d, safePoint, chest } from '../util.js';

export default [
  {
    id: 'gorrow_gut_hook', name: 'Gut Hook', icon: '🪝', targetType: 'point', castPoint: 0.3,
    description: "Throws a chained hook. The first unit it catches is dragged back to Gorrow, and enemies take damage.",
    cooldown: [14, 13, 12, 11], manaCost: [110, 120, 130, 140], castRange: [du(1100), du(1175), du(1250), du(1325)], radius: du(100), damageType: 'pure',
    values: { damage: [150, 220, 290, 360], speed: du(1450) },
    hint: { type: 'point', line: true, skillshot: true },
    cast(ab, p) {
      const h = ab.hero, g = ab.game;
      const dir = dirTo(h.position, p);
      const maxDist = ab.getCastRange();
      const speed = ab.v('speed');
      const hitR = ab.getRadius() * 0.55;
      const dmg = ab.v('damage');
      const head = chest(h, 0.55).addScaledVector(dir, 0.6);
      let traveled = 0;
      let phase = 'out';
      let hooked = null;
      const vis = g.vfx?.spawn?.('gut_hook', { unit: h, source: h, position: head.clone(), direction: dir }) ?? null;
      const hookMod = { id: 'gut_hooked', name: 'Gut Hook', icon: '🪝', debuff: true, duration: 10, stun: true, noStunVfx: true };
      let t = 0;
      g.abilities.addTask((dt) => {
        t += dt;
        const step = speed * dt;
        if (phase === 'out') {
          head.addScaledVector(dir, step);
          traveled += step;
          for (const u of g.units) {
            if (!u.alive || u === h || u.isStructure || u.immobile || u.isInvulnerable || u.kind === 'ward') continue;
            if (u.team !== h.team && (u.isMagicImmune || !g.canSee(h.team, u))) continue;
            if (Math.hypot(u.position.x - head.x, u.position.z - head.z) <= hitR + u.radius) { hooked = u; break; }
          }
          if (hooked) {
            phase = 'back';
            head.x = hooked.position.x; head.z = hooked.position.z;
            hooked.addModifier({ ...hookMod });
            hooked.interrupt?.();
            if (hooked.team !== h.team) {
              damage(hooked, dmg, 'pure', h, ab);
              fx(g, 'blood', { position: chest(hooked), unit: hooked, amount: 2 });
            }
            fx(g, 'gut_hook_hit', { position: head.clone(), unit: hooked });
            vis?.setHooked?.(hooked);
          } else if (traveled >= maxDist) phase = 'back';
        } else {
          const home = chest(h, 0.55);
          const d = Math.hypot(home.x - head.x, home.z - head.z);
          if (d <= step + 1.0 + (hooked ? hooked.radius : 0)) {
            if (hooked) {
              hooked.removeModifier('gut_hooked');
              if (hooked.alive) {
                const front = safePoint(g, h.position.clone().addScaledVector(dirTo(h.position, head), h.radius + hooked.radius + 0.1), h.position);
                hooked.position.x = front.x; hooked.position.z = front.z; hooked.path = [];
              }
            }
            vis?.remove?.();
            return true;
          }
          head.x += ((home.x - head.x) / d) * step;
          head.z += ((home.z - head.z) / d) * step;
          head.y = home.y;
          if (hooked) {
            if (!hooked.alive) { hooked = null; vis?.setHooked?.(null); }
            else { hooked.position.x = head.x; hooked.position.z = head.z; hooked.path = []; }
          }
        }
        vis?.setHead?.(head, phase);
        if (t > 8) { if (hooked) hooked.removeModifier('gut_hooked'); vis?.remove?.(); return true; }
        return false;
      });
    },
  },
  {
    id: 'gorrow_blight_cloud', name: 'Blight Cloud', icon: '☣️', targetType: 'toggle', castPoint: 0,
    description: "Gorrow releases a toxic cloud that damages and slows nearby enemies. It also hurts Gorrow.",
    cooldown: [0], manaCost: [0], radius: du(250), damageType: 'magical',
    values: { dps: [30, 60, 90, 120], slow: [0.2, 0.24, 0.28, 0.32] },
    hint: { type: 'toggle', minEnemies: 1 },
    toggle: {
      on(ab) {
        ab.data.acc = 0;
        ab.hero.addModifier({ id: 'blight_cloud', name: 'Blight Cloud', icon: '☣️', vfxName: 'blight_cloud', radius: ab.getRadius() });
      },
      off(ab) { ab.hero.removeModifier('blight_cloud'); },
      tick(ab, dt) {
        const h = ab.hero, g = ab.game;
        if (!h.hasModifier('blight_cloud')) h.addModifier({ id: 'blight_cloud', name: 'Blight Cloud', icon: '☣️', vfxName: 'blight_cloud' });
        ab.data.acc += dt;
        ab.data.sacc = (ab.data.sacc ?? 0) + dt;
        if (ab.data.sacc >= 0.2) {
          ab.data.sacc = 0;
          for (const e of enemiesIn(g, h, h.position, ab.getRadius())) slow(e, ab.v('slow'), 0.5, h, { id: 'blight_cloud_slow', name: 'Blight Cloud', icon: '☣️', vfxName: 'poison' });
        }
        if (ab.data.acc >= 0.5) {
          ab.data.acc -= 0.5;
          const d = ab.v('dps') * 0.5;
          for (const e of enemiesIn(g, h, h.position, ab.getRadius())) damage(e, d, 'magical', h, ab);
          damage(h, d, 'magical', h, ab, { noEvent: false, selfRot: true });
        }
      },
    },
  },
  {
    id: 'gorrow_stitched_hide', name: 'Stitched Hide', icon: '🥩', targetType: 'passive',
    description: "Gorrow stitches the remains of fallen enemy heroes into his hide, gaining strength when one dies nearby. Also grants magic resistance.",
    values: { strPerStack: [1.0, 1.5, 2.0, 2.5], magicResist: [0.04, 0.06, 0.08, 0.10], range: du(450) },
    onLearn(ab) {
      ab.data.stacks = ab.data.stacks ?? 0;
      ab.data.off?.();
      ab.data.off = ab.game.bus.on('hero:killed', ({ victim, killerHero }) => {
        const h = ab.hero;
        if (!victim || victim.team === h.team) return;
        if (killerHero === h || (h.alive && dist2d(victim.position, h.position) <= ab.v('range'))) {
          ab.data.stacks++;
          if (h.alive) fx(ab.game, 'stitched_hide', { unit: h, position: h.position.clone() });
        }
      });
    },
    passive(ab) {
      return {
        bonus: {
          get str() { return (ab.data.stacks ?? 0) * ab.v('strPerStack'); },
          get magicResist() { return ab.v('magicResist'); },
        },
      };
    },
  },
  {
    id: 'gorrow_devour', name: 'Devour', icon: '🔪', targetType: 'unit', targetTeam: 'enemy', ultimate: true, castPoint: 0.3,
    description: "Gorrow pins an enemy and feeds on it, disabling it and dealing damage over time. He heals for the damage dealt.",
    cooldown: [30, 25, 20], manaCost: [100, 130, 170], castRange: [du(160)], damageType: 'magical',
    values: { dps: [60, 90, 120], strMult: 0.3, duration: 3, pull: du(75) },
    scepter: { description: 'Strength damage multiplier doubled, Devour lasts 1s longer and its cast range is increased to 300.', values: { strMult: 0.6, duration: 4 }, castRange: [du(300)] },
    hint: { type: 'enemy', channel: true },
    channel: {
      duration: (ab) => ab.v('duration'),
      tick(ab, dt) {
        const t = ab.data.target, h = ab.hero;
        if (!t?.alive || !t.hasModifier('devoured')) { ab.stopChannel(true); return; }
        h.faceToward?.(t.position, dt);
        ab.data.acc += dt;
        if (ab.data.acc >= 0.5) {
          ab.data.acc -= 0.5;
          const dealt = damage(t, (ab.v('dps') + h.attr('str') * ab.v('strMult')) * 0.5, 'magical', h, ab);
          if (dealt > 0) h.heal(dealt, h);
          fx(ab.game, 'blood', { position: chest(t), unit: t, amount: 1 });
        }
        // pull slowly toward gorrow
        const d = dist2d(t.position, h.position);
        if (!t.immobile && d > h.radius + t.radius + 0.15) {
          const dir = dirTo(t.position, h.position);
          t.position.addScaledVector(dir, Math.min(ab.v('pull') * dt, d - h.radius - t.radius));
        }
      },
      end(ab) {
        ab.data.target?.removeModifier?.('devoured');
        ab.data.target = null;
      },
    },
    cast(ab, t) {
      ab.data.target = t;
      ab.data.acc = 0;
      t.addModifier({ id: 'devoured', name: 'Devour', icon: '🔪', debuff: true, duration: ab.v('duration') + 0.3, stun: true, noStunVfx: true, source: ab.hero, vfxName: 'devour' });
    },
  },
];

