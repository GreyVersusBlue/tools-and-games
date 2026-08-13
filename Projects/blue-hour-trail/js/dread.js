import * as THREE from 'three';
import { groundHeight, trailInfo, trailPoint, LAYOUT } from './field.js';

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
//   • the fog line is where it gets WORSE, not better
//   • escalation follows progress up the trail, gently
//   • everything here is trying to LEAVE: the phantom steps descend — pitch
//     falling, panned toward the downhill side — and the shape between the
//     trees faces down the mountain, never up it (session 4)
//   • nothing here acknowledges being investigated (session 6): the shape and
//     the eyes go out in silence whether the walker looked away and looked
//     back, walked out to where they stood, or never noticed them at all. The
//     Gone Home doctrine's third rule — the game doesn't even confirm the
//     question was asked — and it used to be broken here by a single sting
//   • the director spends visual beats just outside the walker's recent gaze
//     (session 4): a yaw-dwell histogram with a ~45 s memory decides which
//     side of the camera a beat lands on, and a treeline the walker has been
//     staring at never fires at all. Half-glimpsed or nothing — a beat placed
//     where someone is already looking is a prop with a spawn animation.
//
// That fourth rule used to read the other way: "beats prefer the deep woods;
// above the fog line the mountain is honest." It made the summit a refuge, and
// a refuge is the wrong ending for a walk about wanting to leave somewhere. The
// gates that the deep woods used to be required for are now satisfied by
// altitude instead — high on the mountain the weather no longer has to
// cooperate for the woods to lie to you.
//
// Still true, and not negotiable: nothing here can hurt you. Nothing chases,
// nothing closes, nothing touches the walker. The lookout below is the furthest
// this piece goes, and it goes there by standing perfectly still.

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

