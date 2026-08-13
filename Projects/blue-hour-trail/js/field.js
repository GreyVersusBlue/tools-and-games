// The mountain as numbers: the heightfield, the trail, the creek, and the fixed
// layout of everything standing between the trees. No three.js import, on
// purpose — this file is the half of the world that can be checked without a
// browser, and `test/smoke.mjs` imports it directly. terrain.js, forest.js,
// props.js and controls.js all read the ground from here.
//
// Coordinate convention:
//   +Z = downhill, toward the trailhead (z = 145). -Z = up the mountain.
//   The summit sits around z = -100 at y ≈ 65. X is across the slope.

/* --------------------------------------------------------------------- noise */

// Tiny deterministic value noise. Same input, same mountain, every visit.
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function smooth(t) { return t * t * (3 - 2 * t); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash(xi, yi), b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y) {
  let sum = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 4; i++) {
    sum += amp * vnoise(x * f, y * f);
    amp *= 0.5; f *= 2.1;
  }
  return sum;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** Seeded PRNG — the same argument Golden Hour's field.js makes: a wood that
 *  reshuffles every visit is one you can never get to know, and a fixed layout
 *  is one a test can make claims about. */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* --------------------------------------------------------------------- trail */

/** Where the walker is allowed. The trail's own switchbacks stay well inside. */
export const BOUNDS = { minX: -130, maxX: 130, minZ: -120, maxZ: 150 };

// Hand-laid switchback turns, trailhead first. z strictly decreasing: every
// leg still gains ground even while x swings the full width of the slope.
const TRAIL_CTRL = [
  [0, 145], [-52, 114], [68, 80], [-78, 44],
  [82, 8], [-72, -30], [45, -66], [-5, -100],
];

const SUMMIT_Y = 65;

/**
 * Trail elevation is analytic in normalized arc length, not sampled from the
 * heightfield and smoothed after. Near-linear with eased ends: the grade works
 * out to ≈ 7.5% average and stays under 8% everywhere, walkable by
 * construction, and the smoke test can assert that instead of hoping.
 */
function trailYof(t) {
  return SUMMIT_Y * (t * t * (3 - 2 * t) * 0.15 + t * 0.85);
}

