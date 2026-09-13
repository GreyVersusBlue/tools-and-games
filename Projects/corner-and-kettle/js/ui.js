/* =========================================================
   CORNER & KETTLE — coffee shop sim
   ========================================================= */
// ui.js — the page. index.html loads this and nothing else.
//
// Builds one sim, hands it real frame deltas from requestAnimationFrame, and
// draws what it did: the topbar, the queue, the counter's stations, the
// day-end modal and the toasts, plus the save bar and boot. The station panel
// is stations.js and the Menu Board is chalkboard.js; both are handed what
// they need from here. None of the three owns a rule: every number the shop
// moves is moved by sim.js (see js/README.md for the map).

// Persistence lives in save.js, on top of the shared gvb-save module: file
// export/import, a memory fallback when the browser blocks storage, and a
// validator that refuses a corrupt blob instead of booting on it.
import { mountSaveBar } from "../../../assets/js/gvb-save.js";
import { buildCatalog, createCornerKettleSlot, toSaveData, applyToState } from "./save.js";
// The shop itself. content.js is the tables; sim.js is everything that
// happens to them, with no DOM in it, so test/smoke-sim.mjs can run a shift
// in Node with a seed.
import * as CONTENT from "./content.js";
import { createSim, freshState, freshDayStats } from "./sim.js";
import { makeSpriteSvg, orderIconsHtml, orderDescriptionHtml, customerLabel, cupSvg } from "./draw.js";
import { createSound } from "./sound.js";
import { STATION_TAB_DEFS, createStations } from "./stations.js";
import { createChalkboard } from "./chalkboard.js";

const {
  MILKS, SYRUPS, TOPPINGS, BASE_COLORS, RECIPES, FOODS, PHASES, SHIFT_MS,
  EQUIPMENT_UPGRADES, AMBIANCE_UPGRADES, BUSINESS_UPGRADES, MARKETING_COST,
  DAILY_MODIFIERS, RANDOM_EVENTS, STARTING_UNLOCKS, BARISTA_NAMES, PRESET_MAX,
} = CONTENT;

/* ---------- STATE + SIM ---------- */
// `state` is one plain object the sim mutates, the page renders from and
// save.js reads.
const state = freshState(CONTENT);

// What the sim wants shown. Inside gameLoop() redraws are coalesced into one
// per frame; from anywhere else (a click, the debug hook) they happen at once.
let batching = false;
let pendingRender = null;
function notify(ev){
  if(ev.type==='toast'){ toast(ev.text); return; }
  if(ev.type==='shiftEnd'){ showDaySummary(ev.summary); return; }
  if(ev.type==='render'){
    if(batching){
      pendingRender = (ev.scope==='all' || pendingRender==='all') ? 'all' : 'queue';
    } else if(ev.scope==='all') renderAll();
    else renderQueue();
  }
}
const sim = createSim({ content: CONTENT, rng: Math.random, state, notify });

/* ---------- SAVE SLOT ---------- */
// The catalog is derived from the tables rather than written out again, so
// the ids repairSave() accepts cannot drift from the ids the game renders.
const CATALOG = buildCatalog({
  recipes: RECIPES.map(r=>r.id),
  foods: FOODS.map(f=>f.id),
  syrups: SYRUPS.map(s=>s.id),
  toppings: TOPPINGS.map(t=>t.id),
  milks: MILKS.map(m=>m.id),
  bases: Object.keys(BASE_COLORS),
  upgrades: [...EQUIPMENT_UPGRADES, ...AMBIANCE_UPGRADES, ...BUSINESS_UPGRADES].map(u=>u.id),
  modifiers: DAILY_MODIFIERS.filter(Boolean).map(m=>m.id),
  baristaNames: BARISTA_NAMES,
  starting: STARTING_UNLOCKS,
  shiftMs: SHIFT_MS,
  presetMax: PRESET_MAX,
});
const saveSlot = createCornerKettleSlot(CATALOG);
const SAVE_KEY = saveSlot.key;

