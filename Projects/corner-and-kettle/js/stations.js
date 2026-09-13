// stations.js — the station panel: seven tabs, the buttons inside each, the
// progress bars, and the presets tab.
//
// Render and wiring only. What a button does to a cup is sim.cupAction(), how
// long its bar runs is sim.cupActionMs(), and which tabs carry a "still
// needed" dot is sim.stationsNeedingWork(); this file draws them and plays the
// sound. It imports nothing: ui.js hands it the state, the sim and the three
// page functions it needs, which keeps it below ui.js with no cycle.

// The seven tabs. The "still needed" dot is not decided here: each ticket line
// from getOrderRequirements() names the station it is made at, and a tab gets
// a dot when one of its lines is unmet. It used to be seven hand-written
// predicates saying the same thing in different words, and the ice line had
// none (#342).
export const STATION_TAB_DEFS = [
  {id:'base', label:'☕ Base'},
  {id:'milk', label:'🥛 Milk'},
  {id:'blend', label:'🥶 Blend'},
  {id:'syrup', label:'💧 Syrup'},
  {id:'toppings', label:'✨ Top'},
  {id:'food', label:'🍪 Food'},
  {id:'presets', label:'⭐ Presets'},
];

// Button id -> [cup action, progress bar id, sound]. The bar and the sound are
// the page's; the action is the sim's.
const TIMED = {
  btnEspresso: ['pullShot', 'baseProgress', 'shot'],
  btnDrip: ['brewDrip', 'baseProgress', null],
  btnTea: ['steepTea', 'baseProgress', null],
  btnSteam: ['steamMilk', 'milkProgress', 'steam'],
  btnBlend: ['blend', 'blendProgress', 'blend'],
};

/**
 * @param {object} ctx
 *   state, sim   the shop
 *   toast(text)  a toast
 *   sound        sound.js's player
 *   renderAll()  redraw everything (and mark the save dirty)
 *   saveNow()    write the save at once — presets are the player's own work
 */
