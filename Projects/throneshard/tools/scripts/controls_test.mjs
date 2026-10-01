// Controls regression test (WS4): same-frame order acknowledgement, right-click hold-to-move (~10 Hz), shift-queue,
// quick cast / quick cast on key release, hotkey rebinding persistence (localStorage, survives reload).
// Usage: node scripts/controls_test.mjs <url> [hero=sera]
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://127.0.0.1:5173';
const hero = process.argv[3] || 'sera';
const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errs = [];
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };

async function startMatch() {
  await p.waitForSelector('.btn-play', { timeout: 180000 });
  await p.evaluate(() => { try { localStorage.setItem('throneshard.tutorial', JSON.stringify({ off: true })); } catch {} });
  await p.click('.btn-play');
  await p.waitForSelector(`.pk-card[data-id="${hero}"]`, { timeout: 30000 });
  await p.click(`.pk-card[data-id="${hero}"]`);
  await p.click('.btn-lock');
  await p.waitForFunction(() => window.game?.running, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  // count orders issued to the player hero
  await p.evaluate(() => {
    const h = game.player.hero;
    window.__orders = [];
    const orig = h.issueOrder.bind(h);
    h.issueOrder = (o, q) => { window.__orders.push({ type: o.type, x: o.point?.x, z: o.point?.z, q: !!q, t: performance.now(), frame: game.frame }); return orig(o, q); };
  });
}

await p.goto(url);
await p.evaluate(() => { try { localStorage.removeItem('throneshard.keybinds'); localStorage.setItem('throneshard.castMode', 'normal'); } catch {} });
await p.reload();
await startMatch();

// 1. same-frame acknowledgement: a listener registered after Input's sees the order + marker in the same event
await p.evaluate(() => {
  window.__ack = null;
  addEventListener('mousedown', (e) => { if (e.button === 2) window.__ack = { order: game.player.hero.order.type, frame: game.frame, n: window.__orders.length }; }, { once: true });
});
await p.mouse.click(820, 300, { button: 'right' });
const ack = await p.evaluate(() => window.__ack);
check('order acknowledged in the same event/frame', ack?.order === 'move' && ack.n >= 1, JSON.stringify(ack));

// 2. no dropped clicks: 10 quick right-clicks at different spots -> 10 move orders
await p.evaluate(() => { window.__orders.length = 0; });
for (let i = 0; i < 10; i++) { await p.mouse.click(500 + i * 30, 250 + (i % 3) * 40, { button: 'right' }); await p.waitForTimeout(40); }
const nClicks = await p.evaluate(() => window.__orders.filter((o) => o.type === 'move').length);
check('10 rapid right-clicks -> 10 move orders', nClicks === 10, `${nClicks}`);

// 3. hold-to-move: hold RMB and sweep the cursor for 1.5 s -> ~10 Hz re-issued moves following the cursor
await p.evaluate(() => { window.__orders.length = 0; });
await p.mouse.move(900, 250);
await p.mouse.down({ button: 'right' });
const t0 = Date.now();
for (let i = 0; i <= 30; i++) { await p.mouse.move(900 - i * 15, 250 + i * 5); await p.waitForTimeout(50); }
const heldMs = Date.now() - t0;
await p.mouse.up({ button: 'right' });
const hold = await p.evaluate(() => {
  const o = window.__orders.filter((x) => x.type === 'move');
  const g = game.input.pickGround(450, 400);
  const last = o[o.length - 1];
  return { n: o.length, lastDist: last ? Math.hypot(last.x - g.x, last.z - g.z) : 99 };
});
const hz = (hold.n - 1) / (heldMs / 1000);
check('hold-to-move re-issues ~10 Hz', hz > 6 && hz < 13, `${hold.n} orders in ${heldMs} ms = ${hz.toFixed(1)} Hz`);
check('hold-to-move follows the cursor', hold.lastDist < 3, `last order ${hold.lastDist.toFixed(2)} from cursor ground point`);
await p.waitForTimeout(400);
const after = await p.evaluate(() => window.__orders.length);
await p.waitForTimeout(500);
check('releasing RMB stops re-issuing', (await p.evaluate(() => window.__orders.length)) === after);

// 4. shift-queue: move, then 2 shift-queued moves -> queue length 2; holding shift+RMB must not spam the queue
await p.mouse.click(700, 200, { button: 'right' });
await p.keyboard.down('Shift');
await p.mouse.click(760, 260, { button: 'right' });
await p.mouse.down({ button: 'right' }); await p.mouse.move(800, 300); await p.waitForTimeout(600); await p.mouse.up({ button: 'right' });
await p.keyboard.up('Shift');
const q = await p.evaluate(() => game.player.hero.orderQueue.length);
check('shift-queue keeps 2 waypoints (no hold spam)', q === 2, `queue=${q}`);

// 5. quick cast: Q fires at the cursor immediately
await p.evaluate(() => { const h = game.player.hero; h.abilityPoints += 2; h.levelAbility(0); h.levelAbility(1); h.mana = h.getStat('maxMana'); game.input.setCastMode('quick'); game.player.hero.issueOrder({ type: 'stop' }); });
await p.mouse.move(760, 300);
await p.keyboard.down('q');
const qc = await p.evaluate(() => ({ order: game.player.hero.order.type, ab: game.player.hero.order.ability?.def?.id, targeting: !!game.input.targeting }));
await p.waitForTimeout(150);
const ring = await p.evaluate(() => game.input.rangeRing.visible);
await p.keyboard.up('q');
check('quick cast issues the cast on key down', qc.order === 'cast' && !qc.targeting, JSON.stringify(qc));
check('quick cast shows range while key held', ring === true);

// 6. quick cast on key release: W aims while held (range ring), casts on release
await p.waitForTimeout(1500);
await p.evaluate(() => { const h = game.player.hero; h.issueOrder({ type: 'stop' }); h.mana = h.getStat('maxMana'); game.input.setCastMode('release'); });
await p.mouse.move(720, 330);
await p.evaluate(() => { window.__errs = []; game.bus.on('ui:error', (e) => window.__errs.push(e?.message)); });
await p.keyboard.down('w');
await p.waitForTimeout(250);
const held = await p.evaluate(() => ({ targeting: game.input.targeting?.ability?.def?.id ?? null, ring: game.input.rangeRing.visible, order: game.player.hero.order.type }));
await p.keyboard.up('w');
const rel = await p.evaluate(() => ({ order: game.player.hero.order.type, ab: game.player.hero.order.ability?.def?.id, targeting: !!game.input.targeting }));
check('release mode: aiming while held (no cast yet, range shown)', !!held.targeting && held.ring && held.order !== 'cast', JSON.stringify(held) + ' errs=' + JSON.stringify(await p.evaluate(() => window.__errs)));
check('release mode: casts on key release', rel.order === 'cast' && !rel.targeting, JSON.stringify(rel));
await p.evaluate(() => game.input.setCastMode('normal'));

// 7. rebind via the Settings UI: F10 -> Controls tab -> click "Ability 1" -> press G; persists across reload
await p.keyboard.press('F10');
await p.waitForSelector('.set-tabs button[data-tab=controls]');
await p.click('.set-tabs button[data-tab=controls]');
await p.click('.kb-key[data-action=ability1]');
await p.keyboard.press('g');
await p.waitForTimeout(200);
const lbl = await p.textContent('.kb-key[data-action=ability1]');
const lblW = await p.textContent('.kb-key[data-action=ability2]');
await p.screenshot({ path: '/tmp/ws4/12_rebind.png' });
check('rebind shows new key in settings', lbl.trim() === 'G', lbl);
await p.click('.md-x');
const hudKey = await p.evaluate(() => document.querySelector('.bp-abilities .ab .ab-key')?.textContent);
check('HUD hotkey label follows rebind', hudKey === 'G', hudKey);
await p.evaluate(() => { const h = game.player.hero; h.abilities[0].cooldownRemaining = 0; h.mana = h.getStat('maxMana'); });
await p.keyboard.press('g');
const gTarg = await p.evaluate(() => game.input.targeting?.ability?.def?.id ?? null);
check('new key G starts Q ability targeting', !!gTarg, gTarg);
await p.keyboard.press('Escape');
await p.reload();
await p.waitForSelector('.btn-play', { timeout: 180000 });
const persisted = await p.evaluate(() => ({ code: game.input.keybinds.codeFor('ability1'), ls: localStorage.getItem('throneshard.keybinds') }));
check('rebind persisted across reload', persisted.code === 'KeyG', JSON.stringify(persisted));
await p.evaluate(() => { game.input.keybinds.reset(); localStorage.removeItem('throneshard.tutorial'); });
check('ability2 label untouched', lblW.trim() === 'W', lblW);

const uniq = [...new Set(errs)];
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
console.log('errors/warnings (' + uniq.length + '):\n' + uniq.slice(0, 30).join('\n'));
await b.close();
