// The front door's three finished schools. Run `node --test` from
// Projects/school-generator.
//
// The properties worth holding here are the ones that make a card a *card*
// rather than a claim: the stock decodes to a real design, that design is the
// one the recipe describes, the facts under the sentence were counted off it,
// the name on it is the name the PA says inside it, and a thumbnail is the
// plan rather than a squashed one. The expensive half — rebuilding all three
// schools from their briefs — is the only honest way to prove the committed
// bytes are still what the generator makes, so it is here rather than nowhere.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CARDS, CARD_IDS, THUMB_SPAN, THUMB_FALLBACK,
  cardById, cardTitle, planThumb, thumbPaths, normalizeTone,
  cardFacts, factLine, stockEntry, validStock, galleryCards,
} from '../js/gallery.js';
import { STOCK } from '../js/gallerystock.js';
import { buildSchool } from '../js/generate.js';
import { decodeShare, encodeShare } from '../js/share.js';
import { serialize, deserialize } from '../js/save-load.js';
import { paScript } from '../js/murmur.js';
import { normalizeLife } from '../js/agents.js';
import { createState } from '../js/grid.js';
import { normalizeRoof } from '../js/roof.js';
import { boxRoom, slabOn } from './build.mjs';

// Built once and shared: three generated schools is the slowest thing in the
// whole suite, and every test below wants the same three.
const BUILT = new Map(CARDS.map((c) => [c.id, buildSchool({ ...c.brief })]));

// ---------- the cards themselves ----------

test('three cards, distinct, each with a recipe that names a whole brief', () => {
  assert.equal(CARDS.length, 3);
  assert.equal(new Set(CARD_IDS).size, 3);
  for (const c of CARDS) {
    assert.ok(c.line.length > 40, `${c.id} has no sentence`);
    for (const key of ['students', 'band', 'storeys', 'scheme', 'seed']) {
      assert.ok(c.brief[key] !== undefined, `${c.id}'s recipe is missing ${key}`);
    }
    assert.equal(cardById(c.id), c);
  }
  assert.equal(cardById('nope'), null);
  // Three schools with one name between them is a gallery of one.
  assert.equal(new Set(CARDS.map(cardTitle)).size, 3);
});

test('the name on the card is the name the PA says inside it', () => {
  for (const card of CARDS) {
    const state = BUILT.get(card.id);
    // The chain: the recipe's seed -> buildSchool's `state.life.seed` ->
    // normalizeLife -> paScript. Break any link and the front door starts
    // lying about the building behind it.
    assert.equal(normalizeLife(state.life).seed, card.brief.seed);
    assert.equal(cardTitle(card), paScript(normalizeLife(state.life).seed).school);
  }
});

// ---------- the stock ----------

test('every card has stock, and every payload decodes to the design it promises', async () => {
  for (const card of CARDS) {
    const entry = STOCK[card.id];
    assert.ok(validStock(entry), `${card.id} has no usable stock`);
    const design = deserialize(await decodeShare(entry.payload));
    assert.deepEqual(cardFacts(design), entry.facts,
      `${card.id}'s facts are not the design's facts`);
    assert.equal(design.floors.length, card.brief.storeys);
    assert.ok(design.props.length > 0, `${card.id} arrived unfurnished`);
    // A card is a *finished* school: a site under it, a roof over it, and a
    // crowd the walk can populate the moment it opens. The roof is read
    // through `normalizeRoof` rather than off the key, because a design whose
    // roof is the default one writes no roof key — the same byte-free bargain
    // the weather struck.
    assert.ok(design.site, `${card.id} has no site`);
    assert.deepEqual(normalizeRoof(design.roof), normalizeRoof(BUILT.get(card.id).roof),
      `${card.id} lost its roof on the way through a link`);
    assert.equal(normalizeLife(design.life).seed, card.brief.seed);
  }
});

