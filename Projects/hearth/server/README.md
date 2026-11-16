# The public island: running it

One Node program, `live.mjs`, runs the real Hearth around the clock and writes
plain files. The site's own web server serves them at `/hearth-live/`.
Nothing here opens a port, takes input from a visitor or stores anything about
one. The design is `../DESIGN-arc-three.md`, part C; this page is only what to
do.

## What you run

One extra container, from `compose.example.yml` in this folder, and one extra
line on the web container you already have. Nothing else changes.

1. Copy the `hearth-live` service into your compose file and replace the
   three paths:
   - `<the served checkout of this repo>`: the same checkout the site is served
     from, mounted read-only at `/app`. The server loads the game's scripts
     from it, so a merge reaches the public island with nothing to run (below).
   - `<state>/hearth-live/data`: private state. Make the folder first and make
     it writable by uid 1000 (`mkdir -p` then `chown 1000:1000`), because the
     container runs as that user with a read-only root.
   - `<state>/hearth-live/public`: what is published. Same ownership.
2. Add one line to the web container's `volumes`, the second mount:
   `<state>/hearth-live/public:/usr/share/nginx/html/hearth-live:ro`
   (read-only, under the web root; the web root's path is nginx's default,
   change it if yours differs). If you would rather not touch the mount list,
   one `location /hearth-live/ { alias <that folder>/; }` block does the same.
3. Never add a folder called `hearth-live` at the repo's root: the mount would
   hide it.
4. Start it: `docker compose up -d hearth-live`. On an empty data folder it
   founds the island and writes epoch 0 within a second. Check
   `https://<site>/hearth-live/live.json` and `health.json`.

## What each value does

| Variable | Default | Meaning |
| --- | --- | --- |
| `HEARTH_DATA` | `./hearth-data` | private state: `anchor.json` and the newest two epoch files |
| `HEARTH_PUBLIC` | `./hearth-public` | what the web server serves |
| `HEARTH_SEED` | `7` | the first island's seed; only read when the data folder is empty |
| `HEARTH_DAY_SECONDS` | `1200` | real seconds per island day (20 minutes: 72 island days a real day), for the next island founded. An island that exists keeps the pace it was founded with |
| `HEARTH_ERA_DAYS` | `90` | real days an island lives. At the first epoch past that it is archived and its far island is founded (see "Eras") |

**Changing the pace.** Edit `HEARTH_DAY_SECONDS` and restart; nothing is
emptied. The pace of an island is written into its `anchor.json`
(`daySeconds`, and `stepMs` derived from it) when the island is founded, and
`live.mjs` reads it from there at every start. A different environment value
leaves the island that is running alone, so its history is not retimed and
`live.json` agrees with the page; the server logs one line saying so
("HEARTH_DAY_SECONDS is N but this era runs at M; N applies from the next
era"), and the next era's anchor takes the new value. To change the pace of the
island that is running now, the only way is the old one: stop the container,
empty `data/` and `public/` (copy `data/` away first if the island matters),
set the new value, start; that founds a new island at `HEARTH_SEED` on day 1.
An anchor from before eras (no `daySeconds`) keeps the pace its `stepMs` says
and has it written in at the first start.

## Eras

An island lives `HEARTH_ERA_DAYS` real days. At the first epoch whose wall
time is at or past that (so a long absence ends it at the same epoch a
second-by-second run would), `era.mjs` files it and founds the next:

- `public/eras/<era>/final.json` (the last epoch's snapshot, the same shape as
  an epoch file) and `public/eras/<era>/saga.html`, and a row in
  `public/eras.json` (`{v, eras:[{era, seed, name, founded, ended, years,
  people, graves}]}`);
- up to four founders: the people who sailed away for the far island, newest
  first, then living adults who dream of it or are brave or restless, by name.
  No random draw;
- the new island is founded at the far island's seed (`farSeed` of the old one,
  so the old island is on its horizon), its first settlers take the founders'
  names, its far island is named for the old village with its lamp lit, and
  its chronicle opens with the founding;
- a new anchor at the wall time of the epoch that ended the old era, era
  number one higher, epoch numbers from 0 again. `data/epoch/` and
  `public/epoch/` then hold only the new era's files (`1-0.json` and on); the
  old era's epoch files are removed, `final.json` is what is kept.

A kill part way is safe: the new epoch 0 is written before the new anchor, and
the old era's files are removed after it, so a restart that finds the old
anchor ends the era again to the same bytes. `live.json` names the era; the
page moves to the new island by itself and lists the old ones under "the
island before this one".

## What lives where

- `data/anchor.json`, `data/epoch/<era>-<n>.json`: the only state. Plain files,
  each written to a temporary name and renamed, so a kill leaves either the old
  file or the new one.
