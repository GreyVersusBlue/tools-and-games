// render.js — the isometric view. Vanilla canvas, geometric primitives, no
// assets and no offsite requests.
//
// Reads game state and draws it. Never writes to it.

import { TILE } from "./world.js";

const PALETTE = {
  floorA: "#241f2e", floorB: "#282334",
  treasure: "#3a2f14", gateShut: "#141019", gateOpen: "#20303a",
  wallTop: "#3a3448", wallLeft: "#231f2d", wallRight: "#2c2738",
  doorTop: "#4a3b18", doorLeft: "#332a12", doorRight: "#3d3115",
  pillarTop: "#4d4560", pillarLeft: "#312b40", pillarRight: "#3b3450",
  pcTop: "#3f6ea8", pcLeft: "#26456b", pcRight: "#315687",
  foeTop: "#8a3a46", foeLeft: "#57242c", foeRight: "#6e2e38",
  bossTop: "#6f4a8a", bossLeft: "#422b52", bossRight: "#573a6e",
  stairs: "#1c2c22",
  gold: "#d4a843", goldDim: "#8a6f2e",
  fog: "rgba(12,11,16,.62)",
  hpBack: "#0c0b10", hpPC: "#4f9e5f", hpFoe: "#b03a48",
  ember: "#e07a3a", afflicted: "#c26b78",
};

