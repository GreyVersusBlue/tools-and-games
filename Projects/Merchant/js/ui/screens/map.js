// The map table (DESIGN 4.7): the A03 still with the stops, roads and expeditions drawn over it
// by the game, the price board, and the way into outfitting. Stop positions come from
// map-cairo-geo.json in the picture's own pixels and are placed as percentages of the shown
// picture, so the layer is the same size as the picture at every frame. The engine owns every
// rule; this file asks it (view, routeFor) and draws the answer.
import { h, qs, qsa } from '../dom.js';
import * as engine from '../../engine/index.js';
import { dinars } from './paper.js';
import { createOutfit, firstLegState, freeAgents, stopOf, stopName, cap } from './outfit.js';

const NEAR = 48;                 // a press goes to the closest stop within this many px (DESIGN 4.7)
const TOAST_MS = 5000;           // how long the set-out toast stays
const CLUSTER_BELOW = 700;       // px of screen width under which close stops show as one label
const geoUrl = new URL('../../../assets/art/map-cairo-geo.json', import.meta.url);
let geoPromise = null;
const loadGeo = () => (geoPromise ??= fetch(geoUrl).then(r => r.json()));

/** The picture's pixel for a latitude and longitude, by bilinear steps over the geo file's own grid.
    Only for a stop the geo file does not list (a placeholder file lacked Famagusta). */
function project(geo, lat, lon) {
  const { lats, lons } = geo.grid, at = (list, v) => {
    const i = list.findIndex((a, k) => k === list.length - 1 || (v - a) * (v - list[k + 1]) <= 0);
    const j = Math.min(i + 1, list.length - 1);
    return [i, j, list[i] === list[j] ? 0 : (v - list[i]) / (list[j] - list[i])];
  };
  const [r0, r1, tr] = at(lats, lat), [c0, c1, tc] = at(lons, lon), g = (r, c) => geo.grid.xy[r][c];
  const mix = (a, b, t) => a + (b - a) * t;
  const top = [mix(g(r0, c0)[0], g(r0, c1)[0], tc), mix(g(r0, c0)[1], g(r0, c1)[1], tc)];
  const bot = [mix(g(r1, c0)[0], g(r1, c1)[0], tc), mix(g(r1, c0)[1], g(r1, c1)[1], tc)];
  return { x: mix(top[0], bot[0], tr), y: mix(top[1], bot[1], tr) };
}

/** The sides a label may sit on, tried in this order after the one stops.json names (DESIGN 4.7).
    dx, dy: pixels from the dot's centre; ax, ay: the share of the label's own width and height
    to pull back by, so a label on the left of its dot ends at the dot and one above it stands on it. */
const SIDES = {
  right: { dx: 12, dy: 0, ax: 0, ay: -0.5 }, left: { dx: -12, dy: 0, ax: -1, ay: -0.5 },
  above: { dx: 0, dy: -11, ax: -0.5, ay: -1 }, below: { dx: 0, dy: 11, ax: -0.5, ay: 0 },
  'above-right': { dx: 8, dy: -8, ax: 0, ay: -1 }, 'below-right': { dx: 8, dy: 8, ax: 0, ay: 0 },
  'above-left': { dx: -8, dy: -8, ax: -1, ay: -1 }, 'below-left': { dx: -8, dy: 8, ax: -1, ay: 0 },
};
const ANCHOR_AX = { start: 0, middle: -0.5, end: -1 };
const GAP = 3;                   // px kept clear around a label, so two never touch
const hits = (a, b) => a.left < b.right + GAP && b.left < a.right + GAP && a.top < b.bottom + GAP && b.top < a.bottom + GAP;
const inside = (a, f) => a.left >= f.left && a.right <= f.right && a.top >= f.top && a.bottom <= f.bottom;

/** When the soonest expedition of a group is expected home, in words ("Winter 1325"): the engine's own answer, view().homeBy. */
function homeBy(app, list) {
  const by = app.view().homeBy ?? {};
  const best = list.map(x => by[x.id]).filter(Boolean).sort((p, q) => p.in - q.in)[0];
  return best?.season ?? 'a season not yet known';
}

/** app: the page's app object. nav: { toDesk(), openOutfit() }. Returns { el, key, draw, hasDraft,
    showOutfit, hideOutfit, destroy }. */
/** MER-122: why the list of best trades is empty, in the house's terms; the engine's list is empty for four reasons (MER-121) and the
    line used to say only the third. In the order a player can mend them: nobody free, too little money, no news, nothing pays.
    `app` needs `content` and `state`; `v` is its view(). { id, text } */
