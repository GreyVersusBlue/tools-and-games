// Rocket belt: fuel-limited thrust along the tilted body axis. Throttle sets thrust, action gives a thrust pulse,
// boost burns fuel fast, tilt (pitch/roll) to travel, yaw to spin, gentle landings only.
import * as THREE from 'three';
import {
  VehicleBase, G, clamp, damp, num,
  mesh, sph, cylm, boxm, capsule, torusm, tube, loft, smoothSecs, finalize, createPilot, Flame,
  paint, alu, steel, chrome, rubber, pbr, cloth, leather,
} from './common.js';
import { swapIn } from '../core/models.js';

const V3 = THREE.Vector3;
const _up = new V3();
const _fwd = new V3();
const _p = new V3();
const _d = new V3();
const LIMITS = { v: 4.0, h: 5.5, tilt: 25, slope: 30 };

export class RocketBelt extends VehicleBase {
  constructor(world) {
    super(world);
    this.gearOffset = 1.0;
    this.thrustNow = 0;
    this.boosting = false;
    this.kick = 0;
    this._prevThrust = 0;
    this.fuelBurnScale = 1; // set by missions after reset(); not touched by reset()
    this._build();
    this.applyTransform();
  }

  _build() {
    const RED = 0xe8322a;
    const darkM = pbr(0x2a2d34, { roughness: 0.5, metalness: 0.5 });
    const chromeM = chrome();
    const aluM = alu();
    const redM = paint(RED);
    const goldM = pbr(0xd8a838, { roughness: 0.25, metalness: 1 });
    this.pilot = createPilot({ suit: 0xff7a1a, helmet: 0xffd60a, stripe: 0x2b6fff, style: 'full' });
    this.pilot.group.position.set(0, -1.0, 0);
    this.mesh.add(this.pilot.group);
    // backpack frame: back plate, twin chrome tanks, nozzles, plumbing
    const pack = new THREE.Group();
    pack.position.set(0, 0, 0.3);
    pack.add(boxm(0.56, 0.72, 0.09, darkM, 0, 0.28, -0.02));
    pack.add(boxm(0.5, 0.06, 0.16, redM, 0, 0.68, 0.03));
    this.nozzles = [];
    for (const s of [-1, 1]) {
      const x = s * 0.2;
      const tank = mesh(loft(smoothSecs([[-0.5, 0.01, 0.01], [-0.44, 0.1, 0.1], [-0.25, 0.145, 0.145], [0.3, 0.15, 0.15], [0.44, 0.1, 0.1], [0.52, 0.01, 0.01]], 12), { axis: 'y', radial: 24 }), chromeM, x, 0.2, 0.1);
      pack.add(tank);
      for (const y of [0.0, 0.48]) { const rg = torusm(0.152, 0.014, redM, x, y, 0.1); rg.rotation.x = Math.PI / 2; pack.add(rg); }
      pack.add(cylm(0.03, 0.03, 0.12, goldM, x, 0.77, 0.1, 10)); // valve
      pack.add(tube(new V3(x, 0.0, 0.1), new V3(x, -0.3, 0.1), 0.05, steel()));
      const noz = mesh(loft(smoothSecs([[0, 0.055, 0.055], [0.1, 0.09, 0.09], [0.25, 0.15, 0.15]], 8), { axis: 'y', radial: 20 }), alu(0x9aa0aa), x, -0.56, 0.1);
      noz.rotation.x = Math.PI;
      noz.position.y = -0.3;
      pack.add(noz);
      const nr = torusm(0.15, 0.014, goldM, x, -0.55, 0.1); nr.rotation.x = Math.PI / 2; pack.add(nr);
      this.nozzles.push(new V3(x, -0.55, 0.3 + 0.1));
    }
    pack.add(tube(new V3(-0.2, 0.75, 0.1), new V3(0.2, 0.75, 0.1), 0.02, steel()));
    pack.add(sph(0.06, paint(0xffd60a, { roughness: 0.2 }), 0, 0.8, 0.08));
    this.mesh.add(pack);
    // flames + nozzle glow
    this.flames = [];
    for (let i = 0; i < 2; i++) {
      const f = new Flame(0.14);
      f.group.position.copy(this.nozzles[i]);
      this.mesh.add(f.group);
      this.flames.push(f);
    }
    this.glowLight = null;
    if ((window.SW_QUALITY || 'medium') !== 'low') {
      this.glowLight = new THREE.PointLight(0xff8a30, 0, 9, 2);
      this.glowLight.position.set(0, -0.8, 0.4);
      this.mesh.add(this.glowLight);
    }
    finalize(this.mesh);
    this._exT = 0;
    this._dustT = 0;

    // Hero GLB: pilot + jet backpack swapped for a hand-modelled figure with twin nozzles.
    // Procedural pilot/pack stay in the scene (hidden) as the ?models=0 / load-failure fallback;
    // the flame groups and glow light are FX, not part of the swap, so they're kept visible and
    // re-anchored onto the GLB's own "nozzle_L"/"nozzle_R" markers once it loads. "leg_L"/"leg_R"
    // are separate nodes pivoted at the hip so _animate can mirror the procedural leg kick onto them.
    this._glbLegL = null;
    this._glbLegR = null;
    const keep = this.flames.map((f) => f.group);
    if (this.glowLight) keep.push(this.glowLight);
    swapIn(this.mesh, 'rocket_pilot', {
      keep,
      onLoad: (model) => {
        this._glbLegL = model.getObjectByName('leg_L');
        this._glbLegR = model.getObjectByName('leg_R');
        const nL = model.getObjectByName('nozzle_L');
        const nR = model.getObjectByName('nozzle_R');
        if (nL && nR) {
          this.nozzles[0].copy(nL.position);
          this.nozzles[1].copy(nR.position);
          this.flames[0].group.position.copy(nL.position);
          this.flames[1].group.position.copy(nR.position);
        }
      },
    });
  }

