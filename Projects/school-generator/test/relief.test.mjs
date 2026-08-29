// relief.test.mjs — the shape of a surface, and the two sign conventions that
// decide which way every wall in the building faces the light.
//
// A normal map is the one texture whose bugs are invisible: get the green
// channel backwards and brick still looks like brick, it just lights as though
// the sun were underneath it. So most of what follows is arithmetic on
// hand-made height fields rather than on the real families — a ramp, a step, a
// flat sheet — where the right answer can be written down.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RELIEF_SIZE, RELIEF_GRAINS, GRAIN_KEYS, hasRelief,
  reliefRng, heightField, normalTexels, reliefFor,
} from '../js/relief.js';
import { rng } from '../js/agents.js';
import { FLOOR_FINISHES, FACADE_MATERIALS, ROOF_MEMBRANE, ROOF_SHINGLE } from '../js/finish.js';
import { SITE_SURFACES } from '../js/site.js';

// A field the encoder can be held to, built by hand.
const field = (size, fn) => {
  const data = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data[y * size + x] = fn(x, y);
  return { size, data, grain: 'speck' };
};

const texel = (bytes, size, x, y) => {
  const i = (y * size + x) * 4;
  return [bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]];
};

// ---------- the generator ----------

test('reliefRng is agents.js\'s generator, not a second one', () => {
  // The copy in relief.js exists to keep 66 KB of crowd behaviour off the boot
  // path, not to be a different generator. If these ever diverge, one of them
  // has been "improved".
  for (const seed of [1, 7, 12345, 0x7fffffff]) {
    const a = reliefRng(seed), b = rng(seed);
    for (let i = 0; i < 8; i++) assert.equal(a(), b(), `seed ${seed}, draw ${i}`);
  }
});

// ---------- the encoding ----------

test('a flat field encodes as the neutral normal', () => {
  const bytes = normalTexels(field(16, () => 0.5), { depth: 3 });
  for (let i = 0; i < 16 * 16; i++) {
    assert.deepEqual(
      [bytes[i * 4], bytes[i * 4 + 1], bytes[i * 4 + 2], bytes[i * 4 + 3]],
      [128, 128, 255, 255]);
  }
});

test('a flat field is flat at any depth — depth scales slope, not level', () => {
  const flat = field(8, () => 0.25);
  assert.deepEqual([...normalTexels(flat, { depth: 0.1 })],
    [...normalTexels(flat, { depth: 40 })]);
});

test('ground climbing toward +u tips the normal toward -u', () => {
  // The surface normal of a height field is (-dh/du, -dh/dv, 1). A ramp
  // rising to the right faces left, so red lands below the neutral 128.
  const size = 32;
  const bytes = normalTexels(field(size, (x) => x / size), { depth: 4 });
  // Away from the wrap seam, where the ramp falls off a cliff back to zero.
  const [r, g, b] = texel(bytes, size, 16, 16);
  assert.ok(r < 128, `red ${r} should be under 128 on a rising ramp`);
  assert.equal(g, 128, 'a ramp in u alone leaves green neutral');
  assert.ok(b > 128, 'z stays positive: a height field never faces away');
});

test('ground climbing toward +v tips the normal toward -v, green-up', () => {
  // three.js reads OpenGL-convention maps — green toward +v — and a
  // DataTexture is not flipped, so row y is v. Both halves of that sentence
  // are what this asserts.
  const size = 32;
  const bytes = normalTexels(field(size, (_x, y) => y / size), { depth: 4 });
  const [r, g] = texel(bytes, size, 16, 16);
  assert.equal(r, 128, 'a ramp in v alone leaves red neutral');
  assert.ok(g < 128, `green ${g} should be under 128 on a field rising with v`);
});

test('every encoded normal is a unit vector', () => {
  const bytes = normalTexels(heightField('brick', { size: 48 }), {});
  let worst = 0;
  for (let i = 0; i < 48 * 48; i++) {
    const nx = (bytes[i * 4] / 255) * 2 - 1;
    const ny = (bytes[i * 4 + 1] / 255) * 2 - 1;
    const nz = (bytes[i * 4 + 2] / 255) * 2 - 1;
    worst = Math.max(worst, Math.abs(Math.hypot(nx, ny, nz) - 1));
  }
  // One byte of quantisation is ~1/255 per component; anything past a percent
  // is a normalisation that isn't happening.
  assert.ok(worst < 0.012, `worst deviation from unit length was ${worst}`);
});

