# The server

The School Generator is a static page with no build step, and it stays one.
This directory is the other half of the two contracts that page has been
carrying since Phase 14 with nothing on the other end of them:

- **The design store** — `cloud.js`'s four HTTP calls, so a design can outlive
  the browser it was drawn in and travel by link rather than by file.
- **The relay** — `wire.js`'s WebSocket, so a session reaches somebody in
  another building rather than another window of the same browser.

Both are in one process because `cloud.js` guesses the relay is the same host
with `ws://` and `/relay` on the end, and somebody who has typed one address
should not have to type a second.

**It has no dependencies.** Node 18 or newer, and nothing else — no package to
install, no lockfile, no `node_modules`. The WebSocket protocol is in `ws.js`,
which is about two hundred lines of RFC 6455 and is the price of that.

## Running one

```
node server/index.mjs --port 8787 --dir ./data
```

Then, in the tool: **Cloud ▸ Server**, and type

```
http://localhost:8787
```

The relay box will offer you `ws://localhost:8787/relay`, which is where this
server puts it. That is the whole of the setup.

Options, all optional:

| flag | default | what it is |
| --- | --- | --- |
| `--port` | `8787` | the port to listen on |
| `--host` | `0.0.0.0` | the interface to bind |
| `--dir` | `./data` | where designs are kept |
| `--max-bytes` | `10485760` | the largest design this store will take |
| `--note` | — | a line the tool prints in its Cloud panel |

## Putting one somewhere real

It is an ordinary Node HTTP server, so anything that runs one will run this:
a small VPS, a container, a box in a cupboard at the school. Two things are
worth getting right and neither is in the code:

**Terminate TLS in front of it.** A page served over `https:` cannot call an
`http:` store or open a `ws:` socket — the browser blocks both as mixed
content, and the failure looks like the store being down. Put nginx, Caddy or
your host's own proxy in front, and use `https://…` and `wss://…` addresses.
A proxy needs to be told to pass a WebSocket upgrade through; in nginx that is
the usual two lines:

```
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

**Back up `--dir`.** It is one file per design plus one holding its write key.
Nothing else is state. Copying the directory is a complete backup and dropping
a copy back is a complete restore.

## What it does not do, on purpose

**No accounts.** The security model is one sentence and `cloud.js` prints it
in the panel: *anybody with the link can read a design, and only the browser
that made it can change it.* The design id is in the link. The write key never
leaves the browser that made the design. There is nothing else.

Two things follow, and they are the reason this is stated so plainly rather
than buried:

- **Whoever runs the relay sees the designs that pass through it.** Not
  because it stores them — it does not, it repeats frames and forgets them —
  but because the bytes go through the process.
- **Anybody with a store link can read that design.** That is the feature.

Making either private needs accounts, which is a different project.

**No parsing.** The relay repeats frames without looking inside them, and the
store checks only that a body is JSON and is under the cap. Neither of them
knows what a school is, which is what keeps the save format the business of
exactly one codebase.

**No history.** The store holds the current version of a design and nothing
else. A PUT replaces what was there.

**No compression on the relay.** `permessage-deflate` is not negotiated, so a
two-megabyte snapshot travels as two megabytes. For a room with two teachers
in it that is the right trade; a relay with a thousand rooms is a different
program and should use a real WebSocket library.

## The shape of it

| file | what it is |
| --- | --- |
| `store.js` | every decision the store makes, and no disk. Pure. |
| `relay.js` | the rooms, and who a frame goes to. Pure. |
| `ws.js` | RFC 6455: the handshake and the frames. Pure. |
| `index.mjs` | sockets, disk, and the order things happen in. |

The three pure modules have suites of their own — `test/server-store.test.mjs`,
`test/server-relay.test.mjs`, `test/server-ws.test.mjs` — and `test/server.test.mjs`
boots the real thing on a real port and drives it through `cloud.js`'s and
`wire.js`'s own client code, so that the day the contract and the server drift
apart is a red test rather than a bug report. Run them the way everything else
in this project runs:

```
node --test "test/*.test.mjs"
```
