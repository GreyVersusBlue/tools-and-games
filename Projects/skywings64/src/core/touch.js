// On-screen touch controls: virtual stick (pitch/roll) + hold buttons, feeding InputState.setTouch().
// Shown only during flight on touch devices (pointer: coarse / touch events), or with ?touch=1.
// Uses Pointer Events, so a mouse can drive it too (handy for testing).
const CSS = `
#sw-touch{position:fixed;inset:0;pointer-events:none;z-index:14;display:none;touch-action:none;user-select:none;-webkit-user-select:none}
#sw-touch.on{display:block}
#sw-touch .stick{position:absolute;left:4vw;bottom:6vh;width:clamp(120px,24vmin,190px);aspect-ratio:1;border-radius:50%;
  background:radial-gradient(circle,rgba(255,255,255,.10),rgba(255,255,255,.04));border:2px solid rgba(255,255,255,.35);pointer-events:auto;touch-action:none}
#sw-touch .knob{position:absolute;left:50%;top:50%;width:42%;aspect-ratio:1;border-radius:50%;transform:translate(-50%,-50%);
  background:radial-gradient(circle at 35% 30%,#fff,#9fd0ff 60%,#4d8fd8);box-shadow:0 4px 12px rgba(0,0,0,.45)}
#sw-touch .btns{position:absolute;right:3.5vw;bottom:5vh;display:grid;grid-template-columns:repeat(2,auto);gap:12px;pointer-events:none}
#sw-touch button{pointer-events:auto;touch-action:none;min-width:74px;min-height:62px;border-radius:18px;border:2px solid rgba(255,255,255,.4);
  background:rgba(10,30,60,.55);color:#fff;font:700 15px 'Rajdhani',sans-serif;letter-spacing:1.5px;text-shadow:0 1px 3px #000}
#sw-touch button.hot{background:rgba(255,190,60,.7);border-color:#ffe3a0}
#sw-touch button.big{grid-column:span 2;min-height:70px;background:rgba(220,70,50,.6)}
#sw-touch .top{position:absolute;top:12px;right:12px;display:flex;gap:10px;pointer-events:none}
#sw-touch .top button{min-width:56px;min-height:48px}
`;

export function touchWanted() {
  try {
    const q = new URLSearchParams(location.search).get('touch');
    if (q === '1') return true;
    if (q === '0') return false;
    return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
  } catch (e) { return false; }
}

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.enabled = touchWanted();
    this.state = { pitch: 0, roll: 0, yaw: 0, throttle: 0, action: false, boost: false, brake: false };
    this.visible = false;
    if (!this.enabled || typeof document === 'undefined') return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const root = this.root = document.createElement('div');
    root.id = 'sw-touch';
    root.innerHTML = `<div class="stick" aria-label="flight stick"><div class="knob"></div></div>
      <div class="btns">
        <button data-k="thrUp" aria-label="throttle up">THR +</button><button data-k="boost" aria-label="boost">BOOST</button>
        <button data-k="thrDn" aria-label="throttle down">THR -</button><button data-k="brake" aria-label="brake">BRAKE</button>
        <button data-k="action" class="big" aria-label="action">LAUNCH</button>
      </div>
      <div class="top"><button data-k="cam" aria-label="camera">CAM</button><button data-k="pause" aria-label="pause">II</button></div>`;
    document.body.appendChild(root);
    this.stick = root.querySelector('.stick'); this.knob = root.querySelector('.knob');
    this.actionBtn = root.querySelector('[data-k="action"]');
    this.held = {};
    this._stickId = null;
    const s = this.stick;
    s.addEventListener('pointerdown', (e) => { e.preventDefault(); this._stickId = e.pointerId; try { s.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } this._move(e); });
    s.addEventListener('pointermove', (e) => { if (e.pointerId === this._stickId) this._move(e); });
    const end = (e) => { if (e.pointerId !== this._stickId) return; this._stickId = null; this.state.pitch = this.state.roll = 0; this.knob.style.transform = 'translate(-50%,-50%)'; this._push(); };
    s.addEventListener('pointerup', end); s.addEventListener('pointercancel', end);
    for (const b of root.querySelectorAll('button')) {
      const k = b.getAttribute('data-k');
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } this._press(k, true, b); });
      const up = (e) => { e.preventDefault(); this._press(k, false, b); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  _move(e) {
    const r = this.stick.getBoundingClientRect();
    const R = r.width / 2;
    let dx = (e.clientX - (r.left + R)) / R, dy = (e.clientY - (r.top + R)) / R;
    const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    // stick up = push forward = nose down (pitch +), matching W on the keyboard
    this.state.roll = dx; this.state.pitch = -dy;
    this.knob.style.transform = `translate(calc(-50% + ${dx * R * 0.6}px), calc(-50% + ${dy * R * 0.6}px))`;
    this._push();
  }

  _press(k, down, b) {
    if (this.held[k] === down) return;
    this.held[k] = down;
    b.classList.toggle('hot', down);
    const inp = this.input;
    if (k === 'cam' && down && inp) inp._camLatch = true;
    else if (k === 'pause' && down && inp) inp._pauseLatch = true;
    this.state.throttle = (this.held.thrUp ? 1 : 0) - (this.held.thrDn ? 1 : 0);
    this.state.action = !!this.held.action;
    this.state.boost = !!this.held.boost;
    this.state.brake = !!this.held.brake;
    this._push();
  }

  _push() { if (this.visible && this.input && this.input.setTouch) this.input.setTouch(this.state); }

  // Context label for the big button.
  setActionLabel(text) { if (this.actionBtn) this.actionBtn.textContent = text; }

  show(on) {
    if (!this.enabled || !this.root) return;
    this.visible = !!on;
    this.root.classList.toggle('on', this.visible);
    if (!this.visible) {
      this.held = {}; Object.assign(this.state, { pitch: 0, roll: 0, yaw: 0, throttle: 0, action: false, boost: false, brake: false });
      for (const b of this.root.querySelectorAll('button')) b.classList.remove('hot');
      if (this.knob) this.knob.style.transform = 'translate(-50%,-50%)';
      if (this.input && this.input.setTouch) this.input.setTouch(null);
    } else this._push();
  }
}
