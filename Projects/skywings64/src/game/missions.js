// Missions: each has build(world, scene) -> Course (rings/targets/landing + update()).
// All placement is derived from world.pads / world.landingZones / world.heightAt so courses are reachable.
import * as THREE from 'three';

const V3 = THREE.Vector3;
export const factories = {}; // {createRing, createLandingPadMesh, createTargetMarker} injected by main.js (fx/effects.js)
export function setFactories(f) { Object.assign(factories, f || {}); }

const RING_COLORS = [0xffd23c, 0x3cf0ff, 0xff5fa8, 0x8cff4a];
const WORLD_LIM = 1900;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// World pad headings are compass-style: forward = (sin h, 0, -cos h). Vehicles use the mirrored convention (see Game.prepare).
export function fwdOf(h) { return new V3(Math.sin(h), 0, -Math.cos(h)); }

function safeHeight(world, x, z) {
  try { const h = world.heightAt(x, z); return isFinite(h) ? h : 0; } catch (e) { return 0; }
}
function groundY(world, x, z) { return Math.max(0, safeHeight(world, x, z)); }

function getPad(world, key) {
  const p = world.pads && world.pads[key];
  if (p && p.position) return { position: p.position.clone(), heading: p.heading || 0 };
  return { position: new V3(0, groundY(world, 0, 0), 0), heading: 0 };
}
function getZone(world, key, pad) {
  const z = world.landingZones && world.landingZones[key];
  if (z && z.position) return { position: z.position.clone(), radius: z.radius || 25 };
  const f = fwdOf(pad.heading).multiplyScalar(250);
  const p = pad.position.clone().add(f);
  p.y = groundY(world, p.x, p.z);
  return { position: p, radius: 25 };
}

function findLand(world, x, z) {
  const ok = (a, b) => safeHeight(world, a, b) > 3 && (!world.surfaceAt || world.surfaceAt(a, b) !== 'water');
  if (ok(x, z)) return new V3(x, safeHeight(world, x, z), z);
  for (let r = 40; r <= 900; r += 40) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (Math.abs(px) < WORLD_LIM && Math.abs(pz) < WORLD_LIM && ok(px, pz)) return new V3(px, safeHeight(world, px, pz), pz);
    }
  }
  return new V3(x, groundY(world, x, z), z);
}

function findPeak(world, awayFrom, minDist) {
  let best = null, bh = -1e9;
  for (let x = -WORLD_LIM; x <= WORLD_LIM; x += 50) {
    for (let z = -WORLD_LIM; z <= WORLD_LIM; z += 50) {
      const h = safeHeight(world, x, z);
      if (h > bh && Math.hypot(x - awayFrom.x, z - awayFrom.z) > minDist) { bh = h; best = new V3(x, h, z); }
    }
  }
  return best || new V3(0, 100, 0);
}

function fallbackRing(radius, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 });
  g.add(new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.08, 8, 28), mat));
  let t = 0;
  g.userData = {
    update(dt) { t += dt; g.scale.setScalar(1 + Math.sin(t * 4) * 0.02); },
    setActive(b) { mat.opacity = b ? 1 : 0.45; },
    collect() { mat.opacity = 0.15; },
  };
  return g;
}

function fallbackPad(radius) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.4, 24), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  const m2 = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.7, radius * 0.7, 0.5, 24), new THREE.MeshLambertMaterial({ color: 0xe03030 }));
  const m3 = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.35, radius * 0.35, 0.6, 24), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  g.add(m, m2, m3);
  g.userData = { update() {} };
  return g;
}

