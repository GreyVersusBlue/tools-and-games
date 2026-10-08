// The one search: teachers, groups and rooms together, by name, room number
// or subject. No DOM here; search.js draws what this finds.
//
// Every word typed has to be found somewhere in a thing's own words. Case and
// accents do not matter ("dufrene" finds "Mme. Dufrêne"). Within a kind, a
// name that starts with what was typed comes first, then a word that starts
// with it, then the rest; ties are in name order, numbers counted as numbers.

export const FIND_LIMIT = 40;

export function foldText(text) {
  return String(text === null || text === undefined ? '' : text).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function rank(name, words, query) {
  const folded = foldText(name);
  if (folded === query) return 0;
  if (folded.startsWith(query)) return 1;
  if (words.every((word) => folded.split(/[^\p{L}\p{N}]+/u).some((part) => part.startsWith(word)))) return 2;
  if (words.every((word) => folded.includes(word))) return 3;
  return 4;
}

function compareNames(a, b) {
  const left = foldText(a);
  const right = foldText(b);
  const pieces = /(\d+)|(\D+)/g;
  const one = left.match(pieces) || [];
  const two = right.match(pieces) || [];
  for (let i = 0; i < Math.min(one.length, two.length); i += 1) {
    if (one[i] === two[i]) continue;
    const bothNumbers = /^\d/.test(one[i]) && /^\d/.test(two[i]);
    if (bothNumbers && Number(one[i]) !== Number(two[i])) return Number(one[i]) - Number(two[i]);
    return one[i] < two[i] ? -1 : 1;
  }
  return one.length - two.length;
}

function pick(items, words, query) {
  const hits = [];
  for (const item of items) {
    if (!words.every((word) => item.words.includes(word))) continue;
    hits.push({ id: item.id, name: item.name, detail: item.detail, rank: rank(item.name, words, query) });
  }
  hits.sort((a, b) => a.rank - b.rank || compareNames(a.name, b.name));
  return { total: hits.length, items: hits.slice(0, FIND_LIMIT).map((hit) => ({ id: hit.id, name: hit.name, detail: hit.detail })) };
}

// Everything that can be found, with the words each is found by. Made once
// per school.
export function searchIndex(school) {
  const subjectWords = (subject) => (subject ? subject.name + ' ' + subject.code : '');
  const teachers = school.teachers.map((teacher) => {
    const subject = school.subject(teacher.subjectId);
    const rooms = (teacher.roomIds || []).map((id) => school.room(id)).filter(Boolean);
    const detail = [];
    if (subject) detail.push(subject.name);
    if (rooms.length > 0) detail.push(rooms.map((room) => school.roomName(room, true)).join(', '));
    return {
      id: teacher.id,
      name: teacher.name,
      detail: detail.join(' · '),
      words: foldText(teacher.name + ' ' + subjectWords(subject) + ' ' + rooms.map((room) => room.number + ' ' + school.roomName(room)).join(' ')),
    };
  });
  const groups = school.groups.map((group) => ({
    id: group.id,
    name: group.name,
    detail: group.grade ? 'Grade ' + group.grade : '',
    words: foldText(group.name + ' ' + (group.grade ? 'grade ' + group.grade : '')),
  }));
  const rooms = school.rooms.map((room) => {
    const subject = school.subject(room.subjectId);
    const floor = school.floorOfRoom(room.id);
    const names = (room.teacherIds || []).map((id) => school.teacher(id)).filter(Boolean).map((teacher) => teacher.name);
    const detail = [];
    if (floor) detail.push(floor.name);
    if (names.length > 0) detail.push(names.join(', '));
    if (subject) detail.push(subject.name);
    return {
      id: room.id,
      name: school.roomName(room, true),
      detail: detail.join(' · '),
      words: foldText(room.number + ' ' + school.roomName(room) + ' ' + (room.wing || '') + ' ' + names.join(' ') + ' ' + subjectWords(subject) + ' ' + (floor ? floor.name : '')),
    };
  });
  return { teachers, groups, rooms };
}

// searchSchool(index, 'hall 101') → { query, total, teachers, groups, rooms },
// each kind { total, items: [{ id, name, detail }] }. Nothing typed finds
// nothing.
export function searchSchool(index, text) {
  const query = foldText(text);
  const words = query === '' ? [] : query.split(' ');
  const none = { total: 0, items: [] };
  if (words.length === 0) return { query, total: 0, teachers: none, groups: none, rooms: none };
  const teachers = pick(index.teachers, words, query);
  const groups = pick(index.groups, words, query);
  const rooms = pick(index.rooms, words, query);
  return { query, total: teachers.total + groups.total + rooms.total, teachers, groups, rooms };
}
