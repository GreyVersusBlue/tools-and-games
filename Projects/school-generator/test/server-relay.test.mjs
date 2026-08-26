// The relay's rooms: who is with whom, and who a frame goes to.
//
// Four lines of contract in wire.js, three of which are here. Every one of
// them is asserted against the ids rather than against sockets, which is the
// whole reason the module is split this way.

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeRooms, roomOf, validRoom, MAX_PER_ROOM } from '../server/relay.js';
import { relayURL, makeRoom, validRoom as clientValidRoom } from '../js/wire.js';

test('the relay and the client agree about what a room id is', () => {
  // Restated on both sides rather than shared — a relay must not depend on
  // the tool it relays for — so the day they disagree is a failing test here
  // rather than a session that will not join.
  for (let i = 0; i < 50; i++) {
    const room = makeRoom();
    assert.equal(validRoom(room), true, room);
    assert.equal(clientValidRoom(room), validRoom(room), room);
  }
  for (const bad of ['', 'ab', 'x'.repeat(33), 'HELLO', 'a b', 'a-b', null, 7]) {
    assert.equal(validRoom(bad), false, String(bad));
  }
});

test('the room comes off the query string wire.js puts it on', () => {
  // The client builds the URL; this reads it. Same string, both directions.
  assert.equal(roomOf(relayURL('ws://relay.example', 'abcd1234')), 'abcd1234');
  assert.equal(roomOf(relayURL('ws://relay.example/some/path', 'zzz9')), 'zzz9');
  assert.equal(roomOf('/relay?other=1&room=mnp4qrst'), 'mnp4qrst');
  // Anything that is not a room is no room at all, rather than a room called
  // something odd.
  assert.equal(roomOf('/relay'), '');
  assert.equal(roomOf('/relay?room='), '');
  assert.equal(roomOf('/relay?room=NOPE'), '');
  assert.equal(roomOf('/relay?room=%E0%A4%A'), '', 'a broken escape is not a room');
  assert.equal(roomOf(null), '');
});

test('a frame goes to everybody in the room except the sender', () => {
  const rooms = makeRooms();
  assert.equal(rooms.join('abcd', 'a').ok, true);
  assert.equal(rooms.join('abcd', 'b').ok, true);
  assert.equal(rooms.join('efgh', 'c').ok, true);
  assert.deepEqual(rooms.peers('a'), ['b']);
  assert.deepEqual(rooms.peers('b'), ['a']);
  // Another room is another session. This is the entire isolation model.
  assert.deepEqual(rooms.peers('c'), []);
  assert.deepEqual(rooms.peers('nobody'), []);
  assert.equal(rooms.count('abcd'), 2);
  assert.equal(rooms.roomOf('c'), 'efgh');
});

test('leaving is forgetting, and an empty room stops existing', () => {
  const rooms = makeRooms();
  rooms.join('abcd', 'a');
  rooms.join('abcd', 'b');
  assert.equal(rooms.leave('a'), true);
  assert.deepEqual(rooms.peers('b'), []);
  assert.equal(rooms.rooms, 1);
  assert.equal(rooms.leave('b'), true);
  // "It holds nothing after the last of them leaves" — including an empty Set
  // with a room's name on it.
  assert.equal(rooms.rooms, 0);
  assert.equal(rooms.members, 0);
  assert.equal(rooms.leave('a'), false, 'leaving twice is nothing');
});

test('a refusal is a sentence, because it goes out in a close frame', () => {
  const rooms = makeRooms({ maxPerRoom: 2, maxRooms: 2 });
  assert.match(rooms.join('NOPE', 'a').why, /not a room/);
  rooms.join('abcd', 'a');
  assert.match(rooms.join('efgh', 'a').why, /already in a room/);
  rooms.join('abcd', 'b');
  assert.match(rooms.join('abcd', 'c').why, /2 people in it/);
  rooms.join('efgh', 'd');
  assert.match(rooms.join('ijkl', 'e').why, /relay is full/);
  // A refused join left nothing behind.
  assert.equal(rooms.roomOf('c'), '');
  assert.equal(rooms.roomOf('e'), '');
});

test('the stats a relay will say out loud have no ids in them', () => {
  const rooms = makeRooms();
  rooms.join('abcd', 'a-secret-socket-id');
  const s = rooms.stats();
  assert.deepEqual(Object.keys(s).sort(), ['maxPerRoom', 'maxRooms', 'members', 'rooms']);
  assert.equal(s.rooms, 1);
  assert.equal(s.members, 1);
  assert.equal(s.maxPerRoom, MAX_PER_ROOM);
  assert.equal(JSON.stringify(s).includes('secret'), false);
});