function makeTargetMesh() {
  const g = new THREE.Group();
  const mk = (r, c, y) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.5, 20), new THREE.MeshLambertMaterial({ color: c }));
    m.position.y = y; g.add(m);
  };
  mk(14, 0xffffff, 0.3); mk(10.5, 0xe02020, 0.6); mk(7, 0xffffff, 0.9); mk(3.5, 0xe02020, 1.2);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 24, 6), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
  pole.position.y = 12; g.add(pole);
  const flag = new THREE.Mesh(new THREE.BoxGeometry(7, 3.5, 0.3), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
  flag.position.set(3.5, 22, 0); g.add(flag);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 120, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff4040, transparent: true, opacity: 0.25, depthWrite: false }));
  beam.position.y = 60; g.add(beam);
  return g;
}

// ---------------------------------------------------------------------------------------------
class Course {
  constructor(world, scene, key) {
    this.world = world; this.scene = scene; this.key = key;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.rings = [];
    this.targets = [];
    this.landing = null;
    this.last = -1;          // highest ring index passed
    this.hits = 0;
    this.targetHits = 0;
    this.prev = new V3();
    this.havePrev = false;
    this.extra = null;       // fn(dt, vehicle, ctx, events)
    this.hudExtra = '';
    this.free = false;
    this._active = -2;
    this._time = 0;
  }

  addRing(pos, radius, normal) {
    const idx = this.rings.length;
    const color = RING_COLORS[idx % RING_COLORS.length];
    let mesh;
    try { mesh = (factories.createRing || fallbackRing)(radius, color); } catch (e) { mesh = fallbackRing(radius, color); }
    mesh.position.copy(pos);
    const n = normal.clone().normalize();
    mesh.quaternion.setFromUnitVectors(new V3(0, 0, 1), n);
    this.group.add(mesh);
    this.rings.push({ position: pos.clone(), radius, normal: n, mesh, passed: false, fade: -1 });
    return idx;
  }

  setLanding(pos, radius) {
    let mesh;
    try { mesh = (factories.createLandingPadMesh || fallbackPad)(radius); } catch (e) { mesh = fallbackPad(radius); }
    mesh.position.set(pos.x, groundY(this.world, pos.x, pos.z) + 0.25, pos.z);
    this.group.add(mesh);
    this.landing = { position: pos.clone(), radius, mesh };
  }

  addTarget(pos) {
    let mesh;
    try { mesh = factories.createTargetMarker ? factories.createTargetMarker(16) : makeTargetMesh(); } catch (e) { mesh = makeTargetMesh(); }
    mesh.position.set(pos.x, groundY(this.world, pos.x, pos.z) + 0.1, pos.z);
    this.group.add(mesh);
    this.targets.push({ position: mesh.position.clone(), radius: 22, alive: true, mesh });
  }

  get ringsTotal() { return this.rings.length; }
  get targetsTotal() { return this.targets.length; }
  get aliveTargets() { return this.targets.filter((t) => t.alive).length; }
  openRing() { return this.rings[this.last + 1] || null; }

