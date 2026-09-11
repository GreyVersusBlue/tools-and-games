// transcript.mjs — play Daredevil to an ending and write down what happened.
//
// Nothing in eight sessions of handoffs describes this game, so the first job
// was to find out what it is. This is how: a real browser, real clicks, and a
// log of every line of prose, every choice offered, every choice taken, and
// every scene id passed through.
//
//   node Projects/daredevil/test/transcript.mjs <run> [--headed]
//
// where <run> is a key in RUNS below. Output goes to
// Projects/daredevil/test/transcripts/<run>.md and the scene path is printed.
//
// This is exploration, not assertion. The suite that fails on regression is
// smoke.mjs; this is the thing that told us what to assert.
//
// Except with `--check`, which turns the nine committed transcripts from a
// convention into an assertion (Phase 8):
//
//   node Projects/daredevil/test/transcript.mjs clean --check
//
// The run is played the same way, and instead of overwriting
// transcripts/<run>.md it is compared against it. A difference prints where
// the two part, writes the fresh run to transcripts/<run>.actual.md and exits
// non-zero (#13). What it compares is NORMALISE()d first — see there for the
// one line that cannot be compared byte for byte and why.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, open, snapshot, pick, autopilot, wait } from './drive-daredevil.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* A run is a list of rules. At every decision the driver walks the list in
   order and clicks the first rule whose needle is on screen. `once: true`
   retires a rule after it fires, which is how a hub gets emptied card by card
   instead of clicking the same one forever. Anything not covered falls through
   to "take the first unlocked option", which is a legitimate way to play and
   keeps a run from stalling on a scene the plan never anticipated. */
const RUNS = {
  // Straight down the middle: brave choices, a clean stunt, Cal kept close.
  clean: {
    name: 'Duke Harlan', town: 'Buford County',
    stunt: 'good',
    rules: [
      { on: 'The irrigation ditch' },
      { on: 'Option A' },
    ],
  },
  // The other side of every fork it can reach, and a deliberate crash at the fair.
  rough: {
    name: 'Mack Teller', town: 'Cold Spring',
    stunt: 'crash',
    rules: [
      { on: 'The water tower' },
      { on: 'Option D' },
      { on: 'Option C' },
      { on: 'Option B' },
    ],
  },
  // Answers "Not interested" at the fair: rels.earl stays 'absent' for the
  // whole run (and, as a side effect, Ruthie is never established either,
  // since that's a different option on the same six-way choice). Targets the
  // same class of bug the Ruthie sweep found: prose that assumes Earl is
  // still in the picture when a plain run said otherwise.
  no_earl: {
    name: 'Ray Dockery', town: 'Split Oak',
    stunt: 'good',
    rules: [
      { on: 'Not interested' },
    ],
  },
  // The other way through the backer-less Milestone 2 (Phase 1). `no_earl`
  // above takes the first answer at every solo fork: Perkins dials, paper on
  // the bike, the slow page, then the bank again for the twelve hundred. This
  // one declines Perkins in Free Roam 1 so the solo entry has to go back to
  // him, then dials the promoters itself, walks out of the bank, books the car
  // show before it can pay for the cars, and self-funds the debt. Between the
  // two, every solo scene is read by a committed transcript.
  no_earl_solo: {
    name: 'Wade Corliss', town: 'Harlow Bend',
    stunt: 'good',
    rules: [
      { on: 'Not interested' },
      { on: "I'll pass for now" },
      { on: 'Give me the names' },
      { on: 'Forget the note' },
      { on: 'Book it' },
      { on: 'Self-fund' },
      // Increment 2: the second answer at the solo branch's two new forks —
      // Sandra's offer checked against the Friday card rather than a contract
      // clause, and the man from California asked for the paper first.
      { on: 'check something first' },
      { on: 'Send me the paper' },
      { on: 'Walk away quietly' },
    ],
  },
  // The solo branch's failure arms. Lands the fair — a crashed fair never
  // reaches the six-way answer to Earl, he sends word through Cal instead —
  // then crashes everything after it: down hard at the Speedway (Kessler's
  // envelope, Petersen's forty seconds), down on the Milestone 4 stunt, and
  // the recovery version of the California call. Third answer at both new
  // forks, and the disappearance at the end. `stunt` as a list is one policy
  // per stunt run in order, the last one repeating.
  no_earl_crash: {
    name: 'Curtis Vane', town: 'Ashby Fork',
    stunt: ['good', 'crash'],
    rules: [
      { on: 'Not interested' },
      { on: 'approval over the narrative' },
      { on: 'Kessler' },
      { on: 'Tommy' },
      { on: 'Book it' },
      { on: 'Say the other one' },
      { on: 'Disappear' },
    ],
  },
  // Turns the Young Wannabe down at the gas station, so wannabeMet never gets
  // set and rels.pete stays 'unknown' for the whole run — the "thread never
  // opened" case, not the "opened then walked away" case fr2_pete_soft covers.
  no_pete: {
    name: 'Ellis Boone', town: 'Cutter Ridge',
    stunt: 'good',
    rules: [
      { on: "isn't something I can teach" },
    ],
  },
  // Phase 4, and the same method rounds 2 and 3 used on Ruthie, Earl and Pete:
  // play a run the character is not in, grep the output for the name, and read
  // every mention that is not inside an N(()=>...). Tommy is the harder of the
  // two, because until this phase he could not leave: he was 'hanger_on' from
  // the first line to the ending screen on every run. This one never asks him
  // what he does, so the car-show answer is not on the Free Roam 2 board, and
  // then it measures his twelve people against a career.
  no_tommy: {
    name: 'Hollis Gray', town: 'Denton Flats',
    stunt: 'good',
    rules: [
      { on: 'Let him finish the flatbed story' },
      { on: "Twelve people isn't a career" },
    ],
  },
  // The other absence. Every run passes through `m1_rival_rumor` — Tommy
  // brings Danny up at the county fair — so declining there is the only way he
  // stays out, and it is the case the sweep is for: the name is said out loud
  // and then nobody arrives. `rels.danny` stays 'unknown' and the ending
  // roster has to leave him off rather than print him at '—'. `rough` takes
  // the same answer, but it crashes at the fair and takes the other side of
  // every fork after it; this one is a clean run that simply says no.
  no_danny: {
    name: 'Arliss Poe', town: 'Kettleman',
    stunt: 'good',
    rules: [
      { on: "I've got my own show" },
    ],
  },
  // The other answer at the same card. `clean` schemes at the fair and calls
  // Danny in Free Roam 3, which is the route to 'poached'; this one introduces
  // itself at the fair and then says nothing when somebody signs him, which is
  // the route to 'absent'. Both states had a label in the cast table and no
  // writer for the game's whole life.
  danny_gone: {
    name: 'Vern Straley', town: 'Antler',
    stunt: 'good',
    rules: [
      { on: 'introduce myself' },
      { on: 'Nothing from me' },
    ],
  },
};

