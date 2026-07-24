// DOM-side UI: gauges, interaction prompt, CERES toasts, logbook, screen fades.

import { state } from './state.js';

const $ = (id) => document.getElementById(id);

export function updateHUD() {
  for (const id of ['power', 'oxygen', 'hull']) {
    const el = $('bar-' + id);
    const v = state.systems[id] ?? 100;
    el.style.width = v + '%';
    el.classList.toggle('low', v < 55);
  }
  const h = Math.floor(state.hour), m = Math.floor((state.hour % 1) * 60);
  $('daybox').textContent =
    `DAY ${state.day} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` +
    (state.mode === 'eva' ? ' · EVA' : '');
  const bits = [];
  if (state.parts) bits.push(`parts ×${state.parts}`);
  if (state.plant.harvests) bits.push(`harvests ×${state.plant.harvests}`);
  if (state.curios.length) bits.push(`curios ×${state.curios.length}`);
  $('inv').textContent = bits.join(' · ');
}

export function setPrompt(text) {
  const p = $('prompt');
  if (!text) { p.classList.remove('show'); return; }
  p.innerHTML = text;
  p.classList.add('show');
}

let toastTimers = [];
export function toast(text, who = 'CERES') {
  const wrap = $('toasts');
  const t = document.createElement('div');
  t.className = 'toast' + (who === 'SHIP' ? ' ship' : '');
  t.innerHTML = `<span class="who">${who}</span>${text}`;
  wrap.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  const tm = setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 500);
  }, 7000);
  toastTimers.push(tm);
}

export function renderLogbook(logData) {
  const wrap = $('entries');
  wrap.innerHTML = '';
  const all = [
    ...logData.entries.map(e => ({ ...e, kind: 'log', unlocked: state.unlockedLogs.includes(e.id) })),
    ...logData.discoveries.map(e => ({ ...e, kind: 'disc', unlocked: state.unlockedDiscoveries.includes(e.id) })),
  ];
  for (const e of all) {
    const div = document.createElement('div');
    div.className = 'entry' + (e.unlocked ? '' : ' locked');
    const stamp = e.kind === 'disc' ? 'RECOVERED SIGNAL' : `LOG · DAY ${e.unlockDay}`;
    div.innerHTML = e.unlocked
      ? `<div class="stamp">${stamp}</div><h2>${e.title}</h2><p>${e.text}</p>`
      : `<div class="stamp">${stamp}</div><h2>· · ·</h2><p>Not yet written.</p>`;
    wrap.appendChild(div);
  }
}

export function isLogbookOpen() { return $('logbook').classList.contains('open'); }

export function toggleLogbook(force) {
  const lb = $('logbook');
  const open = force !== undefined ? force : !lb.classList.contains('open');
  lb.classList.toggle('open', open);
  return open;
}

export function fade(toBlack, dur = 1.4) {
  const f = $('fade');
  f.style.transitionDuration = dur + 's';
  f.style.opacity = toBlack ? '1' : '0';
  return new Promise(res => setTimeout(res, dur * 1000));
}

export function hideTitle() { $('title').classList.add('hidden'); }
export function onTitleClick(fn) { $('title').addEventListener('click', fn, { once: true }); }
