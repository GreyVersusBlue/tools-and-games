import { armorMultiplier } from '../../core/constants.js';

// Canvas overlay for everything projected from world space: health/mana bars above units, floating combat text,
// last-hit indicators. Drawn every frame, cheaply, in a single 2D canvas.
const NUM_CHARS = '0123456789+-!';
const NUMERIC = /^[-+0-9!]+$/;
const DEFAULT_H = { hero: 2.4, creep: 1.7, neutral: 1.9, summon: 1.9, tower: 9.5, building: 7, grimmaw: 4.5, ward: 1.4 };

export class WorldOverlay {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ui-world';
    this.ctx = this.canvas.getContext('2d');
    this.texts = [];
    this.state = new WeakMap(); // unit -> { lag }
    this.healAcc = new Map();
    this._v = null;
    this._sprites = new Map(); // text sprite cache (see sprite())
    this._list = [];
    this._proj = [];
    try { document.fonts?.addEventListener?.('loadingdone', () => this._sprites.clear()); } catch { /* ignore */ }
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = innerWidth; this.h = innerHeight;
    this.vs = Math.max(0.85, Math.min(1.6, this.h / 820));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this._sprites?.clear();
  }

  // Outlined text is the expensive part of this canvas (stroked glyphs are rasterised as paths by the GPU process
  // every frame). Each distinct label (text, font, colours) is rendered once into a small canvas and blitted with
  // drawImage afterwards. Returns { c, w, h, ax, ay }: draw at (x - ax, y - ay) to place the text as
  // textAlign='center' + the given baseline at (x, y). draw(ctx, cx, cy) paints the content (default: stroke + fill).
  sprite(key, font, px, baseline, lw, fill, stroke, draw = null, extraW = 0) {
    let sp = this._sprites.get(key);
    if (sp) { this._sprites.delete(key); this._sprites.set(key, sp); return sp; } // LRU touch
    const dpr = this.dpr, c = document.createElement('canvas');
    const mctx = c.getContext('2d');
    mctx.font = font;
    const tw = mctx.measureText(key.slice(key.lastIndexOf('|') + 1)).width;
    const pad = Math.ceil(lw) + 3;
    const w = Math.ceil(tw + extraW * 2 + pad * 2), h = Math.ceil(px * 2 + pad * 2);
    const ax = w / 2, ay = baseline === 'middle' ? h / 2 : baseline === 'top' ? pad : Math.ceil(px * 1.35 + pad);
    c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr);
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    x.font = font; x.textAlign = 'center'; x.textBaseline = baseline;
    if (draw) draw(x, ax, ay, tw);
    else {
      if (lw > 0) { x.lineWidth = lw; x.strokeStyle = stroke; x.strokeText(key.slice(key.lastIndexOf('|') + 1), ax, ay); }
      x.fillStyle = fill; x.fillText(key.slice(key.lastIndexOf('|') + 1), ax, ay);
    }
    sp = { c, w, h, ax, ay };
    this._sprites.set(key, sp);
    if (this._sprites.size > 400) this._sprites.delete(this._sprites.keys().next().value);
    return sp;
  }

  // Numbers (HP, damage, gold) change constantly, so they are laid out from per-glyph sprites instead of one sprite per
  // string: all outlines first, then all fills, which is exactly what strokeText followed by fillText paints.
  numLabel(ctx, text, font, px, baseline, lw, fill, stroke, x, y) {
    const adv = this._adv ?? (this._adv = new Map());
    let a = adv.get(font);
    if (!a) {
      const m = document.createElement('canvas').getContext('2d');
      m.font = font;
      a = {};
      for (const ch of NUM_CHARS) a[ch] = m.measureText(ch).width;
      adv.set(font, a);
    }
    let w = 0;
    for (let i = 0; i < text.length; i++) w += a[text[i]];
    let cx = x - w / 2;
    for (let pass = 0; pass < 2; pass++) {
      cx = x - w / 2;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i], aw = a[ch];
        const key = pass === 0 ? `S|${font}|${baseline}|${lw}|${stroke}|${ch}` : `F|${font}|${baseline}|${fill}|${ch}`;
        const sp = this.sprite(key, font, px, baseline, lw, fill, stroke, (c, sx, sy) => {
          if (pass === 0) { c.lineWidth = lw; c.strokeStyle = stroke; c.strokeText(ch, sx, sy); } else { c.fillStyle = fill; c.fillText(ch, sx, sy); }
        });
        this.blit(ctx, sp, cx + aw / 2, y);
        cx += aw;
      }
    }
  }

  blit(ctx, sp, x, y) {
    const d = this.dpr;
    ctx.drawImage(sp.c, Math.round((x - sp.ax) * d) / d, Math.round((y - sp.ay) * d) / d, sp.w, sp.h);
  }

  // outlined label: text drawn centred at (x, y) with the given baseline (same look as strokeText + fillText)
  label(ctx, text, px, weight, baseline, lw, fill, stroke, x, y) {
    const font = `${weight} ${px}px Rajdhani, sans-serif`;
    if (lw > 0 && NUMERIC.test(text)) { this.numLabel(ctx, text, font, px, baseline, lw, fill, stroke, x, y); return; }
    this.blit(ctx, this.sprite(`${font}|${baseline}|${lw}|${fill}|${stroke}|${text}`, font, px, baseline, lw, fill, stroke), x, y);
  }

  // world point -> screen {x, y, dist} or null
  project(x, y, z, out = null) {
    const THREE = this.game.THREE;
    if (!this._v) this._v = new THREE.Vector3();
    const cam = this.game.camera;
    const v = this._v.set(x, y, z);
    const dx = x - cam.position.x, dy = y - cam.position.y, dz = z - cam.position.z;
    v.project(cam);
    if (v.z > 1 || v.z < -1) return null;
    const sx = (v.x + 1) * 0.5 * this.w, sy = (1 - v.y) * 0.5 * this.h;
    if (sx < -150 || sx > this.w + 150 || sy < -80 || sy > this.h + 80) return null;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (out) { out.x = sx; out.y = sy; out.dist = dist; return out; }
    return { x: sx, y: sy, dist };
  }

  addText(text, pos, opts = {}) {
    if (!pos) return;
    if (this.texts.length > 80) this.texts.shift();
    this.texts.push({
      text, x: pos.x + (Math.random() - 0.5) * 0.6, y: (pos.y ?? 0) + (opts.height ?? 2.2), z: pos.z,
      t: 0, dur: opts.dur ?? 1.2, color: opts.color ?? '#fff', size: opts.size ?? 18, kind: opts.kind ?? 'dmg',
      drift: (Math.random() - 0.5) * 18,
    });
  }

  unitHeight(u) { return u.model?.height ?? DEFAULT_H[u.kind] ?? 2; }

  update(dt) {
    const g = this.game, ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!g.running || !g.camera) return;
    g.camera.updateMatrixWorld?.();
    const team = g.player.team, me = g.player.hero;
    const selected = g.player.selected ?? [];
    const hpText = this.ui.settings.get('hpText');
    // player's expected attack damage for last-hit indicator
    let myDmg = 0;
    if (me?.alive) {
      try { myDmg = (me.getStat('damageMin') + me.bonusFromSources('damage')) * 1.0; } catch { myDmg = 0; }
    }
    const units = g.units;
    const list = this._list, pool = this._proj;
    list.length = 0;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!u.alive || (u.kind === 'ward' && u.team !== team)) continue;
      if (u.object && !u.object.visible) continue;
      if (u.data?.hideBar) continue;
      if (u.team !== team && !g.canSee(team, u)) continue;
      const slot = pool[list.length] ?? (pool[list.length] = { x: 0, y: 0, dist: 0, u: null });
      const p = this.project(u.position.x, u.position.y + this.unitHeight(u) + 0.35, u.position.z, slot);
      if (!p) continue;
      p.u = u;
      list.push(p);
    }
    // draw far first
    list.sort((a, b) => b.dist - a.dist);
    for (let i = 0; i < list.length; i++) { const p = list[i]; this.drawBar(ctx, p.u, p, dt, p.u === me, selected.includes(p.u), myDmg, hpText); p.u = null; }
    this.drawTexts(ctx, dt);
    // heal accumulator flush
    if (this.healAcc.size) {
      for (const [u, a] of this.healAcc) {
        a.t -= dt;
        if (a.t <= 0) {
          if (a.amt >= 20 && u.alive) this.addText('+' + Math.round(a.amt), u.position, { color: '#6bff6b', size: 17, kind: 'heal', height: this.unitHeight(u) });
          this.healAcc.delete(u);
        }
      }
    }
  }

  drawBar(ctx, u, p, dt, isMe, isSel, myDmg, hpText) {
    const g = this.game, team = g.player.team;
    // distance falloff x viewport scale (world units cover more pixels on taller viewports: keep bars proportional)
    const s = Math.max(0.7, Math.min(1.15, 60 / p.dist)) * this.vs;
    const hero = u.kind === 'hero';
    const big = u.isStructure || u.kind === 'grimmaw';
    const w = Math.round((hero ? 100 : big ? 124 : u.kind === 'neutral' ? 60 : 54) * s);
    const h = Math.max(3, Math.round((hero ? 10 : big ? 8 : 5) * s));
    const x = Math.round(p.x - w / 2), y = Math.round(p.y);
    const maxHp = Math.max(1, u.getStat('maxHp'));
    const pct = Math.max(0, Math.min(1, u.hp / maxHp));
    let st = this.state.get(u);
    if (!st) { st = { lag: pct, hold: 0 }; this.state.set(u, st); }
    if (pct >= st.lag) { st.lag = pct; st.hold = 0; } else {
      st.hold += dt;
      if (st.hold > 0.35) st.lag = Math.max(pct, st.lag - dt * 0.8);
    }

    const ally = u.team === team;
    let col, col2;
    if (isMe) { col = '#4fd83a'; col2 = '#2c8f1c'; }
    else if (u.team === 'neutral') { col = '#d9a53a'; col2 = '#8a6417'; }
    else if (ally) { col = hero ? '#3fae5a' : '#48b43a'; col2 = hero ? '#1f6c33' : '#23701a'; }
    else { col = '#e2412f'; col2 = '#8c1c12'; }

    // frame
    const manaH = hero ? Math.max(3, Math.round(4 * s)) : 0;
    const totalH = h + (manaH ? manaH + 1 : 0);
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(x - 1, y - 1, w + 2, totalH + 2);
    if (isSel) { ctx.strokeStyle = 'rgba(255,230,150,0.85)'; ctx.lineWidth = 1; ctx.strokeRect(x - 1.5, y - 1.5, w + 3, totalH + 3); }
    // lag chunk
    if (st.lag > pct) { ctx.fillStyle = 'rgba(255,236,180,0.85)'; ctx.fillRect(x + w * pct, y, w * (st.lag - pct), h); }
    // hp
    const gr = ctx.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, col); gr.addColorStop(1, col2);
    ctx.fillStyle = gr;
    ctx.fillRect(x, y, Math.round(w * pct), h);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(x, y, Math.round(w * pct), Math.max(1, Math.round(h * 0.3)));
    // ticks
    if (hero || big || maxHp > 1000) {
      const step = 250 * (maxHp > 6000 ? 4 : 1);
      if (maxHp / step < 60) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        for (let hp = step; hp < maxHp; hp += step) {
          const tx = Math.round(x + (hp / maxHp) * w);
          const major = hp % (step * 4) === 0;
          ctx.fillRect(tx, y, 1, major ? h : Math.ceil(h * 0.55));
        }
      }
    }
    // mana
    if (manaH) {
      const mp = Math.max(0, Math.min(1, u.mana / Math.max(1, u.getStat('maxMana'))));
      ctx.fillStyle = '#0c1a33';
      ctx.fillRect(x, y + h + 1, w, manaH);
      ctx.fillStyle = '#3f8ff0';
      ctx.fillRect(x, y + h + 1, Math.round(w * mp), manaH);
    }
    // last-hit indicator on enemy creeps
    if (!ally && myDmg > 0 && (u.kind === 'creep' || u.kind === 'neutral')) {
      const eff = myDmg * armorMultiplier(u.getStat('armor'));
      if (u.hp <= eff) {
        ctx.strokeStyle = '#fff4c2'; ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
      }
    }
    if (hero) {
      // level box
      const lb = Math.round(16 * s);
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(x - lb - 2, y - 1, lb, totalH + 2);
      ctx.strokeStyle = ally ? 'rgba(120,200,120,0.5)' : 'rgba(220,110,90,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - lb - 1.5, y - 0.5, lb - 1, totalH + 1);
      this.label(ctx, String(u.level ?? 1), Math.round(12 * s), 700, 'middle', 0, '#f2e6c4', '', x - lb / 2 - 2, y + totalH / 2 + 0.5);
      // name
      const nm = u.name ?? '';
      this.label(ctx, nm, Math.round(12.5 * s), 600, 'alphabetic', 3, isMe ? '#bff7a8' : ally ? '#d6f0d0' : '#ffc9bf', 'rgba(0,0,0,0.85)', p.x, y - 4);
      if (hpText) this.label(ctx, `${Math.ceil(u.hp)}`, Math.round(9.5 * s), 700, 'middle', 2.5, '#fff', 'rgba(0,0,0,0.85)', p.x, y + h / 2 + 0.5);
      // status markers (stun / silence)
      if (u.modifiers?.length) {
        let tag = null;
        if (u.isStunned) tag = 'STUNNED'; else if (u.hasState?.('morph')) tag = 'MORPHED'; else if (u.hasState?.('silence')) tag = 'SILENCED'; else if (u.hasState?.('root')) tag = 'ROOTED';
        if (tag) this.label(ctx, tag, Math.round(10 * s), 700, 'top', 3, '#ffd24a', 'rgba(0,0,0,0.85)', p.x, y + totalH + 3);
      }
    }
  }

  drawTexts(ctx, dt) {
    if (!this.texts.length) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const keep = [];
    for (const t of this.texts) {
      t.t += dt;
      if (t.t >= t.dur) continue;
      keep.push(t);
      const p = this.project(t.x, t.y, t.z);
      if (!p) continue;
      const k = t.t / t.dur;
      const rise = t.kind === 'gold' ? 34 * Math.min(1, k * 2) : 46 * k;
      let size = t.size * this.vs;
      if (t.kind === 'crit') size *= k < 0.12 ? 0.6 + (k / 0.12) * 0.9 : 1.5 - Math.min(0.4, (k - 0.12) * 1.2);
      const alpha = k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1;
      ctx.globalAlpha = alpha;
      const px = Math.round(size);
      const font = `700 ${px}px Rajdhani, sans-serif`;
      const x = p.x + t.drift * k, y = p.y - rise;
      if (t.kind === 'gold') {
        const col = t.color;
        const sp = this.sprite(`gold|${font}|${col}|${t.text}`, font, px, 'middle', 3.5, col, 'rgba(0,0,0,0.9)', (c, ax, ay, tw) => {
          const cx = ax - tw / 2 - 8;
          const gr = c.createRadialGradient(cx - 2, ay - 2, 1, cx, ay, 7);
          gr.addColorStop(0, '#fff3b0'); gr.addColorStop(0.5, '#f0b92a'); gr.addColorStop(1, '#8a5a08');
          c.fillStyle = gr;
          c.beginPath(); c.arc(cx, ay, 6.5, 0, Math.PI * 2); c.fill();
          c.lineWidth = 3.5; c.strokeStyle = 'rgba(0,0,0,0.9)';
          c.strokeText(t.text, ax + 4, ay);
          c.fillStyle = col; c.fillText(t.text, ax + 4, ay);
        }, 12);
        this.blit(ctx, sp, x, y);
      } else {
        this.label(ctx, t.text, px, 700, 'middle', 3.5, t.color, 'rgba(0,0,0,0.9)', x, y);
      }
    }
    ctx.globalAlpha = 1;
    this.texts = keep;
  }

  // ---- event hooks ----
  onDamaged({ unit, source, amount, crit, isAttack, ability, type }) {
    const g = this.game, s = this.ui.settings;
    if (!s.get('damageNumbers') || !unit || amount < 1) return;
    if (!g.canSee(g.player.team, unit)) return;
    const me = g.player.hero;
    const srcHero = source?.kind === 'hero' ? source : source?.owner;
    const h = this.unitHeight(unit);
    if (crit) { this.addText(Math.round(amount) + '!', unit.position, { color: '#ff3b2f', size: 22, kind: 'crit', height: h, dur: 1.3 }); return; }
    if (!isAttack && (srcHero === me || unit === me || unit.kind === 'hero' || s.get('allDamageNumbers'))) {
      const col = type === 'pure' ? '#ffe28a' : type === 'physical' ? '#ff8a6a' : '#c38bff';
      this.addText('-' + Math.round(amount), unit.position, { color: col, size: srcHero === me ? 19 : 15, height: h });
      return;
    }
    if (s.get('allDamageNumbers') && isAttack && (srcHero === me || unit === me)) {
      this.addText(String(Math.round(amount)), unit.position, { color: unit === me ? '#ff7070' : '#f0e6d0', size: 13, height: h, dur: 0.8 });
    }
  }
  onHealed({ unit, amount, source }) {
    if (!this.ui.settings.get('damageNumbers') || !unit || unit.team !== this.game.player.team || unit.kind !== 'hero') return;
    if (!source && amount < 25) return; // ignore passive regen / fountain ticks
    const a = this.healAcc.get(unit) ?? { amt: 0, t: 0.35 };
    a.amt += amount;
    this.healAcc.set(unit, a);
  }
  onGold({ unit, hero, amount }) {
    const g = this.game;
    if (hero !== g.player.hero || !amount) return;
    const pos = unit?.position ?? hero.position;
    this.addText('+' + Math.round(amount), pos, { color: '#ffd24a', size: 17, kind: 'gold', height: unit ? this.unitHeight(unit) : 2.4, dur: 1.5 });
  }
}
