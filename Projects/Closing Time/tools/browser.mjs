// browser.mjs — the listing side of the commercial tier, in the real page.
//
//   node "Projects/Closing Time/tools/browser.mjs"
//
// Exits non-zero on any miss (#13). tools/smoke.mjs owns the arithmetic and
// the flows in Node; `npm run games` owns "the desk renders and a fortnight
// plays". What is here is the wiring the design's section 7 asks a browser for
// (#1010): the listing file opens on a building with no staging or photo menu,
// its buttons spend what they say, Go live waits on the rent roll, a
// building's offer row shows yield, coverage and spare equity, a refusal
// leaves the folder open with the offer still in it, and both new modals open
// and leave their Ledger line, and the investor tour (#1011) spends its
// actions and leaves its line. Asserted against the DOM for what just happened
// and against the save for what a reload must keep (#39).
//
// Borrows Tools/board-check's harness, as Integer Foundry's suite does; bare
// specifiers in those files resolve from their folder, so nothing is installed
// here. The page's own modules are imported into the page by the URL the page
// loaded them from, so the career they set up is the one on screen.

import { serve, launch, prepPage } from '../../../Tools/board-check/harness.mjs';
import { enter, savedState } from '../../../Tools/board-check/games.mjs';

const PORT = 8178;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = ms => new Promise(r => setTimeout(r, ms));

let checks = 0, failures = 0;
const t = {
  ok(cond, label, detail = '') {
    checks++;
    if (cond) console.log(`  ok    ${label}${detail ? '  ' + detail : ''}`);
    else { failures++; console.log(`  FAIL  ${label}${detail ? '  ' + detail : ''}`); }
  },
};

/** Run `fn(m)` in the page with the game's modules, `m.S` being the live career. */
const inGame = (page, fn, arg = null) => page.evaluate(async (src, arg) => {
  const at = p => import(new URL(p, location.href).href);
  const [st, Clients, Seller, Off, Com, ui, cal] = await Promise.all(['js/state.js', 'js/engine/clients.js', 'js/engine/seller.js',
    'js/engine/offering.js', 'js/engine/commercial.js', 'js/ui.js', 'js/engine/calendar.js'].map(at));
  const m = { st, get S() { return st.S; }, Clients, Seller, Off, Com, ui, cal };
  return (0, eval)(`(${src})`)(m, arg);
}, fn.toString(), arg);

/** Click the button inside `scope` whose text starts with `text`. */
async function clickText(page, scope, text) {
  const hit = await page.evaluate((scope, text) => {
    const b = [...document.querySelectorAll(`${scope} button`)].find(x => x.textContent.trim().startsWith(text));
    if (!b) return 'missing';
    if (b.disabled) return 'disabled';
    b.click();
    return 'clicked';
  }, scope, text);
  await wait(120);
  return hit;
}
const modalText = page => page.evaluate(() => (document.querySelector('#modal-root .modal') || {}).textContent || '');
const modalTitle = page => page.evaluate(() => (document.querySelector('#modal-root .modal-title') || {}).textContent || '');

