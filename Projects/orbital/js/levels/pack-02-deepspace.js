/* Orbital level pack — Deep Space. New mechanics: blackhole (instant loss +
   heavy pull), wormhole (linked pair; enter one, exit its partner keeping
   speed), booster (a gate that adds a kick along `dir`). Registers on load. */
;(function (g) {
  (g.OrbitalPacks = g.OrbitalPacks || []).push({
    id: "deepspace",
    name: "Deep Space",
    blurb: "Black holes, wormholes, and boosters.",
    levels: [
      { name: "Event Horizon", sub: "a black hole eats everything it touches",
        start: { x: 120, y: 540 }, goal: { x: 880, y: 540, r: 46 },
        bodies: [{ type: "blackhole", x: 500, y: 250, r: 28, mass: 190 }] },

      { name: "Dark Slingshot", sub: "steal speed from the dark",
        start: { x: 150, y: 540 }, goal: { x: 170, y: 140, r: 46 },
        bodies: [{ type: "blackhole", x: 520, y: 340, r: 26, mass: 210 }] },

      { name: "First Portal", sub: "in one mouth, out the other",
        start: { x: 120, y: 340 }, goal: { x: 880, y: 300, r: 44 },
        bodies: [{ type: "blackhole", x: 500, y: 320, r: 26, mass: 150 },
                 { type: "wormhole", x: 320, y: 340, r: 36, link: "a" },
                 { type: "wormhole", x: 720, y: 300, r: 36, link: "a" }] },

      { name: "Portal Sling", sub: "exit into a gravity turn",
        start: { x: 120, y: 540 }, goal: { x: 880, y: 150, r: 44 },
        bodies: [{ type: "wormhole", x: 300, y: 460, r: 34, link: "a" },
                 { type: "wormhole", x: 640, y: 260, r: 34, link: "a" },
                 { type: "planet", x: 820, y: 360, r: 52, mass: 64 }] },

      { name: "Kick", sub: "a gate adds a burst of speed",
        start: { x: 120, y: 520 }, goal: { x: 880, y: 150, r: 44 },
        bodies: [{ type: "booster", x: 460, y: 430, r: 44, dir: -0.9, boost: 210 },
                 { type: "planet", x: 720, y: 300, r: 48, mass: 52 }] },

      { name: "Redirect", sub: "boosted into orbit",
        start: { x: 120, y: 150 }, goal: { x: 880, y: 520, r: 44 },
        bodies: [{ type: "star", x: 500, y: 330, r: 64, mass: 120 },
                 { type: "booster", x: 300, y: 300, r: 40, dir: 1.1, boost: 180 }] },

      { name: "Twin Holes", sub: "thread the two singularities",
        start: { x: 120, y: 330 }, goal: { x: 880, y: 330, r: 40 },
        bodies: [{ type: "blackhole", x: 500, y: 180, r: 24, mass: 170 },
                 { type: "blackhole", x: 500, y: 480, r: 24, mass: 170 }] },

      { name: "The Long Way", sub: "two portals, back to back",
        start: { x: 120, y: 540 }, goal: { x: 880, y: 540, r: 42 },
        bodies: [{ type: "wormhole", x: 260, y: 420, r: 32, link: "a" },
                 { type: "wormhole", x: 500, y: 140, r: 32, link: "a" },
                 { type: "wormhole", x: 520, y: 520, r: 32, link: "b" },
                 { type: "wormhole", x: 760, y: 300, r: 32, link: "b" }] },

      { name: "Gravity Assist", sub: "star pull, then a kick",
        start: { x: 130, y: 540 }, goal: { x: 880, y: 130, r: 42 },
        bodies: [{ type: "star", x: 420, y: 340, r: 60, mass: 118 },
                 { type: "booster", x: 640, y: 300, r: 38, dir: -0.7, boost: 170 }] },

      { name: "Portal Maze", sub: "the exit turns you",
        start: { x: 120, y: 320 }, goal: { x: 880, y: 320, r: 40 },
        bodies: [{ type: "rock", x: 500, y: 320, r: 40, mass: 26 },
                 { type: "wormhole", x: 340, y: 180, r: 32, link: "a" },
                 { type: "wormhole", x: 660, y: 480, r: 32, link: "a", exitTurn: -0.6 }] },

      { name: "Singularity Run", sub: "skip past the dark",
        start: { x: 120, y: 540 }, goal: { x: 860, y: 160, r: 40 },
        bodies: [{ type: "blackhole", x: 520, y: 360, r: 24, mass: 180 },
                 { type: "wormhole", x: 300, y: 360, r: 32, link: "a" },
                 { type: "wormhole", x: 720, y: 200, r: 32, link: "a" }] },

      { name: "Deep Field", sub: "everything the void has",
        start: { x: 120, y: 540 }, goal: { x: 880, y: 120, r: 40 },
        bodies: [{ type: "blackhole", x: 400, y: 280, r: 24, mass: 170 },
                 { type: "planet", x: 700, y: 420, r: 48, mass: 56 },
                 { type: "booster", x: 560, y: 520, r: 38, dir: -1.0, boost: 180 },
                 { type: "wormhole", x: 220, y: 300, r: 30, link: "a" },
                 { type: "wormhole", x: 820, y: 280, r: 30, link: "a" }] },
    ]
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