test('the committed stock is still what the recipe makes', async () => {
  for (const card of CARDS) {
    const fresh = stockEntry(BUILT.get(card.id));
    assert.deepEqual(STOCK[card.id].facts, fresh.facts,
      `${card.id} has drifted from its recipe — rerun tools/make-gallery.mjs`);
    assert.deepEqual(STOCK[card.id].thumb, fresh.thumb,
      `${card.id}'s thumbnail has drifted — rerun tools/make-gallery.mjs`);
    // The payload is not compared byte for byte: two deflates of the same
    // bytes are allowed to differ. What has to hold is that it carries the
    // same design, which the round trip below says in the only terms that
    // matter.
    const again = await decodeShare(await encodeShare(
      serialize(BUILT.get(card.id), { omitOverlay: true, omitModels: true })));
    assert.deepEqual(cardFacts(deserialize(again)), fresh.facts);
  }
});

test('a payload is a share link, not a second format', async () => {
  // Whatever a card is, it is the same string the Share dialog produces —
  // which is what makes "open a card" and "open somebody's link" one code
  // path rather than two.
  const entry = STOCK[CARDS[0].id];
  const json = await decodeShare(entry.payload);
  assert.equal(typeof json, 'string');
  assert.equal(JSON.parse(json).version, 12);
  await assert.rejects(() => decodeShare('not-a-payload'), /not a shared design/);
});

// ---------- the thumbnail ----------

