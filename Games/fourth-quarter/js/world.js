// world.js — The Corner Tap, built in meters.
// Floor y=0. Room x∈[-8,8], z∈[-5.5,5.5]. Door mid-south (+z).
// Bar runs along the north wall; kitchen pass window on the east wall.
// Exposes: seats[], colliders[], PASS points, tv scoreboard updater.

import * as THREE from "three";
import { mat, flat, glow } from "./materials.js";

export const ROOM = { x: 8, z: 5.5, h: 3.1 };
export const DOOR = new THREE.Vector3(0, 0, ROOM.z - 0.3);
export const DOOR_OUT = new THREE.Vector3(0, 0, ROOM.z + 1.2);
export const PASS_FOOD  = new THREE.Vector3(ROOM.x - 0.9, 0, 0);      // kitchen window, east wall
export const PASS_DRINK = new THREE.Vector3(1.6, 0, -ROOM.z + 1.55);  // bar service end

export const seats = [];      // {pos:Vector3, approach:Vector3, taken:false, id}
export const colliders = [];  // THREE.Box3 the player can't walk through

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

  // ---- shell ----
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.x * 2, ROOM.z * 2), mat("floorWood"));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.x * 2, ROOM.z * 2), mat("ceiling"));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = ROOM.h; g.add(ceil);

  const wallGeoNS = new THREE.PlaneGeometry(ROOM.x * 2, ROOM.h);
  const wallGeoEW = new THREE.PlaneGeometry(ROOM.z * 2, ROOM.h);
  const mkWall = (geo, m, x, z, ry) => {
    const w = new THREE.Mesh(geo, m);
    w.position.set(x, ROOM.h / 2, z); w.rotation.y = ry; w.receiveShadow = true; g.add(w);
  };
  mkWall(wallGeoNS, mat("wallBrick"), 0, -ROOM.z, 0);            // north (behind bar)
  mkWall(wallGeoNS, mat("wallPlaster"), 0, ROOM.z, Math.PI);     // south (door wall)
  mkWall(wallGeoEW, mat("wallPlaster"), -ROOM.x, 0, Math.PI / 2);// west
  mkWall(wallGeoEW, mat("kitchenTile"), ROOM.x, 0, -Math.PI / 2);// east (kitchen)

  // door frame (visual)
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.3, 0.12), flat(0x241a10, 0.7));
  frame.position.set(0, 1.15, ROOM.z - 0.02); g.add(frame);
  const doorGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.1), glow(0x2b3f66, 0.5));
  doorGlow.position.set(0, 1.1, ROOM.z - 0.09); doorGlow.rotation.y = Math.PI; g.add(doorGlow);

  // ---- the bar (north wall) ----
  const barLen = 8.5;
  const bar = new THREE.Group();
  const counter = new THREE.Mesh(new THREE.BoxGeometry(barLen, 1.1, 0.75), mat("barTop"));
  counter.position.set(-2, 0.55, -ROOM.z + 1.15); counter.castShadow = true; bar.add(counter);
  const kick = new THREE.Mesh(new THREE.BoxGeometry(barLen, 0.12, 0.8), flat(0x120c07));
  kick.position.set(-2, 0.06, -ROOM.z + 1.15); bar.add(kick);
  // back bar shelf + bottles
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(barLen, 0.08, 0.35), mat("barTop"));
  shelf.position.set(-2, 1.5, -ROOM.z + 0.22); bar.add(shelf);
  const bottleCols = [0x7fb069, 0xc46a3a, 0x9a6fb5, 0x5aa7d6, 0xd7b45a];
  for (let i = 0; i < 14; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.32, 8), flat(bottleCols[i % bottleCols.length], 0.25));
    b.position.set(-2 - barLen / 2 + 0.4 + i * 0.55, 1.7, -ROOM.z + 0.22); bar.add(b);
  }
  // taps
  for (let i = 0; i < 3; i++) {
    const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8), flat(0xc9c9c9, 0.3, 0.9));
    tap.position.set(-4 + i * 0.5, 1.28, -ROOM.z + 1.05); bar.add(tap);
  }
  g.add(bar); blockCollider(counter, 0.1);

  // bar stools (patron seats)
  for (let i = 0; i < 6; i++) {
    const x = -5.3 + i * 1.35;
    stool(g, x, -ROOM.z + 1.95);
    addSeat(x, -ROOM.z + 1.95, x, -ROOM.z + 2.6);
  }

  // ---- tables ----
  const tableSpots = [[-5, 0.6], [-1.6, 0.6], [1.9, 0.6], [-5, 3.3], [-1.6, 3.3], [4.8, 2.6]];
  for (const [tx, tz] of tableSpots) table4(g, tx, tz);

  // ---- kitchen pass (east wall) ----
  const passC = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.05, 2.6), mat("barTop"));
  passC.position.set(ROOM.x - 0.45, 0.52, 0); passC.castShadow = true; g.add(passC);
  blockCollider(passC, 0.08);
  const passWin = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.1), glow(0xffb45e, 0.35));
  passWin.position.set(ROOM.x - 0.05, 1.7, 0); passWin.rotation.y = -Math.PI / 2; g.add(passWin);
  const passSign = makeLabel("KITCHEN", 0xe8a33d);
  passSign.position.set(ROOM.x - 0.2, 2.45, 0); passSign.rotation.y = -Math.PI / 2; g.add(passSign);
  const barSign = makeLabel("BAR PICK-UP", 0xe8a33d);
  barSign.position.set(PASS_DRINK.x, 1.85, -ROOM.z + 1.0); g.add(barSign);

  // ---- TVs with live scoreboard canvases ----
  const tvs = [
    tvScreen(g, -4.5, 2.2, -ROOM.z + 0.06, 0),
    tvScreen(g, ROOM.x - 0.06, 2.2, -3.4, -Math.PI / 2),
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

  // ---- lights: night rig (warm pendants) vs day rig (flat daylight) ----
  const nightRig = new THREE.Group(), dayRig = new THREE.Group();
  nightRig.add(new THREE.HemisphereLight(0x8a7a66, 0x14100c, 0.55));
  const warm = [[-4, 0.8], [0, 0.8], [4, 1.8], [-2, -3.2]];
  for (const [lx, lz] of warm) {
    const p = new THREE.PointLight(0xffb45e, 14, 11, 1.9);
    p.position.set(lx, ROOM.h - 0.4, lz); nightRig.add(p);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.22, 12, 1, true), flat(0x1c130b, 0.6));
    cone.position.set(lx, ROOM.h - 0.25, lz); g.add(cone); // shades stay visible day and night
  }
  const key = new THREE.DirectionalLight(0xfff2df, 0.5);
  key.position.set(3, 6, 4); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -9; key.shadow.camera.right = 9;
  key.shadow.camera.top = 7; key.shadow.camera.bottom = -7;
  nightRig.add(key);

  dayRig.add(new THREE.HemisphereLight(0xcfd8e6, 0x4a4038, 1.05));
  const sun = new THREE.DirectionalLight(0xfff6e6, 1.5);
  sun.position.set(-4, 7, 6); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -9; sun.shadow.camera.right = 9;
  sun.shadow.camera.top = 7; sun.shadow.camera.bottom = -7;
  dayRig.add(sun);
  const doorLight = new THREE.PointLight(0xeaf2ff, 8, 8, 1.6); // daylight spilling in the door
  doorLight.position.set(0, 2.2, ROOM.z - 0.6); dayRig.add(doorLight);
  dayRig.visible = false;
  g.add(nightRig); g.add(dayRig);

  scene.add(g);
  return { group: g, tvs, nightRig, dayRig };
}

/** Glowing floor ring marking a walk-up management station. */
export function stationRing(color = 0xe8a33d) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.045, 10, 32), glow(color, 1.2));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.03;
  return ring;
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
  // state: {gameNight, started, finished, win, clockText, mules, sharks, flicker}
  for (const tv of tvs) {
    const { ctx, canvas: c } = tv;
    ctx.fillStyle = "#06121e"; ctx.fillRect(0, 0, c.width, c.height);
    // field
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
    // scanline shimmer
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(0, (state.flicker * 7) % c.height, c.width, 3);
    tv.tex.needsUpdate = true;
  }
}
