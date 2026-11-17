// Tiny test runner (ARCHITECTURE 7 intro). Plain Node, no dependency.
// test(name, fn) runs fn (sync or async) in order; failures print one line.
// done() prints "N passed, M failed" and sets the exit code on any failure.
import { isDeepStrictEqual, inspect } from 'node:util';

let passed = 0, failed = 0;
let chain = Promise.resolve();

export function test(name, fn) {
  chain = chain.then(async () => {
    try { await fn(); passed++; }
    catch (e) { failed++; console.log(`FAIL ${name}: ${e?.message ?? e}`); }
  });
  return chain;
}

export function eq(actual, expected, msg = '') {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`${msg ? msg + ': ' : ''}expected ${inspect(expected, { depth: 4 })}, got ${inspect(actual, { depth: 4 })}`);
  }
}

export function ok(cond, msg = 'expected a truthy value') {
  if (!cond) throw new Error(msg);
}

export function throws(fn, pattern) {
  let threw = false, err;
  try { fn(); } catch (e) { threw = true; err = e; }
  if (!threw) throw new Error('expected a throw');
  if (pattern instanceof RegExp && !pattern.test(String(err?.message ?? err))) {
    throw new Error(`threw "${err?.message}", which does not match ${pattern}`);
  }
}

export async function done() {
  await chain;
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}
