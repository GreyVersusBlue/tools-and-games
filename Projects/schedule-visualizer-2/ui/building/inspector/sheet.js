// The stylesheet of the building inspector and of what goes with it (the
// connect banner, the search results). index.html does not link it, so the
// first module that needs it puts the link in the page, once.

let link = null;

export function inspectorSheet() {
  if (link) return link;
  link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./inspector.css', import.meta.url).href;
  link.dataset.sheet = 'building-inspector';
  document.head.append(link);
  return link;
}
