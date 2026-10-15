// patch.js — writes markup into a live element without rebuilding what is
// already there, so a control the keyboard is on stays the same element.
// The Menu Board (chalkboard.js), the queue and the stations row (ui.js) use
// it (#968, #969). It imports nothing.

// The board is patched in place, never rewritten (#968). Until then the whole
// of #chalkContent was one innerHTML on every redraw, which is every sale, so
// a player who had tabbed to a button was thrown off it within seconds and the
// next Tab started over from the top of the page. Now a button that does the
// same thing as before is the same element, and only the text and attributes
// that changed are written, the way chalkboard.js keeps its pace buttons.
//
// Rows are matched by their data-row key, so a row that appears or goes (an
// event, a barista hired) moves no other row onto a neighbour's element.
// Inside a row, nodes are matched by position: the same tag, and for a button
// the same data-* attributes, which is the purchase it makes. A button whose
// purchase changed (bought, so now a tick) is a new element, and the keyboard
// on it is lost with it; nothing else is.
export function patchRows(el, html){
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const wanted = [...tpl.content.children];
  const keys = new Set(wanted.map(n => n.dataset.row));
  for(const old of [...el.children]) if(!keys.has(old.dataset.row)) old.remove();
  let at = el.firstElementChild;
  for(const n of wanted){
    if(at && at.dataset.row === n.dataset.row){ morph(at, n); at = at.nextElementSibling; continue; }
    // Out of order (rows never are today): the old one goes and a new one is
    // put in its place, rather than two rows with one key.
    for(const dup of el.children) if(dup !== at && dup.dataset.row === n.dataset.row){ dup.remove(); break; }
    el.insertBefore(n, at);
  }
}

const job = node => node.tagName === 'BUTTON'
  ? [...node.attributes].filter(a => a.name.startsWith('data-')).map(a => `${a.name}=${a.value}`).join(' ')
  : '';
const sameNode = (a, b) => a.nodeType === b.nodeType && (a.nodeType !== 1 || (a.tagName === b.tagName && job(a) === job(b)));

function morph(old, next){
  for(const a of [...old.attributes]) if(!next.hasAttribute(a.name)) old.removeAttribute(a.name);
  for(const a of [...next.attributes]) if(old.getAttribute(a.name) !== a.value) old.setAttribute(a.name, a.value);
  const was = [...old.childNodes], now = [...next.childNodes];
  now.forEach((n, i) => {
    const o = was[i];
    if(!o) old.appendChild(n);
    else if(!sameNode(o, n)) old.replaceChild(n, o);
    else if(n.nodeType === 1) morph(o, n);
    else if(o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue;
  });
  for(let i = now.length; i < was.length; i++) was[i].remove();
}