const MAX_STEPS = 2000;

// A click that changes nothing is the failure mode this game actually has:
// goToScene() console.warns on an unknown id and returns, leaving the choice
// buttons exactly where they were. To a driver that reads like a slow scene.
const STALL_LIMIT = 6;

/* What a transcript can be compared on, and what it cannot.
 *
 * Everything a transcript writes down is decided by the story except one line:
 * the stunt result, whose score and detail sentence both fall out of a
 * real-time physics run. `clean` re-taken on this machine landed the Bus Stack
 * at 95 one afternoon and 94 the next, off the same commit, and the detail
 * sentence has bands of its own — "dead level" below 0.4 of tolerance, "a
 * touch nose-high" above it, plus a flip count. Comparing those byte for byte
 * would be asserting that two machines rasterize the same number of frames
 * (#53), which they do not.
 *
 * The verdict is a different thing. SUCCESS vs PARTIAL vs FAIL is what
 * `handleStuntRunResult()` reads, it is why the next scene is the one it is, and
 * every scene id after it is in the diff anyway. So the line collapses to its
 * verdict and nothing else is touched.
 *
 * The nine committed scores sit far from the two thresholds that route the
 * story — 94-100 against 80 and 85, 12-19 against 30 — so a score that moved
 * far enough to change a route would change the scene path, and the diff would
 * say so in scene ids rather than in a number. That is the one failure here
 * worth re-running once before believing (#53).
 */
const NORMALISE = text => text.replace(
  /^> \*\*STUNT RESULT — (SUCCESS|PARTIAL|FAIL) \/ \d+\*\* — .*$/gm,
  '> **STUNT RESULT — $1**');

/** Returns true if the run is good: it reached an ending, and under --check it
 *  matched the committed transcript. */
