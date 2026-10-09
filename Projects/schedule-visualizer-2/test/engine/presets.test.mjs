// The group colour presets exist twice: engine/schema.js hands the next one to
// a new group (the engine imports nothing outside engine/), and ui/colour.js
// is what the interface and tokens.css are checked against. This file holds
// the two together, and the load bands with them.
//
//   node test/engine/presets.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { GROUP_COLOUR_PRESETS, LOAD_BAND_COLOURS, nextGroupColour, isHexColour } from '../../engine/schema.js';
import { GROUP_PRESETS, LOAD_BANDS, presetFor } from '../../ui/colour.js';

test('the first ten presets are the same ten, in the same order', () => {
  assert.deepEqual(GROUP_COLOUR_PRESETS.slice(0, GROUP_PRESETS.length), Array.from(GROUP_PRESETS));
});

test('every preset the engine hands out is the one the interface has at that place', () => {
  const differing = [];
  GROUP_COLOUR_PRESETS.forEach((colour, index) => {
    if (colour !== presetFor(index)) differing.push('preset ' + (index + 1) + ': engine ' + colour + ', interface ' + presetFor(index));
  });
  assert.deepEqual(differing, []);
});

test('the engine has 19 presets and the interface 20: the one extra is the darker grey', () => {
  // A grey has no hue to turn, so the engine leaves its second copy out and
  // ui/colour.js makes it darker instead. If either side changes its mind,
  // this is the case that says so.
  assert.equal(GROUP_COLOUR_PRESETS.length, 19);
  assert.equal(presetFor(19), '#666666');
  assert.equal(GROUP_COLOUR_PRESETS.includes(presetFor(19)), false);
  assert.equal(presetFor(20), GROUP_COLOUR_PRESETS[0], 'after twenty the interface starts again');
});

test('the presets are distinct, lower-case hex colours', () => {
  assert.equal(new Set(GROUP_COLOUR_PRESETS).size, GROUP_COLOUR_PRESETS.length);
  for (const colour of GROUP_COLOUR_PRESETS) {
    assert.ok(isHexColour(colour), colour + ' is not #rrggbb');
    assert.equal(colour, colour.toLowerCase());
  }
});

test('a new group gets the interface\'s presets in order', () => {
  const groups = [];
  for (let index = 0; index < GROUP_COLOUR_PRESETS.length; index += 1) {
    const colour = nextGroupColour(groups);
    assert.equal(colour, presetFor(index), 'group ' + (index + 1));
    groups.push({ colour });
  }
});

test('the load bands are the same five, quiet to busy', () => {
  assert.deepEqual(LOAD_BAND_COLOURS, Array.from(LOAD_BANDS));
});
