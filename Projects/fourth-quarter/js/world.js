// world.js — the room, built in metres from a description in layout.js.
// Floor y=0 except where layout.floorYAt() says otherwise — the flagship's
// mezzanine is a deck at 1.6 m, and every stool, table and collider on it is
// lifted with it. Every room shares one plan: door mid-south (+z); the bar along
// the north wall with a service lane behind it; behind the north wall the
// KITCHEN, reached through a doorway east of the bar, with a pass-through
// window where food lands. A room may also carry annexes — further floor
// rectangles with their own ceiling height, opening through a gap in one of
// the hall's walls, which is why the hall's walls are drawn from
// layout.wallSegments() rather than as three unbroken planes.
//   The fixtures and furniture are the bar pack (models/bar/, js/pieces.js),
// every file loaded before this module finishes evaluating; the walls, floors,
// joinery and lights are still built here from boxes and planes.
//   None of the numbers live here — layout.js holds
// them and derives seats, colliders, inBounds(), the TV mounts and the cook
// line; this file turns that into meshes and converts the derived boxes to
// THREE.Box3 at the boundary. Every fit-out block is drawn by its `kind`, so
// a room with three stoves is three entries in its description and nothing
// here. Exposes: seats[], colliders[], the stand-points, inBounds(), and
// currentLayout().

import * as THREE from "three";
import { mat, flat, glow } from "./materials.js";
import * as L from "./layout.js";
import { loadPieces, pieceGroup, keyed, BOX } from "./pieces.js";

// Every piece of the bar pack, loaded once, before buildWorld() can run. A
// missing file rejects this, naming it, and the page stops here (B4).
const PIECES = await loadPieces();

// Every export below is filled in by buildWorld() from the venue's description
// and rewritten on each rebuild — the objects keep their identity, so a module
// that imported DOOR before the first build still holds tonight's door. ROOM and
// KITCHEN are the Corner Tap's until the first call, which is what they were
// as literals; the stand-points are set on the same call.
export const ROOM = { x: 8, z: 5.5, h: 3.1 };
export const KITCHEN = { x0: 1, x1: 8, z0: -9, z1: -5.5 };

export const DOOR = new THREE.Vector3();
export const DOOR_OUT = new THREE.Vector3();

// carrier stand-points (walk here, press E / deliver from here)
export const PASS_FOOD  = new THREE.Vector3();   // main-room side of the window
export const PASS_DRINK = new THREE.Vector3();   // east end of the bar front
// where ready items physically sit (spread along x)
export const PASS_FOOD_SHELF  = new THREE.Vector3();
export const PASS_DRINK_SHELF = new THREE.Vector3();
// where the player actually cooks/pours — distinct from the pickup counters above
export const STOVE_STATION = new THREE.Vector3();   // in front of the kitchen stove
export const TAP_STATION   = new THREE.Vector3();   // west end of the bar front
export const UPGRADES_STATION = new THREE.Vector3();

export const seats = [];
export const colliders = [];

// the mezzanine's joinery: deck thickness, panelling, rail height, riser
const DECK_T = 0.22, PANEL_T = 0.08, RAIL_H = 1.0, STEP_RISE = 0.18;

let current = L.CORNER_TAP;
/** The description the room on screen was built from. */
export function currentLayout() { return current; }

/** Walkable test: main room ∪ kitchen ∪ the doorway corridor joining them,
 *  on one floor (a body r wide is kept off the mezzanine's edge). */
export function inBounds(x, z, r = 0.3) {
  return L.inBounds(current, x, z, r);
}

/** The floor under a point in the room on screen: 0, or the mezzanine's. */
export function floorY(x, z) {
  return L.floorYAt(current, x, z);
}

/** Point the exported constants at a description. Called at the top of
 *  buildWorld(); exported so a test can aim the module without a scene. */
