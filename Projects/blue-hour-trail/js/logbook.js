import * as THREE from 'three';
import { groundHeight, LAYOUT } from './field.js';

// The logbook, torn loose. Ten weathered pages scattered down the mountain —
// a few blown along the trail, the rest around the cabin and the summit where
// the log lived — each one carrying a keeper's entries. This is the piece's
// single verb: stand over a page and hold a key, and it comes up close enough
// to read; let go and it is back on the ground. Nothing is collected, nothing
// is counted, no journal remembers which pages have been read. A page read is
// not "gotten". They are findable in any order and the order they are found in
// is the order they were meant to be found in.
//
// The overlay is DOM, not canvas, so the text is real text — selectable-less,
// quiet, gone the moment the hand comes off the key. The world does not pause
// for it; the fog keeps breathing and the woods stay exactly as honest as they
// were while you read.

const READ_RADIUS = 1.7;

/** The page as an object: pale, ruled, written on by somebody in a hurry or
 *  the cold. The writing is deliberate scribble — at prop scale it should read
 *  as "handwriting", never as words, because the real words live in the
 *  overlay where they can be typeset like they matter. */
function pageTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 168;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#b9b2a0';
  ctx.fillRect(0, 0, 128, 168);
  // weather stains, darker at the edges
  const rim = ctx.createRadialGradient(64, 84, 30, 64, 84, 110);
  rim.addColorStop(0, 'rgba(90,80,60,0)');
  rim.addColorStop(1, 'rgba(70,62,48,0.55)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, 128, 168);
  ctx.fillStyle = 'rgba(96,86,66,0.25)';
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.ellipse(20 + (i * 37) % 100, 18 + (i * 53) % 140, 9 + (i % 3) * 5, 6, i, 0, Math.PI * 2);
    ctx.fill();
  }
  // faint rules
  ctx.strokeStyle = 'rgba(84,88,96,0.35)';
  ctx.lineWidth = 1;
  for (let y = 26; y < 160; y += 13) {
    ctx.beginPath(); ctx.moveTo(10, y); ctx.lineTo(118, y); ctx.stroke();
  }
  // handwriting: broken strokes riding just above the rules
  ctx.strokeStyle = 'rgba(42,46,52,0.7)';
  ctx.lineWidth = 1.4;
  let seed = 9;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y = 24; y < 158; y += 13) {
    let x = 12 + rnd() * 8;
    const lineEnd = 60 + rnd() * 56;
    while (x < lineEnd) {
      const w = 4 + rnd() * 9;
      ctx.beginPath();
      ctx.moveTo(x, y - 1 + rnd() * 2);
      ctx.quadraticCurveTo(x + w * 0.5, y - 4 + rnd() * 5, x + w, y - 1 + rnd() * 2);
      ctx.stroke();
      x += w + 2 + rnd() * 3;
    }
  }
  // a torn corner
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(128, 130); ctx.lineTo(128, 168); ctx.lineTo(86, 168);
  ctx.quadraticCurveTo(112, 150, 128, 130);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

function buildPageMesh() {
  const positions = [], uvs = [], normals = [], indices = [];
  let vi = 0;
  const v = new THREE.Vector3();
  for (const pg of LAYOUT.pages) {
    // Seat the quad at the highest of its corners so the coarse terrain mesh
    // (1.5 m grid) can't swallow an edge; a page can float a centimetre, a
    // page cannot be half-buried and still be an invitation.
    const w = 0.34, h = 0.44;
    const rot = new THREE.Matrix4().makeRotationY(pg.yaw);
    const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [-w / 2, h / 2], [w / 2, h / 2]];
    let y = -Infinity;
    for (const [cx, cz] of corners) {
      v.set(cx, 0, cz).applyMatrix4(rot);
      y = Math.max(y, groundHeight(pg.x + v.x, pg.z + v.z));
    }
    y += 0.035;
    for (let i = 0; i < corners.length; i++) {
      const [cx, cz] = corners[i];
      v.set(cx, 0, cz).applyMatrix4(rot);
      positions.push(pg.x + v.x, y, pg.z + v.z);
      normals.push(0, 1, 0);
      uvs.push(i % 2, i < 2 ? 1 : 0);
    }
    indices.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3);
    vi += 4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const mat = new THREE.MeshLambertMaterial({
    map: pageTexture(),
    side: THREE.DoubleSide,
    fog: true,
  });
  return new THREE.Mesh(geo, mat);
}

export function buildLogbook(scene, controls) {
  scene.add(buildPageMesh());

  const chip = document.getElementById('page-chip');
  const overlay = document.getElementById('page-overlay');
  const body = document.getElementById('page-overlay-body');
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  chip.textContent = isTouch ? 'a loose page — hold here to read' : 'a loose page — hold E to read';

  let near = -1;        // index into LAYOUT.pages, or -1
  let open = -1;        // the page currently up, or -1
  let touchHeld = false;

  // Touch reads by holding the chip itself; anywhere on the walk strip would
  // fight the walk-touch, and a second on-screen button is one more piece of
  // UI than this piece wants.
  chip.addEventListener('pointerdown', e => { e.preventDefault(); touchHeld = true; });
  for (const ev of ['pointerup', 'pointercancel']) {
    document.addEventListener(ev, () => { touchHeld = false; });
  }

  function render(pg) {
    body.innerHTML = '';
    for (const en of pg.entries) {
      const date = document.createElement('p');
      date.className = 'page-date';
      date.textContent = en.date;
      const text = document.createElement('p');
      text.className = 'page-body';
      text.textContent = en.body;
      const sig = document.createElement('p');
      sig.className = 'page-sig';
      sig.textContent = '— ' + pg.keeper;
      body.append(date, text, sig);
    }
  }

  return {
    update() {
      if (!controls.enabled) return;
      near = -1;
      let bestD = READ_RADIUS;
      for (const pg of LAYOUT.pages) {
        const d = Math.hypot(controls.pos.x - pg.x, controls.pos.z - pg.z);
        if (d < bestD) { bestD = d; near = pg.id; }
      }

      const held = !!controls.keys['KeyE'] || touchHeld;
      const want = near >= 0 && held ? near : -1;
      if (want !== open) {
        open = want;
        if (open >= 0) render(LAYOUT.pages[open]);
        overlay.classList.toggle('show', open >= 0);
      }
      chip.classList.toggle('show', near >= 0 && open < 0);
    },
    // For the regression suite: which page is underfoot and which is up.
    debug: () => ({ pages: LAYOUT.pages.length, near, open }),
  };
}