test('a deeper field leans further — depth is the one knob', () => {
  const size = 16;
  const ramp = field(size, (x) => x / size);
  const shallow = normalTexels(ramp, { depth: 0.5 });
  const deep = normalTexels(ramp, { depth: 6 });
  assert.ok(texel(deep, size, 8, 8)[0] < texel(shallow, size, 8, 8)[0]);
});

test('depth comes off the family table when the caller says nothing', () => {
  const f = heightField('brick', { size: 32 });
  assert.deepEqual([...normalTexels(f, {})],
    [...normalTexels(f, { depth: RELIEF_GRAINS.brick.depth })]);
});

// ---------- tiling ----------

test('the encoder wraps: rolling the field rolls the map, exactly', () => {
  // The whole point of wrapped neighbours, stated as the property it buys. A
  // one-sided difference at the edge would leave a hard line down every fourth
  // foot of every wall — and would break this, because the seam would move
  // when the field did.
  const size = 24, dx = 5, dy = 3;
  const h = (x, y) => 0.5 + 0.3 * Math.sin((2 * Math.PI * x) / size)
    + 0.15 * Math.cos((4 * Math.PI * y) / size);
  const a = normalTexels(field(size, h), { depth: 3 });
  const b = normalTexels(field(size, (x, y) => h(x - dx, y - dy)), { depth: 3 });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      assert.deepEqual(texel(b, size, (x + dx) % size, (y + dy) % size),
        texel(a, size, x, y), `texel ${x},${y}`);
    }
  }
});

test('every family tiles: no edge texel is a cliff its neighbours are not', () => {
  for (const grain of GRAIN_KEYS) {
    const { size, data } = heightField(grain, { size: 64 });
    // The step across the seam should be no worse than the largest step
    // anywhere inside the field. A field that does not wrap fails this by an
    // order of magnitude, not by a hair — hence the 5% of slack, which is
    // there for the families whose joints are narrower than a texel and so
    // land on or off a column depending on where the seam falls.
    let inside = 0, seam = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 1; x < size; x++) {
        inside = Math.max(inside, Math.abs(data[y * size + x] - data[y * size + x - 1]));
      }
      seam = Math.max(seam, Math.abs(data[y * size] - data[y * size + size - 1]));
    }
    assert.ok(seam <= inside * 1.05 + 1e-6,
      `${grain}: seam step ${seam} beats the worst inside step ${inside}`);
  }
});

// ---------- the families ----------

test('a height field is bounded, finite and the size it was asked for', () => {
  for (const grain of GRAIN_KEYS) {
    const f = heightField(grain, { size: 32 });
    assert.equal(f.size, 32, grain);
    assert.equal(f.data.length, 32 * 32, grain);
    for (const v of f.data) {
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `${grain} produced ${v}`);
    }
  }
});

test('a height field is deterministic, and the app never passes a seed', () => {
  for (const grain of GRAIN_KEYS) {
    assert.deepEqual([...heightField(grain, { size: 24 }).data],
      [...heightField(grain, { size: 24 }).data], grain);
  }
  // ...and a different seed is a different surface, or the seed is decoration.
  assert.notDeepEqual([...heightField('brick', { size: 24 }).data],
    [...heightField('brick', { size: 24, seed: 99 }).data]);
});

test('every coursed family actually has courses', () => {
  // A brick wall whose height field is flat would pass every test above and
  // render as a sheet of card. The joints are the point: a course line has to
  // be measurably lower than the middle of a brick.
  for (const [grain, courses] of [['brick', 18], ['block', 6], ['tile', 4], ['plank', 8]]) {
    const size = 128;
    const { data } = heightField(grain, { size });
    const rowMean = [];
    for (let y = 0; y < size; y++) {
      let s = 0;
      for (let x = 0; x < size; x++) s += data[y * size + x];
      rowMean.push(s / size);
    }
    // The joint rows sit at v = k / courses.
    const jointRow = Math.round((1 / courses) * size);
    const faceRow = Math.round((1.5 / courses) * size);
    assert.ok(rowMean[jointRow] < rowMean[faceRow] - 0.05,
      `${grain}: joint row ${rowMean[jointRow]} is not below face row ${rowMean[faceRow]}`);
  }
});