// renderAll() used to write the save on every call: every station click,
// every serve and every barista step, a synchronous JSON.stringify and
// setItem each time. It marks the save dirty now, and a dirty save is written
// at most once every AUTOSAVE_MS (#346). The moments a reload must not lose
// are written at once: a serve, a purchase, the end of a shift and the start
// of the next, a preset, the mute switch, an import and New Game. What a
// close can lose is the last few seconds of the shift clock.
//
// Not gvb-save's autosave(), which is the same timer plus a flush on
// `pagehide`. That flush writes the page's copy over whatever storage holds at
// the moment the page goes away, and the old page never wrote on unload: a
// wipe or a hand-edited save followed by a reload (drive-save.mjs sections 7,
// 10 and 12, and anyone clearing site data) came back as the shop that was
// just thrown away, six checks red.
const AUTOSAVE_MS = 4000;
let saveTimer = null;
function markDirty(){
  if(saveTimer) return;
  saveTimer = setTimeout(()=>{ saveTimer = null; saveNow(); }, AUTOSAVE_MS);
}
function saveNow(){
  saveSlot.save(toSaveData(state));
}

/* ---------- UTIL ---------- */
function fmtMoney(n){return n.toFixed(0);}
function toast(msg){
  const el = document.createElement('div');
  el.className='toast';
  el.textContent = msg;
  document.getElementById('toastWrap').appendChild(el);
  setTimeout(()=>el.remove(), 2300);
}

const sound = createSound(() => state.muted);

/* ---------- RENDER: QUEUE ---------- */
function renderQueue(){
  const row = document.getElementById('queueRow');
  row.innerHTML='';
  state.queue.slice(0,sim.queueMax()).forEach((c)=>{
    const div = document.createElement('button');
    div.type = 'button';
    div.className='customer';
    if(c._servedAnim) div.className+=' served';
    if(c.isRegular) div.className += ' regular';
    div.setAttribute('aria-label', customerLabel(c));
    const pct = Math.max(0, (c.patience/c.patienceMax))*100;
    div.innerHTML = `
      ${c.isRegular ? `<div class="regularName">${c.regularName}</div>` : ''}
      <div class="bubble">${orderIconsHtml(c)}</div>
      ${makeSpriteSvg(c.sprite)}
      <div class="patience"><div class="patience-fill" style="width:${pct}%"></div></div>
    `;
    div.onclick = ()=> tryAcceptCustomer(c.id);
    row.appendChild(div);
  });
}

/* ---------- SLOTS ---------- */
function renderSlots(){
  const wrap = document.getElementById('slots');
  wrap.innerHTML='';
  state.slots.forEach((slot, idx)=>{
    const div = document.createElement('div');
    div.className = 'slot' + (idx===state.focusedSlot? ' focused':'') + (!slot? ' empty':'') + (slot && slot.serving? ' serving':'');
    if(!slot){
      div.innerHTML = `Station ${idx+1}<br><small>tap a waiting customer</small>`;
      div.onclick = ()=>{ state.focusedSlot = idx; renderAll(); };
      wrap.appendChild(div);
      return;
    }
    const order = slot.customer;
    const worker = state.baristas.find(b=>b.targetSlot===idx);
    if(worker) div.className += ' baristaWorking';
    div.innerHTML = `
      ${worker ? `<div class="baristaChip">🧑‍🍳 ${worker.name} is on it…</div>` : ''}
      <button class="clearbtn" title="release order back to queue">release</button>
      <div class="ticket">${orderDescriptionHtml(order, sim.getOrderRequirements(order), slot)}</div>
      <div class="cupwrap">${ slot.food ? `<div style="font-size:64px">${FOODS.find(f=>f.id===order.foodId).icon}</div>` : cupSvg(slot.cup) }</div>
      <div class="slotbtnrow">
        <button class="discardbtn" title="dump the cup and start over">🗑️ Dump</button>
        ${serveButtonHtml(slot)}
      </div>
    `;
    div.querySelector('.clearbtn').onclick = (e)=>{ e.stopPropagation(); releaseSlot(idx); };
    div.querySelector('.discardbtn').onclick = (e)=>{ e.stopPropagation(); discardCup(idx); };
    div.querySelector('.servebtn').onclick = (e)=>{ e.stopPropagation(); serveSlot(idx); };
    div.onclick = ()=>{ state.focusedSlot = idx; renderAll(); };
    wrap.appendChild(div);
  });
}

