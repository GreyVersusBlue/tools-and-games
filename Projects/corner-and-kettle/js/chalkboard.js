// chalkboard.js — the Menu Board: reputation, today's modifier, and every
// purchase in the shop as a row with a button.
//
// Render and wiring only. Whether a button is enabled is sim.canBuy(), and
// what a click does is `buy`, which ui.js points at sim.purchase(); the prices
// printed on the buttons are read off the same tables. Before Phase 4 the
// affordability test lived twice, once in the `disabled` attributes written
// here and once in the page's doUnlock(), and they were only kept in step by
// hand (#344). It imports nothing, for the same reason stations.js does not.

/**
 * @param {object} ctx
 *   state, sim             the shop
 *   buy(type, id, extra)   make a purchase (ui.js: confirm, sim.purchase, toast, save, redraw)
 */
export function createChalkboard({ state, sim, buy }){
  const {
    RECIPES, FOODS, SYRUPS, TOPPINGS, STATION_UPGRADES, EQUIPMENT_UPGRADES,
    AMBIANCE_UPGRADES, BUSINESS_UPGRADES, MARKETING_COST, MARKETING_DURATION_MS,
    PRESTIGE_MIN_DAY, BARISTA_TIERS, BARISTA_MAX, BARISTA_PROMOTE_COST,
    TRAINING, TRAINING_GROUPS, MORALE_RAISE_COST, LOYALTY_UPGRADES, SHIELD_MAX_HELD, RANDOM_EVENTS,
  } = sim.content;

  // `disabled`, or nothing, straight from the purchase table.
  const dis = (type, id, extra) => sim.canBuy(type, id, extra).ok ? '' : 'disabled';

  function render(){
    const el = document.getElementById('chalkContent');
    const stars = sim.reputationStars();
    let html = `<div class="chalk-section">Reputation: ${'⭐'.repeat(stars)}${'☆'.repeat(5-stars)} <small>(${Math.round(state.reputation)}/100)</small></div>`;
    const dmChalk = sim.getActiveDailyModifier();
    html += `<div class="chalk-item"><span>📅 Today: <small>${dmChalk ? `${dmChalk.name} — ${dmChalk.desc}` : 'No special modifier'}</small></span></div>`;
    if(state.activeEvent){
      const evDef = RANDOM_EVENTS.find(e=>e.id===state.activeEvent.id);
      html += `<div class="chalk-item"><span>🔔 Event active: <small>${evDef?evDef.name:state.activeEvent.id}</small></span></div>`;
    }
    html += '<div class="chalk-section">Drinks (Menu R&amp;D)</div>';
    RECIPES.forEach(r=>{
      const unlocked = state.unlockedRecipes.has(r.id);
      if(r.equipmentGated){
        if(unlocked){
          html += `<div class="chalk-item"><span>${r.icon} ${r.name} <small>($${r.price})</small></span><span>✓</span></div>`;
        } else {
          const eq = EQUIPMENT_UPGRADES.find(u=>u.id===r.equipmentGated);
          html += `<div class="chalk-item locked"><span>${r.icon} ${r.name} <small>(requires ${eq?eq.name:'equipment upgrade'})</small></span><span>🔒</span></div>`;
        }
        return;
      }
      html += `<div class="chalk-item ${unlocked?'':'locked'}">
        <span>${r.icon} ${r.name} <small>($${r.price})${r.requires && !unlocked ? ` — requires ${RECIPES.find(x=>x.id===r.requires).name}` : ''}</small></span>
        ${unlocked ? '<span>✓</span>' : `<button data-unlock-recipe="${r.id}" ${dis('recipe', r.id)}>Unlock $${r.unlockCost}</button>`}
      </div>`;
    });
    html += '<div class="chalk-section">Food</div>';
    FOODS.forEach(f=>{
      const unlocked = state.unlockedFoods.has(f.id);
      html += `<div class="chalk-item ${unlocked?'':'locked'}">
        <span>${f.icon} ${f.name} <small>($${f.price})</small></span>
        ${unlocked ? '<span>✓</span>' : `<button data-unlock-food="${f.id}" ${dis('food', f.id)}>Unlock $${f.unlockCost}</button>`}
      </div>`;
    });
    html += '<div class="chalk-section">Stations</div>';
    const nextStation = STATION_UPGRADES.find(u=>u.toSlots > state.slots.length);
    if(nextStation){
      html += `<div class="chalk-item">
        <span>🛠️ Station Slot #${nextStation.toSlots}</span>
        <button data-unlock-station="${nextStation.toSlots}" ${dis('station', nextStation.toSlots)}>Unlock $${nextStation.cost}</button>
      </div>`;
    } else {
      html += `<div class="chalk-item"><span>🛠️ Stations (${state.slots.length}/${state.slots.length})</span><span>✓</span></div>`;
    }
    html += '<div class="chalk-section">Equipment</div>';
    EQUIPMENT_UPGRADES.forEach(u=>{
      const owned = sim.hasUpgrade(u.id);
      html += `<div class="chalk-item ${owned?'':'locked'}">
        <span>⚙️ ${u.name} <small>${u.desc}${u.requires && !owned ? ` — requires ${EQUIPMENT_UPGRADES.find(x=>x.id===u.requires).name}` : ''}</small></span>
        ${owned ? '<span>✓</span>' : `<button data-unlock-equipment="${u.id}" ${dis('equipment', u.id)}>Unlock $${u.cost}</button>`}
      </div>`;
    });

    html += '<div class="chalk-section">Ambiance &amp; Capacity</div>';
    AMBIANCE_UPGRADES.forEach(u=>{
      const owned = sim.hasUpgrade(u.id);
      html += `<div class="chalk-item ${owned?'':'locked'}">
        <span>🎵 ${u.name} <small>${u.desc}</small></span>
        ${owned ? '<span>✓</span>' : `<button data-unlock-ambiance="${u.id}" ${dis('ambiance', u.id)}>Unlock $${u.cost}</button>`}
      </div>`;
    });

    html += '<div class="chalk-section">Business</div>';
    html += `<div class="chalk-item"><span>📣 Marketing Campaign <small>+customers for ${MARKETING_DURATION_MS/1000}s, costs $${MARKETING_COST}</small></span>
      ${state.marketingRemaining>0
        ? `<span>active (${Math.ceil(state.marketingRemaining/1000)}s)</span>`
        : `<button data-launch-marketing="1" ${dis('marketing')}>Launch $${MARKETING_COST}</button>`}
    </div>`;
    BUSINESS_UPGRADES.forEach(u=>{
      const owned = sim.hasUpgrade(u.id);
      html += `<div class="chalk-item ${owned?'':'locked'}">
        <span>🏪 ${u.name} <small>${u.desc}${u.reqReputation && !owned ? ` — needs ${u.reqReputation} reputation` : ''}</small></span>
        ${owned ? '<span>✓</span>' : `<button data-unlock-business="${u.id}" ${dis('business', u.id)}>Unlock $${u.cost}</button>`}
      </div>`;
    });
    if(state.day >= PRESTIGE_MIN_DAY){
      html += `<div class="chalk-item"><span>🔁 Prestige &amp; Reopen <small>(level ${state.prestigeLevel}, resets progress for a permanent +5% income each level)</small></span>
        <button data-prestige="1">Reopen</button>
      </div>`;
    }

    html += '<div class="chalk-section">Staff</div>';
    if(state.baristas.length){
      html += `<div class="chalk-item"><span><small>💵 Wages due at end of shift: <b>$${sim.wagesDue()}</b></small></span></div>`;
      // The week view (#348): who is on tomorrow, what each costs, what each
      // is trained for — `working` is tomorrow's schedule too, since it holds
      // until toggled, not just today's.
      html += `<table class="chalk-staff-week"><thead><tr>
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
      html += `<div class="chalk-item">
        <span>🧑‍🍳 ${b.name} <small>(${tier.name}${gateNote}${registerNote}, ${Math.round(tier.mistakeChance*100*sim.mistakeReduceFactor(b, spec==='kitchen'))}% mistake chance, $${tier.wage}/day wage)</small></span>
        ${b.level<2
          ? `<button data-promote-barista="${b.id}" ${dis('promoteBarista', b.id)}>Promote $${BARISTA_PROMOTE_COST}</button>`
          : '<span>✓</span>'}
      </div>`;
      const trainBtn = g => (b.skill && b.skill[g]>0)
        ? `<span title="${TRAINING[g].desc}">${TRAINING[g].name.split(' ')[0]} ✓</span>`
        : `<button data-train-barista="${b.id}" data-train-group="${g}" ${dis('train', b.id, g)} title="${TRAINING[g].desc}">Train ${TRAINING[g].name.split(' ')[0]}</button>`;
      const raise = sim.canBuy('raiseBarista', b.id);
      html += `<div class="chalk-item"><span><small>↳ Training, morale &amp; scheduling for ${b.name}${b.training ? ` — training ${TRAINING[b.training].name} today` : ''}</small></span>
        <span>
          ${TRAINING_GROUPS.map(trainBtn).join(' ')}
          <button data-raise-barista="${b.id}" ${raise.ok?'':'disabled'} title="Morale ${Math.round(b.morale ?? 70)}/100">Raise $${raise.cost}</button>
          <button data-schedule-barista="${b.id}">${b.working===false ? 'Off today — Call in' : 'Working — Give day off'}</button>
        </span>
      </div>`;
    });
    if(state.baristas.length < BARISTA_MAX){
      const hire = sim.canBuy('hireBarista');
      html += `<div class="chalk-item">
        <span>🧑‍🍳 Hire Junior Barista <small>(simple drinks only, ${Math.round(BARISTA_TIERS[1].mistakeChance*100)}% mistake chance, $${BARISTA_TIERS[1].wage}/day wage)</small></span>
        <button data-hire-barista="1" ${hire.ok?'':'disabled'}>Hire $${hire.cost}</button>
      </div>`;
    } else {
      html += `<div class="chalk-item"><span>🧑‍🍳 Staff (${BARISTA_MAX}/${BARISTA_MAX})</span><span>✓</span></div>`;
    }

    html += '<div class="chalk-section">Loyalty Program</div>';
    const nextLoyalty = LOYALTY_UPGRADES.find(u=>u.level > state.loyaltyLevel);
    if(state.loyaltyLevel>0){
      const cur = LOYALTY_UPGRADES[state.loyaltyLevel-1];
      html += `<div class="chalk-item"><span>💳 ${cur.name} (active)</span><span>✓</span></div>`;
    }
    if(nextLoyalty){
      html += `<div class="chalk-item">
        <span>💳 ${nextLoyalty.name} <small>(regulars: +${Math.round(nextLoyalty.tipBonus*100)}% tip, +${Math.round(nextLoyalty.patienceBonus*100)}% patience)</small></span>
        <button data-unlock-loyalty="${nextLoyalty.level}" ${dis('loyalty', nextLoyalty.level)}>Unlock $${nextLoyalty.cost}</button>
      </div>`;
    }

    html += '<div class="chalk-section">Streak Insurance</div>';
    const shield = sim.canBuy('shield');
    html += `<div class="chalk-item"><span>🛡️ Shields held: ${state.comboShields}/${SHIELD_MAX_HELD}</span>
      <button data-buy-shield="1" ${shield.ok?'':'disabled'}>Buy $${shield.cost}</button>
    </div>`;

    html += '<div class="chalk-section">Syrups</div>';
    SYRUPS.forEach(s=>{
      const unlocked = state.unlockedSyrups.has(s.id);
      html += `<div class="chalk-item ${unlocked?'':'locked'}">
        <span>💧 ${s.name}</span>
        ${unlocked ? '<span>✓</span>' : `<button data-unlock-syrup="${s.id}" ${dis('syrup', s.id)}>Unlock $${s.cost}</button>`}
      </div>`;
    });
    html += '<div class="chalk-section">Toppings</div>';
    TOPPINGS.forEach(t=>{
      const unlocked = state.unlockedToppings.has(t.id);
      html += `<div class="chalk-item ${unlocked?'':'locked'}">
        <span>✨ ${t.name}</span>
        ${unlocked ? '<span>✓</span>' : `<button data-unlock-topping="${t.id}" ${dis('topping', t.id)}>Unlock $${t.cost}</button>`}
      </div>`;
    });
    el.innerHTML = html;

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
    el.querySelectorAll('[data-train-barista]').forEach(b=> b.onclick = ()=> buy('train', b.dataset.trainBarista, b.dataset.trainGroup));
    el.querySelectorAll('[data-raise-barista]').forEach(b=> b.onclick = ()=> buy('raiseBarista', b.dataset.raiseBarista));
  }

  return { render };
}
