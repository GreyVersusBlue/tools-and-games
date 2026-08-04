import { dom } from './dom.js';

// T7 — the post-conference. One exchange, three ways to answer it. This is
// its own screen rather than a reuse of ui/menu.js's #menu on purpose: the
// intervention menu is deliberately skippable with ESC ("the period is still
// running"), but the period is over here, and the day does not continue
// until you've actually said something back to her.
export function showConference(spec, onPick) {
  dom.confTitle.textContent = spec.title;
  dom.confSub.textContent = spec.sub;
  dom.confPrompt.textContent = spec.prompt;
  dom.confOptions.innerHTML = spec.options.map(o =>
    `<button data-k="${o.key}"><b>${o.label}</b><span>${o.blurb}</span></button>`
  ).join('');
  dom.confScreen.classList.remove('hide');
  dom.confOptions.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      dom.confScreen.classList.add('hide');
      onPick(b.dataset.k);
    }, { once: true });
  });
}
