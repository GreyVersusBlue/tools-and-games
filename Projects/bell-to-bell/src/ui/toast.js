import { dom } from './dom.js';

export function toast(kind, title, body) {
  const d = document.createElement('div');
  d.className = 'toast ' + (kind || '');
  d.innerHTML = `<b>${title}</b><p>${body}</p>`;
  dom.log.appendChild(d);
  setTimeout(() => { d.style.transition = 'opacity .4s'; d.style.opacity = '0'; }, 4200);
  setTimeout(() => d.remove(), 4700);
  while (dom.log.children.length > 4) dom.log.firstChild.remove();
}
