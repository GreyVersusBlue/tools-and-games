import * as THREE from 'three';

// Dolphin arcs, circling gulls, a drifting sailboat, and a jet that
// crosses the sky every few minutes trailing a contrail.

// ---------- Dolphin ----------
function makeDolphin() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3d4a52, roughness: 0.4, metalness: 0.1 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), mat);
  body.scale.set(2.6, 0.9, 0.8);
  g.add(body);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.4, 10), mat);
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(2.9, 0.05, 0);
  g.add(nose);

  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.1, 3), mat);
  fin.position.set(0.2, 1.0, 0);
  fin.rotation.y = Math.PI / 2;
  fin.scale.set(1, 1, 0.35);
  g.add(fin);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.2, 3), mat);
  tail.position.set(-2.6, 0, 0);
  tail.rotation.z = Math.PI / 2;
  tail.scale.set(1, 1, 0.3);
  g.add(tail);

  return g;
}

// ---------- Gull ----------
function makeGull() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xf2ebe0, side: THREE.DoubleSide });
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,   1.6, 0.15, 0.35,   1.6, 0.15, -0.35,
  ], 3));
  wingGeo.computeVertexNormals();
  const wL = new THREE.Mesh(wingGeo, mat);
  const wR = new THREE.Mesh(wingGeo.clone(), mat);
  wR.scale.x = -1;
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), mat);
  body.scale.set(1.8, 0.8, 0.8);
  g.add(wL, wR, body);
  g.userData = { wL, wR };
  return g;
}

// ---------- Sailboat ----------
function makeSailboat() {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x30353d, roughness: 0.6 });
  const sailMat = new THREE.MeshStandardMaterial({ color: 0xf7ecd9, roughness: 0.9, side: THREE.DoubleSide });

  const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 0.6, 9, 8, 1), hullMat);
  hull.rotation.z = Math.PI / 2;
  hull.scale.set(1, 1, 0.45);
  g.add(hull);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 10, 6), hullMat);
  mast.position.y = 5.5;
  g.add(mast);

  const mainSailGeo = new THREE.BufferGeometry();
  mainSailGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 10.2, 0,   0, 1.6, 0,   -5.4, 1.6, 0,
  ], 3));
  mainSailGeo.computeVertexNormals();
  g.add(new THREE.Mesh(mainSailGeo, sailMat));

  const jibGeo = new THREE.BufferGeometry();
  jibGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 9.4, 0,   0, 1.6, 0,   4.6, 1.4, 0,
  ], 3));
  jibGeo.computeVertexNormals();
  g.add(new THREE.Mesh(jibGeo, sailMat));

  return g;
}

// ---------- Plane ----------
function makePlane() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xd8d3ca, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 7, 8), mat);
  body.rotation.z = Math.PI / 2;
  g.add(body);
  const noseC = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), mat);
  noseC.position.x = 3.5; g.add(noseC);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 9), mat);
  wing.position.x = 0.3; g.add(wing);
  const tailW = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 3.4), mat);
  tailW.position.x = -3.1; g.add(tailW);
  const tailF = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.12), mat);
  tailF.position.set(-3.2, 0.8, 0); g.add(tailF);
  return g;
}