export function adoptLayout(desc) {
  current = desc;
  Object.assign(ROOM, desc.room);
  Object.assign(KITCHEN, desc.kitchen);
  const p = L.standPointsFor(desc);
  const set = (v, k) => v.set(p[k].x, p[k].y, p[k].z);
  set(DOOR, "door"); set(DOOR_OUT, "doorOut");
  set(PASS_FOOD, "passFood"); set(PASS_DRINK, "passDrink");
  set(PASS_FOOD_SHELF, "passFoodShelf"); set(PASS_DRINK_SHELF, "passDrinkShelf");
  set(STOVE_STATION, "stove"); set(TAP_STATION, "tap"); set(UPGRADES_STATION, "upgrades");
  seats.length = 0;
  // `reachable` is the nav grid's answer, not the geometry's: a stool can be
  // walkable and still have no route from the door once the fit-out is in the
  // way, and patrons.js's freeSeat() refuses to offer one of those.
  const reach = L.reachableSeats(desc);
  L.seatsFor(desc).forEach((s, i) => {
    seats.push({ id: s.id, pos: new THREE.Vector3(s.x, s.y, s.z),
      approach: new THREE.Vector3(s.ax, L.floorYAt(desc, s.ax, s.az), s.az),
      taken: false, reachable: reach[i], kind: s.kind });
  });
  colliders.length = 0;
  for (const b of L.collidersFor(desc)) {
    colliders.push(new THREE.Box3(new THREE.Vector3(b.min.x, b.min.y, b.min.z), new THREE.Vector3(b.max.x, b.max.y, b.max.z)));
  }
}
adoptLayout(current);