// The Serve button reads the ticket (#341). A complete cup says "Serve". A
// short one says "Serve 3/5", is styled as a warning and names what is missing,
// because partial credit is a designed mechanic and the only thing wrong with
// it was that the price of the click was invisible. A cup with nothing real in
// it is disabled, and says what it needs first, so it is never mute.
function serveButtonHtml(slot){
  const r = sim.serveReadiness(slot);
  const esc = s => s.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  let text = 'Serve', cls = 'servebtn', label;
  if(!r.canServe){
    label = `Nothing to serve yet. Still needs: ${r.missing.join(', ')}.`;
  } else if(r.complete){
    label = 'Serve this order. Every ticket line is done.';
  } else {
    text = `Serve ${r.done}/${r.total}`;
    cls += ' short';
    label = `Serve now for partial credit, ${r.done} of ${r.total} done. Still missing: ${r.missing.join(', ')}.`;
  }
  return `<button class="${cls}" aria-keyshortcuts="s" aria-label="${esc(label)}" title="${esc(label)} Shortcut: S" ${r.canServe? '':'disabled'}>${text}</button>`;
}

/* ---------- ACCEPT / RELEASE / SERVE ---------- */
function tryAcceptCustomer(custId){
  const idx = sim.acceptCustomer(custId);
  if(idx===-1){ toast('All stations are busy!'); return; }
  if(idx===null) return;
  state.focusedSlot = idx;
  state.stationTab = state.slots[idx].food ? 'food' : 'base';
  renderAll();
}

function releaseSlot(idx){
  if(sim.releaseSlot(idx)) renderAll();
}

function discardCup(idx){
  if(!sim.discardCup(idx)) return;
  toast('Dumped it — starting fresh');
  renderAll();
}

// The money comes from scoreServe() in sim.js, which also marks the slot as
// serving and lets the clock clear it half a second later. This keeps the
// toast and the sound. The gate is checked here, not only by the button's
// `disabled`: the S key calls this directly and used to serve an empty cup the
// button refused.
function serveSlot(idx){
  const slot = state.slots[idx];
  if(!slot || !sim.serveReadiness(slot).canServe) return;
  const r = sim.scoreServe(slot);
  if(!r) return;
  let msg = r.happy? `Served! +${r.earned}` : `Served (not quite right) +${r.earned}`;
  const extras = [];
  if(r.comboBonus>0) extras.push(`+${r.comboBonus} combo bonus`);
  if(r.regularBonus>0) extras.push(`+${r.regularBonus} regular bonus`);
  const order = slot.customer;
  if(order.isCritic && r.happy) extras.push('critic loved it 🎩');
  if(order.isBirthday && r.happy) extras.push('birthday bonus 🎂');
  if(r.shieldUsed) extras.push('streak shield used 🛡️');
  if(extras.length) msg += ` (${extras.join(', ')})`;
  if(r.happy) msg += ' 🔥';
  toast(msg);
  sound.serve(r.happy);
  renderAll();
  saveNow();
}

/* ---------- THE CHALKBOARD'S PURCHASES ---------- */
// Everything a Menu Board button does. The rule is sim.purchase(); asking
// before a reopen, the toast, the save and the redraw are the page's. A
// refusal says why: the old doUnlock() said "Unlocked!" for anything it
// refused, including a purchase it could not afford (#344).
function buy(type, id, extra){
  if(type==='prestige' && !window.confirm('Reopen the shop? This resets day, money, and most upgrades, but keeps a permanent income bonus.')) return;
  const r = sim.purchase(type, id, extra);
  if(r.ok){
    if(r.text) toast(r.text);
    saveNow();
  } else {
    toast(r.reason);
  }
  renderAll();
}

/* ---------- STATIONS AND CHALKBOARD ---------- */
const stations = createStations({ state, sim, toast, sound, renderAll, saveNow });
const chalkboard = createChalkboard({ state, sim, buy });