export function createStations({ state, sim, toast, sound, renderAll, saveNow }){
  const { MILKS, SYRUPS, TOPPINGS, PRESET_MAX } = sim.content;

  function currentSlot(){
    return state.slots[state.focusedSlot];
  }

  function renderStationTabs(slot){
    const bar = document.getElementById('stationTabs');
    const needs = slot ? sim.stationsNeedingWork(slot) : new Set();
    bar.innerHTML = STATION_TAB_DEFS.map((t,i)=>{
      const dot = needs.has(t.id) ? '<span class="needdot"></span>' : '';
      return `<button class="stationTab ${state.stationTab===t.id?'active':''}" data-tab="${t.id}" aria-keyshortcuts="${i+1}" title="Shortcut: ${i+1}">${t.label}${dot}</button>`;
    }).join('');
    bar.querySelectorAll('.stationTab').forEach(btn=>{
      btn.onclick = ()=> selectTab(btn.dataset.tab);
    });
  }

  function selectTab(id){
    state.stationTab = id;
    renderStationsAll();
  }

  function stationBlockHtml(tab, slot){
    const cup = slot.cup;
    switch(tab){
      case 'presets':
        if(slot.food) return `<div class="stationBlock"><h3>⭐ Presets</h3><div class="draghint">Presets are for drinks — this is a food order.</div></div>`;
        return `
      <div class="stationBlock">
        <h3>⭐ Presets</h3>
        <div class="draghint">Save a drink build to instantly re-apply it later.</div>
        <div class="btnrow" style="margin-top:6px;">
          ${state.presets.map(p=>`
            <button class="actionbtn" data-apply-preset="${p.id}">⭐ ${p.name}</button>
          `).join('')}
          <button class="actionbtn" id="btnSavePreset">💾 Save Current</button>
        </div>
        ${state.presets.length ? `<div class="btnrow" style="margin-top:6px;">
          ${state.presets.map(p=>`<button class="actionbtn" data-delete-preset="${p.id}" style="opacity:0.7;">✕ ${p.name}</button>`).join('')}
        </div>` : ''}
      </div>`;
      case 'base':
        return `
      <div class="stationBlock">
        <h3>☕ Base</h3>
        <div class="btnrow">
          <button class="actionbtn" id="btnEspresso">☕ Pull Espresso Shot</button>
          <button class="actionbtn" id="btnDrip">🫖 Brew Drip Coffee</button>
          <button class="actionbtn" id="btnTea">🍵 Steep Tea</button>
        </div>
        <div class="draghint">Shots in cup: ${cup.shots} ${cup.base? '· base: '+cup.base : ''}</div>
        <div class="progresswrap"><div class="progressfill" id="baseProgress"></div></div>
      </div>`;
      case 'milk':
        return `
      <div class="stationBlock">
        <h3>🥛 Milk</h3>
        <div class="btnrow">${MILKS.map(m=>
          `<button class="actionbtn ${cup.milk===m.id?'selected':''}" data-milk="${m.id}">${m.name}</button>`
        ).join('')}</div>
        <div class="btnrow" style="margin-top:8px;">
          <button class="actionbtn" id="btnSteam" ${!cup.milk?'disabled':''}>🔥 Steam Milk</button>
          <button class="actionbtn" id="btnColdPour" ${!cup.milk?'disabled':''}>🥶 Pour Cold</button>
          <button class="actionbtn" id="btnIce">🧊 ${cup.ice? 'Remove Ice':'Add Ice'}</button>
        </div>
        <div class="progresswrap"><div class="progressfill" id="milkProgress"></div></div>
      </div>`;
      case 'blend':
        return `
      <div class="stationBlock">
        <h3>🥶 Blend</h3>
        <div class="draghint">For frozen drinks — add a base + milk first, then blend.</div>
        <div class="btnrow" style="margin-top:8px;">
          <button class="actionbtn" id="btnBlend">🥤 Blend!</button>
        </div>
        <div class="progresswrap"><div class="progressfill" id="blendProgress"></div></div>
      </div>`;
      case 'syrup':
        return `
      <div class="stationBlock">
        <h3>💧 Syrup</h3>
        <div class="btnrow">${SYRUPS.filter(s=>state.unlockedSyrups.has(s.id)).map(s=>
          `<button class="actionbtn ${cup.syrup===s.id?'selected':''}" data-syrup="${s.id}">💧 ${s.name}</button>`
        ).join('')}${cup.syrup? `<button class="actionbtn" id="btnClearSyrup">✕ Remove Syrup</button>`:''}</div>
      </div>`;
      case 'toppings':
        return `
      <div class="stationBlock">
        <h3>✨ Toppings</h3>
        <div class="draghint">Tap a topping to add it. Tap again to remove it.</div>
        <div class="btnrow" style="margin-top:6px;">${TOPPINGS.filter(t=>state.unlockedToppings.has(t.id)).map(t=>
          `<button class="actionbtn ${cup.toppings.includes(t.id)?'selected':''}" data-topping="${t.id}">✨ ${t.name}</button>`
        ).join('')}</div>
        <div class="draghint">On cup: ${cup.toppings.map(t=>TOPPINGS.find(x=>x.id===t).name).join(', ')||'none'}</div>
      </div>`;
      case 'food':
        return `
      <div class="stationBlock">
        <h3>🍪 Food</h3>
        <div class="btnrow">${sim.getUnlockedFoodList().map(f=>
          `<button class="actionbtn ${slot.foodPlated===f.id?'selected':''}" data-food="${f.id}">${f.icon} Plate ${f.name}</button>`
        ).join('')}</div>
        <div class="draghint">Only useful when serving a food order.</div>
      </div>`;
    }
    return '';
  }

  function renderStationsAll(){
    const content = document.getElementById('stationsAll');
    const slot = currentSlot();
    renderStationTabs(slot);

    if(!slot){
      content.innerHTML = `<div class="draghint">No order in this station yet. Tap a waiting customer above to start one here.</div>`;
      return;
    }
    content.innerHTML = stationBlockHtml(state.stationTab, slot);
    attachStationHandlers();
  }

  function attachStationHandlers(){
    const slot = currentSlot();
    if(!slot) return;
    // The cup the click started on. A bar still running when the cup is
    // dumped lands in the dumped cup, not the fresh one.
    const cup = slot.cup;
    const act = (action, value) => {
      const text = sim.cupAction(slot, action, value, cup);
      if(text) toast(text);
      return text;
    };

    const saveBtn = document.getElementById('btnSavePreset');
    if(saveBtn) saveBtn.onclick = saveCurrentAsPreset;
    document.querySelectorAll('[data-apply-preset]').forEach(btn=>{
      btn.onclick = ()=> applyPreset(btn.dataset.applyPreset);
    });
    document.querySelectorAll('[data-delete-preset]').forEach(btn=>{
      btn.onclick = (e)=>{ e.stopPropagation(); deletePreset(btn.dataset.deletePreset); };
    });

    for(const [id, [action, barId, noise]] of Object.entries(TIMED)){
      const btn = document.getElementById(id);
      if(btn) btn.onclick = ()=> runProgress(barId, sim.cupActionMs(action), ()=>{
        act(action);
        if(noise) sound[noise]();
        renderAll();
      });
    }

    document.querySelectorAll('[data-milk]').forEach(btn=>{
      btn.onclick = ()=>{ act('pickMilk', btn.dataset.milk); renderAll(); };
    });
    const coldBtn = document.getElementById('btnColdPour');
    if(coldBtn) coldBtn.onclick = ()=>{ act('pourCold'); renderAll(); };
    const iceBtn = document.getElementById('btnIce');
    if(iceBtn) iceBtn.onclick = ()=>{ act('toggleIce'); renderAll(); };

    document.querySelectorAll('[data-syrup]').forEach(btn=>{
      btn.onclick = ()=>{ act('pickSyrup', btn.dataset.syrup); renderAll(); };
    });
    const clearBtn = document.getElementById('btnClearSyrup');
    if(clearBtn) clearBtn.onclick = ()=>{ act('clearSyrup'); renderAll(); };

    document.querySelectorAll('[data-topping]').forEach(btn=>{
      btn.onclick = ()=>{ act('toggleTopping', btn.dataset.topping); renderAll(); };
    });

    document.querySelectorAll('[data-food]').forEach(btn=>{
      btn.onclick = ()=>{ act('plateFood', btn.dataset.food); renderAll(); };
    });
  }

  // A station's progress bar, on performance.now(). It is a bar, not the
  // game: the sim does not wait on it, and the action lands when it fills.
  function runProgress(elId, duration, cb){
    const el = document.getElementById(elId);
    if(!el){ cb(); return; }
    let start = performance.now();
    function step(now){
      let pct = Math.min(100, ((now-start)/duration)*100);
      el.style.width = pct+'%';
      if(pct<100) requestAnimationFrame(step);
      else cb();
    }
    requestAnimationFrame(step);
  }

  /* ---------- presets ---------- */
  function saveCurrentAsPreset(){
    const slot = currentSlot();
    if(!slot || slot.food){ toast('Build a drink first, then save it as a preset'); return; }
    if(state.presets.length >= PRESET_MAX){ toast(`Preset slots full (max ${PRESET_MAX}) — delete one first`); return; }
    const name = window.prompt('Name this preset (e.g. "Oat Vanilla Latte"):');
    if(!name) return;
    const cup = slot.cup;
    state.presets.push({
      id: 'p'+Date.now(),
      name: name.slice(0,24),
      cup: {
        base: cup.base, shots: cup.shots, milk: cup.milk, milkSteamed: cup.milkSteamed,
        syrup: cup.syrup, toppings: [...cup.toppings], ice: cup.ice, blended: cup.blended,
      }
    });
    toast('Preset saved ⭐');
    renderAll();
    saveNow();
  }

  function applyPreset(id){
    const slot = currentSlot();
    if(!slot || slot.food) return;
    const preset = state.presets.find(p=>p.id===id);
    if(!preset) return;
    const src = preset.cup;
    slot.cup = { base: src.base, shots: src.shots, milk: src.milk, milkSteamed: src.milkSteamed,
      syrup: src.syrup, toppings: [...src.toppings], ice: src.ice, blended: src.blended };
    toast(`Applied "${preset.name}"`);
    renderAll();
  }

  function deletePreset(id){
    state.presets = state.presets.filter(p=>p.id!==id);
    renderAll();
    saveNow();
  }

  return { renderStationsAll, selectTab, currentSlot };
}