export function buildWildlife(scene, audio) {
  const dolphin = makeDolphin();
  dolphin.visible = false;
  scene.add(dolphin);

  const gulls = [];
  for (let i = 0; i < 5; i++) {
    const gull = makeGull();
    gull.userData.orbit = {
      cx: -40 + Math.random() * 120,
      cz: -60 - Math.random() * 60,
      r: 12 + Math.random() * 18,
      h: 14 + Math.random() * 16,
      speed: 0.25 + Math.random() * 0.2,
      phase: Math.random() * Math.PI * 2,
      flap: 1.5 + Math.random(),
      dir: Math.random() < 0.5 ? 1 : -1,
    };
    scene.add(gull);
    gulls.push(gull);
  }

  const boat = makeSailboat();
  boat.position.set(-160, 0, -260);
  scene.add(boat);

  const plane = makePlane();
  plane.visible = false;
  scene.add(plane);

  // Contrail: pool of fading sprites
  const trailMat = new THREE.SpriteMaterial({ color: 0xf5eee2, transparent: true, opacity: 0.5, depthWrite: false });
  const trail = [];
  for (let i = 0; i < 90; i++) {
    const s = new THREE.Sprite(trailMat.clone());
    s.visible = false;
    s.scale.set(2.5, 2.5, 1);
    scene.add(s);
    trail.push({ sprite: s, life: 0 });
  }
  let trailIdx = 0, trailTimer = 0;

  const state = {
    t: 0,
    dolphinTimer: 12,          // first appearance shortly after start
    dolphinActive: false,
    dolphinT: 0,
    dolphinX: 0, dolphinZ: 0, dolphinDir: 1,
    planeTimer: 45,            // first flyover ~45s in, then every 2–3.5 min
    planeActive: false,
    planeT: 0,
    planeFrom: new THREE.Vector3(),
    planeTo: new THREE.Vector3(),
  };

  state.update = (dt, camera) => {
    state.t += dt;

    // --- dolphin: periodic series of 3–5 arcs traveling laterally ---
    if (!state.dolphinActive) {
      state.dolphinTimer -= dt;
      if (state.dolphinTimer <= 0) {
        state.dolphinActive = true;
        state.dolphinT = 0;
        state.dolphinX = camera.position.x - 60 + Math.random() * 120;
        state.dolphinZ = -110 - Math.random() * 70;
        state.dolphinDir = Math.random() < 0.5 ? 1 : -1;
        state.dolphinArcs = 3 + (Math.random() * 3 | 0);
      }
    } else {
      state.dolphinT += dt;
      const arcDur = 2.4;
      const arcIdx = Math.floor(state.dolphinT / arcDur);
      const p = (state.dolphinT % arcDur) / arcDur;
      if (arcIdx >= state.dolphinArcs) {
        state.dolphinActive = false;
        dolphin.visible = false;
        state.dolphinTimer = 40 + Math.random() * 50;
      } else {
        // each arc: rise out of water and dive, moving forward
        const x = state.dolphinX + state.dolphinDir * (arcIdx * 9 + p * 9);
        const y = Math.sin(p * Math.PI) * 2.6 - 1.1;
        dolphin.visible = y > -0.9;
        dolphin.position.set(x, y, state.dolphinZ);
        dolphin.rotation.z = (0.5 - p) * 1.1;
        dolphin.rotation.y = state.dolphinDir > 0 ? 0 : Math.PI;
        if (p < 0.06 && dolphin.visible && audio) audio.splash(0.15);
      }
    }

    // --- gulls ---
    for (const gull of gulls) {
      const o = gull.userData.orbit;
      const a = state.t * o.speed * o.dir + o.phase;
      gull.position.set(o.cx + Math.cos(a) * o.r, o.h + Math.sin(state.t * 0.4 + o.phase) * 1.5, o.cz + Math.sin(a) * o.r);
      gull.rotation.y = -a * o.dir + (o.dir > 0 ? Math.PI : 0);
      const flap = Math.sin(state.t * o.flap * 4 + o.phase);
      gull.userData.wL.rotation.x = flap * 0.6;
      gull.userData.wR.rotation.x = -flap * 0.6;
    }

    // --- sailboat: slow drift + rock ---
    boat.position.x = -160 + ((state.t * 1.1) % 380);
    boat.position.y = Math.sin(state.t * 0.5) * 0.25;
    boat.rotation.z = Math.sin(state.t * 0.45) * 0.05;
    boat.rotation.x = Math.sin(state.t * 0.33) * 0.03;

    // --- plane flyover ---
    if (!state.planeActive) {
      state.planeTimer -= dt;
      if (state.planeTimer <= 0) {
        state.planeActive = true;
        state.planeT = 0;
        const dir = Math.random() < 0.5 ? 1 : -1;
        const zOff = -80 + Math.random() * 160;
        state.planeFrom.set(-450 * dir, 95 + Math.random() * 40, camera.position.z + zOff - 120);
        state.planeTo.set(450 * dir, 105 + Math.random() * 40, camera.position.z + zOff + 60);
        if (audio) audio.startPlane();
        for (const seg of trail) { seg.sprite.visible = false; seg.life = 0; }
      }
    } else {
      const DUR = 38;
      state.planeT += dt;
      const p = state.planeT / DUR;
      if (p >= 1) {
        state.planeActive = false;
        plane.visible = false;
        state.planeTimer = 120 + Math.random() * 90; // every 2–3.5 minutes
        if (audio) audio.stopPlane();
      } else {
        plane.visible = true;
        plane.position.lerpVectors(state.planeFrom, state.planeTo, p);
        plane.lookAt(state.planeTo);
        plane.rotateY(-Math.PI / 2);
        if (audio) audio.updatePlane(p, plane.position, camera.position);

        // drop contrail puffs
        trailTimer -= dt;
        if (trailTimer <= 0) {
          trailTimer = 0.35;
          const seg = trail[trailIdx++ % trail.length];
          seg.sprite.position.copy(plane.position);
          seg.sprite.position.x -= 3;
          seg.life = 1;
          seg.sprite.visible = true;
        }
      }
    }
    for (const seg of trail) {
      if (!seg.sprite.visible) continue;
      seg.life -= dt / 26;
      if (seg.life <= 0) { seg.sprite.visible = false; continue; }
      seg.sprite.material.opacity = seg.life * 0.4;
      const grow = 2.5 + (1 - seg.life) * 6;
      seg.sprite.scale.set(grow, grow * 0.6, 1);
    }
  };

  return state;
}