  update(dt, vehicle, ctx) {
    const events = [];
    this._time += dt;
    const pos = vehicle.position;
    if (!this.havePrev) { this.prev.copy(pos); this.havePrev = true; }
    // ring passage (any ring after the last one passed; skipped rings count as missed)
    for (let i = this.last + 1; i < this.rings.length; i++) {
      const r = this.rings[i];
      const d0 = this.prev.clone().sub(r.position).dot(r.normal);
      const d1 = pos.clone().sub(r.position).dot(r.normal);
      if (d0 !== d1 && d0 * d1 <= 0) {
        const t = d0 / (d0 - d1);
        const cross = this.prev.clone().lerp(pos, t);
        if (cross.distanceTo(r.position) <= r.radius * 1.12) {
          r.passed = true; r.fade = 1.0;
          this.hits++;
          this.last = i;
          try { r.mesh.userData.collect && r.mesh.userData.collect(); } catch (e) { /* ignore */ }
          events.push({ type: 'ring', index: i, position: r.position.clone() });
          break;
        }
      }
    }
    this.prev.copy(pos);
    if (this.extra) this.extra(dt, vehicle, ctx || {}, events);
    // ring visuals
    const active = this.last + 1;
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      const ud = r.mesh.userData || {};
      if (ud.update) ud.update(dt);
      if (r.fade >= 0) { r.fade -= dt; if (r.fade < 0) r.mesh.visible = false; }
      else if (i <= this.last) r.mesh.visible = false; // missed
    }
    if (active !== this._active) {
      this._active = active;
      this.rings.forEach((r, i) => {
        try {
          const ud = r.mesh.userData;
          ud.setActive && ud.setActive(i === active);
          // ghost path: active ring points at the next ring, the last one at the landing pad
          if (i === active && ud.linkNext) {
            const nx = this.rings[i + 1];
            ud.linkNext(nx ? nx.mesh : (this.landing ? this.landing.mesh.position.clone().setY(this.landing.mesh.position.y + 12) : null));
          }
        } catch (e) { /* ignore */ }
      });
    }
    for (const t of this.targets) { const u = t.mesh.userData; if (t.alive && u && u.update) u.update(dt); }
    if (this.landing) {
      const lu = this.landing.mesh.userData || {};
      const done = !this.openRing() && !(this.targets.length && this.aliveTargets > 0);
      if (done !== this._padOn && lu.setActive) { this._padOn = done; lu.setActive(done); }
      if (lu.update) lu.update(dt);
    }
    return events;
  }

  getObjective() {
    if (this.free) return '';
    if (this.targets.length && this.aliveTargets > 0) return 'DESTROY TARGETS ' + this.targetHits + '/' + this.targets.length + this.hudExtra;
    if (this.openRing()) return 'FLY THROUGH THE RINGS';
    if (this.landing) return 'LAND ON THE PAD';
    return '';
  }

  getTarget(vehicle) {
    if (this.free) return null;
    if (this.targets.length && this.aliveTargets > 0) {
      let best = null, bd = 1e12;
      for (const t of this.targets) {
        if (!t.alive) continue;
        const d = t.position.distanceToSquared(vehicle.position);
        if (d < bd) { bd = d; best = t.position; }
      }
      return best;
    }
    const r = this.openRing();
    if (r) return r.position;
    return this.landing ? this.landing.position : null;
  }

  markers() {
    const m = [];
    for (const r of this.rings) if (!r.passed && r.mesh.visible) m.push({ x: r.position.x, z: r.position.z, color: '#ffd23c', radius: 3 });
    for (const t of this.targets) if (t.alive) m.push({ x: t.position.x, z: t.position.z, color: '#ff3030', radius: 4 });
    if (this.landing) m.push({ x: this.landing.position.x, z: this.landing.position.z, color: '#40ff70', radius: 5 });
    return m;
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    // free GPU resources (every retry rebuilds the course): factory meshes know their own shared caches
    const owned = [];
    for (const r of this.rings) owned.push(r.mesh);
    if (this.landing) owned.push(this.landing.mesh);
    for (const t of this.targets) owned.push(t.mesh);
    for (const o of owned) { try { if (o.userData && o.userData.dispose) o.userData.dispose(); } catch (e) { /* ignore */ } }
    // (disposing a cached/shared geometry is safe: three.js re-uploads it the next time it is drawn)
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) { if (m.map) m.map.dispose(); m.dispose(); }
    });
  }
}