export function buildWorld(scene, venueId) {
  const g = new THREE.Group();

  // main.js's rebuildVenue() (a signed lease, a dev-menu warp, "New Game") calls
  // this again on the same page, and for two rounds neither module-level array
  // was cleared — every rebuild silently doubled seats and colliders on top of
  // the previous room's. adoptLayout() empties both and refills them from the
  // description, so a rebuild is the new room's lists and nothing else's. Any
  // new module-level array here inherits the same obligation.
  const desc = L.layoutFor(venueId);
  adoptLayout(desc);
  const DOORWAY = desc.doorways[0];
  const WINDOW = desc.windows[0];
  const WALL_T = desc.wallT;

  // ---- floors & ceilings ----
  // Each material's texture repeat was tuned on the Corner Tap's surfaces, and
  // the textures are shared across every mesh that uses them, so a bigger room
  // scales the plane's UVs by its size over the Corner Tap's instead: the same
  // plank width on a 28 m floor as on a 16 m one. (Corner Tap: scale 1 exactly.)
  const floor = new THREE.Mesh(plane(ROOM.x * 2, ROOM.z * 2, 16, 11), mat("floorWood"));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
  const kW = KITCHEN.x1 - KITCHEN.x0, kD = KITCHEN.z1 - KITCHEN.z0;
  const kFloor = new THREE.Mesh(plane(kW, kD, 7, 3.5), mat("kitchenTile"));
  kFloor.rotation.x = -Math.PI / 2;
  kFloor.position.set((KITCHEN.x0 + KITCHEN.x1) / 2, 0, (KITCHEN.z0 + KITCHEN.z1) / 2);
  kFloor.receiveShadow = true; g.add(kFloor);
  const ceil = new THREE.Mesh(plane(ROOM.x * 2, ROOM.z * 2, 16, 11), mat("ceiling"));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = ROOM.h; g.add(ceil);
  const kCeil = new THREE.Mesh(plane(kW, kD, 7, 3.5), mat("ceiling"));
  kCeil.rotation.x = Math.PI / 2;
  kCeil.position.set((KITCHEN.x0 + KITCHEN.x1) / 2, ROOM.h, (KITCHEN.z0 + KITCHEN.z1) / 2);
  g.add(kCeil);
  // annex floors and ceilings: the hall's boards at the hall's texel density,
  // under whatever ceiling the description gives that rectangle
  for (const a of desc.annexes ?? []) {
    const aw = a.x1 - a.x0, ad = a.z1 - a.z0, ax = (a.x0 + a.x1) / 2, az = (a.z0 + a.z1) / 2;
    const aFloor = new THREE.Mesh(plane(aw, ad, 16, 11), mat("floorWood"));
    aFloor.rotation.x = -Math.PI / 2; aFloor.position.set(ax, 0, az);
    aFloor.receiveShadow = true; g.add(aFloor);
    const aCeil = new THREE.Mesh(plane(aw, ad, 16, 11), mat("ceiling"));
    aCeil.rotation.x = Math.PI / 2; aCeil.position.set(ax, a.h, az);
    g.add(aCeil);
  }

  // ---- mezzanines: a deck, the panelling under it, a rail, and a stair ----
  // The deck is the hall's boards at the hall's texel density, standing on
  // dark panelling that closes the ground under it; every edge that is not a
  // hall wall carries a rail, except the span the stair lands on. The stair
  // is solid steps, 18 cm risers or as near as divides the rise, so its sides
  // are closed by the steps themselves. None of it is a collider: layout.js's
  // one step rule keeps every body off the edge, the panelling and the sides.
  const railM = flat(0x2a1d12, 0.6), panelM = flat(0x2e2016, 0.85);
  for (const m of desc.mezzanines ?? []) {
    const mw = m.x1 - m.x0, md = m.z1 - m.z0, mx = (m.x0 + m.x1) / 2, mz = (m.z0 + m.z1) / 2;
    const deck = new THREE.Mesh(plane(mw, md, 16, 11), mat("floorWood"));
    deck.rotation.x = -Math.PI / 2; deck.position.set(mx, m.y, mz);
    deck.receiveShadow = true; g.add(deck);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(mw, DECK_T, md), panelM);
    lip.position.set(mx, m.y - DECK_T / 2, mz); lip.castShadow = true; g.add(lip);
    for (const e of L.mezzanineEdges(desc, m)) {
      const along = e.side === "north" || e.side === "south";
      const len = e.a1 - e.a0, mid = (e.a0 + e.a1) / 2;
      const at = { north: [mid, m.z0], south: [mid, m.z1], west: [m.x0, mid], east: [m.x1, mid] }[e.side];
      const ry = along ? 0 : Math.PI / 2;
      // the panelling under the deck, and a top rail on posts a metre up
      const panel = new THREE.Mesh(new THREE.BoxGeometry(len, m.y - DECK_T, PANEL_T), panelM);
      panel.position.set(at[0], (m.y - DECK_T) / 2, at[1]); panel.rotation.y = ry;
      panel.receiveShadow = true; g.add(panel);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.06), railM);
      rail.position.set(at[0], m.y + RAIL_H, at[1]); rail.rotation.y = ry; rail.castShadow = true; g.add(rail);
      const posts = Math.max(2, Math.round(len / 1.2) + 1);
      for (let i = 0; i < posts; i++) {
        const u = e.a0 + 0.04 + (len - 0.08) * i / (posts - 1);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, RAIL_H, 0.05), railM);
        post.position.set(along ? u : at[0], m.y + RAIL_H / 2, along ? at[1] : u); g.add(post);
      }
    }
    // the stair: n solid steps from the foot to the deck's edge
    const s = m.stair, alongX = s.rise === "east" || s.rise === "west";
    const run = alongX ? s.x1 - s.x0 : s.z1 - s.z0, width = alongX ? s.z1 - s.z0 : s.x1 - s.x0;
    const n = Math.max(1, Math.ceil(m.y / STEP_RISE)), tread = run / n, rise = m.y / n;
    for (let i = 0; i < n; i++) {
      // step i occupies the i-th tread from the foot, and is (i+1) risers tall
      const u0 = (s.rise === "east" || s.rise === "south") ? i * tread : run - (i + 1) * tread;
      const cu = (alongX ? s.x0 : s.z0) + u0 + tread / 2, h = (i + 1) * rise;
      const step = new THREE.Mesh(new THREE.BoxGeometry(alongX ? tread : width, h, alongX ? width : tread), mat("barTop"));
      step.position.set(alongX ? cu : (s.x0 + s.x1) / 2, h / 2, alongX ? (s.z0 + s.z1) / 2 : cu);
      step.castShadow = true; step.receiveShadow = true; g.add(step);
    }
    // a handrail up each side of the stair that is not a hall wall
    for (const side of alongX ? ["north", "south"] : ["west", "east"]) {
      const edge = { north: s.z0, south: s.z1, west: s.x0, east: s.x1 }[side];
      const wall = { north: -ROOM.z, south: ROOM.z, west: -ROOM.x, east: ROOM.x }[side];
      if (Math.abs(edge - wall) < 1e-9) continue;
      const len = Math.hypot(run, m.y), tilt = Math.atan2(m.y, run);
      const up = (s.rise === "east" || s.rise === "south") ? 1 : -1;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.06, 0.06, alongX ? 0.06 : len), railM);
      beam.position.set(alongX ? (s.x0 + s.x1) / 2 : edge, m.y / 2 + RAIL_H, alongX ? edge : (s.z0 + s.z1) / 2);
      if (alongX) beam.rotation.z = up * tilt; else beam.rotation.x = -up * tilt;
      g.add(beam);
      for (const [u, y] of [[0, 0], [run, m.y]]) {
        const uu = up > 0 ? u : run - u;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, RAIL_H, 0.05), railM);
        post.position.set(alongX ? s.x0 + uu : edge, y + RAIL_H / 2, alongX ? edge : s.z0 + uu); g.add(post);
      }
    }
  }

  // ---- main room walls ----
  // A wall with nothing behind it is the plane it has always been, facing in.
  // A wall an annex opens through has a room on both sides, so it is drawn as
  // boxes instead — one per span layout.wallSegments() reports, plus the
  // header over each gap — offset half a thickness outside the room, so its
  // inner face lands exactly where the plane was.
  const mkWall = (geo, m, x, z, ry) => {
    const w = new THREE.Mesh(geo, m);
    w.position.set(x, ROOM.h / 2, z); w.rotation.y = ry; w.receiveShadow = true; g.add(w);
  };
  const gapped = L.gappedWalls(desc);
  const onWall = (wall, at) => {
    const o = WALL_T / 2;
    if (wall === "south") return { x: at, z: ROOM.z + o, ry: 0 };
    if (wall === "north") return { x: at, z: -ROOM.z - o, ry: 0 };
    if (wall === "east") return { x: ROOM.x + o, z: at, ry: Math.PI / 2 };
    return { x: -ROOM.x - o, z: at, ry: Math.PI / 2 };   // west
  };
  const PLAIN = {
    south: () => mkWall(plane(ROOM.x * 2, ROOM.h, 16, 3.1), mat("wallPlaster"), 0, ROOM.z, Math.PI),
    west:  () => mkWall(plane(ROOM.z * 2, ROOM.h, 11, 3.1), mat("wallPlaster"), -ROOM.x, 0, Math.PI / 2),
    east:  () => mkWall(plane(ROOM.z * 2, ROOM.h, 11, 3.1), mat("wallPlaster"), ROOM.x, 0, -Math.PI / 2),
  };
  for (const wall of ["south", "west", "east"]) {
    if (!gapped.has(wall)) { PLAIN[wall](); continue; }
    for (const seg of L.wallSegments(desc, wall)) {
      const at = onWall(wall, (seg.a0 + seg.a1) / 2);
      const b = new THREE.Mesh(new THREE.BoxGeometry(seg.a1 - seg.a0, seg.y1 - seg.y0, WALL_T), mat("wallPlaster"));
      b.position.set(at.x, (seg.y0 + seg.y1) / 2, at.z); b.rotation.y = at.ry;
      b.receiveShadow = true; b.castShadow = true; g.add(b);
    }
  }
  // annex walls, and a frame round the doorway that reaches it — the same
  // dark frame the kitchen doorway gets below
  const frameM = flat(0x241a10, 0.7);
  for (const a of desc.annexes ?? []) {
    for (const w of L.annexWalls(desc, a)) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w.len, a.h, WALL_T), mat("wallPlaster"));
      b.position.set(w.x, a.h / 2, w.z); b.rotation.y = w.ry;
      b.receiveShadow = true; g.add(b);
    }
    for (const at of [a.gap.a0, a.gap.a1]) {
      const q = onWall(a.wall, at);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, L.DOOR_H, WALL_T + 0.08), frameM);
      post.position.set(q.x, L.DOOR_H / 2, q.z); post.rotation.y = q.ry; g.add(post);
    }
    const q = onWall(a.wall, (a.gap.a0 + a.gap.a1) / 2);
    const lint = new THREE.Mesh(new THREE.BoxGeometry(a.gap.a1 - a.gap.a0 + 0.1, 0.1, WALL_T + 0.08), frameM);
    lint.position.set(q.x, L.DOOR_H, q.z); lint.rotation.y = q.ry; g.add(lint);
  }

  // ---- north wall: brick boxes with a doorway gap and a pass window ----
  const nz = -ROOM.z;
  const brickBox = (x0, x1, y0, y1) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, WALL_T), mat("wallBrick"));
    b.position.set((x0 + x1) / 2, (y0 + y1) / 2, nz);
    b.receiveShadow = true; b.castShadow = true; g.add(b);
    return b;
  };
  brickBox(-ROOM.x, DOORWAY.x0, 0, ROOM.h);                 // west span (behind the bar)
  brickBox(DOORWAY.x0, DOORWAY.x1, L.DOOR_H, ROOM.h);       // header above the doorway
  brickBox(DOORWAY.x1, WINDOW.x0, 0, ROOM.h);               // between doorway and window
  brickBox(WINDOW.x0, WINDOW.x1, 0, WINDOW.y0);             // below the window
  brickBox(WINDOW.x0, WINDOW.x1, WINDOW.y1, ROOM.h);        // above the window
  brickBox(WINDOW.x1, ROOM.x, 0, ROOM.h);                   // east span
  // doorway frame (frameM is declared with the annex frames above)
  for (const fx of [DOORWAY.x0, DOORWAY.x1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, L.DOOR_H, WALL_T + 0.08), frameM);
    post.position.set(fx, L.DOOR_H / 2, nz); g.add(post);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(DOORWAY.x1 - DOORWAY.x0 + 0.1, 0.1, WALL_T + 0.08), frameM);
  lintel.position.set((DOORWAY.x0 + DOORWAY.x1) / 2, L.DOOR_H, nz); g.add(lintel);

  // pass-through sill (both sides of the wall) — where food lands
  piece(g, "sill", (WINDOW.x0 + WINDOW.x1) / 2, WINDOW.y0 - 0.04, nz,
    { sx: (WINDOW.x1 - WINDOW.x0 + 0.2) / BOX.sill[0], shadow: true });
  const passSign = makeLabel("KITCHEN", 0xe8a33d);
  passSign.position.set((WINDOW.x0 + WINDOW.x1) / 2, WINDOW.y1 + 0.35, nz + WALL_T); g.add(passSign);

  // ---- kitchen walls (boxes so they read from inside too) ----
  const kWall = (w, x, z, ry) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, ROOM.h, WALL_T), mat("wallPlaster"));
    b.position.set(x, ROOM.h / 2, z); b.rotation.y = ry; b.receiveShadow = true; g.add(b);
  };
  kWall(kW, (KITCHEN.x0 + KITCHEN.x1) / 2, KITCHEN.z0, 0);            // kitchen north
  kWall(kD, KITCHEN.x0, (KITCHEN.z0 + KITCHEN.z1) / 2, Math.PI / 2);  // kitchen west
  kWall(kD, KITCHEN.x1, (KITCHEN.z0 + KITCHEN.z1) / 2, Math.PI / 2);  // kitchen east

  // ---- fit-out (the blocks are the description's; colliders are already
  //      derived from the same numbers, so nothing is measured off a mesh).
  //      Drawn by kind: a stove is a metal block with four burners, a prep a
  //      metal block, a crate metal or wood. Any count of each. ----
  //      Each block is its kind's piece, scaled by the block's w, h, d over
  //      the box the file was built at: 1 in every room there is. The
  //      burners stay the game's glow() discs (#689). ----
  const block = (f, name) => piece(g, name, f.x, 0, f.z,
    { ry: f.rotY || 0, sx: f.w / BOX[name][0], sy: f.h / BOX[name][1], sz: f.d / BOX[name][2], shadow: true });
  for (const f of desc.fitout) {
    if (f.kind === "stove") {
      const stove = block(f, "stove");
      for (let i = 0; i < 4; i++) {
        const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.02, 12), glow(0xff5a2b, 0.9));
        burner.position.set(stove.position.x - 0.35 + (i % 2) * 0.7, f.h + 0.01, stove.position.z - 0.17 + Math.floor(i / 2) * 0.36);
        g.add(burner);
      }
    } else if (f.kind === "crateWood") {
      block(f, "crate-wood");
    } else {
      block(f, f.kind); // prep, crate
    }
  }
  // dry-goods shelf on the kitchen's north wall, west end: the Corner Tap's
  // 2.2 m shelf with six cans, longer in a wider kitchen
  const shelfLen = Math.min(kW - 0.8, 2.2 + Math.max(0, kW - 7) * 0.4);
  const shelfX = KITCHEN.x0 + 0.3 + shelfLen / 2, shelfZ = KITCHEN.z0 + 0.25;
  run(g, "shelf-kitchen", shelfX - shelfLen / 2, shelfX + shelfLen / 2, 1.7 - 0.03, shelfZ);
  const cans = Math.round(shelfLen / 0.34);
  for (let i = 0; i < cans; i++) piece(g, "can", shelfX - shelfLen / 2 + 0.25 + i * 0.34, 1.83 - 0.1, shelfZ);
  // the kitchen never goes dark: one warm light per 7 m of its width
  const kLights = Math.max(1, Math.round(kW / 7));
  for (let i = 0; i < kLights; i++) {
    const kLight = new THREE.PointLight(0xfff0dc, 10, 9, 1.8);
    kLight.position.set(KITCHEN.x0 + kW * (i + 0.5) / kLights, ROOM.h - 0.4, (KITCHEN.z0 + KITCHEN.z1) / 2 + 0.05);
    g.add(kLight);
  }
  const heat = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW.x1 - WINDOW.x0 - 0.1, WINDOW.y1 - WINDOW.y0 - 0.1), glow(0xffb45e, 0.25));
  heat.position.set((WINDOW.x0 + WINDOW.x1) / 2, (WINDOW.y0 + WINDOW.y1) / 2, KITCHEN.z0 + 0.16);
  g.add(heat); // warm glow on the kitchen back wall

  // door frame (front entrance, visual) — on the south wall at the door's x
  const doorX = DOOR.x;
  piece(g, "door-frame", doorX, 0, ROOM.z - 0.02, { ry: Math.PI });
  const doorGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.1), glow(0x2b3f66, 0.5));
  doorGlow.position.set(doorX, 1.1, ROOM.z - 0.09); doorGlow.rotation.y = Math.PI; g.add(doorGlow);

  // ---- the bar (pulled off the wall — a real lane behind it) ----
  const barLen = desc.bar.len, barX = desc.bar.x, barZ = desc.bar.z;
  // The counter is two ends, the west one mirrored so its closed side faces
  // out too, and barLen - 1 metres of middle between them (#690); the kick
  // and the back shelf are runs of one-metre pieces. The pieces are built at
  // the bar's 0.75 m depth, so a deeper bar would stretch them in z.
  const barX0 = barX - barLen / 2, barX1 = barX + barLen / 2, deep = desc.bar.depth / BOX["counter-mid"][2];
  piece(g, "counter-end", barX0 + 0.25, 0, barZ, { sx: -1, sz: deep, shadow: true });
  piece(g, "counter-end", barX1 - 0.25, 0, barZ, { sz: deep, shadow: true });
  run(g, "counter-mid", barX0 + 0.5, barX1 - 0.5, 0, barZ, { sz: deep, shadow: true });
  run(g, "kick", barX0, barX1, 0, barZ);
  // back bar shelf + bottles, on the north wall behind the lane
  run(g, "shelf-back", barX0, barX1, 1.5 - 0.04, nz + WALL_T / 2 + 0.2);
  const bottles = Math.max(1, Math.round((barLen - 0.8) / 0.56) + 1);
  for (let i = 0; i < bottles; i++) {
    piece(g, BOTTLES[i % BOTTLES.length], barX0 + 0.4 + i * 0.56, 1.7 - 0.16, nz + WALL_T / 2 + 0.2);
  }
  for (let i = 0; i < desc.bar.taps; i++) {
    piece(g, "tap", desc.bar.tapX0 + i * desc.bar.tapPitch, 1.28 - 0.175, barZ - 0.1);
  }
  const barSign = makeLabel("BAR PICK-UP", 0xe8a33d);
  barSign.position.set(PASS_DRINK.x, 1.75, barZ + 0.4); g.add(barSign);

  // stools: one mesh per derived seat (bar stools first, then each table's
  // four) — the seat list itself was filled by adoptLayout() above
  for (const s of seats) piece(g, "stool", s.pos.x, s.pos.y, s.pos.z, { shadow: "keyed" });

  const stoveRing = stationRing(0xff5a2b);
  stoveRing.position.set(STOVE_STATION.x, STOVE_STATION.y + 0.02, STOVE_STATION.z); stoveRing.scale.setScalar(0.7);
  g.add(stoveRing);
  const tapRing = stationRing(0x5aa7d6);
  tapRing.position.set(TAP_STATION.x, TAP_STATION.y + 0.02, TAP_STATION.z); tapRing.scale.setScalar(0.7);
  g.add(tapRing);

  // ---- tables, each on the floor under it: a top and a pedestal. Its
  //      stools come from the seats above, its collider from layout.js ----
  for (const t of desc.tables) piece(g, "table", t.x, L.floorYAt(desc, t.x, t.z), t.z, { shadow: "keyed" });

  // ---- TVs with live scoreboard canvases, hung where the description says ----
  const tvs = desc.tvs.map(tv => { const m = L.tvMount(desc, tv); return tvScreen(g, m.x, m.y, m.z, m.ry); });

  // ---- neon sign, over the door ----
  const neon = makeLabel("THE FOURTH QUARTER", 0xff4e42, 512, 44);
  neon.scale.multiplyScalar(1.6);
  neon.position.set(doorX, 2.6, ROOM.z - 0.08); neon.rotation.y = Math.PI; g.add(neon);

  // ---- corkboard (promo station, south wall — over the promo ring's x) ----
  // One piece: the cork, its frame and the five notes, centred 1.6 m up and
  // standing 1 to 7.5 cm off the wall, as the boxes and the notes were.
  piece(g, "corkboard", desc.stations.promo.x, 1.6 - BOX.corkboard[1] / 2, ROOM.z - 0.0425, { ry: Math.PI });

  // ---- upgrades sign (the crates themselves are fit-out, drawn above) ----
  const toolSign = makeLabel("UPGRADES", 0x9a6fb5);
  toolSign.scale.multiplyScalar(0.55);
  toolSign.position.set(UPGRADES_STATION.x + 0.2, 1.35, UPGRADES_STATION.z - 0.9);
  g.add(toolSign);

  // ---- lights: night rig (warm pendants) vs day rig (flat daylight) ----
  const nightRig = new THREE.Group(), dayRig = new THREE.Group();
  nightRig.add(new THREE.HemisphereLight(0x8a7a66, 0x14100c, 0.6));
  // a pendant hangs 40 cm under the ceiling it is actually under — an annex
  // ceiling may be lower than the hall's, and the hall's height there is
  // plaster
  for (const { x: lx, z: lz } of desc.pendants) {
    const ph = L.ceilingAt(desc, lx, lz);
    const p = new THREE.PointLight(0xffb45e, 14, 11, 1.9);
    p.position.set(lx, ph - 0.4, lz); nightRig.add(p);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.22, 12, 1, true), flat(0x1c130b, 0.6));
    cone.position.set(lx, ph - 0.25, lz); g.add(cone);
  }
  // the shadow cameras cover every floor rectangle plus a metre: ±9 / 7 / -10
  // at the Corner Tap, and out over the annex where there is one
  const fb = L.floorBounds(desc);
  const shadowBox = light => {
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.camera.left = fb.x0 - 1; light.shadow.camera.right = fb.x1 + 1;
    light.shadow.camera.top = fb.z1 + 1.5; light.shadow.camera.bottom = fb.z0 - 1;
  };
  const key = new THREE.DirectionalLight(0xfff2df, 0.5);
  key.position.set(3, 6, 4); key.castShadow = true; shadowBox(key);
  nightRig.add(key);

  dayRig.add(new THREE.HemisphereLight(0xdde6f2, 0x5a5048, 1.35));
  const sun = new THREE.DirectionalLight(0xfff6e6, 1.8);
  sun.position.set(-4, 7, 6); sun.castShadow = true; shadowBox(sun);
  dayRig.add(sun);
  const doorLight = new THREE.PointLight(0xeaf2ff, 8, 8, 1.6);
  doorLight.position.set(doorX, 2.2, ROOM.z - 0.6); dayRig.add(doorLight);
  // an annex has walls and a ceiling of its own, so the day rig's sun never
  // reaches it: one flat light per annex, the day rig's only room-shaped part
  for (const a of desc.annexes ?? []) {
    const aLight = new THREE.PointLight(0xf2f4f8, 12, Math.max(a.x1 - a.x0, a.z1 - a.z0) + 3, 1.7);
    aLight.position.set((a.x0 + a.x1) / 2, a.h - 0.5, (a.z0 + a.z1) / 2);
    dayRig.add(aLight);
  }
  dayRig.visible = false;
  g.add(nightRig); g.add(dayRig);

  scene.add(g);
  return { group: g, tvs, nightRig, dayRig };
}

