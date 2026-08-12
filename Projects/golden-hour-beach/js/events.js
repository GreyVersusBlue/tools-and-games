import * as THREE from 'three';
import { groundHeight, shorelineZ, mulberry32 } from './field.js';

// The rare wonders: scripted set-pieces on long randomized timers, at most one
// active at a time. Rare is the load-bearing word — fired too often these
// become weather. The timers are tuned against a real hour on the beach.
//
//   bait ball    a shimmer offshore, terns wheeling and hitting it, ~90 s
//   whale spout  a distant breath, sound arriving late, then nothing
//   moon jellies stranded glowing domes along the wrack, some nights
//   meteor shower some nights the sky simply decides — skynight rate x8

function makeTern() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xf2ebe0, side: THREE.DoubleSide });
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 1.2, 0.12, 0.28, 1.2, 0.12, -0.28,
  ], 3));
  wingGeo.computeVertexNormals();
  const wL = new THREE.Mesh(wingGeo, mat);
  const wR = new THREE.Mesh(wingGeo.clone(), mat);
  wR.scale.x = -1;
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), mat);
  body.scale.set(1.7, 0.7, 0.7);
  g.add(wL, wR, body);
  g.userData = { wL, wR };
  return g;
}

export function buildEvents(scene, audio, skynight, journal) {
  const rnd = mulberry32(0xe4e7);

  // ---------- bait ball ----------
  const shimmerTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    for (let i = 0; i < 120; i++) {
      g.fillStyle = `rgba(220,235,240,${0.2 + Math.random() * 0.5})`;
      const a = Math.random() * 6.28, d = Math.pow(Math.random(), 0.5) * 28;
      g.fillRect(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, 1.5, 1.5);
    }
    return new THREE.CanvasTexture(c);
  })();
  const shimmer = new THREE.Mesh(
    new THREE.CircleGeometry(9, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: shimmerTex, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  shimmer.visible = false;
  scene.add(shimmer);

  const terns = [];
  for (let i = 0; i < 6; i++) {
    const t = makeTern();
    t.visible = false;
    scene.add(t);
    terns.push({
      mesh: t, phase: rnd() * 6.28, r: 6 + rnd() * 6,
      diveT: 2 + rnd() * 6, diving: 0,
    });
  }

  // ---------- whale ----------
  const spout = new THREE.Sprite(new THREE.SpriteMaterial({
    map: shimmerTex, color: 0xeef4f8, transparent: true, opacity: 0,
    depthWrite: false,
  }));
  spout.visible = false;
  scene.add(spout);

  // ---------- moon jellies ----------
  const JELLIES = 9;
  const jellyMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.28, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5),
    new THREE.MeshBasicMaterial({
      color: 0x9fd8e8, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
    JELLIES,
  );
  jellyMesh.visible = false;
  scene.add(jellyMesh);
  let jelliesOut = false;
  const jellyCenter = { x: 0, z: 0 };

  const state = {
    active: null,           // 'baitball' | 'whale' | null
    t: 0,
    baitTimer: 380 + rnd() * 240,
    whaleTimer: 620 + rnd() * 300,
    showerArmed: rnd() < 0.35,   // some nights the sky decides
    showerDone: false,
    ballX: 0, ballZ: 0,
    _splashT: 0,
  };

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);

  state.update = (dt, camera, waterY, nightT) => {
    // ---------- timers (one wonder at a time) ----------
    if (!state.active) {
      if (nightT < 0.6) {
        state.baitTimer -= dt;
        state.whaleTimer -= dt;
        if (state.baitTimer <= 0) {
          state.active = 'baitball';
          state.t = 0;
          state.ballX = camera.position.x - 40 + rnd() * 80;
          state.ballZ = shorelineZ(state.ballX) - 55 - rnd() * 30;
          shimmer.position.set(state.ballX, waterY + 0.05, state.ballZ);
          shimmer.visible = true;
          for (const t of terns) t.mesh.visible = true;
        } else if (state.whaleTimer <= 0) {
          state.active = 'whale';
          state.t = 0;
          spout.position.set(camera.position.x - 150 + rnd() * 300, 2, -520);
          spout.scale.set(4, 6, 1);
          spout.visible = true;
        }
      }

      // Moon jellies strand once per deep night.
      if (nightT > 0.9 && !jelliesOut) {
        jelliesOut = true;
        jellyMesh.visible = true;
        jellyCenter.x = camera.position.x - 30 + rnd() * 60;
        for (let i = 0; i < JELLIES; i++) {
          const jx = jellyCenter.x - 25 + rnd() * 50;
          const jz = shorelineZ(jx) + 3 + rnd() * 2.5;
          p.set(jx, groundHeight(jx, jz), jz);
          s.setScalar(0.7 + rnd() * 0.9);
          q.setFromEuler(e.set(0, rnd() * 6.28, 0));
          jellyMesh.setMatrixAt(i, m.compose(p, q, s));
        }
        jellyMesh.instanceMatrix.needsUpdate = true;
        jellyCenter.z = shorelineZ(jellyCenter.x) + 4;
      }

      // The meteor shower arms once, some nights, and spends itself.
      if (nightT > 0.95 && state.showerArmed && !state.showerDone) {
        state.showerDone = true;
        skynight.meteorRate = 8;
        setTimeout(() => { skynight.meteorRate = 1; }, 180000);
      }
    } else if (state.active === 'baitball') {
      state.t += dt;
      const life = 90;
      const env = Math.min(1, state.t / 8) * Math.min(1, (life - state.t) / 8);
      shimmer.material.opacity = Math.max(0, env * (0.25 + Math.sin(state.t * 3) * 0.08));
      for (const tern of terns) {
        const a = state.t * 1.1 + tern.phase;
        let y = waterY + 6 + Math.sin(a * 0.7) * 2;
        if (tern.diving > 0) {
          tern.diving -= dt;
          const dp = 1 - tern.diving / 1.1;
          y = waterY + 6 - Math.sin(dp * Math.PI) * 6.2;
          if (dp > 0.45 && dp < 0.55 && audio) audio.splash(0.12);
        } else {
          tern.diveT -= dt;
          if (tern.diveT <= 0) { tern.diveT = 4 + rnd() * 8; tern.diving = 1.1; }
        }
        tern.mesh.position.set(
          state.ballX + Math.cos(a) * tern.r,
          y,
          state.ballZ + Math.sin(a) * tern.r,
        );
        tern.mesh.rotation.y = -a;
        const flap = Math.sin(state.t * 9 + tern.phase);
        tern.mesh.userData.wL.rotation.x = flap * 0.7;
        tern.mesh.userData.wR.rotation.x = -flap * 0.7;
        tern.mesh.visible = env > 0.05;
      }
      if (state.t >= life) {
        state.active = null;
        state.baitTimer = 600 + rnd() * 480;
        shimmer.visible = false;
        for (const t of terns) t.mesh.visible = false;
      }
    } else if (state.active === 'whale') {
      state.t += dt;
      const p8 = state.t / 8;
      spout.material.opacity = Math.sin(Math.min(1, p8) * Math.PI) * 0.5;
      spout.position.y = 2 + p8 * 6;
      spout.scale.set(4 + p8 * 5, 6 + p8 * 8, 1);
      // The sound arrives a second and a half after the sight — the sea is far.
      if (state.t >= 1.5 && !state._whooshed) {
        state._whooshed = true;
        if (audio) audio.splash(0.3);
      }
      if (journal) journal.glimpse('whale', spout.position, camera);
      if (state.t >= 8) {
        state.active = null;
        state._whooshed = false;
        state.whaleTimer = 900 + rnd() * 600;
        spout.visible = false;
      }
    }

    // Jellies glow only while it is properly dark, and fade for a fresh visit.
    if (jelliesOut) {
      jellyMesh.material.opacity = Math.max(0, (nightT - 0.55) / 0.45) * 0.5;
      if (journal && jellyMesh.material.opacity > 0.2) {
        p.set(jellyCenter.x, 0.3, jellyCenter.z);
        journal.focus('jelly', p, dt, camera);
      }
    }
  };

  return state;
}
