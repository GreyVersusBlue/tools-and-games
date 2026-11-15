// A static file server for look.mjs (A0): serves Projects/hearth/ on a free localhost port, node:http only, no dependency.
// Over file:// the canvas is not tainted by the sheet image only by luck of the browser; over http it is plain same-origin, so getImageData works.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.woff2': 'font/woff2' };

// C4: `mounts` maps a URL prefix onto a folder outside the game's (live.mjs mounts /hearth-live/ onto the server's public folder), and `date`,
// when given, supplies the Date header for those responses so a test can run the site's clock fast. Both default to nothing: look.mjs is unchanged.
export function serve(opts = {}) {
  const mounts = opts.mounts || {};
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    for (const [prefix, dir] of Object.entries(mounts)) {
      if (!p.startsWith(prefix)) continue;
      const m = path.normalize(path.join(dir, p.slice(prefix.length)));
      if (!m.startsWith(dir + path.sep) || !fs.existsSync(m) || !fs.statSync(m).isFile()) { res.writeHead(404); res.end('not found'); return; }
      const h = { 'content-type': TYPES[path.extname(m)] || 'text/html', 'cache-control': 'no-store' };
      if (opts.date) h.date = new Date(opts.date()).toUTCString();
      res.writeHead(200, h); fs.createReadStream(m).pipe(res); return;
    }
    if (p.endsWith('/')) p += 'index.html';
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })));
}
