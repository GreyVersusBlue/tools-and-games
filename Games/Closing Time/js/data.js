// data.js — loads all game content from /data via manifest.json.
// Adding content = add a JSON file + list it in manifest.json. No engine changes needed.
export const DB = {
  listings: {}, clients: {}, agents: {}, brokerages: {}, neighborhoods: {}, events: {},
};

export async function loadAll() {
  const manifest = await fetchJSON("data/manifest.json");
  const jobs = [];
  for (const cat of Object.keys(DB)) {
    for (const path of manifest[cat] || []) {
      jobs.push(fetchJSON("data/" + path).then(obj => { DB[cat][obj.id] = obj; }));
    }
  }
  await Promise.all(jobs);
  return DB;
}

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Failed to load " + url);
  return r.json();
}

export const fmtMoney = n => "$" + Math.round(n).toLocaleString("en-US");
export const pct = n => Math.round(n * 100) + "%";
