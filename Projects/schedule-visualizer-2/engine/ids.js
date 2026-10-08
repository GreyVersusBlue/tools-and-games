// Ids. Every id in a project is 10 characters of [a-z0-9]: one prefix letter
// that says what the thing is, then nine from the random source. The random
// source is passed in, so a test or a recorded baseline gets the same ids
// every run; the page passes its own.

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const ID_LENGTH = 10;

export const ID_PREFIXES = {
  floor: 'f',
  room: 'r',
  other: 'o',
  teacher: 't',
  group: 'g',
  subject: 's',
  dayType: 'd',
  connection: 'c',
  exit: 'x',
  corridor: 'k',
  zone: 'z',
  snapshot: 'n',
  project: 'p',
  image: 'i',
};

const ID_PATTERN = /^[a-z][a-z0-9]{9}$/;

export function isId(value, prefix) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) return false;
  return prefix === undefined || value[0] === prefix;
}

// A small seedable generator (mulberry32) returning numbers in [0, 1).
// The seed is a number or any string.
export function seededRandom(seed) {
  let state = 0;
  if (typeof seed === 'number') {
    state = seed >>> 0;
  } else {
    const text = String(seed);
    state = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      state ^= text.charCodeAt(i);
      state = Math.imul(state, 16777619);
    }
    state >>>= 0;
  }
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// createIds(random) returns ids(prefix). It never hands out the same id twice,
// and never one that was passed to ids.reserve().
export function createIds(random) {
  if (typeof random !== 'function') {
    throw new TypeError('createIds needs a random function returning numbers from 0 up to 1.');
  }
  const taken = new Set();
  function ids(prefix) {
    if (typeof prefix !== 'string' || !/^[a-z]$/.test(prefix)) {
      throw new TypeError('An id prefix is one lowercase letter.');
    }
    for (;;) {
      let id = prefix;
      for (let i = 1; i < ID_LENGTH; i += 1) {
        const n = Math.floor(random() * ALPHABET.length);
        id += ALPHABET[Math.min(ALPHABET.length - 1, Math.max(0, n))];
      }
      if (!taken.has(id)) {
        taken.add(id);
        return id;
      }
    }
  }
  ids.reserve = function reserve(list) {
    for (const id of list) if (typeof id === 'string') taken.add(id);
  };
  return ids;
}

// Every id a project object already carries, for ids.reserve().
export function collectIds(project) {
  const found = [];
  const push = (thing) => {
    if (thing && typeof thing.id === 'string') found.push(thing.id);
  };
  const each = (list, fn) => {
    if (Array.isArray(list)) for (const item of list) fn(item);
  };
  if (!project || typeof project !== 'object') return found;
  push(project);
  const building = project.building;
  if (building && typeof building === 'object') {
    each(building.floors, (floor) => {
      push(floor);
      if (!floor || typeof floor !== 'object') return;
      each(floor.spaces, push);
      each(floor.corridors, push);
      each(floor.exits, push);
      if (floor.image && typeof floor.image.imageId === 'string') found.push(floor.image.imageId);
    });
    each(building.connections, push);
    each(building.zones, push);
  }
  each(project.subjects, push);
  each(project.teachers, push);
  each(project.groups, push);
  each(project.dayTypes, push);
  return found;
}
