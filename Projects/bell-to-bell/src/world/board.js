import * as THREE from '../three.js';

// The boards. What is written on the whiteboard is the lesson, so the lesson has
// to be somewhere you can look at it — and the objective board has to be visibly,
// permanently wrong, because that is a Fidelity joke you can only tell in 3D.
const STYLE = {
  lesson: {
    bg: '#F4F6F2', head: '#1D4E89', body: '#23241F', accent: '#A33B2A',
    headPx: 40, bodyPx: 34, pad: 34, lead: 44
  },
  objective: {
    bg: '#E0C24A', head: '#3A2E26', body: '#3A2E26', accent: '#A33B2A',
    headPx: 26, bodyPx: 20, pad: 16, lead: 25
  }
};

function drawPanel(ctx, w, h, style, content) {
  ctx.fillStyle = style.bg;
  ctx.fillRect(0, 0, w, h);

  // marker tray shadow / board grain
  ctx.fillStyle = 'rgba(0,0,0,.04)';
  for (let y = 0; y < h; y += 7) ctx.fillRect(0, y, w, 1);

  let y = style.pad + style.headPx;
  if (content.head) {
    ctx.font = `700 ${style.headPx}px "Arial Narrow", Arial, sans-serif`;
    ctx.fillStyle = style.head;
    ctx.fillText(content.head, style.pad, y);
    ctx.fillStyle = style.accent;
    ctx.fillRect(style.pad, y + 8, ctx.measureText(content.head).width, 3);
    y += style.lead;
  }
  ctx.font = `400 ${style.bodyPx}px "Arial Narrow", Arial, sans-serif`;
  ctx.fillStyle = style.body;
  for (const line of content.lines || []) {
    y += style.lead;
    ctx.fillText(line, style.pad, y);
  }
  if (content.foot) {
    ctx.font = `italic 400 ${Math.round(style.bodyPx * 0.8)}px Georgia, serif`;
    ctx.fillStyle = 'rgba(35,36,31,.55)';
    ctx.fillText(content.foot, style.pad, h - style.pad * 0.6);
  }
}

function makeScreen(scene, registry, spec) {
  const [pw, ph] = spec.px || [512, 256];
  const canvas = document.createElement('canvas');
  canvas.width = pw; canvas.height = ph;
  const ctx = canvas.getContext('2d');
  const style = STYLE[spec.kind] || STYLE.lesson;
  drawPanel(ctx, pw, ph, style, { head: '', lines: [] });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace ?? tex.colorSpace;
  tex.anisotropy = 4;

  const mat = new THREE.MeshLambertMaterial({ map: tex });
  mat.userData.thermal = new THREE.MeshBasicMaterial({ map: tex, color: 0x2A4A6A });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(spec.size[0], spec.size[1]), mat);
  mesh.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
  scene.add(mesh);
  registry.add(mesh);

  return {
    id: spec.id,
    set(content) {
      drawPanel(ctx, pw, ph, style, content || {});
      tex.needsUpdate = true;
    }
  };
}

export function createScreens(scene, registry, specs = []) {
  const out = {};
  for (const spec of specs) out[spec.id] = makeScreen(scene, registry, spec);
  return out;
}
