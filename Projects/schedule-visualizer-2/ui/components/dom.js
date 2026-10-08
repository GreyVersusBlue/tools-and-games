// Small DOM helpers every component shares. Text always goes in as text:
// a string child becomes a text node, never markup, so a name a user typed
// is shown exactly as typed.

// h('button', { class: 'btn', type: 'button', on: { click } }, 'Label')
// Keys: `class`, `text`, `on` (listeners), `data` (dataset); anything else is
// an attribute. null, undefined and false are skipped; true is an empty
// attribute.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'on') for (const [type, fn] of Object.entries(value)) el.addEventListener(type, fn);
      else if (key === 'data') for (const [name, text] of Object.entries(value)) el.dataset[name] = text;
      else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

let counter = 0;

// An id for wiring a label to a control. Unique in the page.
export function uid(prefix) {
  counter += 1;
  return 'sv2-' + prefix + '-' + counter;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// The things Tab would stop on inside `root`, in order.
export function focusables(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => !el.hidden && el.getClientRects().length > 0);
}

// The nearest page region that can hold a floating thing (a menu, a list):
// inside a dialog it has to be the dialog, or the page behind makes it inert.
export function layerFor(el) {
  return (el && el.closest && el.closest('dialog, header, nav, main, aside')) || document.body;
}
