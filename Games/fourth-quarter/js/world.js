// world.js — The Corner Tap, built in meters.
// Floor y=0. Main room x∈[-8,8], z∈[-5.5,5.5]; door mid-south (+z).
// The bar runs along the north wall with a wide service lane behind it.
// Behind the north wall: the KITCHEN (x∈[1,8], z∈[-9,-5.5]) — reached
// through a doorway east of the bar, with a pass-through window where
// food lands. Exposes: seats[], colliders[], pass points, inBounds().

import * as THREE from "three";
import { mat, flat, glow } from "./materials.js";

export const ROOM = { x: 8, z: 5.5, h: 3.1 };
export const KITCHEN = { x0: 1, x1: 8, z0: -9, z1: -5.5 };
const WALL_T = 0.15;                 // north wall thickness (visible from both sides)
const DOORWAY = { x0: 2.1, x1: 3.7 }; // gap in the north wall
const WINDOW = { x0: 4.5, x1: 6.2, y0: 1.05, y1: 2.05 }; // pass-through opening

export const DOOR = new THREE.Vector3(0, 0, ROOM.z - 0.3);
export const DOOR_OUT = new THREE.Vector3(0, 0, ROOM.z + 1.2);

// carrier stand-points (walk here, press E / deliver from here)
export const PASS_FOOD  = new THREE.Vector3(5.35, 0, -4.7);   // main-room side of the window
export const PASS_DRINK = new THREE.Vector3(0.2, 0, -2.85);   // east end of the bar front
// where ready items physically sit (spread along x)
export const PASS_FOOD_SHELF  = new THREE.Vector3(5.35, 1.12, -5.5);
export const PASS_DRINK_SHELF = new THREE.Vector3(-0.3, 1.16, -3.8);
// where the player actually cooks/pours — distinct from the pickup counters above
export const STOVE_STATION = new THREE.Vector3(6.1, 0, -7.7);   // in front of the kitchen stove
export const TAP_STATION   = new THREE.Vector3(-5.5, 0, -2.85); // west end of the bar front

export const seats = [];
export const colliders = [];
export const UPGRADES_STATION = new THREE.Vector3(-6.6, 0, -1.6);

/** Walkable test: main room ∪ kitchen ∪ the doorway corridor joining them. */
export function inBounds(x, z, r = 0.3) {
  const main = x > -ROOM.x + r && x < ROOM.x - r && z > -ROOM.z + r && z < ROOM.z - r;
  const corridor = x > DOORWAY.x0 + r && x < DOORWAY.x1 - r && z > -6.0 && z < -4.8;
  const kitchen = x > KITCHEN.x0 + r && x < KITCHEN.x1 - r && z > KITCHEN.z0 + r && z < -ROOM.z - WALL_T / 2;
  return main || corridor || kitchen;
}

let seatId = 0;
function addSeat(x, z, ax, az) {
  seats.push({ id: ++seatId, pos: new THREE.Vector3(x, 0, z), approach: new THREE.Vector3(ax, 0, az), taken: false });
}
function blockCollider(mesh, pad = 0.05) {
  mesh.updateWorldMatrix(true, false);
  const box = new THREE.Box3().setFromObject(mesh);
  box.expandByScalar(pad);
  box.min.y = 0; box.max.y = 2.5;
  colliders.push(box);
}

