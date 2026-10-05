// data.js — loads all game content from /data via manifest.json.
// Adding content = add a JSON file + list it in manifest.json. No engine changes needed.
export const DB = {
  listings: {}, clients: {}, agents: {}, brokerages: {}, neighborhoods: {}, events: {},
};

/**
 * What loadAll() had to leave out, one line per broken reference, written for
 * whoever is editing data/: which file names what, and what the game did about
 * it. Empty on shipped content, and tools/smoke.mjs fails the build if it is
 * not (#879).
 */
export const contentErrors = [];

export async function loadAll() {
  const manifest = await fetchJSON("data/manifest.json");
  const jobs = [], files = {};
  for (const cat of Object.keys(DB)) {
    for (const path of manifest[cat] || []) {
      jobs.push(fetchJSON("data/" + path).then(obj => { DB[cat][obj.id] = obj; files[cat + "/" + obj.id] = "data/" + path; }));
    }
  }
  await Promise.all(jobs);
  contentErrors.length = 0;
  contentErrors.push(...dropBrokenContent(DB, (cat, id) => files[cat + "/" + id]));
  // Once, here, and not wherever the missing file would first have been read:
  // that was a TypeError on `.name` three screens away from the cause.
  for (const line of contentErrors) console.error("Closing Time content error: " + line);
  return DB;
}

/**
 * Content that names a file which is not there is a content error, and the
 * engine reads straight through every one of these ids: `DB.agents[...].name`
 * on every flyer and every offer, `DB.neighborhoods[...].buyerDemand` in
 * marketHeat(). So the thing that names the missing file is taken out of `db`
 * before anything can reach it, and the game goes on without it.
 *
 * - A listing whose agent or neighborhood is missing is dropped.
 * - A seller whose house stands in a missing neighborhood is dropped: the
 *   listing is inside the client's file.
 * - A buyer keeps their file and loses the missing area from their list.
 * - An event whose handler names a missing agent or brokerage is dropped.
 *
 * Nothing here knows about saves. A career that held a deal on a dropped
 * listing meets it in repairCareer() as a listing that is gone, which is the
 * case #861 already settles: no commission, no charge, one Ledger line.
 *
 * Returns the lines; `fileOf(cat, id)` is the path a loaded id came from.
 * Pure apart from `db`, so the suite can run it on a copy.
 */
export function dropBrokenContent(db = DB, fileOf = () => undefined) {
  const errors = [];
  const usual = (cat, id) => `data/${cat}/${id}.json`;
  const has = (cat, id) => typeof id === "string" && id in db[cat];
  const say = (cat, id, field, toCat, toId, outcome) => errors.push(
    `${fileOf(cat, id) || usual(cat, id)}: ${field} is ${JSON.stringify(toId)}, and no file listed under "${toCat}" in data/manifest.json has that id`
    + `${typeof toId === "string" ? ` (${usual(toCat, toId)} is where it would be)` : ""}. ${outcome}`);

  for (const l of Object.values(db.listings)) {
    let broken = false;
    if (!has("agents", l.listingAgentId)) { broken = true; say("listings", l.id, "listingAgentId", "agents", l.listingAgentId, "The listing is left out of the game."); }
    if (!has("neighborhoods", l.neighborhood)) { broken = true; say("listings", l.id, "neighborhood", "neighborhoods", l.neighborhood, "The listing is left out of the game."); }
    if (broken) delete db.listings[l.id];
  }
  for (const c of Object.values(db.clients)) {
    if (c.sellerListing && !has("neighborhoods", c.sellerListing.neighborhood)) {
      say("clients", c.id, "sellerListing.neighborhood", "neighborhoods", c.sellerListing.neighborhood, "The seller is left out of the game, and the house with them.");
      delete db.clients[c.id];
      continue;
    }
    const req = c.statedReqs;
    if (req && Array.isArray(req.neighborhoods)) {
      for (const nbId of req.neighborhoods) {
        if (!has("neighborhoods", nbId)) say("clients", c.id, "an entry in statedReqs.neighborhoods", "neighborhoods", nbId, "The buyer stays, without that area on their list.");
      }
      req.neighborhoods = req.neighborhoods.filter(nbId => has("neighborhoods", nbId));
    }
  }
  for (const ev of Object.values(db.events)) {
    const fx = ev.effect || {};
    let broken = false;
    if (fx.agentId != null && !has("agents", fx.agentId)) { broken = true; say("events", ev.id, "effect.agentId", "agents", fx.agentId, "The event is left out of the game."); }
    if (fx.brokerageId != null && !has("brokerages", fx.brokerageId)) { broken = true; say("events", ev.id, "effect.brokerageId", "brokerages", fx.brokerageId, "The event is left out of the game."); }
    if (broken) delete db.events[ev.id];
  }
  return errors;
}

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Failed to load " + url);
  return r.json();
}

export const fmtMoney = n => "$" + Math.round(n).toLocaleString("en-US");
export const pct = n => Math.round(n * 100) + "%";
