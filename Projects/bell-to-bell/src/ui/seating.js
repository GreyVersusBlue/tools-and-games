import { dom } from './dom.js';

// T4 — the seating chart screen.
//
// A paper chart of RM 214 seen from above, with the whiteboard at the top. You
// drag names onto other names. What it will tell you: where your own furniture
// blinds you, and which row is which. What it will not tell you: anything you
// have not already watched happen in this room.
//
// UI only. It takes a view model in and calls back out (see CLAUDE.md).
//
// T5 — the two occluders (`.planocc`) drag like the desks do, but they must
// not go through a full render() on every pointermove: that would tear down
// the very element under the pointer mid-drag (same trap the desk comment
// above used to warn about). Dragging instead repositions elements in place
// and lets `onMoveOccluder` hand back a fresh view model to patch from.
export function createSeatingScreen({ copy, onSwap, onReset, onMoveOccluder, onConfirm }) {
  let vm = null, meta = null;
  let selected = null, pressed = null, dragOcc = null;
  const cards = new Map(), occEls = new Map();

  const pct = (v, min, span) => ((v - min) / span) * 100;

  function bounds() {
    const b = vm.bounds;
    return { minX: -b.x, spanX: b.x * 2, minZ: b.zFront, spanZ: b.zBack - b.zFront };
  }

  // Inverse of place(): where in world space the pointer actually is.
  function worldFromEvent(e) {
    const box = dom.chartPlan.getBoundingClientRect();
    const { minX, spanX, minZ, spanZ } = bounds();
    return {
      x: minX + ((e.clientX - box.left) / box.width) * spanX,
      z: minZ + ((e.clientY - box.top) / box.height) * spanZ
    };
  }

  // Reposition what moved and restate what it changed, without rebuilding a
  // single DOM node — the desk cards keep their identity and the occluder
  // being dragged keeps its pointer capture.
  function reflow() {
    for (const o of vm.occluders) {
      const el = occEls.get(o.id);
      if (el) place(el, o.x, o.z, o.w, o.d);
    }
    for (const s of vm.seats) {
      const el = cards.get(s.desk);
      if (!el) continue;
      el.className = `deskcard sight-${s.sight} row${s.row}` +
        (selected === s.desk ? ' sel' : '') + (s.steadyKnown ? ' steady' : '');
      el.title = s.sightFromLabels.length
        ? `${s.name} — you can see this desk from ${s.sightFromLabels.join(', ')}`
        : `${s.name} — you cannot see this desk from the front at all`;
    }
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
      if (onMoveOccluder) occEls.set(o.id, el);
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
      el.className = `deskcard sight-${s.sight} row${s.row}` +
        (selected === s.desk ? ' sel' : '') + (s.steadyKnown ? ' steady' : '');
      el.dataset.desk = s.desk;
      el.innerHTML = `<b>${s.name}</b><i></i>`;
      el.title = s.sightFromLabels.length
        ? `${s.name} \u2014 you can see this desk from ${s.sightFromLabels.join(', ')}`
        : `${s.name} \u2014 you cannot see this desk from the front at all`;
      place(el, s.x, s.z, 1.45, 0.95);
      plan.appendChild(el);
      cards.set(s.desk, el);
    }

    drawSide();
  }

  function drawSide() {
    const known = [];
    for (const e of vm.edges) {
      known.push(`<li class="edge">${copy.discovery.edge
        .replace('{a}', vm.seats[e.a].name).replace('{b}', vm.seats[e.b].name)}</li>`);
    }
    for (const s of vm.seats) {
      if (s.steadyKnown) known.push(`<li class="steady">${copy.discovery.steady.replace('{name}', s.name)}</li>`);
    }

    const cost = meta.cost || { moved: 0, rapport: 0 };
    const costLine = cost.moved === 0 ? ''
      : cost.novel ? `<p class="cost ok">${copy.recharted.first}</p>`
      : cost.rapport === 0 ? `<p class="cost ok">${copy.recharted.free}</p>`
      : `<p class="cost">${(cost.moved > 6 ? copy.recharted.many : copy.recharted.some)
            .replace('{cost}', cost.rapport)}</p>`;

    dom.chartSide.innerHTML =
      `<div class="key">
         <div><i class="sw sight-clear"></i><b>${copy.sight.clear.label}</b><span>${copy.sight.clear.line}</span></div>
         <div><i class="sw sight-partial"></i><b>${copy.sight.partial.label}</b><span>${copy.sight.partial.line}</span></div>
         <div><i class="sw sight-blind"></i><b>${copy.sight.blind.label}</b><span>${copy.sight.blind.line}</span></div>
       </div>
       <p class="ln">${copy.legend.rows}</p>
       <p class="ln">${copy.legend.sight}</p>
       <div class="knew">
         <b>What you know</b>
         ${known.length ? `<ul>${known.join('')}</ul>
             <p class="none">${copy.legend.edges}</p>
             <p class="none">${copy.legend.steady}</p>`
                        : `<p class="none">${copy.legend.unknown}</p>`}
       </div>
       ${costLine}`;
  }

  function deskFrom(target) {
    const card = target && target.closest ? target.closest('.deskcard') : null;
    return card ? Number(card.dataset.desk) : null;
  }

  function swap(a, b) {
    if (a == null || b == null || a === b) return;
    onSwap(a, b);
  }

  function occFrom(target) {
    return target && target.closest ? target.closest('.planocc') : null;
  }

  dom.chartPlan.addEventListener('pointerdown', e => {
    const occEl = onMoveOccluder ? occFrom(e.target) : null;
    if (occEl) {
      e.preventDefault();
      const id = occEl.dataset.occ;
      const o = vm.occluders.find(x => x.id === id);
      const at = worldFromEvent(e);
      // Offset from the grab point to the rectangle's own centre, so it
      // doesn't jump to be centred under the pointer the instant you grab it.
      dragOcc = { id, el: occEl, dx: o.x - at.x, dz: o.z - at.z };
      occEl.setPointerCapture(e.pointerId);
      occEl.classList.add('dragging');
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
    if (!dragOcc) return;
    const at = worldFromEvent(e);
    const result = onMoveOccluder(dragOcc.id, at.x + dragOcc.dx, at.z + dragOcc.dz);
    if (result) { vm = result; reflow(); }
  });

  addEventListener('pointerup', e => {
    if (dragOcc) { dragOcc.el.classList.remove('dragging'); dragOcc = null; return; }
    if (pressed == null) return;
    const over = deskFrom(document.elementFromPoint(e.clientX, e.clientY));
    const from = pressed;
    pressed = null;
    if (over != null && over !== from) { setSelected(null); swap(from, over); }
  });

  addEventListener('pointercancel', () => {
    if (dragOcc) { dragOcc.el.classList.remove('dragging'); dragOcc = null; }
    pressed = null;
  });

  dom.chartConfirm.addEventListener('click', () => onConfirm());
  dom.chartReset.addEventListener('click', () => onReset());

  return {
    open(model, info) {
      vm = model; meta = info || {};
      selected = null; pressed = null; dragOcc = null;
      dom.chartTitle.textContent = copy.title;
      dom.chartSub.textContent = copy.sub;
      dom.chartIntro.innerHTML = copy.intro.map(p => `<p>${p}</p>`).join('') +
        `<p class="fineprint">${copy.fineprint}</p>`;
      dom.chartConfirm.textContent = copy.buttons.confirm;
      dom.chartReset.textContent = copy.buttons.reset;
      dom.chartScreen.classList.remove('hide');
      render();
    },
    update(model, info) { vm = model; meta = info || meta; render(); },
    close() { dom.chartScreen.classList.add('hide'); }
  };
}
