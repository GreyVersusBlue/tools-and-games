import { dom } from './dom.js';

// T7 — the post-conference. Phase 4: a tree, not one exchange.
//
// This is its own screen rather than a reuse of ui/menu.js's #menu on purpose:
// the intervention menu is deliberately skippable with ESC ("the period is
// still running"), but the period is over here, and the day does not continue
// until you have actually said something back to her.
//
// The loop is the whole change. `open(nodeId)` renders one node; picking an
// option calls back out to whoever owns the effects, and whatever that hands
// back decides whether there is another exchange or the screen closes. This
// file knows nothing about effects, follow-ups or Fidelity — it renders three
// buttons and reports which one was pressed (CLAUDE.md: ui/ never imports
// from systems/).
export function showConference(spec, { firstNode, onPick, onDone }) {
  dom.confTitle.textContent = spec.title;
  dom.confSub.textContent = spec.sub;
  dom.confScreen.classList.remove('hide');

  let step = 0;
  render(spec.root, firstNode);

  function render(nodeId, node) {
    step++;
    dom.confPrompt.textContent = node.prompt;
    dom.confOptions.innerHTML = node.options.map(o =>
      `<button data-k="${o.key}"><b>${o.label}</b><span>${o.blurb}</span></button>`
    ).join('');
    for (const b of dom.confOptions.querySelectorAll('button')) {
      b.addEventListener('click', () => {
        const next = onPick(nodeId, b.dataset.k);
        if (next && next.next) { render(next.nextId, next.next); return; }
        dom.confScreen.classList.add('hide');
        onDone();
      }, { once: true });
    }
    // Two or three exchanges is a conference; a fourth is a hearing. The
    // counter is here so a data file that loops a `then` back on itself
    // cannot trap the player on this screen.
    if (step > 6) {
      dom.confScreen.classList.add('hide');
      onDone();
    }
  }
}
