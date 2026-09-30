// Gyrocopter: collective throttle drives rotor thrust along the tilted body axis; pitch/roll tilt to move, yaw to turn.
// Visuals: painted composite pod, streamlined mast, tapered airfoil rotor blades with blur discs, wooden pusher prop,
// wheeled gear with compressing struts, chrome exhaust with puffs, glass windscreen and a seated pilot.
import * as THREE from 'three';
import {
  VehicleBase, G, clamp, damp, num, seg,
  mesh, sph, cylm, boxm, capsule, torusm, tube, setTube, loft, smoothSecs, finalize, createPilot,
  paint, alu, steel, chrome, rubber, cloth, glass, pbr, paintTexture, rotorBlurTexture, decalTexture, leather,
} from './common.js';
import { swapIn } from '../core/models.js';

const V3 = THREE.Vector3;
const _up = new V3();
const _fwd = new V3();
const _p = new V3();
const _q = new V3();
const LIMITS = { v: 4.5, h: 9, tilt: 20, slope: 25 };

export class Gyrocopter extends VehicleBase {
  constructor(world) {
    super(world);
    this.gearOffset = 1.0;
    this.rpm = 0; // 0..1 effective rotor thrust factor
    this.rotorAngle = 0;
    this.propAngle = 0;
    this.boosting = false;
    this.gearComp = 0;
    this.shake = 0;
    this._muzzles = [new V3(), new V3()];
    this._yawIn = 0;
    this._pitchIn = 0;
    this._rollIn = 0;
    this._dustT = 0;
    this._exT = 0;
    this._wheelAngle = 0;
    this._build();
    this.applyTransform();
  }