/** A PlaneGeometry whose UVs are scaled by its size over a reference size, so
 *  a shared texture keeps one texel density across rooms of different sizes. */
function plane(w, h, refW, refH) {
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / refW), uv.getY(i) * (h / refH));
  return geo;
}

// the five back-bar bottles, in the order world.js has always coloured them
const BOTTLES = ["bottle-green", "bottle-amber", "bottle-violet", "bottle-blue", "bottle-gold"];

/**
 * One piece of the bar pack into `g`, its base centre at (x, y, z), turned
 * `ry` about y and scaled by sx, sy, sz. A keyed material is swapped for the
 * game's own mat() by name, so the tier and the repeats are the ones every
 * other surface gets. `shadow`: true casts from every part, "keyed" from the
 * keyed parts only (a stool's cushion, a table's top, as before B4).
 */
function piece(g, name, x, y, z, { ry = 0, sx = 1, sy = 1, sz = 1, shadow = false } = {}) {
  const p = pieceGroup(PIECES, name, m => (keyed(m) ? mat(m.name) : m));
  p.position.set(x, y, z); p.rotation.y = ry; p.scale.set(sx, sy, sz);
  if (shadow) for (const m of p.children) m.castShadow = shadow === true || keyed(m.material);
  g.add(p);
  return p;
}