const server = await serve(PORT);
const browser = await launch();
let page;
try {
  page = await prepPage(browser, BASE, { width: 1280, height: 1000, dsf: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  await enter(page, 'closing-time', { base: BASE });

  // A Broker-Track agent with Lorna Petrakis's building taken. Seeded, and the
  // modal queue emptied, so nothing from the day-one deck lands on top.
  await inGame(page, m => {
    m.S.level = 4; m.S.cash = 20000; m.S.seed = 1010; m.S.rep = 50; m.S.choiceQueue = [];
    const rec = m.Clients.meetClient('cl_0302');
    m.Seller.takeListing(rec);
    m.ui.render();
  });
  await page.click('#nav [data-nav="mylistings"]');
  await wait(150);
  const card = await page.evaluate(() => [...document.querySelectorAll('#main .card')].map(c => c.textContent).find(x => x.includes('330 Courthouse Row')) || '');
  t.ok(/mixed-use, 7 doors/.test(card) && /NOI \$88,256/.test(card) && /seller expects \$1,250,000/.test(card),
    "the building's card leads with its kind, doors, income and what the seller expects", card.slice(0, 160));

  console.log('\nthe listing file');
  t.ok(await clickText(page, '#main', 'Open the listing file') === 'clicked', 'a building in prep opens its listing file');
  let file = await page.evaluate(() => ({
    title: (document.querySelector('#modal-root .modal-title') || {}).textContent || '',
    sheet: (document.querySelector('#modal-root .setup-sheet') || {}).textContent || '',
    selects: [...document.querySelectorAll('#modal-root select')].map(s => s.className + ':' + [...s.options].map(o => o.textContent).join('|')),
    go: (document.querySelector('#modal-root .modal-actions button') || {}).disabled,
    why: (document.querySelector('#modal-root .go-live-blockers') || {}).textContent || '',
  }));
  t.ok(file.title === 'Listing file — 330 Courthouse Row', 'titled as a listing file', file.title);
  t.ok(/Owner's number\$1,250,000/.test(file.sheet) && /Packet value/.test(file.sheet) && /signs nothing under \$1,125,000/.test(file.sheet),
    'the setup sheet shows the owner\'s number, the packet value and the floor', file.sheet.slice(0, 200));
  t.ok(file.selects.length === 1 && file.selects[0].startsWith('om-tier:') && !/staging|photo/i.test(file.selects.join(' ')),
    'one menu, the memorandum, and no staging or photo menu', file.selects.join(' / ').slice(0, 160));
  t.ok(file.go === true && file.why === 'The rent roll has not been started.', 'Go live is disabled and says why (CT-4)', file.why);

  const slots0 = await inGame(page, m => m.S.slotsLeft);
  t.ok(await clickText(page, '#modal-root', 'Build the rent roll') === 'clicked', 'the rent roll button is there');
  const afterRoll = await inGame(page, m => ({ slots: m.S.slotsLeft, ready: m.S.playerListings[0].rollReadyDay }));
  t.ok(slots0 - afterRoll.slots === 2, 'and it spends two actions', `${slots0} -> ${afterRoll.slots}`);
  file = await page.evaluate(() => ({ sheet: document.querySelector('#modal-root .setup-sheet').textContent,
    why: document.querySelector('#modal-root .go-live-blockers').textContent }));
  t.ok(file.why === `The rent roll lands on day ${afterRoll.ready}.` && file.sheet.includes(`until the rent roll lands on day ${afterRoll.ready}`),
    'the file says when it lands', file.why);

  const cash0 = await inGame(page, m => m.S.cash);
  t.ok(await clickText(page, '#modal-root', 'Order the condition report') === 'clicked', 'the condition report button is there');
  const cash1 = await inGame(page, m => m.S.cash);
  t.ok(cash0 - cash1 === 1800, 'and it costs $1,800', `${cash0} -> ${cash1}`);
  const units = await page.evaluate(() => (document.querySelector('#modal-root .capital-list [data-issue="1"]') || {}).textContent || '');
  t.ok(/Two rooftop units/.test(units) && /not in the packet/.test(units), 'and the rooftop units are on the capital list', units.slice(0, 120));
  await page.click('#modal-root .capital-list [data-issue="1"] button');
  await wait(120);
  const unitsIn = await page.evaluate(() => document.querySelector('#modal-root .capital-list [data-issue="1"]').textContent);
  t.ok(/in the packet/.test(unitsIn) && !/Put it in the packet/.test(unitsIn), '"Put it in the packet" puts them in the packet', unitsIn.slice(0, 120));
  t.ok(await clickText(page, '#modal-root', 'Save for later') === 'clicked', 'Save for later closes the file');
  let saved = await savedState(page, 'closing-time');
  let spl = saved && saved.playerListings[0];
  t.ok(spl && spl.rollStartedDay === 1 && spl.preInspected === true && spl.disclosed.includes(1), 'and the save holds the roll, the report and the packet');

  // Five days to the roll, through the engine's own endDay(). The day's events
  // are cleared rather than answered: what they are is not this file's business.
  await inGame(page, m => { for (let i = 0; i < 5; i++) { m.S.choiceQueue = []; m.cal.endDay(); }
    m.S.knowledge.nb_downtown = 2; m.S.slotsLeft = 4; m.S.choiceQueue = []; m.ui.render(); });
  await page.click('#nav [data-nav="mylistings"]');
  await wait(150);
  await clickText(page, '#main', 'Open the listing file');
  const lease = await page.evaluate(() => (document.querySelector('#modal-root .capital-list [data-issue="2"]') || {}).textContent || '');
  t.ok(/month-to-month suites/.test(lease), 'the day the roll lands, the lease item is on the capital list', lease.slice(0, 100));
  await page.click('#modal-root .capital-list [data-issue="2"] button');
  await wait(120);
  const slots1 = await inGame(page, m => m.S.slotsLeft);
  t.ok(await clickText(page, '#modal-root', 'Present your opinion of value') === 'clicked', 'the opinion of value button is there');
  const opinion = await inGame(page, m => ({ slots: m.S.slotsLeft, w: m.S.playerListings[0].bovWeight }));
  t.ok(slots1 - opinion.slots === 1 && opinion.w === 0.9, 'and it spends one action and fixes w at 0.9', `${slots1} -> ${opinion.slots}, w ${opinion.w}`);
  file = await page.evaluate(() => ({ sheet: document.querySelector('#modal-root .setup-sheet').textContent,
    go: document.querySelector('#modal-root .modal-actions button').disabled }));
  const exp = await inGame(page, m => '$' + m.Com.sellerExpectation(m.S.playerListings[0]).toLocaleString('en-US'));
  t.ok(/verified against the leases/.test(file.sheet) && file.sheet.includes('Seller expects' + exp) && file.go === false,
    `the sheet reads verified, the seller expects what the engine says (${exp}), and Go live is open`, file.sheet.slice(0, 220));
  await page.evaluate(() => { const s = document.querySelector('#modal-root select.om-tier'); s.selectedIndex = 1; });
  const cash2 = await inGame(page, m => m.S.cash);
  t.ok(await clickText(page, '#modal-root', 'Go live') === 'clicked', 'Go live goes');
  const live = await inGame(page, m => ({ cash: m.S.cash, pl: m.S.playerListings[0] }));
  t.ok(live.pl.status === 'live' && live.pl.marketingTier === 1 && cash2 - live.cash === 900, 'live on the memorandum, $900 fronted', `${live.pl.status} tier ${live.pl.marketingTier}, ${cash2 - live.cash}`);
  const stamp = await page.evaluate(() => [...document.querySelectorAll('#main .card')].map(c => c.textContent).find(x => x.includes('330 Courthouse Row')) || '');
  t.ok(/LIVE/.test(stamp) && !/open house/i.test(stamp), 'the card is stamped LIVE and offers no open house', stamp.slice(0, 120));

  console.log('\nthe investor tour (#1011)');
  const pre = await inGame(page, m => {
    while (m.st.isWeekend(m.S.day)) m.S.day++;
    m.S.slotsLeft = 4; m.ui.render();
    return { interest: m.S.playerListings[0].interest, rep: m.S.rep, day: m.S.day };
  });
  t.ok(await clickText(page, '#main', 'Investor tour') === 'clicked', 'a live building on a memorandum has an Investor tour button, open on a weekday');
  const tourText = await modalText(page);
  t.ok(await modalTitle(page) === 'Investor tour — 330 Courthouse Row' && /So what is wrong with it\?/.test(tourText)
    && await inGame(page, m => m.S.slotsLeft) === 2, 'it opens on the question from the room and spends two actions', tourText.slice(0, 120));
  t.ok(await clickText(page, '#modal-root', 'Answer straight') === 'clicked' && await modalTitle(page) === 'Tour wrapped', 'a straight answer wraps the tour');
  const toured = await inGame(page, m => ({ interest: m.S.playerListings[0].interest, rep: m.S.rep, tourDay: m.S.playerListings[0].tourDay,
    line: (m.S.log.find(l => /^Investor tour at 330 Courthouse Row: interest \+2\.5/.test(l.text)) || {}).text }));
  t.ok(!!toured.line && Math.abs(toured.interest - pre.interest - 2.5) < 1e-9 && toured.rep - pre.rep === 2 && toured.tourDay === pre.day,
    'and leaves its Ledger line, interest +2.5 and reputation +2', `${toured.line} ${toured.rep - pre.rep}`);
  await clickText(page, '#modal-root', 'Lock up');
  const again = await page.evaluate(() => {
    const card = [...document.querySelectorAll('#main .card')].find(c => c.textContent.includes('330 Courthouse Row'));
    const b = card && [...card.querySelectorAll('button')].find(x => x.textContent.startsWith('Investor tour'));
    return { disabled: !!(b && b.disabled), why: ((card && card.querySelector('.tour-why')) || {}).textContent || '' };
  });
  t.ok(again.disabled && again.why.includes(`the next can be day ${pre.day + 7}`), 'the button is shut for a week afterwards and says until when', again.why);

  console.log('\nthe offer row and a refusal');
  await inGame(page, m => {
    const pl = m.S.playerListings[0];
    const mk = (id, price, investor, financing) => ({ id, agentId: 'ag_priya_natesan', price, investor, financing, spareEquity: 115000,
      inspection: false, closeDays: 45, day: m.S.day, status: 'open', escalation: null,
      uw: { noi: m.Com.packetNoi(pl), reqCap: 0.0802, capexIdx: m.Com.packetIdx(pl), yieldPrice: m.Com.investorPrice(pl, 0.0802).yieldPrice } });
    pl.offers.push(mk('of_low', 880000, 'value-add', 'commercial'), mk('of_good', 990000, 'exchange', 'commercial'));
    m.ui.render();
  });
  t.ok(await clickText(page, '#main', 'Review offers') === 'clicked', 'the folder opens on two offers');
  const rows = await page.$$eval('#modal-root .offer-row', els => els.map(e => e.textContent.replace(/\s+/g, ' ')));
  const good = rows.find(r => r.includes('$990,000')) || '';
  t.ok(/1031 exchange buyer/.test(good) && /Yield at this price 8\.\d\d%/.test(good) && /coverage \d\.\d\dx against 1\.20x, sizes with \$[\d,]+ to spare/.test(good)
    && /spare equity \$115,000/.test(good) && /written on a packet with 3 capital items/.test(good),
    "a building's row shows the kind, the yield, the coverage, the room and the spare equity", good.slice(0, 260));
  t.ok(/Under what they will sign: they will refuse it/.test(rows.find(r => r.includes('$880,000')) || ''), "and the seller's read of the low one", '');
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('#modal-root .offer-row')].find(r => r.textContent.includes('$880,000'));
    [...row.querySelectorAll('button')].find(b => b.textContent === 'Advise accept').click();
  });
  await wait(200);
  const after = await page.evaluate(() => ({
    title: (document.querySelector('#modal-root .modal-title') || {}).textContent || '',
    note: (document.querySelector('#modal-root .refusal') || {}).textContent || '',
    rows: [...document.querySelectorAll('#modal-root .offer-row')].map(e => e.textContent).filter(x => x.includes('$880,000')).length,
  }));
  const lowStatus = await inGame(page, m => m.S.playerListings[0].offers.find(o => o.id === 'of_low').status);
  const floor = await inGame(page, m => '$' + m.Com.sellerFloor(m.S.playerListings[0]).toLocaleString('en-US'));
  t.ok(after.title === 'Offers — 330 Courthouse Row' && after.note.includes(`will not sign that: they take nothing under ${floor}`) && after.rows === 1 && lowStatus === 'open',
    'advising acceptance under the floor leaves the folder open with the refusal said and the offer still in it', after.note);

  console.log('\nthe two modals');
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('#modal-root .offer-row')].find(r => r.textContent.includes('$990,000'));
    [...row.querySelectorAll('button')].find(b => b.textContent === 'Advise accept').click();
  });
  await wait(200);
  const uc = await inGame(page, m => ({ status: m.S.playerListings[0].status, ms: m.S.playerListings[0].milestones.map(x => x.type).join(' ') }));
  t.ok(uc.status === 'underContract' && uc.ms === 'sellerDueDiligence sellerFinancing sellerClosing', 'accepting the good one puts the building under contract', uc.ms);
  // Due diligence on a packet the offer was written without the units: they
  // are taken out of the offer's terms, which is what a packet without them
  // would have written.
  await inGame(page, m => {
    const pl = m.S.playerListings[0];
    pl.acceptedOffer.uw.capexIdx = pl.acceptedOffer.uw.capexIdx.filter(i => i !== 1);
    m.Off.resolveDueDiligence(pl, pl.milestones[0]);
    m.ui.render();
  });
  t.ok(await modalTitle(page) === 'Due diligence' && /They want \$45,000 off/.test(await modalText(page)), 'the due diligence modal opens and names the retrade');
  t.ok(await clickText(page, '#modal-root', 'Concede $45,000') === 'clicked', 'with a Concede button for the amount');
  let led = await inGame(page, m => ({ line: m.S.log.find(l => /^You advise conceding/.test(l.text)), price: m.S.playerListings[0].acceptedOffer.price }));
  t.ok(!!led.line && led.price === 945000 && !(await page.$('#modal-root .modal')), 'conceding closes it, leaves its Ledger line and takes $45,000 off', led.line ? led.line.text.slice(0, 90) : 'no line');
  await inGame(page, m => {
    const pl = m.S.playerListings[0];
    m.S.market.rate = 11.4; pl.acceptedOffer.spareEquity = 10000;
    m.Off.resolveSellerLoan(pl, pl.milestones[1]);
    m.ui.render();
  });
  const bankText = await modalText(page);
  t.ok(await modalTitle(page) === 'The bank' && /cuts it by \$[\d,]+\. The buyer has \$10,000 spare/.test(bankText), 'the bank modal opens with the cut and the spare equity', bankText.slice(0, 160));
  const fin = await inGame(page, m => m.Com.sellerLoanTest(m.S.playerListings[0], m.S.playerListings[0].acceptedOffer).financeablePrice);
  t.ok(await clickText(page, '#modal-root', 'Come down to') === 'clicked', 'with a Come down button');
  led = await inGame(page, m => ({ line: m.S.log.find(l => /^You advise coming down to/.test(l.text)), price: m.S.playerListings[0].acceptedOffer.price }));
  t.ok(!!led.line && led.price === fin, 'coming down leaves its Ledger line and the price the bank finances', `${led.price} against ${fin}`);

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#nav [data-nav="mls"]');
  saved = await savedState(page, 'closing-time');
  spl = saved && saved.playerListings[0];
  t.ok(spl && spl.status === 'underContract' && spl.acceptedOffer.price === fin && spl.bovWeight === 0.9 && spl.acceptedOffer.investor === 'exchange',
    'a reload keeps the building under contract at the repriced number, its opinion and its buyer', spl ? `${spl.status} ${spl.acceptedOffer.price}` : 'no save');
  t.ok(!errors.length, 'no page errors', errors.slice(0, 2).join(' | '));
} catch (e) {
  failures++;
  console.log('  FAIL  the run threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e));
} finally {
  if (page) await page.close().catch(() => {});
  await browser.close();
  server.close();
}
console.log(`\n${checks - failures} of ${checks} checks passed${failures ? `, ${failures} failed` : ''}`);
process.exit(failures ? 1 : 0);
