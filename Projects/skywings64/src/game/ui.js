// Menu templates (title / select / briefing / pause / results) + settings panel + confetti + gamepad prompts.
// Styling lives in index.html. Interaction via data-act attributes (handled by game.js) - unchanged.
import { medalName, fmtTime, ratingTitle, fmtNum } from './scoring.js';
import { getSettings, setSetting, resetSettings, DEFAULTS } from '../core/settings.js';

export const VEHICLE_INFO = {
  hangGlider: {
    name: 'HANG GLIDER', kind: 'wind', accent: '#ff7a45',
    hint: 'PRESS SPACE TO LAUNCH',
    controls: [['W / S', 'Pitch down / up'], ['A / D', 'Bank left / right'], ['Q / E', 'Yaw'], ['SPACE', 'Launch'], ['X', 'Air brake'], ['C', 'Camera'], ['ESC', 'Pause']],
    blurb: 'Ride thermals and glide. No engine - watch your speed to avoid a stall.',
  },
  gyrocopter: {
    name: 'GYROCOPTER', kind: 'rotor', accent: '#4da3ff',
    hint: 'HOLD SHIFT (OR R) FOR THROTTLE',
    controls: [['SHIFT / R', 'Throttle up'], ['CTRL / F', 'Throttle down'], ['W / S', 'Pitch'], ['A / D', 'Bank'], ['Q / E', 'Yaw'], ['SPACE', 'Drop bomb'], ['C', 'Camera']],
    blurb: 'Rotor lift and forward thrust. Cut throttle and flare to land.',
  },
  rocketBelt: {
    name: 'ROCKET BELT', kind: 'rocket', accent: '#7dff5a',
    hint: 'HOLD SHIFT (OR R) TO THRUST',
    controls: [['SHIFT / R', 'Thrust up'], ['CTRL / F', 'Thrust down'], ['W / S', 'Lean fwd / back'], ['A / D', 'Lean left / right'], ['Q / E', 'Turn'], ['B', 'Boost'], ['C', 'Camera']],
    blurb: 'Fuel-limited hover jets. Plan hops, feather thrust, and touch down gently.',
  },
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------- icons
export function icon(vehicle) {
  if (vehicle === 'hangGlider') {
    return `<svg viewBox="0 0 120 80" aria-hidden="true"><defs><linearGradient id="ig1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a5c"/><stop offset="1" stop-color="#e02f3a"/></linearGradient></defs>
    <path d="M60 8 L112 52 L60 40 L8 52 Z" fill="url(#ig1)" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M60 8 L60 40 M60 40 L34 47 M60 40 L86 47 M60 8 L36 42 M60 8 L84 42" stroke="rgba(255,255,255,.65)" stroke-width="1.6" fill="none"/>
    <path d="M60 40 L60 54" stroke="#fff" stroke-width="2.5"/><circle cx="60" cy="59" r="5.5" fill="#ffd23c" stroke="#fff" stroke-width="2"/><path d="M60 64 L54 74 M60 64 L66 74" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>`;
  }
  if (vehicle === 'gyrocopter') {
    return `<svg viewBox="0 0 120 80" aria-hidden="true"><defs><linearGradient id="ig2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6cc0ff"/><stop offset="1" stop-color="#1d55d6"/></linearGradient></defs>
    <ellipse cx="60" cy="14" rx="52" ry="4.5" fill="rgba(255,255,255,.28)" stroke="#fff" stroke-width="2"/><path d="M60 14 L60 34" stroke="#fff" stroke-width="3"/>
    <path d="M32 46 Q32 32 52 32 L74 32 Q84 32 88 42 L100 46 L100 52 L32 52 Z" fill="url(#ig2)" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M88 42 L104 30 L108 33 L100 46" fill="#ff5a3c" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M40 38 Q46 34 54 36 L54 44 L40 44 Z" fill="#bfe8ff" stroke="#fff" stroke-width="1.5"/>
    <circle cx="20" cy="46" r="3" fill="#fff"/><path d="M20 38 L20 54" stroke="rgba(255,255,255,.7)" stroke-width="2"/>
    <path d="M44 52 L40 66 M78 52 L82 66" stroke="#fff" stroke-width="3"/><circle cx="40" cy="69" r="6" fill="#1b1f2c" stroke="#fff" stroke-width="2.5"/><circle cx="82" cy="69" r="6" fill="#1b1f2c" stroke="#fff" stroke-width="2.5"/></svg>`;
  }
  return `<svg viewBox="0 0 120 80" aria-hidden="true"><defs><linearGradient id="ig3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b7ff7a"/><stop offset="1" stop-color="#27b34a"/></linearGradient><linearGradient id="ig4" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2a0"/><stop offset=".5" stop-color="#ff9a1c"/><stop offset="1" stop-color="#ff3a2a" stop-opacity="0"/></linearGradient></defs>
    <path d="M42 46 Q34 60 38 76 Q46 62 48 46 Z M78 46 Q86 60 82 76 Q74 62 72 46 Z" fill="url(#ig4)"/>
    <rect x="36" y="26" width="12" height="24" rx="5" fill="#b9c4d6" stroke="#fff" stroke-width="2"/><rect x="72" y="26" width="12" height="24" rx="5" fill="#b9c4d6" stroke="#fff" stroke-width="2"/>
    <rect x="46" y="22" width="28" height="30" rx="9" fill="url(#ig3)" stroke="#fff" stroke-width="2.5"/>
    <circle cx="60" cy="12" r="9" fill="#ffd23c" stroke="#fff" stroke-width="2.5"/><path d="M53 12 Q60 8 67 12" stroke="#7a4a00" stroke-width="2.5" fill="none"/>
    <path d="M52 52 L48 68 M68 52 L72 68" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>`;
}

const GLYPHS = {
  ring: '<ellipse cx="12" cy="12" rx="6" ry="9" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M2 12h6M16 12h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  thermal: '<path d="M7 20c-3-4 3-6 0-10M13 20c-3-4 3-6 0-10M19 20c-3-4 3-6 0-10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 7l3-4 3 4M16 7l3-4 3 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  target: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  tower: '<path d="M9 22l1.5-14h3L15 22M8 8h8l-1.5-4h-5zM12 4V1" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>',
  free: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 5l2.2 6.8L12 19l-2.2-7.2z" fill="currentColor"/>',
};
const MISSION_GLYPH = { hg1: ['ring', 'RINGS + LANDING'], hg2: ['thermal', 'THERMAL CLIMB'], gc1: ['ring', 'RING COURSE'], gc2: ['target', 'BOMBING RUN'], rb1: ['ring', 'RING HOPS'], rb2: ['tower', 'TOWER COURSE'], sandbox: ['free', 'EXPLORE'] };
function glyph(id) {
  const g = MISSION_GLYPH[id] || ['ring', ''];
  return `<span class="sw-glyph" title="${g[1]}"><svg viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[g[0]]}</svg><em>${g[1]}</em></span>`;
}

export function medalHTML(medal, size) {
  const cls = medal && medal !== 'none' ? medal : 'none';
  return `<span class="sw-medal ${cls}" style="${size ? `width:${size}px;height:${size}px` : ''}"></span>`;
}

function bigMedal(medal) {
  if (!medal || medal === 'none') {
    return `<div class="sw-bigmedal none"><svg viewBox="0 0 120 140"><circle cx="60" cy="70" r="46" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.35)" stroke-width="3" stroke-dasharray="6 7"/><path d="M42 52l36 36M78 52L42 88" stroke="rgba(255,255,255,.4)" stroke-width="5" stroke-linecap="round"/></svg></div>`;
  }
  const P = { gold: ['#fff7b0', '#ffc400', '#a06a00'], silver: ['#ffffff', '#c8d0dc', '#6c7480'], bronze: ['#ffd9b0', '#d1823a', '#7a4310'] }[medal];
  return `<div class="sw-bigmedal ${medal}"><svg viewBox="0 0 120 140"><defs><radialGradient id="bm-${medal}" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="${P[0]}"/><stop offset=".55" stop-color="${P[1]}"/><stop offset="1" stop-color="${P[2]}"/></radialGradient></defs>
    <path d="M34 0h22l14 46H46z" fill="#e2323f"/><path d="M64 0h22L74 46H50z" fill="#2c62e0"/>
    <circle cx="60" cy="86" r="46" fill="url(#bm-${medal})" stroke="#fff" stroke-width="3"/><circle cx="60" cy="86" r="36" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2"/><circle cx="60" cy="86" r="33" fill="none" stroke="${P[2]}" stroke-opacity=".5" stroke-width="1.5"/>
    <path d="M60 60l7.6 15.6 17.2 2.4-12.5 12 3 17L60 99l-15.3 8 3-17-12.5-12 17.2-2.4z" fill="#fff" fill-opacity=".92" stroke="${P[2]}" stroke-width="2" stroke-linejoin="round"/></svg><i class="glint"></i></div>`;
}

// ---------------------------------------------------------------- screen-enter tracking (animate only on real transitions)
let lastScreen = '';
function enter(name) { const c = name !== lastScreen ? ' sw-enter' : ''; lastScreen = name; return c; }
let obs = false;
function watch() {
  if (obs) return;
  const root = document.getElementById('ui');
  if (!root) return;
  obs = true;
  new MutationObserver(() => { if (!root.firstElementChild || !root.querySelector('.sw-screen')) lastScreen = ''; }).observe(root, { childList: true });
}

// ---------------------------------------------------------------- input-hint chips (keyboard vs gamepad)
const K = (t) => `<kbd>${t}</kbd>`;
const P = (t, c) => `<kbd class="pad ${c || ''}">${t}</kbd>`;
function prompt(keys, pad, label) {
  return `<span class="sw-prompt"><span class="kbd-only">${keys.map(K).join('')}</span><span class="pad-only">${pad}</span><em>${label}</em></span>`;
}
const PAD_A = P('A', 'a'), PAD_B = P('B', 'b'), PAD_DPAD = P('✛', 'dp');

// ---------------------------------------------------------------- templates
export function titleHTML() {
  watch(); launchInit();
  return `<div class="sw-screen sw-title${enter('title')}" data-act="confirm">
    <div class="sw-lbx top"></div><div class="sw-lbx bot"></div>
    <div class="sw-px l1" data-d="10">${cloudLayer(1)}</div>
    <div class="sw-px l2" data-d="26">${cloudLayer(2)}</div>
    <div class="sw-rays"></div>
    <div class="sw-px logo-wrap" data-d="-14">
      <svg class="sw-emblem" viewBox="0 0 160 60" aria-hidden="true"><defs><linearGradient id="emb" x1="0" x2="1"><stop offset="0" stop-color="#ffd86a"/><stop offset="1" stop-color="#ff8a1c"/></linearGradient></defs>
        <path d="M80 8 L4 40 L60 30 Z M80 8 L156 40 L100 30 Z M80 8 L68 46 L80 38 L92 46 Z" fill="url(#emb)" stroke="rgba(255,255,255,.9)" stroke-width="1.5" stroke-linejoin="round"/></svg>
      <h1 class="sw-logo" aria-label="SkyWings 64"><span class="a">SKY</span><span class="b">WINGS</span><span class="n">64</span></h1>
      <div class="sw-sub">A PILOT ADVENTURE OVER HOLIDAY ISLAND</div>
    </div>
    <div class="sw-press" role="button" tabindex="0"><span class="kbd-only">PRESS ENTER OR CLICK TO START</span><span class="pad-only">PRESS ${PAD_A} TO START</span></div>
    <div class="sw-foot">
      ${prompt(['W', 'A', 'S', 'D'], PAD_DPAD, 'FLY')} ${prompt(['SHIFT', 'CTRL'], P('RT', 'tr') + P('LT', 'tr'), 'THROTTLE')} ${prompt(['SPACE'], PAD_A, 'ACTION')} ${prompt(['C'], P('Y', 'y'), 'CAMERA')} ${prompt(['ESC'], P('☰', 'dp'), 'PAUSE')}
    </div>
  </div>`;
}

function cloudLayer(n) {
  const c = (x, y, s, o) => `<g transform="translate(${x} ${y}) scale(${s})" opacity="${o}"><ellipse cx="0" cy="0" rx="90" ry="22"/><ellipse cx="-40" cy="-14" rx="46" ry="26"/><ellipse cx="18" cy="-24" rx="52" ry="32"/><ellipse cx="60" cy="-6" rx="40" ry="20"/></g>`;
  const body = n === 1
    ? c(180, 560, 1.4, .16) + c(720, 620, 1.9, .13) + c(1260, 540, 1.3, .16) + c(1760, 640, 1.6, .12)
    : c(60, 720, 2.6, .2) + c(640, 800, 3, .18) + c(1300, 740, 2.4, .2) + c(1900, 820, 2.8, .16);
  return `<svg viewBox="0 0 1920 900" preserveAspectRatio="xMidYMid slice" fill="#fff" aria-hidden="true">${body}</svg>`;
}

// locked: optional Set of mission ids that are not yet unlocked; lockText(m) -> requirement string
export function selectHTML(missions, bests, sel, locked, lockText) {
  const cards = missions.map((m, i) => {
    const b = bests[m.id];
    const lk = !!(locked && locked.has(m.id));
    const vi = VEHICLE_INFO[m.vehicle];
    const dots = m.difficulty ? Array.from({ length: 3 }, (_, k) => `<i class="${k < m.difficulty ? 'on' : ''}"></i>`).join('') : '<b>FREE</b>';
    const best = lk ? '<span class="dim lockreq">&#128274; LOCKED</span>' : m.sandbox ? '<span class="dim">NO SCORE</span>' : b ? `${medalHTML(b.medal, 22)} <strong>${fmtNum(b.points)}</strong><small>PTS</small><em class="g g${b.grade}">${b.grade}</em>` : '<span class="dim">NO RECORD</span>';
    return `<div class="sw-card ${i === sel ? 'sel' : ''} ${lk ? 'locked' : ''}" style="--acc:${vi.accent};--i:${i}" data-act="card" data-i="${i}" role="button" tabindex="0" aria-pressed="${i === sel}" aria-label="${esc(m.name)} - ${esc(m.tag)}${lk ? ' (locked)' : ''}">
      <div class="top"><span class="no">${String(i + 1).padStart(2, '0')}</span><span class="tag">${esc(m.tag)}</span></div>
      <div class="ic">${icon(m.vehicle)}${glyph(m.id)}</div>
      <div class="nm">${esc(m.name)}</div>
      <div class="vh">${m.vehicleChoice ? 'ANY AIRCRAFT' : vi.name}</div>
      <div class="df" aria-label="difficulty">${dots}</div>
      <div class="bt">${best}</div>
    </div>`;
  }).join('');
  const m = missions[sel];
  const req = locked && locked.has(m.id) && lockText ? `<div class="lk">${esc(lockText(m))}</div>` : '';
  return `<div class="sw-screen sw-select${enter('select')}">
    <div class="sw-head"><div class="sw-h1">SELECT MISSION</div><div class="sw-h1s">${missions.length} FLIGHTS &middot; HOLIDAY ISLAND</div></div>
    <div class="sw-cards" role="list">${cards}</div>
    <div class="sw-desc"><div class="t">${esc(m.name)}</div><div class="d">${esc(m.description)}</div>${req}</div>
    <div class="sw-foot">${prompt(['←', '→', '↑', '↓'], PAD_DPAD, 'CHOOSE')} ${prompt(['ENTER'], PAD_A, 'SELECT')} ${prompt(['ESC'], PAD_B, 'BACK')}</div>
  </div>`;
}

export function briefingHTML(m, best, vehicleKey) {
  const vi = VEHICLE_INFO[vehicleKey];
  const ctrl = vi.controls.map((c) => `<div class="k"><kbd>${esc(c[0])}</kbd><span>${esc(c[1])}</span></div>`).join('');
  const veh = m.vehicleChoice
    ? `<div class="sw-vsel" role="group" aria-label="Aircraft">${Object.keys(VEHICLE_INFO).map((k) => `<button data-act="veh" data-v="${k}" class="${k === vehicleKey ? 'on' : ''}" aria-pressed="${k === vehicleKey}">${VEHICLE_INFO[k].name}</button>`).join('')}</div>` : '';
  return `<div class="sw-screen sw-brief${enter('brief')}" style="--acc:${vi.accent}">
    <div class="sw-panel">
      <div class="head"><div class="ic">${icon(vehicleKey)}</div><div><div class="tag">${esc(m.tag)}</div><div class="sw-h1 l">${esc(m.name)}</div></div></div>
      ${veh}
      <p>${esc(m.description)}</p>
      <p class="dim">${esc(vi.blurb)}</p>
      <div class="chips">
        <span class="chip">${m.timeLimit ? `TIME LIMIT <b>${fmtTime(m.timeLimit)}</b>` : 'NO TIME LIMIT'}</span>
        ${best ? `<span class="chip">BEST <b>${fmtNum(best.points)}</b> ${medalHTML(best.medal, 18)}</span>` : ''}
        <span class="chip">${glyph(m.id)}</span>
      </div>
      <div class="keys">${ctrl}</div>
      <div class="sw-press sm" data-act="confirm" role="button" tabindex="0"><span class="kbd-only">PRESS ENTER TO TAKE OFF</span><span class="pad-only">PRESS ${PAD_A} TO TAKE OFF</span></div>
      <div class="sw-foot l">${prompt(['ESC'], PAD_B, 'BACK TO MISSIONS')}</div>
    </div>
  </div>`;
}

export function pauseHTML(sandbox) {
  return `<div class="sw-screen sw-pause${enter('pause')}"><div class="sw-panel c" role="dialog" aria-label="Paused">
    <div class="sw-h1">PAUSED</div>
    <button data-act="confirm" autofocus>RESUME</button>
    <button data-act="retry">${sandbox ? 'RESPAWN' : 'RETRY'} <small>R</small></button>
    <button data-act="menu">QUIT TO MENU <small>M</small></button>
    <div class="sw-foot l">${prompt(['ESC'], PAD_B, 'RESUME')} <span class="sw-prompt"><kbd class="kbd-only">O</kbd><em>SETTINGS</em></span></div>
  </div></div>`;
}

export function resultsHTML(d) {
  const rows = d.rows.map((r, i) => `<div class="row" style="animation-delay:${(0.25 + i * 0.18).toFixed(2)}s"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('');
  const delay = 0.3 + d.rows.length * 0.18;
  const won = d.medal && d.medal !== 'none';
  if (won) launchConfetti(d.medal, delay + 0.4);
  return `<div class="sw-screen sw-results${enter('results')}"><div class="sw-panel c wide ${d.completed ? 'win' : 'fail'}">
    <div class="sw-h1">${esc(d.title)}</div>
    <div class="sub">${esc(d.mission)}</div>
    <div class="grid">
      <div class="rows">${rows}
        <div class="row total" style="animation-delay:${delay.toFixed(2)}s"><span>TOTAL</span><b id="sw-total">0</b></div>
      </div>
      <div class="rt">
        <div class="reveal" style="animation-delay:${(delay + 0.1).toFixed(2)}s">${bigMedal(d.medal)}</div>
        <div class="mn" style="animation-delay:${(delay + 0.9).toFixed(2)}s">${won ? medalName(d.medal).toUpperCase() + ' MEDAL' : 'NO MEDAL'}</div>
        <div class="stamp g${d.grade}" style="animation-delay:${(delay + 1.1).toFixed(2)}s"><small>PILOT RATING</small><span class="l">${d.grade}</span><small class="t">${ratingTitle(d.grade)}</small></div>
        ${d.newBest ? `<div class="nb" style="animation-delay:${(delay + 1.6).toFixed(2)}s">NEW BEST!</div>` : ''}
        ${d.unlocked && d.unlocked.length ? `<div class="nb unl" style="animation-delay:${(delay + 2.0).toFixed(2)}s">UNLOCKED: ${d.unlocked.map((u) => esc(u.toUpperCase())).join(', ')}</div>` : ''}
        ${d.best ? `<div class="bs">BEST ${fmtNum(d.best.points)} &middot; ${d.best.grade}</div>` : ''}
      </div>
    </div>
    <div class="btns">
      <button data-act="confirm" autofocus>${d.completed && d.hasNext ? 'NEXT MISSION' : 'RETRY'}</button>
      ${d.completed && d.hasNext ? '<button data-act="retry" class="alt">RETRY <small>R</small></button>' : ''}
      <button data-act="menu" class="alt">MISSIONS <small>M</small></button>
    </div>
    <div class="sw-foot l">${prompt(['ENTER'], PAD_A, 'CONTINUE')} ${prompt(['R'], P('X', 'x'), 'RETRY')} ${prompt(['M'], PAD_B, 'MENU')}</div>
  </div></div>`;
}

// ---------------------------------------------------------------- confetti (canvas, UI-side; independent of 3D particles)
let confettiCv = null;
function launchConfetti(medal, delaySec) {
  setTimeout(() => {
    try {
      if (!document.querySelector('#ui .sw-results')) return;
      if (confettiCv) confettiCv.remove();
      const cv = confettiCv = document.createElement('canvas');
      cv.id = 'sw-confetti';
      const dpr = Math.min(devicePixelRatio || 1, 2);
      cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
      document.body.appendChild(cv);
      const g = cv.getContext('2d');
      const pal = { gold: ['#ffd23c', '#fff3a0', '#ff8a1c', '#fff', '#ff5aa0'], silver: ['#e8eef8', '#9fb4d0', '#4de1ff', '#fff'], bronze: ['#e39a55', '#ffd9b0', '#ff7a45', '#fff'] }[medal] || ['#fff'];
      const n = medal === 'gold' ? 220 : 130;
      const ps = [];
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? 1 : -1;
        ps.push({ x: innerWidth / 2 + side * innerWidth * 0.1 * Math.random(), y: innerHeight * 0.9, vx: side * (200 + Math.random() * 520), vy: -(500 + Math.random() * 700), r: Math.random() * 6, vr: (Math.random() - 0.5) * 14, w: 6 + Math.random() * 7, h: 3 + Math.random() * 5, c: pal[i % pal.length], t: Math.random() * 6 });
      }
      let last = performance.now(), age = 0;
      const step = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000); last = now; age += dt;
        g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, innerWidth, innerHeight);
        let alive = 0;
        for (const p of ps) {
          p.vy += 900 * dt; p.vx *= 1 - 0.9 * dt; p.vy *= 1 - 0.55 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt; p.t += dt * 8;
          if (p.y < innerHeight + 20 && age < 7) alive++;
          g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.scale(1, Math.cos(p.t)); g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore();
        }
        if (alive && cv.isConnected && document.querySelector('#ui .sw-results')) requestAnimationFrame(step); else cv.remove();
      };
      requestAnimationFrame(step);
      window.dispatchEvent(new CustomEvent('swConfetti', { detail: { medal } }));
    } catch (e) { /* ignore */ }
  }, Math.max(0, delaySec * 1000));
}

// ---------------------------------------------------------------- one-time DOM wiring: parallax, gamepad detection, settings
let inited = false;
function launchInit() {
  if (inited) return;
  inited = true;
  const ui = document.getElementById('ui');
  // parallax
  let px = 0, py = 0, tx = 0, ty = 0;
  window.addEventListener('mousemove', (e) => { tx = e.clientX / innerWidth - 0.5; ty = e.clientY / innerHeight - 0.5; }, { passive: true });
  const tick = () => {
    px += (tx - px) * 0.06; py += (ty - py) * 0.06;
    if (ui && (Math.abs(tx - px) > 0.0005 || Math.abs(ty - py) > 0.0005 || ui.__pxDirty)) {
      ui.__pxDirty = false;
      ui.querySelectorAll('.sw-px').forEach((n) => { const d = +n.dataset.d || 10; n.style.transform = `translate(${(-px * d * 2).toFixed(2)}px,${(-py * d).toFixed(2)}px)`; });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  new MutationObserver(() => { ui.__pxDirty = true; }).observe(ui, { childList: true });
  // gamepad prompts
  const setPad = (on) => document.body.classList.toggle('sw-pad', on);
  window.addEventListener('gamepadconnected', () => setPad(true));
  window.addEventListener('gamepaddisconnected', () => { try { setPad(![...navigator.getGamepads()].some((p) => p && p.connected)); } catch (e) { setPad(false); } });
  window.addEventListener('keydown', () => setPad(false), { passive: true, capture: true });
  setInterval(() => { try { if ([...navigator.getGamepads()].some((p) => p && p.connected && p.buttons.some((b) => b.pressed))) setPad(true); } catch (e) { /* ignore */ } }, 400);
}

// ---------------------------------------------------------------- settings panel
const seg = (key, opts, cur) => `<div class="seg" role="radiogroup" data-key="${key}">${opts.map(([v, l]) => `<button type="button" role="radio" aria-checked="${cur === v}" data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
const slider = (key, label, v) => `<label class="row"><span>${label}</span><input type="range" min="0" max="100" step="1" data-key="${key}" value="${Math.round(v * 100)}" style="--p:${Math.round(v * 100)}%"><output>${Math.round(v * 100)}</output></label>`;
const toggle = (key, label, on) => `<div class="row"><span>${label}</span><button type="button" class="tog ${on ? 'on' : ''}" role="switch" aria-checked="${on}" data-key="${key}"><i></i></button></div>`;

function settingsMarkup() {
  const s = getSettings();
  return `<div class="card" role="dialog" aria-modal="true" aria-labelledby="sw-set-t">
    <div class="hd"><h2 id="sw-set-t">SETTINGS</h2><button type="button" class="x" data-close aria-label="Close settings">&times;</button></div>
    <div class="grp"><h3>GRAPHICS</h3>
      <div class="row"><span>Quality</span>${seg('quality', [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH']], s.quality)}</div></div>
    <div class="grp"><h3>AUDIO</h3>${slider('master', 'Master volume', s.master)}${slider('music', 'Music', s.music)}${slider('sfx', 'Sound effects', s.sfx)}</div>
    <div class="grp"><h3>FLIGHT &amp; CAMERA</h3>
      ${slider('shake', 'Camera shake', s.shake)}
      ${toggle('invertPitch', 'Invert pitch', s.invertPitch)}
      ${toggle('cinematic', 'Cinematic camera cuts (in C cycle)', s.cinematic)}
      <div class="row"><span>Units</span>${seg('units', [['metric', 'METRIC'], ['imperial', 'IMPERIAL'], ['aviation', 'KNOTS / FT']], s.units)}</div></div>
    <div class="ft"><button type="button" data-reset>RESET DEFAULTS</button><button type="button" class="pri" data-close>DONE</button></div>
  </div>`;
}

let panel = null, gear = null, lastFocus = null;
function openSettings() {
  if (!panel || panel.classList.contains('open')) return;
  lastFocus = document.activeElement;
  panel.innerHTML = settingsMarkup();
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  const f = panel.querySelector('button.on, button, input');
  if (f) f.focus();
}
function closeSettings() {
  if (!panel || !panel.classList.contains('open')) return;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) { /* ignore */ }
}

function initSettingsUI() {
  if (typeof document === 'undefined' || document.getElementById('sw-settings')) return;
  gear = document.createElement('button');
  gear.id = 'sw-gear'; gear.type = 'button'; gear.setAttribute('aria-label', 'Settings (O)'); gear.title = 'Settings (O)';
  gear.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1c.5.4 1.1.7 1.7 1l.4 2.7h4l.4-2.7c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>';
  document.body.appendChild(gear);
  panel = document.createElement('div');
  panel.id = 'sw-settings'; panel.setAttribute('aria-hidden', 'true');
  document.body.appendChild(panel);

  gear.addEventListener('click', (e) => { e.stopPropagation(); panel.classList.contains('open') ? closeSettings() : openSettings(); });
  panel.addEventListener('click', (e) => {
    e.stopPropagation();
    const t = e.target;
    if (t === panel || t.closest('[data-close]')) return closeSettings();
    if (t.closest('[data-reset]')) { resetSettings(); panel.innerHTML = settingsMarkup(); const f = panel.querySelector('.pri'); f && f.focus(); return; }
    const sg = t.closest('.seg button');
    if (sg) {
      const key = sg.parentNode.dataset.key;
      setSetting(key, sg.dataset.v);
      sg.parentNode.querySelectorAll('button').forEach((b) => { const on = b === sg; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
      return;
    }
    const tg = t.closest('.tog');
    if (tg) { const on = !tg.classList.contains('on'); setSetting(tg.dataset.key, on); tg.classList.toggle('on', on); tg.setAttribute('aria-checked', on); }
  });
  panel.addEventListener('input', (e) => {
    const r = e.target;
    if (r.type !== 'range') return;
    const v = +r.value;
    r.style.setProperty('--p', v + '%');
    r.nextElementSibling.textContent = v;
    setSetting(r.dataset.key, v / 100);
    if (r.dataset.key !== 'shake') try { window.__game && window.__game.sfx && window.__game.sfx('menu'); } catch (x) { /* ignore */ }
  });
  // Keyboard: while open, swallow keys so the game's menu handlers / flight input never see them.
  window.addEventListener('keydown', (e) => {
    const open = panel.classList.contains('open');
    if (open) {
      if (e.code === 'Escape' || e.code === 'KeyO') { e.preventDefault(); e.stopPropagation(); return closeSettings(); }
      if (e.code === 'Tab') { // focus trap
        const f = [...panel.querySelectorAll('button,input')].filter((n) => n.offsetParent !== null);
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        const a = document.activeElement;
        if (a && a.closest && a.closest('.seg')) { // radio-group arrows
          const b = [...a.parentNode.children], i = b.indexOf(a), n = b[(i + (e.code === 'ArrowRight' ? 1 : b.length - 1)) % b.length];
          n.focus(); n.click(); e.preventDefault();
        }
      }
      e.stopPropagation();
      return;
    }
    if (e.code === 'KeyO' && !e.repeat && document.querySelector('#ui .sw-screen') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); openSettings(); }
  }, true);
}
if (typeof document !== 'undefined') {
  if (document.body) initSettingsUI(); else document.addEventListener('DOMContentLoaded', initSettingsUI);
}
export { openSettings, closeSettings, DEFAULTS };
