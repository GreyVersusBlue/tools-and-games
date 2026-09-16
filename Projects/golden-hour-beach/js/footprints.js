import * as THREE from 'three';
import { groundHeight, sandAt, waterLineZ } from './field.js';

// Shallow dark ovals dropped one per footstep, only on wet sand, fading over a
// minute. The piece's most obvious missing pleasure and one of the cheapest:
// audio.js already counts footsteps for its own sound, so this just listens in
// on that instead of keeping a second phase counter.
//
// A ring buffer of a fixed size, InstancedMesh, one draw call — same reasoning
// as the wrack line in props.js. "Fading" is done by shrinking the instance's
// scale to nothing rather than a per-instance alpha: InstancedMesh has no alpha
// channel of its own, and a shallow oval that shrinks away reads the same as one
// fading, for none of the shader work a real per-instance alpha would need.

const MAX = 220;
const FADE_SECONDS = 60;

// How much faster a print goes once the water is over it. Twenty times, so a
// minute's fade becomes three seconds: the run-up reaches it, the sand loosens,
// it is gone before the same wave has finished retreating.
const WASH_RATE = 20;

// Where a print may be left used to be a pair of fixed z values, -9 to 2, which
// was the home beach's wet strip written down. Two things were wrong with it
// and the tide made both visible: it is the shoreline curve that moves the
// strip along the coast, so nobody had ever left a footprint on the headland
// shelf or at the river mouth 1.6 km away; and the strip itself moves with the
// water now. field.js's sandAt answers both — 'wet' is the band the sea has
// lately been over, wherever that is this minute.

function footGeometry() {
  const geo = new THREE.CircleGeometry(1, 10);
  geo.scale(0.10, 0.22, 1);   // oval, long axis will run fore-aft after rotateX
  geo.rotateX(-Math.PI / 2);  // lie flat; local +Z is now the long axis
  return geo;
}

export function buildFootprints(scene) {
  // Material colour is white and the real colour lives per-instance, so night
  // prints can glow teal (bioluminescent sand, matching the foam in ocean.js)
  // while old daytime prints stay dark. instanceColor is the one per-instance
  // channel InstancedMesh does have — the alpha it doesn't have is still
  // handled by the scale fade.
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(footGeometry(), mat, MAX);
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const dayCol = new THREE.Color(0x2c1d12);
  const bioCol = new THREE.Color(0x59e8e0);
  const tmpCol = new THREE.Color();
  for (let i = 0; i < MAX; i++) mesh.setColorAt(i, dayCol);
  scene.add(mesh);
  let nightBio = 0;

  const age = new Float32Array(MAX).fill(Infinity);
  const px = new Float32Array(MAX), py = new Float32Array(MAX), pz = new Float32Array(MAX);
  const yawOf = new Float32Array(MAX);
  let next = 0, filled = 0;

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3();
  // Two levels, two questions: tideY says whether this is wet sand, waterY
  // says whether the sea is over it this second. See field.js's sandAt.
  let waterY = 0, tideY = 0;

  function place(i, scale) {
    pos.set(px[i], py[i], pz[i]);
    e.set(0, yawOf[i], 0);
    q.setFromEuler(e);
    scl.setScalar(scale);
    mesh.setMatrixAt(i, m.compose(pos, q, scl));
  }

  return {
    mesh,

    // 0..1 from the palette keyframes (main.js) — how bioluminescent the wet
    // sand is right now. Only affects prints made from here on; the old ones
    // keep the colour they were stamped with, which is what a real glow decays
    // to anyway.
    setNight(bio) { nightBio = bio; },

    // x, z: world position. yaw: facing direction, same convention as
    // WalkControls.yaw, so a print's long axis lines up with the way it was
    // walked rather than always pointing the same way.
    step(x, z, yaw) {
      if (sandAt(x, z, tideY) !== 'wet') return;
      const slot = next;
      next = (next + 1) % MAX;
      filled = Math.min(MAX, filled + 1);
      mesh.count = filled;
      age[slot] = 0;
      px[slot] = x; py[slot] = groundHeight(x, z) + 0.006; pz[slot] = z; yawOf[slot] = yaw;
      place(slot, 1);
      mesh.setColorAt(slot, tmpCol.copy(dayCol).lerp(bioCol, nightBio));
      mesh.instanceColor.needsUpdate = true;
      mesh.instanceMatrix.needsUpdate = true;
    },

    // level: the water plane's y this frame. tide: sea level with the wave
    // taken out. A print the sea has come back over does not fade, it goes —
    // which is what makes the returning tide something a walker can watch
    // happen to their own tracks.
    update(dt, level = waterY, tide = tideY) {
      waterY = level; tideY = tide;
      if (!filled) return;
      let changed = false;
      for (let i = 0; i < filled; i++) {
        if (age[i] === Infinity) continue;
        age[i] += dt * (pz[i] < waterLineZ(px[i], waterY) ? WASH_RATE : 1);
        const t = age[i] / FADE_SECONDS;
        if (t >= 1) { age[i] = Infinity; place(i, 0); changed = true; continue; }
        place(i, 1 - t);
        changed = true;
      }
      if (changed) mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
