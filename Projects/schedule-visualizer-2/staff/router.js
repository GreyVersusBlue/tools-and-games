// Addresses. Every view has one, after the # so it works from a file on disk
// as well as on a web address:
//
//   #/teacher/t…   #/group/g…   #/room/r…   #/map/f…   #/free   #/now
//   #/common?t=…,…   #/coverage/t…   #/sub/t…   #/directions?from=…&to=…
//   #/staffing   #/me   #/search?q=…
//
// No DOM here: the two functions turn an address into its parts and back.

function decode(text) {
  try {
    return decodeURIComponent(text);
  } catch (error) {
    return text;
  }
}

// '#/common?t=a,b' → { view: 'common', id: '', query: { t: 'a,b' } }.
// An empty address is the search page.
export function parseHash(hash) {
  let rest = typeof hash === 'string' ? hash : '';
  if (rest.startsWith('#')) rest = rest.slice(1);
  const mark = rest.indexOf('?');
  const path = mark === -1 ? rest : rest.slice(0, mark);
  const query = {};
  if (mark !== -1) {
    for (const pair of rest.slice(mark + 1).split('&')) {
      if (pair === '') continue;
      const equals = pair.indexOf('=');
      const key = decode(equals === -1 ? pair : pair.slice(0, equals));
      query[key] = equals === -1 ? '' : decode(pair.slice(equals + 1).split('+').join(' '));
    }
  }
  const parts = path.split('/').filter((part) => part !== '');
  return { view: parts.length > 0 ? decode(parts[0]) : 'search', id: parts.length > 1 ? decode(parts[1]) : '', query };
}

// The address of a view: makeHash('teacher', 't…'), makeHash('common', '', { t: 'a,b' }).
// Query values that are empty are left out.
export function makeHash(view, id, query) {
  let hash = '#/' + encodeURIComponent(view);
  if (id) hash += '/' + encodeURIComponent(id);
  const pairs = [];
  for (const [key, value] of Object.entries(query || {})) {
    if (value === '' || value === null || value === undefined) continue;
    pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  }
  return pairs.length > 0 ? hash + '?' + pairs.join('&') : hash;
}
