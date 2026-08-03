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
  // Turns the Young Wannabe down at the gas station, so wannabeMet never gets
  // set and rels.pete stays undefined for the whole run — the "thread never
  // opened" case, not the "opened then walked away" case fr2_pete_soft covers.
  no_pete: {
    name: 'Ellis Boone', town: 'Cutter Ridge',
    stunt: 'good',
    rules: [
      { on: "isn't something I can teach" },
    ],
  },
};

const MAX_STEPS = 2000;

// A click that changes nothing is the failure mode this game actually has:
// goToScene() console.warns on an unknown id and returns, leaving the choice
// buttons exactly where they were. To a driver that reads like a slow scene.
const STALL_LIMIT = 6;

async function run(key, headed) {
  const plan = RUNS[key];
  if (!plan) throw new Error(`no run "${key}". Try: ${Object.keys(RUNS).join(', ')}`);

  const t = await boot({ headed });
  const log = [];
  const scenePath = [];
  const say = s => { log.push(s); };
  let lastScene = null, lastText = null;
  const spent = new Set();
  let fingerprint = '', stalled = 0;
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
        await autopilot(t.page, plan.stunt);
        continue;
      }

      if (s.screen === 'chapter') {
        say(`\n\n## ${s.chapter}\n`);
        await pick(t.page, s.buttons[0].label);
        await wait(650);        // 400ms fade-out then goToScene
        continue;
      }

      if (s.screen === 'stats') {
        say(`\n> **${s.update}** — ${s.reason}`);
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
    say(`\n\n---\n\n## RUN STOPPED\n\n\`\`\`\n${e.message}\n\`\`\``);
    console.error('\n  ✗ ' + e.message + '\n');
  } finally {
    const errs = t.page.__errs.slice(0, 20);
    if (errs.length) say('\n\n## Page errors\n\n' + errs.map(e => '- `' + e + '`').join('\n'));
    const dir = path.join(HERE, 'transcripts');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, key + '.md');
    fs.writeFileSync(out,
      `# Daredevil — transcript: \`${key}\`\n\n` +
      `Played as ${plan.name} of ${plan.town}, stunt policy \`${plan.stunt}\`.\n\n` +
      `**Scene path (${scenePath.length}):** ${scenePath.map(s => '`' + s + '`').join(' → ')}\n\n---\n` +
      log.join('\n') + '\n');
    console.log(`  ${scenePath.length} scenes → ${path.relative(process.cwd(), out)}`);
    console.log('  path: ' + scenePath.join(' → '));
    await t.done();
  }
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
await run(key, process.argv.includes('--headed'));