  _build() {
    const YEL = 0xffc400;
    const RED = 0xe8322a;
    const DK = 0x23262c;
    const body = new THREE.Group();
    this.body = body;
    this.mesh.add(body);
    const yellowM = paint(0xffffff, { map: paintTexture('#ffc400', '#e8322a', '#ffffff'), roughness: 0.28 });
    const redM = paint(RED);
    const whiteM = paint(0xf4f4f4);
    const darkM = pbr(DK, { roughness: 0.55, metalness: 0.3 });
    const aluM = alu();
    const chromeM = chrome();

    // --- fuselage pod (paint texture wraps around; roundels on flanks)
    const fus = smoothSecs(
      [[-2.0, 0.03, 0.03], [-1.75, 0.22, 0.17, 0, -0.02], [-1.3, 0.4, 0.3, 0, -0.03], [-0.7, 0.5, 0.33, 0, 0], [0.1, 0.52, 0.36, 0, 0.02], [0.7, 0.44, 0.34, 0, 0.03], [1.25, 0.2, 0.2, 0, 0.05], [1.4, 0.05, 0.05, 0, 0.05]],
      seg(30, 20, 14)
    );
    const pod = mesh(loft(fus, { axis: 'z', radial: seg(36, 24, 16), n: 2.3 }), yellowM);
    body.add(pod);
    // cockpit tub rim + coaming
    const rim = torusm(0.5, 0.03, redM, 0, 0.36, -0.15);
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(0.96, 1.5, 1);
    rim.position.set(0, 0.34, -0.05);
    // cowl / turtle deck behind seat
    const deck = mesh(loft(smoothSecs([[0.3, 0.02, 0.02], [0.55, 0.34, 0.13], [1.0, 0.36, 0.17], [1.35, 0.06, 0.06]], 14), { axis: 'z', radial: 18, n: 2.5 }), redM);
    deck.position.set(0, 0.3, 0);
    body.add(deck);
    // nose intake + spinner ring
    const nose = mesh(new THREE.TorusGeometry(0.11, 0.025, 10, 20), chromeM, 0, -0.03, -1.9);
    body.add(nose);
    // windscreen (glass hemisphere shell) + frame
    const wsGeo = new THREE.SphereGeometry(1, 28, 14, Math.PI * 0.72, Math.PI * 0.56, 0.1, Math.PI * 0.32);
    const ws = mesh(wsGeo, glass(0xa8dcff, 0.28), 0, 0.28, -0.95);
    ws.scale.set(0.5, 0.5, 0.72);
    ws.userData.noShadow = true;
    body.add(ws);
    const wsFrame = mesh(new THREE.TorusGeometry(0.44, 0.018, 8, 28, Math.PI), chromeM, 0, 0.36, -0.53);
    wsFrame.rotation.set(0, 0, 0);
    wsFrame.scale.set(1, 0.4, 1);
    body.add(wsFrame);
    // dashboard + gauges
    body.add(boxm(0.62, 0.05, 0.26, darkM, 0, 0.38, -0.68));
    for (const x of [-0.16, 0.0, 0.16]) {
      const gauge = cylm(0.045, 0.045, 0.01, pbr(0xdff6ff, { roughness: 0.2, emissive: 0x3388aa, emissiveIntensity: 0.5 }), x, 0.415, -0.7, 16);
      body.add(gauge);
    }
    // seat
    body.add(boxm(0.52, 0.09, 0.44, leather(0x2a2018), 0, 0.2, 0.18));
    const seatBack = boxm(0.52, 0.5, 0.09, leather(0x2a2018), 0, 0.5, 0.44);
    seatBack.rotation.x = -0.15;
    body.add(seatBack);
    // pilot (seated)
    this.pilot = createPilot({ suit: 0x22a35a, helmet: 0xff9500, stripe: 0xffffff, trim: 0xffffff, style: 'goggles' });
    this.pilot.group.position.set(0, -0.62, 0.18);
    const pl = this.pilot;
    pl.legL.rotation.x = pl.legR.rotation.x = 1.45;
    pl.kneeL.rotation.x = pl.kneeR.rotation.x = -1.4;
    pl.armL.rotation.x = pl.armR.rotation.x = 0.9;
    pl.elbowL.rotation.x = pl.elbowR.rotation.x = -0.9;
    body.add(pl.group);
    // control stick
    this.stick = new THREE.Group();
    this.stick.position.set(0, 0.2, -0.32);
    this.stick.add(tube(new V3(0, 0, 0), new V3(0, 0.5, 0.05), 0.016, chromeM));
    this.stick.add(sph(0.035, rubber(), 0, 0.53, 0.05));
    body.add(this.stick);

    // --- mast, rotor head, rotor
    const mastSecs = smoothSecs([[0.4, 0.09, 0.14], [1.2, 0.06, 0.1], [2.15, 0.055, 0.075]], 10);
    const mast = mesh(loft(mastSecs, { axis: 'y', radial: 14 }), whiteM, 0, 0, 0.28);
    body.add(mast);
    body.add(tube(new V3(0.42, 0.28, 0.75), new V3(0.03, 2.0, 0.25), 0.03, aluM));
    body.add(tube(new V3(-0.42, 0.28, 0.75), new V3(-0.03, 2.0, 0.25), 0.03, aluM));
    body.add(tube(new V3(0.0, 0.2, -0.55), new V3(0, 1.9, 0.22), 0.025, aluM)); // forward brace
    this.rotorTilt = new THREE.Group();
    this.rotorTilt.position.set(0, 2.2, 0.28);
    body.add(this.rotorTilt);
    this.rotorTilt.add(cylm(0.09, 0.11, 0.16, chromeM, 0, 0.0, 0, 16));
    this.rotor = new THREE.Group();
    this.rotor.position.y = 0.11;
    this.rotorTilt.add(this.rotor);
    this.rotor.add(cylm(0.12, 0.12, 0.09, darkM, 0, 0.0, 0, 16));
    this.rotor.add(boxm(0.32, 0.035, 0.09, chromeM, 0, -0.02, 0)); // teeter bar
    const bladeMats = [paint(RED, { roughness: 0.3 }), paint(0xf4f4f4, { roughness: 0.3 })];
    const tipM = paint(0xffc400, { roughness: 0.3 });
    this.blades = [];
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const bl = new THREE.Group();
      const secs = smoothSecs([[0.15, 0.1, 0.02], [0.9, 0.16, 0.026], [2.4, 0.13, 0.02], [3.55, 0.105, 0.014], [3.62, 0.03, 0.005]], seg(18, 12, 8));
      const blade = mesh(loft(secs, { axis: 'x', radial: seg(14, 10, 8) }), bladeMats[i]);
      // tip color band
      const tsecs = smoothSecs([[3.0, 0.118, 0.0175], [3.55, 0.105, 0.014], [3.62, 0.03, 0.005]], 6);
      const tip = mesh(loft(tsecs, { axis: 'x', radial: seg(14, 10, 8) }), tipM);
      tip.scale.set(1, 1.04, 1.04);
      bl.add(blade, tip);
      bl.add(boxm(0.16, 0.018, 0.03, chromeM, 3.62 - 0.05, 0.03, -0.08)); // tip weight
      if (s < 0) bl.rotation.y = Math.PI;
      bl.rotation.z = 0.07 * (s > 0 ? 1 : 1); // coning
      this.rotor.add(bl);
      this.blades.push(bl);
    }
    // blur discs
    const bt = rotorBlurTexture();
    this.discs = [];
    for (let i = 0; i < 2; i++) {
      const dg = new THREE.CircleGeometry(3.7, 48);
      dg.rotateX(-Math.PI / 2);
      const d = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({ map: bt, color: i ? 0xffe9c8 : 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: true }));
      d.position.y = 0.11 + i * 0.01;
      d.userData.noShadow = true;
      d.renderOrder = 4;
      this.rotorTilt.add(d);
      this.discs.push(d);
    }
    this.disc = this.discs[0];

    // --- tail
    body.add(tube(new V3(0, 0.3, 1.0), new V3(0, 0.62, 3.3), 0.075, aluM));
    const finSecs = smoothSecs([[0.0, 0.02, 0.33], [0.6, 0.018, 0.25], [1.05, 0.012, 0.12]], 8);
    const fin = mesh(loft(finSecs, { axis: 'y', radial: 12 }), redM);
    fin.position.set(0, 0.62, 3.05);
    fin.rotation.x = -0.12;
    body.add(fin);
    this.rudder = new THREE.Group();
    this.rudder.position.set(0, 0.6, 3.36);
    const rud = mesh(loft(smoothSecs([[0.0, 0.016, 0.14], [0.55, 0.014, 0.12], [1.02, 0.008, 0.06]], 8), { axis: 'y', radial: 10 }), paint(0xffffff), 0, 0, 0.13);
    this.rudder.add(rud);
    body.add(this.rudder);
    // horizontal stabilizer + elevator
    const stab = mesh(loft(smoothSecs([[-0.8, 0.005, 0.02], [-0.5, 0.15, 0.024], [0.5, 0.15, 0.024], [0.8, 0.005, 0.02]], 10), { axis: 'x', radial: 12 }), paint(YEL), 0, 0.66, 3.05);
    body.add(stab);
    this.elevator = new THREE.Group();
    this.elevator.position.set(0, 0.66, 3.2);
    const el = mesh(loft(smoothSecs([[-0.78, 0.004, 0.012], [-0.5, 0.09, 0.016], [0.5, 0.09, 0.016], [0.78, 0.004, 0.012]], 10), { axis: 'x', radial: 12 }), redM, 0, 0, 0.09);
    this.elevator.add(el);
    body.add(this.elevator);

    // --- engine + exhaust + pusher prop
    body.add(mesh(loft(smoothSecs([[0.75, 0.2, 0.18], [1.15, 0.28, 0.24], [1.45, 0.18, 0.16], [1.6, 0.05, 0.05]], 10), { axis: 'z', radial: 18 }), darkM, 0, 0.32, 0));
    for (const s of [-1, 1]) {
      const cyl = cylm(0.09, 0.09, 0.22, aluM, s * 0.3, 0.32, 1.2, 16);
      cyl.rotation.z = Math.PI / 2;
      body.add(cyl);
      for (let f = 0; f < 5; f++) {
        const fin = cylm(0.115, 0.115, 0.012, aluM, s * (0.24 + f * 0.035), 0.32, 1.2, 16);
        fin.rotation.z = Math.PI / 2;
        body.add(fin);
      }
    }
    // exhaust: chrome pipe sweeping to the rear on the right
    const pipe = new THREE.CatmullRomCurve3([new V3(0.34, 0.3, 1.2), new V3(0.5, 0.24, 1.35), new V3(0.55, 0.22, 1.7), new V3(0.4, 0.25, 2.0)]);
    body.add(mesh(new THREE.TubeGeometry(pipe, 20, 0.032, 10, false), chromeM));
    this.exhaustPoint = new V3(0.4, 0.25, 2.03);
    body.add(cylm(0.05, 0.04, 0.12, chromeM, 0.4, 0.25, 2.05, 12)).children.at(-1).rotation.x = Math.PI / 2;
    this.exhaustGlow = new THREE.Mesh(new THREE.CircleGeometry(0.035, 12), new THREE.MeshBasicMaterial({ color: 0xff6a20, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.exhaustGlow.position.set(0.4, 0.25, 2.115);
    this.exhaustGlow.userData.noShadow = true;
    body.add(this.exhaustGlow);
    this.prop = new THREE.Group();
    this.prop.position.set(0, 0.32, 1.62);
    const woodM = pbr(0xb07a3c, { roughness: 0.45, clearcoat: 0.6 });
    for (let i = 0; i < 2; i++) {
      const pb = mesh(loft(smoothSecs([[0.08, 0.05, 0.012], [0.3, 0.09, 0.016], [0.6, 0.075, 0.012], [0.88, 0.05, 0.008], [0.92, 0.02, 0.004]], 10), { axis: 'y', radial: 10 }), woodM);
      pb.rotation.y = 0.35;
      if (i) pb.rotation.z = Math.PI;
      this.prop.add(pb);
      const tp = mesh(loft(smoothSecs([[0.75, 0.05, 0.0085], [0.88, 0.05, 0.008], [0.92, 0.02, 0.004]], 4), { axis: 'y', radial: 10 }), paint(0xffc400));
      tp.rotation.y = 0.35;
      tp.scale.set(1.04, 1, 1.5);
      if (i) tp.rotation.z = Math.PI;
      this.prop.add(tp);
    }
    const spinner = mesh(new THREE.ConeGeometry(0.11, 0.3, 20), redM, 0, 0, 0.2);
    spinner.rotation.x = Math.PI / 2;
    this.prop.add(spinner);
    this.prop.add(cylm(0.11, 0.11, 0.03, chromeM, 0, 0, 0.02, 20)).children.at(-1).rotation.x = Math.PI / 2;
    body.add(this.prop);
    const pdg = new THREE.CircleGeometry(0.92, 32);
    this.propDisc = new THREE.Mesh(pdg, new THREE.MeshBasicMaterial({ map: bt, color: 0xdddddd, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    this.propDisc.position.set(0, 0.32, 1.6);
    this.propDisc.userData.noShadow = true;
    body.add(this.propDisc);

    // --- landing gear (wheels + struts compress together)
    this.gear = new THREE.Group();
    body.add(this.gear);
    const tireM = rubber(0x141416);
    const hubM = alu(0xe8ecf0);
    this.wheels = [];
    const mkWheel = (x, y, z, r, w) => {
      const wg = new THREE.Group();
      wg.position.set(x, y, z);
      const tire = mesh(new THREE.TorusGeometry(r - w * 0.5, w * 0.5, 14, 28), tireM);
      tire.rotation.y = Math.PI / 2;
      const hub = cylm(r * 0.6, r * 0.6, w * 0.9, hubM, 0, 0, 0, 20);
      hub.rotation.z = Math.PI / 2;
      wg.add(tire, hub);
      const spokes = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const sp = boxm(w * 0.95, r * 1.1, 0.02, redM, 0, 0, 0);
        sp.rotation.x = (i * Math.PI) / 3;
        spokes.add(sp);
      }
      wg.add(spokes);
      wg.userData.spin = spokes;
      this.gear.add(wg);
      this.wheels.push(wg);
      wg.add(cylm(0.03, 0.03, w * 1.3, chromeM, 0, 0, 0, 10)).children.at(-1).rotation.z = Math.PI / 2;
      return wg;
    };
    for (const s of [-1, 1]) {
      mkWheel(s * 0.78, -0.76, 0.2, 0.25, 0.12);
      // main strut (spring leg) + brace
      this.gear.add(tube(new V3(s * 0.3, -0.3, 0.28), new V3(s * 0.78, -0.76, 0.2), 0.035, aluM));
      this.gear.add(tube(new V3(s * 0.4, -0.32, -0.15), new V3(s * 0.78, -0.76, 0.2), 0.022, steel()));
      // wheel fairing
      const fair = mesh(loft(smoothSecs([[-0.4, 0.01, 0.01], [-0.2, 0.14, 0.13], [0.2, 0.15, 0.14], [0.5, 0.01, 0.01]], 8), { axis: 'z', radial: 14 }), redM, s * 0.78, -0.76, 0.2);
      fair.scale.set(0.6, 0.6, 0.6);
      fair.position.x = s * 0.84;
      this.gear.add(fair);
    }
    // nose wheel on a fork
    mkWheel(0, -0.8, -1.3, 0.2, 0.1);
    this.gear.add(tube(new V3(0, -0.15, -1.15), new V3(0, -0.8, -1.3), 0.03, aluM));
    for (const s of [-1, 1]) this.gear.add(tube(new V3(0, -0.55, -1.24), new V3(s * 0.08, -0.8, -1.3), 0.014, steel()));

    // --- bomb pods
    for (const s of [-1, 1]) {
      const bomb = mesh(loft(smoothSecs([[-0.5, 0.005, 0.005], [-0.3, 0.08, 0.08], [0.1, 0.11, 0.11], [0.4, 0.09, 0.09], [0.55, 0.02, 0.02]], 10), { axis: 'z', radial: 16 }), darkM, s * 0.55, -0.5, -0.1);
      body.add(bomb);
      body.add(tube(new V3(s * 0.5, -0.32, -0.1), new V3(s * 0.55, -0.5, -0.1), 0.02, steel()));
      const band = torusm(0.105, 0.012, paint(0xffd60a), s * 0.55, -0.5, -0.05);
      body.add(band);
      for (const a of [0, 1, 2, 3]) {
        const f = boxm(0.005, 0.1, 0.09, redM, 0, 0, 0);
        f.position.set(s * 0.55, -0.5, 0.42);
        f.rotation.z = (a * Math.PI) / 2;
        f.translateY(0.06);
        body.add(f);
      }
    }
    finalize(this.mesh);
    this.rudder.traverse((o) => o.isMesh && (o.castShadow = true));
    this.body.userData.baseY = 0;

    // Hero GLB: pod/mast/rotor/prop/gear swapped for a hand-modelled autogyro. Its "rotor" and
    // "prop" nodes have pivots at the rotation axis (matching this.rotorTilt/this.rotor and
    // this.prop above) so _animate can spin them the same way as the procedural parts, which stay
    // in the scene (hidden) as the ?models=0 / load-failure fallback. Blur discs + exhaust glow are
    // cheap additive overlays kept visible over either visual.
    this._glbRotor = null;
    this._glbProp = null;
    swapIn(this.body, 'gyrocopter', {
      keep: [this.exhaustGlow, this.discs[0], this.discs[1], this.propDisc],
      onLoad: (model) => {
        this._glbRotor = model.getObjectByName('rotor');
        this._glbProp = model.getObjectByName('prop');
      },
    });
  }

  _groundStart() {
    this.rpm = 0;
    this.boosting = false;
  }
  _airStart() {
    this.rpm = 0.5;
    this.pitch = 0;
  }

  getMuzzles() {
    this.mesh.updateMatrixWorld(true);
    this._muzzles[0].set(-0.55, -0.7, -0.1);
    this._muzzles[1].set(0.55, -0.7, -0.1);
    this.mesh.localToWorld(this._muzzles[0]);
    this.mesh.localToWorld(this._muzzles[1]);
    return this._muzzles;
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
    this.rpm = damp(this.rpm, 0, 1.5, dt);
    if (this.state === 'splashed') {
      this.position.y = damp(this.position.y, 0.1 + Math.sin(this.time * 2) * 0.08, 3, dt);
      this.roll = damp(this.roll, 0.3, 2, dt);
      this.pitch = damp(this.pitch, -0.15, 2, dt);
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
    const thr = clamp(num(input.throttle), 0, 1);
    this.throttle = thr;
    this._pitchIn = damp(this._pitchIn, p, 8, dt);
    this._rollIn = damp(this._rollIn, r, 8, dt);
    this._yawIn = damp(this._yawIn, yw, 8, dt);
    const resting = this.state === 'grounded' || this.state === 'landed';

    // rotor spin-up
    this.rpm = damp(this.rpm, thr, 1.6, dt);

    // attitude
    const pitchT = resting ? 0 : -p * 0.5;
    const rollT = resting ? 0 : r * 0.55;
    this.pitch = damp(this.pitch, pitchT, 3.2, dt);
    this.roll = damp(this.roll, rollT, 3.2, dt);
    this.heading -= (yw * (resting ? 0.6 : 1.4) + (resting ? 0 : this.roll * 0.5)) * dt;

    // thrust
    const boost = !!input.boost && !resting;
    if (boost && !this.boosting) this.emit('boost');
    this.boosting = boost;
    this.upVec(_up);
    let T = G * (0.35 + 1.3 * this.rpm) * (boost ? 1.12 : 1);
    T /= Math.max(0.75, _up.y);
    let ax = _up.x * T;
    let ay = _up.y * T - G;
    let az = _up.z * T;
    if (boost) {
      this.forwardVec(_fwd);
      ax += _fwd.x * 8;
      az += _fwd.z * 8;
    }
    // drag
    const hd = 0.12 * (input.brake ? 4 : 1) * (resting ? 10 : 1);
    ax -= vel.x * hd;
    az -= vel.z * hd;
    const hsp = Math.hypot(vel.x, vel.z);
    const quad = 0.004 * hsp;
    ax -= vel.x * quad;
    az -= vel.z * quad;
    ay -= vel.y * (vel.y < 0 ? 1.0 : 1.1);

    vel.x += ax * dt;
    vel.y += ay * dt;
    vel.z += az * dt;
    pos.addScaledVector(vel, dt);

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
      if (this.state === 'landed') {
        vel.y = 0;
        this.gearComp = 0.25;
      } else if (this.state === 'crashed') {
        vel.set(0, 0, 0);
      } else if (this.state === 'splashed') {
        pos.y = 0.1;
        vel.set(0, 0, 0);
      }
    }
    this.updateDerived(gy);
  }

  _animate(dt) {
    const spin = 2 + this.rpm * 32;
    this.rotorAngle += spin * dt;
    this.rotor.rotation.y = this.rotorAngle;
    this.propAngle += (4 + this.rpm * 60) * dt;
    this.prop.rotation.z = this.propAngle;
    if (this._glbRotor) {
      this._glbRotor.rotation.y = this.rotorAngle;
      this._glbRotor.rotation.x = damp(this._glbRotor.rotation.x, -this._pitchIn * 0.09, 6, dt);
      this._glbRotor.rotation.z = damp(this._glbRotor.rotation.z, -this._rollIn * 0.09, 6, dt);
    }
    if (this._glbProp) {
      this._glbProp.rotation.z = this.propAngle;
      this._glbProp.visible = this.rpm < 0.4;
    }
    const blur = clamp((this.rpm - 0.12) * 1.6, 0, 1);
    this.discs[0].material.opacity = blur * 0.42;
    this.discs[1].material.opacity = blur * 0.3;
    this.discs[0].rotation.y = -this.rotorAngle * 0.4;
    this.discs[1].rotation.y = this.rotorAngle * 0.23;
    // blades fade into the blur at high rpm
    const bladeVis = 1 - blur * 0.55;
    for (const b of this.blades) b.traverse((o) => { if (o.isMesh && o.material.transparent !== undefined) {} });
    this.propDisc.material.opacity = clamp((this.rpm - 0.05) * 0.9, 0, 0.5);
    this.propDisc.rotation.z = -this.propAngle;
    this.prop.visible = this.rpm < 0.35;
    // rotor head follows cyclic; blades flap/cone with load
    this.rotorTilt.rotation.x = damp(this.rotorTilt.rotation.x, -this._pitchIn * 0.09, 6, dt);
    this.rotorTilt.rotation.z = damp(this.rotorTilt.rotation.z, -this._rollIn * 0.09, 6, dt);
    const cone = 0.05 + this.rpm * 0.08;
    this.blades[0].rotation.z = cone + Math.sin(this.rotorAngle * 1.0) * 0.012 * this.rpm;
    this.blades[1].rotation.z = -cone + Math.sin(this.rotorAngle + 3.14) * 0.012 * this.rpm;
    // rumble
    const rumble = this.state === 'flying' || this.state === 'grounded' ? this.rpm * 0.012 : 0;
    this.body.position.set(Math.sin(this.time * 47) * rumble, Math.sin(this.time * 53) * rumble, 0);
    // gear compress after landing / relax
    this.gearComp = damp(this.gearComp, 0, 6, dt);
    this.gear.position.y = this.gearComp * 0.3;
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    const rolling = this.state === 'landed' || this.state === 'grounded';
    this._wheelAngle += (rolling ? hs : this.speed * 0.02) * dt / 0.24;
    for (const w of this.wheels) w.userData.spin.rotation.x = -this._wheelAngle;
    // control surfaces + stick
    this.rudder.rotation.y = damp(this.rudder.rotation.y, this._yawIn * 0.5, 8, dt);
    this.elevator.rotation.x = damp(this.elevator.rotation.x, this._pitchIn * 0.4, 8, dt);
    this.stick.rotation.x = damp(this.stick.rotation.x, -this._pitchIn * 0.35, 8, dt);
    this.stick.rotation.z = damp(this.stick.rotation.z, -this._rollIn * 0.3, 8, dt);
    // pilot leans and works the stick
    const pl = this.pilot;
    pl.torso.rotation.x = -this.pitch * 0.3;
    pl.head.rotation.z = -this.roll * 0.2;
    pl.armL.rotation.x = pl.armR.rotation.x = 0.85 - this._pitchIn * 0.3;
    pl.armR.rotation.z = -this._rollIn * 0.15;
    pl.armL.rotation.z = -this._rollIn * 0.15;
    pl.head.rotation.x = damp(pl.head.rotation.x, -this.pitch * 0.4, 5, dt);
    this.exhaustGlow.material.opacity = clamp(this.rpm * 0.7, 0, 0.6) * (0.7 + Math.random() * 0.3);
    if (this.state === 'crashed') this.body.rotation.z = damp(this.body.rotation.z, 0.5, 5, dt);
    else this.body.rotation.z = damp(this.body.rotation.z, 0, 5, dt);
  }

  // exhaust puffs, wheel dust, rotor downwash dust; positions/intensity mirrored in this.fx
  _fxUpdate(dt) {
    const fx = this.fx;
    this.mesh.updateMatrix();
    const m = this.mesh.matrix;
    const gy = Math.max(0, this.groundHeight(this.position.x, this.position.z));
    const rpm = this.rpm;
    // exhaust
    fx.exhaust.length = 0;
    _p.copy(this.exhaustPoint).applyMatrix4(m);
    this.forwardVec(_fwd);
    fx.exhaust.push({ position: _p.clone(), direction: _fwd.clone().negate(), power: rpm });
    this._exT -= dt;
    if (this._exT <= 0 && rpm > 0.05 && this.state !== 'crashed' && this.state !== 'splashed') {
      this._exT = 0.05 + (1 - rpm) * 0.08;
      this.puffs.emit(_p.x, _p.y, _p.z, -_fwd.x * 2 - this.velocity.x * 0.3 + (Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 0.3, -_fwd.z * 2 * -1 - this.velocity.z * 0.3, {
        life: 0.7, s0: 0.15, s1: 0.7, alpha: 0.16 + rpm * 0.12, buoy: 0.5, color: 0xb8c4d8, drag: 1.6,
      });
    }
    // dust: rolling wheels + downwash
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    const rolling = (this.state === 'grounded' || this.state === 'landed') && hs > 1;
    const wash = rpm > 0.3 && this.agl < 9 && this.state !== 'crashed' && this.state !== 'splashed' ? rpm * clamp(1 - this.agl / 9, 0, 1) : 0;
    fx.dust = Math.max(wash, rolling ? clamp(hs / 12, 0, 0.6) : 0);
    fx.dustColor = this.dustColorFor(this.position.x, this.position.z, gy);
    fx.contact.length = 0;
    if (this.state === 'grounded' || this.state === 'landed') {
      for (const w of this.wheels) {
        _q.set(w.position.x, w.position.y - 0.25, w.position.z).applyMatrix4(this.body.matrix).applyMatrix4(m);
        fx.contact.push(_q.clone());
      }
    }
    fx.rotorDisc = fx.rotorDisc || { center: new V3(), radius: 3.9 };
    fx.rotorDisc.center.set(0, 2.3, 0.28).applyMatrix4(m);
    this._dustT -= dt;
    if (fx.dust > 0.05 && this._dustT <= 0 && this.state !== 'splashed') {
      this._dustT = 0.035 / (0.4 + fx.dust);
      const a = Math.random() * Math.PI * 2;
      const rad = wash > 0.05 ? 0.6 + Math.random() * 1.5 : 0.3;
      const sp = wash > 0.05 ? 3 + wash * 6 : 0.5;
      this.puffs.emit(
        this.position.x + Math.cos(a) * rad, gy + 0.1, this.position.z + Math.sin(a) * rad,
        Math.cos(a) * sp + this.velocity.x * 0.2, 0.4 + Math.random() * 0.6, Math.sin(a) * sp + this.velocity.z * 0.2,
        { life: 0.8 + Math.random() * 0.7, s0: 0.6, s1: 2.6 + fx.dust * 2.4, alpha: 0.28 * fx.dust + 0.05, buoy: 0.5, color: fx.dustColor, drag: 2.2 }
      );
    }
  }

  getCameraRig() {
    const r = this._rig;
    r.target.copy(this.position);
    r.target.y += 0.8;
    r.chaseDistance = 16;
    r.height = 5;
    r.fov = 66 + clamp(this.speed * 0.15, 0, 8);
    return r;
  }
}
