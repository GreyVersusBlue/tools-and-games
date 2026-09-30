// SkyWings 64 HUD: glassmorphic-arcade DOM/SVG overlay with animated gauges.
// Public API (unchanged): new HUD(root); show(b); update(d); flash(text,ms); clearFlash(); showResults(data); hideResults();
// setTargetBearing(rad,dist,heading?); setFuelVisible(v); createMinimap(world,opts); updateMinimap(x,z,heading,markers); showMinimap(b);
// drawCompass(h); dispose().  New: popup(text, sub, kind), stamp(text, kind), pitch/roll optional in update() (else read from the
// active vehicle via window.__game.vehicle).
import { getSettings, UNITS } from './settings.js';
import { RING_PTS, TARGET_PTS } from '../game/scoring.js';

const CSS = `
.sw-hud{position:fixed;inset:0;pointer-events:none;z-index:20;font-family:var(--sw-hud,'Rajdhani','Inter',sans-serif);color:#eaf6ff;
  user-select:none;letter-spacing:.5px;display:none;--glass:linear-gradient(160deg,rgba(28,48,92,.55),rgba(8,16,40,.5));--edge:rgba(160,215,255,.28);--amber:#ffc83d;--cyan:#4de1ff}
.sw-hud.on{display:block;animation:swhudin .6s ease-out both}
@keyframes swhudin{from{opacity:0;transform:scale(1.04)}to{opacity:1;transform:none}}
.sw-glass{position:absolute;background:var(--glass);border:1px solid var(--edge);border-radius:14px;
  box-shadow:0 8px 28px rgba(0,10,40,.45),inset 0 1px 0 rgba(255,255,255,.22),inset 0 0 22px rgba(80,160,255,.08);
  -webkit-backdrop-filter:blur(10px) saturate(1.3);backdrop-filter:blur(10px) saturate(1.3)}
.sw-cap{font:600 11px/1 var(--sw-hud,'Rajdhani');letter-spacing:2.5px;color:var(--cyan);opacity:.9;text-transform:uppercase}
.sw-num{font-family:var(--sw-disp,'Russo One'),sans-serif;font-variant-numeric:tabular-nums;text-shadow:0 2px 0 rgba(0,0,0,.45),0 0 14px rgba(77,225,255,.35)}
/* top-left mission card */
#sw-tl{left:20px;top:18px;padding:10px 18px 12px 16px;min-width:190px}
#sw-timer{font-size:40px;line-height:1.05;margin-top:4px}
#sw-timer.low{color:#ff6a5a;animation:swpulse .5s ease-in-out infinite alternate}
#sw-score{font-size:15px;color:var(--amber);letter-spacing:2px;margin-top:2px;font-weight:700}
#sw-score b{font-family:var(--sw-disp,'Russo One');font-weight:400;font-size:22px;color:#fff;margin-left:6px}
#sw-rings{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;align-items:center;min-height:14px;font-weight:700;font-size:15px;color:var(--cyan)}
.sw-pip{width:12px;height:12px;border-radius:50%;border:2px solid rgba(77,225,255,.6);box-sizing:border-box;transition:all .25s}
.sw-pip.on{background:var(--cyan);border-color:#fff;box-shadow:0 0 10px var(--cyan);transform:scale(1.15)}
/* compass */
#sw-compass{left:50%;top:16px;transform:translateX(-50%);width:440px;height:52px;overflow:hidden;border-radius:26px}
#sw-compass canvas{position:absolute;inset:0;width:100%;height:100%}
#sw-compass:after{content:'';position:absolute;left:50%;top:0;width:0;height:0;margin-left:-7px;border:7px solid transparent;border-top:9px solid var(--amber);filter:drop-shadow(0 0 4px rgba(255,200,61,.8))}
#sw-hdg{position:absolute;left:50%;bottom:3px;transform:translateX(-50%);font:400 12px 'Russo One';color:#fff;letter-spacing:1px;display:none}
/* target chip */
#sw-arrow{left:50%;top:78px;transform:translateX(-50%);display:none;align-items:center;gap:10px;padding:5px 16px 5px 8px;border-radius:30px}
#sw-arrow svg{width:38px;height:38px;filter:drop-shadow(0 0 6px rgba(255,200,61,.7))}
#sw-dist{font:400 17px 'Russo One';color:#fff;min-width:64px}
#sw-arrow .sw-cap{color:var(--amber)}
/* objective / state */
#sw-obj{left:50%;bottom:212px;transform:translateX(-50%);padding:8px 24px;font-size:20px;font-weight:700;text-align:center;max-width:60%;display:none;letter-spacing:1.5px;border-radius:30px;white-space:nowrap}
#sw-state{left:50%;bottom:262px;transform:translateX(-50%);padding:5px 20px;font:400 16px 'Russo One';color:var(--amber);letter-spacing:3px;display:none;border-radius:30px;animation:swpulse .8s ease-in-out infinite alternate}
@keyframes swpulse{from{opacity:.55}to{opacity:1}}
/* gauges */
.sw-gauge{position:absolute;bottom:18px}
.sw-gauge svg{display:block;overflow:visible}
.sw-gauge .bez{fill:rgba(8,18,44,.55);stroke:rgba(160,215,255,.3);stroke-width:1.5}
.sw-gauge .tk{stroke:rgba(220,240,255,.75);stroke-width:1.4}
.sw-gauge .tk.mn{stroke:rgba(200,225,255,.35);stroke-width:1}
.sw-gauge text{font-family:'Rajdhani';font-weight:700;fill:#dff1ff}
.sw-gauge .big{font-family:'Russo One';font-weight:400}
#sw-g-alt{left:20px;width:170px;height:170px;border-radius:50%}
#sw-g-alt.warn .ring{stroke:#ff4a3a;animation:swpulse .4s infinite alternate}
#sw-g-att{left:50%;margin-left:-92px;width:184px;height:184px}
#sw-g-spd{right:100px;width:230px;height:170px}
#sw-bars{position:absolute;right:20px;bottom:18px;display:flex;gap:10px;height:150px}
.sw-bar{width:26px;height:100%;position:relative;border-radius:13px;overflow:hidden;padding:0}
.sw-bar>i{position:absolute;left:3px;right:3px;bottom:3px;height:0;border-radius:10px;background:linear-gradient(#ffe27a,#ff9a1c);box-shadow:0 0 10px rgba(255,170,40,.6)}
.sw-bar.fuel>i{background:linear-gradient(#9dff7a,#22c55e);box-shadow:0 0 10px rgba(80,255,120,.5)}
.sw-bar.fuel.low>i{background:linear-gradient(#ff8a7a,#e11d1d);animation:swpulse .4s infinite alternate}
.sw-bar span{position:absolute;left:0;right:0;top:50%;text-align:center;font:700 10px 'Rajdhani';letter-spacing:2px;color:rgba(255,255,255,.85);writing-mode:vertical-rl;transform:translateY(-50%) rotate(180deg);margin:auto;width:100%;text-shadow:0 1px 2px #000;z-index:2}
/* minimap */
#sw-mm{right:20px;top:18px;padding:6px;display:none;border-radius:50%}
#sw-mm canvas{display:block;border-radius:50%}
#sw-mm .sweep{position:absolute;inset:6px;border-radius:50%;background:conic-gradient(from 0deg,rgba(77,225,255,.0) 0deg,rgba(77,225,255,.0) 300deg,rgba(77,225,255,.22) 360deg);animation:swspin 4s linear infinite;pointer-events:none;mix-blend-mode:screen}
@keyframes swspin{to{transform:rotate(360deg)}}
/* flash + popups */
#sw-flash{position:absolute;left:0;right:0;top:26%;text-align:center;font:400 88px/1 var(--sw-disp,'Russo One');color:#fff;opacity:0;white-space:pre-line;
  text-shadow:0 4px 0 rgba(0,0,0,.35),0 0 40px rgba(255,200,61,.55);letter-spacing:4px;background:linear-gradient(#fff,#ffd45e 60%,#ff9a1c);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 6px 0 rgba(90,40,0,.55)) drop-shadow(0 0 24px rgba(255,180,40,.5))}
#sw-flash.show{animation:swflash var(--d,1.6s) cubic-bezier(.2,1.3,.4,1) forwards}
#sw-flash.hint{top:auto;bottom:40%;font:600 22px 'Rajdhani';letter-spacing:5px;background:none;-webkit-text-fill-color:#fff;color:#fff;filter:none;text-shadow:0 2px 8px #000}
@keyframes swflash{0%{opacity:0;transform:scale(.4) translateY(20px)}14%{opacity:1;transform:scale(1.12)}24%{transform:scale(1)}80%{opacity:1}100%{opacity:0;transform:scale(1.1) translateY(-14px)}}
#sw-pops{position:absolute;left:50%;top:34%;transform:translateX(-50%);width:0;height:0}
.sw-pop{position:absolute;left:0;top:0;transform:translate(-50%,0);display:flex;align-items:center;gap:12px;padding:8px 22px 8px 12px;border-radius:40px;white-space:nowrap;
  background:linear-gradient(160deg,rgba(20,60,110,.7),rgba(6,20,48,.65));border:1px solid rgba(120,230,255,.6);box-shadow:0 0 32px rgba(77,225,255,.4),inset 0 1px 0 rgba(255,255,255,.35);
  -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);animation:swpop var(--d,1.3s) cubic-bezier(.2,1.3,.4,1) forwards}
.sw-pop svg{width:34px;height:34px}
.sw-pop .t{font:400 20px 'Russo One';letter-spacing:1.5px}.sw-pop .s{font:700 16px 'Rajdhani';color:var(--amber);letter-spacing:1px;margin-left:4px}
.sw-pop.tgt{border-color:rgba(255,160,70,.7);box-shadow:0 0 32px rgba(255,140,50,.45),inset 0 1px 0 rgba(255,255,255,.35)}
@keyframes swpop{0%{opacity:0;transform:translate(-50%,24px) scale(.6)}15%{opacity:1;transform:translate(-50%,0) scale(1.08)}25%{transform:translate(-50%,0) scale(1)}75%{opacity:1;transform:translate(-50%,-10px)}100%{opacity:0;transform:translate(-50%,-46px) scale(.95)}}
#sw-ringfx{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center,transparent 55%,rgba(77,225,255,.35) 100%)}
#sw-ringfx.go{animation:swringfx .55s ease-out}
@keyframes swringfx{0%{opacity:1}100%{opacity:0}}
#sw-stamp{position:absolute;left:50%;top:32%;opacity:0;pointer-events:none}
.sw-stampbox{transform:translate(-50%,0) rotate(-7deg);border:6px double currentColor;border-radius:14px;padding:6px 34px 8px;text-align:center;color:var(--c,#7dff9a);
  font:400 60px/1.05 'Russo One';letter-spacing:4px;background:rgba(0,10,30,.35);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);
  text-shadow:0 0 22px currentColor;box-shadow:0 0 40px -6px currentColor,inset 0 0 30px -10px currentColor;white-space:nowrap}
.sw-stampbox small{display:block;font:700 14px 'Rajdhani';letter-spacing:6px;opacity:.85;margin-bottom:2px}
#sw-stamp.show{animation:swstamp var(--d,2s) cubic-bezier(.2,1.6,.4,1) forwards}
@keyframes swstamp{0%{opacity:0;transform:scale(3.2)}12%{opacity:1;transform:scale(.94)}18%{transform:scale(1.03)}24%{transform:scale(1)}82%{opacity:1}100%{opacity:0;transform:scale(1.04)}}
#sw-results{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,10,40,.6);pointer-events:auto}
#sw-results.on{display:flex}
.sw-rcard{min-width:460px;max-width:90vw;background:var(--glass);border:1px solid var(--edge);border-radius:20px;padding:22px 34px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);animation:swpop2 .5s cubic-bezier(.2,1.4,.4,1);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
@keyframes swpop2{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}
.sw-rtitle{font:400 40px 'Russo One';color:var(--amber)}.sw-rsub{font:600 16px 'Rajdhani';color:var(--cyan);letter-spacing:3px}
.sw-hmedal{width:96px;height:96px;border-radius:50%;margin:14px auto;display:flex;align-items:center;justify-content:center;font:400 44px 'Russo One';box-shadow:inset 0 0 0 6px rgba(255,255,255,.35),0 8px 24px rgba(0,0,0,.5)}
.sw-hmedal.gold{background:radial-gradient(circle at 35% 30%,#fff8b0,#ffd21c 45%,#c98b00)}.sw-hmedal.silver{background:radial-gradient(circle at 35% 30%,#fff,#d0d6df 45%,#7d8794)}
.sw-hmedal.bronze{background:radial-gradient(circle at 35% 30%,#ffd9b0,#d98a45 45%,#8a4a1a)}.sw-hmedal.none{background:radial-gradient(circle at 35% 30%,#666,#333);font-size:20px}
.sw-grade{font:400 26px 'Russo One';color:#7dff9a}
.sw-rows{margin:10px 0;text-align:left;font:600 20px 'Rajdhani'}.sw-row{display:flex;justify-content:space-between;gap:30px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.15)}
.sw-row b{font-weight:700;color:var(--amber)}.sw-total{font:400 34px 'Russo One';color:#fff;margin-top:6px}
.sw-new{color:#ff6ab0;font:400 20px 'Russo One';animation:swpulse .4s infinite alternate}
.sw-btns{display:flex;gap:14px;justify-content:center;margin-top:14px}
.sw-btn{font:400 16px 'Russo One';letter-spacing:2px;color:#fff;background:linear-gradient(#3d7bff,#1c46c4);border:1px solid rgba(255,255,255,.5);border-radius:10px;padding:9px 22px;cursor:pointer}
.sw-btn:hover,.sw-btn:focus-visible{background:linear-gradient(#ffd23c,#ff8a00);outline:3px solid #fff;outline-offset:2px}
@media (max-width:1000px){#sw-g-att{margin-left:-70px;width:140px;height:140px}#sw-g-alt{width:130px;height:130px}#sw-g-spd{width:170px;height:126px;right:90px}#sw-compass{width:320px}#sw-flash{font-size:52px}#sw-obj{bottom:170px}}
@media (prefers-reduced-motion:reduce){.sw-hud *{animation-duration:.01s!important}}
`;

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fmtTime = (s) => {
  if (s == null || !isFinite(s)) return '--:--.-';
  s = Math.max(0, s);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return String(m).padStart(2, '0') + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
};

