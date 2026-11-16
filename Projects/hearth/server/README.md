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
| `HEARTH_DAY_SECONDS` | `1200` | real seconds per island day (20 minutes: 72 island days a real day) |
| `HEARTH_ERA_DAYS` | `90` | real days per era; published in `live.json` only until eras are built (C7) |

**Changing the pace.** Change it only on a new island. `live.mjs` takes the
pace from `HEARTH_DAY_SECONDS` at every start but anchors the clock at the
founding, so changing the value on an island that exists makes the clock
compute a different step for the same wall time: slower and the island waits
until the new pace catches up with the steps already taken, faster and it races
ahead to catch up. `live.json` also still publishes the old pace in its
`clock`, so the page would disagree with the server. To change the pace:
`docker compose stop hearth-live`, empty `data/` and `public/` (copy `data/` away
first if the old island matters), set the new value, start. That founds a new
island at `HEARTH_SEED` on day 1.

## What lives where

- `data/anchor.json`, `data/epoch/0-<n>.json`: the only state. Plain files,
  each written to a temporary name and renamed, so a kill leaves either the old
  file or the new one.
- `public/live.json` (every epoch), `public/epoch/0-<n>.json` (once each),
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
files, so it needs no backup.

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
