// Hang glider: point-mass flight model with lift/drag curves, bank turns, stall, thermals and a run-off launch.
// Visuals: parametric ripstop sail (billows/flexes per frame), aluminium frame with cables, detailed prone pilot.
import * as THREE from 'three';
import {
  VehicleBase, G, clamp, damp, angleDiff, num, seg,
  mesh, sph, cylm, boxm, capsule, torusm, tube, setTube, loft, smoothSecs, finalize, createPilot,
  sailMaterial, alu, steel, chrome, rubber, cloth, paint, pbr, WorldRibbon,
} from './common.js';
import { swapIn } from '../core/models.js';

const V3 = THREE.Vector3;
const _air = new V3();
const _vhat = new V3();
const _right = new V3();
const _lift = new V3();
const _fwd = new V3();
const _p = new V3();
const _p2 = new V3();
const _p3 = new V3();
const _X = new V3(1, 0, 0);

const LIMITS = { v: 6.0, h: 24, tilt: 32, slope: 30 };
const CONTACT = 1.6; // CG height above ground that counts as touching (prone pilot)

const SPAN = 4.7; // semi-span
const NS = 20; // sail span divisions
const NC = 12; // sail chord divisions

// Sail surface point for a wing half. sgn=+1 right. s: 0 root..1 tip, c: 0 LE..1 TE.
function sailPoint(sgn, s, c, st, out) {
  const zle = -2.75 + s * 4.55;
  const zte = 1.15 + s * 0.7 - 0.3 * Math.sin(Math.PI * s) * (1 - s * 0.3);
  const chord = zte - zle;
  let y = 0.02 + s * 0.4;
  y += st.flex * s * s * 1.7; // tips bend up under load
  y += 0.17 * Math.sin(Math.PI * Math.pow(c, 0.75)) * (chord / 3.9) * (1 - 0.25 * s); // camber
  y -= 0.1 * c * (1 - s); // trailing droop at the root
  y += 0.25 * s * s * c; // washout
  y += st.billow * Math.sin(Math.PI * c) * Math.sin(Math.PI * Math.min(1, s * 1.05)) * 0.35;
  y += st.ripple * Math.sin(s * 11 + c * 4 - st.t * 14) * c * (0.6 + 0.4 * s) * 0.05;
  const x = sgn * s * SPAN * (1 - 0.03 * st.flex * s);
  return out.set(x, y, zle + chord * c);
}

