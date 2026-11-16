// Hearth's public island, part 3 (C7): the end of an era and the founding of the next. live.mjs calls endEra() at an epoch once the era's
// real days are up. It files the island that is ending (its final snapshot and its saga under eras/<era>/, a row in eras.json), picks up to
// four founders from it, founds the far island at farSeed(oldSeed), gives its first settlers the founders' names, and hands the new island
// back to live.mjs, which anchors a clock for it. No draw of its own: the founders are chosen by order, and the new island runs its own
// seed's stream. Everything it sets is a field pack() already carries (names, seeds, rels, hist, the far record, the lamp, the chronicle).
// Node 22, no dependency, no HTTP.
import fs from 'node:fs';
import path from 'node:path';

export const ERAS_V = 1;
export const MAX_FOUNDERS = 4;

function put(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, typeof body === 'string' ? body : JSON.stringify(body));
  fs.renameSync(tmp, file);
}

// What the ending island says about itself, read inside the game's own context. Candidates, in the order of 5.5's C7: the people in `gone`
// with `far` set, newest first (gone is pushed in order, so newest is last); then the living adults who dream of the far island or are brave
// or restless, by name order. A name is listed once.
const INFO = `(()=>{const adults=people.filter(p=>!p.dead&&!isKid(p)&&(p.dreamFar||has(p,'brave')||has(p,'restless'))).map(p=>p.name).sort((a,b)=>a<b?-1:a>b?1:0);
 const from=gone.filter(g=>g.far).map(g=>g.name).reverse();const seen=new Set(),want=[];
 for(const n of from.concat(adults))if(!seen.has(n)){seen.add(n);want.push(n)}
 return{seed,village:village||null,years:yearOf(dayCount),people:people.filter(p=>!p.dead).length,graves:graves.length,farSeed:farSeed(seed),candidates:want}})()`;

// In the new island: rename its first settlers to the founders (skipping a candidate whose name a settler already has, so no two people
// share one), carry the name through everything that holds it, mark the old village on the far record and light its lamp, and write the
// founding into the chronicle. `m` is { old, candidates }. Returns the names that came over.
const FOUND = m => `((m)=>{
  const set=people.slice(),taken=new Set(set.map(p=>p.name)),pick=[];
  for(const n of m.candidates){if(pick.length>=set.length)break;if(taken.has(n))continue;pick.push(n)}
  const map={};pick.forEach((n,i)=>{map[set[i].name]=n});
  const to=n=>Object.prototype.hasOwnProperty.call(map,n)?map[n]:n;
  for(const p of people){p.name=to(p.name);p.rels.forEach(r=>{r.who=to(r.who)});if(p.partner)p.partner=to(p.partner);p.parents=p.parents.map(to);p.seed=hash(p.name)^seed;
    if(pick.includes(p.name))p.hist.push({d:dayCount,s:'came over the water from '+m.old})}
  names=new Set(people.map(p=>p.name));
  farRec.n=m.old;farRec.kn=1;farIsle.lit=true;
  const who=pick.length?pick.join(', ').replace(/, ([^,]*)$/,' and $1'):'';
  addEvent('era',pick.length?'the day '+who+' came over the water from '+m.old:'the day the island over the water was settled from '+m.old,
    pick.length?who+(pick.length===1?' is':' are')+' the first of a new island, come over the water from '+m.old+'. On the horizon a lamp burns where they left. The fire was lit the first night.'
    :'A new island was settled from '+m.old+'. On the horizon a lamp burns where they left.');
  return pick})(${JSON.stringify(m)})`;

// ctx.world: the world (server/world.mjs). ctx.snap: the final snapshot, already taken. ctx.saga: world.saga(), already taken.
// ctx.era, ctx.cfg, ctx.founded and ctx.ended (wall-clock ms), ctx.log. Writes under cfg.pub; returns { row, seed, founders }.
// Re-running it for the same era writes the same files and replaces the same row: a kill between this and the new anchor costs nothing.
export function endEra(ctx) {
  const { world, cfg, era, snap, saga, log } = ctx;
  const info = world.run(INFO);
  const dir = path.join(cfg.pub, 'eras', String(era));
  put(path.join(dir, 'final.json'), { era, n: ctx.n, step: snap.step, hash: snap.hash, save: snap.save, events: [] });
  put(path.join(dir, 'saga.html'), saga.html);
  const row = { era, seed: info.seed, name: info.village, founded: new Date(ctx.founded).toISOString(), ended: new Date(ctx.ended).toISOString(), years: info.years, people: info.people, graves: info.graves };
  const file = path.join(cfg.pub, 'eras.json');
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')).eras.filter(r => r.era !== era); } catch (e) { /* no archive yet */ }
  list.push(row); list.sort((a, b) => a.era - b.era);
  put(file, { v: ERAS_V, eras: list });
  world.found(info.farSeed);
  const founders = world.run(FOUND({ old: info.village || 'island ' + info.seed.toString(36), candidates: info.candidates }));
  log(`era ${era} ended: island ${info.seed.toString(36)}, ${info.years} years, ${info.people} living, ${founders.length} founders sailed for island ${info.farSeed.toString(36)}`);
  return { row, seed: info.farSeed, founders };
}