function el(tag, id, cls, parent, html) {
  const e = document.createElement(tag);
  if (id) e.id = id;
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

// ---- static SVG builders --------------------------------------------------------------------------------------------
const pt = (cx, cy, r, deg) => [cx + r * Math.sin(deg / DEG), cy - r * Math.cos(deg / DEG)];

function altimeterSVG() {
  let t = '';
  for (let i = 0; i < 50; i++) {
    const a = i * 7.2, major = i % 5 === 0;
    const [x1, y1] = pt(80, 80, major ? 55 : 60, a), [x2, y2] = pt(80, 80, 66, a);
    t += `<line class="tk ${major ? '' : 'mn'}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
    if (major) {
      const [tx, ty] = pt(80, 80, 44, a);
      t += `<text x="${tx.toFixed(1)}" y="${(ty + 5).toFixed(1)}" font-size="15" text-anchor="middle">${i / 5}</text>`;
    }
  }
  return `<svg viewBox="0 0 160 160" width="100%" height="100%"><circle class="bez" cx="80" cy="80" r="76"/>
  <circle class="ring" cx="80" cy="80" r="72" fill="none" stroke="rgba(77,225,255,.55)" stroke-width="2"/>${t}
  <text x="80" y="104" font-size="9" text-anchor="middle" letter-spacing="2.5" style="fill:#4de1ff">ALT <tspan id="sw-altu">M</tspan></text>
  <text id="sw-altd" class="big" x="80" y="126" font-size="19" text-anchor="middle">0</text>
  <g id="sw-alt-s"><path d="M80 80 L80 46" stroke="#ffc83d" stroke-width="4" stroke-linecap="round"/></g>
  <g id="sw-alt-l"><path d="M80 92 L80 22 M76 30 L80 20 L84 30 Z" stroke="#fff" stroke-width="2.5" stroke-linecap="round" fill="#fff"/></g>
  <circle cx="80" cy="80" r="5" fill="#0b1a3a" stroke="#fff" stroke-width="2"/></svg>`;
}

function attitudeSVG() {
  let lad = '';
  for (let p = -30; p <= 30; p += 10) {
    if (!p) continue;
    const y = -p * 1.55, w = p % 20 ? 14 : 24;
    lad += `<line x1="${-w}" y1="${y}" x2="${w}" y2="${y}" stroke="#fff" stroke-width="1.6" opacity=".85"/><text x="${w + 5}" y="${y + 4}" font-size="10" fill="#fff" opacity=".8" font-family="Rajdhani" font-weight="700">${Math.abs(p)}</text>`;
  }
  let rt = '';
  for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const [x1, y1] = pt(92, 92, 82, a), [x2, y2] = pt(92, 92, a % 30 === 0 ? 74 : 78, a);
    rt += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#fff" stroke-width="${a % 30 === 0 ? 2.2 : 1.4}"/>`;
  }
  return `<svg viewBox="0 0 184 184" width="100%" height="100%"><defs>
  <clipPath id="sw-attclip"><circle cx="92" cy="92" r="72"/></clipPath>
  <linearGradient id="sw-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c6fe0"/><stop offset="1" stop-color="#7cc8ff"/></linearGradient>
  <linearGradient id="sw-gnd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9a7a3a"/><stop offset="1" stop-color="#4a3512"/></linearGradient></defs>
  <circle cx="92" cy="92" r="88" fill="rgba(8,18,44,.5)" stroke="rgba(160,215,255,.3)" stroke-width="1.5"/>
  <g clip-path="url(#sw-attclip)"><g transform="translate(92 92)"><g id="sw-att-g">
    <rect x="-200" y="-300" width="400" height="300" fill="url(#sw-sky)"/><rect x="-200" y="0" width="400" height="300" fill="url(#sw-gnd)"/>
    <line x1="-200" y1="0" x2="200" y2="0" stroke="#fff" stroke-width="2"/>${lad}</g></g>
    <ellipse cx="92" cy="92" rx="72" ry="72" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="10"/></g>
  <circle cx="92" cy="92" r="72" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1.5"/>
  <g id="sw-att-roll" transform="translate(92 92)"><g id="sw-att-rt" transform="translate(-92 -92)">${rt}</g></g>
  <path d="M92 20 l-6 -10 h12 z" fill="#ffc83d" stroke="#000" stroke-opacity=".4"/>
  <path d="M52 92 h28 l6 8 M132 92 h-28 l-6 8" stroke="#ffc83d" stroke-width="4" fill="none" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="92" cy="92" r="3.5" fill="#ffc83d"/>
  <g transform="translate(168 92)"><rect x="-4" y="-56" width="8" height="112" rx="4" fill="rgba(8,18,44,.6)" stroke="rgba(160,215,255,.35)"/>
    <line x1="-4" x2="4" y1="0" y2="0" stroke="#fff"/><rect id="sw-vsm" x="-6" y="-3" width="12" height="6" rx="3" fill="#7dff5a" stroke="#000" stroke-opacity=".5"/></g></svg>`;
}

function speedSVG() {
  return `<svg viewBox="0 0 200 150" width="100%" height="100%"><defs>
  <linearGradient id="sw-spdg" gradientUnits="userSpaceOnUse" x1="20" y1="130" x2="180" y2="130"><stop offset="0" stop-color="#4de1ff"/><stop offset=".6" stop-color="#ffc83d"/><stop offset="1" stop-color="#ff4a3a"/></linearGradient></defs>
  <path id="sw-spd-tr" d="" fill="none" stroke="rgba(150,200,255,.18)" stroke-width="11" stroke-linecap="round" pathLength="100"/>
  <path id="sw-spd-v" d="" fill="none" stroke="url(#sw-spdg)" stroke-width="11" stroke-linecap="round" pathLength="100" stroke-dasharray="0 200" style="filter:drop-shadow(0 0 6px rgba(77,225,255,.6))"/>
  <g id="sw-spd-ticks"></g>
  <text id="sw-spdd" class="big" x="100" y="96" font-size="40" text-anchor="middle">0</text>
  <text id="sw-spdu" x="100" y="116" font-size="12" text-anchor="middle" letter-spacing="3" style="fill:#4de1ff">KM/H</text>
  <text x="100" y="134" font-size="9" text-anchor="middle" letter-spacing="3" style="fill:rgba(200,225,255,.6)">AIRSPEED</text></svg>`;
}

const SPEED_SCALES = { metric: [240, 40], imperial: [150, 25], aviation: [120, 20] };
const arcPath = (cx, cy, r) => {
  const [x1, y1] = pt(cx, cy, r, -120), [x2, y2] = pt(cx, cy, r, 120);
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 1 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
};

export class HUD {
  constructor(rootEl) {
    this.rootEl = rootEl || document.body;
    if (!document.getElementById('sw-hud-css')) {
      const st = document.createElement('style');
      st.id = 'sw-hud-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const r = this.root = el('div', null, 'sw-hud', this.rootEl);
    this._cache = {};
    this.headingSign = 1;   // set -1 if vehicle heading is counter-clockwise
    this._showFuel = null;  // null = auto (show when < full)
    this._lastMsg = '';
    this._lastT = performance.now();
    this._v = { spd: 0, alt: 0, vs: 0, thr: 0, fuel: 1, pitch: 0, roll: 0, score: 0, hdg: 0 };
    this._units = null;
    this.speedScale = 3.6; this.speedUnit = 'KM/H';

    el('div', 'sw-ringfx', null, r);
    this.eRingFx = r.lastChild;

    const tl = el('div', 'sw-tl', 'sw-glass', r, '<div class="sw-cap">MISSION</div>');
    tl.id = 'sw-tl';
    this.eTimer = el('div', 'sw-timer', 'sw-num', tl, '00:00.0');
    this.eScore = el('div', 'sw-score', null, tl, 'SCORE<b>0</b>');
    this.eScoreB = this.eScore.querySelector('b');
    this.eRings = el('div', 'sw-rings', null, tl, '');

    const comp = el('div', 'sw-compass', 'sw-glass', r);
    this.compassCanvas = el('canvas', null, null, comp);
    this.compassCanvas.width = 880; this.compassCanvas.height = 104;
    this._compassHeading = NaN;

    const ar = this.eArrowBox = el('div', 'sw-arrow', 'sw-glass', r);
    ar.innerHTML = '<svg viewBox="-50 -50 100 100"><g id="sw-arrow-g"><path d="M0,-42 L30,30 L0,16 L-30,30 Z" fill="#ffc83d" stroke="#5a3400" stroke-width="5" stroke-linejoin="round"/></g></svg>';
    this.eArrowG = ar.querySelector('#sw-arrow-g');
    const at = el('div', null, null, ar, '<div class="sw-cap">OBJECTIVE</div>');
    this.eDist = el('div', 'sw-dist', null, at, '');

    this.eObj = el('div', 'sw-obj', 'sw-glass', r);
    this.eState = el('div', 'sw-state', 'sw-glass', r);

    // gauges
    const ga = el('div', 'sw-g-alt', 'sw-gauge', r, altimeterSVG());
    this.gAlt = ga;
    this.eAltS = ga.querySelector('#sw-alt-s'); this.eAltL = ga.querySelector('#sw-alt-l');
    this.eAltD = ga.querySelector('#sw-altd'); this.eAltU = ga.querySelector('#sw-altu');
    const gt = el('div', 'sw-g-att', 'sw-gauge', r, attitudeSVG());
    this.eAttG = gt.querySelector('#sw-att-g'); this.eAttRoll = gt.querySelector('#sw-att-rt'); this.eVsm = gt.querySelector('#sw-vsm');
    this.eAttRollG = gt.querySelector('#sw-att-roll');
    const gs = el('div', 'sw-g-spd', 'sw-gauge', r, speedSVG());
    this.eSpdV = gs.querySelector('#sw-spd-v'); this.eSpdD = gs.querySelector('#sw-spdd'); this.eSpdU = gs.querySelector('#sw-spdu');
    this.eSpdTicks = gs.querySelector('#sw-spd-ticks');
    gs.querySelector('#sw-spd-tr').setAttribute('d', arcPath(100, 100, 78));
    this.eSpdV.setAttribute('d', arcPath(100, 100, 78));
    this.eVsText = null;

    const bars = el('div', 'sw-bars', null, r);
    const fb = this.eFuelBar = el('div', null, 'sw-bar sw-glass fuel', bars);
    fb.style.position = 'relative';
    this.eFuelFill = el('i', null, null, fb);
    el('span', null, null, fb, 'FUEL');
    const tb = this.eThrBar = el('div', null, 'sw-bar sw-glass', bars);
    tb.style.position = 'relative';
    this.eThrFill = el('i', null, null, tb);
    el('span', null, null, tb, 'THROTTLE');

    this.eMM = el('div', 'sw-mm', 'sw-glass', r);
    this.ePops = el('div', 'sw-pops', null, r);
    this.eFlash = el('div', 'sw-flash', null, r);
    this.eStamp = el('div', 'sw-stamp', null, r);
    this.eResults = el('div', 'sw-results', null, r);

    this.minimap = null;
    this._flashQueue = [];
    this._flashBusy = false;
    this._applyUnits();
    window.addEventListener('settingsChanged', () => this._applyUnits());
    this.drawCompass(0);
  }

  _applyUnits() {
    const key = getSettings().units;
    const U = UNITS[key] || UNITS.metric;
    this.U = U; this._unitKey = key;
    this.speedScale = U.speed; this.speedUnit = U.speedLabel;
    this.eSpdU.textContent = U.speedLabel; this.eAltU.textContent = U.altLabel;
    const [max, step] = SPEED_SCALES[key] || SPEED_SCALES.metric;
    this._spdMax = max;
    let t = '';
    for (let v = 0; v <= max + 0.1; v += step / 4) {
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      const a = -120 + (v / max) * 240;
      const [x1, y1] = pt(100, 100, major ? 60 : 63, a), [x2, y2] = pt(100, 100, 68, a);
      t += `<line class="tk ${major ? '' : 'mn'}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
      if (major) { const [tx, ty] = pt(100, 100, 50, a); t += `<text x="${tx.toFixed(1)}" y="${(ty + 4).toFixed(1)}" font-size="11" text-anchor="middle" opacity=".85">${Math.round(v)}</text>`; }
    }
    this.eSpdTicks.innerHTML = t;
    this._cache.spd = this._cache.alt = null;
  }

  show(b) {
    this.root.classList.toggle('on', !!b);
    document.body.classList.toggle('sw-flying', !!b);
  }

  _txt(key, node, v) {
    if (this._cache[key] !== v) { this._cache[key] = v; node.textContent = v; }
  }
  _disp(key, node, v, disp) {
    if (this._cache[key] !== v) { this._cache[key] = v; node.style.display = v ? (disp || 'block') : 'none'; }
  }

  setFuelVisible(v) { this._showFuel = v; }

  // Attitude from the live vehicle quaternion unless supplied by the caller.
  _attitude(d) {
    if (d.pitch != null && d.roll != null) return [d.pitch * DEG, d.roll * DEG];
    try {
      const g = window.__game, v = g && g.vehicle;
      if (v && v.mesh) {
        const q = v.mesh.quaternion, x = q.x, y = q.y, z = q.z, w = q.w;
        // forward = (0,0,-1) rotated; right = (1,0,0) rotated; up = (0,1,0) rotated
        const fy = -(2 * (y * z + w * x));
        const ry = 2 * (x * y + w * z);
        const uy = 1 - 2 * (x * x + z * z);
        return [Math.asin(clamp(fy, -1, 1)) * DEG, Math.atan2(-ry, uy) * DEG];
      }
    } catch (e) { /* ignore */ }
    return [0, 0];
  }

  update(d) {
    if (!d) return;
    const now = performance.now();
    const dt = clamp((now - this._lastT) / 1000, 0.001, 0.1);
    this._lastT = now;
    const V = this._v, U = this.U;
    const kn = 1 - Math.exp(-11 * dt), kg = 1 - Math.exp(-14 * dt);

    if (d.speed != null) {
      V.spd += (d.speed - V.spd) * kn;
      const disp = V.spd * U.speed;
      this._txt('spd', this.eSpdD, String(Math.round(disp)));
      const f = clamp(disp / this._spdMax, 0, 1);
      const q = Math.round(f * 500);
      if (this._cache.spdf !== q) { this._cache.spdf = q; this.eSpdV.setAttribute('stroke-dasharray', (f * 100).toFixed(2) + ' 200'); }
    }
    if (d.altitude != null) {
      V.alt += (d.altitude - V.alt) * kg;
      const a = V.alt * U.alt;
      this._txt('alt', this.eAltD, String(Math.round(a)));
      const la = ((a % 1000) / 1000 * 360).toFixed(1), sa = (a / 10000 * 360 % 360).toFixed(1);
      if (this._cache.la !== la) { this._cache.la = la; this.eAltL.setAttribute('transform', `rotate(${la} 80 80)`); this.eAltS.setAttribute('transform', `rotate(${sa} 80 80)`); }
      const warn = d.altitude < 25 && (d.vspeed || 0) < -2.5;
      if (this._cache.warn !== warn) { this._cache.warn = warn; this.gAlt.classList.toggle('warn', warn); }
    }
    // attitude + vertical speed
    const [pi, ro] = this._attitude(d);
    V.pitch += (pi - V.pitch) * kg;
    let dr = ro - V.roll; if (dr > 180) dr -= 360; if (dr < -180) dr += 360;
    V.roll += dr * kg;
    const pk = Math.round(V.pitch * 8) + ':' + Math.round(V.roll * 8);
    if (this._cache.att !== pk) {
      this._cache.att = pk;
      this.eAttG.setAttribute('transform', `rotate(${(-V.roll).toFixed(2)}) translate(0 ${(clamp(V.pitch, -40, 40) * 1.55).toFixed(2)})`);
      this.eAttRollG.setAttribute('transform', `translate(92 92) rotate(${(-V.roll).toFixed(2)})`);
    }
    if (d.vspeed != null) {
      V.vs += (d.vspeed - V.vs) * kn;
      const y = clamp(-V.vs / 10, -1, 1) * 50;
      const k = Math.round(y * 4);
      if (this._cache.vsm !== k) {
        this._cache.vsm = k;
        this.eVsm.setAttribute('y', (y - 3).toFixed(1));
        this.eVsm.setAttribute('fill', V.vs >= 0 ? '#7dff5a' : '#ff6a5a');
      }
    }
    if (d.heading != null) this.drawCompass(d.heading);
    if (d.throttle != null) {
      V.thr += (d.throttle - V.thr) * kn;
      const k = 'thr' + Math.round(V.thr * 100);
      if (this._cache.thr !== k) { this._cache.thr = k; this.eThrFill.style.height = 'calc(' + Math.round(V.thr * 100) + '% - 6px)'; }
      let hang = false; try { hang = window.__game && window.__game.vehicleKey === 'hangGlider'; } catch (e) { /* ignore */ }
      this._disp('thrvis', this.eThrBar, !hang, 'block');
    }
    if (d.fuel != null) {
      V.fuel += (d.fuel - V.fuel) * kn;
      const k = 'fu' + Math.round(V.fuel * 100);
      if (this._cache.fu !== k) {
        this._cache.fu = k;
        this.eFuelFill.style.height = 'calc(' + Math.round(V.fuel * 100) + '% - 6px)';
        this.eFuelBar.classList.toggle('low', d.fuel < 0.25);
      }
      const vis = this._showFuel != null ? this._showFuel : d.fuel < 0.999;
      this._disp('fuvis', this.eFuelBar, vis, 'block');
    }
    if ('timer' in d) {
      this._txt('tm', this.eTimer, fmtTime(d.timer));
      this._disp('tmvis', this.eTimer, d.timer != null);
      const low = d.timer != null && d.timer < 15 && d.timer > 0;
      if (this._cache.tlow !== low) { this._cache.tlow = low; this.eTimer.classList.toggle('low', low); }
    }
    if (d.score != null) {
      V.score += (d.score - V.score) * (1 - Math.exp(-8 * dt));
      if (Math.abs(d.score - V.score) < 0.6) V.score = d.score;
      this._txt('sc', this.eScoreB, String(Math.round(V.score)));
    }
    if ('objective' in d) {
      this._txt('obj', this.eObj, d.objective || '');
      this._disp('objvis', this.eObj, !!d.objective);
    }
    if (d.ringsTotal != null) {
      const k = (d.ringsHit || 0) + '/' + d.ringsTotal;
      if (this._cache.rg !== k) {
        this._cache.rg = k;
        const n = d.ringsTotal, h = d.ringsHit || 0;
        if (n <= 0) this.eRings.innerHTML = '';
        else if (n <= 14) { let s = ''; for (let i = 0; i < n; i++) s += `<span class="sw-pip ${i < h ? 'on' : ''}"></span>`; this.eRings.innerHTML = s; }
        else this.eRings.textContent = 'RINGS ' + k;
      }
    }
    if ('state' in d) {
      const s = d.state;
      const show = s === 'grounded' ? 'READY - PRESS SPACE' : (s === 'crashed' ? 'CRASHED' : (s === 'splashed' ? 'SPLASHDOWN' : ''));
      this._txt('st', this.eState, show);
      this._disp('stvis', this.eState, !!show);
    }
    if (d.message && d.message !== this._lastMsg) this.flash(d.message);
    this._lastMsg = d.message || '';
  }

  // Compass tape (HiDPI canvas), shows +/-60 degrees, smoothly interpolated.
  drawCompass(h) {
    let deg = (((h * this.headingSign) * DEG) % 360 + 360) % 360;
    const prev = this._v.hdg;
    let dd = deg - prev; if (dd > 180) dd -= 360; if (dd < -180) dd += 360;
    if (this._compassHeading === this._compassHeading) this._v.hdg = (prev + dd * 0.5 + 360) % 360; else this._v.hdg = deg;
    deg = this._v.hdg;
    const q = Math.round(deg * 8);
    if (q === this._compassHeading) return;
    this._compassHeading = q;
    const c = this.compassCanvas, g = c.getContext('2d');
    const W = c.width, H = c.height, span = 100, ppd = W / span;
    g.clearRect(0, 0, W, H);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const fade = g.createLinearGradient(0, 0, W, 0);
    fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(.18, 'rgba(0,0,0,1)'); fade.addColorStop(.82, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
    const start = Math.floor(deg - span / 2 - 1), end = Math.ceil(deg + span / 2 + 1);
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let a = start; a <= end; a++) {
      if (a % 5 !== 0) continue;
      const x = W / 2 + (a - deg) * ppd;
      const an = ((a % 360) + 360) % 360;
      const major = an % 15 === 0;
      g.fillStyle = major ? 'rgba(235,248,255,.95)' : 'rgba(200,225,255,.45)';
      g.fillRect(x - 1.5, H - (major ? 30 : 18), 3, major ? 30 : 18);
      if (an % 45 === 0) {
        g.font = "400 34px 'Russo One', sans-serif";
        g.fillStyle = an === 0 ? '#ff6a5a' : '#ffc83d';
        g.fillText(names[an], x, 34);
      } else if (an % 15 === 0) {
        g.font = "700 24px 'Rajdhani', sans-serif";
        g.fillStyle = '#bfe0ff';
        g.fillText(String(an), x, 34);
      }
    }
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = fade; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
  }

  // bearing: radians RELATIVE to the vehicle's nose (0 = dead ahead, + = to the right). distance in metres.
  // Pass null to hide. If `heading` supplied, `rad` is a world bearing.
  setTargetBearing(rad, distance, heading) {
    if (rad == null || !isFinite(rad)) { this._disp('arvis', this.eArrowBox, false); return; }
    let a = rad;
    if (heading != null) a = rad - heading;
    this._disp('arvis', this.eArrowBox, true, 'flex');
    const deg = Math.round(a * DEG);
    if (this._cache.ard !== deg) { this._cache.ard = deg; this.eArrowG.setAttribute('transform', 'rotate(' + deg + ')'); }
    if (distance != null) {
      const u = getSettings().units;
      let t;
      if (u === 'metric') t = distance >= 1000 ? (distance / 1000).toFixed(1) + ' KM' : Math.round(distance) + ' M';
      else if (u === 'imperial') t = distance >= 1609 ? (distance / 1609.34).toFixed(1) + ' MI' : Math.round(distance * 3.28084) + ' FT';
      else t = distance >= 1852 ? (distance / 1852).toFixed(1) + ' NM' : Math.round(distance * 3.28084) + ' FT';
      this._txt('dist', this.eDist, t);
    }
  }

  // ---- messaging: ring/target popups, rating stamps, big banners, hint text ----------------------------------------
  flash(text, ms = 1600) {
    if (!text) return;
    const s = String(text);
    let m = /^RING (\d+)\s*\/\s*(\d+)/.exec(s);
    if (m) return this.popup('RING ' + m[1] + '/' + m[2], '+' + RING_PTS, 'ring', ms);
    m = /^TARGET DESTROYED\s*(\d+)?\s*\/?\s*(\d+)?/.exec(s);
    if (m) return this.popup('TARGET DESTROYED', '+' + TARGET_PTS + (m[1] ? '  ' + m[1] + '/' + m[2] : ''), 'tgt', ms);
    const STAMPS = { 'PERFECT LANDING!': ['#7dff9a', 'PILOT RATING'], 'MISSED THE PAD!': ['#ffc83d', 'OFF TARGET'], 'CRASH!': ['#ff5a4a', 'MAYDAY'], 'SPLASHDOWN!': ['#4de1ff', 'MAN OVERBOARD'], "TIME'S UP!": ['#ff9a3c', 'OUT OF TIME'] };
    if (STAMPS[s]) return this.stamp(s, STAMPS[s][0], STAMPS[s][1], ms);
    this._flashQueue.push({ text: s, ms, hint: /^(PRESS|HOLD)/.test(s) });
    if (this._flashQueue.length > 4) this._flashQueue.shift();
    if (!this._flashBusy) this._nextFlash();
  }

  popup(text, sub, kind, ms = 1300) {
    const p = el('div', null, 'sw-pop ' + (kind || ''), this.ePops);
    const col = kind === 'tgt' ? '#ff9a3c' : '#4de1ff';
    p.innerHTML = kind === 'tgt'
      ? `<svg viewBox="-20 -20 40 40"><circle r="15" fill="none" stroke="${col}" stroke-width="3"/><circle r="8" fill="none" stroke="${col}" stroke-width="3"/><circle r="2.5" fill="${col}"/></svg>`
      : `<svg viewBox="-20 -20 40 40"><ellipse rx="9" ry="16" fill="none" stroke="${col}" stroke-width="5" style="filter:drop-shadow(0 0 4px ${col})"/></svg>`;
    el('span', null, 't', p).textContent = text;
    if (sub) el('span', null, 's', p).textContent = sub;
    p.style.setProperty('--d', Math.max(900, ms + 400) + 'ms');
    while (this.ePops.children.length > 3) this.ePops.firstChild.remove();
    // stack older popups upward
    Array.from(this.ePops.children).forEach((c, i, arr) => { c.style.top = (-(arr.length - 1 - i) * 52) + 'px'; });
    setTimeout(() => p.remove(), ms + 500);
    if (kind === 'ring' || kind === 'tgt') {
      const f = this.eRingFx; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
      f.style.background = kind === 'tgt' ? 'radial-gradient(ellipse at center,transparent 55%,rgba(255,150,60,.35) 100%)' : '';
    }
  }

  stamp(text, color, sub, ms = 1800) {
    const s = this.eStamp;
    s.classList.remove('show');
    void s.offsetWidth;
    s.innerHTML = `<div class="sw-stampbox" style="--c:${color || '#7dff9a'}"><small>${sub || ''}</small>${text.replace(/!$/, '')}</div>`;
    s.style.setProperty('--d', Math.max(1800, ms + 600) + 'ms');
    s.classList.add('show');
    clearTimeout(this._stampT);
    this._stampT = setTimeout(() => s.classList.remove('show'), Math.max(1800, ms + 600));
  }

  _nextFlash() {
    const m = this._flashQueue.shift();
    if (!m) { this._flashBusy = false; return; }
    this._flashBusy = true;
    const f = this.eFlash;
    f.classList.remove('show');
    void f.offsetWidth;
    f.classList.toggle('hint', !!m.hint);
    f.textContent = m.text;
    f.style.setProperty('--d', m.ms + 'ms');
    f.classList.add('show');
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => { f.classList.remove('show'); this._nextFlash(); }, m.ms);
  }

  clearFlash() {
    this._flashQueue.length = 0;
    clearTimeout(this._flashT);
    clearTimeout(this._stampT);
    this.eFlash.classList.remove('show');
    this.eStamp.classList.remove('show');
    this.ePops.innerHTML = '';
    this._flashBusy = false;
  }

  // data: {title, subtitle, medal, grade, score, newBest, rows:[{label,value}]|[[l,v]], onRetry,onContinue,onMenu, buttons}
  showResults(data) {
    data = data || {};
    const R = this.eResults;
    R.innerHTML = '';
    const card = el('div', null, 'sw-rcard', R);
    el('div', null, 'sw-rtitle', card).textContent = data.title || 'MISSION COMPLETE';
    if (data.subtitle) el('div', null, 'sw-rsub', card).textContent = data.subtitle;
    const medal = String(data.medal || 'none').toLowerCase();
    const mc = el('div', null, 'sw-hmedal ' + medal, card);
    mc.textContent = medal === 'none' ? 'TRY AGAIN' : '★';
    if (medal !== 'none') el('div', null, 'sw-rsub', card).textContent = medal.toUpperCase() + ' MEDAL';
    if (data.grade) el('div', null, 'sw-grade', card).textContent = 'GRADE ' + data.grade;
    const rows = el('div', null, 'sw-rows', card);
    for (const r of data.rows || []) {
      const label = Array.isArray(r) ? r[0] : r.label;
      const value = Array.isArray(r) ? r[1] : r.value;
      const row = el('div', null, 'sw-row', rows);
      el('span', null, null, row).textContent = label;
      el('b', null, null, row).textContent = value;
    }
    if (data.score != null) {
      const totalEl = el('div', null, 'sw-total', card);
      totalEl.textContent = 'TOTAL 0';
      const target = Math.round(data.score), t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / 1200);
        totalEl.textContent = 'TOTAL ' + Math.round(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1 && totalEl.isConnected) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    if (data.newBest) el('div', null, 'sw-new', card).textContent = 'NEW BEST!';
    const btns = [];
    if (data.onRetry) btns.push({ label: 'RETRY', onClick: data.onRetry });
    if (data.onContinue) btns.push({ label: 'CONTINUE', onClick: data.onContinue });
    if (data.onMenu) btns.push({ label: 'MENU', onClick: data.onMenu });
    for (const b of data.buttons || []) btns.push(b);
    if (btns.length) {
      const bar = el('div', null, 'sw-btns', card);
      for (const b of btns) {
        const bt = el('button', null, 'sw-btn', bar);
        bt.textContent = b.label;
        bt.addEventListener('click', () => { try { b.onClick && b.onClick(); } catch (e) { console.error(e); } });
      }
    }
    R.classList.add('on');
    this.root.classList.add('on');
  }

  hideResults() {
    this.eResults.classList.remove('on');
    this.eResults.innerHTML = '';
  }

  // Build minimap from world.heightAt; returns the minimap object (also stored on this.minimap).
  createMinimap(world, opts) {
    this.minimap = createMinimap(world, opts);
    this.eMM.innerHTML = '';
    this.eMM.appendChild(this.minimap.canvas);
    el('div', null, 'sweep', this.eMM);
    this.eMM.style.display = 'block';
    return this.minimap;
  }

  updateMinimap(x, z, heading, markers) {
    if (this.minimap) this.minimap.update(x, z, heading, markers);
  }

  showMinimap(b) { this.eMM.style.display = b && this.minimap ? 'block' : 'none'; }

  dispose() { this.root.remove(); }
}

// Standalone minimap: samples world.heightAt once into an offscreen canvas. HiDPI, bezel, range rings, glowing markers.
export function createMinimap(world, opts = {}) {
  const size = opts.size || 168;
  const extent = opts.extent || 4000; // world width covered
  const res = opts.resolution || 160;
  const half = extent / 2;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.round(size * dpr);
  canvas.style.width = canvas.style.height = size + 'px';
  const ctx = canvas.getContext('2d');
  const base = document.createElement('canvas');
  base.width = base.height = res;
  const bctx = base.getContext('2d');
  const img = bctx.createImageData(res, res);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const x = -half + (i + 0.5) / res * extent;
      const z = -half + (j + 0.5) / res * extent;
      let h = 0;
      try { h = world.heightAt(x, z); } catch (e) { h = 0; }
      let r, g, b;
      if (h <= 0.5) { const d = Math.max(0, Math.min(1, -h / 40)); r = 28 - 18 * d; g = 118 - 55 * d; b = 214 - 60 * d; }
      else if (h < 6) { r = 236; g = 216; b = 150; }
      else if (h < 90) { const t = h / 90; r = 70 + 40 * t; g = 168 - 40 * t; b = 70; }
      else if (h < 220) { const t = (h - 90) / 130; r = 130 + 40 * t; g = 112 + 30 * t; b = 84 + 40 * t; }
      else { r = g = b = 245; }
      let sh = 0;
      try { sh = (world.heightAt(x - 40, z - 40) - h) * 0.004; } catch (e) { sh = 0; }
      const k = 1 + Math.max(-0.35, Math.min(0.35, sh));
      const o = (j * res + i) * 4;
      img.data[o] = Math.min(255, r * k); img.data[o + 1] = Math.min(255, g * k); img.data[o + 2] = Math.min(255, b * k); img.data[o + 3] = 255;
    }
  }
  bctx.putImageData(img, 0, 0);

  const S = canvas.width, toPx = (x, z) => [(x + half) / extent * S, (z + half) / extent * S];
  let t0 = 0;
  const api = {
    canvas, extent, size,
    // North-up map. x,z world; heading radians (0 = north/-Z, clockwise +).
    update(px, pz, heading = 0, markers) {
      t0 += 0.016;
      const c = S / 2;
      ctx.clearRect(0, 0, S, S);
      ctx.save();
      ctx.beginPath(); ctx.arc(c, c, c - 1, 0, TAU); ctx.clip();
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(base, 0, 0, S, S);
      ctx.fillStyle = 'rgba(6,20,50,.18)'; ctx.fillRect(0, 0, S, S);
      // range rings
      ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = dpr;
      for (const f of [0.33, 0.66]) { ctx.beginPath(); ctx.arc(c, c, c * f, 0, TAU); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(c, 0); ctx.lineTo(c, S); ctx.moveTo(0, c); ctx.lineTo(S, c); ctx.stroke();
      if (markers) {
        for (const m of markers) {
          const [mx, my] = toPx(m.x, m.z);
          const col = m.color || '#ff3030', rr = (m.radius || 4) * dpr * 0.9;
          ctx.shadowColor = col; ctx.shadowBlur = 8 * dpr;
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(mx, my, rr, 0, TAU); ctx.fill();
          ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
        }
      }
      const [x, y] = toPx(px, pz);
      ctx.translate(x, y);
      ctx.rotate(heading);
      // view cone
      const cone = ctx.createLinearGradient(0, 0, 0, -34 * dpr);
      cone.addColorStop(0, 'rgba(255,200,61,.5)'); cone.addColorStop(1, 'rgba(255,200,61,0)');
      ctx.fillStyle = cone;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-16 * dpr, -34 * dpr); ctx.lineTo(16 * dpr, -34 * dpr); ctx.closePath(); ctx.fill();
      const pulse = 0.5 + 0.5 * Math.sin(t0 * 5);
      ctx.strokeStyle = `rgba(255,200,61,${0.5 * (1 - pulse)})`; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.arc(0, 0, (7 + pulse * 9) * dpr, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#ffc83d'; ctx.strokeStyle = '#3a2200'; ctx.lineWidth = 1.5 * dpr;
      ctx.shadowColor = '#ffc83d'; ctx.shadowBlur = 8 * dpr;
      const u = dpr;
      ctx.beginPath(); ctx.moveTo(0, -9 * u); ctx.lineTo(6.5 * u, 7 * u); ctx.lineTo(0, 3.5 * u); ctx.lineTo(-6.5 * u, 7 * u); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
      // bezel + north marker
      ctx.strokeStyle = 'rgba(200,230,255,.55)'; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.arc(c, c, c - dpr, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#ff6a5a';
      ctx.beginPath(); ctx.moveTo(c, 2 * dpr); ctx.lineTo(c - 5 * dpr, 12 * dpr); ctx.lineTo(c + 5 * dpr, 12 * dpr); ctx.closePath(); ctx.fill();
      ctx.font = `${11 * dpr}px 'Russo One', sans-serif`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      ctx.fillText('N', c, 24 * dpr);
    },
  };
  api.update(0, 0, 0);
  return api;
}