export function buildWorld(scene) {
  const g = new THREE.Group();

  // ---- floors & ceilings ----
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.x * 2, ROOM.z * 2), mat("floorWood"));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
  const kW = KITCHEN.x1 - KITCHEN.x0, kD = KITCHEN.z1 - KITCHEN.z0;
  const kFloor = new THREE.Mesh(new THREE.PlaneGeometry(kW, kD), mat("kitchenTile"));
  kFloor.rotation.x = -Math.PI / 2;
  kFloor.position.set((KITCHEN.x0 + KITCHEN.x1) / 2, 0, (KITCHEN.z0 + KITCHEN.z1) / 2);
  kFloor.receiveShadow = true; g.add(kFloor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.x * 2, ROOM.z * 2), mat("ceiling"));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = ROOM.h; g.add(ceil);
  const kCeil = new THREE.Mesh(new THREE.PlaneGeometry(kW, kD), mat("ceiling"));
  kCeil.rotation.x = Math.PI / 2;
  kCeil.position.set((KITCHEN.x0 + KITCHEN.x1) / 2, ROOM.h, (KITCHEN.z0 + KITCHEN.z1) / 2);
  g.add(kCeil);

  // ---- main room walls (south/east/west stay planes facing in) ----
  const mkWall = (geo, m, x, z, ry) => {
    const w = new THREE.Mesh(geo, m);
    w.position.set(x, ROOM.h / 2, z); w.rotation.y = ry; w.receiveShadow = true; g.add(w);
  };
  mkWall(new THREE.PlaneGeometry(ROOM.x * 2, ROOM.h), mat("wallPlaster"), 0, ROOM.z, Math.PI);
  mkWall(new THREE.PlaneGeometry(ROOM.z * 2, ROOM.h), mat("wallPlaster"), -ROOM.x, 0, Math.PI / 2);
  mkWall(new THREE.PlaneGeometry(ROOM.z * 2, ROOM.h), mat("wallPlaster"), ROOM.x, 0, -Math.PI / 2);

  // ---- north wall: brick boxes with a doorway gap and a pass window ----
  const nz = -ROOM.z;
  const brickBox = (x0, x1, y0, y1) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, WALL_T), mat("wallBrick"));
    b.position.set((x0 + x1) / 2, (y0 + y1) / 2, nz);
    b.receiveShadow = true; b.castShadow = true; g.add(b);
    return b;
  };
  brickBox(-ROOM.x, DOORWAY.x0, 0, ROOM.h);                 // west span (behind the bar)
  brickBox(DOORWAY.x0, DOORWAY.x1, 2.2, ROOM.h);            // header above the doorway
  brickBox(DOORWAY.x1, WINDOW.x0, 0, ROOM.h);               // between doorway and window
  brickBox(WINDOW.x0, WINDOW.x1, 0, WINDOW.y0);             // below the window
  brickBox(WINDOW.x0, WINDOW.x1, WINDOW.y1, ROOM.h);        // above the window
  brickBox(WINDOW.x1, ROOM.x, 0, ROOM.h);                   // east span
  // doorway frame
  const frameM = flat(0x241a10, 0.7);
  for (const fx of [DOORWAY.x0, DOORWAY.x1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.2, WALL_T + 0.08), frameM);
    post.position.set(fx, 1.1, nz); g.add(post);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(DOORWAY.x1 - DOORWAY.x0 + 0.1, 0.1, WALL_T + 0.08), frameM);
  lintel.position.set((DOORWAY.x0 + DOORWAY.x1) / 2, 2.2, nz); g.add(lintel);

  // pass-through sill (both sides of the wall) — where food lands
  const sill = new THREE.Mesh(new THREE.BoxGeometry(WINDOW.x1 - WINDOW.x0 + 0.2, 0.08, 0.7), mat("barTop"));
  sill.position.set((WINDOW.x0 + WINDOW.x1) / 2, WINDOW.y0, nz);
  sill.castShadow = true; g.add(sill);
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

  // ---- kitchen fit-out ----
  const prep = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.95, 0.9), mat("metal"));
  prep.position.set(2.6, 0.475, -7.3); prep.castShadow = true; g.add(prep); blockCollider(prep, 0.08);
  const stove = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.95, 0.85), mat("metal"));
  stove.position.set(6.4, 0.475, -8.45); stove.castShadow = true; g.add(stove); blockCollider(stove, 0.08);
  for (let i = 0; i < 4; i++) {
    const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.02, 12), glow(0xff5a2b, 0.9));
    burner.position.set(6.05 + (i % 2) * 0.7, 0.96, -8.62 + Math.floor(i / 2) * 0.36);
    g.add(burner);
  }
  const kShelf = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.35), mat("barTop"));
  kShelf.position.set(2.4, 1.7, -8.75); g.add(kShelf);
  for (let i = 0; i < 6; i++) {
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 10), flat(0xb8b2a6, 0.5, 0.4));
    can.position.set(1.55 + i * 0.34, 1.83, -8.75); g.add(can);
  }
  const kLight = new THREE.PointLight(0xfff0dc, 10, 9, 1.8); // kitchen never goes dark
  kLight.position.set(4.5, ROOM.h - 0.4, -7.2); g.add(kLight);
  const heat = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW.x1 - WINDOW.x0 - 0.1, WINDOW.y1 - WINDOW.y0 - 0.1), glow(0xffb45e, 0.25));
  heat.position.set((WINDOW.x0 + WINDOW.x1) / 2, (WINDOW.y0 + WINDOW.y1) / 2, KITCHEN.z0 + 0.16);
  g.add(heat); // warm glow on the kitchen back wall

  // door frame (front entrance, visual)
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.3, 0.12), flat(0x241a10, 0.7));
  frame.position.set(0, 1.15, ROOM.z - 0.02); g.add(frame);
  const doorGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.1), glow(0x2b3f66, 0.5));
  doorGlow.position.set(0, 1.1, ROOM.z - 0.09); doorGlow.rotation.y = Math.PI; g.add(doorGlow);

  // ---- the bar (pulled off the wall — a real lane behind it) ----
  const barLen = 7, barX = -2.75, barZ = -3.8; // back edge -4.175 → 1.25 m lane to the wall
  const counter = new THREE.Mesh(new THREE.BoxGeometry(barLen, 1.1, 0.75), mat("barTop"));
  counter.position.set(barX, 0.55, barZ); counter.castShadow = true; g.add(counter);
  const kick = new THREE.Mesh(new THREE.BoxGeometry(barLen, 0.12, 0.8), flat(0x120c07));
  kick.position.set(barX, 0.06, barZ); g.add(kick);
  blockCollider(counter, 0.1);
  // back bar shelf + bottles, on the north wall behind the lane
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(barLen, 0.08, 0.35), mat("barTop"));
  shelf.position.set(barX, 1.5, nz + WALL_T / 2 + 0.2); g.add(shelf);
  const bottleCols = [0x7fb069, 0xc46a3a, 0x9a6fb5, 0x5aa7d6, 0xd7b45a];
  for (let i = 0; i < 12; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.32, 8), flat(bottleCols[i % bottleCols.length], 0.25));
    b.position.set(barX - barLen / 2 + 0.4 + i * 0.56, 1.7, nz + WALL_T / 2 + 0.2); g.add(b);
  }
  for (let i = 0; i < 3; i++) {
    const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8), flat(0xc9c9c9, 0.3, 0.9));
    tap.position.set(-4.2 + i * 0.5, 1.28, barZ - 0.1); g.add(tap);
  }
  const barSign = makeLabel("BAR PICK-UP", 0xe8a33d);
  barSign.position.set(PASS_DRINK.x, 1.75, barZ + 0.4); g.add(barSign);

  // bar stools (patron seats), along the new counter front
  for (let i = 0; i < 6; i++) {
    const x = -5.6 + i * 1.18;
    stool(g, x, -3.05);
    addSeat(x, -3.05, x, -2.4);
  }

  const stoveRing = stationRing(0xff5a2b);
  stoveRing.position.set(STOVE_STATION.x, 0.02, STOVE_STATION.z); stoveRing.scale.setScalar(0.7);
  g.add(stoveRing);
  const tapRing = stationRing(0x5aa7d6);
  tapRing.position.set(TAP_STATION.x, 0.02, TAP_STATION.z); tapRing.scale.setScalar(0.7);
  g.add(tapRing);

  // ---- tables ----
  const tableSpots = [[-5, 0.9], [-1.6, 0.9], [1.9, 0.9], [-5, 3.4], [-1.6, 3.4], [4.9, 2.6]];
  for (const [tx, tz] of tableSpots) table4(g, tx, tz);

  // ---- TVs with live scoreboard canvases ----
  const tvs = [
    tvScreen(g, -4.5, 2.35, nz + WALL_T / 2 + 0.02, 0),
    tvScreen(g, ROOM.x - 0.06, 2.2, -2.6, -Math.PI / 2),
    tvScreen(g, -ROOM.x + 0.06, 2.2, 0.5, Math.PI / 2),
  ];

  // ---- neon sign ----
  const neon = makeLabel("THE FOURTH QUARTER", 0xff4e42, 512, 44);
  neon.scale.multiplyScalar(1.6);
  neon.position.set(0, 2.6, ROOM.z - 0.08); neon.rotation.y = Math.PI; g.add(neon);

  // ---- corkboard (promo station, south wall by the door) ----
  const cork = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.0, 0.05), flat(0x8a6a42, 0.95));
  cork.position.set(-3.2, 1.6, ROOM.z - 0.05); g.add(cork);
  const corkFrame = new THREE.Mesh(new THREE.BoxGeometry(1.62, 1.12, 0.04), flat(0x2e1d10, 0.7));
  corkFrame.position.set(-3.2, 1.6, ROOM.z - 0.03); g.add(corkFrame);
  for (let i = 0; i < 5; i++) {
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.28),
      flat([0xf2e9dc, 0xe8d27a, 0xa8c8e0][i % 3], 1));
    note.position.set(-3.75 + (i % 3) * 0.55, 1.75 - Math.floor(i / 3) * 0.4, ROOM.z - 0.07);
    note.rotation.z = (Math.random() - 0.5) * 0.2; note.rotation.y = Math.PI;
    g.add(note);
  }

  // ---- upgrade crates (workshop station, west wall) ----
  const crateM = mat("metal");
  const crate1 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.6), crateM);
  crate1.position.set(UPGRADES_STATION.x, 0.3, UPGRADES_STATION.z - 0.5);
  crate1.castShadow = true; g.add(crate1); blockCollider(crate1, 0.06);
  const crate2 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.55), flat(0x5a4632, 0.8));
  crate2.position.set(UPGRADES_STATION.x + 0.5, 0.25, UPGRADES_STATION.z - 0.35);
  crate2.rotation.y = 0.3; crate2.castShadow = true; g.add(crate2); blockCollider(crate2, 0.06);
  const toolSign = makeLabel("UPGRADES", 0x9a6fb5);
  toolSign.scale.multiplyScalar(0.55);
  toolSign.position.set(UPGRADES_STATION.x + 0.2, 1.35, UPGRADES_STATION.z - 0.9);
  g.add(toolSign);

  // ---- lights: night rig (warm pendants) vs day rig (flat daylight) ----
  const nightRig = new THREE.Group(), dayRig = new THREE.Group();
  nightRig.add(new THREE.HemisphereLight(0x8a7a66, 0x14100c, 0.6));
  const warm = [[-4, 0.8], [0, 0.8], [4, 1.8], [-2, -3.2], [5.3, -4.4]];
  for (const [lx, lz] of warm) {
    const p = new THREE.PointLight(0xffb45e, 14, 11, 1.9);
    p.position.set(lx, ROOM.h - 0.4, lz); nightRig.add(p);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.22, 12, 1, true), flat(0x1c130b, 0.6));
    cone.position.set(lx, ROOM.h - 0.25, lz); g.add(cone);
  }
  const key = new THREE.DirectionalLight(0xfff2df, 0.5);
  key.position.set(3, 6, 4); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -9; key.shadow.camera.right = 9;
  key.shadow.camera.top = 7; key.shadow.camera.bottom = -10;
  nightRig.add(key);

  dayRig.add(new THREE.HemisphereLight(0xdde6f2, 0x5a5048, 1.35));
  const sun = new THREE.DirectionalLight(0xfff6e6, 1.8);
  sun.position.set(-4, 7, 6); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -9; sun.shadow.camera.right = 9;
  sun.shadow.camera.top = 7; sun.shadow.camera.bottom = -10;
  dayRig.add(sun);
  const doorLight = new THREE.PointLight(0xeaf2ff, 8, 8, 1.6);
  doorLight.position.set(0, 2.2, ROOM.z - 0.6); dayRig.add(doorLight);
  dayRig.visible = false;
  g.add(nightRig); g.add(dayRig);

  scene.add(g);
  return { group: g, tvs, nightRig, dayRig };
}

