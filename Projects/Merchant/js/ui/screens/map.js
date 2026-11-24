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
const REACH_FAR = 60;            // MER-137: the last resort before a label lies over a caption: still on its own side of its own dot
const MAX_AWAY = 36;             // MER-137: px from a dot's centre to the nearest edge of its label; further and the label reads as another stop's
const GAP = 3;                   // px kept clear around a label, so two never touch
const hits = (a, b) => a.left < b.right + GAP && b.left < a.right + GAP && a.top < b.bottom + GAP && b.top < a.bottom + GAP;
const away = (r, c) => Math.hypot(Math.max(r.left - c.x, 0, c.x - r.right), Math.max(r.top - c.y, 0, c.y - r.bottom));
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
  let pressing = false;            // a pointer is down on the stop list
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
    onkeydown: e => listKey(e),
    // MER-131: a press focuses the list, and the focus handler used to scroll the lit row to the top, which moved the row from under the
    // pointer before the click landed (a low row took two presses). A pointer focus leaves the scroll alone; a key's focus still scrolls.
    onpointerdown: () => { pressing = true; setTimeout(() => { pressing = false; }, 500); },
    onfocus: () => { lit = selected; markLit(!pressing); } });
  const pricesBtn = h('button', { class: 'button prices-open', type: 'button', id: 'btn-prices', 'aria-haspopup': 'dialog', onclick: () => openPrices() });
  const pricesBox = h('div', { class: 'prices-box', id: 'prices-box' });
  const reason = h('p', { class: 'reason', id: 'outfit-open-reason' });
  const outfitBtn = h('button', { class: 'button primary', type: 'button', id: 'btn-outfit', 'aria-describedby': 'outfit-open-reason', onclick: () => pressOutfit() });
  const board = h('aside', { class: 'board', id: 'board', 'aria-label': 'Prices and stops' },
    h('div', { class: 'board-body', id: 'board-body' }, boardTitle, list, pricesBtn, pricesBox, toast),
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
      line.dataset.from = l.from; line.dataset.to = l.to;
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      return line;
    });
    roads.replaceChildren(...svg);

    const out = [];
    // the stops a party stands on: their labels choose a place before the rest do, so a trip never costs a stop its name (MER-137)
    const occupied = new Set(app.state.expeditions.map(x => {
      const leg = content.routes.find(r => r.id === x.route)?.legs[x.leg];
      return leg && (x.status !== 'out' || x.left >= leg.seasons) ? leg.from : null;
    }).filter(Boolean));
    const grp = grouped() ? clusters() : [];
    const drawn = new Set();
    const pairs = [];              // each dot with its label, for placeLabels
    for (const s of stops) {
      if (grp.includes(s.cluster)) {
        if (drawn.has(s.cluster)) continue;
        drawn.add(s.cluster);
        const ms = members(s.cluster), x = ms.reduce((n, m) => n + pos[m.id].x, 0) / ms.length, y = ms.reduce((n, m) => n + pos[m.id].y, 0) / ms.length;
        // MER-137: the group that holds the house says so in its label, since the house's own label is not drawn inside it (c006b: Cairo had none)
        const named = ms.some(m => m.id === home) ? `${stopName(content, home)}, ${clusterName(s.cluster)}` : clusterName(s.cluster);
        const dot = h('span', { class: 'dot cluster', role: 'img', 'aria-label': `${named}, ${ms.length} stops`, style: `left:${x}%;top:${y}%`, dataset: { cluster: s.cluster } });
        const label = h('span', { class: 'stop-label cluster-label', 'aria-hidden': 'true', style: `left:${x}%;top:${y}%`, dataset: { cluster: s.cluster, ...(ms.some(m => m.id === home) ? { keep: '1' } : {}) } }, `${named}: ${ms.length} stops`);
        out.push(dot, label); pairs.push({ dot, label, side: null, rank: ms.some(m => m.id === home) ? 0 : 1 });
        continue;
      }
      // The dot names the stop to a screen reader even when its label is hidden for want of room
      const p = pos[s.id], lab = s.label ?? { dx: 12, dy: 0, anchor: 'start' };
      const dot = h('span', { class: `dot${s.id === home ? ' home' : ''}${s.id === selected ? ' on' : ''}`, role: 'img', 'aria-label': s.name, tabindex: '-1', style: `left:${p.x}%;top:${p.y}%`, dataset: { stop: s.id } });
      const label = h('span', { class: `stop-label${s.id === home ? ' home' : ''}${s.id === selected ? ' on' : ''}`, 'aria-hidden': 'true', style: `left:${p.x}%;top:${p.y}%`, dataset: { stop: s.id, ...(s.id === home ? { keep: '1' } : {}) } }, s.name);
      out.push(dot, label);
      pairs.push({ dot, label, side: { dx: lab.dx, dy: lab.dy, ax: ANCHOR_AX[lab.anchor] ?? 0, ay: -0.5 }, rank: s.id === home ? 0 : s.id === selected || occupied.has(s.id) ? 1 : 2 });
    }
    // expeditions as tokens (MER-137). A token's place is the trip's own: the stop it stands on, or the fraction of its leg done, and nothing
    // the player has open (a selected stop, a free agent, a label) moves it. Parties that stand on one stop, whatever road each is about to
    // take, are one token with a count; so are parties at one place on one leg.
    const groups = new Map();
    for (const x of app.state.expeditions) {
      const route = content.routes.find(r => r.id === x.route);
      const leg = route?.legs[x.leg];
      if (!leg || !pos[leg.from] || !pos[leg.to]) continue;
      const total = leg.seasons, done = x.status === 'out' ? Math.max(0, Math.min(1, 1 - x.left / total)) : 0;
      const frac = Math.round(done * 20) / 20;
      const key = frac === 0 ? `@${leg.from}` : `${leg.from}>${leg.to}@${frac}`;
      if (!groups.has(key)) groups.set(key, { leg, frac, list: [] });
      groups.get(key).list.push(x);
    }
    for (const g of groups.values()) {
      const a = pos[g.leg.from], b = pos[g.leg.to];
      const x = a.x + (b.x - a.x) * g.frac, y = a.y + (b.y - a.y) * g.frac;
      const first = g.list[0], agent = content.agents.find(ag => ag.id === first.agent), n = g.list.length;
      const tok = app.art.get(`token-${g.leg.by}`) ?? app.art.get('token-caravan');
      // a caption names each agent and the season that agent is due home (MER-131); a stack lists them, one line each (MER-137)
      const who = e => `${content.agents.find(ag => ag.id === e.agent)?.name ?? 'An agent'}, home about ${homeBy(app, [e])}`;
      const seal = e => { const ag = content.agents.find(q => q.id === e.agent), art = ag && app.art.get(ag.seal); return art ? h('img', { class: 'token-seal', src: `assets/art/${art.file}`, alt: '', width: 20, height: 20 }) : null; };
      const spoken = n === 1 ? who(first) : `${n} expeditions: ${g.list.map(who).join('; ')}`;
      const caption = n === 1
        ? h('p', { class: 'token-label', 'aria-hidden': 'true' }, seal(first), who(first))
        : h('p', { class: 'token-label token-stack', 'aria-hidden': 'true' }, h('span', { class: 'token-head' }, `${n} expeditions`),
          ...g.list.map(e => h('span', { class: 'token-line' }, seal(e), who(e))));
      out.push(h('div', { class: 'token', role: 'img', 'aria-label': spoken, style: `left:${x}%;top:${y}%`, dataset: { expedition: g.list.map(e => e.id).join(' '), count: String(n), from: g.leg.from, to: g.leg.to, ...(g.frac === 0 ? { start: '1' } : {}) } },
        h('div', { class: 'token-piece' }, h('img', { src: `assets/art/${tok.file}`, alt: '', width: 64, height: 64 }), n > 1 ? h('span', { class: 'token-count' }, String(n)) : null),
        caption));
    }
    layer.replaceChildren(...out);
    placeLabels(pairs);
  }

  /** Put each caption beside its token and each label beside its dot, so that every name shows (DESIGN 4.7, MER-137).
      A token never moves for a label: its place is the trip's own, a stop or a fraction of a leg (drawMap). So the tokens' pieces are the
      fixed furniture, and the rest is placed round them in this order, each step the same for the same state whatever is selected or free:
      1. each label takes a side of its dot where it overlaps no other label, no dot and no token piece; failing that one that covers a dot,
         then one that covers a piece (a label is drawn above tokens, so the name still reads), never another label. Cairo's label, the
         selected stop's and those of the stops a party stands on choose first. A label that fits nowhere on a crowded phone is hidden and
         its dot keeps the name; no label is hidden for a token (play A, a008 a015 a031: Damascus, Aleppo, Famagusta, Qus, Quseir and
         Alexandria lost theirs under a trip).
      2. each token's caption takes the first of twelve places round its piece that covers no dot, label, piece or caption; failing that
         one that covers no piece or caption; failing that the first that fits the picture. A caption is never dropped where a frame shows
         captions at all (a phone's css hides them; its token still has the name as its accessible name).
      A label too far from its dot to be read as its own (c034) is not used: past MAX_AWAY px of its dot it is hidden instead. */
  function placeLabels(pairs) {
    const fr = frame.getBoundingClientRect();
    if (!fr.width || !fr.height) return;
    const clip = { left: fr.left, right: fr.right, top: fr.top, bottom: fr.bottom };
    const walls = [board, unzoom].filter(b => b && !b.hidden).map(b => b.getBoundingClientRect()).filter(r => r.width && r.height);
    const centre = d => { const r = d.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const tokens = qsa('.token', layer);
    const k = Number(layer.style.getPropertyValue('--k')) || 1;
    // A party that has not left its stop stands beside the stop's dot, on its road, not on it: one piece's half-width and a gap out, and never
    // past the middle of the road. The offset is a function of the road and the frame alone, so it is the same whatever is selected or free.
    for (const t of tokens) {
      t.style.removeProperty('--ox'); t.style.removeProperty('--oy');
      const a = pos[t.dataset.from], b = pos[t.dataset.to];
      if (!t.dataset.start || !a || !b) continue;
      const dx = (b.x - a.x) / 100 * frame.clientWidth * k, dy = (b.y - a.y) / 100 * frame.clientHeight * k, len = Math.hypot(dx, dy) || 1;
      const d = Math.min(qs('.token-piece', t).offsetWidth / 2 + 6, len * 0.35);
      t.style.setProperty('--ox', `${Math.round(dx / len * d * k)}px`); t.style.setProperty('--oy', `${Math.round(dy / len * d * k)}px`);
    }
    for (const t of tokens) {   // measured from the caption's own css place, below its piece
      delete t.dataset.side;
      const c = qs('.token-label', t); c.style.removeProperty('left'); c.style.removeProperty('top'); c.style.removeProperty('transform');
    }
    const dots = qsa('.dot', layer).map(n => ({ el: n, r: n.getBoundingClientRect() }));
    // ---- 1. captions
    const taken = [];            // every token piece and the caption chosen for it
    const pieces = tokens.map(t => qs('.token-piece', t).getBoundingClientRect());
    // a piece's obstacle includes the count badge, which hangs off its top right corner
    for (const r of pieces) taken.push({ left: r.left, right: r.right + 8, top: r.top - 8, bottom: r.bottom, piece: true });
    const placeCaptions = () => tokens.forEach((t, i) => {
      const cap = qs('.token-label', t);
      if (!cap.offsetWidth) return;                      // this frame shows no captions
      const pr = pieces[i], cr = cap.getBoundingClientRect(), w = cr.width, hgt = cr.height, cx = pr.left + pr.width / 2, cy = pr.top + pr.height / 2;
      // twelve places round the piece: four centred on a side, then each side with the caption flush to either end of the piece's edge; the
      // same twelve again 22 px and 44 px further out where the near ones are taken (a crowd of stops round Qus leaves none close in)
      const sides = {};
      for (const g of [0, 22, 44, 80, 120]) {
        const at = (name, left, top) => { sides[g ? `${name}+${g}` : name] = { left, top }; };
        at('below', cx - w / 2, pr.bottom + g); at('above', cx - w / 2, pr.top - hgt - g);
        at('right', pr.right + g, cy - hgt / 2); at('left', pr.left - w - g, cy - hgt / 2);
        at('below-start', pr.left, pr.bottom + g); at('below-end', pr.right - w, pr.bottom + g);
        at('above-start', pr.left, pr.top - hgt - g); at('above-end', pr.right - w, pr.top - hgt - g);
        at('right-top', pr.right + g, pr.top); at('right-bottom', pr.right + g, pr.bottom - hgt);
        at('left-top', pr.left - w - g, pr.top); at('left-bottom', pr.left - w - g, pr.bottom - hgt);
      }
      const box = s => ({ left: s.left, right: s.left + w, top: s.top, bottom: s.top + hgt });
      const others = taken.filter(q => q.piece ? q.left !== pr.left || q.top !== pr.top - 8 : true);
      let won = null;
      const fits = r => inside(r, clip) && !walls.some(q => hits(r, q));
      for (const [name, s] of Object.entries(sides)) {
        const r = box(s);
        if (!fits(r) || others.some(q => hits(r, q)) || dots.some(d => hits(r, d.r))) continue;
        won = { name, r }; break;
      }
      // nowhere clear: the place that covers least (a piece counts three times, a dot a fixed amount), inside the picture if any is, and never
      // just the first
      if (!won) {
        const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        let best = Infinity;
        for (const [name, s] of Object.entries(sides)) {
          const r = box(s);
          const cost = others.reduce((n, q) => n + area(r, q) * (q.piece ? 3 : 1), 0) + dots.filter(d => hits(r, d.r)).length * 2500 + (fits(r) ? 0 : 1e7);
          if (cost < best) { best = cost; won = { name, r }; }
        }
      }
      t.dataset.side = won.name;
      // the token is drawn at 1/k of the layer's scale, so a screen distance is k times as many of its own px
      cap.style.left = `${(won.r.left - cx) * k}px`; cap.style.top = `${(won.r.top - cy) * k}px`; cap.style.transform = 'none';
      taken.push({ ...won.r, piece: false });
    });
    // ---- 2. labels, then captions. The house's, the selected stop's and the stops a party stands on choose first; a caption has a dozen
    // places round its piece and a label of a crowded stop has few, so the captions choose last, among what the labels leave.
    for (const p of pairs) p.label.hidden = false;   // a redraw must measure every label whole, not the 0 by 0 of one a pass hid
    const marks = pairs.map(p => ({ p, at: centre(p.dot), w: p.label.offsetWidth, h: p.label.offsetHeight })).sort((a, b) => a.p.rank - b.p.rank);
    const placed = [];
    const placeLabel = m => {
      // its own side, then every side close in, then every side one step further out (a crowd of dots on a phone leaves no room beside them)
      const out2 = Object.values(SIDES).map(t => ({ ...t, dx: t.dx * 1.7, dy: t.dy * 1.7 })), out3 = Object.values(SIDES).map(t => ({ ...t, dx: t.dx * 3.4, dy: t.dy * 3.4 }));
      const tries = [m.p.side, ...Object.values(SIDES), ...out2, ...out3].filter(Boolean);
      let won = null;
      // a label over the edge of a token's piece still reads, a label over a caption does not, so the last tier alone covers one
      // the fifth tier looks one ring further out (up to REACH_FAR px from the dot) before any label may lie over a caption
      for (const [clear, free, capsOk, far] of [[true, true], [false, true], [true, false, false], [false, false, false], [false, true, false, true], [false, false, true]]) {
        for (const t of tries) {
          const left = m.at.x + t.dx + t.ax * m.w, top = m.at.y + t.dy + t.ay * m.h;
          const r = { left, top, right: left + m.w, bottom: top + m.h };
          if (!inside(r, clip) || walls.some(w => hits(r, w)) || placed.some(q => hits(r, q))) continue;
          if (away(r, m.at) > (far ? REACH_FAR : MAX_AWAY)) continue;
          if (clear && dots.some(o => o.el !== m.p.dot && hits(r, o.r))) continue;
          if (free ? taken.some(q => hits(r, q)) : !capsOk && taken.some(q => !q.piece && hits(r, q))) continue;
          won = { t, r };
          break;
        }
        if (won) break;
      }
      const el = m.p.label;
      el.hidden = !won;
      if (won) {
        placed.push({ ...won.r, el });
        taken.push({ ...won.r, piece: false });
        el.style.setProperty('--dx', String(won.t.dx)); el.style.setProperty('--dy', String(won.t.dy));
        el.style.setProperty('--ax', `${won.t.ax * 100}%`); el.style.setProperty('--ay', `${won.t.ay * 100}%`);
      }
    };
    for (const m of marks) placeLabel(m);
    placeCaptions();
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
        onclick: () => { select(s.id); list.focus({ preventScroll: true }); } },
      h('span', { class: 'name' }, s.name), st ? h('span', { class: 'status' }, st) : null);
    }));
    markLit();
  }
  function markLit(scroll = true) {
    list.setAttribute('aria-activedescendant', `stop-${lit}`);
    for (const o of qsa('[role="option"]', list)) o.classList.toggle('lit', o.dataset.stop === lit);
    const o = qs(`#stop-${lit}`, list);
    if (!o || !scroll) return;
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
  // the stops are placed and the map marked ready only once the page's own fonts are in: labels measured on the fallback font were placed
  // again when the font arrived and moved a token 6 px after the map said it was ready (CI, PR #617)
  Promise.all([loadGeo(), document.fonts?.ready]).then(([g]) => {
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
