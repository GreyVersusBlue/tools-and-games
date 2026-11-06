// A digest of every route a routing engine gives, so the engine at commit
// 6f84f965 (before elevators and step-free plans, SV2-98) can be compared with
// today's without keeping its code. `digestRoutes(engine, project)` returns one
// sha-256 per plan: every room to every other room under {}, {avoidStairs},
// {undirected}, and every room's routeToExit under the same three options.
// The `rides` field (new in SV2-98) is left out; everything else, failures
// included, goes in, with keys sorted so the order they were built in is moot.
// route-digests-6f84f965.json holds the old engine's digests; regenerate only
// by pointing this at the old engine's copy (git show 6f84f965:<path>).

import { createHash } from 'node:crypto';

export const PLANS = { plain: {}, 'step-free': { avoidStairs: true }, undirected: { undirected: true } };

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).filter((key) => key !== 'rides').sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

// engine: { routingGraph, route, routeToExit }
export function digestRoutes(engine, project) {
  const graph = engine.routingGraph(project);
  const ids = Array.from(graph.rooms.keys()).sort();
  const digests = {};
  for (const [name, options] of Object.entries(PLANS)) {
    const hash = createHash('sha256');
    let count = 0;
    for (const from of ids) {
      for (const to of ids) {
        hash.update(canonical(engine.route(graph, from, to, options)) + '\n');
        count += 1;
      }
      hash.update(canonical(engine.routeToExit(graph, from, options)) + '\n');
      count += 1;
    }
    digests[name] = { routes: count, sha256: hash.digest('hex') };
  }
  return digests;
}