function stool(g, x, z) {
  const s = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.07, 14), mat("leather"));
  top.position.y = 0.72; top.castShadow = true; s.add(top);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.7, 8), flat(0x2a2a2e, 0.4, 0.8));
  leg.position.y = 0.36; s.add(leg);
  s.position.set(x, 0, z); g.add(s);
}

function table4(g, x, z) {
  const t = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 20), mat("tableTop"));
  top.position.y = 0.92; top.castShadow = true; t.add(top);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.9, 10), flat(0x1c130b, 0.5));
  leg.position.y = 0.45; t.add(leg);
  t.position.set(x, 0, z); g.add(t);
  blockCollider(top, 0.12);
  const R = 0.95;
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 2) * i + Math.PI / 4;
    const sx = x + Math.cos(a) * R, sz = z + Math.sin(a) * R;
    stool(g, sx, sz);
    addSeat(sx, sz, x + Math.cos(a) * (R + 0.55), z + Math.sin(a) * (R + 0.55));
  }
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
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.95, 1.15, 0.08), flat(0x0a0a0a, 0.4));
  frame.position.set(x, y, z); frame.rotation.y = ry; g.add(frame);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.0),
    new THREE.MeshBasicMaterial({ map: tex }));
  screen.position.set(x, y, z); screen.rotation.y = ry;
  screen.translateZ(0.05); g.add(screen);
  const light = new THREE.PointLight(0x8fb7ff, 2.2, 4.5, 2);
  light.position.copy(screen.position); light.translateZ(0.4); g.add(light);
  return { canvas: c, ctx, tex };
}

