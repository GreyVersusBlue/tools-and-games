// Loads a city's content (ARCHITECTURE 5) by fetch in a browser or by fs in Node.
//   loadContent('testport', { fetch })                      browser: files next to this folder
//   loadContent('testport', { fs })                         Node: fs is node:fs/promises
// Options may add `base`, a URL (or string) that ends in "/data/". A file that is missing
// reads as empty (a list, or an object for city, calendar and text), so a unit can load a
// city before every file exists. A file that exists but does not parse throws.
// The result is one plain object: the files by name, `cards` and `letters` as flat lists,
// and `sources` from data/sources.json plus the city's own sources.json when it has one.

export const CARD_GROUPS = ['orders', 'disputes', 'loans', 'tolls', 'gifts', 'hiring', 'followups', 'court', 'faith', 'news'];
const LISTS = ['houses', 'goods', 'stops', 'routes', 'agents', 'events', 'notebook', 'terms', 'letters'];
const OBJECTS = ['city', 'calendar', 'text'];

export async function loadContent(cityId, { fetch: fetcher, fs, base } = {}) {
  if (!fetcher && !fs) throw new Error('loadContent: pass { fetch } or { fs }');
  const root = new URL(base ?? '../data/', import.meta.url);

  async function read(path, empty) {
    const url = new URL(path, root);
    let text;
    if (fetcher) {
      const r = await fetcher(url.href);
      if (!r.ok) return empty;
      text = await r.text();
    } else {
      try { text = await fs.readFile(url, 'utf8'); }
      catch (e) { if (e.code === 'ENOENT') return empty; throw e; }
    }
    try { return JSON.parse(text); }
    catch (e) { throw new Error(`${path}: ${e.message}`); }
  }

  const dir = `${cityId}/`;
  const content = { cityId };
  for (const n of OBJECTS) content[n] = await read(`${dir}${n}.json`, {});
  for (const n of LISTS) content[n] = await read(`${dir}${n}.json`, []);

  content.cards = [];
  for (const g of CARD_GROUPS) {
    for (const c of await read(`${dir}cards/${g}.json`, [])) {
      if (c.group !== undefined && c.group !== g) throw new Error(`cards/${g}.json: card "${c.id}" says group "${c.group}"`);
      content.cards.push({ ...c, group: g });
    }
  }

  const sources = [...await read('sources.json', []), ...await read(`${dir}sources.json`, [])];
  const seen = new Set();
  for (const s of sources) {
    if (seen.has(s.id)) throw new Error(`sources: "${s.id}" is defined twice`);
    seen.add(s.id);
  }
  content.sources = sources;
  return content;
}
