// vendor-embeds.mjs: writes data/embeds.json, the actions PF2e spells embed.
//
//   node Pathfinder/converter-assets/vendor-embeds.mjs      (from the repo root)
//
// Reads Pathfinder/data/spell.json and action.json (never writes them) and
// keeps only the actions some spell's text embeds by id, so the page does not
// fetch 1.3 MB of actions for one reaction. Run it when
// converter-spells.test.mjs says embeds.json no longer matches the Archive.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedSlice } from './js/spells.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(fs.readFileSync(path.join(HERE, '..', 'data', p), 'utf8'));
const slice = embedSlice(read('spell.json'), read('action.json'));
fs.writeFileSync(path.join(HERE, 'data', 'embeds.json'), JSON.stringify(slice, null, 1) + '\n');
console.log(`embeds.json: ${Object.keys(slice).length} action(s)`);