test('a thumbnail is the plan, at the plan’s own proportions', () => {
  const state = BUILT.get('elementary');
  const t = planThumb(state, 0);
  assert.ok(t.rooms.length > 5);
  // One scale for both axes: the longer side fills the span and the shorter
  // one does not, so a long bar school reads long.
  assert.equal(Math.max(t.w, t.h), THUMB_SPAN);
  assert.ok(t.h < t.w, 'a bar school should be wider than it is deep');
  for (const room of t.rooms) {
    assert.ok(room.p.length >= 1);
    for (const ring of room.p) {
      assert.ok(ring.length >= 3, 'a ring with fewer than three corners is not a ring');
      for (const [x, y] of ring) {
        assert.ok(Number.isInteger(x) && Number.isInteger(y), 'coordinates are integers');
        assert.ok(x >= 0 && x <= THUMB_SPAN && y >= 0 && y <= THUMB_SPAN);
      }
    }
    assert.match(room.c, /^#[0-9a-f]{6}$/);
  }
});

test('a room with a hole in it keeps the hole', () => {
  // A ring around a void — an atrium, a light court, the mezzanine Phase 4
  // cut. Filling it in would make the thumbnail a different building, so the
  // inner ring rides in the same path and the caller sets the fill rule.
  const state = createState(30, 30);
  slabOn(state, 0, [2, 2, 22, 22], [9, 9, 15, 15, false]);
  const t = planThumb(state, 0);
  assert.equal(t.rooms.length, 1);
  assert.equal(t.rooms[0].p.length, 2, 'the hole was filled in');
  const { paths } = thumbPaths(t, 100);
  // Two subpaths, one M each: the even-odd rule does the rest.
  assert.equal(paths[0].d.match(/M/g).length, 2);
});

test('an empty design thumbnails to nothing rather than to NaN', () => {
  const t = planThumb(createState(), 0);
  assert.deepEqual(t, { w: 0, h: 0, rooms: [] });
  const drawn = thumbPaths(t, 200);
  assert.deepEqual(drawn.paths, []);
  assert.equal(drawn.size, 200);
  // And the same for the shapes a caller might hand it by accident.
  assert.deepEqual(planThumb(null), { w: 0, h: 0, rooms: [] });
  assert.deepEqual(planThumb({}, 4), { w: 0, h: 0, rooms: [] });
  assert.deepEqual(thumbPaths(null).paths, []);
});

test('a thumbnail draws inside its box and is centred in it', () => {
  const { paths, size } = thumbPaths(STOCK.elementary.thumb, 240);
  assert.equal(size, 240);
  assert.equal(paths.length, STOCK.elementary.thumb.rooms.length);
  let lo = Infinity, hi = -Infinity, loY = Infinity, hiY = -Infinity;
  for (const p of paths) {
    assert.match(p.d, /^M[-\d. LMZ]+Z$/);
    assert.match(p.fill, /^#[0-9a-f]{6}$/);
    for (const pair of p.d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)) {
      lo = Math.min(lo, +pair[1]); hi = Math.max(hi, +pair[1]);
      loY = Math.min(loY, +pair[2]); hiY = Math.max(hiY, +pair[2]);
    }
  }
  assert.ok(lo >= -0.01 && hi <= 240.01, `x ran ${lo}..${hi}, outside the box`);
  assert.ok(loY >= -0.01 && hiY <= 240.01, `y ran ${loY}..${hiY}, outside the box`);
  // Centred: the slack on one side is the slack on the other.
  assert.ok(Math.abs(lo - (240 - hi)) < 0.5);
  assert.ok(Math.abs(loY - (240 - hiY)) < 0.5);
});

test('a colour that is not one becomes the neutral rather than an exception', () => {
  assert.equal(normalizeTone('#AABBCC'), '#aabbcc');
  assert.equal(normalizeTone('rebeccapurple'), THUMB_FALLBACK);
  assert.equal(normalizeTone(null), THUMB_FALLBACK);
  assert.equal(normalizeTone('#abc'), THUMB_FALLBACK);
  const drawn = thumbPaths({ w: 10, h: 10, rooms: [{ c: 'nonsense', p: [[[0, 0], [10, 0], [10, 10]]] }] });
  assert.equal(drawn.paths[0].fill, THUMB_FALLBACK);
});

// ---------- the facts ----------

test('the facts are counted, and the line reads like a person wrote it', () => {
  const state = createState(30, 30);
  boxRoom(state, 0, 0, 0, 5, 5, { name: 'One' });
  boxRoom(state, 0, 6, 0, 11, 5, { name: 'Two' });
  const facts = cardFacts(state);
  assert.equal(facts.rooms, 2);
  assert.equal(facts.storeys, 1);
  assert.ok(facts.area > 0);
  assert.match(factLine(facts), /^2 rooms on one storey · [\d,]+ sq ft$/);
  assert.match(factLine({ rooms: 96, storeys: 2, area: 136000 }),
    /^96 rooms on two storeys · 136,000 sq ft$/);
  // Nothing at all is still a sentence, not an exception.
  assert.equal(typeof factLine(null), 'string');
  assert.deepEqual(cardFacts(null), { storeys: 0, rooms: 0, area: 0 });
});

// ---------- what a build shows ----------

test('a card that cannot be shown is left out rather than rendered broken', () => {
  const good = galleryCards(STOCK);
  assert.equal(good.length, 3);
  assert.deepEqual(good.map((c) => c.id), CARD_IDS);
  for (const c of good) {
    assert.ok(c.title && c.line && c.payload && c.thumb);
    assert.equal(c.factLine, factLine(c.facts));
  }
  // Every way a stock file can be wrong ends at the same place: fewer cards.
  assert.equal(galleryCards({ ...STOCK, high: null }).length, 2);
  assert.equal(galleryCards({ ...STOCK, high: { ...STOCK.high, payload: '' } }).length, 2);
  assert.equal(galleryCards({ ...STOCK, high: { ...STOCK.high, facts: { rooms: 0 } } }).length, 2);
  assert.equal(galleryCards({ ...STOCK, high: { ...STOCK.high, thumb: { w: 0, h: 0, rooms: [] } } }).length, 2);
  assert.equal(galleryCards(null).length, 0);
  assert.equal(galleryCards({}).length, 0);
  assert.ok(!validStock(undefined));
});
