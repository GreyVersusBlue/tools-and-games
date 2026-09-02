// fragment.test.mjs — the address bar's three keys and the one loop that
// reads them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAGMENT_KEYS, fragmentValue, wantsCompany } from '../js/fragment.js';
import { SHARE_KEY, readShareFragment, shareFragment } from '../js/share.js';
import { SESSION_KEY, readSessionFragment, sessionFragment } from '../js/wire.js';
import { CLOUD_KEY, readCloudFragment, cloudFragment } from '../js/cloud.js';

test('the three modules read the keys this file names', () => {
  assert.equal(SHARE_KEY, FRAGMENT_KEYS.share);
  assert.equal(SESSION_KEY, FRAGMENT_KEYS.session);
  assert.equal(CLOUD_KEY, FRAGMENT_KEYS.cloud);
  assert.equal(new Set(Object.values(FRAGMENT_KEYS)).size, 3, 'three different keys');
});

test('fragmentValue finds a key, trims it, and answers null for the rest', () => {
  assert.equal(fragmentValue('#c=abcd', 'c'), 'abcd');
  assert.equal(fragmentValue('c=abcd', 'c'), 'abcd', 'with or without the #');
  assert.equal(fragmentValue('#x=1&c= abcd &y=2', 'c'), 'abcd');
  assert.equal(fragmentValue('#c=one&c=two', 'c'), 'one', 'the first occurrence wins');
  assert.equal(fragmentValue('#c=', 'c'), null, 'a key with nothing after it');
  assert.equal(fragmentValue('#cc=abcd', 'c'), null, 'a key that merely starts the same');
  assert.equal(fragmentValue('#abcd', 'c'), null, 'a fragment with no key at all');
  assert.equal(fragmentValue('', 'c'), null);
  assert.equal(fragmentValue(null, 'c'), null);
  assert.equal(fragmentValue('#c=abcd', ''), null);
  assert.equal(fragmentValue('#c=abcd', undefined), null);
});

test('wantsCompany is true for a session or a store link and false otherwise', () => {
  assert.equal(wantsCompany(sessionFragment('abcdef')), true);
  assert.equal(wantsCompany(sessionFragment('abcdef', 'wss://relay.example')), true);
  assert.equal(wantsCompany(cloudFragment('k7f3m2p9q4')), true);
  assert.equal(wantsCompany(shareFragment('AAAA')), false, 'a design in the link needs nobody');
  assert.equal(wantsCompany(''), false);
  assert.equal(wantsCompany('#'), false);
  assert.equal(wantsCompany('#c='), false, 'an empty session key is not a session');
  assert.equal(wantsCompany('#anchor'), false);
});

test('the three readers still read what they always did', () => {
  assert.equal(readShareFragment(shareFragment('AAAA')), 'AAAA');
  assert.equal(readShareFragment('#s='), null);
  assert.equal(readShareFragment('#c=abcdef'), null);
  assert.deepEqual(readSessionFragment(sessionFragment('abcdef')), { room: 'abcdef', relay: '' });
  assert.deepEqual(readSessionFragment(sessionFragment('abcdef', 'wss://r.example/x')),
    { room: 'abcdef', relay: 'wss://r.example/x' });
  assert.equal(readSessionFragment('#c=NOT VALID'), null);
  assert.equal(readSessionFragment('#s=AAAA'), null);
  const cloud = readCloudFragment(cloudFragment('k7f3m2p9q4'));
  assert.ok(cloud && cloud.id === 'k7f3m2p9q4');
  assert.equal(readCloudFragment('#d='), null);
});
