/* Orbital level pack — Basics. Drop-in: registers itself on load. */
;(function (g) {
  (g.OrbitalPacks = g.OrbitalPacks || []).push({
    id: "basics",
    name: "Basics",
    blurb: "Learn to read gravity.",
    levels: [
      { name: "First Light", sub: "a clear line to the marker",
        start: { x: 110, y: 520 }, goal: { x: 890, y: 150, r: 46 }, bodies: [] },

      { name: "The Curve", sub: "one well bends your path",
        start: { x: 120, y: 150 }, goal: { x: 880, y: 150, r: 44 },
        bodies: [{ type: "planet", x: 500, y: 360, r: 52, mass: 58 }] },

      { name: "Slingshot", sub: "whip around the mass",
        start: { x: 120, y: 500 }, goal: { x: 880, y: 150, r: 40 },
        bodies: [{ type: "planet", x: 500, y: 320, r: 55, mass: 62 }] },

      { name: "Corridor", sub: "thread the gap",
        start: { x: 110, y: 320 }, goal: { x: 890, y: 320, r: 40 },
        bodies: [{ type: "planet", x: 500, y: 150, r: 60, mass: 70 },
                 { type: "planet", x: 500, y: 500, r: 60, mass: 70 }] },

      { name: "Binary", sub: "two dancers, one lane",
        start: { x: 130, y: 560 }, goal: { x: 860, y: 110, r: 40 },
        bodies: [{ type: "planet", x: 430, y: 300, r: 48, mass: 54 },
                 { type: "planet", x: 600, y: 390, r: 48, mass: 54 }] },

      { name: "Sunfall", sub: "graze the star, don't fall in",
        start: { x: 120, y: 120 }, goal: { x: 860, y: 540, r: 42 },
        bodies: [{ type: "star", x: 500, y: 340, r: 78, mass: 150 }] },

      { name: "Blockade", sub: "the rock won't move — go around",
        start: { x: 110, y: 330 }, goal: { x: 890, y: 330, r: 38 },
        bodies: [{ type: "rock", x: 500, y: 330, r: 34, mass: 20 },
                 { type: "planet", x: 500, y: 120, r: 52, mass: 64 },
                 { type: "planet", x: 500, y: 540, r: 52, mass: 64 }] },

      { name: "Clockwork", sub: "time the moving world",
        start: { x: 120, y: 540 }, goal: { x: 880, y: 540, r: 40 },
        bodies: [{ type: "star", x: 500, y: 330, r: 60, mass: 120 },
                 { type: "planet", x: 500, y: 330, r: 40, mass: 46,
                   orbit: { cx: 500, cy: 330, r: 210, speed: 0.9, a0: -1.5 } }] },

      { name: "Repulse", sub: "pushed away, pulled home",
        start: { x: 120, y: 540 }, goal: { x: 880, y: 150, r: 44 },
        bodies: [{ type: "planet", x: 430, y: 330, r: 54, mass: 66 },
                 { type: "repulse", x: 700, y: 430, r: 34, mass: -48 }] },

      { name: "The Gauntlet", sub: "everything at once",
        start: { x: 110, y: 560 }, goal: { x: 880, y: 110, r: 38 },
        bodies: [{ type: "star", x: 360, y: 250, r: 66, mass: 128 },
                 { type: "planet", x: 640, y: 450, r: 50, mass: 60 },
                 { type: "repulse", x: 640, y: 180, r: 32, mass: -44 },
                 { type: "rock", x: 500, y: 560, r: 26, mass: 14 }] },
    ]
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