class Wing {
  constructor(sgn, mat) {
    this.sgn = sgn;
    this.st = { flex: 0.1, billow: 0, ripple: 0, t: 0 };
    this.group = new THREE.Group();
    // sail membrane
    const nv = (NS + 1) * (NC + 1);
    this.pos = new Float32Array(nv * 3);
    const uv = new Float32Array(nv * 2);
    const idx = [];
    for (let i = 0; i <= NS; i++)
      for (let j = 0; j <= NC; j++) {
        uv[(i * (NC + 1) + j) * 2] = i / NS;
        uv[(i * (NC + 1) + j) * 2 + 1] = 1 - j / NC;
      }
    for (let i = 0; i < NS; i++)
      for (let j = 0; j < NC; j++) {
        const a = i * (NC + 1) + j, b = a + 1, c = a + NC + 1, d = c + 1;
        if (sgn > 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setIndex(idx);
    this.sail = new THREE.Mesh(this.geo, mat);
    this.sail.frustumCulled = false;
    this.sail.castShadow = true;
    this.sail.receiveShadow = true;
    this.group.add(this.sail);
    // battens (raised strips)
    this.ribS = [0.09, 0.2, 0.31, 0.43, 0.55, 0.67, 0.79, 0.9];
    const rn = this.ribS.length;
    const rc = 10;
    this.ribC = rc;
    this.ribPos = new Float32Array(rn * (rc + 1) * 2 * 3);
    const ri = [];
    for (let r = 0; r < rn; r++)
      for (let j = 0; j < rc; j++) {
        const a = (r * (rc + 1) + j) * 2;
        ri.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    this.ribGeo = new THREE.BufferGeometry();
    this.ribGeo.setAttribute('position', new THREE.BufferAttribute(this.ribPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.ribGeo.setIndex(ri);
    const rnorm = new Float32Array(this.ribPos.length);
    for (let i = 1; i < rnorm.length; i += 3) rnorm[i] = 1;
    this.ribGeo.setAttribute('normal', new THREE.BufferAttribute(rnorm, 3));
    this.ribs = new THREE.Mesh(this.ribGeo, pbr(0x4a4d55, { roughness: 0.6, dbl: true }));
    this.ribs.frustumCulled = false;
    this.ribs.castShadow = false;
    this.group.add(this.ribs);
    // leading edge tube chain
    this.leN = 9;
    this.le = [];
    this.lePts = [];
    for (let i = 0; i <= this.leN; i++) this.lePts.push(new V3());
    const aluM = alu();
    for (let i = 0; i < this.leN; i++) {
      const t = tube(new V3(), new V3(0, 1, 0), 0.04, aluM, seg(12, 8, 6));
      this.le.push(t);
      this.group.add(t);
    }
    this.tipCap = sph(0.035, paint(0xffd60a), 0, 0, 0);
    this.group.add(this.tipCap);
    // cable / spar endpoints created by owner
    this.tipPoint = new V3();
    this.update(0, 0, 0, 0);
  }
  update(flex, billow, ripple, t) {
    const st = this.st;
    st.flex = flex; st.billow = billow; st.ripple = ripple; st.t = t;
    const sgn = this.sgn;
    let k = 0;
    for (let i = 0; i <= NS; i++)
      for (let j = 0; j <= NC; j++) {
        sailPoint(sgn, i / NS, j / NC, st, _p);
        this.pos[k++] = _p.x; this.pos[k++] = _p.y; this.pos[k++] = _p.z;
      }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
    // ribs
    const rc = this.ribC;
    k = 0;
    for (let r = 0; r < this.ribS.length; r++)
      for (let j = 0; j <= rc; j++) {
        const c = 0.04 + (j / rc) * 0.9;
        for (const dx of [-0.0045, 0.0045]) {
          sailPoint(sgn, this.ribS[r] + dx, c, st, _p);
          this.ribPos[k++] = _p.x; this.ribPos[k++] = _p.y + 0.012; this.ribPos[k++] = _p.z;
        }
      }
    this.ribGeo.attributes.position.needsUpdate = true;
    // LE tubes (slightly under the sail edge)
    for (let i = 0; i <= this.leN; i++) {
      sailPoint(sgn, i / this.leN, 0, st, this.lePts[i]);
      this.lePts[i].y -= 0.012;
    }
    for (let i = 0; i < this.leN; i++) setTube(this.le[i], this.lePts[i], this.lePts[i + 1], 0.048 - 0.024 * (i / this.leN));
    this.tipCap.position.copy(this.lePts[this.leN]);
    // wingtip vapour anchor (a bit behind the tip along the trailing side)
    sailPoint(sgn, 0.995, 0.3, st, this.tipPoint);
  }
  leAt(s, out) {
    return sailPoint(this.sgn, s, 0, this.st, out).setY(out.y - 0.012);
  }
}

export class HangGlider extends VehicleBase {
  constructor(world) {
    super(world);
    this.gearOffset = 1.9;
    this.running = false;
    this.runSpeed = 0;
    this.stalled = false;
    this.grace = 0;
    this.liftSmooth = 0;
    this.inThermal = false;
    this.airspeed = 0;
    this.flex = 0;
    this.crumple = 0;
    this.prone = 0;
    this.legPhase = 0;
    this._pS = 0;
    this._launchFlag = false;
    this.verticalSpeed = 0;
    this.gLoad = 1;
    this.billow = 0;
    this._dustT = 0;
    this._build();
    this.applyTransform();
  }

  _build() {
    const sailM = sailMaterial(0);
    const aluM = alu();
    const steelM = steel();
    this.rightWing = new Wing(1, sailM);
    this.leftWing = new Wing(-1, sailM);
    this.mesh.add(this.rightWing.group, this.leftWing.group);
    this.wings = [this.rightWing, this.leftWing];

    // --- keel + nose
    const K0 = new V3(0, 0.0, -2.72);
    const K1 = new V3(0, -0.07, 1.2);
    this.mesh.add(tube(K0, K1, 0.05, aluM));
    const noseSecs = smoothSecs([[-3.15, 0.005, 0.005], [-3.0, 0.07, 0.06], [-2.85, 0.13, 0.11], [-2.6, 0.12, 0.1], [-2.4, 0.06, 0.05]], 10);
    const nose = mesh(loft(noseSecs, { axis: 'z', radial: seg(20, 12, 8) }), paint(0xffd60a));
    nose.position.y = 0.02;
    this.mesh.add(nose);
    // tail cap
    this.mesh.add(sph(0.05, paint(0xe8322a), 0, -0.07, 1.22));
    // keel sail pocket / spine cover
    const spine = mesh(loft(smoothSecs([[-2.4, 0.01, 0.01], [-1.9, 0.11, 0.05], [-0.6, 0.16, 0.07], [0.5, 0.13, 0.06], [1.15, 0.01, 0.01]], 16), { axis: 'z', radial: 14 }), cloth(0xe2231a));
    spine.position.y = 0.06;
    spine.scale.y = 0.8;
    this.mesh.add(spine);

    // --- kingpost + top wires
    const KP0 = new V3(0, 0.0, -0.45);
    const KP1 = new V3(0, 1.2, -0.45);
    this.mesh.add(tube(KP0, KP1, 0.038, aluM));
    this.mesh.add(sph(0.06, steelM, 0, 1.22, -0.45));
    const wire = (r = 0.008) => tube(new V3(), new V3(0, 1, 0), r, steelM, 6);
    this.wires = [];
    const addWire = (fn, r) => {
      const w = wire(r);
      w.userData.fn = fn;
      this.mesh.add(w);
      this.wires.push(w);
      return w;
    };
    const tmpA = new V3();
    for (const W of this.wings) {
      // top wires: kingpost -> LE (70%) and LE (95%)
      addWire((a, b) => { a.set(0, 1.22, -0.45); W.leAt(0.72, b); });
      addWire((a, b) => { a.set(0, 1.22, -0.45); W.leAt(0.34, b); });
      // rear top wire: kingpost -> tail via TE
      addWire((a, b) => { a.set(0, 1.22, -0.45); b.set(W.sgn * 1.2, -0.02, 1.0); });
    }
    addWire((a, b) => { a.set(0, 1.22, -0.45); b.set(0, -0.07, 1.2); });
    // crossbar: LE (0.42) -> keel rear
    this.cross = [];
    for (const W of this.wings) {
      const t = tube(new V3(), new V3(0, 1, 0), 0.03, aluM);
      t.userData.W = W;
      this.mesh.add(t);
      this.cross.push(t);
    }
    // --- control frame (downtubes from LE, base bar with foam grips)
    this.baseL = new V3(-0.88, -1.3, -1.02);
    this.baseR = new V3(0.88, -1.3, -1.02);
    this.downtubes = [];
    for (const W of this.wings) {
      const t = tube(new V3(), new V3(0, 1, 0), 0.032, aluM);
      t.userData.W = W;
      this.mesh.add(t);
      this.downtubes.push(t);
    }
    this.mesh.add(tube(this.baseL, this.baseR, 0.03, aluM));
    for (const s of [-1, 1]) {
      this.mesh.add(sph(0.045, steelM, s * 0.88, -1.3, -1.02));
      const grip = tube(new V3(s * 0.45, -1.3, -1.02), new V3(s * 0.15, -1.3, -1.02), 0.042, rubber(0x1c1c20), 10);
      this.mesh.add(grip);
    }
    // bottom flying wires: base corners -> LE (55%) & nose
    for (const W of this.wings) {
      const bc = W.sgn > 0 ? this.baseR : this.baseL;
      addWire((a, b) => { a.copy(bc); W.leAt(0.55, b); });
      addWire((a, b) => { a.copy(bc); b.set(0, -0.02, -2.6); });
    }

    // --- pilot in cocoon harness
    this.pilotPivot = new THREE.Group();
    this.pilotPivot.position.set(0, -0.98, 0.1);
    this.pilot = createPilot({ suit: 0x1c3fa8, helmet: 0xffffff, stripe: 0xff3b30, trim: 0xffd60a, style: 'goggles' });
    this.pilot.group.position.set(0, -0.92, 0);
    this.pilotPivot.add(this.pilot.group);
    // legs bag (cocoon tail)
    const bagSecs = smoothSecs([[-0.32, 0.01, 0.01], [-0.2, 0.09, 0.07], [0.05, 0.19, 0.14], [0.45, 0.24, 0.17], [0.85, 0.27, 0.2], [1.05, 0.22, 0.17], [1.15, 0.01, 0.01]], 20);
    this.bag = mesh(loft(bagSecs, { axis: 'y', radial: seg(24, 14, 10) }), paint(0xffb300, { roughness: 0.5 }));
    this.bag.position.set(0, 0, 0.01);
    this.pilot.group.add(this.bag);
    const zip = tube(new V3(0, 0.98, -0.2), new V3(0, -0.2, -0.062), 0.008, chrome(), 6);
    this.bag.add(zip);
    // carabiner + hang straps
    this.hang = new V3(0, -0.07, -0.05);
    this.carab = torusm(0.05, 0.008, chrome(), 0, -0.2, -0.05);
    this.carab.scale.set(0.7, 1, 1);
    this.mesh.add(this.carab);
    this.mesh.add(tube(this.hang, new V3(0, -0.17, -0.05), 0.012, cloth(0x1a1a1c), 6));
    this.strapA = tube(new V3(), new V3(0, 1, 0), 0.014, cloth(0x1a1a1c), 6);
    this.strapB = tube(new V3(), new V3(0, 1, 0), 0.014, cloth(0x1a1a1c), 6);
    this.mesh.add(this.strapA, this.strapB);
    this.mesh.add(this.pilotPivot);

    // --- fx: wingtip vapour ribbons (world space)
    this.vapour = [new WorldRibbon(40, { width: 0.09, grow: 3.2, opacity: 0.55, life: 1.8 }), new WorldRibbon(40, { width: 0.09, grow: 3.2, opacity: 0.55, life: 1.8 })];
    this.vapour.forEach((v) => this.mesh.add(v.mesh));
    finalize(this.mesh);
    this.rightWing.ribs.castShadow = false;
    this.leftWing.ribs.castShadow = false;
    this._updateFrame();

    // Hero GLB: sail/frame/pilot swapped for a hand-modelled hang glider (delta wing, A-frame,
    // prone pilot). The procedural sail/frame stay in the scene (hidden) as the fallback for
    // ?models=0 or a failed load, and their live geometry (rightWing/leftWing.tipPoint) keeps
    // driving the wingtip vapour trail FX regardless of which visual is shown.
    swapIn(this.mesh, 'hang_glider', { keep: [this.vapour[0].mesh, this.vapour[1].mesh] });
  }

  // recompute wires / struts that follow the flexing wings
  _updateFrame() {
    const a = _p, b = _p2;
    for (const w of this.wires) {
      w.userData.fn(a, b);
      setTube(w, a, b);
    }
    for (const t of this.cross) {
      const W = t.userData.W;
      W.leAt(0.42, a);
      b.set(0, -0.07, 0.55);
      setTube(t, a, b);
    }
    for (const t of this.downtubes) {
      const W = t.userData.W;
      W.leAt(0.27, a);
      setTube(t, a, W.sgn > 0 ? this.baseR : this.baseL);
    }
    // hang straps to pilot shoulders / hips
    const pv = this.pilotPivot;
    const pr = pv.rotation.x;
    _p3.set(0, 0.53, -0.02).applyAxisAngle(_X, pr).add(pv.position);
    a.set(0, -0.2, -0.05);
    setTube(this.strapA, a, _p3);
    _p3.set(0, 0.0, 0.05).applyAxisAngle(_X, pr).add(pv.position);
    setTube(this.strapB, a, _p3);
  }

  _groundStart() {
    this.running = false;
    this.runSpeed = 0;
    this.stalled = false;
    this.grace = 0;
    this.liftSmooth = 0;
    this.inThermal = false;
    this.crumple = 0;
    this.prone = 0;
    this._launchFlag = false;
  }

  _airStart() {
    this._groundStart();
    this.forwardVec(_fwd);
    this.velocity.copy(_fwd).multiplyScalar(15).setY(-1.2);
    this.pitch = -0.05;
    this.prone = 1;
    this.grace = 0.6;
  }

  launch() {
    this._launchFlag = true;
  }

  update(dt, input, world) {
    if (world) this.world = world;
    dt = clamp(num(dt, 0.016), 0, 0.1);
    if (dt <= 0) return;
    input = input || {};
    this.time += dt;
    this._pS = damp(this._pS, clamp(num(input.pitch), -1, 1), 6, dt);
    try {
      switch (this.state) {
        case 'grounded':
          this._updateGround(dt, input);
          break;
        case 'flying':
          this._updateFlying(dt, input);
          break;
        case 'landed':
          this._updateLanded(dt);
          break;
        case 'splashed':
          this._updateSplashed(dt);
          break;
        default:
          this.velocity.set(0, 0, 0);
      }
    } catch (e) {
      // never throw in frame update
    }
    this.throttle = 0;
    this._animate(dt);
    this.applyTransform();
    this._fxUpdate(dt);
    this.tickFx(dt);
  }

  _updateGround(dt, input) {
    if (!this.running && (input.action || num(input.pitch) > 0.6 || this._launchFlag)) this.running = true;
    const gyPrev = Math.max(0, this.groundHeight(this.position.x, this.position.z));
    if (this.running) {
      this.runSpeed = Math.min(14, this.runSpeed + 6 * dt);
      this.heading -= clamp(num(input.yaw) + num(input.roll), -1, 1) * 0.5 * dt;
      this.forwardVec(_fwd);
      this.position.addScaledVector(_fwd, this.runSpeed * dt);
    }
    const gy = Math.max(0, this.groundHeight(this.position.x, this.position.z));
    const prevClear = this.position.y - gyPrev;
    const drop = prevClear - this.gearOffset - (gy - gyPrev);
    this.position.y = gy + this.gearOffset;
    this.velocity.set(0, 0, 0);
    if (this.running && (this.runSpeed >= 12.5 || (drop > 0.6 && this.runSpeed > 3))) {
      this.forwardVec(_fwd);
      const s = Math.max(this.runSpeed, 14.5);
      this.velocity.copy(_fwd).multiplyScalar(s);
      this.velocity.y = 1.8;
      this.position.y += 0.2;
      this.state = 'flying';
      this.pitch = 0.05;
      this.grace = 2.2;
      this.stalled = false;
      this.running = false;
      this._launchFlag = false;
      this.emit('liftoff');
    }
    this.updateDerived(gy);
    this.airspeed = this.speed;
  }

  _updateFlying(dt, input) {
    const w = this.world;
    const p = clamp(num(input.pitch), -1, 1);
    const r = clamp(num(input.roll), -1, 1);
    const yw = clamp(num(input.yaw), -1, 1);
    const pos = this.position;
    const vel = this.velocity;

    // wind + thermals
    let wx = 0;
    let wz = 0;
    if (w && typeof w.windAt === 'function') {
      const wv = w.windAt(pos.x, pos.y, pos.z);
      if (wv) {
        wx = num(wv.x) * 0.5;
        wz = num(wv.z) * 0.5;
      }
    }
    let lift = 0;
    if (w && typeof w.liftAt === 'function') lift = num(w.liftAt(pos.x, pos.y, pos.z));
    this.liftSmooth = damp(this.liftSmooth, lift, 2.5, dt);
    if (this.liftSmooth > 1.2 && !this.inThermal) {
      this.inThermal = true;
      this.emit('thermal');
    } else if (this.liftSmooth < 0.4) this.inThermal = false;

    _air.set(vel.x - wx, vel.y - this.liftSmooth, vel.z - wz);
    const V = Math.max(_air.length(), 0.5);
    _vhat.copy(_air).multiplyScalar(1 / V);
    const gamma = Math.asin(clamp(_vhat.y, -1, 1));

    // pitch: pilot commands angle of attack
    const pc = this.grace > 0 ? p * 0.35 : p;
    const alphaCmd = 0.13 - pc * (pc > 0 ? 0.13 : 0.19);
    let pitchTarget;
    let rate;
    if (this.stalled) {
      pitchTarget = gamma - 0.08;
      rate = 5;
    } else {
      pitchTarget = gamma + alphaCmd;
      rate = 3.5;
    }
    this.pitch = clamp(this.pitch + (pitchTarget - this.pitch) * Math.min(1, dt * rate), -1.4, 1.0);
    const alpha = this.pitch - gamma;

    if (this.grace > 0) this.grace -= dt;
    if (!this.stalled && this.grace <= 0 && (alpha > 0.36 || V < 8)) {
      this.stalled = true;
      this.emit('stall');
    } else if (this.stalled && (alpha < 0.22 && V > 10.5)) this.stalled = false;

    // roll
    let rollTarget = clamp(r + 0.25 * yw, -1, 1) * 0.85;
    if (this.stalled) rollTarget += Math.sin(this.time * 11) * 0.3;
    this.roll = damp(this.roll, rollTarget, 3.2, dt);

    // aerodynamics
    let CL;
    let CDx = 0;
    if (this.stalled) {
      CL = 0.45;
      CDx = 0.22;
    } else CL = clamp(0.25 + 3.0 * alpha, -0.2, 1.15);
    // air brake (X): spoiler-style drag + lift dump, ~3:1 glide, so an over-high pilot can get down to the pad
    this.airBrake = damp(this.airBrake || 0, input.brake ? 1 : 0, 4, dt);
    CDx += 0.12 * this.airBrake;
    CL *= 1 - 0.15 * this.airBrake;
    const cosR = Math.max(Math.cos(this.roll), 0.5);
    CL *= 1 + 0.4 * (1 / cosR - 1);
    const CD = 0.03 + 0.1 * CL * CL + CDx;
    const L = 0.06 * V * V * CL;
    let D = 0.052 * V * V * CD;
    if (V > 28) D += (V - 28) * 0.5;
    this.gLoad = damp(this.gLoad, L / G, 4, dt);

    this.rightVec(_right);
    _lift.copy(_right).cross(_vhat);
    if (_lift.lengthSq() < 1e-4) _lift.set(0, 1, 0);
    else _lift.normalize();

    let ax = _lift.x * L - _vhat.x * D;
    let ay = _lift.y * L - _vhat.y * D - G;
    let az = _lift.z * L - _vhat.z * D;
    if (this.grace > 0) ay += 5 * clamp(this.grace / 2.2, 0, 1);
    vel.x += ax * dt;
    vel.y += ay * dt;
    vel.z += az * dt;

    // arcade steering assist
    const th = -Math.sin(this.roll) * 0.3 * dt;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const nx = vel.x * c + vel.z * s;
    const nz = -vel.x * s + vel.z * c;
    vel.x = nx;
    vel.z = nz;

    pos.addScaledVector(vel, dt);

    const hs = Math.hypot(vel.x, vel.z);
    if (hs > 2) this.heading += angleDiff(this.heading, Math.atan2(-vel.x, -vel.z)) * Math.min(1, dt * 5);

    this.airspeed = V;
    this.verticalSpeed = vel.y;

    // terrain / water
    const gy = Math.max(0, this.groundHeight(pos.x, pos.z));
    if (pos.y - gy <= CONTACT) {
      if (this.grace > 0) {
        pos.y = gy + this.gearOffset;
        if (vel.y < 0) vel.y = 0;
      } else {
        const tilt = Math.max(Math.abs(this.roll) * 57.29578, Math.max(0, -this.pitch * 57.29578 - 15));
        this.evaluateLanding(LIMITS, tilt);
        if (this.state === 'landed') {
          vel.y = 0;
        } else {
          if (this.state === 'splashed') pos.y = 0.6;
          else pos.y = gy + this.gearOffset;
          vel.set(0, 0, 0);
        }
      }
    }
    this.updateDerived(gy);
  }

  _updateLanded(dt) {
    const vel = this.velocity;
    const hs = Math.hypot(vel.x, vel.z);
    if (hs > 0.05) {
      const ns = Math.max(0, hs - 7 * dt);
      vel.x *= ns / hs;
      vel.z *= ns / hs;
    } else {
      vel.set(0, 0, 0);
    }
    vel.y = 0;
    this.position.x += vel.x * dt;
    this.position.z += vel.z * dt;
    const gy = Math.max(0, this.groundHeight(this.position.x, this.position.z));
    this.position.y = damp(this.position.y, gy + this.gearOffset, 8, dt);
    this.pitch = damp(this.pitch, 0, 4, dt);
    this.roll = damp(this.roll, 0, 4, dt);
    this.updateDerived(gy);
  }

  _updateSplashed(dt) {
    this.velocity.set(0, 0, 0);
    this.position.y = damp(this.position.y, 0.5 + Math.sin(this.time * 2) * 0.08, 4, dt);
    this.pitch = damp(this.pitch, 0.1, 3, dt);
    this.roll = damp(this.roll, 0.15, 3, dt);
    this.updateDerived(0);
    this.altitude = this.agl = 0;
  }

  _animate(dt) {
    const st = this.state;
    let proneT = 0;
    if (st === 'flying') proneT = 1;
    else if (st === 'splashed') proneT = 0.9;
    else if (st === 'crashed') proneT = 0.5;
    else if (st === 'grounded') proneT = this.running ? 0.12 : 0;
    this.prone = damp(this.prone, proneT, 6, dt);
    this.pilotPivot.rotation.x = (-this.prone * Math.PI) / 2;
    this.pilotPivot.position.z = 0.1 - this._pS * 0.3;
    this.bag.scale.set(1, clamp((this.prone - 0.35) * 1.8, 0.001, 1), 1);
    this.bag.visible = this.prone > 0.4;

    const pl = this.pilot;
    const armUp = this.prone > 0.5;
    const at = armUp ? -3.2 : -1.9;
    pl.armL.rotation.x = damp(pl.armL.rotation.x, at, 8, dt);
    pl.armR.rotation.x = damp(pl.armR.rotation.x, at, 8, dt);
    pl.armL.rotation.z = pl.armR.rotation.z = 0;
    pl.elbowL.rotation.x = pl.elbowR.rotation.x = damp(pl.elbowL.rotation.x, armUp ? -0.15 : -0.9, 8, dt);
    if (st === 'grounded' && this.running) {
      this.legPhase += this.runSpeed * dt * 1.1;
      const a = Math.sin(this.legPhase) * 0.9;
      pl.legL.rotation.x = a;
      pl.legR.rotation.x = -a;
      pl.kneeL.rotation.x = Math.max(0, -a) * 1.3;
      pl.kneeR.rotation.x = Math.max(0, a) * 1.3;
    } else if (st === 'flying') {
      const sway = Math.sin(this.time * 2.3) * 0.05;
      pl.legL.rotation.x = damp(pl.legL.rotation.x, 0.08 + sway, 5, dt);
      pl.legR.rotation.x = damp(pl.legR.rotation.x, 0.05 - sway, 5, dt);
      pl.kneeL.rotation.x = damp(pl.kneeL.rotation.x, 0.05, 5, dt);
      pl.kneeR.rotation.x = damp(pl.kneeR.rotation.x, 0.05, 5, dt);
    } else {
      for (const j of [pl.legL, pl.legR, pl.kneeL, pl.kneeR]) j.rotation.x = damp(j.rotation.x, 0, 6, dt);
    }
    pl.head.rotation.x = damp(pl.head.rotation.x, st === 'flying' ? 0.75 : 0, 6, dt); // look ahead
    pl.head.rotation.y = damp(pl.head.rotation.y, -this.roll * 0.4, 4, dt);
    pl.torso.rotation.z = damp(pl.torso.rotation.z, -this.roll * 0.08, 4, dt);

    // sail: tips lift with load, fabric billows when slow / stalled and ripples with airspeed
    const V = this.airspeed || this.speed;
    const flying = st === 'flying';
    const load = flying ? clamp(this.gLoad, 0.3, 2.2) : 0.4;
    const flexT = 0.02 + (load - 0.3) * 0.09 + Math.abs(this.roll) * 0.02;
    this.flex = damp(this.flex, flexT, 5, dt);
    this.crumple = damp(this.crumple, st === 'crashed' ? 1 : 0, 6, dt);
    let billowT = flying ? clamp((14 - V) / 10, 0, 0.7) : 0.12;
    if (this.stalled) billowT = 1.0 + Math.sin(this.time * 24) * 0.35;
    this.billow = damp(this.billow, billowT, 6, dt);
    const ripple = flying ? clamp(V / 20, 0, 1.4) * (0.7 + (this.stalled ? 1.2 : 0)) : 0;
    const bank = this.roll * 0.05;
    const cr = this.crumple;
    this.rightWing.update(this.flex - bank - cr * 0.9, this.billow + cr * 0.6, ripple, this.time);
    this.leftWing.update(this.flex + bank - cr * 0.9, this.billow + cr * 0.6, ripple, this.time + 1.7);
    this._updateFrame();
  }

  // world-space fx: wingtip vapour hooks + ground dust. Positions exposed in this.fx.
  _fxUpdate(dt) {
    const fx = this.fx;
    const m = this.mesh.matrix;
    this.mesh.updateMatrix();
    fx.wingtips[0].copy(this.leftWing.tipPoint).applyMatrix4(m);
    fx.wingtips[1].copy(this.rightWing.tipPoint).applyMatrix4(m);
    const V = this.airspeed || this.speed;
    const flying = this.state === 'flying';
    let vap = 0;
    if (flying) vap = clamp((this.gLoad - 1.02) * 2.6, 0, 1) + (this.stalled ? 0.4 : 0) + clamp((V - 17) / 14, 0, 0.35);
    fx.vapour = clamp(vap, 0, 1);
    this.vapour[0].update(dt, fx.wingtips[0], fx.vapour);
    this.vapour[1].update(dt, fx.wingtips[1], fx.vapour);
    // ground contact + dust
    const gy = Math.max(0, this.groundHeight(this.position.x, this.position.z));
    fx.contact.length = 0;
    let dust = 0;
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.state === 'grounded' && this.running) dust = clamp(this.runSpeed / 14, 0, 1) * 0.6;
    else if ((this.state === 'landed' || this.state === 'crashed') && hs > 1.5) dust = clamp(hs / 14, 0, 1);
    else if (flying && this.agl < 3.5 && V > 10) dust = clamp((3.5 - this.agl) / 3.5, 0, 1) * 0.25;
    fx.dust = dust;
    fx.dustColor = this.dustColorFor(this.position.x, this.position.z, gy);
    if (dust > 0.02 || this.state === 'crashed') {
      _p.set(this.position.x, gy + 0.05, this.position.z);
      fx.contact.push(_p.clone());
      this._dustT -= dt;
      if (this._dustT <= 0) {
        this._dustT = 0.05 / (0.3 + dust);
        this.forwardVec(_fwd);
        this.puffs.emit(
          _p.x - _fwd.x * 0.6 + (Math.random() - 0.5) * 0.6, _p.y, _p.z - _fwd.z * 0.6 + (Math.random() - 0.5) * 0.6,
          -_fwd.x * hs * 0.1 + (Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 0.8, -_fwd.z * hs * 0.1 + (Math.random() - 0.5) * 1.2,
          { life: 0.9 + Math.random() * 0.6, s0: 0.5, s1: 2.2 + dust * 2, alpha: 0.35 * dust + 0.1, buoy: 0.4, color: fx.dustColor }
        );
      }
    }
  }

  getCameraRig() {
    const r = this._rig;
    r.target.copy(this.position);
    r.target.y += 0.3;
    r.chaseDistance = 15;
    r.height = 4.5;
    r.fov = 62 + clamp((this.speed - 14) * 0.5, 0, 10);
    return r;
  }
}
