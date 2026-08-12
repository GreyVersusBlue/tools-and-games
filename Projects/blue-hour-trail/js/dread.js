import * as THREE from 'three';
import { groundHeight, trailInfo } from './field.js';

// The other thing in the woods. A scheduler of directed beats, none of which
// can hurt the walker and none of which ever resolves: a branch breaking off
// to one side, footsteps that continue a half-second after yours stop, the
// birds all going quiet at once, eyes low between the trees, and a dark shape
// up the trail that is not there when you look twice.
//
// Rules the scheduler enforces so this stays dread and not a haunted house:
//   • long cooldowns, first beat only after the woods have felt normal
//   • never the same beat twice running
//   • the visual beats only fire when the fog is thick enough to half-take
//     them back — a monster you can see clearly is just a prop
//   • beats prefer the deep woods; above the fog line the mountain is honest
//   • escalation follows progress up the trail, gently

function bearTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 160);
  ctx.fillStyle = '#000';
  // a heavy quadruped in profile, more suggestion than anatomy
  ctx.beginPath();
  ctx.ellipse(128, 84, 74, 40, -0.06, 0, Math.PI * 2);   // bulk
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(96, 58, 40, 30, 0.3, 0, Math.PI * 2);      // shoulder hump
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(48, 66, 24, 18, 0.15, 0, Math.PI * 2);     // head, low
  ctx.fill();
  for (const [x, w] of [[74, 15], [108, 16], [158, 15], [188, 16]]) {
    ctx.fillRect(x, 100, w, 52);                          // legs
  }
  // soften the whole silhouette — fog does the rest
  ctx.filter = 'blur(3px)';
  ctx.drawImage(c, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

function eyesTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 32;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 32);
  for (const x of [18, 46]) {
    const g = ctx.createRadialGradient(x, 16, 0, x, 16, 7);
    g.addColorStop(0, 'rgba(215,225,190,0.95)');
    g.addColorStop(0.4, 'rgba(190,205,160,0.5)');
    g.addColorStop(1, 'rgba(180,200,150,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, 16, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}

export function createDread(scene, audio) {
  // ---- the shape ----
  const bearMat = new THREE.MeshBasicMaterial({
    map: bearTexture(), color: 0x0e1317,
    transparent: true, opacity: 0.92, alphaTest: 0.25,
    fog: true, side: THREE.DoubleSide, depthWrite: false,
  });
  const bear = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 2.4), bearMat);
  bear.visible = false;
  scene.add(bear);

  // ---- the eyes ----
  const eyesMat = new THREE.MeshBasicMaterial({
    map: eyesTexture(), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const eyes = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.27), eyesMat);
  eyes.visible = false;
  scene.add(eyes);

  const state = {
    birdsSilent: false,

    _elapsed: 0,
    _cooldown: 70,          // the woods get to feel normal first
    _lastBeat: null,
    _movingFor: 0,
    _wasMoving: false,

    _phantomArmed: false,
    _phantomWindow: 0,

    _silenceLeft: 0,

    _bearActive: false,
    _bearLife: 0,
    _bearSeen: false,
    _bearAway: false,

    _eyesActive: false,
    _eyesLife: 0,
  };

  const camDir = new THREE.Vector3();
  const toShape = new THREE.Vector3();

  function intensity(progressT) {
    return Math.min(1, state._elapsed / 480) * 0.5 + progressT * 0.5;
  }

  function tryFire(camera, controls, fogT) {
    const pt = trailInfo(controls.pos.x, controls.pos.z);
    const deepWoods = controls.pos.y < 48;    // above the fog line, honesty
    const candidates = [];

    if (state._lastBeat !== 'snap') candidates.push('snap', 'snap');
    if (state._lastBeat !== 'phantom' && controls.moving) candidates.push('phantom', 'phantom');
    if (state._lastBeat !== 'silence' && fogT > 0.35 && deepWoods) candidates.push('silence');
    if (state._lastBeat !== 'bear' && fogT > 0.55 && deepWoods && !state._bearActive) {
      candidates.push('bear', 'bear');
    }
    if (state._lastBeat !== 'eyes' && fogT > 0.5 && deepWoods && !state._eyesActive) {
      candidates.push('eyes', 'eyes');
    }
    if (state._lastBeat !== 'howl' && pt.t > 0.35) candidates.push('howl');

    if (!candidates.length) { state._cooldown = 12; return; }
    const beat = candidates[(Math.random() * candidates.length) | 0];
    const inten = intensity(pt.t);
    state._cooldown = (55 + Math.random() * 45) * (1.2 - inten * 0.5);

    runBeat(beat, camera, controls);
  }

  // Staging a beat is split from choosing one so a beat can be forced by name
  // without waiting out a 70-second cooldown and then losing the coin flip.
  // tryFire owns the rules; runBeat owns the staging. Both go through
  // _lastBeat, so a forced beat still can't repeat on the next natural fire.
  function runBeat(beat, camera, controls) {
    state._lastBeat = beat;
    switch (beat) {
      case 'snap':
        audio.branchSnap();
        break;

      case 'phantom':
        // armed, not fired: it lands the moment the walker's own steps stop.
        state._phantomArmed = true;
        state._phantomWindow = 25;
        break;

      case 'silence':
        state.birdsSilent = true;
        state._silenceLeft = 22 + Math.random() * 10;
        break;

      case 'howl':
        audio.wolfHowl();
        break;

      case 'bear': {
        // 45–65 m ahead, inside the view cone, facing the walker. It will be
        // gone before anyone gets an answer about it.
        camera.getWorldDirection(camDir);
        camDir.y = 0; camDir.normalize();
        const dist = 45 + Math.random() * 20;
        const side = (Math.random() - 0.5) * 0.35;
        const x = camera.position.x + camDir.x * dist - camDir.z * dist * side;
        const z = camera.position.z + camDir.z * dist + camDir.x * dist * side;
        bear.position.set(x, groundHeight(x, z) + 1.1, z);
        bear.lookAt(camera.position.x, bear.position.y, camera.position.z);
        bear.visible = true;
        bearMat.opacity = 0.92;
        state._bearActive = true;
        state._bearLife = 40;
        state._bearSeen = false;
        state._bearAway = false;
        break;
      }

      case 'eyes': {
        camera.getWorldDirection(camDir);
        camDir.y = 0; camDir.normalize();
        // low, off to one side, in the treeline
        const side = Math.random() < 0.5 ? -1 : 1;
        const ahead = 12 + Math.random() * 10;
        const out = 14 + Math.random() * 12;
        const x = camera.position.x + camDir.x * ahead - camDir.z * out * side;
        const z = camera.position.z + camDir.z * ahead + camDir.x * out * side;
        eyes.position.set(x, groundHeight(x, z) + 0.5, z);
        eyes.visible = true;
        eyesMat.opacity = 0;
        state._eyesActive = true;
        state._eyesLife = 4.5 + Math.random() * 2.5;
        break;
      }
    }
  }

  // For the regression suite and for tuning: stage a named beat now, bypassing
  // the cooldown and the fog/elevation gates that normally have to agree first.
  // Nothing in the piece calls this — the scheduler is the only thing that
  // fires beats in play.
  state.force = (beat, camera, controls) => {
    runBeat(beat, camera, controls);
    return beat;
  };

  state.update = (dt, camera, controls, fogT) => {
    if (!controls.enabled) return;
    state._elapsed += dt;

    // Track walking rhythm for the phantom steps.
    if (controls.moving) state._movingFor += dt;
    const justStopped = state._wasMoving && !controls.moving && state._movingFor > 3.5;
    if (!controls.moving) state._movingFor = 0;
    state._wasMoving = controls.moving;

    // ---- scheduler ----
    if (state._phantomArmed) {
      state._phantomWindow -= dt;
      if (justStopped) {
        audio.phantomSteps(2 + (Math.random() * 2 | 0));
        state._phantomArmed = false;
      } else if (state._phantomWindow <= 0) {
        state._phantomArmed = false;     // never stopped walking; let it go
      }
    } else {
      state._cooldown -= dt;
      if (state._cooldown <= 0) tryFire(camera, controls, fogT);
    }

    // ---- silence running its course ----
    if (state.birdsSilent) {
      state._silenceLeft -= dt;
      if (state._silenceLeft <= 0) {
        state.birdsSilent = false;
        audio.crowCaw();                 // the woods exhale
      }
    }

    // ---- the shape, while it lasts ----
    if (state._bearActive) {
      state._bearLife -= dt;
      camera.getWorldDirection(camDir);
      toShape.copy(bear.position).sub(camera.position);
      const dist = toShape.length();
      toShape.normalize();
      const dot = camDir.dot(toShape);

      if (dot > 0.86) state._bearSeen = true;
      if (state._bearSeen && dot < 0.4) state._bearAway = true;

      const gone =
        (state._bearAway && dot > 0.86) ||   // looked back: nothing there
        dist < 32 ||                          // walked toward it: never was
        state._bearLife <= 0;
      if (gone) {
        bear.visible = false;
        state._bearActive = false;
        if (state._bearSeen && state._bearLife > 0) audio.lowSting();
      }
    }

    // ---- the eyes, while they last ----
    if (state._eyesActive) {
      state._eyesLife -= dt;
      eyes.lookAt(camera.position);
      // fade in, hold with a blink, fade out
      const blink = Math.sin(state._elapsed * 0.9) > -0.93 ? 1 : 0.1;
      eyesMat.opacity = Math.min(0.5, eyesMat.opacity + dt * 0.4) * blink;
      const dist = Math.hypot(eyes.position.x - controls.pos.x, eyes.position.z - controls.pos.z);
      if (dist < 15 || state._eyesLife <= 0) {
        eyes.visible = false;
        state._eyesActive = false;
        if (dist < 15) audio.lowSting();
      }
    }
  };

  return state;
}