// Digits switch station tabs, "s" serves the focused station — the tabs and
// Serve were already keyboard-reachable via Tab, this just makes them fast.
document.addEventListener('keydown', (e)=>{
  if(e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if(tag==='INPUT' || tag==='TEXTAREA') return;
  if(document.getElementById('modalOverlay').classList.contains('show')) return;
  const tabIdx = STATION_TAB_DEFS.findIndex((t,i)=> String(i+1)===e.key);
  if(tabIdx!==-1){
    stations.selectTab(STATION_TAB_DEFS[tabIdx].id);
    return;
  }
  if(e.key==='s' || e.key==='S'){
    if(stations.currentSlot()) serveSlot(state.focusedSlot);
  }
});

/* ---------- DAY / SHIFT ---------- */
function renderClock(){
  const idx = sim.currentPhaseIndex();
  const phase = PHASES[idx];
  document.getElementById('phaseLabel').textContent = phase.name;
  const pct = Math.min(100, (state.shiftElapsed/SHIFT_MS)*100);
  document.getElementById('clockbar-fill').style.width = pct+'%';
  document.getElementById('skystrip').style.background = `linear-gradient(180deg, ${phase.sky[0]}, ${phase.sky[1]})`;
}

// The page's only clock. Real frame deltas go into sim.advance(), which pays
// them out in fixed steps; anything the sim wants drawn arrives through
// notify() and is coalesced into one redraw per frame here.
let lastTick = null;
function gameLoop(ts){
  if(lastTick===null) lastTick = ts;
  const dt = ts - lastTick;
  lastTick = ts;
  const wasRunning = state.shiftRunning;
  batching = true; pendingRender = null;
  sim.advance(dt);
  batching = false;
  if(pendingRender==='all') renderAll();
  else if(pendingRender==='queue') renderQueue();
  if(wasRunning) renderClock();
  requestAnimationFrame(gameLoop);
}

// The day-end modal. The numbers are the sim's; endShift() in sim.js banked
// the wages and stopped the clock before this was called.
function showDaySummary(ds){
  document.getElementById('modalTitle').textContent = `Day ${ds.day} Complete!`;
  document.getElementById('modalBody').innerHTML = `
    <div>You earned</div>
    <div class="bigmoney">$${fmtMoney(ds.money)}</div>
    <div class="daysummary">
      <div>☕ Drinks served: <b>${ds.drinksServed}</b></div>
      <div>🍪 Food served: <b>${ds.foodServed}</b></div>
      <div>🎯 Avg. order accuracy: <b>${ds.avgAccuracy}%</b></div>
      <div>💵 Tips earned: <b>$${fmtMoney(ds.totalTips)}</b></div>
      ${ds.wages>0 ? `<div>🧑‍🍳 Staff wages paid: <b>-$${fmtMoney(ds.wages)}</b></div>` : ''}
      <div>🔥 Best streak: <b>${ds.bestCombo}</b></div>
      ${ds.bestTip>0 ? `<div>💰 Biggest tip: <b>$${ds.bestTip}</b> (${ds.bestTipName})</div>` : ''}
      ${ds.worstMiss ? `<div>😬 Worst miss: <b>${ds.worstMiss.name}</b> (${Math.round(ds.worstMiss.ratio*100)}% right)</div>` : ''}
      <div>⭐ Reputation: <b>${Math.round(ds.reputation)}/100</b> (${ds.repDelta>=0?'+':''}${ds.repDelta} today)</div>
      ${ds.events.length ? `<div>🔔 Events today: <b>${ds.events.join(', ')}</b></div>` : ''}
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('show');
  saveNow();
}

document.getElementById('modalBtn').onclick = ()=>{
  document.getElementById('modalOverlay').classList.remove('show');
  sim.startNextDay();
  renderAll();
  saveNow();
};

/* ---------- CHALKBOARD TOGGLE ---------- */
document.getElementById('chalkToggle').onclick = ()=>{
  document.getElementById('chalkboard').classList.toggle('open');
};

/* ---------- MUTE TOGGLE ---------- */
document.getElementById('muteToggle').onclick = ()=>{
  state.muted = !state.muted;
  document.getElementById('muteToggle').textContent = state.muted ? '🔇' : '🔊';
  saveNow();
};

/* ---------- NEW GAME ---------- */
// This button has always been here, so the save bar mounts export/import only
// — two controls that erase the shop, side by side, is the footgun the
// `buttons` option exists to prevent.
document.getElementById('newGameBtn').onclick = ()=>{
  if(window.confirm('Start a new game? This clears all saved progress (day, money, unlocks).')){
    adoptSave(saveSlot.reset());
    sim.rollDailyModifier();   // a fresh state carries no modifier; day one rolls one
    renderAll();
    saveNow();
    toast('New shop, day one ☕');
  }
};

/* ---------- SAVE / LOAD ---------- */
// Nothing below touches localStorage. gvb-save probes it once and falls back
// to memory when the browser blocks it — and in a browser configured to block
// storage, *reading the property* throws, not just setItem, so guessing from
// inside a try/catch here was never going to be enough.
function loadState(){
  const data = saveSlot.load();
  if(!data) return false;
  applyToState(state, data);
  return true;
}

// Take up a state that arrived from somewhere other than boot — an imported
// file, or Start Over. The queue has to be rebuilt because applyToState()
// empties it, and the whole UI redrawn because an import can be from any day.
function adoptSave(data){
  applyToState(state, data);
  state.dayStats = freshDayStats();
  for(let i=0;i<3;i++) state.queue.push(sim.generateOrder());
  sim.resetClock();
  renderAll();
  renderClock();
  saveNow();
}

/* ---------- MASTER RENDER ---------- */
function renderAll(){
  document.getElementById('dayNum').textContent = state.day;
  document.getElementById('moneyLabel').textContent = fmtMoney(state.money);
  document.getElementById('comboLabel').textContent = state.combo;
  const shieldStat = document.getElementById('shieldStat');
  if(shieldStat){
    shieldStat.style.display = state.comboShields>0 ? 'flex' : 'none';
    document.getElementById('shieldLabel').textContent = state.comboShields;
  }
  const repLabel = document.getElementById('repLabel');
  if(repLabel) repLabel.textContent = sim.reputationStars();
  const dmBanner = document.getElementById('dailyModifierBanner');
  if(dmBanner){
    const dm = sim.getActiveDailyModifier();
    if(dm){ dmBanner.style.display='block'; dmBanner.textContent = `📅 ${dm.name}: ${dm.desc}`; }
    else dmBanner.style.display = 'none';
  }
  renderQueue();
  renderSlots();
  stations.renderStationsAll();
  chalkboard.render();
  markDirty();
}

/* ---------- SAVE BAR ---------- */
// Mounted in the chalkboard rather than the end-of-day modal. v7 §9 left an
// item open because the Fourth Quarter's bar lives only on its start screen,
// so exporting mid-campaign means reloading the page; the chalkboard is one
// click away at any point in a shift, and the modal only exists once a day.
function mountBar(){
  mountSaveBar(document.getElementById('save-bar'), saveSlot, {
    buttons: ['export', 'import'],
    getState: () => toSaveData(state),
    setState: data => adoptSave(data),
    onMessage: text => toast(text),
  });
}

/* ---------- INIT ---------- */
function init(){
  const hadSave = loadState();
  if(!hadSave){
    applyToState(state, saveSlot.fresh());
    sim.rollDailyModifier();
  } else if(!state.shiftRunning){
    // Saved between endShift() banking the day and "Start Next Shift" being
    // clicked. Today's stats aren't persisted, so there's no summary left to
    // show — advance straight to the next day instead of leaving the shop
    // paused with no way to proceed.
    sim.startNextDay();
  }
  const muteBtn = document.getElementById('muteToggle');
  if(muteBtn) muteBtn.textContent = state.muted ? '🔇' : '🔊';
  mountBar();
  for(let i=0;i<3;i++) state.queue.push(sim.generateOrder());
  renderAll();
  renderClock();
  saveNow();
  requestAnimationFrame(gameLoop);
}
init();

// Debug/test hook only — not used by the game UI itself. The last thing this
// module assigns, which is why drive-save.mjs waits on it as the signal that
// the module actually ran.
if(typeof window !== 'undefined'){
  window.__CK_DEBUG__ = {
    get state(){ return state; },
    doUnlock: buy, fireRandomEvent: sim.fireRandomEvent, generateOrder: sim.generateOrder,
    tryAcceptCustomer, orderIsComplete: sim.orderIsComplete, serveReadiness: sim.serveReadiness,
    autoAssistStep: sim.autoAssistStep, serveSlot, saveState: saveNow, loadState, adoptSave,
    queueMax: sim.queueMax,
    slot: saveSlot, catalog: CATALOG, sim,
    MARKETING_COST, SAVE_KEY, RANDOM_EVENTS, DAILY_MODIFIERS,
  };
}