// Ring chain from A to B with lateral sway and an optional forward bulge (for short hops).
function pathRings(course, world, A, B, n, opt) {
  const d = Math.hypot(B.x - A.x, B.z - A.z);
  const dir = new V3(B.x - A.x, 0, B.z - A.z);
  if (dir.lengthSq() < 1) dir.set(0, 0, -1);
  dir.normalize();
  const perp = new V3(-dir.z, 0, dir.x);
  const amp = Math.max(opt.minAmp || 40, d * (opt.ampFrac || 0.18)) * (opt.flip ? -1 : 1);
  const bulge = Math.max(0, (opt.minDist || 0) - d) * 0.6;
  const bdir = opt.bulgeDir || dir;
  const pt = (t) => {
    const s = Math.sin(Math.PI * t);
    const x = A.x + (B.x - A.x) * t + perp.x * amp * s * Math.sin(t * Math.PI * 2 * 0.5 + 0.0) + bdir.x * bulge * s;
    const z = A.z + (B.z - A.z) * t + perp.z * amp * s * Math.sin(t * Math.PI * 2 * 0.5 + 0.0) + bdir.z * bulge * s;
    return new V3(clamp(x, -WORLD_LIM, WORLD_LIM), 0, clamp(z, -WORLD_LIM, WORLD_LIM));
  };
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const p = pt(t);
    const p2 = pt(Math.min(1, t + 0.03)), p1 = pt(Math.max(0, t - 0.03));
    const tangent = p2.sub(p1); tangent.y = 0;
    if (tangent.lengthSq() < 1e-4) tangent.copy(dir);
    const g = groundY(world, p.x, p.z);
    p.y = Math.max(g + opt.minClear, opt.alt(t, g));
    // gentle vertical component along descent
    const t2 = pt(Math.min(1, t + 0.05));
    const y2 = Math.max(groundY(world, t2.x, t2.z) + opt.minClear, opt.alt(Math.min(1, t + 0.05), 0));
    tangent.normalize();
    tangent.y = clamp((y2 - p.y) / Math.max(20, d * 0.05), -0.5, 0.5);
    course.addRing(p, opt.radius, tangent);
  }
}

function spiralRings(course, world, C, radius, count, startAng, angStep, altFn, ringRadius, minClear) {
  for (let k = 0; k < count; k++) {
    const a = startAng + k * angStep;
    const x = C.x + Math.cos(a) * radius, z = C.z + Math.sin(a) * radius;
    const y = Math.max(groundY(world, x, z) + minClear, altFn(k));
    const normal = new V3(-Math.sin(a), 0.12, Math.cos(a)); // tangent (counter-clockwise)
    course.addRing(new V3(x, y, z), ringRadius, normal);
  }
}

// ---------------------------------------------------------------------------------------------
function attachBombs(course, world, scene, count) {
  const geo = new THREE.SphereGeometry(0.8, 8, 6);
  const mat = new THREE.MeshLambertMaterial({ color: 0x25252b });
  const bombs = [];
  let left = count, cool = 0, prevAction = false;
  course.hudExtra = '  BOMBS ' + left;
  course.bombsLeft = () => left;
  course.extra = (dt, vehicle, ctx, events) => {
    cool -= dt;
    const act = !!(ctx.input && ctx.input.action);
    if (act && !prevAction && cool <= 0 && left > 0 && vehicle.state === 'flying') {
      left--; cool = 0.45;
      const m = new THREE.Mesh(geo, mat);
      const muz = vehicle.getMuzzles && vehicle.getMuzzles();
      const p = (muz && muz[0]) ? muz[0].clone() : vehicle.position.clone().add(new V3(0, -1.5, 0));
      m.position.copy(p);
      scene.add(m);
      bombs.push({ mesh: m, vel: vehicle.velocity.clone().multiplyScalar(0.95), age: 0 });
      course.hudExtra = '  BOMBS ' + left;
      if (ctx.audio) ctx.audio.playSfx && ctx.audio.playSfx('bomb', { position: p });
    }
    prevAction = act;
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i];
      b.age += dt;
      b.vel.y -= 14 * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      const gx = b.mesh.position.x, gz = b.mesh.position.z;
      const gh = groundY(world, gx, gz);
      if (b.mesh.position.y <= gh || b.age > 20) {
        const hp = new V3(gx, gh, gz);
        const water = safeHeight(world, gx, gz) <= 0.2;
        let hitAny = false;
        for (const t of course.targets) {
          if (t.alive && Math.hypot(t.position.x - gx, t.position.z - gz) <= t.radius) {
            t.alive = false; t.mesh.visible = false; course.targetHits++;
            hitAny = true;
            events.push({ type: 'target', position: t.position.clone() });
          }
        }
        if (water) { if (ctx.effects && ctx.effects.splash) ctx.effects.splash(hp); }
        else if (ctx.effects && ctx.effects.explosion) ctx.effects.explosion(hp);
        if (ctx.audio && ctx.audio.playSfx) ctx.audio.playSfx(water ? 'splash' : 'explosion', { position: hp });
        if (!hitAny && ctx.hud && ctx.hud.flash && left === 0 && bombs.length === 1) ctx.hud.flash('OUT OF BOMBS', 1200);
        scene.remove(b.mesh);
        bombs.splice(i, 1);
      }
    }
  };
  course.disposeExtra = () => { for (const b of bombs) scene.remove(b.mesh); bombs.length = 0; geo.dispose(); mat.dispose(); };
  const baseDispose = course.dispose.bind(course);
  course.dispose = () => { course.disposeExtra(); baseDispose(); };
}