- `public/live.json` (every epoch), `public/epoch/<era>-<n>.json` (once each), `public/eras.json` and `public/eras/<era>/` (at an era's end),
  `public/saga.html` and `chronicle.txt` (every epoch), `public/health.json`
  (every minute). Epoch files are kept for 48 hours, then one a UTC day.

## When it stops, or the code changes

- **Restart or crash.** `restart: unless-stopped`. On start it reads the newest
  epoch in `data/`, unpacks it and steps to the present. A day of downtime is
  about a minute of one core.
- **A step that throws.** The server keeps the last good epoch, backs off up to
  a minute between tries and says so in `health.json` (`ok: false`, `error`).
  The page keeps showing the last good island.
- **New game code.** At each epoch it hashes the scripts. A changed hash that
  two reads 30 seconds apart agree on is loaded in a fresh context, run for 200
  steps from the current snapshot, and adopted. If that throws, the old code
  stays and `health.json` shows `codeRejected` above 0. A bad merge does not
  stop the island.

## Reading `health.json`

`{now, step, behind, lastEpochAt, rssMB, codeRejected, ok, error}`, rewritten
every minute.

- `behind`: steps between the island and where the clock says it should be. 0
  or a few dozen is normal; after a long absence it counts down by itself.
  Climbing for minutes means the container is starved of CPU.
- `lastEpochAt`: wall-clock ms of the last epoch. At the default pace it is
  never more than 20 minutes old. Older, and the process is stuck or stopped.
- `rssMB`: resident memory. The container's limit is 384 MB and the long run
  (`../test/longrun.mjs`) measures it; over 300 deserves a look.
- `ok: false`: a step threw; `error` has the message. It retries on its own.

## Backup

Copy the `data` folder. A nightly archive of it is a few megabytes.

```
tar -C <state>/hearth-live -czf hearth-live-data-$(date +%F).tgz data
```

`public/` is rebuilt from `data/` at the next epoch for everything but old epoch
files and the era archive (`public/eras.json`, `public/eras/`), which exist
nowhere else once an era has ended. Once the first era ends, add them to the
archive:
`tar -C <state>/hearth-live -czf hearth-live-eras-$(date +%F).tgz public/eras public/eras.json`.

## Restore

1. `docker compose stop hearth-live`
2. Put the folder back: empty `<state>/hearth-live/data`, then
   `tar -C <state>/hearth-live -xzf hearth-live-data-<date>.tgz`
3. `docker compose up -d hearth-live`

It resumes from the newest epoch in the folder and steps to the present on the
clock in `anchor.json`. The island is then exactly the island a straight run
would have: the next epoch's `hash` is the same number. The drill below is how
that was checked.

## The drill

Done once from this repository with no container, on a scratch folder, with
`node server/live.mjs` run directly and `HEARTH_DAY_SECONDS=20` so that an
epoch comes every 20 seconds: start, wait for epoch 2, stop, copy `data/`
away, wipe it, restore the copy, start, wait for epoch 3, and compare epoch 3's
`hash` with the one from a straight run of the same seed on a fake clock. The
result is in HISTORY (the C6 entry). Do it again on the real machine before
relying on a backup.

## The long run

`node test/longrun.mjs` (from `Projects/hearth/test`) grows one island for 6,480
island days, one default era, and prints cost per day, save size, memory and
unpack time every 500 days. It fails if the cost per day at the end is over
three times the first line's, if the compressed save passes 1.5 million
characters, or if memory passes 384 MB. `--days 800` is the short form the
nightly job runs.

**Measured on 2026-11-16, seed 7, Node 22, Huginn, `node --max-old-space-size=192 longrun.mjs` (the container's heap flag), the full 6,480 days in 145.4 minutes, all three limits passed.**

| Island day | ms/day | Save raw | Save compressed | Resident MB | Unpack ms | People |
|---|---|---|---|---|---|---|
| 500 | 787.0 | 205,783 | 77,716 | 228 | 460.8 | 50 |
| 1000 | 977.8 | 288,058 | 106,436 | 243 | 472.9 | 50 |
| 1500 | 997.8 | 352,605 | 126,183 | 242 | 443.4 | 48 |
| 2000 | 1083.5 | 451,002 | 151,236 | 265 | 404.9 | 47 |
| 2500 | 1069.6 | 498,134 | 165,700 | 287 | 439.9 | 47 |
| 3000 | 1120.7 | 556,525 | 181,479 | 285 | 410.9 | 47 |
| 3500 | 1221.6 | 627,000 | 200,735 | 283 | 434.7 | 45 |
| 4000 | 1242.3 | 719,793 | 227,122 | 278 | 433.5 | 47 |
| 4500 | 1382.0 | 794,429 | 252,279 | 278 | 625.3 | 50 |
| 5000 | 1647.4 | 860,424 | 271,828 | 288 | 660.2 | 47 |
| 5500 | 1622.0 | 945,056 | 296,370 | 290 | 890.2 | 47 |
| 6000 | 2106.5 | 1,011,451 | 319,356 | 293 | 690.0 | 48 |
| 6480 | 2254.8 | 1,069,959 | 338,079 | 306 | 729.3 | 44 |

Cost per day at the end is 2.87 times the first line's (limit 3), the compressed save is 338,079 characters (limit 1.5 million), and resident memory peaks at 306 MB (limit 384). The cost ratio is the thin one: a little more growth in the last era would trip it. Earlier short runs read 342 and 373 MB at day 800 without the heap flag; under it the same island never passes 306 MB.
