import * as THREE from 'three';
import { groundHeight, LAYOUT, mulberry32 } from './field.js';

// The forty shells worth crouching for. field.js fixes where they lie; this
// module gives each a body and a name, and the examine verb: press E over one
// and it rises to your hand, turning slowly while its name sits at the bottom
// of the frame; press again and it goes gently back where it lay. Nothing is
// pocketed and nothing is counted here — the *finding* is the thing, and the
// journal (phase 3) is what will remember it.

const NAMES = {
  cockle: ['Banded Cockle', 'Dog Cockle', 'Spiny Cockle'],
  whelk: ['Spired Whelk', 'Common Whelk', 'Netted Dog Whelk'],
  sanddollar: ['Sand Dollar', 'Keyhole Sand Dollar'],
  seaglass: ['Sea Glass — bottle green', 'Sea Glass — cornflower', 'Sea Glass — amber'],
};
const GLASS_TINT = [0x3d7a52, 0x5577aa, 0xa87b3a];

function cockleGeo(seed) {
  const rnd = mulberry32(seed);
  const geo = new THREE.SphereGeometry(1, 26, 12);
  const pos = geo.attributes.position;
  const ridges = 8 + (rnd() * 4 | 0);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const ridge = 1 + Math.abs(Math.sin(a * ridges * 0.5)) * 0.14;
    pos.setXYZ(i, x * ridge, Math.max(y * 0.42, -0.06), z * ridge);
  }
  geo.computeVertexNormals();
  return geo;
}

function whelkGeo(seed) {
  // A logarithmic spiral swept by a circle — built by hand because three has
  // no parametric geometry in core and vendoring an addon for one shell would
  // be the wrong trade. ~1,000 triangles.
  const rnd = mulberry32(seed);
  const turns = 2.6 + rnd() * 0.6, U = 64, V = 10;
  const positions = [], indices = [], up = new THREE.Vector3(0, 1, 0);
  const center = new THREE.Vector3(), radial = new THREE.Vector3();
  for (let i = 0; i <= U; i++) {
    const u = i / U;
    const th = turns * Math.PI * 2 * u;
    const r = 0.05 + 0.42 * Math.pow(u, 1.25);
    const tube = 0.04 + r * 0.62;
    center.set(Math.cos(th) * r * 0.55, 1.05 * (1 - u) - 0.35, Math.sin(th) * r * 0.55);
    radial.set(Math.cos(th), 0, Math.sin(th));
    for (let j = 0; j <= V; j++) {
      const v = (j / V) * Math.PI * 2;
      const px = center.x + radial.x * Math.cos(v) * tube;
      const py = center.y + Math.sin(v) * tube;
      const pz = center.z + radial.z * Math.cos(v) * tube;
      positions.push(px, py, pz);
    }
  }
  for (let i = 0; i < U; i++) {
    for (let j = 0; j < V; j++) {
      const a = i * (V + 1) + j, b = a + V + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function sandDollarMaterialTop() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#cfc4ab'; g.fillRect(0, 0, 128, 128);
  // The five-petal rosette.
  g.strokeStyle = 'rgba(120,105,80,0.65)';
  g.lineWidth = 2.5;
  for (let p = 0; p < 5; p++) {
    const a = (p / 5) * Math.PI * 2 - Math.PI / 2;
    g.beginPath();
    g.ellipse(64 + Math.cos(a) * 22, 64 + Math.sin(a) * 22, 8, 20, a + Math.PI / 2, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = 'rgba(120,105,80,0.5)';
  g.beginPath(); g.arc(64, 64, 3, 0, 6.29); g.fill();
  return new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), roughness: 0.9 });
}

function seaglassGeo(seed) {
  const rnd = mulberry32(seed);
  const geo = new THREE.IcosahedronGeometry(0.8, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const j = 0.86 + rnd() * 0.28;
    pos.setXYZ(i, pos.getX(i) * j, pos.getY(i) * 0.5 * j, pos.getZ(i) * j);
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildShells(scene, interact, controls, camera, audio) {
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xd9c9ae, roughness: 0.8 });
  const whelkMat = new THREE.MeshStandardMaterial({ color: 0xb9a284, roughness: 0.75 });
  const dollarMat = sandDollarMaterialTop();
  const caption = document.getElementById('shell-caption');

  const shells = [];
  let examining = null;      // { mesh, home, homeRot, name }
  let returning = null;

  for (const s of LAYOUT.shells) {
    let mesh, name;
    const nameRnd = mulberry32(s.seed);
    const pick = arr => arr[(nameRnd() * arr.length) | 0];
    if (s.kind === 'cockle') {
      mesh = new THREE.Mesh(cockleGeo(s.seed), shellMat);
      name = pick(NAMES.cockle);
    } else if (s.kind === 'whelk') {
      mesh = new THREE.Mesh(whelkGeo(s.seed), whelkMat);
      name = pick(NAMES.whelk);
    } else if (s.kind === 'sanddollar') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.04, 0.16, 22), dollarMat);
      name = pick(NAMES.sanddollar);
    } else {
      const idx = (nameRnd() * GLASS_TINT.length) | 0;
      mesh = new THREE.Mesh(seaglassGeo(s.seed), new THREE.MeshStandardMaterial({
        color: GLASS_TINT[idx], roughness: 0.35, transparent: true, opacity: 0.78,
      }));
      name = NAMES.seaglass[idx];
    }
    mesh.scale.setScalar(s.s);
    mesh.position.set(s.x, groundHeight(s.x, s.z) + s.s * 0.25, s.z);
    mesh.rotation.y = s.yaw;
    scene.add(mesh);

    const shell = { mesh, name, kind: s.kind, home: mesh.position.clone(), homeRot: mesh.rotation.clone(), found: false };
    shells.push(shell);

    interact.register({
      x: s.x, z: s.z, y: mesh.position.y, radius: 2.2,
      available: () => !examining && !returning && mesh.visible,
      label: () => 'look closer · E',
      use: () => {
        examining = shell;
        interact.setOverride(examineOverride);
        caption.textContent = name;
        caption.classList.add('show');
        state.onExamine?.(shell);
      },
    });
  }

  const examineOverride = {
    label: () => 'set it back · E',
    use: () => {
      returning = examining;
      examining = null;
      interact.clearOverride();
      caption.classList.remove('show');
    },
  };

  const target = new THREE.Vector3(), fwd = new THREE.Vector3();

  const state = {
    onExamine: null,   // phase 3's journal hooks in here
    shells,

    update(dt) {
      if (examining) {
        camera.getWorldDirection(fwd);
        target.copy(camera.position).addScaledVector(fwd, 0.62);
        target.y -= 0.12;
        const k = 1 - Math.exp(-dt * 9);
        examining.mesh.position.lerp(target, k);
        examining.mesh.rotation.y += dt * 0.7;
        // Walking away sets it down where it came from rather than dragging it.
        if (examining.mesh.position.distanceTo(examining.home) > 0.01 &&
            Math.hypot(controls.pos.x - examining.home.x, controls.pos.z - examining.home.z) > 4) {
          examineOverride.use();
        }
      }
      if (returning) {
        const k = 1 - Math.exp(-dt * 6);
        returning.mesh.position.lerp(returning.home, k);
        if (returning.mesh.position.distanceTo(returning.home) < 0.02) {
          returning.mesh.position.copy(returning.home);
          returning.mesh.rotation.copy(returning.homeRot);
          returning = null;
        }
      }
    },
  };

  return state;
}