// Uniform Catmull-Rom through the control turns, endpoints doubled.
function catmull(p0, p1, p2, p3, u) {
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * ((2 * p1) + (-p0 + p2) * u
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

function buildTrail() {
  const C = TRAIL_CTRL;
  const raw = [];
  for (let seg = 0; seg < C.length - 1; seg++) {
    const a = C[Math.max(0, seg - 1)], b = C[seg];
    const c = C[seg + 1], d = C[Math.min(C.length - 1, seg + 2)];
    const steps = 200;
    for (let i = (seg === 0 ? 0 : 1); i <= steps; i++) {
      const u = i / steps;
      raw.push([catmull(a[0], b[0], c[0], d[0], u), catmull(a[1], b[1], c[1], d[1], u)]);
    }
  }
  // Cumulative arc length, then resample uniform in s — grade claims below
  // only mean anything if consecutive samples are the same distance apart.
  const cum = [0];
  for (let i = 1; i < raw.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  const N = 600;
  const points = [];
  let j = 0;
  for (let i = 0; i < N; i++) {
    const s = (i / (N - 1)) * total;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const span = cum[j + 1] - cum[j] || 1;
    const f = (s - cum[j]) / span;
    const x = lerp(raw[j][0], raw[j + 1][0], f);
    const z = lerp(raw[j][1], raw[j + 1][1], f);
    const t = i / (N - 1);
    points.push({ x, z, y: trailYof(t), t, s });
  }
  // Unit direction per sample, from neighbours.
  for (let i = 0; i < N; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(N - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    points[i].dx = dx / len;
    points[i].dz = dz / len;
  }
  return { points, length: total };
}

export const TRAIL = buildTrail();

/** Interpolated point on the centerline at normalized arc length t ∈ [0,1]. */
export function trailPoint(t) {
  const pts = TRAIL.points;
  const f = clamp(t, 0, 1) * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  const u = f - i;
  const a = pts[i], b = pts[i + 1];
  return {
    x: lerp(a.x, b.x, u), z: lerp(a.z, b.z, u), y: lerp(a.y, b.y, u),
    t: lerp(a.t, b.t, u), dx: lerp(a.dx, b.dx, u), dz: lerp(a.dz, b.dz, u),
  };
}

/**
 * Nearest point on the trail. Coarse scan (stride 4) then exact refine and a
 * projection onto the two segments either side of the winner, so the distance
 * field is smooth rather than scalloped at sample resolution. Two switchback
 * legs never come within blending range of each other (adjacent legs sit
 * ~35 m apart), so nearest-leg is unambiguous everywhere it matters.
 */
export function trailInfo(x, z) {
  const pts = TRAIL.points;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < pts.length; i += 4) {
    const dx = pts[i].x - x, dz = pts[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  const lo = Math.max(0, best - 5), hi = Math.min(pts.length - 1, best + 5);
  for (let i = lo; i <= hi; i++) {
    const dx = pts[i].x - x, dz = pts[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  // Project onto the segments flanking the best sample.
  let outD = Math.sqrt(bestD), outT = pts[best].t, outY = pts[best].y;
  for (const i of [best - 1, best]) {
    if (i < 0 || i + 1 >= pts.length) continue;
    const a = pts[i], b = pts[i + 1];
    const abx = b.x - a.x, abz = b.z - a.z;
    const len2 = abx * abx + abz * abz || 1;
    const u = clamp(((x - a.x) * abx + (z - a.z) * abz) / len2, 0, 1);
    const px = a.x + abx * u, pz = a.z + abz * u;
    const d = Math.hypot(x - px, z - pz);
    if (d < outD) {
      outD = d;
      outT = lerp(a.t, b.t, u);
      outY = lerp(a.y, b.y, u);
    }
  }
  return { dist: outD, t: outT, y: outY };
}

/* --------------------------------------------------------------------- creek */

// A short mountain stream in the trailhead basin: it rises at a rocky step
// (the waterfall) just up-slope of the trail's first leg, crosses under the
// footbridge, and runs off the map edge behind the trailhead. Deliberately
// confined to z > CREEK.headZ so only that first leg ever meets it — a longer
// creek would be re-crossed by every switchback and want a bridge each time.
export const CREEK = { headZ: 118, endZ: 152, halfWidth: 3.2, depth: 1.2 };

export function creekX(z) { return -30 + Math.sin(z * 0.05) * 14; }

export function creekInfo(x, z) {
  if (z < CREEK.headZ - 2 || z > CREEK.endZ) return { dist: Infinity, inBed: false };
  const zc = clamp(z, CREEK.headZ, CREEK.endZ);
  const dist = Math.hypot(x - creekX(zc), z - zc);
  return { dist, inBed: dist < CREEK.halfWidth };
}

// The creek cuts through the FINAL ground — trail bench included — so the bed
// under the bridge sits a fixed ~1.2 m below the deck instead of chasing
// whatever the raw hillside happens to be there. Water erodes trails; more to
// the point, a deck defined off trailY can then always clear the water.
function creekCarve(x, z) {
  const c = creekInfo(x, z);
  if (!isFinite(c.dist)) return 0;
  return CREEK.depth * (1 - smooth(clamp(c.dist / CREEK.halfWidth, 0, 1)));
}

// Rock step the creek pours over, just up-slope of its head. Adds height to
// the hillside for z < headZ so the fall has a face.
const STEP_H = 7;
function rockStep(x, z) {
  if (z > CREEK.headZ + 2) return 0;
  const rise = smooth(clamp((CREEK.headZ - z) / 6, 0, 1));
  const across = 1 - smooth(clamp((Math.abs(x - creekX(CREEK.headZ)) - 6) / 14, 0, 1));
  return STEP_H * rise * across;
}

/* --------------------------------------------------------------- heightfield */

/** The raw hillside, before the trail is benched in or the creek cut. */
export function mountainH(x, z) {
  let h = SUMMIT_Y * (145 - z) / 265;                       // the climb itself
  h += fbm(x * 0.018 + 7.3, z * 0.021) * 11 - 5.5;          // ridges and gullies
  h += fbm(x * 0.09, z * 0.09) * 1.6 - 0.8;                 // small roughness
  h += rockStep(x, z);
  return h;
}

/** 0 off-trail → 1 on the packed dirt. Also drives the ground shader blend. */
export function trailBlend(x, z) {
  const { dist } = trailInfo(x, z);
  const w = 1.6, shoulder = 4.5;
  return 1 - smooth(clamp((dist - w) / (shoulder - w), 0, 1));
}

/**
 * The ground everything stands on: hillside, with the trail benched in (cut
 * and fill against the slope, blended over a 4.5 m shoulder) and the creek
 * carved out last.
 */
export function groundHeight(x, z) {
  const ti = trailInfo(x, z);
  const w = 1.6, shoulder = 4.5;
  const k = 1 - smooth(clamp((ti.dist - w) / (shoulder - w), 0, 1));
  const h = lerp(mountainH(x, z), ti.y + 0.03, k);
  return h - creekCarve(x, z);
}

/* -------------------------------------------------------------------- bridge */

// The footbridge sits where the trail's first leg meets the creek — solved
// from the two polylines at load rather than hand-placed, so redrawing either
// one moves the bridge with it.
function findBridge() {
  const pts = TRAIL.points;
  let best = null, bestD = Infinity;
  for (const p of pts) {
    if (p.z < CREEK.headZ + 3 || p.z > CREEK.endZ) continue;
    const d = Math.abs(p.x - creekX(p.z));
    if (d < bestD) { bestD = d; best = p; }
  }
  const len = 7, width = 2.4;
  return {
    x: best.x, z: best.z, t: best.t,
    deckY: best.y + 0.05,
    yaw: Math.atan2(best.dx, best.dz),
    dx: best.dx, dz: best.dz,
    len, width,
  };
}

function inBridgeRect(bridge, x, z, margin = 0) {
  const rx = x - bridge.x, rz = z - bridge.z;
  const along = rx * bridge.dx + rz * bridge.dz;
  const across = rx * -bridge.dz + rz * bridge.dx;
  return Math.abs(along) < bridge.len / 2 + margin
      && Math.abs(across) < bridge.width / 2 + margin;
}

/* ------------------------------------------------------------------ walking */

/**
 * The height the walker stands at: the ground, except on the footbridge where
 * the deck carries them over the creek cut. controls.js reads this, not
 * groundHeight, so the bridge is walkable without props.js knowing anything
 * about movement.
 */
export function walkHeight(x, z) {
  if (inBridgeRect(LAYOUT.bridge, x, z, 0.3)) {
    return Math.max(groundHeight(x, z), LAYOUT.bridge.deckY);
  }
  return groundHeight(x, z);
}

/**
 * Whether a walker can stand here. A gradient limit rather than fences: the
 * mountainside guides with steepness, so the bound feels like terrain instead
 * of a wall. The creek banks fall inside the limit — wading is allowed, and
 * surfaceAt reports it so the footsteps can splash.
 */
export function walkable(x, z) {
  if (x < BOUNDS.minX || x > BOUNDS.maxX || z < BOUNDS.minZ || z > BOUNDS.maxZ) return false;
  if (inBridgeRect(LAYOUT.bridge, x, z, 0.3)) return true;
  const e = 0.5;
  const gx = (groundHeight(x + e, z) - groundHeight(x - e, z)) / (2 * e);
  const gz = (groundHeight(x, z + e) - groundHeight(x, z - e)) / (2 * e);
  return Math.hypot(gx, gz) < 0.85;
}

/** What is underfoot — drives footstep timbre and splash. */
export function surfaceAt(x, z) {
  if (inBridgeRect(LAYOUT.bridge, x, z, 0.3)) return 'bridge';
  const c = creekInfo(x, z);
  if (c.dist < 2.2) return 'creek';
  if (trailBlend(x, z) > 0.6) return 'trail';
  const e = 0.5;
  const gx = (mountainH(x + e, z) - mountainH(x - e, z)) / (2 * e);
  const gz = (mountainH(x, z + e) - mountainH(x, z - e)) / (2 * e);
  if (Math.hypot(gx, gz) > 0.55) return 'rock';
  return 'undergrowth';
}

/* ------------------------------------------------------------------- keepers */

// Eight names. Seven cairns. The tradition — stated once, in Doyle's own hand,
// on the page found beside their cairn — is that a keeper who finishes a season
// builds one on the way down. Nothing anywhere counts these two lists against
// each other; the gap is left for whoever thinks to count.
export const KEEPERS = ['Hollis', 'Vann', 'Merrit', 'Ruiz', 'Kessler', 'Okafor', 'Doyle', 'Marsh'];

// The logbook, page by scattered page. Entries start administrative — weather,
// supplies, a repaired shutter — and drift personal the deeper the log runs.
// Kessler's entries are the middle of the arc and the reason it exists; read
// them in order. House rules for every word here: no entry confirms danger, no
// entry confirms safety, no entry mentions what stands at the rail, and the
// log never once speaks in the game's voice. Madness or peace stays unruled.
const PAGE_TEXTS = [
  {
    keeper: 'Hollis',
    entries: [
      { date: 'June 2', body: 'Hauled the season’s tinned goods up from the cache. Four trips. The winch rope wants replacing before somebody trusts it.' },
      { date: 'June 5', body: 'Rain through the morning, cleared by four. Visibility good to the far ridge. Nothing to report.' },
    ],
  },
  {
    keeper: 'Vann',
    entries: [
      { date: 'July 11', body: 'Mice in the flour again. Patched the tin with a boot heel and a prayer. If the district wants a better report than that, the district can climb up here.' },
      { date: 'July 14', body: 'Glass falling since noon. Banked the stove.' },
    ],
  },
  {
    keeper: 'Merrit',
    entries: [
      { date: 'Aug 3', body: 'The east shutter came off its top hinge in the night. Planed a shim and rehung it. It sits true now, which is more than I can say for the door.' },
      { date: 'Aug 9', body: 'Counted nine deer in the burn scar this evening. I have started naming them, which the manual does not forbid.' },
    ],
  },
  {
    keeper: 'Ruiz',
    entries: [
      { date: 'Sept 1', body: 'Checked in on the radio at seven. Static took most of Delia’s voice but I got the weather out of it. Cold coming early, she thinks.' },
      { date: 'Sept 6', body: 'I have been up here long enough that the quiet has stopped being a thing I notice and started being a thing I own. I don’t know how to write that in a weather column, so it goes here.' },
    ],
  },
  {
    keeper: 'Kessler',
    entries: [
      { date: 'June 19', body: 'Something came around the tower in the night. Twice, by the sound of it — slow, and heavy enough to hear through the floor. I did not go down to look. Elk, at that weight.' },
      { date: 'June 20', body: 'Nothing in the mud this morning but my own boots from Thursday. Wind took the rest, I’d guess. Logged it and moving on.' },
    ],
  },
  {
    keeper: 'Kessler',
    entries: [
      { date: 'July 2', body: 'It was back last night. I counted eleven circuits before I lost the thread of it and slept. I want to write that it is a bear working the smell of the larder, so I will: it is a bear, working the smell of the larder.' },
      { date: 'July 8', body: 'Four nights quiet, then last night again. I sat up with the lamp out and my ear on the floorboards and it was almost like listening to weather. It has a wide, patient way of going around.' },
    ],
  },
  {
    keeper: 'Kessler',
    entries: [
      { date: 'July 30', body: 'It came around again toward morning. I noticed I had stopped counting the circuits some nights back, the way you stop counting stairs in a house you live in.' },
      { date: 'Aug 14', body: 'Slept the whole night through. Woke once near dawn to the sound of it going around and thought, there you are, and went back down into sleep like a stone into a well. Weather clear. Berries coming on along the south face.' },
    ],
  },
  {
    keeper: 'Okafor',
    entries: [
      { date: 'June 30', body: 'Inventory against the district list: short two lamp mantles and long one axe, which is the kind of arithmetic this mountain runs. Previous keeper left the log in good order. I read the whole of it my first week. Long evenings up here.' },
      { date: 'July 21', body: 'Repainted the catwalk rail. The old paint had worn through in a ring, the way a path wears.' },
    ],
  },
  {
    keeper: 'Doyle',
    entries: [
      { date: 'Aug 25', body: 'Season’s end. Packed out the perishables and swept the cab. Whoever reads this next: the stove damper sticks a quarter turn from closed, and the third stair sings in frost. Treat both gently.' },
      { date: 'Aug 26', body: 'Built my cairn this morning, up past the last turn, where the trail stops pretending it might level out. The tradition is you build it on the way down, when you are done — but I wanted mine where I could stand and see the whole season from the top of it. Take a stone up with you if you pass; it saves carrying the mountain to the mountain.' },
    ],
  },
  {
    keeper: 'Marsh',
    entries: [
      { date: 'Sept 12', body: 'Relief is late. Radio check gave me carrier and no voices, which on this set could mean weather and could mean the set. Rationing the good tea against better company.' },
      { date: 'Sept 18', body: 'Wind from the north all day, the long way of it through the guy-wires, like a note held past the end of the breath. Kettle’s on more than it’s off. I find I am in no great hurry to be anywhere but the window.' },
    ],
  },
];

/* -------------------------------------------------------------------- layout */

const CAIRN_TS = [0.08, 0.22, 0.31, 0.47, 0.58, 0.71, 0.86];

/**
 * Everything placed on the mountain, in one deterministic pass. Exported as a
 * function so the smoke test can build it twice and assert the two runs are
 * identical — determinism is the property every other claim rests on.
 */
export function buildLayout() {
  const bridge = findBridge();

  // Landmarks first, so trees can keep clear of them.
  const end = trailPoint(1);
  const bench = {
    x: end.x + end.dx * 3, z: end.z + end.dz * 3,
    yaw: Math.atan2(end.dx, end.dz) + Math.PI,   // faces back down the fog
  };
  const tower = { x: end.x + end.dx * 13, z: end.z + end.dz * 13, yaw: Math.atan2(end.dx, end.dz) };

  const cabinAt = trailPoint(0.55);
  const cabin = {
    x: cabinAt.x + -cabinAt.dz * 14, z: cabinAt.z + cabinAt.dx * 14,
    yaw: Math.atan2(-(-cabinAt.dz), -cabinAt.dx),   // door toward the trail
  };

  const waterfall = (() => {
    const x = creekX(CREEK.headZ);
    return {
      x, z: CREEK.headZ,
      baseY: groundHeight(x, CREEK.headZ + 1.5) - 0.4,
      topY: mountainH(x, CREEK.headZ - 5) - 0.5,
    };
  })();

  const markers = [];
  for (let i = 0; i < 14; i++) {
    const p = trailPoint((i + 0.5) / 14);
    const side = i % 2 ? 1 : -1;
    markers.push({
      x: p.x + -p.dz * 2.2 * side, z: p.z + p.dx * 2.2 * side,
      t: p.t, side, yaw: Math.atan2(p.dx, p.dz),
    });
  }

  // Each cairn carries the name of the keeper who built it, oldest lowest —
  // the chip reads the name out when one is found. Seven names off an
  // eight-name roster. Nothing explains that, anywhere, on purpose.
  const cairnRnd = mulberry32(0xca19);
  const cairns = CAIRN_TS.map((t, i) => {
    const p = trailPoint(t);
    const side = cairnRnd() < 0.5 ? -1 : 1;
    const off = 5 + cairnRnd() * 9;
    return {
      x: p.x + -p.dz * off * side, z: p.z + p.dx * off * side,
      t, stones: 4 + (i % 3), foundRadius: 4, keeper: KEEPERS[i],
    };
  });

  // The logbook's scattered pages: a few blown down along the trail, the rest
  // where hands would have put them down — around the cabin, and at the top
  // where the log lived. Positions are offsets from things already placed, so
  // redrawing the trail or moving the cabin carries the pages along.
  const pages = PAGE_TEXTS.map((pg, i) => ({ id: i, ...pg }));
  {
    const at = (i, x, z, yaw) => { pages[i].x = x; pages[i].z = z; pages[i].yaw = yaw; };
    const onTrail = (i, t, off, side, yaw) => {
      const p = trailPoint(t);
      at(i, p.x + -p.dz * off * side, p.z + p.dx * off * side, yaw);
    };
    onTrail(0, 0.06, 2.4, -1, 0.7);                      // Hollis, first leg
    onTrail(1, 0.21, 2.1, 1, 2.2);                       // Vann, low switchbacks
    onTrail(2, 0.44, 1.8, -1, 4.1);                      // Merrit, below the cabin turn
    at(3, cabin.x + 2.6, cabin.z + 1.8, 1.3);            // Ruiz, by the cabin door
    at(4, cabin.x - 3.1, cabin.z + 0.9, 5.0);            // Kessler, cabin west side
    at(5, cabin.x - 0.8, cabin.z - 3.4, 2.8);            // Kessler, behind the cabin
    at(6, bench.x - 1.6, bench.z - 1.2, 0.4);            // Kessler, beside the bench
    at(7, tower.x - 3.4, tower.z + 2.2, 3.6);            // Okafor, near the tower legs
    onTrail(8, 0.88, 1.5, 1, 1.9);                       // Doyle, by their own cairn
    at(9, tower.x + 1.2, tower.z - 1.6, 5.6);            // Marsh, at the foot of the tower
  }

  const mushRnd = mulberry32(0x5309);
  const mushrooms = [];
  for (let i = 0; i < 90; i++) {
    const p = trailPoint(0.02 + mushRnd() * 0.96);
    const side = mushRnd() < 0.5 ? -1 : 1;
    const off = 2.5 + mushRnd() * 5.5;
    mushrooms.push({
      x: p.x + -p.dz * off * side + (mushRnd() - 0.5) * 2,
      z: p.z + p.dx * off * side + (mushRnd() - 0.5) * 2,
      count: 3 + (mushRnd() * 5 | 0),
      glow: mushRnd() < 0.15,
      seed: (mushRnd() * 1e6) | 0,
    });
  }

  const shaftRnd = mulberry32(0x11a7);
  const shafts = [];
  for (let i = 0; i < 12; i++) {
    const p = trailPoint(0.05 + i * 0.082);
    const side = i % 2 ? 1 : -1;
    const off = 6 + shaftRnd() * 8;
    shafts.push({
      x: p.x + -p.dz * off * side, z: p.z + p.dx * off * side,
      tilt: 0.15 + shaftRnd() * 0.2, phase: shaftRnd() * Math.PI * 2,
    });
  }

  const clearRnd = mulberry32(0xdee5);
  const clearings = [];
  for (let i = 0; i < 12; i++) {
    const p = trailPoint(0.06 + i * 0.078);
    const side = clearRnd() < 0.5 ? -1 : 1;
    const off = 18 + clearRnd() * 22;
    clearings.push({ x: p.x + -p.dz * off * side, z: p.z + p.dx * off * side });
  }

  // The forest itself: jittered grid, kept dense enough to read as "crammed".
  // Every rejection rule is a claim the smoke test repeats: nothing grows on
  // the trail, in the creek, or through a landmark.
  const keepClear = [
    // The summit gets a real clearing: the payoff needs room to be a view.
    { x: bench.x, z: bench.z, r: 11 }, { x: tower.x, z: tower.z, r: 15 },
    { x: cabin.x, z: cabin.z, r: 7 }, { x: bridge.x, z: bridge.z, r: 6 },
    { x: waterfall.x, z: waterfall.z, r: 7 },
    ...markers.map(m => ({ x: m.x, z: m.z, r: 1.5 })),
    ...cairns.map(c => ({ x: c.x, z: c.z, r: 2.5 })),
    ...pages.map(p => ({ x: p.x, z: p.z, r: 1.2 })),
  ];

  const treeRnd = mulberry32(0x7ee5);
  const trees = [];
  const CELL = 3.4;
  for (let gz = BOUNDS.minZ + 2; gz < BOUNDS.maxZ - 2; gz += CELL) {
    for (let gx = BOUNDS.minX + 2; gx < BOUNDS.maxX - 2; gx += CELL) {
      const jx = treeRnd(), jz = treeRnd(), keep = treeRnd();
      const species = treeRnd(), size = treeRnd(), seed = (treeRnd() * 1e6) | 0;
      if (keep > 0.72) continue;
      const x = gx + jx * CELL, z = gz + jz * CELL;
      if (x < BOUNDS.minX + 1 || x > BOUNDS.maxX - 1 ||
          z < BOUNDS.minZ + 1 || z > BOUNDS.maxZ - 1) continue;
      const ti = trailInfo(x, z);
      if (ti.dist < 3.2) continue;
      if (creekInfo(x, z).dist < 4) continue;
      if (keepClear.some(k => Math.hypot(x - k.x, z - k.z) < k.r)) continue;
      const conifer = species < 0.72;
      trees.push({
        x, z,
        species: conifer ? 'conifer' : 'birch',
        h: conifer ? 8 + size * 7 : 6 + size * 4,
        tier: ti.dist < 22 ? 'near' : 'far',
        seed,
      });
    }
  }

  // The headlamp, on the cabin step beside the door — where a keeper going
  // inside for the last time would have set it down. Findable, one toggle,
  // never required for anything. props.js draws it until it is picked up;
  // main.js owns what it does after that.
  const headlamp = (() => {
    const lx = 1.6, lz = 2.1;      // cabin-local: past the door, off the step
    const cy = Math.cos(cabin.yaw), sy = Math.sin(cabin.yaw);
    return {
      x: cabin.x + lx * cy + lz * sy,
      z: cabin.z - lx * sy + lz * cy,
      foundRadius: 1.6,
    };
  })();

  // Bootprints on the last switchback. Somebody walked up here in boots, one
  // set, ascending — they start partway up the final climb and stop before
  // the top, and no prints ever come back down. Deterministic, fog-gated at
  // render time, and small enough to miss entirely, which is the point: the
  // player who never looks down loses nothing, and the player who notices
  // gets no explanation.
  const printRnd = mulberry32(0xb007);
  const bootprints = [];
  {
    const STRIDE = 0.78 / TRAIL.length;          // ~78 cm a step, in trail t
    let foot = 1;
    for (let t = 0.9; t < 0.965; t += STRIDE) {
      const p = trailPoint(t);
      const off = foot * (0.14 + printRnd() * 0.05);
      bootprints.push({
        x: p.x + -p.dz * off + (printRnd() - 0.5) * 0.04,
        z: p.z + p.dx * off + (printRnd() - 0.5) * 0.04,
        t, yaw: Math.atan2(p.dx, p.dz) + (printRnd() - 0.5) * 0.14,
        foot,
      });
      foot = -foot;
    }
  }

  // Bird perches: tops of near trees strung along the whole climb.
  const perchRnd = mulberry32(0xbead);
  const nearTrees = trees.filter(t => t.tier === 'near');
  const perches = [];
  for (let i = 0; i < 40 && nearTrees.length; i++) {
    const t = nearTrees[(perchRnd() * nearTrees.length) | 0];
    perches.push({ x: t.x, z: t.z, h: t.h * 0.55 });
  }

  return {
    bridge, bench, tower, cabin, waterfall, headlamp,
    markers, cairns, pages, bootprints, mushrooms, shafts, clearings, trees, perches,
  };
}

export const LAYOUT = buildLayout();

/** Water surface height along the creek, for the ribbon and the walker. */
export function creekWaterY(z) {
  const zc = clamp(z, CREEK.headZ, CREEK.endZ);
  return groundHeight(creekX(zc), zc) + (CREEK.depth - 0.85);
}
