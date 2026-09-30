// Game loop: rAF driven, dt clamped to 1/20 s. Errors in callbacks are caught so the loop never dies.
export class GameLoop {
  constructor(updateFn, renderFn) {
    this.updateFn = updateFn;
    this.renderFn = renderFn;
    this.running = false;
    this.elapsed = 0;
    this.fps = 60;
    this.timeScale = 1;
    this.maxDt = 1 / 20;
    this._last = 0;
    this._raf = 0;
    this._errT = 0;
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  _report(e) {
    const now = performance.now();
    if (now - this._errT > 1000) {
      this._errT = now;
      console.error('[GameLoop]', e);
    }
  }

  _tick(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);
    let raw = (now - this._last) / 1000;
    this._last = now;
    if (!(raw > 0)) raw = 1 / 60;
    if (raw > 0) this.fps += (Math.min(raw, 1) > 0 ? 1 / Math.min(raw, 1) - this.fps : 0) * 0.05;
    const dt = Math.min(raw, this.maxDt) * this.timeScale;
    this.elapsed += dt;
    try {
      if (this.updateFn) this.updateFn(dt, this.elapsed);
    } catch (e) { this._report(e); }
    try {
      if (this.renderFn) this.renderFn();
    } catch (e) { this._report(e); }
  }
}