export function noTradesWhy(app, v) {
  const home = app.content.city.home;
  if (!freeAgents(app).length) return { id: 'nobody', text: 'Nobody is free to go, so no trade is listed. Agents ask for work at the start of a season.' };
  const homePrices = Object.entries(v.prices[home] ?? {}).map(([g, p]) => [g, p?.p]).filter(([, p]) => p != null);
  const loadCost = Math.min(...homePrices.map(([, p]) => p));
  const stocked = homePrices.some(([g]) => (app.state.stock[g] ?? 0) > 0);
  if (!stocked && Number.isFinite(loadCost) && v.money < loadCost) return { id: 'money', text: `The house has too little money for even one load (${dinars(loadCost)}), so no trade is listed.` };
  const news = Object.entries(v.prices).some(([stopId, goods]) => stopId !== home && Object.values(goods ?? {}).some(p => p?.p != null));
  if (!news) return { id: 'news', text: 'The house has no news yet of what goods sell for in other stops. Letters from far stops arrive late.' };
  return { id: 'pays', text: 'The house knows the prices in other stops, and no trade pays after the road and the wage. Check again when a letter brings new prices.' };
}

export function createMap(app, nav) {
  const { content } = app;
  const home = content.city.home;
  const stops = content.stops ?? [];
  let geo = null;                  // loaded once; the picture's pixel positions
  const firstStop = content.city.firstStop ?? 'damascus';   // the stop the first expedition's card names (desk.js reads it the same way)
  let selected = stops.some(s => s.id === firstStop) ? firstStop : (engine.destinations(app.state, content)[0]?.stop ?? stops.find(s => s.id !== home)?.id ?? home);
  let lit = selected;              // the listbox's highlighted option; Enter makes it the selected one
  let zoom = null;                 // a cluster id while it is shown as an inset
  let outfit = null;               // { stopId, view } while the sheet is open
  let opener = null;
  let typed = '', typedAt = 0;
  const pos = {};                  // stop id -> { x, y } in percent of the picture
  let gone = false;                // destroy() ran, so an answer that arrives late draws nothing
  /** What the map calls a group of close stops: city.json's `clusters`, else the id read as words. */
  const clusterName = id => content.city.clusters?.[id] ?? cap(String(id).replace(/-/g, ' '));

  const asset = app.art.get('map-cairo');
  const img = h('img', { class: 'map-img', src: `assets/art/${asset?.file ?? 'map-cairo.webp'}`, alt: asset?.alt ?? 'A map of the lands around Cairo.', decoding: 'async', fetchpriority: 'high' });
  // The picture is 16:9 and the stage is not, so bands are left above and below (or beside) it. The same
  // file, blurred and dimmed, fills them: the table reads as full height and no stop moves (MER-71, finding 11).
  const fill = h('img', { class: 'map-fill', src: img.getAttribute('src'), alt: '', 'aria-hidden': 'true', decoding: 'async' });
  const roads = h('svg', { class: 'map-roads', 'aria-hidden': 'true', viewBox: '0 0 1920 1080', preserveAspectRatio: 'none' });
  roads.setAttribute('focusable', 'false');
  const layer = h('div', { class: 'map-layer' });
  const frame = h('div', { class: 'map-frame', id: 'map-frame' }, img, roads, layer);
  const unzoom = h('button', { class: 'button map-unzoom', type: 'button', id: 'map-unzoom', hidden: true, onclick: () => { setZoom(null); focusDetails(); } }, 'Show the whole map');
  const stage = h('div', { class: 'map-stage' }, fill, frame, unzoom);
  const toast = h('p', { class: 'map-toast', id: 'map-toast', hidden: true });

  const date = h('p', { class: 'date', id: 'map-date' });
  const money = h('p', { class: 'money', id: 'map-money' });
  const bar = h('header', { class: 'map-bar' }, h('div', { class: 'bar-date' }, date), money,
    h('button', { class: 'button', type: 'button', id: 'map-desk-top', onclick: () => nav.toDesk() }, 'Back to the desk'));

  const boardTitle = h('h2', { class: 'board-title', id: 'board-title', tabindex: '-1' });
  const list = h('div', { class: 'stoplist', id: 'stoplist', role: 'listbox', tabindex: '0', 'aria-label': 'Stops',
    onkeydown: e => listKey(e), onfocus: () => { lit = selected; markLit(); } });
  const pricesBtn = h('button', { class: 'button prices-open', type: 'button', id: 'btn-prices', 'aria-haspopup': 'dialog', onclick: () => openPrices() });
  const pricesBox = h('div', { class: 'prices-box', id: 'prices-box' });
  const reason = h('p', { class: 'reason', id: 'outfit-open-reason' });
  const outfitBtn = h('button', { class: 'button primary', type: 'button', id: 'btn-outfit', 'aria-describedby': 'outfit-open-reason', onclick: () => pressOutfit() });
  const board = h('aside', { class: 'board', id: 'board', 'aria-label': 'Prices and stops' },
    boardTitle, list, pricesBtn, pricesBox, toast,
    h('div', { class: 'board-actions' }, reason, outfitBtn,
      h('button', { class: 'button', type: 'button', id: 'map-desk', onclick: () => nav.toDesk() }, 'Back to the desk')));
  const el = h('main', { class: 'map-screen', id: 'screen-map' }, bar, stage, board);
  // MER-124: the set-out toast lives in the board, in the flow above its buttons, where it covers no stop, label or token at any frame
  // (it was fixed over the picture and sat on the labels on a phone). The first press anywhere on the table dismisses it.
  el.addEventListener('pointerdown', () => hideToast(), true);

  // ---- what the player can do with a stop
  function outfitState(stopId) {
    if (stopId === home) return { ok: false, reason: `${stopName(content, home)} is where your house is. Choose another stop.` };
    if (!freeAgents(app).length) return { ok: false, reason: 'Nobody is free to go. Agents ask for work at the start of a season.' };
    const f = firstLegState(app, stopId);
    if (!f) return { ok: false, reason: `No road leads to ${stopName(content, stopId)} yet.` };
    if (!f.open) return { ok: false, reason: `The road to ${stopName(content, stopId)} is closed until ${f.next ?? 'later'}.` };
    return { ok: true, reason: '' };
  }
  function pressOutfit() {
    const s = outfitState(selected);
    if (!s.ok) { app.say(s.reason); return; }
    nav.openOutfit(selected);
  }

  // ---- the stops on the picture
  const small = () => matchMedia(`(max-width: ${CLUSTER_BELOW - 1}px)`).matches;
  const clusterOf = id => stopOf(content, id)?.cluster ?? null;
  const members = c => stops.filter(s => s.cluster === c);
  const clusters = () => [...new Set(stops.map(s => s.cluster).filter(c => c && members(c).length > 1))];
  const grouped = () => small() && !zoom;

  function setZoom(c) {
    zoom = c;
    drawMap();
    qs('#map-unzoom', el).hidden = !c;
    app.say(c ? `${clusterName(c)}, ${members(c).length} stops, shown larger.` : 'The whole map.');
    if (c) { const m = members(c)[0]; if (!clusterOf(selected) || clusterOf(selected) !== c) select(m.id, { keepFocus: true }); }
  }

  /** Where tokens, dots and labels go and how big the inset is. */
  function drawMap() {
    if (!geo) return;
    const v = app.view();
    let k = 1, tx = 0, ty = 0;
    if (zoom) {
      const ps = members(zoom).map(s => pos[s.id]);
      const xs = ps.map(p => p.x), ys = ps.map(p => p.y);
      const w = Math.max(...xs) - Math.min(...xs), hgt = Math.max(...ys) - Math.min(...ys);
      k = Math.min(6, 55 / Math.max(w, hgt * 16 / 9, 9));
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      tx = 50 - k * cx; ty = 50 - k * cy;
    }
    layer.style.setProperty('--k', String(k));
    layer.style.transform = zoom ? `translate(${tx}%, ${ty}%) scale(${k})` : 'none';
    roads.style.transform = layer.style.transform;
    qs('#map-unzoom', el).hidden = !zoom;

    // roads: one line for each pair of stops a leg joins; dashed madder when closed this season
    const seen = new Map();
    for (const r of content.routes ?? []) for (const leg of r.legs) {
      const key = [leg.from, leg.to].sort().join('|');
      const open = leg.opens.includes(v.season);
      const was = seen.get(key);
      seen.set(key, { from: leg.from, to: leg.to, open: was ? was.open || open : open });
    }
    const svg = [...seen.values()].filter(l => pos[l.from] && pos[l.to]).map(l => {
      const a = pos[l.from], b = pos[l.to];
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', a.x * 19.2); line.setAttribute('y1', a.y * 10.8); line.setAttribute('x2', b.x * 19.2); line.setAttribute('y2', b.y * 10.8);
      line.setAttribute('class', `road ${l.open ? 'open' : 'closed'}`);
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      return line;
    });
    roads.replaceChildren(...svg);

    const out = [];
    const grp = grouped() ? clusters() : [];
    const drawn = new Set();
    const pairs = [];              // each dot with its label, for placeLabels
    for (const s of stops) {
      if (grp.includes(s.cluster)) {
        if (drawn.has(s.cluster)) continue;
        drawn.add(s.cluster);
        const ms = members(s.cluster), x = ms.reduce((n, m) => n + pos[m.id].x, 0) / ms.length, y = ms.reduce((n, m) => n + pos[m.id].y, 0) / ms.length;
        const dot = h('span', { class: 'dot cluster', role: 'img', 'aria-label': `${clusterName(s.cluster)}, ${ms.length} stops`, style: `left:${x}%;top:${y}%`, dataset: { cluster: s.cluster } });
        const label = h('span', { class: 'stop-label cluster-label', 'aria-hidden': 'true', style: `left:${x}%;top:${y}%`, dataset: { cluster: s.cluster } }, `${clusterName(s.cluster)}: ${ms.length} stops`);
        out.push(dot, label); pairs.push({ dot, label, side: null, rank: 1 });
        continue;
      }
      // The dot names the stop to a screen reader even when its label is hidden for want of room
      const p = pos[s.id], lab = s.label ?? { dx: 12, dy: 0, anchor: 'start' };
      const dot = h('span', { class: `dot${s.id === home ? ' home' : ''}${s.id === selected ? ' on' : ''}`, role: 'img', 'aria-label': s.name, tabindex: '-1', style: `left:${p.x}%;top:${p.y}%`, dataset: { stop: s.id } });
      const label = h('span', { class: `stop-label${s.id === home ? ' home' : ''}${s.id === selected ? ' on' : ''}`, 'aria-hidden': 'true', style: `left:${p.x}%;top:${p.y}%`, dataset: { stop: s.id } }, s.name);
      out.push(dot, label);
      pairs.push({ dot, label, side: { dx: lab.dx, dy: lab.dy, ax: ANCHOR_AX[lab.anchor] ?? 0, ay: -0.5 }, rank: s.id === home ? 0 : s.id === selected ? 1 : 2 });
    }
    // expeditions as tokens along their leg; same leg and same place stack with a count
    const groups = new Map();
    for (const x of app.state.expeditions) {
      const route = content.routes.find(r => r.id === x.route);
      const leg = route?.legs[x.leg];
      if (!leg || !pos[leg.from] || !pos[leg.to]) continue;
      const total = leg.seasons, done = x.status === 'out' ? Math.max(0, Math.min(1, 1 - x.left / total)) : 0;
      const frac = Math.round(done * 20) / 20;
      const key = `${leg.from}>${leg.to}@${frac}`;
      if (!groups.has(key)) groups.set(key, { leg, frac, list: [] });
      groups.get(key).list.push(x);
    }
    for (const g of groups.values()) {
      const a = pos[g.leg.from], b = pos[g.leg.to];
      const x = a.x + (b.x - a.x) * g.frac, y = a.y + (b.y - a.y) * g.frac;
      const first = g.list[0], agent = content.agents.find(ag => ag.id === first.agent), n = g.list.length;
      const tok = app.art.get(`token-${g.leg.by}`) ?? app.art.get('token-caravan');
      const seal = agent && app.art.get(agent.seal);
      const text = n === 1 ? `${agent?.name ?? 'An agent'}, home about ${homeBy(app, [first])}`
        : `${n} expeditions, home about ${homeBy(app, g.list)}`;
      out.push(h('div', { class: 'token', style: `left:${x}%;top:${y}%`, dataset: { expedition: g.list.map(e => e.id).join(' '), count: String(n), toward: `${b.x - a.x},${b.y - a.y}` } },
        h('div', { class: 'token-piece' }, h('img', { src: `assets/art/${tok.file}`, alt: '', width: 64, height: 64 }), n > 1 ? h('span', { class: 'token-count' }, String(n)) : null),
        h('p', { class: 'token-label' }, seal ? h('img', { class: 'token-seal', src: `assets/art/${seal.file}`, alt: '', width: 20, height: 20 }) : null, text)));
    }
    layer.replaceChildren(...out);
    placeLabels(pairs);
  }

  /** Put each label on a side of its dot where it overlaps no other label, no dot, and stays whole inside the picture and clear of
      the price panel (DESIGN 4.7). The stop's own `label` side goes first, then the other sides; a label that fits nowhere is hidden
      and its dot stays, with the stop's name as its accessible name. Cairo and the selected stop choose first.
      Then the tokens (MER-124): a party that has just set out sits on its own stop, and its caption is wider than the stop's label, so
      the token used to lie across the label (Ali behind "Cairo") and two parties leaving the same stop lay on each other. The labels are
      placed first, as the map's furniture; each token then keeps its own spot if nothing is there, and else slides along its road, then
      across it, to the nearest spot clear of every label and every other token. A label a token still cannot avoid is hidden. */
  function placeLabels(pairs) {
    const fr = frame.getBoundingClientRect();
    if (!fr.width || !fr.height) return;
    const clip = { left: fr.left, right: fr.right, top: fr.top, bottom: fr.bottom };
    const walls = [board, unzoom].filter(b => b && !b.hidden).map(b => b.getBoundingClientRect()).filter(r => r.width && r.height);
    const centre = d => { const r = d.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const tokens = qsa('.token', layer);
    for (const t of tokens) { t.style.removeProperty('--ox'); t.style.removeProperty('--oy'); t.classList.remove('bare'); }   // measured from where the data puts them
    const marks = pairs.map(p => ({ p, at: centre(p.dot), w: p.label.offsetWidth, h: p.label.offsetHeight }));
    // a dot is a thing a label would rather not cover
    const dots = qsa('.dot', layer).map(n => ({ el: n, r: n.getBoundingClientRect() }));
    const placed = [];
    for (const m of marks.slice().sort((a, b) => a.p.rank - b.p.rank)) {
      // its own side, then every side close in, then every side one step further out (a crowd of
      // dots on a phone leaves no room beside them); a label that fits nowhere is hidden
      const out2 = Object.values(SIDES).map(t => ({ ...t, dx: t.dx * 2.2, dy: t.dy * 2.2 }));
      const tries = [m.p.side, ...Object.values(SIDES), ...out2].filter(Boolean);
      let won = null;
      // first a place that covers no other dot; failing that, one that covers a dot (the
      // press still goes to the nearest stop, and the list names every stop) but never another label
      for (const clear of [true, false]) {
        for (const t of tries) {
          const left = m.at.x + t.dx + t.ax * m.w, top = m.at.y + t.dy + t.ay * m.h;
          const r = { left, top, right: left + m.w, bottom: top + m.h };
          if (!inside(r, clip) || walls.some(w => hits(r, w)) || placed.some(q => hits(r, q))) continue;
          if (clear && dots.some(o => o.el !== m.p.dot && hits(r, o.r))) continue;
          won = { t, r };
          break;
        }
        if (won) break;
      }
      const el = m.p.label;
      el.hidden = !won;
      if (won) {
        placed.push({ ...won.r, el });
        el.style.setProperty('--dx', String(won.t.dx)); el.style.setProperty('--dy', String(won.t.dy));
        el.style.setProperty('--ax', `${won.t.ax * 100}%`); el.style.setProperty('--ay', `${won.t.ay * 100}%`);
      }
    }
    // tokens: the bigger party first, then by place, so a redraw puts each where it was
    const placedTokens = [];
    const sorted = tokens.map(el => ({ el, r: el.getBoundingClientRect(), n: Number(el.dataset.count) || 1 }))
      .sort((a, b) => b.n - a.n || a.r.top - b.r.top || a.r.left - b.r.left);
    for (const t of sorted) {
      const [tx, ty] = (t.el.dataset.toward ?? '1,0').split(',').map(Number);
      // the leg's direction on the screen, not in the picture's percentages
      const dx = tx / 100 * fr.width, dy = ty / 100 * fr.height, len = Math.hypot(dx, dy) || 1, u = [dx / len, dy / len];
      const dirs = [u, [-u[1], u[0]], [u[1], -u[0]], [-u[0], -u[1]], [1, 0], [0, 1], [-1, 0], [0, -1]];
      const room = r => inside(r, clip) && !walls.some(w => hits(r, w)) && !placedTokens.some(q => hits(r, q));
      // first a spot clear of every label and every token; else one clear of the tokens that only covers labels, which then give way
      let won = null;
      // a crowded picture has no clear spot for the caption's width: the token then goes without its caption (class `bare`), which is
      // narrower by far, before any label is asked to give way
      const attempts = [[true, false], [true, true], [false, true]];
      for (const [strict, bare] of attempts) {
        if (bare && !t.el.classList.contains('bare')) { t.el.classList.add('bare'); t.r = t.el.getBoundingClientRect(); }
        for (let d = 0; d <= 420 && !won; d += d < 48 ? 6 : 12) {
          for (const [ux, uy] of (d === 0 ? [[0, 0]] : dirs)) {
            const r = { left: t.r.left + ux * d, right: t.r.right + ux * d, top: t.r.top + uy * d, bottom: t.r.bottom + uy * d };
            if (room(r) && (!strict || !placed.some(q => !q.el.hidden && hits(r, q)))) { won = { ox: ux * d, oy: uy * d, r }; break; }
          }
        }
        if (won) break;
      }
      if (!won) won = { ox: 0, oy: 0, r: t.r };   // nowhere on the whole picture: it stays, and its neighbours give way below
      if (won.ox || won.oy) { t.el.style.setProperty('--ox', `${Math.round(won.ox)}px`); t.el.style.setProperty('--oy', `${Math.round(won.oy)}px`); }
      for (const q of placed) if (!q.el.hidden && hits(won.r, q)) q.el.hidden = true;   // a label never lies under a token
      placedTokens.push(won.r);
    }
  }

  // ---- a press on the picture goes to the nearest stop within 48 px
  frame.addEventListener('click', e => {
    let best = null, bestD = NEAR + 1;
    for (const d of qsa('.dot', layer)) {
      const r = d.getBoundingClientRect(), dd = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      if (dd < bestD) { best = d; bestD = dd; }
    }
    if (!best) return;
    if (best.dataset.cluster) { setZoom(best.dataset.cluster); focusDetails(); return; }
    select(best.dataset.stop);
    focusDetails();
  });

  /** A press on the picture lands on nothing focusable, and the button that was pressed may have just
      been hidden, so focus would drop to the body (DESIGN 6: it never does). It goes to the stop's
      details: the board's heading where the board is on screen, else the stop list, which holds the selection. */
  function focusDetails() {
    const shown = boardTitle.checkVisibility?.() ?? boardTitle.offsetParent !== null;
    (shown ? boardTitle : list).focus();
  }

  // ---- Tab stays on the map table: past the last control it comes round to the first, and back
  const tabbables = root => qsa('button, [href], [tabindex]', root).filter(n =>
    !n.disabled && !n.hidden && n.tabIndex >= 0 && (n.checkVisibility?.() ?? n.offsetParent !== null));
  el.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || e.defaultPrevented) return;
    const root = pricesBox.classList.contains('open') ? pricesBox : el;
    const stops = tabbables(root);
    if (!stops.length) return;
    const first = stops[0], last = stops[stops.length - 1], here = document.activeElement;
    if (!e.shiftKey && here === last) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && (here === first || here === boardTitle || here === qs('#prices-head', pricesBox))) { e.preventDefault(); last.focus(); }
  });

  // ---- the stop list is a listbox: arrows move, typeahead jumps, Enter selects
  const order = () => stops.slice().sort((a, b) => (a.id === home ? -1 : b.id === home ? 1 : a.name.localeCompare(b.name)));
  function stopStatus(s) {
    if (s.id === home) return 'Your house';
    const f = firstLegState(app, s.id);
    if (!f) return 'No road yet';
    return f.open ? '' : `Closed until ${f.next ?? 'later'}`;
  }
  function drawList() {
    list.replaceChildren(...order().map(s => {
      const st = stopStatus(s);
      return h('div', { class: 'option', role: 'option', id: `stop-${s.id}`, 'aria-selected': s.id === selected ? 'true' : 'false', dataset: { stop: s.id },
        onclick: () => { select(s.id); list.focus(); } },
      h('span', { class: 'name' }, s.name), st ? h('span', { class: 'status' }, st) : null);
    }));
    markLit();
  }
  function markLit() {
    list.setAttribute('aria-activedescendant', `stop-${lit}`);
    for (const o of qsa('[role="option"]', list)) o.classList.toggle('lit', o.dataset.stop === lit);
    const o = qs(`#stop-${lit}`, list);
    if (!o) return;
    const top = o.offsetTop, bottom = top + o.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) {
      // stop on a row boundary, so the first row in view is a whole row and not a blank strip of one
      const need = bottom - list.clientHeight;
      list.scrollTop = [...list.children].find(c => c.offsetTop >= need)?.offsetTop ?? need;
    }
  }
  function listKey(e) {
    const ids = order().map(s => s.id), i = ids.indexOf(lit);
    // MER-124: an arrow selects the stop it lands on, so the heading, the prices and Outfit follow it (a keyboard player had to press Enter
    // on every stop and the heading kept naming the old one); `select` redraws the options, and the list keeps its focus
    const go = j => { e.preventDefault(); lit = ids[(j + ids.length) % ids.length]; select(lit, { keepFocus: true }); list.focus({ preventScroll: true }); markLit(); };   // markLit again: the board redraw can change the list's height
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(ids.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(lit, { keepFocus: true }); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // typeahead: the letters typed within a second jump to the first stop that starts with them
      const t = performance.now();
      typed = t - typedAt > 1000 ? e.key.toLowerCase() : typed + e.key.toLowerCase();
      typedAt = t;
      const hit = order().find(s => s.name.toLowerCase().startsWith(typed));
      if (hit) { e.preventDefault(); select(hit.id, { keepFocus: true }); list.focus({ preventScroll: true }); markLit(); }
    }
  }

  // ---- the price board
  let allPrices = false;       // the full table of the selected stop, one press away from Best known trades
  function drawBoard() {
    const v = app.view(), s = stopOf(content, selected), isHome = selected === home;
    boardTitle.textContent = `Prices in ${s.name}`;
    pricesBtn.textContent = 'Prices and best trades';
    const goods = Object.keys(s.sells ?? {});
    const cell = p => (p?.p == null ? h('span', { class: 'nonews' }, 'no news') : [h('strong', null, dinars(p.p)), h('span', { class: 'when' }, ` ${p.written}, ${p.ageWords}`)]);
    const rows = goods.map(g => {
      const name = (content.goods.find(x => x.id === g)?.name ?? g);
      return h('tr', null,
        h('th', { scope: 'row' }, name),
        h('td', { dataset: { label: s.name }, class: 'here' }, cell(v.prices[selected]?.[g])),
        isHome ? null : h('td', { dataset: { label: homeLabel() }, class: 'there' }, cell(v.prices[home]?.[g])));
    });
    const trades = v.bestTrades ?? [];
    const best = trades.length
      ? h('ol', { class: 'trades', id: 'best-trades' }, trades.map(t => h('li', { class: 'trade', dataset: { stop: t.stop, good: t.good } },
        h('strong', null, t.text), ' ',
        h('span', { class: 'when' }, `${t.road}, about ${t.seasons} ${t.seasons === 1 ? 'season' : 'seasons'}. News ${t.ageWords === 'this season' ? 'from this season' : t.ageWords}; the road is ${t.riskWord}.`))))
      : h('p', { class: 'none', id: 'best-trades', dataset: { why: noTradesWhy(app, v).id } }, noTradesWhy(app, v).text);
    const table = h('table', { class: 'prices', id: 'prices' },
      h('caption', { class: 'visually-hidden' }, `Prices for each good ${s.name} trades, with the season the news was written and how old it is`),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Good'), h('th', { scope: 'col' }, s.name), isHome ? null : h('th', { scope: 'col' }, homeLabel()))),
      h('tbody', null, rows));
    pricesBox.replaceChildren(
      h('h3', { class: 'prices-head', id: 'prices-head', tabindex: '-1' }, 'Best known trades'),
      h('p', { class: 'prices-note', id: 'best-note' }, 'The widest gaps the house has news of, from the prices it last heard.'),
      best,
      h('button', { class: 'button all-prices', type: 'button', id: 'btn-all-prices', 'aria-expanded': allPrices ? 'true' : 'false', 'aria-controls': 'prices-all',
        onclick: () => { allPrices = !allPrices; drawBoard(); qs('#btn-all-prices', pricesBox)?.focus(); } },
      allPrices ? `Hide the prices in ${s.name}` : `Every price in ${s.name}`),
      h('div', { id: 'prices-all', class: 'prices-all', hidden: allPrices ? null : '' }, allPrices ? [
        table,
        h('p', { class: 'prices-note' }, 'A price with no news has not reached the house yet. Letters from far stops arrive late.')] : null),
      h('div', { class: 'panel-actions prices-close' }, h('button', { class: 'button', type: 'button', id: 'prices-close', onclick: () => closePrices() }, 'Close')));
    const o = outfitState(selected);
    outfitBtn.textContent = isHome ? 'Outfit an expedition' : `Outfit an expedition to ${s.name}`;
    outfitBtn.setAttribute('aria-disabled', o.ok ? 'false' : 'true');
    reason.textContent = o.reason;
    reason.hidden = o.ok;
  }
  const homeLabel = () => stopName(content, home);

  /** Phone upright: the price board is a full-screen dialog opened by its button, never a drag. */
  const upright = () => matchMedia('(max-width: 700px) and (min-height: 501px)').matches;
  let pricesOpener = null;
  function openPrices() {
    pricesOpener = pricesBtn;
    pricesBox.classList.add('open');
    pricesBox.setAttribute('role', 'dialog'); pricesBox.setAttribute('aria-modal', 'true'); pricesBox.setAttribute('aria-labelledby', 'prices-head');
    qs('#prices-head', pricesBox).focus();
  }
  function closePrices() {
    pricesBox.classList.remove('open');
    pricesBox.removeAttribute('role'); pricesBox.removeAttribute('aria-modal'); pricesBox.removeAttribute('aria-labelledby');
    pricesOpener?.focus();
  }

  function select(id, { keepFocus = false } = {}) {
    if (!stopOf(content, id)) return;
    selected = id; lit = id;
    if (zoom && clusterOf(id) !== zoom) zoom = clusterOf(id) && clusters().includes(clusterOf(id)) && small() ? clusterOf(id) : null;
    drawMap(); drawList(); drawBoard();
    app.say(`${stopName(content, id)} selected.`);
    if (!keepFocus && !upright()) { /* the press stays where it was; the board is already on screen */ }
  }

  // ---- the page
  function drawBar() {
    const v = app.view();
    date.textContent = `${cap(v.season)} ${v.year}`;
    money.textContent = dinars(v.money);
  }
  function draw() { drawBar(); drawMap(); drawList(); drawBoard(); }

  // The toast takes no taps (css) and goes after TOAST_MS, so on a phone it never stands between a
  // finger and Outfit or Back to the desk (MER-71, finding 10). A screen reader has it from the live region.
  let toastTimer = 0;
  function hideToast() { clearTimeout(toastTimer); toast.hidden = true; }
  function showToast(text) {
    toast.textContent = text; toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, TOAST_MS);
    app.say(text);
  }

  // ---- the outfit sheet, over the map; its hash is #outfit and its draft lives only here
  function showOutfit() {
    if (outfit) return;
    const stopId = pendingStop ?? selected;
    pendingStop = null;
    opener = document.activeElement;
    const view = createOutfit(app, {
      stopId,
      onSent: ({ agent, stop }) => {
        closeOutfit();
        draw();
        showToast(`${agent.name} set out for ${stop.name}. Watch the desk for a letter from the road.`);
      },
      onCancel: () => closeOutfit(),
      onDesk: () => { closeOutfit(false); nav.toDesk(); },
    });
    outfit = { stopId, view };
    document.body.append(view.dialog);
    view.dialog.addEventListener('close', () => { if (outfit?.view === view) { outfit = null; view.destroy(); nav.outfitClosed(); (opener?.isConnected ? opener : outfitBtn)?.focus(); } });
    view.dialog.showModal();
    qs('h2', view.dialog).focus();
  }
  let pendingStop = null;
  function closeOutfit() { if (outfit?.view.dialog.open) outfit.view.dialog.close(); }
  function hideOutfit() {
    if (!outfit) return;
    const o = outfit; outfit = null;
    if (o.view.dialog.open) o.view.dialog.close();
    o.view.destroy();
  }

  // ---- the keyboard (DESIGN 6): Esc steps back out of the map table
  function key(e) {
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return false;
    if (document.querySelector('dialog[open]')) return false;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (pricesBox.classList.contains('open')) closePrices();
      else if (zoom) setZoom(null);
      else nav.toDesk();
      return true;
    }
    return false;
  }

  // ---- load the geography, then draw
  const onResize = () => { if (geo) drawMap(); };
  addEventListener('resize', onResize);
  draw();
  loadGeo().then(g => {
    if (gone) return;
    geo = g;
    for (const s of g.stops) pos[s.id] = { x: s.x / g.w * 100, y: s.y / g.h * 100 };
    for (const s of stops) {
      if (pos[s.id]) continue;
      const p = project(g, s.lat, s.lon);
      pos[s.id] = { x: p.x / g.w * 100, y: p.y / g.h * 100 };
    }
    draw();
    frame.dataset.ready = '1';
    el.dataset.ready = '1';
    // the desk's one-press paper (DESIGN 7) asks for the sheet on the first stop: open it over this map
    const first = app.outfitFor ?? null;
    app.outfitFor = null;
    if (first && stopOf(content, first)) {
      if (first !== selected) select(first, { keepFocus: true });
      const o = outfitState(first);
      if (o.ok) nav.openOutfit(first); else showToast(o.reason);
    }
  });
  // label widths change when the page's own font arrives, and the placement was measured before it
  document.fonts?.ready.then(() => { if (!gone && geo) drawMap(); });

  return {
    el, key, draw,
    hasDraft: () => !!outfit || pendingStop !== null,
    prepareOutfit: stopId => { pendingStop = stopId; },
    showOutfit, hideOutfit,
    focusFirst: () => boardTitle.focus(),
    destroy() { gone = true; clearTimeout(toastTimer); removeEventListener('resize', onResize); hideOutfit(); },
  };
}