export function createRenderer(canvas, game) {
  const ctx = canvas.getContext("2d");
  // The current area, refreshed at the top of every drawFrame() call. A
  // stairway swaps game.area out from under the renderer mid-session, and a
  // value captured once here at construction would keep drawing the room the
  // PC left.
  let area = game.area;

  // Tile diamond, 2:1. Recomputed on every resize so the whole board fits.
  let tw = 56, th = 28;
  let originX = 0, originY = 0;
  let cssW = 0, cssH = 0, dpr = 1;

  let hover = null;      // { x, y } under the pointer
  let cursor = null;     // { x, y } keyboard cursor, drawn differently
  let aim = null;        // { x, y } armed-command preview origin
  let sizedForArea = null;   // id of the area tw/th/origin were last fit to

  /**
   * Match the backing store to the CSS box.
   *
   * The single-file build read `clientWidth` exactly once at boot and then only
   * again on a `window.resize` event. Anything that changed the canvas box
   * without a window resize — a first layout that had not happened yet, a panel
   * opening, a devicePixelRatio change from dragging to another monitor — left
   * the projection permanently wrong, and there is no recovery path because
   * nothing measures again. Observed on a real page load: a 700×720 canvas with
   * a 0×0 backing store, `originX` of 0, and every tile drawn off the left edge.
   *
   * So: measure every frame, and only touch the canvas when something moved.
   * Returns true if it resized.
   */
  function syncSize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    const wantW = Math.round(w * ratio), wantH = Math.round(h * ratio);

    // Compare against the backing store itself rather than a cached copy of the
    // CSS box. Caching the box detects the boot race but not a backing store
    // that went wrong some other way, and a renderer that cannot notice its own
    // canvas is the wrong size is the bug this function exists for. A stairway
    // can also change the board's own dimensions without the CSS box moving at
    // all, so an area change forces the same recompute a resize would.
    if (canvas.width === wantW && canvas.height === wantH && ratio === dpr
      && w === cssW && sizedForArea === area.id) return false;
    cssW = w; cssH = h; dpr = ratio; sizedForArea = area.id;
    if (!w || !h) return false;           // not laid out yet; try again next frame

    canvas.width = wantW;
    canvas.height = wantH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Fit the whole board with a margin, rather than trusting a fixed tile size
    // to suit the viewport. The board is (W+H) half-tiles across each way.
    const spanX = (area.width + area.height) / 2;
    const spanY = (area.width + area.height) / 2;
    const fitW = (w - 24) / spanX;
    const fitH = (h - 48) / spanY;
    tw = Math.max(14, Math.min(56, Math.min(fitW, fitH * 2)));
    th = tw / 2;

    originX = w / 2 + (area.height - area.width) * tw / 4;
    originY = (h - spanY * th) / 2 + th;
    return true;
  }

  const isoX = (x, y) => originX + (x - y) * tw / 2;
  const isoY = (x, y) => originY + (x + y) * th / 2;

  /** Screen pixels → grid square. The inverse of the projection above. */
  function screenToGrid(px, py) {
    const rx = (px - originX) / (tw / 2), ry = (py - originY) / (th / 2);
    return { x: Math.round((rx + ry) / 2), y: Math.round((ry - rx) / 2) };
  }

  function diamond(cx, cy, w, h) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - h / 2); ctx.lineTo(cx + w / 2, cy);
    ctx.lineTo(cx, cy + h / 2); ctx.lineTo(cx - w / 2, cy);
    ctx.closePath();
  }

  /** Extruded prism: a top diamond raised by `ht`, with two side faces. */
  function prism(x, y, ht, top, left, right, scale = 1) {
    const cx = isoX(x, y), cy = isoY(x, y);
    const w = tw * scale, h = th * scale;
    ctx.fillStyle = left; ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy); ctx.lineTo(cx, cy + h / 2);
    ctx.lineTo(cx, cy + h / 2 - ht); ctx.lineTo(cx - w / 2, cy - ht);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = right; ctx.beginPath();
    ctx.moveTo(cx + w / 2, cy); ctx.lineTo(cx, cy + h / 2);
    ctx.lineTo(cx, cy + h / 2 - ht); ctx.lineTo(cx + w / 2, cy - ht);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = top; diamond(cx, cy - ht, w, h); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 1; ctx.stroke();
  }

  function outline(x, y, colour, width, scale = 1) {
    diamond(isoX(x, y), isoY(x, y), tw * scale, th * scale);
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  function drawFrame() {
    area = game.area;
    syncSize();
    if (!cssW || !cssH) return;
    ctx.clearRect(0, 0, cssW, cssH);

    const visible = game.visible, explored = game.explored;
    const gateOpen = game.run.gateOpen;
    const scale = tw / 56;   // keep furniture proportional at small tile sizes

    // Pass 1 — the floor, back to front.
    for (let y = 0; y < area.height; y++) {
      for (let x = 0; x < area.width; x++) {
        const k = x + "," + y;
        const vis = visible.has(k), seen = explored.has(k);
        if (!vis && !seen) continue;                 // never seen: the void
        const t = area.tiles[y][x];
        if (t === TILE.WALL) continue;               // a prism in pass 2
        const cx = isoX(x, y), cy = isoY(x, y);
        let fill = ((x + y) % 2 === 0) ? PALETTE.floorA : PALETTE.floorB;
        if (t === TILE.TREASURE) fill = PALETTE.treasure;
        if (t === TILE.GATE) fill = gateOpen ? PALETTE.gateOpen : PALETTE.gateShut;
        if (t === TILE.STAIRS) fill = PALETTE.stairs;
        diamond(cx, cy, tw, th);
        ctx.fillStyle = fill; ctx.fill();
        ctx.strokeStyle = vis ? "rgba(212,168,67,.10)" : "rgba(80,75,95,.15)";
        ctx.stroke();
        if (!vis) { ctx.fillStyle = PALETTE.fog; ctx.fill(); }
        if (vis && t === TILE.TREASURE) {
          ctx.fillStyle = PALETTE.gold;
          diamond(cx, cy - 8 * scale, 14 * scale, 7 * scale); ctx.fill();
        }
        if (vis && t === TILE.STAIRS) {
          // Two nested diamonds reading as a stairway seen from above, rather
          // than a plain floor square that happens to teleport you.
          ctx.strokeStyle = "rgba(212,168,67,.55)"; ctx.lineWidth = 1.5;
          diamond(cx, cy, tw * 0.6, th * 0.6); ctx.stroke();
          diamond(cx, cy, tw * 0.3, th * 0.3); ctx.stroke();
          ctx.lineWidth = 1;
        }
      }
    }

    // Reachability highlight for whichever square is being pointed at.
    for (const [mark, colour, width] of [[hover, PALETTE.gold, 1.5], [cursor, "#7fa9d4", 2]]) {
      if (!mark) continue;
      if (!explored.has(mark.x + "," + mark.y)) continue;
      outline(mark.x, mark.y, colour, width);
    }

    // The cone preview, so a 15-ft cone is something you aim rather than guess.
    if (aim && game.mode === "combat") {
      const p = game.run.pc;
      const ang = Math.atan2(aim.y - p.y, aim.x - p.x);
      for (let y = 0; y < area.height; y++) {
        for (let x = 0; x < area.width; x++) {
          if (!visible.has(x + "," + y)) continue;
          const dx = x - p.x, dy = y - p.y;
          if (!dx && !dy) continue;
          const feet = Math.max(Math.abs(dx), Math.abs(dy)) * 5
            + Math.floor(Math.min(Math.abs(dx), Math.abs(dy)) / 2) * 5;
          if (feet > 15) continue;
          let da = Math.atan2(dy, dx) - ang;
          while (da > Math.PI) da -= 2 * Math.PI;
          while (da < -Math.PI) da += 2 * Math.PI;
          if (Math.abs(da) > Math.PI / 4 + 0.01) continue;
          diamond(isoX(x, y), isoY(x, y), tw, th);
          ctx.fillStyle = "rgba(212,101,127,.22)"; ctx.fill();
        }
      }
    }

    // Pass 2 — depth-sorted solids.
    const solids = [];
    for (let y = 0; y < area.height; y++) {
      for (let x = 0; x < area.width; x++) {
        const k = x + "," + y;
        if (!visible.has(k) && !explored.has(k)) continue;
        const t = area.tiles[y][x];
        if (t === TILE.WALL) solids.push({ x, y, kind: "wall" });
        if (t === TILE.PILLAR) solids.push({ x, y, kind: "pillar", lore: area.pillars[k] });
        if (t === TILE.GATE && !gateOpen) solids.push({ x, y, kind: "gate" });
      }
    }
    const pc = game.run.pc;
    solids.push({ x: pc.x, y: pc.y, kind: "pc" });
    for (const c of game.living()) {
      if (visible.has(c.x + "," + c.y)) solids.push({ x: c.x, y: c.y, kind: "foe", creature: c });
    }
    solids.sort((a, b) => (a.x + a.y) - (b.x + b.y));

    const current = game.currentActor;

    for (const s of solids) {
      const dim = !visible.has(s.x + "," + s.y);
      ctx.globalAlpha = dim ? 0.35 : 1;

      if (s.kind === "wall") prism(s.x, s.y, 26 * scale, PALETTE.wallTop, PALETTE.wallLeft, PALETTE.wallRight);
      if (s.kind === "gate") prism(s.x, s.y, 30 * scale, PALETTE.doorTop, PALETTE.doorLeft, PALETTE.doorRight);

      if (s.kind === "pillar") {
        prism(s.x, s.y, 40 * scale, PALETTE.pillarTop, PALETTE.pillarLeft, PALETTE.pillarRight, 0.72);
        ctx.fillStyle = game.run.loreRead.includes(s.lore) ? PALETTE.goldDim : PALETTE.gold;
        diamond(isoX(s.x, s.y), isoY(s.x, s.y) - 46 * scale, 12 * scale, 6 * scale);
        ctx.fill();
      }

      if (s.kind === "pc") {
        const cx = isoX(s.x, s.y), cy = isoY(s.x, s.y);
        prism(s.x, s.y, 20 * scale, PALETTE.pcTop, PALETTE.pcLeft, PALETTE.pcRight, 0.55);
        ctx.fillStyle = PALETTE.gold;
        diamond(cx, cy - 27 * scale, 10 * scale, 5 * scale); ctx.fill();
        if (game.shielded) {
          // The Shield cantrip, visible: a disc of force at arm's length.
          ctx.strokeStyle = "rgba(127,169,212,.85)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx, cy - 14 * scale, 13 * scale, 0, Math.PI * 2); ctx.stroke();
          ctx.lineWidth = 1;
        }
        bar(cx, cy - 38 * scale, game.run.pc.hp / game.content.pc.hp, PALETTE.hpPC, scale);
        mark(cx, cy - 46 * scale, game.conditionsOf("pc"), scale);
        if (current === "pc") outline(s.x, s.y, PALETTE.gold, 1.5, 0.9);
      }

      if (s.kind === "foe") {
        const c = s.creature, d = game.def(c);
        const cx = isoX(s.x, s.y), cy = isoY(s.x, s.y);
        const boss = d.level >= 0;
        prism(s.x, s.y, (boss ? 24 : 18) * scale,
          boss ? PALETTE.bossTop : PALETTE.foeTop,
          boss ? PALETTE.bossLeft : PALETTE.foeLeft,
          boss ? PALETTE.bossRight : PALETTE.foeRight, boss ? 0.62 : 0.55);
        // A dormant creature has no lit eye — that is the whole tell for "this
        // one has not seen you yet", and it is the difference between one fight
        // and two.
        if (c.awake) {
          ctx.fillStyle = "#e0c56a";
          ctx.beginPath(); ctx.arc(cx, cy - (boss ? 16 : 12) * scale, 2.6 * scale, 0, Math.PI * 2);
          ctx.fill();
          bar(cx, cy - (boss ? 40 : 34) * scale, c.hp / d.hp, PALETTE.hpFoe, scale);
          mark(cx, cy - (boss ? 48 : 42) * scale, game.conditionsOf(c), scale);
        } else {
          ctx.strokeStyle = "rgba(140,130,150,.5)";
          ctx.beginPath(); ctx.arc(cx, cy - (boss ? 16 : 12) * scale, 2.6 * scale, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (current === c.key) outline(s.x, s.y, PALETTE.gold, 1.5, 0.9);
      }

      ctx.globalAlpha = 1;
    }
  }

  /**
   * One pip over an afflicted actor.
   *
   * Not one pip per condition: the sheet's chips are where a player reads
   * what and how much, and a row of pips over a 34-pixel-wide creature is
   * unreadable at every zoom the board has. This says only "something is
   * stuck to this one", in ember if it is burning, because that is the one
   * the player has to act on before the end of a turn. The Shield cantrip is
   * already drawn as a disc and is not an affliction, so it is not counted.
   */
  function mark(cx, top, bag, scale) {
    const real = bag.filter(c => c.id !== "shielded");
    if (!real.length) return;
    ctx.fillStyle = real.some(c => c.id === "persistent-fire") ? PALETTE.ember : PALETTE.afflicted;
    diamond(cx, top, 8 * scale, 5 * scale);
    ctx.fill();
  }

  function bar(cx, top, pct, colour, scale) {
    const w = 34 * scale, h = 5 * scale;
    ctx.fillStyle = PALETTE.hpBack;
    ctx.fillRect(cx - w / 2, top, w, h);
    ctx.fillStyle = colour;
    ctx.fillRect(cx - w / 2 + 1, top + 1, (w - 2) * Math.max(0, Math.min(1, pct)), h - 2);
  }

  let raf = null;
  function loop() { drawFrame(); raf = requestAnimationFrame(loop); }

  return {
    start() { if (raf === null) loop(); },
    stop() { if (raf !== null) cancelAnimationFrame(raf); raf = null; },
    /** Draw one frame now, whatever the animation loop is doing. */
    draw: drawFrame,
    screenToGrid,
    setHover(t) { hover = t; },
    setCursor(t) { cursor = t; },
    setAim(t) { aim = t; },
    get tileSize() { return { tw, th }; },
  };
}