  _groundStart() {
    this.thrustNow = 0;
    this.boosting = false;
    this.fuel = 1;
  }
  _airStart() {
    this.thrustNow = 0.5;
  }

  update(dt, input, world) {
    if (world) this.world = world;
    dt = clamp(num(dt, 0.016), 0, 0.1);
    if (dt <= 0) return;
    input = input || {};
    this.time += dt;
    try {
      const st = this.state;
      if (st === 'crashed' || st === 'splashed') this._passive(dt);
      else this._fly(dt, input);
    } catch (e) {
      // never throw during frame update
    }
    this._animate(dt);
    this.applyTransform();
    this._fxUpdate(dt);
    this.tickFx(dt);
  }

  _passive(dt) {
    this.velocity.set(0, 0, 0);
    this.thrustNow = damp(this.thrustNow, 0, 8, dt);
    if (this.state === 'splashed') {
      this.position.y = damp(this.position.y, 0.2 + Math.sin(this.time * 2.2) * 0.07, 3, dt);
      this.pitch = damp(this.pitch, -0.2, 2, dt);
      this.roll = damp(this.roll, 0.15, 2, dt);
    } else if (this.state === 'crashed') {
      this.pitch = damp(this.pitch, -1.3, 6, dt);
      this.position.y = damp(this.position.y, Math.max(0, this.groundHeight(this.position.x, this.position.z)) + 0.35, 6, dt);
    }
    this.updateDerived(Math.max(0, this.groundHeight(this.position.x, this.position.z)));
    if (this.state === 'splashed') this.altitude = this.agl = 0;
  }