/** A one-metre piece run along x from x0 to x1: as many whole metres as
 *  divide the run most nearly, each stretched to fit, so a texture keeps
 *  about the density it was tuned at. */
function run(g, name, x0, x1, y, z, opts = {}) {
  const n = Math.max(1, Math.round(x1 - x0)), each = (x1 - x0) / n;
  for (let i = 0; i < n; i++) piece(g, name, x0 + each * (i + 0.5), y, z, { ...opts, sx: each * (opts.sx ?? 1) });
}

// ---- canvas helpers ----
function makeLabel(text, color, w = 384, size = 40) {
  const c = document.createElement("canvas"); c.width = w; c.height = 96;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");
  ctx.font = `bold ${size}px Impact, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 18;
  ctx.fillText(text, w / 2, 48);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w / 160, 0.6),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  return m;
}

function tvScreen(g, x, y, z, ry) {
  const c = document.createElement("canvas"); c.width = 512; c.height = 288;
  const ctx = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  piece(g, "tv-frame", x, y - BOX["tv-frame"][1] / 2, z, { ry });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.0),
    new THREE.MeshBasicMaterial({ map: tex }));
  screen.position.set(x, y, z); screen.rotation.y = ry;
  screen.translateZ(0.05); g.add(screen);
  const light = new THREE.PointLight(0x8fb7ff, 2.2, 4.5, 2);
  light.position.copy(screen.position); light.translateZ(0.4); g.add(light);
  return { canvas: c, ctx, tex };
}

/**
 * Redraw all TVs with the current broadcast state. Cheap; call ~2×/sec.
 *
 *  state.gameNight   the Mules play tonight
 *  state.headline    what the screens say when they are not showing the Mules
 *                    (league.js's tonight().label, upper-cased by main.js)
 *  state.usName / themName   the Mules and tonight's opponent, as the score
 *                    bug prints them; `us` / `them` the running score
 *  state.standings   [{ id, short, w, l, streak }] in table order, drawn in
 *                    place of the field while `showStandings` is on — the
 *                    between-periods screen
 */
export function drawBroadcast(tvs, state) {
  for (const tv of tvs) {
    const { ctx, canvas: c } = tv;
    ctx.fillStyle = "#06121e"; ctx.fillRect(0, 0, c.width, c.height);
    if (state.showStandings && state.standings && state.standings.length) drawStandings(ctx, c, state);
    else {
      ctx.fillStyle = "#14532d"; ctx.fillRect(0, 96, c.width, 130);
      ctx.strokeStyle = "#ffffff22"; ctx.lineWidth = 2;
      for (let i = 0; i < 10; i++) { ctx.beginPath(); ctx.moveTo(i * 56 + (state.flicker % 56), 96); ctx.lineTo(i * 56 + (state.flicker % 56), 226); ctx.stroke(); }
    }
    ctx.fillStyle = "#0b1320"; ctx.fillRect(0, 0, c.width, 72);
    ctx.font = "bold 34px Impact, sans-serif"; ctx.textBaseline = "middle";
    if (!state.gameNight) {
      ctx.fillStyle = "#e8a33d"; ctx.textAlign = "center";
      ctx.fillText(state.headline || "MAFA TONIGHT — HIGHLIGHTS", c.width / 2, 36);
    } else if (!state.started) {
      ctx.fillStyle = "#e8a33d"; ctx.textAlign = "center";
      ctx.fillText(`${state.usName} ${state.home ? "vs" : "at"} ${state.themName} — PREGAME`, c.width / 2, 36);
    } else {
      ctx.textAlign = "left"; ctx.fillStyle = "#f2e9dc";
      ctx.fillText(`${state.usName} ${state.us}`, 22, 36);
      ctx.fillStyle = "#5aa7d6";
      ctx.fillText(`${state.themName} ${state.them}`, 230, 36);
      ctx.fillStyle = "#ff4e42"; ctx.textAlign = "right";
      ctx.fillText(state.finished ? "FINAL" : state.clockText, c.width - 18, 36);
    }
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(0, (state.flicker * 7) % c.height, c.width, 3);
    tv.tex.needsUpdate = true;
  }
}

/** The standings table, eight rows under the score bug, the Mules' row lit. */
function drawStandings(ctx, c, state) {
  ctx.fillStyle = "#0e1a26"; ctx.fillRect(0, 72, c.width, c.height - 72);
  ctx.font = "bold 20px Impact, sans-serif"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#e8a33d"; ctx.textAlign = "left";
  ctx.fillText(`MAFA STANDINGS — WEEK ${state.week + 1}`, 22, 90);
  ctx.textAlign = "right"; ctx.fillText("W   L", c.width - 22, 90);
  state.standings.forEach((r, i) => {
    const y = 114 + i * 21;
    ctx.fillStyle = r.id === "FVM" ? "#f2e9dc" : "#9fb3c8";
    ctx.textAlign = "left"; ctx.fillText(`${i + 1}. ${r.short.toUpperCase()}${r.streak >= 3 ? `  W${r.streak}` : ""}`, 22, y);
    ctx.textAlign = "right"; ctx.fillText(`${r.w}   ${r.l}`, c.width - 22, y);
  });
}

/** Glowing floor ring marking a walk-up management station. */
export function stationRing(color = 0xe8a33d) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.045, 10, 32), glow(color, 1.2));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.03;
  return ring;
}