async function run(key, headed, check = false) {
  const plan = RUNS[key];
  if (!plan) throw new Error(`no run "${key}". Try: ${Object.keys(RUNS).join(', ')}`);

  const t = await boot({ headed });
  const log = [];
  const scenePath = [];
  const say = s => { log.push(s); };
  let lastScene = null, lastText = null;
  const spent = new Set();
  let fingerprint = '', stalled = 0, stuntsPlayed = 0;
  let stopped = null, ok = false;
  const visits = {};

  try {
    await open(t.page, t.base, { name: plan.name, town: plan.town });

    for (let step = 0; step < MAX_STEPS; step++) {
      const s = await snapshot(t.page);

      const fp = [s.screen, s.scene, s.text, s.hub, s.buttons.map(b => b.label + (b.locked ? '!' : '')).join('|')].join('§');
      stalled = fp === fingerprint ? stalled + 1 : 0;
      fingerprint = fp;
      if (stalled >= STALL_LIMIT) {
        throw new Error(
          `DEAD END: ${STALL_LIMIT} clicks on screen "${s.screen}" (scene ${s.scene}) changed nothing.\n` +
          `  buttons: ${s.buttons.map(b => b.label.slice(0, 70)).join(' | ')}`);
      }

      if (s.scene && s.scene !== lastScene && s.screen === 'panel') {
        process.stdout.write(`    ${scenePath.length + 1}. ${s.scene}\n`);
        lastScene = s.scene;
        scenePath.push(s.scene);
        say(`\n### \`${s.scene}\``);
        // A cycle, as distinct from a frozen screen: the display keeps changing
        // so the stall fingerprint never fires, but the story is going round.
        const n = (visits[s.scene] = (visits[s.scene] || 0) + 1);
        if (n > 3) throw new Error(
          `LOOP: entered "${s.scene}" ${n} times. Last 12: ${scenePath.slice(-12).join(' → ')}`);
      }

      if (s.screen === 'end') {
        say('\n---\n\n## ENDING REACHED');
        const end = await t.page.evaluate(() => ({
          summary: document.getElementById('end-summary').innerText.replace(/\n{3,}/g, '\n\n').trim(),
          stats: document.getElementById('end-stats').innerText.replace(/\s+/g, ' ').trim(),
        }));
        say('\n' + end.summary + '\n\n**Stats:** ' + end.stats);
        break;
      }

      if (s.screen === 'reporter') {
        say(`\n> **STUNT RESULT — ${s.verdict} / ${s.score}** — ${s.detail}`);
        await pick(t.page, 'Accept Result');
        await wait(300);
        continue;
      }

      if (s.screen === 'minigame') {
        say(`\n> _[minigame: ${await t.page.evaluate(() => document.getElementById('stageTitle').textContent)}]_`);
        const policy = Array.isArray(plan.stunt) ? plan.stunt[Math.min(stuntsPlayed++, plan.stunt.length - 1)] : plan.stunt;
        await autopilot(t.page, policy);
        continue;
      }

      if (s.screen === 'chapter') {
        say(`\n\n## ${s.chapter}\n`);
        await pick(t.page, s.buttons[0].label);
        await wait(650);        // 400ms fade-out then goToScene
        continue;
      }

      if (s.screen === 'stats') {
        // The relationship rows as well as the title and the reason. This
        // screen is the only place the game ever tells a player a relationship
        // moved, and three rounds of diffing transcripts missed `m2_sign`
        // leaving rels.earl 'unknown' after the contract was signed, because
        // the tool wrote the headline down and not the rows underneath it.
        say(`\n> **${s.update}** — ${s.reason}`);
        for (const r of s.relRows) say(`> - _${r.who}_ → **${r.state}**`);
        await pick(t.page, 'Continue');
        await wait(200);
        continue;
      }

      if (s.screen === 'panel') {
        const choices = s.buttons.filter(b => !b.save && !/^— Continue —$|^Continue ›$/.test(b.label));
        if (choices.length === 0) {
          if (s.text && s.text !== lastText) {
            lastText = s.text;
            say(s.speaker === 'Narration' ? s.text : `**${s.speaker}:** ${s.text}`);
          }
          await pick(t.page, 'Continue');
          continue;
        }
        say('\n' + choices.map(c => `- ${c.locked ? '🔒 ' : ''}${c.label}`).join('\n'));
        const took = await choose(t.page, plan, s, spent);
        say(`\n**→ took:** ${took}`);
        await wait(200);
        continue;
      }

      if (s.screen === 'hub') {
        const play = s.buttons.filter(b => !b.save);
        const cards = play.filter(b => !b.locked);
        if (cards.length === 0) throw new Error(`hub "${s.hub}" has nothing clickable`);
        say(`\n\n## HUB — ${s.hub}\n` + play.map(b => `- ${b.locked ? '🔒 ' : ''}${b.label}`).join('\n'));
        // Milestone button last: drain the hub, then advance.
        const advance = cards.find(c => /^Milestone \d/.test(c.label));
        const target = cards.filter(c => c !== advance)[0] || advance;
        say(`\n**→ took:** ${await pick(t.page, target.label)}`);
        await wait(250);
        continue;
      }

      throw new Error(`stuck on screen "${s.screen}" with nothing to do`);
    }
  } catch (e) {
    stopped = e.message;
    say(`\n\n---\n\n## RUN STOPPED\n\n\`\`\`\n${e.message}\n\`\`\``);
    console.error('\n  ✗ ' + e.message + '\n');
  } finally {
    const errs = t.page.__errs.slice(0, 20);
    if (errs.length) say('\n\n## Page errors\n\n' + errs.map(e => '- `' + e + '`').join('\n'));
    const dir = path.join(HERE, 'transcripts');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, key + (check ? '.actual' : '') + '.md');
    const text =
      `# Daredevil — transcript: \`${key}\`\n\n` +
      `Played as ${plan.name} of ${plan.town}, stunt policy \`${[].concat(plan.stunt).join(' then ')}\`.\n\n` +
      `**Scene path (${scenePath.length}):** ${scenePath.map(s => '`' + s + '`').join(' → ')}\n\n---\n` +
      log.join('\n') + '\n';

    if (!check) {
      fs.writeFileSync(out, text);
      console.log(`  ${scenePath.length} scenes → ${path.relative(process.cwd(), out)}`);
      console.log('  path: ' + scenePath.join(' → '));
      ok = !stopped;
    } else {
      const want = path.join(dir, key + '.md');
      console.log(`  ${scenePath.length} scenes played`);
      if (!fs.existsSync(want)) {
        console.error(`  ✗ no committed transcript at ${path.relative(process.cwd(), want)} to compare against`);
        fs.writeFileSync(out, text);
        ok = false;
      } else {
        const committed = fs.readFileSync(want, 'utf8');
        ok = NORMALISE(committed) === NORMALISE(text) && !stopped;
        if (ok) {
          console.log(`  ✓ matches ${path.relative(process.cwd(), want)}`);
        } else {
          fs.writeFileSync(out, text);
          report(NORMALISE(committed), NORMALISE(text));
          console.error(`  ✗ ${key} differs from its committed transcript — the run just played is at ` +
            path.relative(process.cwd(), out));
        }
      }
    }
    await t.done();
  }
  return ok;
}

