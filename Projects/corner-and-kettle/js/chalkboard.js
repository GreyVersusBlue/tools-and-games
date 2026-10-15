// chalkboard.js — the Menu Board: reputation, today's modifier, and every
// purchase in the shop as a row with a button.
//
// Render and wiring only. Whether a button is enabled is sim.canBuy(), and
// what a click does is `buy`, which ui.js points at sim.purchase(); the prices
// printed on the buttons are read off the same tables. Before Phase 4 the
// affordability test lived twice, once in the `disabled` attributes written
// here and once in the page's doUnlock(), and they were only kept in step by
// hand (#344). It imports only patch.js, which imports nothing, so it stays
// below ui.js with no cycle the way stations.js does.

import { patchRows } from "./patch.js";

/**
 * @param {object} ctx
 *   state, sim             the shop
 *   buy(type, id, extra)   make a purchase (ui.js: confirm, sim.purchase, toast, save, redraw)
 *   setPace(id)            switch the pace (ui.js: sim.setPace, toast, save, redraw)
 */
export function createChalkboard({ state, sim, buy, setPace }){
  const {
    RECIPES, FOODS, SYRUPS, TOPPINGS, STATION_UPGRADES, EQUIPMENT_UPGRADES,
    AMBIANCE_UPGRADES, BUSINESS_UPGRADES, MARKETING_COST, MARKETING_DURATION_MS,
    PRESTIGE_MIN_DAY, BARISTA_TIERS, BARISTA_MAX, BARISTA_PROMOTE_COST,
    TRAINING, TRAINING_GROUPS, MORALE_RAISE_COST, LOYALTY_UPGRADES, SHIELD_MAX_HELD, RANDOM_EVENTS,
    META_UPGRADES, PACES,
  } = sim.content;

  // `disabled`, or nothing, straight from the purchase table.
  const dis = (type, id, extra) => sim.canBuy(type, id, extra).ok ? '' : 'disabled';
  // And the price, from the same call. The tables' own `cost` fields used to
  // be printed here directly, which was fine until a Legacy unlock could take
  // 20% off the board (Phase 7, #360): a button that says $350 and charges
  // $280 is the #344 bug again, one layer down.
  const price = (type, id, extra) => sim.canBuy(type, id, extra).cost;

  // The pace switch (#947): Busy Corner or Quiet Corner, changeable at any
  // moment of a shift. Its two buttons are built once and then only their
  // state is rewritten, so a player who tabbed here stays here. The rest of
  // the board keeps the keyboard the same way since #968 (patchRows, in patch.js). Which one is on is said three ways and none
  // of them is colour: the button's words, aria-pressed, and the note under.
  let paceBuilt = false;
  function renderPace(){
    const rows = document.getElementById('paceRows');
    if(!rows) return;
    if(!paceBuilt){
      rows.innerHTML = PACES.map(p=>`<div class="chalk-item">
        <span>🚪 ${p.name} <small>${p.desc}</small></span>
        <button type="button" data-pace="${p.id}"></button>
      </div>`).join('');
      rows.querySelectorAll('[data-pace]').forEach(b=> b.onclick = ()=> setPace(b.dataset.pace));
      paceBuilt = true;
    }
    const on = sim.currentPace();
    rows.querySelectorAll('[data-pace]').forEach(b=>{
      const isOn = b.dataset.pace === on.id;
      b.setAttribute('aria-pressed', isOn ? 'true' : 'false');
      b.textContent = isOn ? '✓ On' : 'Switch';
      // The visible word first, so a voice command for what is printed finds it.
      const p = PACES.find(x=>x.id===b.dataset.pace);
      b.setAttribute('aria-label', `${isOn ? 'On' : 'Switch'}: ${p.name}. ${p.desc}`);
    });
    document.getElementById('paceNote').textContent =
      `${on.name} is on. A switch starts with the next customer. Prices, tips, reputation and beans are worked out the same on both.`;
  }

  // Every row of the board below the pace switch, as markup. Each top-level
  // element carries a data-row key naming what the row is about, which is
  // what patchRows() matches the board's rows on.
  function build(){
    const stars = sim.reputationStars();
    let html = `<div data-row="reputation" class="chalk-section">Reputation: ${'⭐'.repeat(stars)}${'☆'.repeat(5-stars)} <small>(${Math.round(state.reputation)}/100)</small></div>`;
    const dmChalk = sim.getActiveDailyModifier();
    html += `<div data-row="today" class="chalk-item"><span>📅 Today: <small>${dmChalk ? `${dmChalk.name} — ${dmChalk.desc}` : 'No special modifier'}</small></span></div>`;
    if(state.activeEvent){
      const evDef = RANDOM_EVENTS.find(e=>e.id===state.activeEvent.id);
      html += `<div data-row="event" class="chalk-item"><span>🔔 Event active: <small>${evDef?evDef.name:state.activeEvent.id}</small></span></div>`;
    }
    html += '<div data-row="h:drinks" class="chalk-section">Drinks (Menu R&amp;D)</div>';
    RECIPES.forEach(r=>{
      const unlocked = sim.recipeAvailable(r.id);
      if(r.prestigeGated){
        html += unlocked
          ? `<div data-row="recipe:${r.id}" class="chalk-item"><span>${r.icon} ${r.name} <small>($${r.price}) — yours from reopening ${r.prestigeGated}</small></span><span>✓</span></div>`
          : `<div data-row="recipe:${r.id}" class="chalk-item locked"><span>${r.icon} ${r.name} <small>($${r.price}) — comes with reopening ${r.prestigeGated}, not with money</small></span><span>🔁</span></div>`;
        return;
      }
      if(r.equipmentGated){
        if(unlocked){
          html += `<div data-row="recipe:${r.id}" class="chalk-item"><span>${r.icon} ${r.name} <small>($${r.price})</small></span><span>✓</span></div>`;
        } else {
          const eq = EQUIPMENT_UPGRADES.find(u=>u.id===r.equipmentGated);
          html += `<div data-row="recipe:${r.id}" class="chalk-item locked"><span>${r.icon} ${r.name} <small>(requires ${eq?eq.name:'equipment upgrade'})</small></span><span>🔒</span></div>`;
        }
        return;
      }
      // On the menu with its own syrup or topping not bought (#913): nobody
      // orders it, and the row says what to buy instead of a plain tick.
      const lacks = unlocked ? sim.recipeStockMissing(r.id) : [];
      if(lacks.length){
        html += `<div data-row="recipe:${r.id}" class="chalk-item" data-recipe-short="${r.id}">
          <span>${r.icon} ${r.name} <small>($${r.price}) — nobody orders it until you buy ${lacks.map(m=>`${m.name} ($${m.cost})`).join(' and ')}, below</small></span><span>⏳</span>
        </div>`;
        return;
      }
      html += `<div data-row="recipe:${r.id}" class="chalk-item ${unlocked?'':'locked'}">
        <span>${r.icon} ${r.name} <small>($${r.price})${r.requires && !unlocked ? ` — requires ${RECIPES.find(x=>x.id===r.requires).name}` : ''}</small></span>
        ${unlocked ? '<span>✓</span>' : `<button data-unlock-recipe="${r.id}" ${dis('recipe', r.id)}>Unlock $${price('recipe', r.id)}</button>`}
      </div>`;
    });
    html += '<div data-row="h:food" class="chalk-section">Food</div>';
    FOODS.forEach(f=>{
      const unlocked = state.unlockedFoods.has(f.id);
      html += `<div data-row="food:${f.id}" class="chalk-item ${unlocked?'':'locked'}">
        <span>${f.icon} ${f.name} <small>($${f.price})</small></span>
        ${unlocked ? '<span>✓</span>' : `<button data-unlock-food="${f.id}" ${dis('food', f.id)}>Unlock $${price('food', f.id)}</button>`}
      </div>`;
    });
    html += '<div data-row="h:stations" class="chalk-section">Stations</div>';
    const nextStation = STATION_UPGRADES.find(u=>u.toSlots > state.slots.length);
    if(nextStation){
      html += `<div data-row="station" class="chalk-item">
        <span>🛠️ Station Slot #${nextStation.toSlots}</span>
        <button data-unlock-station="${nextStation.toSlots}" ${dis('station', nextStation.toSlots)}>Unlock $${price('station', nextStation.toSlots)}</button>
      </div>`;
    } else {
      html += `<div data-row="station" class="chalk-item"><span>🛠️ Stations (${state.slots.length}/${state.slots.length})</span><span>✓</span></div>`;
    }
    html += '<div data-row="h:equipment" class="chalk-section">Equipment</div>';
    EQUIPMENT_UPGRADES.forEach(u=>{
      const owned = sim.hasUpgrade(u.id);
      html += `<div data-row="equipment:${u.id}" class="chalk-item ${owned?'':'locked'}">
        <span>⚙️ ${u.name} <small>${u.desc}${u.requires && !owned ? ` — requires ${EQUIPMENT_UPGRADES.find(x=>x.id===u.requires).name}` : ''}</small></span>
        ${owned ? '<span>✓</span>' : `<button data-unlock-equipment="${u.id}" ${dis('equipment', u.id)}>Unlock $${price('equipment', u.id)}</button>`}
      </div>`;
    });

    html += '<div data-row="h:ambiance" class="chalk-section">Ambiance &amp; Capacity</div>';
    AMBIANCE_UPGRADES.forEach(u=>{
      const owned = sim.hasUpgrade(u.id);
      html += `<div data-row="ambiance:${u.id}" class="chalk-item ${owned?'':'locked'}">
        <span>🎵 ${u.name} <small>${u.desc}</small></span>
        ${owned ? '<span>✓</span>' : `<button data-unlock-ambiance="${u.id}" ${dis('ambiance', u.id)}>Unlock $${price('ambiance', u.id)}</button>`}
      </div>`;
    });

    html += '<div data-row="h:business" class="chalk-section">Business</div>';
    html += `<div data-row="marketing" class="chalk-item"><span>📣 Marketing Campaign <small>+customers for ${MARKETING_DURATION_MS/1000}s, costs $${price('marketing')}</small></span>
      ${state.marketingRemaining>0
        ? `<span>active (${Math.ceil(state.marketingRemaining/1000)}s)</span>`
        : `<button data-launch-marketing="1" ${dis('marketing')}>Launch $${price('marketing')}</button>`}
    </div>`;
    BUSINESS_UPGRADES.forEach(u=>{
      const owned = sim.hasUpgrade(u.id);
      html += `<div data-row="business:${u.id}" class="chalk-item ${owned?'':'locked'}">
        <span>🏪 ${u.name} <small>${u.desc}${u.reqReputation && !owned ? ` — needs ${u.reqReputation} reputation` : ''}</small></span>
        ${owned ? '<span>✓</span>' : `<button data-unlock-business="${u.id}" ${dis('business', u.id)}>Unlock $${price('business', u.id)}</button>`}
      </div>`;
    });
    // The reopen row says what reopening pays before it is clicked; the full
    // kept/lost/earned list is the page's modal, built from sim.reopenPreview().
    const reopen = sim.reopenPreview();
    html += `<div data-row="reopen" class="chalk-item ${reopen.ok?'':'locked'}">
      <span>🔁 Prestige &amp; Reopen <small>(level ${state.prestigeLevel} → ${reopen.level}, +5% income per level;
        ${reopen.ok ? `closing now pays <b>${reopen.beansEarned} bean${reopen.beansEarned===1?'':'s'}</b>` : `available from day ${PRESTIGE_MIN_DAY}`})</small></span>
      ${reopen.ok ? '<button data-prestige="1">Reopen…</button>' : '<span>🔒</span>'}
    </div>`;

    html += `<div data-row="h:legacy" class="chalk-section">Legacy <small>(🫘 ${sim.beansHeld()} beans)</small></div>`;
    html += `<div data-row="legacy-note" class="chalk-item"><span><small>Beans are earned by reopening — one per ${sim.content.BEANS_PER_DAYS} days
      survived and one per ${sim.content.BEANS_PER_REPUTATION} reputation at close. What they buy is yours for good.</small></span></div>`;
    META_UPGRADES.forEach(m=>{
      const owned = sim.metaOwned(m.id);
      const gate = m.requires && !sim.metaOwned(m.requires) ? ` — requires ${META_UPGRADES.find(x=>x.id===m.requires).name}` : '';
      html += `<div data-row="meta:${m.id}" class="chalk-item ${owned?'':'locked'}">
        <span>🫘 ${m.name} <small>${m.desc}${owned?'':gate}</small></span>
        ${owned ? '<span>✓</span>' : `<button data-buy-meta="${m.id}" ${dis('meta', m.id)}>Buy ${price('meta', m.id)} 🫘</button>`}
      </div>`;
    });

    html += '<div data-row="h:staff" class="chalk-section">Staff</div>';
    if(state.baristas.length){
      html += `<div data-row="wages" class="chalk-item"><span><small>💵 Wages due at end of shift: <b>$${sim.wagesDue()}</b></small></span></div>`;
      // The week view (#348): who is on tomorrow, what each costs, what each
      // is trained for — `working` is tomorrow's schedule too, since it holds
      // until toggled, not just today's.
      html += `<table data-row="staff-week" class="chalk-staff-week"><thead><tr>
        <th>Barista</th><th>Tier</th><th>Trained</th><th>Morale</th><th>Tomorrow</th><th>Wage</th>
      </tr></thead><tbody>`;
      state.baristas.forEach(b=>{
        const tier = BARISTA_TIERS[b.level];
        const trainedBadges = TRAINING_GROUPS.filter(g=>b.skill && b.skill[g]>0).map(g=>TRAINING[g].name.split(' ')[0]).join(', ') || '—';
        html += `<tr>
          <td>${b.name}</td><td>${tier.name}</td><td>${trainedBadges}${b.training ? ` (training ${TRAINING[b.training].name.split(' ')[0]}…)` : ''}</td>
          <td>${Math.round(b.morale ?? 70)}/100</td>
          <td>${b.working===false ? 'Off' : 'Working'}</td><td>$${tier.wage}</td>
        </tr>`;
      });
      html += '</tbody></table>';
    }
    state.baristas.forEach(b=>{
      const tier = BARISTA_TIERS[b.level];
      const spec = sim.effectiveSpec(b);
      const specNote = spec==='bar' ? ', bar specialist' : spec==='kitchen' ? ', kitchen specialist' : '';
      const gateNote = spec ? specNote : (b.level<2 ? ', simple drinks only' : ', handles anything');
      const registerNote = b.skill && b.skill.register>0 ? ', register-trained' : '';
      html += `<div data-row="barista:${b.id}" class="chalk-item">
        <span>🧑‍🍳 ${b.name} <small>(${tier.name}${gateNote}${registerNote}, ${Math.round(tier.mistakeChance*100*sim.mistakeReduceFactor(b, spec==='kitchen'))}% mistake chance, $${tier.wage}/day wage)</small></span>
        ${b.level<2
          ? `<button data-promote-barista="${b.id}" ${dis('promoteBarista', b.id)}>Promote $${price('promoteBarista', b.id)}</button>`
          : '<span>✓</span>'}
      </div>`;
      const trainBtn = g => (b.skill && b.skill[g]>0)
        ? `<span title="${TRAINING[g].desc}">${TRAINING[g].name.split(' ')[0]} ✓</span>`
        : `<button data-train-barista="${b.id}" data-train-group="${g}" ${dis('train', b.id, g)} title="${TRAINING[g].desc}">Train ${TRAINING[g].name.split(' ')[0]}</button>`;
      const raise = sim.canBuy('raiseBarista', b.id);
      html += `<div data-row="barista-care:${b.id}" class="chalk-item"><span><small>↳ Training, morale &amp; scheduling for ${b.name}${b.training ? ` — training ${TRAINING[b.training].name} today` : ''}</small></span>
        <span>
          ${TRAINING_GROUPS.map(trainBtn).join(' ')}
          <button data-raise-barista="${b.id}" ${raise.ok?'':'disabled'} title="Morale ${Math.round(b.morale ?? 70)}/100">Raise $${raise.cost}</button>
          <button data-schedule-barista="${b.id}">${b.working===false ? 'Off today — Call in' : 'Working — Give day off'}</button>
        </span>
      </div>`;
    });
    if(state.baristas.length < BARISTA_MAX){
      const hire = sim.canBuy('hireBarista');
      html += `<div data-row="hire" class="chalk-item">
        <span>🧑‍🍳 Hire Junior Barista <small>(simple drinks only, ${Math.round(BARISTA_TIERS[1].mistakeChance*100)}% mistake chance, $${BARISTA_TIERS[1].wage}/day wage)</small></span>
        <button data-hire-barista="1" ${hire.ok?'':'disabled'}>Hire $${hire.cost}</button>
      </div>`;
    } else {
      html += `<div data-row="hire" class="chalk-item"><span>🧑‍🍳 Staff (${BARISTA_MAX}/${BARISTA_MAX})</span><span>✓</span></div>`;
    }

    html += '<div data-row="h:loyalty" class="chalk-section">Loyalty Program</div>';
    const nextLoyalty = LOYALTY_UPGRADES.find(u=>u.level > state.loyaltyLevel);
    if(state.loyaltyLevel>0){
      const cur = LOYALTY_UPGRADES[state.loyaltyLevel-1];
      html += `<div data-row="loyalty-current" class="chalk-item"><span>💳 ${cur.name} (active)</span><span>✓</span></div>`;
    }
    if(nextLoyalty){
      html += `<div data-row="loyalty-next" class="chalk-item">
        <span>💳 ${nextLoyalty.name} <small>(regulars: +${Math.round(nextLoyalty.tipBonus*100)}% tip, +${Math.round(nextLoyalty.patienceBonus*100)}% patience)</small></span>
        <button data-unlock-loyalty="${nextLoyalty.level}" ${dis('loyalty', nextLoyalty.level)}>Unlock $${price('loyalty', nextLoyalty.level)}</button>
      </div>`;
    }

    html += '<div data-row="h:shield" class="chalk-section">Streak Insurance</div>';
    const shield = sim.canBuy('shield');
    html += `<div data-row="shield" class="chalk-item"><span>🛡️ Shields held: ${state.comboShields}/${SHIELD_MAX_HELD}</span>
      <button data-buy-shield="1" ${shield.ok?'':'disabled'}>Buy $${shield.cost}</button>
    </div>`;

    html += '<div data-row="h:syrups" class="chalk-section">Syrups</div>';
    SYRUPS.forEach(s=>{
      const unlocked = state.unlockedSyrups.has(s.id);
      html += `<div data-row="syrup:${s.id}" class="chalk-item ${unlocked?'':'locked'}">
        <span>💧 ${s.name}</span>
        ${unlocked ? '<span>✓</span>' : `<button data-unlock-syrup="${s.id}" ${dis('syrup', s.id)}>Unlock $${price('syrup', s.id)}</button>`}
      </div>`;
    });
    html += '<div data-row="h:toppings" class="chalk-section">Toppings</div>';
    TOPPINGS.forEach(t=>{
      const unlocked = state.unlockedToppings.has(t.id);
      html += `<div data-row="topping:${t.id}" class="chalk-item ${unlocked?'':'locked'}">
        <span>✨ ${t.name}</span>
        ${unlocked ? '<span>✓</span>' : `<button data-unlock-topping="${t.id}" ${dis('topping', t.id)}>Unlock $${price('topping', t.id)}</button>`}
      </div>`;
    });
    return html;
  }

  function render(){
    renderPace();
    const el = document.getElementById('chalkContent');
    patchRows(el, build());

    // data attribute -> purchase type. The id is the attribute's value.
    const BINDINGS = [
      ['unlockRecipe', 'recipe'], ['unlockFood', 'food'], ['unlockSyrup', 'syrup'],
      ['unlockTopping', 'topping'], ['unlockStation', 'station'], ['promoteBarista', 'promoteBarista'],
      ['unlockLoyalty', 'loyalty'], ['unlockEquipment', 'equipment'], ['unlockAmbiance', 'ambiance'],
      ['unlockBusiness', 'business'], ['scheduleBarista', 'scheduleBarista'],
    ];
    const attr = key => 'data-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
    for(const [key, type] of BINDINGS){
      el.querySelectorAll(`[${attr(key)}]`).forEach(b=> b.onclick = ()=> buy(type, b.dataset[key]));
    }
    el.querySelectorAll('[data-hire-barista]').forEach(b=> b.onclick = ()=> buy('hireBarista'));
    el.querySelectorAll('[data-buy-shield]').forEach(b=> b.onclick = ()=> buy('shield'));
    el.querySelectorAll('[data-launch-marketing]').forEach(b=> b.onclick = ()=> buy('marketing'));
    el.querySelectorAll('[data-prestige]').forEach(b=> b.onclick = ()=> buy('prestige'));
    el.querySelectorAll('[data-buy-meta]').forEach(b=> b.onclick = ()=> buy('meta', b.dataset.buyMeta));
    el.querySelectorAll('[data-train-barista]').forEach(b=> b.onclick = ()=> buy('train', b.dataset.trainBarista, b.dataset.trainGroup));
    el.querySelectorAll('[data-raise-barista]').forEach(b=> b.onclick = ()=> buy('raiseBarista', b.dataset.raiseBarista));
  }

  return { render, html: build };
}