test('ribbed metal is a fold, not a bump — its seam is asymmetric', () => {
  // The one family that must not be symmetric about its own ridge: standing
  // seam catches the sun on one flank. A symmetric profile would average the
  // two flanks' normals to neutral over a rib.
  const size = 96;
  const bytes = normalTexels(heightField('rib', { size }), {});
  let up = 0, down = 0;
  for (let x = 0; x < size; x++) {
    const r = texel(bytes, size, x, size / 2)[0];
    if (r > 128) up++; else if (r < 128) down++;
  }
  assert.ok(up > 0 && down > 0, 'a fold has both a rising and a falling flank');
  assert.notEqual(up, down, 'the two flanks are not the same width');
});

test('carpet and stucco are texture, not architecture', () => {
  // Fine grains have no feature bigger than a few texels: their row means are
  // all much the same, which is what separates "a tooth" from "a joint".
  for (const grain of ['fiber', 'speck']) {
    const size = 64;
    const { data } = heightField(grain, { size });
    const means = [];
    for (let y = 0; y < size; y++) {
      let s = 0;
      for (let x = 0; x < size; x++) s += data[y * size + x];
      means.push(s / size);
    }
    const spread = Math.max(...means) - Math.min(...means);
    assert.ok(spread < 0.16, `${grain} row means spread by ${spread}`);
  }
});

test('an unknown grain gets a surface, not a hole', () => {
  // render.js has no branch for "this material has no relief", on purpose.
  const f = heightField('naugahyde');
  assert.equal(f.grain, 'speck');
  assert.equal(f.size, RELIEF_SIZE);
  assert.equal(hasRelief('naugahyde'), false);
  assert.equal(hasRelief('brick'), true);
  assert.equal(hasRelief(null), false);
});

// ---------- the drift alarm ----------

test('every grain any material table names has a relief here', () => {
  // The failure this catches: somebody adds a flooring product with a new
  // grain and it renders dead flat because this file never met it.
  const grains = new Set();
  for (const row of FLOOR_FINISHES) grains.add(row.grain);
  for (const row of FACADE_MATERIALS) grains.add(row.grain);
  for (const row of SITE_SURFACES) grains.add(row.grain);
  grains.add(ROOF_MEMBRANE.grain);
  grains.add(ROOF_SHINGLE.grain);
  for (const g of grains) {
    assert.ok(hasRelief(g), `grain "${g}" has no entry in RELIEF_GRAINS`);
  }
});

test('every family declares a depth, and none of them is flat', () => {
  for (const key of GRAIN_KEYS) {
    const row = RELIEF_GRAINS[key];
    assert.ok(row.depth > 0, `${key} has no depth`);
    assert.ok(Number.isInteger(row.seed), `${key} has no seed`);
  }
  // Masonry is the deepest thing on a school, and paint the shallowest.
  assert.ok(RELIEF_GRAINS.block.depth > RELIEF_GRAINS.brick.depth);
  assert.ok(RELIEF_GRAINS.paint.depth < RELIEF_GRAINS.fiber.depth);
});

// ---------- what render.js actually calls ----------

test('reliefFor hands back bytes, a size and the depth it used', () => {
  const r = reliefFor('block', { size: 32 });
  assert.equal(r.grain, 'block');
  assert.equal(r.size, 32);
  assert.equal(r.depth, RELIEF_GRAINS.block.depth);
  assert.equal(r.texels.length, 32 * 32 * 4);
  assert.ok(r.texels instanceof Uint8ClampedArray);
  // Every alpha byte opaque: a DataTexture with a zero alpha row is a normal
  // map with a hole in it.
  for (let i = 3; i < r.texels.length; i += 4) assert.equal(r.texels[i], 255);
});

test('reliefFor never returns null, whatever it is handed', () => {
  for (const grain of [undefined, null, '', 'marzipan', 42]) {
    const r = reliefFor(grain, { size: 16 });
    assert.equal(r.grain, 'speck');
    assert.equal(r.texels.length, 16 * 16 * 4);
  }
});

test('a full-size relief is the size the app builds at boot', () => {
  const r = reliefFor('brick');
  assert.equal(r.size, RELIEF_SIZE);
  assert.equal(r.texels.length, RELIEF_SIZE * RELIEF_SIZE * 4);
});
