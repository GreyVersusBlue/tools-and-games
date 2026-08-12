import * as THREE from 'three';
import { createSaveSlot } from '../../../assets/js/gvb-save.js';
import { SPECIES, PLACES, SHELL_NAMES_BY_KIND, isJournalShape, normalizeJournal, record } from './journal-core.js';

// The field journal: the one thing a reload survives. Species sight themselves
// after a couple of seconds of honest attention — the creature near the centre
// of your view, you actually watching — shells record when examined, places
// when first reached. The sun's position is pointedly NOT in here: a returning
// visitor gets the strong opening frame every time, same as always. That was
// the whole reason this project refused a save for so long, and it is the part
// of that refusal worth keeping.

const FOCUS_SECONDS = 1.6;
const FOCUS_DOT = 0.88;

export function buildJournal(controls) {
  const slot = createSaveSlot({
    game: 'golden-hour',
    version: 1,
    validate: isJournalShape,
    repair: normalizeJournal,
    defaults: { species: [], shells: [], places: [] },
  });
  const state = slot.load() ?? slot.fresh();
  const auto = slot.autosave(() => state);

  // ---------- Toasts ----------
  const toastEl = document.getElementById('journal-toast');
  const queue = [];
  let toastT = 0;
  function toast(text) {
    queue.push(text);
  }

  // ---------- Sighting ----------
  const timers = Object.create(null);
  const fwd = new THREE.Vector3(), to = new THREE.Vector3();
  const byId = Object.fromEntries(SPECIES.map(s => [s.id, s]));

  function observe(id) {
    const sp = byId[id];
    if (!sp || !record(state.species, id)) return;
    auto.mark();
    toast(`Noted: ${sp.name}`);
    render();
  }

  // ---------- The notebook ----------
  const panel = document.getElementById('journal');
  const btn = document.getElementById('journal-btn');
  let open = false;

  function setOpen(v) {
    open = v;
    panel.classList.toggle('show', open);
    controls.frozen = open;
    if (open) render();
  }
  btn.addEventListener('click', e => { e.stopPropagation(); setOpen(!open); });
  panel.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('keydown', e => {
    if (e.code === 'KeyJ') setOpen(!open);
    else if (e.code === 'Escape' && open) setOpen(false);
  });

  function line(found, name, hint) {
    return found
      ? `<li class="got">${name}</li>`
      : `<li class="not"><span>${hint}</span></li>`;
  }

  function render() {
    const kinds = { creature: 'Creatures', passage: 'Passages', sky: 'The sky' };
    let html = '<h2>Field Journal</h2>';
    for (const [kind, title] of Object.entries(kinds)) {
      const rows = SPECIES.filter(s => s.kind === kind);
      html += `<h3>${title}</h3><ul>` +
        rows.map(s => line(state.species.includes(s.id), s.name, s.hint)).join('') + '</ul>';
    }
    html += '<h3>Beachcombing</h3><ul>';
    for (const names of Object.values(SHELL_NAMES_BY_KIND)) {
      for (const n of names) {
        html += line(state.shells.includes(n), n, '— something still in the sand —');
      }
    }
    html += '</ul>';
    const knownPlaces = PLACES.filter(p => state.places.includes(p.id));
    if (knownPlaces.length) {
      html += '<h3>Places</h3><ul>' +
        knownPlaces.map(p => `<li class="got">${p.name}</li>`).join('') + '</ul>';
    }
    html += `<div class="journal-foot">
      <span id="journal-export">copy the journal out</span> ·
      <span id="journal-import">read one back in</span>
    </div>`;
    panel.innerHTML = html;
    panel.querySelector('#journal-export').addEventListener('click', () => slot.exportToFile(state));
    panel.querySelector('#journal-import').addEventListener('click', () => {
      slot.promptImport().then(s => {
        Object.assign(state, normalizeJournal(s));
        slot.save(state);
        render();
      }, () => {});
    });
  }

  return {
    state,

    // Per-frame attention check for a visible creature. Cheap: one dot per
    // caller per frame, and the timer map is tiny.
    focus(id, pos, dt, camera) {
      if (state.species.includes(id)) return;
      camera.getWorldDirection(fwd);
      to.copy(pos).sub(camera.position).normalize();
      if (fwd.dot(to) > FOCUS_DOT) {
        timers[id] = (timers[id] || 0) + dt;
        if (timers[id] >= FOCUS_SECONDS) observe(id);
      } else {
        timers[id] = Math.max(0, (timers[id] || 0) - dt * 2);
      }
    },

    // For things too brief to watch for long (a shooting star): one clean look
    // is enough.
    glimpse(id, pos, camera) {
      if (state.species.includes(id)) return;
      camera.getWorldDirection(fwd);
      to.copy(pos).sub(camera.position).normalize();
      if (fwd.dot(to) > 0.75) observe(id);
    },

    foundShell(name) {
      if (!record(state.shells, name)) return;
      auto.mark();
      toast(`Kept in mind: ${name}`);
      render();
    },

    visitPlace(id) {
      const p = PLACES.find(p => p.id === id);
      if (!p || !record(state.places, id)) return;
      auto.mark();
      toast(`Reached: ${p.name}`);
      render();
    },

    update(dt) {
      if (queue.length && toastT <= 0) {
        toastEl.textContent = queue.shift();
        toastEl.classList.add('show');
        toastT = 3.4;
      }
      if (toastT > 0) {
        toastT -= dt;
        if (toastT <= 0) toastEl.classList.remove('show');
      }
    },
  };
}
