// What a cell's findings say, in words: each as "Problem: …", the worst
// first, one after another. The Groups grid and the Teachers and Rooms tables
// all say it through here, so a cell reads the same in all three.

import { SEVERITY_WORDS } from '../common.js';

export const SEVERITIES = ['problem', 'warning', 'note'];

// The same findings, worst first; among equals, in the order they came. The
// checks hand their findings over worst first already, so on a cell of the
// Groups grid this changes nothing today; it is here for a cell that gathers
// the findings of several groups, and so that the order is this file's to say.
export function worstFirst(findings) {
  return findings.slice().sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
}

export function findingWords(findings) {
  return worstFirst(findings)
    .map((finding) => SEVERITY_WORDS[finding.severity].one.replace(/^./, (first) => first.toUpperCase()) + ': ' + finding.text)
    .join(' ');
}
