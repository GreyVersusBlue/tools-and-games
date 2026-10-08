// The stylesheet of the building inspector and of what goes with it (the
// connect banner, the search results). index.html links it, with the page's
// other sheets, so nothing is drawn unstyled; a page that does not (a test
// page built by hand) gets the link from the first module that needs it.

let link = null;

export function inspectorSheet() {
  if (link) return link;
  link = document.querySelector('link[data-sheet="building-inspector"]');
  if (link) return link;
  link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./inspector.css', import.meta.url).href;
  link.dataset.sheet = 'building-inspector';
  document.head.append(link);
  return link;
}
