import * as THREE from 'three';

// Projectile system. Visuals are delegated to game.vfx.createProjectile(kind, opts) when available.
// launch(opts):
//   source: Unit (required)            kind: string (visual key, e.g. 'arrow', 'fireball', 'tower', hero model id)
//   target?: Unit  -> homing projectile; onHit(target) when it arrives (dodgeable if target blinks: not implemented)
//   point?: Vector3 -> travels to point; onHit(null, point) on arrival
//   direction?: Vector3 + distance + width -> linear skillshot; onUnitHit(unit) for each enemy touched,
//                                             stopOnHit (bool), onEnd(point)
//   speed: world units/sec              from?: Vector3 (defaults to source position + height)
export class Projectiles {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  launch(opts) {
    const g = this.game;
    const from = opts.from ? opts.from.clone() : opts.source.position.clone();
    if (!opts.from) from.y += (opts.source.model?.height ?? 2) * 0.7;
    const p = {
      ...opts,
      pos: from,
      traveled: 0,
      hitSet: new Set(),
      dead: false,
      visual: null,
    };
    if (opts.direction) p.direction = opts.direction.clone().setY(0).normalize();
    const vis = g.vfx?.createProjectile?.(opts.kind ?? 'default', { source: opts.source, isAttack: opts.isAttack, width: opts.width });
    if (vis) {
      p.visual = vis;
      const obj = vis.object ?? vis;
      obj.position.copy(from);
      if (!obj.parent) g.scene.add(obj);
    } else {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffdd88 }));
      m.position.copy(from);
      g.scene.add(m);
      p.visual = { object: m };
    }
    this.list.push(p);
    g.bus.emit('projectile:launch', { projectile: p });
    return p;
  }

  update(dt) {
    const g = this.game;
    for (const p of this.list) {
      if (p.dead) continue;
      const step = p.speed * dt;
      let goal;
      if (p.target) {
        if (!p.target.alive && !p.keepOnDeath) { this.kill(p); continue; }
        goal = p.target.position.clone();
        goal.y += (p.target.model?.height ?? 2) * 0.55;
      } else if (p.point) goal = p.point.clone().setY(p.pos.y);
      if (goal) {
        const d = goal.clone().sub(p.pos);
        const len = d.length();
        if (len <= step + 0.2) {
          p.pos.copy(goal);
          this.hit(p);
          continue;
        }
        d.multiplyScalar(step / len);
        p.pos.add(d);
        this.orient(p, d);
      } else if (p.direction) {
        const d = p.direction.clone().multiplyScalar(step);
        p.pos.add(d);
        p.traveled += step;
        this.orient(p, d);
        const hits = g.enemiesInRadius(p.source.team, p.pos, (p.width ?? 1) + 0.8, (u) => !p.hitSet.has(u) && (p.filter ? p.filter(u) : true));
        for (const u of hits) {
          p.hitSet.add(u);
          p.onUnitHit?.(u, p);
          if (p.stopOnHit) { this.kill(p, true); break; }
        }
        if (!p.dead && p.traveled >= (p.distance ?? 20)) { p.onEnd?.(p.pos.clone(), p); this.kill(p, true); }
      }
      const obj = p.visual?.object ?? p.visual;
      if (obj?.position) obj.position.copy(p.pos);
      p.visual?.update?.(dt);
    }
    if (this.list.some((p) => p.dead)) this.list = this.list.filter((p) => !p.dead);
  }

  orient(p, d) {
    const obj = p.visual?.object ?? p.visual;
    if (obj && d.lengthSq() > 0) obj.lookAt(p.pos.clone().add(d));
  }

  hit(p) {
    try {
      p.onHit?.(p.target ?? null, p.pos.clone(), p);
    } catch (e) { console.error('[projectile onHit]', e); }
    this.game.bus.emit('projectile:hit', { projectile: p, target: p.target, position: p.pos.clone() });
    this.game.vfx?.projectileImpact?.(p.kind ?? 'default', p.pos.clone(), p);
    this.kill(p);
  }

  kill(p, impact = false) {
    p.dead = true;
    if (impact) this.game.vfx?.projectileImpact?.(p.kind ?? 'default', p.pos.clone(), p);
    if (p.visual?.dispose) p.visual.dispose();
    else {
      const obj = p.visual?.object ?? p.visual;
      obj?.parent?.remove(obj);
    }
  }
}
