import { dom } from './dom.js';

// T4 — the seating chart screen.
//
// A paper chart of RM 214 seen from above, with the whiteboard at the top. You
// drag names onto other names. What it will tell you: where your own furniture
// blinds you, and which row is which. What it will not tell you: anything you
// have not already watched happen in this room.
//
// UI only. It takes a view model in and calls back out (see CLAUDE.md).
export function createSeatingScreen({ copy, onSwap, onReset, onConfirm, onMoveOccluder = () => {} }) {
  let vm = null, meta = null;
  // T6 — each period has its own chart copy (room/report flavor text lives in
  // data/seating.json, and a second period gets its own file). setCopy() lets
  // main.js swap it in before opening the screen for a later period.
  let currentCopy = copy;
  let selected = null, pressed = null, occDrag = null;
  const cards = new Map();
  const occEls = new Map();

  const pct = (v, min, span) => ((v - min) / span) * 100;

  function bounds() {
    const b = vm.bounds;
    return { minX: -b.x, spanX: b.x * 2, minZ: b.zFront, spanZ: b.zBack - b.zFront };
  }

  function place(el, x, z, w, d) {
    const { minX, spanX, minZ, spanZ } = bounds();
    el.style.left = pct(x - w / 2, minX, spanX) + '%';
    el.style.top = pct(z - d / 2, minZ, spanZ) + '%';
    el.style.width = (w / spanX) * 100 + '%';
    el.style.height = (d / spanZ) * 100 + '%';
  }

  // Selecting somebody must not rebuild the plan: the node under the player's
  // finger would be replaced mid-press and the drag would come apart.
  function setSelected(d) {
    selected = d;
    for (const [index, el] of cards) el.classList.toggle('sel', index === d);
  }

  function render() {
    const plan = dom.chartPlan;
    plan.innerHTML = '';
    cards.clear();
    occEls.clear();
    const { minX, spanX, minZ, spanZ } = bounds();

    for (const f of vm.furniture) {
      const el = document.createElement('div');
      el.className = 'planfix ' + f.id;
      el.innerHTML = f.label ? `<span>${f.label}</span>` : '';
      place(el, f.x, f.z, f.w, f.d);
      plan.appendChild(el);
    }

    for (const o of vm.occluders) {
      const el = document.createElement('div');
      el.className = 'planocc';
      el.dataset.occ = o.id;
      el.innerHTML = `<span>${o.label}</span>`;
      place(el, o.x, o.z, o.w, o.d);
      plan.appendChild(el);
      occEls.set(o.id, el);
    }

    // Volatility edges, drawn only between pairs you have already watched.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'planedges');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    for (const e of vm.edges) {
      const a = vm.seats[e.a], b = vm.seats[e.b];
      const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ln.setAttribute('x1', pct(a.x, minX, spanX)); ln.setAttribute('y1', pct(a.z, minZ, spanZ));
      ln.setAttribute('x2', pct(b.x, minX, spanX)); ln.setAttribute('y2', pct(b.z, minZ, spanZ));
      ln.setAttribute('class', e.live ? 'live' : 'idle');
      svg.appendChild(ln);
    }
    plan.appendChild(svg);

    for (const s of vm.seats) {
      const el = document.createElement('button');
      el.className = deskClassName(s);
      el.dataset.desk = s.desk;
      el.innerHTML = `<b>${s.name}</b><i></i>`;
      el.title = deskTitle(s);
      place(el, s.x, s.z, 1.45, 0.95);
      plan.appendChild(el);
      cards.set(s.desk, el);
    }

    drawSide();
  }

  function deskClassName(s) {
    return `deskcard sight-${s.sight} row${s.row}` +
      (selected === s.desk ? ' sel' : '') + (s.steadyKnown ? ' steady' : '');
  }

  function deskTitle(s) {
    return s.sightFromLabels.length
      ? `${s.name} \u2014 you can see this desk from ${s.sightFromLabels.join(', ')}`
      : `${s.name} \u2014 you cannot see this desk from the front at all`;
  }

  // T5 \u2014 during an occluder drag, reposition it and re-shade every desk
  // without tearing down the plan (that would drop the pointer capture on the
  // element the player is currently dragging).
  function patch(model) {
    vm = model;
    for (const o of vm.occluders) {
      const el = occEls.get(o.id);
      if (el) place(el, o.x, o.z, o.w, o.d);
    }
    for (const s of vm.seats) {
      const el = cards.get(s.desk);
      if (!el) continue;
      el.className = deskClassName(s);
      el.title = deskTitle(s);
    }
  }

  function drawSide() {
    const known = [];
    for (const e of vm.edges) {
      known.push(`<li class="edge">${currentCopy.discovery.edge
        .replace('{a}', vm.seats[e.a].name).replace('{b}', vm.seats[e.b].name)}</li>`);
    }
    for (const s of vm.seats) {
      if (s.steadyKnown) known.push(`<li class="steady">${currentCopy.discovery.steady.replace('{name}', s.name)}</li>`);
    }

    const cost = meta.cost || { moved: 0, rapport: 0 };
    const costLine = cost.moved === 0 ? ''
      : cost.novel ? `<p class="cost ok">${currentCopy.recharted.first}</p>`
      : cost.rapport === 0 ? `<p class="cost ok">${currentCopy.recharted.free}</p>`
      : `<p class="cost">${(cost.moved > 6 ? currentCopy.recharted.many : currentCopy.recharted.some)
            .replace('{cost}', cost.rapport)}</p>`;

    dom.chartSide.innerHTML =
      `<div class="key">
         <div><i class="sw sight-clear"></i><b>${currentCopy.sight.clear.label}</b><span>${currentCopy.sight.clear.line}</span></div>
         <div><i class="sw sight-partial"></i><b>${currentCopy.sight.partial.label}</b><span>${currentCopy.sight.partial.line}</span></div>
         <div><i class="sw sight-blind"></i><b>${currentCopy.sight.blind.label}</b><span>${currentCopy.sight.blind.line}</span></div>
       </div>
       <p class="ln">${currentCopy.legend.rows}</p>
       <p class="ln">${currentCopy.legend.sight}</p>
       <div class="knew">
         <b>What you know</b>
         ${known.length ? `<ul>${known.join('')}</ul>
             <p class="none">${currentCopy.legend.edges}</p>
             <p class="none">${currentCopy.legend.steady}</p>`
                        : `<p class="none">${currentCopy.legend.unknown}</p>`}
       </div>
       ${costLine}`;
  }

  function deskFrom(target) {
    const card = target && target.closest ? target.closest('.deskcard') : null;
    return card ? Number(card.dataset.desk) : null;
  }

  function occFrom(target) {
    const el = target && target.closest ? target.closest('.planocc') : null;
    return el ? el.dataset.occ : null;
  }

  function swap(a, b) {
    if (a == null || b == null || a === b) return;
    onSwap(a, b);
  }

  dom.chartPlan.addEventListener('pointerdown', e => {
    const occ = occFrom(e.target);
    if (occ != null) {
      e.preventDefault();
      const o = vm.occluders.find(x => x.id === occ);
      if (o) occDrag = { id: occ, startClientX: e.clientX, startClientY: e.clientY, startX: o.x, startZ: o.z };
      return;
    }
    const d = deskFrom(e.target);
    if (d == null) { setSelected(null); return; }
    e.preventDefault();
    if (selected != null && selected !== d) {
      const from = selected;
      setSelected(null); pressed = null;
      swap(from, d);
    } else { setSelected(d); pressed = d; }
  });

  addEventListener('pointermove', e => {
    if (!occDrag) return;
    const rect = dom.chartPlan.getBoundingClientRect();
    const { spanX, spanZ } = bounds();
    const dx = (e.clientX - occDrag.startClientX) / rect.width * spanX;
    const dz = (e.clientY - occDrag.startClientY) / rect.height * spanZ;
    onMoveOccluder(occDrag.id, occDrag.startX + dx, occDrag.startZ + dz);
  });

  addEventListener('pointerup', e => {
    if (occDrag) { occDrag = null; return; }
    if (pressed == null) return;
    const over = deskFrom(document.elementFromPoint(e.clientX, e.clientY));
    const from = pressed;
    pressed = null;
    if (over != null && over !== from) { setSelected(null); swap(from, over); }
  });

  dom.chartConfirm.addEventListener('click', () => onConfirm());
  dom.chartReset.addEventListener('click', () => onReset());

  return {
    open(model, info) {
      vm = model; meta = info || {};
      selected = null; pressed = null;
      dom.chartTitle.textContent = currentCopy.title;
      dom.chartSub.textContent = currentCopy.sub;
      dom.chartIntro.innerHTML = currentCopy.intro.map(p => `<p>${p}</p>`).join('') +
        `<p class="fineprint">${currentCopy.fineprint}</p>`;
      dom.chartConfirm.textContent = currentCopy.buttons.confirm;
      dom.chartReset.textContent = currentCopy.buttons.reset;
      dom.chartScreen.classList.remove('hide');
      render();
    },
    update(model, info) { vm = model; meta = info || meta; render(); },
    patch,
    setCopy(next) { currentCopy = next; },
    close() { dom.chartScreen.classList.add('hide'); }
  };
}
