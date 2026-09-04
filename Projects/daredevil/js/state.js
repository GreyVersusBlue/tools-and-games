// state.js — the tiny leaf module both scenes.js and engine.js import.
//
// Split out of daredevil_r4.html's inline module script in the round-2
// restructure (see HISTORY.md, round 2). scenes.js's
// SCENES object interpolates GS.town / GS.name and calls N()/D()/C() at
// module-evaluation time — not inside functions — so those bindings have to
// live somewhere with zero dependency on SCENES itself. If state.js instead
// lived inside engine.js, engine.js -> scenes.js -> engine.js would be a
// circular import, and whichever module's turn it was to evaluate second
// would read GS out of the temporal dead zone. This file is the fix: a leaf
// both scenes.js and engine.js depend on, depending on neither.

import { freshState } from './save.js';

/* ================================================================
   GAME STATE
   ================================================================ */
// The starting shape lives in save.js so the save format and the game cannot
// drift apart. `scene` and `screen` are part of that shape: they are what a
// resumed run needs and they are kept current by persist().
export const GS = Object.assign(freshState(), {
  afterMinigameHandler: null,   // runtime only; never saved
  minigameResult: null,         // runtime only; never saved
});

export const STAT_LABELS = { nerve:'Nerve', precision:'Precision', showmanship:'Showmanship', condition:'Condition', hustle:'Hustle' };

/* ================================================================
   SCENE DATABASE
   ================================================================ */
// Each scene: { art, artLabel, lines[], choices? }
// line: { speaker, text } — speaker: null=narration, 'DUKE','EARL','CAL' etc
// choices: [ { text, subtext?, effects:{}, goto } ]
// effects: { stat deltas, rel changes, flags }

export function N(text){ return { speaker:null, text } }
export function D(text){ return { speaker:'DUKE', text } }
export function C(char,text){ return { speaker:char, text } }
export function NF(fn){ return { speaker:null, _fn:fn } } // dynamic narration

export function makeName(){ return GS.name; }
export function makeTown(){ return GS.town; }