function makeTower(world, base, height) {
  const g = new THREE.Group();
  const segs = 7;
  for (let i = 0; i < segs; i++) {
    const h = height / segs;
    const r0 = 5 - (i / segs) * 1.8, r1 = 5 - ((i + 1) / segs) * 1.8;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, 10),
      new THREE.MeshLambertMaterial({ color: i % 2 ? 0xffffff : 0xe23030, flatShading: true }));
    m.position.y = h * (i + 0.5);
    g.add(m);
  }
  const top = new THREE.Mesh(new THREE.CylinderGeometry(6, 4, 3, 10), new THREE.MeshLambertMaterial({ color: 0x333a55 }));
  top.position.y = height + 1.5; g.add(top);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff28a }));
  lamp.position.y = height + 5; g.add(lamp);
  g.position.set(base.x, groundY(world, base.x, base.z) - 1, base.z);
  return g;
}

// ---------------------------------------------------------------------------------------------
export const MISSIONS = [
  {
    id: 'hg1', name: 'Sunrise Glide', vehicle: 'hangGlider', tag: 'HANG GLIDER I', difficulty: 1,
    description: 'Run off the launch cliff, carve through the golden rings and touch down softly on the landing pad.',
    timeLimit: 180,
    build(world, scene) {
      const pad = getPad(world, 'hangGlider'), zone = getZone(world, 'hangGlider', pad);
      const c = new Course(world, scene, 'hangGlider');
      const A = pad.position, B = zone.position;
      pathRings(c, world, A, B, 8, {
        radius: 30, minClear: 28, minAmp: 60, ampFrac: 0.2, minDist: 700, bulgeDir: fwdOf(pad.heading),
        alt: (t) => (A.y + 15) + ((B.y + 55) - (A.y + 15)) * t,
      });
      c.setLanding(B, zone.radius);
      return c;
    },
  },
  {
    id: 'hg2', name: 'Thermal Peak', vehicle: 'hangGlider', tag: 'HANG GLIDER II', difficulty: 2,
    description: 'Glide to the rising thermal, circle upward through the spiralling rings, crest the summit ring above the highest peak, then glide home and land.',
    timeLimit: 480,
    build(world, scene) {
      const pad = getPad(world, 'hangGlider'), zone = getZone(world, 'hangGlider', pad);
      const c = new Course(world, scene, 'hangGlider');
      // Only thermals the glider can actually reach from the launch height (~8:1 glide, 40 m spare) qualify;
      // the nearest reachable one wins. (The old pick chose a thermal on the mountain ABOVE the launch.)
      const reach = (t) => pad.position.y - groundY(world, t.position.x, t.position.z)
        - Math.hypot(t.position.x - pad.position.x, t.position.z - pad.position.z) * 0.125;
      const th = (world.thermals || []).filter((t) => reach(t) > 40)
        .sort((a, b) => Math.hypot(a.position.x - pad.position.x, a.position.z - pad.position.z) - Math.hypot(b.position.x - pad.position.x, b.position.z - pad.position.z))[0];
      let C, tr = 58;
      if (th) { C = th.position.clone(); tr = clamp((th.radius || 100) * 0.45, 35, 70); }
      else C = pad.position.clone().add(fwdOf(pad.heading).multiplyScalar(250));
      const gy = groundY(world, C.x, C.z);
      const peak = findPeak(world, C, 0);
      const summitY = peak.y + 28; // low enough that ridge lift over the summit doesn't float you above it
      // climb high enough in the thermal to glide over to the summit ring
      const top = Math.max(summitY + Math.hypot(peak.x - C.x, peak.z - C.z) * 0.12 + 20, gy + 160);
      const first = Math.max(gy + 45, pad.position.y - 30);
      const step = 42;
      const n = clamp(Math.ceil((top - first) / step) + 1, 3, 12);
      // start the spiral on the side facing the launch so ring 1 is on the approach glide
      const a0 = Math.atan2(pad.position.z - C.z, pad.position.x - C.x);
      spiralRings(c, world, C, tr, n, a0, 2.4, (k) => first + k * ((top - first) / (n - 1)), 26, 30);
      const last = c.rings[c.rings.length - 1].position;
      const sp = new V3(peak.x, summitY, peak.z);
      c.addRing(sp, 36, sp.clone().sub(last).setY(0.0).add(new V3(0, 0.001, 0)));
      c.setLanding(zone.position, zone.radius);
      c.thermal = { position: C.clone(), radius: th ? th.radius : 100 };
      return c;
    },
  },
  {
    id: 'gc1', name: 'Rotor Rally', vehicle: 'gyrocopter', tag: 'GYROCOPTER I', difficulty: 1,
    description: 'Lift off, race through the ring circuit over the island and set the gyrocopter down on the pad.',
    timeLimit: 260,
    build(world, scene) {
      const pad = getPad(world, 'gyrocopter'), zone = getZone(world, 'gyrocopter', pad);
      const c = new Course(world, scene, 'gyrocopter');
      const R = 380;
      const ctr = pad.position.clone().add(fwdOf(pad.heading).multiplyScalar(450));
      const m = Math.hypot(ctr.x, ctr.z);
      if (m + R > 1850) ctr.multiplyScalar(Math.max(0, (1850 - R) / m));
      const th0 = Math.atan2(pad.position.z - ctr.z, pad.position.x - ctr.x);
      const n = 8;
      for (let k = 1; k <= n; k++) {
        const a = th0 + k * (Math.PI * 2 / (n + 1));
        const x = ctr.x + Math.cos(a) * R, z = ctr.z + Math.sin(a) * R;
        const y = groundY(world, x, z) + 45 + 18 * Math.sin(k * 1.3);
        c.addRing(new V3(x, y, z), 26, new V3(-Math.sin(a), 0, Math.cos(a)));
      }
      c.setLanding(zone.position, zone.radius);
      return c;
    },
  },
  {
    id: 'gc2', name: 'Bombs Away', vehicle: 'gyrocopter', tag: 'GYROCOPTER II', difficulty: 2,
    description: 'Seven targets are scattered across the island. Fly over them and press SPACE to drop bombs, then land.',
    timeLimit: 300,
    build(world, scene) {
      const pad = getPad(world, 'gyrocopter'), zone = getZone(world, 'gyrocopter', pad);
      const c = new Course(world, scene, 'gyrocopter');
      const placed = [];
      const N = 7;
      for (let k = 0; k < N; k++) {
        const a = pad.heading + (k / N) * Math.PI * 2 + 0.4;
        let p = null;
        for (let attempt = 0; attempt < 6 && !p; attempt++) {
          const rr = 320 + (k % 3) * 180 + attempt * 110;
          const cand = findLand(world, pad.position.x + Math.sin(a) * rr, pad.position.z - Math.cos(a) * rr);
          if (placed.every((q) => Math.hypot(q.x - cand.x, q.z - cand.z) > 90) &&
            Math.hypot(cand.x - zone.position.x, cand.z - zone.position.z) > 60) p = cand;
        }
        if (p) { placed.push(p); c.addTarget(p); }
      }
      attachBombs(c, world, scene, N * 2 + 2);
      c.setLanding(zone.position, zone.radius);
      return c;
    },
  },
  {
    id: 'rb1', name: 'Hop Skip Jump', vehicle: 'rocketBelt', tag: 'ROCKET BELT I', difficulty: 2, fuelBurn: 0.55,
    description: 'Hop through low hovering rings with a limited tank of fuel, then land gently on the platform.',
    timeLimit: 150,
    build(world, scene) {
      const pad = getPad(world, 'rocketBelt'), zone = getZone(world, 'rocketBelt', pad);
      const c = new Course(world, scene, 'rocketBelt');
      const A = pad.position, B = zone.position;
      pathRings(c, world, A, B, 6, {
        radius: 10, minClear: 7, minAmp: 30, ampFrac: 0.2, minDist: 170, bulgeDir: fwdOf(pad.heading),
        alt: (t, g) => g + 10 + 6 * Math.sin(t * Math.PI * 3),
      });
      c.setLanding(B, zone.radius);
      return c;
    },
  },
  {
    id: 'rb2', name: 'Tower Ascent', vehicle: 'rocketBelt', tag: 'ROCKET BELT II', difficulty: 3, fuelBurn: 0.3,
    description: 'Spiral up the striped tower ring by ring, kiss the summit and jet back down to the landing platform.',
    timeLimit: 200,
    build(world, scene) {
      const pad = getPad(world, 'rocketBelt'), zone = getZone(world, 'rocketBelt', pad);
      const c = new Course(world, scene, 'rocketBelt');
      const dir = new V3(zone.position.x - pad.position.x, 0, zone.position.z - pad.position.z);
      if (dir.lengthSq() < 4) dir.copy(fwdOf(pad.heading));
      dir.normalize();
      const perp = new V3(-dir.z, 0, dir.x);
      // tower a short hop from the launch pad (fuel is the limiting resource), offset from the direct line
      const D = Math.hypot(zone.position.x - pad.position.x, zone.position.z - pad.position.z);
      const along = pad.position.clone().addScaledVector(dir, clamp(D * 0.3, 40, 70));
      let base = along.clone().addScaledVector(perp, 28);
      if (safeHeight(world, base.x, base.z) < 1) base = along.clone().addScaledVector(perp, -28);
      if (safeHeight(world, base.x, base.z) < 1) base = along;
      const H = 48;
      const tower = makeTower(world, base, H);
      c.group.add(tower);
      const gy = groundY(world, base.x, base.z);
      spiralRings(c, world, base, 22, 7, 0.0, 1.5, (k) => gy + 9 + k * 6.5, 9, 6);
      c.addRing(new V3(base.x, gy + H + 12, base.z), 9, new V3(0.001, 1, 0.001));
      c.setLanding(zone.position, zone.radius);
      return c;
    },
  },
  {
    id: 'sandbox', name: 'Holiday Island', vehicle: 'hangGlider', tag: 'FREE FLIGHT', difficulty: 0,
    description: 'No timer, no rules. Pick any aircraft and explore the whole island at your own pace.',
    timeLimit: 0, sandbox: true, vehicleChoice: true,
    build(world, scene) {
      const c = new Course(world, scene, 'hangGlider');
      c.free = true;
      return c;
    },
  },
];

export function getMission(id) { return MISSIONS.find((m) => m.id === id) || MISSIONS[0]; }
export { Course, getPad, getZone, groundY };
