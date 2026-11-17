// Loads a city's content (ARCHITECTURE 5) by fetch in a browser or by fs in Node.
//   loadContent('testport', { fetch })                      browser: files next to this folder
//   loadContent('testport', { fs })                         Node: fs is node:fs/promises
// Options may add `base`: a URL, or with `fs` a file path (a Windows C:\ path too), to the
// "data" folder. A trailing slash is optional. A file missing from a city reads as empty
// (a list, or an object for calendar and text) so a unit can load a city before every file
// exists; the exception is city.json, which a city cannot do without, so it throws. Over
// fetch only a 404 is "missing"; any other status that is not ok throws. A file that exists
// but does not parse, or holds null or the wrong top-level type, throws and names the file.
// The result is one plain object: the files by name, `cards` and `letters` as flat lists,
// and `sources` from data/sources.json plus the city's own sources.json when it has one.

export const CARD_GROUPS = ['orders', 'disputes', 'loans', 'tolls', 'gifts', 'hiring', 'followups', 'court', 'faith', 'news'];
const LISTS = ['houses', 'goods', 'stops', 'routes', 'agents', 'events', 'notebook', 'terms', 'letters'];
const OBJECTS = ['city', 'calendar', 'text'];

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const kind = v => (v === null ? 'null' : Array.isArray(v) ? 'a list' : typeof v === 'object' ? 'an object' : `a ${typeof v}`);

async function rootOf(base, fs) {
  if (base === undefined) return new URL('../data/', import.meta.url);
  let href;
  if (base instanceof URL) href = base.href;
  else if (typeof base !== 'string') throw new Error('loadContent: base must be a string or a URL');
  else if (fs && !/^[a-z][a-z0-9+.-]*:\/\//i.test(base) && !/^file:/i.test(base)) {
    // a file path: a bare C:\ path would read as URL scheme "c:" (house rule, Windows)
    const { pathToFileURL } = await import('node:url');
    href = pathToFileURL(base).href;
  } else href = new URL(base, import.meta.url).href;
  return new URL(href.endsWith('/') ? href : `${href}/`);
}

export async function loadContent(cityId, { fetch: fetcher, fs, base } = {}) {
  if (!fetcher && !fs) throw new Error('loadContent: pass { fetch } or { fs }');
  const root = await rootOf(base, fs);

  // `want` is 'object' or 'list'; `empty` is what a missing file reads as, or undefined when
  // the file is required.
  async function read(path, want, empty) {
    const url = new URL(path, root);
    let text;
    if (fetcher) {
      const r = await fetcher(url.href);
      if (r.status === 404) text = undefined;
      else if (!r.ok) throw new Error(`${path}: the server answered ${r.status}`);
      else text = await r.text();
    } else {
      try { text = await fs.readFile(url, 'utf8'); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    if (text === undefined) {
      if (empty === undefined) throw new Error(`${path}: this file is required and was not found`);
      return empty;
    }
    let data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error(`${path}: ${e.message}`); }
    if (want === 'object' ? !isObject(data) : !Array.isArray(data)) {
      throw new Error(`${path}: expected ${want === 'object' ? 'an object' : 'a list'}, got ${kind(data)}`);
    }
    return data;
  }

  const dir = `${cityId}/`;
  const content = { cityId };
  content.city = await read(`${dir}city.json`, 'object');
  for (const n of OBJECTS.filter(n => n !== 'city')) content[n] = await read(`${dir}${n}.json`, 'object', {});
  for (const n of LISTS) content[n] = await read(`${dir}${n}.json`, 'list', []);

  content.cards = [];
  for (const g of CARD_GROUPS) {
    for (const c of await read(`${dir}cards/${g}.json`, 'list', [])) {
      if (!isObject(c)) throw new Error(`cards/${g}.json: a card must be an object, got ${kind(c)}`);
      if (c.group !== undefined && c.group !== g) throw new Error(`cards/${g}.json: card "${c.id}" says group "${c.group}"`);
      content.cards.push({ ...c, group: g });
    }
  }

  const sources = [...await read('sources.json', 'list', []), ...await read(`${dir}sources.json`, 'list', [])];
  const seen = new Set();
  for (const s of sources) {
    if (seen.has(s.id)) throw new Error(`sources: "${s.id}" is defined twice`);
    seen.add(s.id);
  }
  content.sources = sources;
  return content;
}
