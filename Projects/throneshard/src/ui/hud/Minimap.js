import { el, toImageURL } from '../util.js';
import { LANES, MAP_HALF, THRONESHARD, GRIMMAW_LAIR, NEUTRAL_CAMPS, SHOPS, FOUNTAIN } from '../../core/constants.js';

const RES = 2; // internal pixel density multiplier

export class Minimap {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.size = 244;
    this.node = el('div', 'hud-minimap panel-frame', `<canvas></canvas><div class="mm-corner tl"></div><div class="mm-corner br"></div>`);
    this.canvas = this.node.querySelector('canvas');
    this.canvas.width = this.canvas.height = this.size * RES;
    this.ctx = this.canvas.getContext('2d');
    this.base = null;
    this.fog = document.createElement('canvas');
    this.fog.width = this.fog.height = 128;
    this.fogCtx = this.fog.getContext('2d');
    this.pings = [];
    this.acc = 0;
    this.dragging = false;
    this.bindInput();
  }

  // world -> minimap px (internal canvas coordinates)
  mx(x) { return ((x + MAP_HALF) / (MAP_HALF * 2)) * this.canvas.width; }
  mz(z) { return ((z + MAP_HALF) / (MAP_HALF * 2)) * this.canvas.height; }

  eventToWorld(e) {
    const r = this.canvas.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fz = (e.clientY - r.top) / r.height;
    return { x: (fx * 2 - 1) * MAP_HALF, z: (fz * 2 - 1) * MAP_HALF };
  }

  bindInput() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const w = this.eventToWorld(e);
      if (e.button === 0 && e.altKey) { this.ping(w.x, w.z, true); return; }
      if (e.button === 0) {
        this.dragging = true;
        c.setPointerCapture(e.pointerId);
        this.focus(w.x, w.z);
      } else if (e.button === 2) {
        const hero = this.game.player.hero;
        if (hero?.alive && this.game.THREE) {
          const p = new this.game.THREE.Vector3(w.x, 0, w.z);
          hero.issueOrder({ type: e.ctrlKey || this.game.input?.attackMoveArmed ? 'attackMove' : 'move', point: p }, e.shiftKey);
          this.game.vfx?.spawn?.('move_marker', { position: p });
          this.pings.push({ x: w.x, z: w.z, t: 0, dur: 0.6, color: '#7dff6a', small: true });
        }
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const w = this.eventToWorld(e);
      this.focus(w.x, w.z);
    });
    const end = () => { this.dragging = false; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  focus(x, z) {
    const g = this.game;
    if (g.cameraCtl?.focus) { try { g.cameraCtl.focus(x, z); } catch { /* ignore */ } }
    else if (g.camera) {
      const t = this.cameraTarget();
      if (t) { g.camera.position.x += x - t.x; g.camera.position.z += z - t.z; }
    }
    g.bus.emit('camera:focus', { x, z, source: 'minimap' });
  }

  ping(x, z, emit) {
    this.pings.push({ x, z, t: 0, dur: 3, color: '#ffd84a' });
    if (emit) {
      this.game.bus.emit('minimap:ping', { x, z, team: this.game.player.team, source: 'ui' });
      this.game.audio?.play?.('ping');
      this.ui.notify?.message?.('Ping!', '#ffd84a', 1.2);
    }
  }

  cameraTarget() {
    const g = this.game, THREE = g.THREE;
    if (!THREE || !g.camera) return null;
    const ray = this._ray ?? (this._ray = new THREE.Raycaster());
    const plane = this._plane ?? (this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
    ray.setFromCamera(new THREE.Vector2(0, 0), g.camera);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, p) ? p : null;
  }

  buildBase() {
    const S = this.canvas.width;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const c = cv.getContext('2d');
    const img = this.game.world?.getMinimapImage?.();
    const url = toImageURL(img);
    if (img && (img instanceof HTMLCanvasElement || img instanceof HTMLImageElement)) {
      try { c.drawImage(img, 0, 0, S, S); this.base = cv; return; } catch { /* fallthrough */ }
    } else if (url) {
      const im = new Image();
      im.onload = () => { c.drawImage(im, 0, 0, S, S); };
      im.src = url;
      this.paintMap(c, S);
      this.base = cv;
      return;
    }
    this.paintMap(c, S);
    this.base = cv;
  }

  // Procedural stylised map (used when the world module doesn't provide one)
  paintMap(c, S) {
    const k = S / (MAP_HALF * 2);
    const X = (x) => (x + MAP_HALF) * k;
    // ground: sunward (bottom-left) greener, duskward (top-right) dusky
    const g = c.createLinearGradient(0, S, S, 0);
    g.addColorStop(0, '#2c4a22'); g.addColorStop(0.48, '#243a1d'); g.addColorStop(0.52, '#2e2a20'); g.addColorStop(1, '#3a2a22');
    c.fillStyle = g; c.fillRect(0, 0, S, S);
    // forest mottling
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 1300; i++) {
      const x = rnd() * S, y = rnd() * S, r = (2 + rnd() * 5) * (S / 488);
      const duskward = x > S - y;
      c.fillStyle = duskward ? `rgba(20,24,14,${0.35 + rnd() * 0.3})` : `rgba(14,32,12,${0.35 + rnd() * 0.3})`;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    // river (x == z diagonal from top-left to bottom-right)
    c.save();
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(40,90,120,0.9)'; c.lineWidth = 11 * k;
    c.beginPath(); c.moveTo(X(-MAP_HALF), X(-MAP_HALF)); c.lineTo(X(MAP_HALF), X(MAP_HALF)); c.stroke();
    c.strokeStyle = 'rgba(90,160,190,0.35)'; c.lineWidth = 4 * k; c.stroke();
    c.restore();
    // lanes
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const pass of [[9 * k, 'rgba(20,14,6,0.55)'], [6 * k, '#7c6a45'], [2.2 * k, 'rgba(190,165,110,0.35)']]) {
      c.lineWidth = pass[0]; c.strokeStyle = pass[1];
      for (const lane of Object.values(LANES)) {
        c.beginPath();
        lane.forEach(([x, z], i) => (i ? c.lineTo(X(x), X(z)) : c.moveTo(X(x), X(z))));
        c.stroke();
      }
    }
    // bases
    const base = (pos, col) => {
      const [x, z] = pos;
      const r = 26 * k;
      const gr = c.createRadialGradient(X(x), X(z), 2, X(x), X(z), r);
      gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gr; c.beginPath(); c.arc(X(x), X(z), r, 0, Math.PI * 2); c.fill();
    };
    base(THRONESHARD.sunward, 'rgba(120,200,90,0.55)');
    base(THRONESHARD.duskward, 'rgba(210,70,50,0.5)');
    base(FOUNTAIN.sunward, 'rgba(120,220,120,0.35)');
    base(FOUNTAIN.duskward, 'rgba(230,90,70,0.35)');
    // Grimmaw's lair
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.beginPath(); c.arc(X(GRIMMAW_LAIR[0]), X(GRIMMAW_LAIR[1]), 4.5 * k, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(200,160,90,0.5)'; c.lineWidth = 1; c.stroke();
    // camps
    c.fillStyle = 'rgba(230,200,120,0.28)';
    for (const cp of NEUTRAL_CAMPS) { c.beginPath(); c.arc(X(cp.pos[0]), X(cp.pos[1]), 1.6 * k, 0, Math.PI * 2); c.fill(); }
    // shops
    c.font = `${Math.round(9 * k * 1.1)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const s of [SHOPS.sunward, SHOPS.duskward, ...SHOPS.secret]) { c.fillStyle = 'rgba(255,215,100,0.7)'; c.fillText('⌂', X(s[0]), X(s[1])); }
    // vignette
    const vg = c.createRadialGradient(S / 2, S / 2, S * 0.35, S / 2, S / 2, S * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    c.fillStyle = vg; c.fillRect(0, 0, S, S);
  }

  paintFog() {
    const g = this.game, team = g.player.team;
    const fc = this.fogCtx, F = this.fog.width;
    let grid = null;
    try { grid = g.world?.getVisibilityGrid?.(team); } catch { grid = null; }
    if (grid && grid.data && grid.width && grid.height) {
      if (this.fog.width !== grid.width || this.fog.height !== grid.height) { this.fog.width = grid.width; this.fog.height = grid.height; this._fogImg = null; }
      const img = this._fogImg ?? (this._fogImg = fc.createImageData(grid.width, grid.height));
      const d = img.data, src = grid.data;
      const scale = grid.max ?? (src instanceof Uint8Array || src instanceof Uint8ClampedArray ? 255 : 1);
      for (let i = 0; i < src.length; i++) {
        const v = Math.max(0, Math.min(1, src[i] / scale));
        d[i * 4 + 3] = (1 - v) * 150;
      }
      fc.putImageData(img, 0, 0);
      // grid may be row-major in z (default) — flipZ flag lets world specify otherwise
      return;
    }
    if (F !== 128) { this.fog.width = this.fog.height = 128; }
    const S = this.fog.width;
    fc.globalCompositeOperation = 'source-over';
    fc.clearRect(0, 0, S, S);
    fc.fillStyle = 'rgba(0,0,0,0.55)';
    fc.fillRect(0, 0, S, S);
    fc.globalCompositeOperation = 'destination-out';
    const k = S / (MAP_HALF * 2);
    const night = this.ui.isNight?.();
    for (const u of g.units) {
      if (!u.alive || u.team !== team) continue;
      let r = 20;
      try { r = u.getStat('vision'); } catch { /* ignore */ }
      if (night && u.kind !== 'tower' && u.kind !== 'building') r *= 0.7;
      const x = (u.position.x + MAP_HALF) * k, y = (u.position.z + MAP_HALF) * k, rr = r * k;
      const gr = fc.createRadialGradient(x, y, rr * 0.6, x, y, rr);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      fc.fillStyle = gr;
      fc.beginPath(); fc.arc(x, y, rr, 0, Math.PI * 2); fc.fill();
    }
    fc.globalCompositeOperation = 'source-over';
  }

  update(dt) {
    const g = this.game;
    for (const p of this.pings) p.t += dt;
    this.pings = this.pings.filter((p) => p.t < p.dur);
    // Redrawn at ~15 Hz (the fog layer at half that): every redraw is re-rasterised by the GPU process, and minimap
    // dots move less than a pixel between redraws.
    this.acc += dt;
    if (this.acc < 1 / 15) return;
    this.acc = 0;
    if (!this.base) this.buildBase();
    const c = this.ctx, S = this.canvas.width, team = g.player.team;
    c.clearRect(0, 0, S, S);
    c.drawImage(this.base, 0, 0);
    this._fogTick = ((this._fogTick ?? 1) + 1) % 2;
    if (this._fogTick === 0) this.paintFog();
    c.imageSmoothingEnabled = true;
    c.drawImage(this.fog, 0, 0, S, S);

    const me = g.player.hero;
    const teamCol = (u) => (u.team === 'neutral' ? '#e0b64a' : u.team === team ? '#58d24a' : '#ff4a3a');
    // structures
    for (const u of g.units) {
      if (!u.alive || !u.isStructure) continue;
      if (u.team !== team && !this.seenStructure(u)) continue;
      const x = this.mx(u.position.x), y = this.mz(u.position.z);
      const sz = (u.subtype === 'throneshard' ? 7 : u.kind === 'tower' ? 3.6 : u.subtype === 'fountain' ? 4 : 4.5) * RES;
      c.fillStyle = 'rgba(0,0,0,0.85)';
      c.fillRect(x - sz / 2 - RES, y - sz / 2 - RES, sz + RES * 2, sz + RES * 2);
      c.fillStyle = teamCol(u);
      c.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    }
    // creeps / neutrals / summons
    for (const u of g.units) {
      if (!u.alive || u.isStructure || u.kind === 'hero') continue;
      if (u.team !== team && !g.canSee(team, u)) continue;
      const x = this.mx(u.position.x), y = this.mz(u.position.z);
      const r = (u.kind === 'grimmaw' ? 3.5 : 1.5) * RES;
      c.fillStyle = u.kind === 'grimmaw' ? '#e39a3a' : teamCol(u);
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    // heroes: small portrait circles (game.models.getPortrait via ui.portraits) with a team-colour ring; the player's
    // own hero is drawn last, larger, with a gold ring. Falls back to hero colour + initial until the portrait loads.
    const heroes = g.heroes.filter((h) => h.alive && (h.team === team || g.canSee(team, h)));
    heroes.sort((a, b) => (a === me) - (b === me));
    for (const h of heroes) {
      const x = this.mx(h.position.x), y = this.mz(h.position.z);
      const r = (h === me ? 9 : 7.5) * RES;
      c.fillStyle = 'rgba(0,0,0,0.9)';
      c.beginPath(); c.arc(x, y, r + 1.6 * RES, 0, Math.PI * 2); c.fill();
      const img = this.heroIcon(h);
      if (img) {
        // pre-clipped round portrait (clip paths are costly to rasterise every redraw)
        const icon = this.roundIcon(h, img, r);
        c.drawImage(icon, x - r, y - r, r * 2, r * 2);
      } else {
        c.fillStyle = this.ui.portraits.heroColor(h.def);
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#fff';
        c.font = `700 ${Math.round(7.5 * RES)}px Rajdhani, sans-serif`;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText((h.name ?? '?')[0].toUpperCase(), x, y + 0.5);
      }
      c.lineWidth = (h === me ? 2 : 1.6) * RES;
      c.strokeStyle = h === me ? '#ffe28a' : teamCol(h);
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
    }
    // pings
    for (const p of this.pings) {
      const x = this.mx(p.x), y = this.mz(p.z), k = p.t / p.dur;
      c.strokeStyle = p.color; c.globalAlpha = 1 - k; c.lineWidth = 2 * RES;
      const cycles = p.small ? 1 : 3;
      const kk = (k * cycles) % 1;
      c.beginPath(); c.arc(x, y, (p.small ? 3 : 4) * RES + kk * (p.small ? 6 : 16) * RES, 0, Math.PI * 2); c.stroke();
      if (!p.small) { c.fillStyle = p.color; c.beginPath(); c.arc(x, y, 2.5 * RES, 0, Math.PI * 2); c.fill(); }
      c.globalAlpha = 1;
    }
    this.drawFrustum(c);
  }

  // Cached HTMLImageElement of a hero's portrait (re-created if the portrait URL changes, e.g. new models load).
  heroIcon(h) {
    const id = h.heroId ?? h.def?.id;
    if (!id) return null;
    let url = null;
    try { url = this.ui.portraits.url(id); } catch { url = null; }
    if (!url) return null;
    const cache = (this._icons ??= new Map());
    let e = cache.get(id);
    if (!e || e.url !== url) {
      const img = new Image();
      e = { url, img, ok: false };
      img.onload = () => { e.ok = img.naturalWidth > 0; };
      img.onerror = () => { e.ok = false; };
      img.src = url;
      cache.set(id, e);
    }
    return e.ok ? e.img : null;
  }

  // Round, face-cropped portrait on the hero colour, rendered once per hero / portrait image / radius.
  roundIcon(h, img, r) {
    const cache = (this._round ??= new Map());
    const id = h.heroId ?? h.def?.id;
    let e = cache.get(id);
    if (!e || e.img !== img || e.r !== r) {
      const cv = document.createElement('canvas');
      const d = Math.ceil(r * 2);
      cv.width = cv.height = d;
      const x = cv.getContext('2d');
      x.beginPath(); x.arc(r, r, r, 0, Math.PI * 2); x.clip();
      x.fillStyle = this.ui.portraits.heroColor(h.def);
      x.fillRect(0, 0, r * 2, r * 2);
      // portraits are head-and-shoulders renders: zoom to the face (upper-middle of the image)
      const s = Math.min(img.width, img.height) * 0.78;
      x.drawImage(img, (img.width - s) / 2, img.height * 0.06, s, s, 0, 0, r * 2, r * 2);
      e = { img, r, cv };
      cache.set(id, e);
    }
    return e.cv;
  }

  seenStructure(u) {
    // Enemy structures are always shown (they're known map features)
    return true;
  }

  drawFrustum(c) {
    const g = this.game, THREE = g.THREE;
    if (!THREE || !g.camera) return;
    const ray = this._ray ?? (this._ray = new THREE.Raycaster());
    const plane = this._plane ?? (this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
    const pts = [];
    const v2 = this._v2 ?? (this._v2 = new THREE.Vector2());
    for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      v2.set(nx, ny);
      ray.setFromCamera(v2, g.camera);
      const p = new THREE.Vector3();
      if (!ray.ray.intersectPlane(plane, p)) ray.ray.at(260, p);
      pts.push(p);
    }
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineWidth = 1.2 * RES;
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(this.mx(p.x), this.mz(p.z)) : c.moveTo(this.mx(p.x), this.mz(p.z))));
    c.closePath();
    c.stroke();
  }
}