/* The first place two transcripts stop agreeing, with the lines either side of
 * it. A real unified diff would need an LCS and a dependency; the first
 * divergence is the whole story anyway, because one changed choice shifts
 * every line after it. The scene-path line is called out separately: it is
 * line 5 of every transcript and it is the one that says "the game goes
 * somewhere else now" rather than "a sentence was reworded". */
function report(want, got) {
  const a = want.split('\n'), b = got.split('\n');
  const pathLine = t => (t.match(/^\*\*Scene path \(\d+\):\*\* (.*)$/m)?.[1] || '')
    .split(' → ').map(x => x.replace(/`/g, ''));
  const [pa, pb] = [pathLine(want), pathLine(got)];
  if (pa.join() !== pb.join()) {
    let k = 0;
    while (k < pa.length && k < pb.length && pa[k] === pb[k]) k++;
    console.error(`  scene path: ${pa.length} committed, ${pb.length} played; ` +
      `they part at scene ${k + 1} — committed "${pa[k] ?? '(end)'}", played "${pb[k] ?? '(end)'}"`);
  }
  // Clipped, because the scene-path line is line 5 of every transcript and it
  // is 94 scene ids long: a re-routed choice printed the whole path twice and
  // buried the one-line summary above it.
  const clip = t => (t.length > 150 ? t.slice(0, 147) + '...' : t);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  console.error(`  first differing line: ${i + 1} (committed ${a.length} lines, played ${b.length})`);
  for (let j = Math.max(0, i - 3); j < i; j++) console.error(`      ${clip(a[j])}`);
  console.error(`    - ${a[i] === undefined ? '(committed transcript ends here)' : clip(a[i])}`);
  console.error(`    + ${b[i] === undefined ? '(the run just played ends here)' : clip(b[i])}`);
}

async function choose(page, plan, s, spent) {
  for (const rule of plan.rules) {
    const k = rule.on;
    if (rule.once && spent.has(k)) continue;
    const match = s.buttons.find(b => !b.locked && !b.save && b.label.toLowerCase().includes(k.toLowerCase()));
    if (!match) continue;
    if (rule.once) spent.add(k);
    return pick(page, match.label);
  }
  const first = s.buttons.find(b => !b.locked && !b.save && !/^— Continue —$|^Continue ›$/.test(b.label));
  return pick(page, first.label);
}

const key = process.argv[2] || 'clean';
if (key === '--all-check' || (key === 'all' && process.argv.includes('--check'))) {
  // Every run, in one process. Slower than nine jobs in parallel but it is the
  // form a desk wants, and daredevil-ci.yml uses the matrix instead.
  let bad = 0;
  for (const k of Object.keys(RUNS)) {
    console.log(`\n=== ${k}`);
    if (!(await run(k, false, true))) bad++;
  }
  console.log(bad ? `\n${bad} of ${Object.keys(RUNS).length} transcripts differ` : `\nall ${Object.keys(RUNS).length} transcripts match`);
  process.exitCode = bad ? 1 : 0;
} else {
  const ok = await run(key, process.argv.includes('--headed'), process.argv.includes('--check'));
  if (!ok) process.exitCode = 1;
}