  _fly(dt, input) {
    const pos = this.position;
    const vel = this.velocity;
    const p = clamp(num(input.pitch), -1, 1);
    const r = clamp(num(input.roll), -1, 1);
    const yw = clamp(num(input.yaw), -1, 1);
    const resting = this.state === 'grounded' || this.state === 'landed';

    // thrust command
    let raw = clamp(num(input.throttle), 0, 1);
    if (input.action) raw = Math.max(raw, 0.85);
    const boost = !!input.boost && this.fuel > 0;
    if (boost) raw = Math.min(1.35, raw + 0.35);
    if (boost && !this.boosting) this.emit('boost');
    this.boosting = boost;
    if (this.fuel <= 0) raw = 0;
    this.throttle = clamp(raw, 0, 1);
    this.thrustNow += (raw - this.thrustNow) * Math.min(1, dt * (raw > this.thrustNow ? 8 : 5));
    if (this.thrustNow < 0.001) this.thrustNow = 0;

    // fuel
    if (this.thrustNow > 0.02) {
      const burn = (0.02 + this.thrustNow * 0.038) * (boost ? 1.6 : 1) * this.fuelBurnScale;
      this.fuel = Math.max(0, this.fuel - burn * dt);
    }

    // attitude
    this.pitch = damp(this.pitch, resting ? 0 : -p * 0.5, 4, dt);
    this.roll = damp(this.roll, resting ? 0 : r * 0.5, 4, dt);
    this.heading -= yw * 2.0 * dt;

    // forces
    this.upVec(_up);
    let T = G * (0.05 + 1.9 * this.thrustNow);
    T /= Math.max(0.8, _up.y);
    let ax = _up.x * T;
    let ay = _up.y * T - G;
    let az = _up.z * T;
    const hd = (input.brake ? 1.1 : 0.32) * (resting ? 8 : 1);
    ax -= vel.x * hd;
    az -= vel.z * hd;
    ay -= vel.y * 0.6;
    vel.x += ax * dt;
    vel.y += ay * dt;
    vel.z += az * dt;
    pos.addScaledVector(vel, dt);

    // terrain
    const gy = Math.max(0, this.groundHeight(pos.x, pos.z));
    const floor = gy + this.gearOffset;
    if (resting) {
      if (pos.y <= floor + 0.02) {
        pos.y = floor;
        if (vel.y < 0) vel.y = 0;
      }
      if (vel.y > 0.25 && pos.y > floor + 0.004) {
        this.state = 'flying';
        this.emit('liftoff');
      }
    } else if (pos.y <= floor) {
      const tilt = Math.hypot(this.roll, this.pitch) * 57.29578;
      this.evaluateLanding(LIMITS, tilt);
      pos.y = floor;
      if (this.state === 'landed') vel.y = 0;
      else if (this.state === 'splashed') {
        pos.y = 0.2;
        vel.set(0, 0, 0);
      } else vel.set(0, 0, 0);
    }
    this.updateDerived(gy);
  }

