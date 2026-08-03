import { dom } from './dom.js';

export function openMenu(spec, onPick) {
  dom.menu.innerHTML =
    `<div class="mh"><b>${spec.header}</b><p>${spec.body}</p></div>` +
    spec.items.map(o =>
      `<button data-k="${o.key}"${o.enabled ? '' : ' disabled'}>` +
      `<b>${o.label}</b><span>${o.blurb}</span></button>`).join('') +
    `<div class="esc">ESC to close \u2014 the period is still running</div>`;
  dom.menu.classList.add('on');
  dom.menu.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => onPick(b.dataset.k));
  });
}

export function closeMenu() {
  dom.menu.classList.remove('on');
}
