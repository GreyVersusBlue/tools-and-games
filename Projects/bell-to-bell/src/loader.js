const FILES = ['room', 'students', 'tells', 'interventions', 'events', 'lesson', 'reactions', 'seating', 'period5', 'observation'];

export async function loadData(base = './data') {
  const entries = await Promise.all(FILES.map(async name => {
    const res = await fetch(`${base}/${name}.json`);
    if (!res.ok) throw new Error(`Could not load ${name}.json (${res.status})`);
    return [name, await res.json()];
  }));
  return Object.fromEntries(entries);
}