  _animate(dt) {
    const t = this.thrustNow;
    const on = this.state !== 'crashed' && this.state !== 'splashed' ? t : 0;
    for (const f of this.flames) f.update(dt, on, this.boosting);
    if (this.glowLight) this.glowLight.intensity = on * 6 * (0.85 + Math.random() * 0.3);
    // pilot legs: trail when moving, kick on thrust surges
    const surge = Math.max(0, t - this._prevThrust);
    this._prevThrust = t;
    this.kick = Math.min(1.2, this.kick + surge * 6);
    this.kick = damp(this.kick, 0, 3, dt);
    this.forwardVec(_fwd);
    const fwdSpeed = this.velocity.x * _fwd.x + this.velocity.z * _fwd.z;
    const air = this.state === 'flying';
    const trail = air ? -clamp(fwdSpeed / 12, -1, 1) * 0.45 : 0;
    const flutter = air ? Math.sin(this.time * 6) * 0.08 * (0.3 + t) : 0;
    const k = this.kick * 0.6;
    const l = this.pilot.legL;
    const rg = this.pilot.legR;
    l.rotation.x = damp(l.rotation.x, trail + flutter + k, 10, dt);
    rg.rotation.x = damp(rg.rotation.x, trail - flutter + k * 0.6, 10, dt);
    l.rotation.z = damp(l.rotation.z, air ? -0.08 - t * 0.1 : 0, 6, dt);
    rg.rotation.z = damp(rg.rotation.z, air ? 0.08 + t * 0.1 : 0, 6, dt);
    if (this._glbLegL) { this._glbLegL.rotation.x = l.rotation.x; this._glbLegL.rotation.z = l.rotation.z; }
    if (this._glbLegR) { this._glbLegR.rotation.x = rg.rotation.x; this._glbLegR.rotation.z = rg.rotation.z; }
    this.pilot.armL.rotation.z = -0.9 - (air ? Math.sin(this.time * 3) * 0.1 : 0);
    this.pilot.armR.rotation.z = 0.9 + (air ? Math.sin(this.time * 3 + 1) * 0.1 : 0);
    this.pilot.head.rotation.x = air ? this.pitch * 0.3 : 0;
    // shake when burning hard
    const sh = t * 0.012;
    this.pilot.group.position.x = Math.sin(this.time * 61) * sh;
  }

  _fxUpdate(dt) {
    const fx = this.fx;
    const t = this.thrustNow;
    this.mesh.updateMatrix();
    const m = this.mesh.matrix;
    const gy = Math.max(0, this.groundHeight(this.position.x, this.position.z));
    const alive = this.state !== 'crashed' && this.state !== 'splashed';
    fx.exhaust.length = 0;
    this.upVec(_d).negate();
    if (t > 0.02 && alive) {
      for (const n of this.nozzles) fx.exhaust.push({ position: n.clone().applyMatrix4(m), direction: _d.clone(), power: t });
    }
    fx.contact.length = 0;
    const resting = this.state === 'grounded' || this.state === 'landed';
    if (resting) fx.contact.push(new V3(this.position.x, gy, this.position.z));
    fx.dustColor = this.dustColorFor(this.position.x, this.position.z, gy);
    const wash = alive && t > 0.05 ? t * clamp(1 - this.agl / 7, 0, 1) : 0;
    fx.dust = wash;
    // steam/smoke from nozzles
    this._exT -= dt;
    if (this._exT <= 0 && t > 0.05 && alive) {
      this._exT = 0.03;
      for (const n of this.nozzles) {
        _p.copy(n).applyMatrix4(m);
        _p.y -= 0.4;
        this.puffs.emit(_p.x, _p.y, _p.z, this.velocity.x * 0.4 + (Math.random() - 0.5) * 0.8, -1.5 * t - 0.5, this.velocity.z * 0.4 + (Math.random() - 0.5) * 0.8, {
          life: 0.8, s0: 0.18, s1: 0.9, alpha: 0.2 * t + 0.05, buoy: 0.7, color: 0xe8eef8, drag: 1.4,
        });
      }
    }
    this._dustT -= dt;
    if (wash > 0.05 && this._dustT <= 0) {
      this._dustT = 0.04 / (0.4 + wash);
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + wash * 5;
      this.puffs.emit(this.position.x + Math.cos(a) * 0.4, gy + 0.1, this.position.z + Math.sin(a) * 0.4, Math.cos(a) * sp, 0.4 + Math.random() * 0.7, Math.sin(a) * sp, {
        life: 0.9 + Math.random() * 0.6, s0: 0.5, s1: 2.4 + wash * 2, alpha: 0.3 * wash + 0.04, buoy: 0.5, color: fx.dustColor, drag: 2.2,
      });
    }
  }

  getCameraRig() {
    const r = this._rig;
    r.target.copy(this.position);
    r.target.y += 0.4;
    r.chaseDistance = 9;
    r.height = 2.6;
    r.fov = 65 + clamp(this.speed * 0.2, 0, 8);
    return r;
  }
}
