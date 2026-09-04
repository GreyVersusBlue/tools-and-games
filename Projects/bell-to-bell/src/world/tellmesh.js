import * as THREE from '../three.js';

// What a tell looks like.
//
// Every tell used to be a 9cm box, or a sphere if it was a whisper. The room
// had one channel for saying anything — hold SHIFT and read the annotation —
// and the treatment's Tier 1 / Tier 2 split (§3.3) had nowhere to land: a
// phone under a desk is a Tier 2 reveal, but the phone itself is a physical
// object that exists whether or not anyone is looking with Withitness.
//
// So a tell mesh is two buckets:
//
//   world   the object. Always drawn, registered with the material registry,
//           dark and small and low so that noticing it from the front of the
//           room is possible and not easy. Withitness swaps it hot.
//   vision  what the vision infers and draws: the note's route line, the
//           thread between two papers, the shape of a conversation. Only
//           visible in Withitness, deliberately unregistered.
//
// A tell type names its shape in data/tells.json (`mesh`), so a new type picks
// an existing shape without a JavaScript edit. `phantom: true` puts the object
// in the vision bucket instead — which is what a hypervigilance false positive
// is: the vision drawing something that is not there.

const VISION = {
  route:  0xFF7A18,
  thread: 0xFF7A18,
  murmur: 0xFF9C4A
};

const line = (points, color, opacity = 1) => new THREE.Line(
  new THREE.BufferGeometry().setFromPoints(points),
  new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity })
);

// A phone flat on one thigh, tilted a few degrees toward its owner. 6.8cm by
// 13.5cm, which is a phone.
function phone(mats) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.008, 0.135), mats.case);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.056, 0.115), mats.screen);
  screen.rotation.x = -Math.PI / 2;
  screen.position.y = 0.0046;
  g.add(body, screen);
  g.rotation.x = -0.34;      // resting on a leg, not on a table
  g.rotation.y = 0.18;
  return { meshes: [body, screen], group: g };
}

// Folded once, which is what makes it a note and not a worksheet. Two quads
// meeting along the fold, so it reads as an object with a crease from any
// angle rather than as a card that vanishes edge-on.
function note(mats) {
  const g = new THREE.Group();
  const meshes = [];
  for (const sign of [-1, 1]) {
    const half = new THREE.Mesh(new THREE.PlaneGeometry(0.078, 0.052), mats.paper);
    half.rotation.x = -Math.PI / 2 + sign * 0.42;
    half.position.z = sign * 0.024;
    half.position.y = -Math.abs(Math.sin(0.42)) * 0.026;
    g.add(half); meshes.push(half);
  }
  g.rotation.y = 0.6;
  return { meshes, group: g };
}

// Two sheets on two desks, each angled at the other one. The tell is not the
// paper, it is the angle: an answer sheet turned twenty degrees toward the
// next desk is the whole of what a proctor is looking for.
function papers(mats, { a, b, origin }) {
  const g = new THREE.Group();
  const meshes = [];
  const pair = [[a, b], [b, a]];
  for (const [self, other] of pair) {
    if (!self) continue;
    const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.0015, 0.28), mats.paper);
    sheet.position.set(self.x - origin.x, 0.752 - origin.y, (self.z + 0.06) - origin.z);
    if (other) sheet.rotation.y = Math.atan2(other.x - self.x, other.z - self.z) * 0.34;
    g.add(sheet); meshes.push(sheet);
  }
  return { meshes, group: g };
}

// ---------------------------------------------------------------------------
// The vision's drawings.
// ---------------------------------------------------------------------------

// The route: where the note is going, before it does.
function routeLine(a, b, origin) {
  const l = line([
    new THREE.Vector3(a.x, 0.8, a.bodyZ),
    new THREE.Vector3((a.x + b.x) / 2, 1.0, (a.bodyZ + b.bodyZ) / 2),
    new THREE.Vector3(b.x, 0.8, b.bodyZ)
  ], VISION.route, 0.75);
  l.position.sub(origin);
  return l;
}

// The thread: two papers, one order of answers.
function threadLine(a, b, origin) {
  const l = line([new THREE.Vector3(a.x, 0.76, a.z), new THREE.Vector3(b.x, 0.76, b.z)], VISION.thread);
  l.position.sub(origin);
  return l;
}

// A conversation, drawn as what it does to the air between two heads. Three
// arcs on the axis between them, so it reads as directional — you can see
// which way it is running — where the old sphere read as a marker.
function murmurArcs(a, b, origin) {
  const g = new THREE.Group();
  const mid = new THREE.Vector3((a.x + b.x) / 2, 1.15, (a.bodyZ + b.bodyZ) / 2);
  const axis = Math.atan2(b.x - a.x, b.bodyZ - a.bodyZ);
  for (let i = 0; i < 3; i++) {
    const r = 0.055 + i * 0.045;
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.004, 6, 18, Math.PI * 0.9),
      new THREE.MeshBasicMaterial({ color: VISION.murmur, transparent: true, opacity: 0.8 - i * 0.2 })
    );
    arc.rotation.y = axis;
    arc.rotation.z = -Math.PI * 0.45;
    g.add(arc);
  }
  g.position.copy(mid).sub(origin);
  return g;
}

// A whisper has no object: it is sound and a posture, and Phase 7's whole
// claim about it is that you hear it before you see anything.
const SHAPES = { phone, note, paper: papers, murmur: () => ({ meshes: [], group: new THREE.Group() }) };

// The names data/tells.json may use for `mesh`. Exported so the suite can
// catch a typo, which the fallback below would otherwise render as a phone.
export const TELL_SHAPES = Object.keys(SHAPES);

// Build one tell's meshes. `register` is the material registry's add, so the
// world bucket swaps into thermal view with everything else in the room; the
// vision bucket never goes through it.
export function createTellMeshBuilder({ mats, register }) {
  return function buildTellMesh(t, def, { a, b }) {
    const grp = new THREE.Group();
    grp.position.copy(t.pos);

    const shape = SHAPES[def.mesh] || SHAPES.phone;
    const built = shape(mats, { a, b, origin: t.pos });
    const bucket = def.phantom ? 'vision' : 'world';
    grp.add(built.group);

    const vision = new THREE.Group();
    if (def.mesh === 'note' && b) vision.add(routeLine(a, b, t.pos));
    if (def.mesh === 'paper' && b) vision.add(threadLine(a, b, t.pos));
    if (def.mesh === 'murmur' && b) vision.add(murmurArcs(a, b, t.pos));
    grp.add(vision);

    // A phantom's "object" is a drawing too, so it hides and shows with the
    // rest of the vision rather than sitting in the room being real.
    if (bucket === 'vision') built.group.visible = false;
    else for (const m of built.meshes) register(m);

    vision.visible = false;
    grp.userData.vision = bucket === 'vision' ? [vision, built.group] : [vision];
    return grp;
  };
}

// Only the vision bucket toggles. The objects stay in the room.
export function setTellVision(obj, on) {
  for (const g of obj?.userData?.vision || []) g.visible = on;
}
