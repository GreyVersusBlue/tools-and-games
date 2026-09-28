import * as THREE from 'three';
import { groundHeight, LAYOUT, mulberry32 } from './field.js';
import { REF, variant, pieceMesh } from './pieces.js';
import { SHELL_NAMES_BY_KIND } from './journal-core.js';

// The forty shells worth crouching for. field.js fixes where they lie; this
// module gives each a body and a name, and the examine verb: press E over one
// and it rises to your hand, turning slowly while its name sits at the bottom
// of the frame; press again and it goes gently back where it lay. Nothing is
// pocketed and nothing is counted here — the *finding* is the thing, and the
// journal (phase 3) is what will remember it.

// Names live in journal-core.js so the notebook's slots and the beach's finds
// can never drift apart.
const NAMES = SHELL_NAMES_BY_KIND;

// One sea-glass piece per tint, in the order the builder's GLASS_TINT listed
// them: green, blue, amber (#666). The name follows the tint as it did.
const GLASS_TINTS = 3;

// Each find is its piece inside a group of its own: the group is what the
// examine verb lifts, turns and sets back, at the spot and height the builder's
// mesh had, and the piece inside it sits where the builder's primitive sat
// (pieces.js). Scaled by the entry's s over the pack's 0.175.
function find(pieces, name, s) {
  const g = new THREE.Group();
  g.name = `find:${name}`;
  g.add(pieceMesh(pieces, name));
  g.scale.setScalar(s / REF.shell.s);
  return g;
}

export function buildShells(scene, interact, controls, camera, audio, pieces) {
  const caption = document.getElementById('shell-caption');

  const shells = [];
  let examining = null;      // { mesh, home, homeRot, name }
  let returning = null;

  for (const s of LAYOUT.shells) {
    let mesh, name;
    const nameRnd = mulberry32(s.seed);
    const pick = arr => arr[(nameRnd() * arr.length) | 0];
    if (s.kind === 'cockle') {
      mesh = find(pieces, `cockle-${variant(s.seed, 3) + 1}`, s.s);
      name = pick(NAMES.cockle);
    } else if (s.kind === 'whelk') {
      mesh = find(pieces, `whelk-${variant(s.seed, 3) + 1}`, s.s);
      name = pick(NAMES.whelk);
    } else if (s.kind === 'sanddollar') {
      mesh = find(pieces, 'sand-dollar', s.s);
      name = pick(NAMES.sanddollar);
    } else {
      const idx = (nameRnd() * GLASS_TINTS) | 0;
      mesh = find(pieces, `sea-glass-${idx + 1}`, s.s);
      name = NAMES.seaglass[idx];
    }
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
