// Overlay canvas on top of the minimap for rune markers (from game.runes.markers(team)).
// Kept separate from Minimap.js so the minimap owner's drawing code stays untouched; it reuses minimap.mx/mz.
export class MinimapMarkers {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.mm = ui.minimap;
    this.acc = 0;
    const src = this.mm?.canvas;
    if (!src) return;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'mm-markers';
    this.canvas.width = src.width;
    this.canvas.height = src.height;
    Object.assign(this.canvas.style, { position: 'absolute', pointerEvents: 'none', left: '0', top: '0', width: '100%', height: '100%' });
    // align exactly with the minimap canvas inside its frame
    const place = () => {
      const s = src.style, cs = getComputedStyle(src);
      this.canvas.style.left = `${src.offsetLeft}px`;
      this.canvas.style.top = `${src.offsetTop}px`;
      this.canvas.style.width = `${src.offsetWidth || parseFloat(cs.width) || 0}px`;
      this.canvas.style.height = `${src.offsetHeight || parseFloat(cs.height) || 0}px`;
      void s;
    };
    src.parentNode?.appendChild(this.canvas);
    place();
    this.place = place;
    // re-align only when the minimap's box can have changed (reading offset*/computed style forces a layout)
    this._placeDirty = false;
    addEventListener('resize', () => { this._placeDirty = true; });
    try { new ResizeObserver(() => { this._placeDirty = true; }).observe(src); } catch { this._placeDirty = true; }
    this._drawn = false;
    this.ctx = this.canvas.getContext('2d');
  }

  update(dt) {
    if (!this.ctx) return;
    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    if (this._placeDirty) { this._placeDirty = false; this.place(); }
    const g = this.game, c = this.ctx, W = this.canvas.width;
    const markers = g.runes?.markers?.(g.player?.team) ?? [];
    if (!markers.length && !this._drawn) return; // nothing shown and nothing to erase
    c.clearRect(0, 0, W, this.canvas.height);
    this._drawn = markers.length > 0;
    const k = W / 244; // minimap internal resolution multiplier
    const pulse = 1 + Math.sin((g.realTime ?? 0) * 5) * 0.15;
    for (const m of markers) {
      const x = this.mm.mx(m.x), y = this.mm.mz(m.z);
      const r = (m.kind === 'windfall' ? 4 : 5.5) * k * pulse;
      c.save();
      c.translate(x, y);
      c.fillStyle = 'rgba(0,0,0,0.85)';
      if (m.kind === 'windfall') {
        c.beginPath(); c.arc(0, 0, r + 1.5 * k, 0, Math.PI * 2); c.fill();
        c.fillStyle = m.color; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#3a2600'; c.font = `700 ${Math.round(6.5 * k)}px Rajdhani, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('$', 0, 0.5 * k);
      } else {
        c.rotate(Math.PI / 4);
        c.fillRect(-r - 1.5 * k, -r - 1.5 * k, (r + 1.5 * k) * 2, (r + 1.5 * k) * 2);
        c.fillStyle = m.color; c.fillRect(-r, -r, r * 2, r * 2);
        c.fillStyle = 'rgba(255,255,255,0.8)'; c.fillRect(-r * 0.35, -r * 0.35, r * 0.7, r * 0.7);
      }
      c.restore();
    }
  }
}
