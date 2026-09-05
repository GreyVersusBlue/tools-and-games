// text.js — the two string helpers both the page and js/combat.js need.
//
// `esc` exists because combat events carry HTML: every log line the engine
// emits interpolates a combatant name, and a monster named `<script>` in a
// third-party pack must not become one. The engine builds those strings, so it
// needs `esc`, and the page needs the same one for its sheets and modals.
// Two copies of an escaper is how they drift, so there is one.

export function esc(s){ return String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
export function cap(s){ return s? s.charAt(0).toUpperCase()+s.slice(1):""; }