// The figure on the lookout platform. Deliberately not anatomy: a head, a set
// of shoulders and a column, blurred until it is only a posture. Everything
// that would make it a character — a face, hands, a silhouette you could
// describe to someone — is left out, because the moment it becomes describable
// it becomes a monster, and a monster is a thing you can be finished with.
function lookoutTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 160;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 160);
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(32, 26, 11, 13, 0, 0, Math.PI * 2);            // head
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(14, 58); ctx.quadraticCurveTo(32, 44, 50, 58);  // shoulders
  ctx.lineTo(47, 150); ctx.lineTo(17, 150); ctx.closePath();
  ctx.fill();
  ctx.filter = 'blur(2.5px)';
  ctx.drawImage(c, 0, 0);
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

  // ---- the lookout ----
  //
  // The fire lookout is the only structure on this mountain that implies other
  // people: someone built it, someone was meant to sit in it and watch for
  // smoke. Somebody is in it. That is the whole of the reveal — the climb pays
  // off in the one currency this piece deals in, which is company you did not
  // want.
  //
  // It never moves from the platform. It never comes down. What it does is
  // turn: whichever way the walker goes, it is facing them, so looking away and
  // looking back does not clear it the way the shape in the trees clears. This
  // is the one thing on the mountain that does not deny itself.
  //
  // Except at the base of the tower, where it stops being visible from the
  // platform rail — not gone, just no longer where you can see it. Walking up
  // to a thing to get a better look and having it step out of view is worse
  // than either finding it or finding nothing, and it keeps the piece's own
  // rule intact: a figure you could finally resolve up close would just be a
  // prop.
  const lookoutMat = new THREE.MeshBasicMaterial({
    map: lookoutTexture(), color: 0x0b0f13,
    transparent: true, opacity: 0, alphaTest: 0.2,
    fog: true, side: THREE.DoubleSide, depthWrite: false,
  });
  const lookout = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 1.8), lookoutMat);
  lookout.visible = false;
  scene.add(lookout);
  {
    // At a corner of the platform, not in the middle of the near rail. The cab
    // is 2.6 m across and very nearly black, and a black figure standing in
    // front of it is a figure nobody will ever see — first attempt at this put
    // it on the near rail and it vanished into the tower's own silhouette. Out
    // at a corner (past the cab's half-width in both axes, inside the
    // platform's) it stands against fog instead, which is the only background
    // on this mountain that will hold it.
    const tw = LAYOUT.tower, be = LAYOUT.bench;
    const ax = be.x - tw.x, az = be.z - tw.z;
    const len = Math.hypot(ax, az) || 1;
    // The arithmetic that decides this: the cab is 2.6 m across (half-width
    // 1.3), the platform 3.4 (half-width 1.7), so the walkway around the cab is
    // 40 cm. A 0.78 m figure anywhere on the near rail is half-behind the cab
    // from the approach — measured, not guessed, after the first two placements
    // came back as a sliver. Pushing it out to the side rail past 1.3 + half a
    // body clears the cab laterally and puts fog behind it.
    const fx = ax / len, fz = az / len;          // toward the walker
    const px = -fz, pz = fx;                     // along the rail
    lookout.position.set(
      tw.x + fx * 0.2 + px * 1.95,
      groundHeight(tw.x, tw.z) + 9.08 + 0.9,     // platform deck, plus half a body
      tw.z + fz * 0.2 + pz * 1.95,
    );
  }

  const state = {
    birdsSilent: false,
    lookoutWatching: false,
    ghostRhythm: null,      // main.js wires the previous walk's gait in here
    headlampOn: false,      // main.js mirrors the lamp; beats prefer its edge

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
    _eyesDrift: null,
    _bearHeadDot: 0,

    _lookoutNoticed: false,
  };

  const camDir = new THREE.Vector3();
  const toShape = new THREE.Vector3();

  // ---- the attention director's memory ----
  //
  // 24 buckets of 15°, each holding roughly "seconds spent facing this way
  // lately". Decays with a ~45 s half-life-ish memory, so a long stare fades
  // rather than counting forever. Beats read it to land where the walker has
  // NOT been looking; nothing ever reads it to land where they have.
  const GAZE_N = 24;
  const gaze = new Float32Array(GAZE_N);
  const GAZE_DECAY = 45;      // seconds of memory
  const STARE = 4;            // accumulated seconds that mean "being watched"

  const yawOf = (dx, dz) => Math.atan2(-dx, -dz);   // the piece's facing convention
  const bucketOf = yaw => {
    const u = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.floor(u / (Math.PI * 2) * GAZE_N) % GAZE_N;
  };
  // Dwell at a world yaw, with half-weight neighbours so bucket edges don't
  // make a 15.1° miss read as unwatched.
  function dwellAt(yaw) {
    const b = bucketOf(yaw);
    return gaze[b]
      + 0.5 * gaze[(b + 1) % GAZE_N]
      + 0.5 * gaze[(b + GAZE_N - 1) % GAZE_N];
  }

  // Which way is off the mountain, from anywhere: the downhill direction of
  // the nearest trail point. The trail's own samples point uphill (trailhead
  // to summit), so downhill is their negation.
  function downhillAt(x, z) {
    const p = trailPoint(trailInfo(x, z).t);
    return { x: -p.dx, z: -p.dz };
  }

  function intensity(progressT, highT) {
    return Math.min(1, state._elapsed / 480) * 0.4 + progressT * 0.4 + highT * 0.2;
  }

  // Which beats are drawable from where the walker stands. Split out of
  // tryFire so the suite can hold the gates without waiting out a cooldown —
  // notably the one gate that changes the beats in KIND, not just rate: the
  // transmission only exists above the fog line.
  function candidatesFor(controls, fogT) {
    const pt = trailInfo(controls.pos.x, controls.pos.z);
    // How far into the bad air the walker is. The same 46→62 m band main.js
    // reads for the weather, so the moment the fog stops thinning is the moment
    // the woods stop pretending.
    const highT = Math.min(1, Math.max(0, (controls.pos.y - 46) / 16));
    const high = highT > 0.35;
    const candidates = [];

    if (state._lastBeat !== 'snap') candidates.push('snap', 'snap');
    if (state._lastBeat !== 'phantom' && controls.moving) candidates.push('phantom', 'phantom');
    if (state._lastBeat !== 'silence' && (fogT > 0.35 || high)) candidates.push('silence');
    if (state._lastBeat !== 'bear' && (fogT > 0.55 || high) && !state._bearActive) {
      candidates.push('bear', 'bear');
    }
    if (state._lastBeat !== 'eyes' && (fogT > 0.5 || high) && !state._eyesActive) {
      candidates.push('eyes', 'eyes');
    }
    if (state._lastBeat !== 'howl' && pt.t > 0.35) candidates.push('howl');
    // The dead radio, only within earshot of the cabin, and rare — a single
    // ticket in the draw. Every logbook radio check went out through a set
    // like that one; this is the other half of those conversations.
    const cabinD = Math.hypot(controls.pos.x - LAYOUT.cabin.x, controls.pos.z - LAYOUT.cabin.z);
    if (state._lastBeat !== 'radio' && cabinD < 28) candidates.push('radio');
    // Above the fog line the beats change in KIND, not just rate: the
    // transmission exists only up here, gated on altitude alone — no amount
    // of low-altitude fog can reach it. The keeper's set finds a carrier and
    // the mountain answers with your own static. Task 2 of the prompt file
    // wanted a summit-only beat for two sessions; this is it.
    if (state._lastBeat !== 'transmission' && highT > 0.7) candidates.push('transmission');

    return { candidates, pt, highT };
  }

  function tryFire(camera, controls, fogT) {
    const { candidates, pt, highT } = candidatesFor(controls, fogT);

    if (!candidates.length) { state._cooldown = 12; return; }
    const beat = candidates[(Math.random() * candidates.length) | 0];

    if (!runBeat(beat, camera, controls)) {
      // The director refused the placement — the walker is watching every arc
      // the beat could have used. Retry soon rather than burning the whole
      // cooldown on a beat that never happened.
      state._cooldown = 12;
      return;
    }
    const inten = intensity(pt.t, highT);
    state._cooldown = (55 + Math.random() * 45) * (1.2 - inten * 0.5) * (1 - highT * 0.3);
  }

  // Staging a beat is split from choosing one so a beat can be forced by name
  // without waiting out a 70-second cooldown and then losing the coin flip.
  // tryFire owns the rules; runBeat owns the staging. Both go through
  // _lastBeat, so a forced beat still can't repeat on the next natural fire.
  // Returns false when the director declines to stage it (currently only the
  // eyes, when every candidate arc has been stared at) — a declined beat sets
  // no _lastBeat and costs no cooldown.
  function runBeat(beat, camera, controls) {
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

      case 'radio': {
        // Panned toward wherever the cabin actually is, because a sound with
        // a source is deniable and a sound from nowhere is a jump scare.
        const dx = LAYOUT.cabin.x - controls.pos.x;
        const dz = LAYOUT.cabin.z - controls.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        const pan = (dx / len) * Math.cos(controls.yaw) - (dz / len) * Math.sin(controls.yaw);
        audio.radioSquelch({ pan: pan * 0.9 });
        break;
      }

      case 'transmission': {
        // The summit-only beat. The keeper's set in the cab opens a carrier —
        // the same empty hiss as the cabin radio — and then, seconds after it
        // shuts, the burst comes back fainter from nowhere in particular:
        // answered by nothing but your own delayed static. It confirms
        // nothing. Marsh's log line — "carrier and no voices, which could
        // mean weather and could mean the set" — is the whole spec.
        const dx = LAYOUT.tower.x - controls.pos.x;
        const dz = LAYOUT.tower.z - controls.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        const pan = (dx / len) * Math.cos(controls.yaw) - (dz / len) * Math.sin(controls.yaw);
        audio.radioSquelch({ pan: pan * 0.9, echoGain: 0.5 });
        break;
      }

      case 'bear': {
        // 45–65 m ahead, inside the view cone, facing the walker. It will be
        // gone before anyone gets an answer about it. The director only picks
        // which SIDE of the ahead-arc it stands in — the less-watched one —
        // because a shape up the trail has to be up the trail to be seen at
        // all; there is no off-gaze placement for a thing whose job is to be
        // half-noticed and then denied.
        camDir.set(-Math.sin(controls.yaw), 0, -Math.cos(controls.yaw));
        const dist = 45 + Math.random() * 20;
        const mag = 0.08 + Math.random() * 0.14;
        const pick = (s) => dwellAt(yawOf(
          camDir.x * dist - camDir.z * dist * mag * s,
          camDir.z * dist + camDir.x * dist * mag * s));
        const side = (pick(1) < pick(-1) ? 1 : -1) * mag;
        const x = camera.position.x + camDir.x * dist - camDir.z * dist * side;
        const z = camera.position.z + camDir.z * dist + camDir.x * dist * side;
        bear.position.set(x, groundHeight(x, z) + 1.1, z);
        bear.lookAt(camera.position.x, bear.position.y, camera.position.z);

        // The silhouette's head is on its local -x side. After lookAt, local
        // +x lies along up × (toward-camera); flip scale.x so the head end
        // points DOWNHILL — the shape is on its way off this mountain, like
        // everything else here except the walker and the thing at the top.
        const n = toShape.copy(camera.position).sub(bear.position).setY(0).normalize();
        const headWorld = { x: -n.z, z: n.x };            // local -x in world, unflipped
        const dh = downhillAt(x, z);
        const headDot = headWorld.x * dh.x + headWorld.z * dh.z;
        bear.scale.x = headDot >= 0 ? 1 : -1;
        // After the flip the head points |headDot| of the way downhill; the
        // suite asserts this never goes negative.
        state._bearHeadDot = Math.abs(headDot);
        // The head's actual world direction after the flip, and the way off
        // the mountain from where the shape stands, both handed to the suite
        // so the flip can be checked rather than taken on trust — the dot
        // above is an absolute value and would read fine with no flip at all.
        //
        // Session 6, walking DOWN: |headDot| can be ~0 and the check that
        // wanted it over 0.05 was only ever staged from a climbing facing.
        // That is geometry, not a fault. The head axis lies across the line of
        // sight, so when the walker is descending the fall line, downhill runs
        // AWAY from the camera and there is no profile left to point with. The
        // invariant that survives in every direction is this one: never up the
        // mountain.
        state._bearHead = { x: headWorld.x * bear.scale.x, z: headWorld.z * bear.scale.x };
        state._bearDownhill = dh;

        bear.visible = true;
        bearMat.opacity = 0.92;
        state._bearActive = true;
        state._bearLife = 40;
        state._bearSeen = false;
        state._bearAway = false;
        break;
      }

      case 'eyes': {
        camDir.set(-Math.sin(controls.yaw), 0, -Math.cos(controls.yaw));
        // low, off to one side, in the treeline — and the director picks the
        // side: whichever arc the walker has looked at least. If they have
        // been staring down BOTH arcs, nothing fires. A watched treeline
        // holds still.
        //
        // While the headlamp burns, the placement hugs the darkness just past
        // the cone's edge instead of the wide treeline: the cone is 24° to
        // its edge, and these ranges put the eyes 25-40° off-axis — one step
        // outside the light the walker chose to trust.
        const lampOn = !!state.headlampOn;
        const ahead = lampOn ? 14 + Math.random() * 8 : 12 + Math.random() * 10;
        const out = lampOn ? 8 + Math.random() * 6 : 14 + Math.random() * 12;
        const arcOf = s => yawOf(
          camDir.x * ahead - camDir.z * out * s,
          camDir.z * ahead + camDir.x * out * s);
        const dwellL = dwellAt(arcOf(-1)), dwellR = dwellAt(arcOf(1));
        if (Math.min(dwellL, dwellR) > STARE) return false;
        const side = dwellR < dwellL ? 1 : -1;
        const x = camera.position.x + camDir.x * ahead - camDir.z * out * side;
        const z = camera.position.z + camDir.z * ahead + camDir.x * out * side;
        eyes.position.set(x, groundHeight(x, z) + 0.5, z);
        eyes.visible = true;
        eyesMat.opacity = 0;
        state._eyesActive = true;
        state._eyesLife = 4.5 + Math.random() * 2.5;
        // They too are leaving, slowly — a drift you would have to time to
        // prove, pointed the only way anything here points.
        state._eyesDrift = downhillAt(x, z);
        break;
      }
    }
    state._lastBeat = beat;
    return true;
  }

  // For the regression suite and for tuning: the director's memory, the
  // shape's staging, and where the eyes stand. Nothing in the piece calls
  // these; _gaze is handed out live so a test can paint a stare into it
  // without waiting real minutes at software-GL frame rates.
  state._gaze = gaze;
  state.gazeInfo = () => ({ buckets: Array.from(gaze) });
  state.dwellAt = yaw => dwellAt(yaw);
  state.bucketOf = yaw => bucketOf(yaw);
  state.bearInfo = () => ({
    x: bear.position.x, z: bear.position.z, visible: bear.visible,
    flip: bear.scale.x, headDownhillDot: state._bearHeadDot,
    head: state._bearHead, downhill: state._bearDownhill,
  });
  state.eyesInfo = () => ({
    x: eyes.position.x, z: eyes.position.z, visible: eyes.visible,
    drift: state._eyesDrift,
  });
  state.candidates = (controls, fogT) => candidatesFor(controls, fogT).candidates;

  // For the regression suite and for tuning: where the figure is and whether it
  // is currently readable. Nothing in the piece calls this.
  state.lookoutInfo = () => ({
    x: lookout.position.x, y: lookout.position.y, z: lookout.position.z,
    visible: lookout.visible, opacity: lookoutMat.opacity,
    noticed: state._lookoutNoticed,
  });

  // For the regression suite and for tuning: stage a named beat now, bypassing
  // the cooldown and the fog/elevation gates that normally have to agree first.
  // Nothing in the piece calls this — the scheduler is the only thing that
  // fires beats in play.
  // Returns the beat name, or false when the director declined the staging —
  // the same refusal a natural fire gets, so the never-fires rule is testable.
  state.force = (beat, camera, controls) => {
    return runBeat(beat, camera, controls) ? beat : false;
  };

  state.update = (dt, camera, controls, fogT) => {
    if (!controls.enabled) return;
    state._elapsed += dt;

    // ---- the director watching the walker watch ----
    {
      const decay = Math.exp(-dt / GAZE_DECAY);
      for (let i = 0; i < GAZE_N; i++) gaze[i] *= decay;
      gaze[bucketOf(controls.yaw)] += dt;
    }

    // Track walking rhythm for the phantom steps.
    if (controls.moving) state._movingFor += dt;
    const justStopped = state._wasMoving && !controls.moving && state._movingFor > 3.5;
    if (!controls.moving) state._movingFor = 0;
    state._wasMoving = controls.moving;

    // ---- scheduler ----
    if (state._phantomArmed) {
      state._phantomWindow -= dt;
      if (justStopped) {
        // Panned toward the downhill side of wherever the walker stopped:
        // whoever these steps belong to, they are on their way DOWN.
        const dh = downhillAt(controls.pos.x, controls.pos.z);
        // right of the walker's facing (-sin, -cos) is (cos, -sin)
        const pan = Math.max(-1, Math.min(1,
          dh.x * Math.cos(controls.yaw) - dh.z * Math.sin(controls.yaw))) * 0.85;
        const count = 2 + (Math.random() * 2 | 0);
        // If a previous walk left a ghost (main.js assigns this), the steps
        // play in ITS rhythm near this stretch of trail — your own gait from
        // last time, going down. With no ghost the scheduler invents one,
        // exactly as before, and nothing anywhere tells the player which
        // kind they got.
        const intervals = state.ghostRhythm ? state.ghostRhythm(trailInfo(controls.pos.x, controls.pos.z).t) : null;
        audio.phantomSteps({ count, pan, ...(intervals ? { intervals } : {}) });
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
        // And nothing else happens. There used to be a lowSting on this line,
        // fired if the shape had been SEEN and its life had not yet run out —
        // which is to say fired if and only if the walker ran the experiment,
        // and never when they didn't. Both surviving ways out of that `gone`
        // are the experiment: looked away and looked back, or walked out to
        // where it stood.
        //
        // The Gone Home doctrine's third rule is written against that exact
        // sound: "there is nothing — and no sting, no cue, no sound of it
        // having left. The scheduler must never reward or punish
        // investigation. Unfalsifiable means the game doesn't even confirm the
        // question was asked." The doctrine postdates this code and wins every
        // tie, so the sound goes. Session 6 is where it got caught, walking
        // DOWN: descending you close on a shape staged 45-65 m ahead at a full
        // 2 m/s and the sting lands every single time.
      }
    }

    // ---- the lookout, once the walker is high enough to see it ----
    {
      const dx = lookout.position.x - controls.pos.x;
      const dz = lookout.position.z - controls.pos.z;
      const dist = Math.hypot(dx, dz);
      const highT = Math.min(1, Math.max(0, (controls.pos.y - 42) / 14));

      // Near the base it is no longer at the rail. Far off, the fog has it
      // anyway and drawing it is just a smudge with a draw call attached.
      //
      // The band is tight because the geography is: the tower stands 13 m past
      // the trail's end and the bench 3 m past it, so the walker's whole
      // relationship with this thing happens inside about 10 m, and at the
      // summit's fog density anything past ~50 m is gone regardless.
      const inRange = dist > 6.5 && dist < 70;
      const show = highT > 0.05 && inRange;

      lookout.visible = show;
      if (show) {
        // Yaw only — it turns to keep facing the walker, but it does not tilt,
        // lean, or track in pitch. A figure that pivots on the spot reads as
        // attention. A figure that tips its head reads as animation.
        lookout.rotation.set(0, Math.atan2(dx * -1, dz * -1), 0);

        // Never more than half-there. The fog does the rest, and between them
        // the figure stays at the exact threshold where a person would start
        // arguing with themselves about whether anything is there at all.
        const near = 1 - Math.min(1, Math.max(0, (dist - 10) / 45));
        const target = 0.5 * highT * (0.35 + near * 0.65);
        lookoutMat.opacity += (target - lookoutMat.opacity) * Math.min(1, dt * 1.6);

        // One sting, the first time it is genuinely in front of the walker.
        if (!state._lookoutNoticed && dist < 55) {
          camera.getWorldDirection(camDir);
          toShape.set(dx, 0, dz).normalize();
          if (camDir.x * toShape.x + camDir.z * toShape.z > 0.9) {
            state._lookoutNoticed = true;
            audio.lowSting();
          }
        }
      } else {
        lookoutMat.opacity = 0;
      }
      state.lookoutWatching = show;
    }

    // ---- the eyes, while they last ----
    if (state._eyesActive) {
      state._eyesLife -= dt;
      // Leaving, at a pace nobody could swear to: ~6 cm a second, downhill.
      if (state._eyesDrift) {
        eyes.position.x += state._eyesDrift.x * dt * 0.06;
        eyes.position.z += state._eyesDrift.z * dt * 0.06;
      }
      eyes.lookAt(camera.position);
      // fade in, hold with a blink, fade out
      const blink = Math.sin(state._elapsed * 0.9) > -0.93 ? 1 : 0.1;
      eyesMat.opacity = Math.min(0.5, eyesMat.opacity + dt * 0.4) * blink;
      const dist = Math.hypot(eyes.position.x - controls.pos.x, eyes.position.z - controls.pos.z);
      if (dist < 15 || state._eyesLife <= 0) {
        eyes.visible = false;
        state._eyesActive = false;
        // Same rule as the shape, and the same deletion: closing to 15 m is
        // the walker going to look, and the sting that used to fire here was
        // the piece admitting they had. They stop being there. That is all.
      }
    }
  };

  return state;
}
