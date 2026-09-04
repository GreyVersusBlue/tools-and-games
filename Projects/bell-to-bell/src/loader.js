import { CONTENT_FIELDS, fileOf } from './periods.js';

// The files the game always needs: the room, the rulebook, the copy decks, and
// the day's running order.
const CORE = ['room', 'students', 'tells', 'interventions', 'events', 'lesson',
  'reactions', 'seating', 'observation', 'assets', 'periods', 'generation'];

async function fetchAll(names, base) {
  const entries = await Promise.all(names.map(async name => {
    const res = await fetch(`${base}/${name}.json`);
    if (!res.ok) throw new Error(`Could not load ${name}.json (${res.status})`);
    return [name, await res.json()];
  }));
  return Object.fromEntries(entries);
}

// Phase 1: which content files exist is a question data/periods.json answers,
// not a constant in here. Anything a period row points at that CORE has not
// already loaded gets fetched in a second wave — which is the whole reason a
// sixth period is a JSON file and a row rather than an edit to this list.
export function contentFiles(periodsFile) {
  const names = new Set();
  for (const row of periodsFile.periods) {
    for (const field of CONTENT_FIELDS) {
      if (row[field]) names.add(fileOf(row[field]));
    }
  }
  return [...names];
}

export async function loadData(base = './data') {
  const core = await fetchAll(CORE, base);
  const extra = contentFiles(core.periods).filter(name => !(name in core));
  return { ...core, ...await fetchAll(extra, base) };
}