/** Redraw all TVs with the current fake broadcast state. Cheap; call ~2×/sec. */
export function drawBroadcast(tvs, state) {
  for (const tv of tvs) {
    const { ctx, canvas: c } = tv;
    ctx.fillStyle = "#06121e"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#14532d"; ctx.fillRect(0, 96, c.width, 130);
    ctx.strokeStyle = "#ffffff22"; ctx.lineWidth = 2;
    for (let i = 0; i < 10; i++) { ctx.beginPath(); ctx.moveTo(i * 56 + (state.flicker % 56), 96); ctx.lineTo(i * 56 + (state.flicker % 56), 226); ctx.stroke(); }
    ctx.fillStyle = "#0b1320"; ctx.fillRect(0, 0, c.width, 72);
    ctx.font = "bold 34px Impact, sans-serif"; ctx.textBaseline = "middle";
    if (!state.gameNight) {
      ctx.fillStyle = "#e8a33d"; ctx.textAlign = "center";
      ctx.fillText("MAFA TONIGHT — HIGHLIGHTS", c.width / 2, 36);
    } else if (!state.started) {
      ctx.fillStyle = "#e8a33d"; ctx.textAlign = "center";
      ctx.fillText("MULES vs SHARKS — PREGAME", c.width / 2, 36);
    } else {
      ctx.textAlign = "left"; ctx.fillStyle = "#f2e9dc";
      ctx.fillText(`MULES ${state.mules}`, 22, 36);
      ctx.fillStyle = "#5aa7d6";
      ctx.fillText(`SHARKS ${state.sharks}`, 210, 36);
      ctx.fillStyle = "#ff4e42"; ctx.textAlign = "right";
      ctx.fillText(state.finished ? "FINAL" : state.clockText, c.width - 18, 36);
    }
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(0, (state.flicker * 7) % c.height, c.width, 3);
    tv.tex.needsUpdate = true;
  }
}

/** Glowing floor ring marking a walk-up management station. */
export function stationRing(color = 0xe8a33d) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.045, 10, 32), glow(color, 1.2));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.03;
  return ring;
}
