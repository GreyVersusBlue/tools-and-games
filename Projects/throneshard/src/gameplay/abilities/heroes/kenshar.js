import { du, fx, damage, enemiesIn, alliesIn, applyCrit, prd, safePoint, dist2d, THREE } from '../util.js';

export default [
  {
    id: 'kenshar_steel_cyclone', name: 'Steel Cyclone', icon: '🌪️', targetType: 'none', castPoint: 0,
    description: "Kenshar becomes a whirl of steel, immune to magic and cutting every enemy near him.",
    cooldown: [42, 34, 26, 18], manaCost: [120, 110, 100, 90], radius: du(250), damageType: 'magical',
    values: { dps: [85, 110, 135, 160], duration: 5, tick: 0.2 },
    hint: { type: 'self', minEnemies: 1, escape: true },
    cast(ab) {
      const h = ab.hero, g = ab.game;
      let acc = 0;
      h.removeModifier('steel_cyclone');
      h.addModifier({
        id: 'steel_cyclone', name: 'Steel Cyclone', icon: '🌪️', duration: ab.v('duration'), magicImmune: true, disarm: true,
        vfxName: 'steel_cyclone',
        onApply(u) { u.playAnim?.('spin') ; },
        onTick(u, dt) {
          acc += dt;
          const tick = ab.v('tick');
          while (acc >= tick) {
            acc -= tick;
            for (const e of enemiesIn(g, u, u.position, ab.getRadius())) {
              damage(e, ab.v('dps') * tick, 'magical', u, ab);
              if (Math.random() < 0.35) fx(g, 'hit', { position: e.position.clone().setY(1.2), color: 0xffaa55, small: true });
            }
          }
        },
      });
    },
  },
  {
    id: 'kenshar_mending_totem', name: 'Mending Totem', icon: '🏺', targetType: 'point', castPoint: 0.3,
    description: "Plants a totem that heals nearby allies for a share of their max health each second. The totem trails after Kenshar.",
    cooldown: [60, 60, 60, 60], manaCost: [120, 125, 130, 135], castRange: [du(350)], radius: du(500),
    values: { healPct: [0.02, 0.03, 0.04, 0.05], duration: 25 },
    hint: { type: 'point', selfPoint: true, healing: true },
    cast(ab, p) {
      const h = ab.hero, g = ab.game;
      ab.data.ward?.alive && ab.data.ward.die(null);
      const pos = safePoint(g, p, h.position);
      const ward = g.spawnUnit({
        kind: 'summon', subtype: 'mending_totem', name: 'Mending Totem', team: h.team, position: pos, modelKind: 'summon_mending_totem', owner: h,
        stats: { maxHp: 3, maxMana: 0, moveSpeed: du(420), damageMin: 0, damageMax: 0, attackRange: 0, collisionRadius: 0.35, bountyGold: [25, 25], bountyXp: 25, vision: du(500), acquireRange: 0, armor: 0 },
        controller: {
          update(u) {
            if (!h.alive) { if (u.order.type !== 'idle') u.issueOrder({ type: 'idle' }); return; }
            const d = dist2d(u.position, h.position);
            if (d > 3.5 && (u.order.type !== 'move' || dist2d(u.order.point, h.position) > 1.5)) u.issueOrder({ type: 'move', point: h.position.clone() });
          },
        },
      });
      ab.data.ward = ward;
      fx(g, 'spawn', { position: pos.clone(), color: 0x66ffaa });
      let acc = 0;
      const heal = ab.v('healPct');
      ward.addModifier({ id: 'ward_disarm', hidden: true, disarm: true });
      ward.addModifier({
        id: 'mending_totem_aura', name: 'Mending Totem', icon: '🏺', duration: ab.v('duration'), vfxName: 'mending_totem',
        radius: ab.getRadius(),
        onDamageTaken(u, info) { info.amount = info.isAttack ? 1 : 0; },
        onTick(u, dt) {
          acc += dt;
          if (acc < 0.5) return;
          acc -= 0.5;
          for (const a of alliesIn(g, u, u.position, ab.getRadius(), (x) => x !== u)) a.heal(a.getStat('maxHp') * heal * 0.5, u);
        },
        onExpire(u) {
          if (u.alive) { u.baseStats.bountyGold = [0, 0]; u.baseStats.bountyXp = 0; u.die(null); }
        },
      });
    },
  },
  {
    id: 'kenshar_keen_edge', name: 'Keen Edge', icon: '⚔️', targetType: 'passive',
    description: "Kenshar's attacks have a chance to land as critical strikes.",
    values: { chance: [0.2, 0.25, 0.3, 0.35], crit: 1.8 },
    passive(ab) {
      return {
        onAttackStart(u, t, info) {
          if (t?.isStructure) return;
          if (prd(u, 'keen_edge', ab.v('chance'))) applyCrit(info, ab.v('crit'), 'keen_edge');
        },
        onAttackLanded(u, t, info) {
          if (info.critTag === 'keen_edge') fx(ab.game, 'crit', { unit: t, source: u, position: t.position.clone(), amount: info.dealt, color: 0xff5522 });
        },
      };
    },
  },
  {
    id: 'kenshar_thousand_cuts', name: 'Thousand Cuts', icon: '💥', targetType: 'unit', targetTeam: 'enemy', ultimate: true, castPoint: 0.3,
    description: "Kenshar dashes to an enemy and cuts through it and every foe nearby, one strike after another. He cannot be harmed while slashing.",
    cooldown: [130, 120, 110], manaCost: [200, 275, 350], castRange: [du(350)], radius: du(425), pierceImmunity: true, damageType: 'physical',
    values: { slashes: [3, 6, 9], interval: 0.3, bonusDamage: 40 },
    scepter: { description: '+3 slashes, slashes come 33% faster and deal +30 bonus damage.', values: { slashes: [6, 9, 12], interval: 0.2, bonusDamage: 70 } },
    cast(ab, first) {
      const h = ab.hero, g = ab.game;
      let left = ab.v('slashes');
      let timer = 0;
      let target = first;
      const mod = h.addModifier({ id: 'thousand_cuts', name: 'Thousand Cuts', icon: '💥', duration: 60, invulnerable: true, stun: true, noStunVfx: true, vfxName: 'thousand_cuts' });
      const slash = () => {
        if (!target?.alive || target.isInvulnerable || !g.canSee(h.team, target) || dist2d(target.position, h.position) > ab.getRadius() + 2) {
          const cands = enemiesIn(g, h, h.position, ab.getRadius(), { pierceImmunity: true }).filter((u) => g.canSee(h.team, u) && u.kind !== 'ward');
          if (!cands.length) return false;
          const heroes = cands.filter((u) => u.kind === 'hero');
          const pool = heroes.length ? heroes : cands;
          target = pool[Math.floor(Math.random() * pool.length)];
        }
        const from = h.position.clone();
        const ang = Math.random() * Math.PI * 2;
        const r = (target.radius ?? 0.7) + h.radius + 0.1;
        const dest = safePoint(g, new THREE.Vector3(target.position.x + Math.cos(ang) * r, 0, target.position.z + Math.sin(ang) * r), target.position);
        h.position.x = dest.x; h.position.z = dest.z;
        h.facing = Math.atan2(target.position.x - dest.x, target.position.z - dest.z);
        fx(g, 'thousand_cuts_slash', { position: from, target: dest.clone(), unit: target, source: h });
        h.playAnim?.('attack', { once: true, speed: 2.5 });
        const info = h.rollAttackDamage(target);
        info.amount += ab.v('bonusDamage');
        h.landAttack(target, info);
        left--;
        return true;
      };
      slash();
      g.abilities.addTask((dt) => {
        if (!h.alive) return true;
        timer += dt;
        if (left > 0 && timer >= ab.v('interval')) {
          timer = 0;
          if (!slash()) left = 0;
        }
        if (left <= 0 && timer >= 0.15) {
          h.removeModifier(mod);
          h.issueOrder({ type: 'idle' });
          fx(g, 'blink', { position: h.position.clone(), color: 0xffaa33, arrive: true });
          return true;
        }
        return false;
      });
    },
  },
];
