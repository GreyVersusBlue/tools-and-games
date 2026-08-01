// engine.js — Daredevil's runtime.
//
// Split out of daredevil_r4.html's inline module script in the round-2
// restructure; see Claude Prompts/notes/13-daredevil-notes.md for the full
// account and js/README.md for the file map. Screen management, scene
// rendering, the four free-roam hubs, the three canvas minigames (the Stunt
// Run, the Recovery, and — new this round — Work the Crowd, finally wired to
// a call site), the epilogue, and the boot block that used to sit at the
// bottom of the monolith's <script type="module">, unchanged in behavior.
//
// This is a module, so nothing here is global. window.__dd at the bottom is
// the deliberate door for Projects/daredevil/test/'s driver.
"use strict";

import { createDaredevilSlot, mountSaveBar, STAT_NAMES, STAT_MAX } from './save.js';
import { GS, STAT_LABELS, N, C, D } from './state.js';
import { SCENES } from './scenes.js';

/* ================================================================
   SCREEN MANAGEMENT
   ================================================================ */
const screens = {};
['title','setup','panel','stats','minigame','hub','end'].forEach(id=>{
  screens[id] = document.getElementById('screen-'+id);
});

function showScreen(id){
  Object.values(screens).forEach(s=>s.classList.remove('active'));
  if(screens[id]) screens[id].classList.add('active');
  window.scrollTo(0,0);
  // 'panel' is persisted by goToScene, which is the thing that knows the scene
  // id. Title, setup, the stat-update card and the minigame are all transient:
  // a reload during any of them should land on the scene or hub around it, not
  // half-way through a jump.
  if(id === 'hub' || id === 'end') persist(id);
}

/* ================================================================
   PERSISTENCE  (see Projects/daredevil/js/save.js for the format)
   ================================================================ */
const slot = createDaredevilSlot();

/** Write the run to storage. `screen` is where a resume should land. */
function persist(screen){
  GS.scene = currentScene;
  GS.screen = screen;
  slot.save({
    name: GS.name, town: GS.town,
    stats: { ...GS.stats }, rels: { ...GS.rels }, flags: { ...GS.flags },
    scene: currentScene, screen,
  });
}

/** Put a loaded save back into GS and jump to where it left off. */
function applyState(s){
  GS.name = s.name; GS.town = s.town;
  GS.stats = { ...s.stats };
  GS.rels  = { ...s.rels };
  GS.flags = { ...s.flags };
  GS.scene = s.scene; GS.screen = s.screen;
  patchDynamicScenes();
  updateStatsHUD();
  if(s.screen === 'end') return showGameEnd();
  if(s.screen === 'hub') return goToScene(currentHubRoute());
  goToScene(s.scene);
}

function showSetup(){ showScreen('setup'); }

function startGame(){
  const nm = document.getElementById('inp-name').value.trim();
  const tw = document.getElementById('inp-town').value.trim();
  if(nm) GS.name = nm;
  if(tw) GS.town = tw;
  // patch dynamic scene text
  patchDynamicScenes();
  showChapter('Cold Open','Childhood Montage','Every daredevil has a moment. This is where it starts.','Begin','cold_open_01');
}

function patchDynamicScenes(){
  // Update any scene text that uses GS.name or GS.town
  const n=GS.name, t=GS.town;
  if(SCENES.cold_open_01) SCENES.cold_open_01.lines[0] = N(`There's a place in ${t} where the county road dips before the bridge. On a bike, if you hit it right, you leave the ground.`);
  if(SCENES.cold_open_02){
    SCENES.cold_open_02.bgText = `${t}`;
    SCENES.cold_open_02.lines[0] = N(`${t} had a grain elevator, two churches, and one stoplight that nobody paid much attention to. It had a fairground that smelled like cut grass and motor oil every summer.`);
  }
  if(SCENES.cold_open_08) SCENES.cold_open_08.lines[0] = N(`The ${t} Fair. August. Hot the way August is hot in the middle of the country, like the air forgot to move.`);
  if(SCENES.fr1_organizer) SCENES.fr1_organizer.lines[0] = N(`Lloyd Perkins had run the booking side of the ${t} Fair for eleven years. He had a clipboard, a short-sleeved button-up, and the careful confidence of a man who was a big fish in a pond he understood precisely.`);
}

/* ================================================================
   CHAPTER TRANSITION
   ================================================================ */
function showChapter(eyebrow, title, desc, btnText, gotoScene){
  const ct = document.getElementById('chapter-transition');
  document.getElementById('ct-eyebrow').textContent = eyebrow;
  document.getElementById('ct-title').textContent = title;
  document.getElementById('ct-desc').textContent = desc;
  const btn = document.getElementById('ct-btn');
  btn.textContent = btnText||'Continue';
  btn.onclick = ()=>{
    ct.classList.remove('visible');
    setTimeout(()=> gotoScene && goToScene(gotoScene), 400);
  };
  ct.classList.add('visible');
}

/* ================================================================
   SCENE RENDERING
   ================================================================ */
let currentScene = null;
let currentLineIndex = 0;
let currentLines = [];

function goToScene(id){
  // Handle special routing
  if(id === '_chapter_m1'){
    showChapter('Milestone 1','The County Fair',`Three cows. A few hundred people. One man he'd heard was coming to look.`,'Take the Stage','m1_rival_rumor');
    return;
  }
  if(id === '_chapter_fr1'){
    // apply post-fair stat block
    triggerStatUpdate({
      title:'After the Fair',
      reason:'The crowd saw something. Earl noticed. Now the waiting starts.',
      deltas:{},
      rels:{},
      flags:{}
    }, 'fr1_hub_open');
    return;
  }
  if(id === '_hub_fr1'){
    showHub();
    return;
  }
  if(id === '_minigame_stunt_m1'){
    launchMinigame('run', 'cows', handleStuntRunResult);
    return;
  }
  if(id === '_minigame_crowd_m1'){
    launchMinigame('crowd', null, handleCrowdM1Result);
    return;
  }
  if(id === '_chapter_m2'){
    let entryScene = 'm2_entry';
    if(GS.flags.stuntOutcome === 'crash_bad'){
      entryScene = 'm2_entry_recovery';
    } else if(GS.flags.hubEveningsUsed >= 3){
      entryScene = 'm2_entry_waited';
    }
    showChapter('Milestone 2','The Investor Offer',`Earl Maddox is waiting. The contract is on the table.`,'Take the Meeting', entryScene);
    return;
  }
  if(id === '_chapter_fr2'){
    triggerStatUpdate({
      title:'The Deal Is Real',
      reason:'You signed. Earl shook your hand. Cal picked up his jacket. Now comes the work.',
      deltas:{},
      rels:{},
      flags:{ m2Complete: true }
    }, 'fr2_hub_open');
    return;
  }
  if(id === '_hub_fr2'){
    showHubFR2();
    return;
  }
  if(id === '_chapter_fr2_end'){
    triggerStatUpdate({
      title:'Free Roam 2 Complete',
      reason:'The act got bigger. Some things held. Some things shifted. Milestone 3 is on the calendar.',
      deltas:{},
      rels:{},
      flags:{ fr2Complete: true }
    }, 'fr2_close');
    return;
  }
  if(id === '_chapter_m3'){
    showChapter('Milestone 3','The Big Break',`Five cars. A stadium lot. A TV crew on a scaffold. This is what bigger looks like.`,'Take the Run','m3_entry');
    return;
  }
  if(id === '_game_end'){
    showGameEnd();
    return;
  }
  if(id === '_chapter_fr3'){
    triggerStatUpdate({
      title:'The Big Break — Complete',
      reason:"Five cars. That was the show. Now there's whatever comes after five cars.",
      deltas:{},
      rels:{},
      flags:{ fr3Started:true }
    }, 'fr3_hub_open');
    return;
  }
  if(id === '_hub_fr3'){
    showHubFR3();
    return;
  }
  if(id === '_chapter_m4'){
    showChapter('Milestone 4','The Defining Moment',`The next stunt is on the table. Earl has proposals. The decision is yours.`,'See the Options','m4_entry');
    return;
  }
  if(id === '_m4_launch'){
    const choice = GS.flags.m4Choice;
    if(choice === 'symbolic'){
      goToScene('m4_triumph_symbolic');
    } else {
      const scale = choice === 'inferno' ? 'cars' : 'buses';
      launchMinigame('run', scale, handleStuntRunM4);
    }
    return;
  }
  if(id === '_m4_prestunt_route'){
    // Priority: Cal loyal → Ruthie solid → Pete active → Earl active → Nobody
    const peteActive = GS.rels.pete && GS.rels.pete !== 'absent' && GS.rels.pete !== 'unknown';
    const earlActive = GS.rels.earl && GS.rels.earl !== 'absent' && GS.rels.earl !== 'unknown';
    if(GS.rels.cal === 'loyal'){
      goToScene('m4_prestunt_cal_m4');
    } else if(GS.rels.ruthie === 'solid'){
      goToScene('m4_prestunt_ruthie_m4');
    } else if(peteActive){
      goToScene('m4_prestunt_pete_m4');
    } else if(earlActive){
      goToScene('m4_prestunt_earl_m4');
    } else {
      goToScene('m4_prestunt_nobody_m4');
    }
    return;
  }
  if(id === '_minigame_stunt_m3'){
    // Four choices across the three M3 pre-stunt scenes point here and nothing
    // answered. goToScene() console.warned and returned, so "Go" left the choice
    // buttons on screen and did nothing — the run ended there for every player.
    launchMinigame('run', 'cars', handleStuntRunM3);
    return;
  }
  if(id === '_m3_prestunt'){
    if(GS.rels.cal === 'loyal'){
      goToScene('m3_prestunt_cal');
    } else if(GS.rels.ruthie === 'solid'){
      goToScene('m3_prestunt_ruthie');
    } else {
      goToScene('m3_prestunt_alone');
    }
    return;
  }
  if(id === '_m3_recovery_then_fail'){
    launchMinigame('recovery', null, ()=>{
      goToScene('m3_failure_bad_after');
    });
    return;
  }
  if(id === '_fr3_ruthie_route'){
    // FR3 Ruthie split: if ruthieAsked, go to already_asked version
    if(GS.flags.ruthieAsked){
      goToScene('fr3_ruthie_already_asked');
    } else {
      // Should not reach here if scene has choices; safety fallback
      goToScene('fr3_ruthie_honest');
    }
    return;
  }
  if(id === '_chapter_fr4'){
    triggerStatUpdate({
      title:'Milestone 4 — Complete',
      reason:'The defining moment. Whatever comes next is different from what came before.',
      deltas:{},
      rels:{},
      flags:{ fr4Started:true }
    }, 'fr4_hub_open');
    return;
  }
  if(id === '_chapter_fr4_failure'){
    triggerStatUpdate({
      title:'Down.',
      reason:"He got up. That's what happened first. What comes after takes longer.",
      deltas:{},
      rels:{},
      flags:{ fr4Started:true, fr4Failure:true }
    }, 'fr4_hub_open_failure');
    return;
  }
  if(id === '_hub_fr4'){
    showHubFR4();
    return;
  }
  if(id === '_chapter_m5'){
    showChapter('Milestone 5','The Question',`Vegas. The circuit. The county fair. The question that's been building since the beginning.`,'Face It','m5_entry');
    return;
  }
  if(id === '_m5_question_route'){
    // Route to whichever character has highest relationship, with fallback
    const calActive = GS.rels.cal === 'loyal' || GS.rels.cal === 'warm';
    const ruthieActive = GS.rels.ruthie === 'solid' || GS.rels.ruthie === 'warm';
    const earlActive = GS.rels.earl === 'mentor';
    const peteActive = GS.rels.pete && GS.rels.pete !== 'absent' && GS.rels.pete !== 'unknown';
    if(calActive && GS.flags.calAskedTheQuestion){
      goToScene('m5_question_cal');
    } else if(ruthieActive){
      goToScene('m5_question_ruthie');
    } else if(calActive){
      goToScene('m5_question_cal');
    } else if(earlActive){
      goToScene('m5_question_earl');
    } else {
      goToScene('m5_question_nobody');
    }
    return;
  }
  if(id === '_minigame_stunt_m5'){
    launchMinigame('run', 'buses', handleStuntRunM5);
    return;
  }

  const scene = SCENES[id];
  if(!scene){
    // Loud, not a console.warn nobody reads. An unrouted id used to leave the
    // previous screen's buttons sitting there doing nothing, which is how
    // `_minigame_stunt_m3` ended every run in the game for as long as it
    // shipped. A dead end should look like one. (Locked decision #13.)
    console.error('Daredevil: no scene or route for "' + id + '"');
    reportDeadEnd(id);
    return;
  }

  currentScene = id;
  showScreen('panel');
  renderScene(scene);
  persist('panel');
}

/** A routing hole, shown to the player instead of silently doing nothing. */
function reportDeadEnd(id){
  const actEl = document.getElementById('panel-actions');
  if(!actEl) return;
  actEl.innerHTML = '';
  const note = document.createElement('div');
  note.style.cssText = 'font-size:12px;color:var(--oxblood);font-weight:600;padding:10px 0;';
  note.textContent = `This path is not wired up (${id}). Please report it.`;
  actEl.appendChild(note);
}

function renderScene(scene){
  // Check for gateRoute redirect (e.g. ruthieAsked splits fr3_eve_ruthie)
  if(scene._gateRoute){
    const redirect = scene._gateRoute();
    if(redirect){ goToScene(redirect); return; }
  }

  // Art area
  document.getElementById('panel-art-label').textContent = scene.artLabel||'';
  document.getElementById('panel-art-bg-text').textContent = scene.bgText||'';
  document.getElementById('panel-art').style.background = getArtBg(scene.art);

  // Build full line list, injecting dynamic lines
  currentLines = buildLines(scene);
  currentLineIndex = 0;

  updateStatsHUD();
  showCurrentLine();
}

function buildLines(scene){
  let raw = [...(scene.lines||[])];
  // Resolve any function-based lines
  let lines = raw.map(line => {
    if(typeof line.text === 'function') return { speaker: line.speaker, text: line.text() };
    if(line._fn) return { speaker: null, text: line._fn() };
    return line;
  }).filter(line => line.text !== null && line.text !== '');

  // Dynamic: Earl approach modifiers
  if(scene._dynamic && currentScene === 'm1_earl_modifiers'){
    if(GS.flags.pressAtFair){
      lines.push(N(`Earl glanced toward the press man with the notepad.`));
      lines.push(C('EARL',`That fellow writes for the Register?`));
      lines.push(D(`Covering the fair.`));
      lines.push(C('EARL',`He'll write about this. That changes some things.`));
      lines.push(N(`Earl looked back at Duke. The word leverage went through Duke's head without him saying it.`));
    }
    if(GS.flags.dannyMet || GS.flags.dannySchemed){
      lines.push(N(`Earl's eyes had moved across the crowd. He'd found Danny in it.`));
      lines.push(C('EARL',`Diamondback. He's good.`));
      lines.push(N(`A beat.`));
      lines.push(C('EARL',`You're interesting. There's a difference.`));
    }
  }

  // Inject ruthieDontKnow line at M4 pre-stunt Ruthie scene
  if(currentScene === 'm4_prestunt_ruthie_m4' && GS.flags.ruthieDontKnow){
    // Insert before first Ruthie dialogue — find the insertion point
    const ruthieIdx = lines.findIndex(l => l.speaker === 'RUTHIE');
    const insertAt = ruthieIdx > 0 ? ruthieIdx : 1;
    lines.splice(insertAt, 0,
      N(`He heard her voice — not from the car, not from anywhere. Just there, in the space between the truck and the ramp.`),
      N(`You don't have to know why. You just have to know that you do.`),
      N(`He stood with it for a moment. He thought: she said that months ago on a porch. He thought: she was right.`)
    );
  }

  // Inject origin trait line at stunt approach
  if(currentScene === 'm1_stunt_approach'){
    const trait = GS.flags.originTrait;
    const traitLines = {
      fearless: N(`He thought about the other side of the ramp. He always thought about the other side.`),
      haunted: N(`He waited for the voice that asked if he'd back out. He waited. It didn't come. That was the best part.`),
      performer: N(`He looked at the crowd. He knew where the press man was standing. He'd clocked him when he arrived.`),
      ironborn: N(`His shoulder had been wrong all week. It wasn't going to matter in about eight seconds.`),
    };
    if(trait && traitLines[trait]) lines.push(traitLines[trait]);
    lines.push(N(`He revved the engine once.`));
    lines.push(N(`Then he went.`));
  }

  return lines;
}

function showCurrentLine(){
  if(currentLineIndex >= currentLines.length){
    // Show choices or next button
    showSceneEnd();
    return;
  }
  const line = currentLines[currentLineIndex];
  const speakerEl = document.getElementById('speaker-tag');
  const textEl = document.getElementById('panel-text');

  if(line.speaker){
    speakerEl.textContent = line.speaker;
    speakerEl.className = 'speaker-tag';
  } else {
    speakerEl.textContent = 'Narration';
    speakerEl.className = 'speaker-tag narration';
  }
  textEl.textContent = line.text;

  // Progress bar
  const pct = currentLines.length > 1 ? (currentLineIndex/(currentLines.length-1))*100 : 100;
  document.getElementById('panel-progress').style.width = pct+'%';

  // Actions
  const actEl = document.getElementById('panel-actions');
  actEl.innerHTML = '';
  const btn = document.createElement('button');
  btn.className = 'panel-continue';
  btn.textContent = currentLineIndex < currentLines.length-1 ? 'Continue ›' : 'Continue ›';
  btn.onclick = ()=>{ currentLineIndex++; showCurrentLine(); };
  actEl.appendChild(btn);
}

function showSceneEnd(){
  const scene = SCENES[currentScene];
  if(!scene) return;

  // Update progress to 100%
  document.getElementById('panel-progress').style.width = '100%';

  const actEl = document.getElementById('panel-actions');
  actEl.innerHTML = '';

  if(scene.choices && scene.choices.length > 0){
    // Show choices
    document.getElementById('speaker-tag').className = 'speaker-tag narration';
    document.getElementById('speaker-tag').textContent = 'Your Move';
    document.getElementById('panel-text').textContent = '';

    const list = document.createElement('div');
    list.className = 'choices-list';
    scene.choices.forEach(ch=>{
      if(ch._requires && !ch._requires()) return; // gate
      // Stat gate check
      const locked = ch._gateCheck && !ch._gateCheck();
      const btn = document.createElement('button');
      btn.className = 'choice-btn' + (locked ? ' disabled' : '');
      const label = ch.label ? `<span class="choice-label">Option ${ch.label}</span>` : '';
      const sub = ch.subtext ? `<br><span style="font-size:11px;color:var(--cream-faint);font-weight:400">${ch.subtext}</span>` : '';
      const lockNote = locked && ch._gateReason ? `<br><span style="font-size:11px;color:var(--oxblood);font-weight:600">🔒 ${ch._gateReason}</span>` : '';
      btn.innerHTML = `${label}${ch.text}${sub}${lockNote}`;
      if(!locked) btn.onclick = ()=> handleChoice(ch);
      list.appendChild(btn);
    });
    actEl.appendChild(list);
  } else {
    // Continue button
    const btn = document.createElement('button');
    btn.className = 'panel-continue';
    btn.textContent = '— Continue —';
    btn.onclick = ()=> afterScene(scene);
    actEl.appendChild(btn);
  }
}

function handleChoice(choice){
  // Apply effects
  if(choice.effects) applyEffects(choice.effects);

  // Check if scene has a stat update tied to a specific choice goto
  const targetScene = SCENES[choice.goto];

  if(targetScene && targetScene.statUpdate){
    triggerStatUpdate({...targetScene.statUpdate, rels: targetScene.statUpdate.rels||{}, flags: targetScene.statUpdate.flags||{}}, choice.goto);
  } else {
    goToScene(choice.goto);
  }
}

/** Which hub the story is currently in. One source of truth: a scene falling
 *  off the end of its chapter and a save being resumed both ask this. */
function currentHubRoute(){
  if(GS.flags.fr4Started) return '_hub_fr4';
  if(GS.flags.fr3Started) return '_hub_fr3';
  if(GS.flags.fr2Complete || GS.flags.m2Complete) return '_hub_fr2';
  return '_hub_fr1';
}

function afterScene(scene){
  if(!scene) return;
  const defaultNext = currentHubRoute();
  if(scene.statUpdate){
    const su = scene.statUpdate;
    triggerStatUpdate({...su, rels: su.rels||{}, flags: su.flags||{}}, scene.next || defaultNext);
  } else {
    goToScene(scene.next || defaultNext);
  }
}

function getArtBg(art){
  const bgs = {
    cold_open:'linear-gradient(180deg,#2a1d12,#1a110a)',
    milestone1:'linear-gradient(160deg,#2a1808,#1c100a)',
    stunt:'linear-gradient(180deg,#3a2010,#0a0805)',
    fr1:'linear-gradient(180deg,#1a1a1a,#121210)',
    m2:'linear-gradient(160deg,#1a1408,#2a1c0a,#0c0c08)',
    fr2:'linear-gradient(180deg,#0e1a10,#1a2015)',
    m3:'linear-gradient(160deg,#1a0808,#2a1010,#0a0808)',
    fr3:'linear-gradient(180deg,#0a1020,#151825,#080e18)',
    m4:'linear-gradient(160deg,#1a1000,#2a2008,#0a0800)',
    fr4:'linear-gradient(180deg,#101820,#1a2830,#080e14)',
    m5:'linear-gradient(160deg,#0a0a18,#181828,#0a0a14)',
  };
  return bgs[art]||bgs.cold_open;
}

function applyEffects(effects){
  if(!effects) return;
  if(effects.stats){
    for(const [k,v] of Object.entries(effects.stats)){
      if(GS.stats[k]!==undefined){
        GS.stats[k] = Math.max(0, Math.min(STAT_MAX, GS.stats[k]+v));
      }
    }
  }
  if(effects.rels){
    for(const [k,v] of Object.entries(effects.rels)){
      GS.rels[k] = v;
    }
  }
  if(effects.flags){
    for(const [k,v] of Object.entries(effects.flags)){
      GS.flags[k] = v;
    }
  }
}

/* ================================================================
   STAT UPDATE SCREEN
   ================================================================ */
let _afterStatsTarget = null;
let _pendingDeltas = {};
let _beforeStats = {};

function triggerStatUpdate(update, afterTarget){
  _afterStatsTarget = afterTarget;
  _beforeStats = {...GS.stats};
  _pendingDeltas = update.deltas||{};

  // Apply flags and rels right away (not stats — those animate)
  if(update.rels) for(const[k,v] of Object.entries(update.rels)) GS.rels[k]=v;
  if(update.flags) for(const[k,v] of Object.entries(update.flags)) GS.flags[k]=v;

  document.getElementById('stat-update-h').textContent = update.title||'— Update —';
  document.getElementById('stat-update-reason').textContent = update.reason||'';

  // Build stat bars (before state)
  const barsEl = document.getElementById('stat-bars');
  barsEl.innerHTML = '';
  STAT_NAMES.forEach(key=>{
    const before = _beforeStats[key]||0;
    const delta = _pendingDeltas[key]||0;
    const row = document.createElement('div');
    row.className = 'stat-row';
    row.innerHTML = `
      <div class="stat-row-name">${STAT_LABELS[key]}</div>
      <div class="stat-bar-track">
        <div class="stat-bar-fill ${key}" id="sbar-${key}" style="width:${(before/STAT_MAX)*100}%"></div>
      </div>
      <div class="stat-delta ${delta>0?'pos':delta<0?'neg':'zero'}" id="sdelta-${key}">
        ${delta>0?'+'+delta:delta<0?delta:'—'}
      </div>
    `;
    barsEl.appendChild(row);
  });

  // Relationship updates
  const relEl = document.getElementById('rel-update-list');
  relEl.innerHTML = '';
  if(update.rels){
    const relNames = { cal:'Cal', ruthie:'Ruthie', tommy:'Tommy', earl:'Earl', danny:'Danny' };
    const relStateNames = { loyal:'Loyal Partner', warm:'Warming Up', neutral:'Neutral', strained:'Strained', solid:'Solid', absent:'Absent', backer:'Business Deal', unknown:'—', mentor:'Mentor', antagonist:'Antagonist', poached:'Poached', frenemy:'Frenemy', nemesis:'Nemesis', ally:'Ally' };
    for(const [k,v] of Object.entries(update.rels)){
      const row = document.createElement('div');
      row.className = 'rel-row';
      row.innerHTML = `<span class="rel-row-name">${relNames[k]||k}</span><span class="rel-row-state">${relStateNames[v]||v}</span>`;
      relEl.appendChild(row);
    }
  }

  showScreen('stats');

  // Animate bars after a moment
  setTimeout(()=>{
    STAT_NAMES.forEach(key=>{
      const delta = _pendingDeltas[key]||0;
      if(delta !== 0){
        const after = Math.max(0, Math.min(STAT_MAX, (_beforeStats[key]||0)+delta));
        const bar = document.getElementById('sbar-'+key);
        if(bar) bar.style.width = (after/STAT_MAX)*100+'%';
        // fade the delta label
        setTimeout(()=>{
          const dEl = document.getElementById('sdelta-'+key);
          if(dEl){ dEl.style.opacity='0'; setTimeout(()=>{ if(dEl) dEl.style.transition='none'; },700); }
        }, 900);
      }
    });
    // Apply stat changes
    for(const[k,v] of Object.entries(_pendingDeltas)){
      if(GS.stats[k]!==undefined) GS.stats[k]=Math.max(0,Math.min(STAT_MAX, GS.stats[k]+v));
    }
  }, 300);
}

function afterStats(){
  showScreen('panel'); // clear
  if(_afterStatsTarget) goToScene(_afterStatsTarget);
}

/* ================================================================
   STATS HUD
   ================================================================ */
function updateStatsHUD(){
  const hud = document.getElementById('stats-hud');
  hud.innerHTML = '';
  STAT_NAMES.forEach(key=>{
    const chip = document.createElement('div');
    chip.className = 'stat-chip';
    chip.innerHTML = `<span class="sc-name">${STAT_LABELS[key][0]}</span><span class="sc-val">${GS.stats[key]}</span>`;
    chip.title = `${STAT_LABELS[key]}: ${GS.stats[key]}/${STAT_MAX}`;
    hud.appendChild(chip);
  });
}

/* ================================================================
   MINIGAME INTEGRATION
   ================================================================ */
const clamp=(v,a,b)=>v<a?a:v>b?b:v, lerp=(a,b,t)=>a+(b-a)*t;
const rnd=(a=1,b=0)=>b+Math.random()*(a-b), sign=v=>v<0?-1:v>0?1:0, round=Math.round, TAU=Math.PI*2;
const D2R=Math.PI/180, sin=d=>Math.sin(d*D2R), cos=d=>Math.cos(d*D2R), tan=d=>Math.tan(d*D2R);
const normDeg=a=>{ a=((a+180)%360+360)%360-180; return a; };

const SKILLS={ nerve:50, precision:50, showmanship:50, condition:50 };

function syncSkillsFromStats(){
  SKILLS.nerve = GS.stats.nerve * 20;
  SKILLS.precision = GS.stats.precision * 20;
  SKILLS.showmanship = GS.stats.showmanship * 20;
  SKILLS.condition = GS.stats.condition * 20;
}

const C_pal={ cream:'#ede3d0', creamDim:'#b09a76', faint:'#7a684c', orange:'#e0742f', orangeDim:'#9c4e22',
  gold:'#d99a2b', avocado:'#9aab4e', avocadoDim:'#5c6a2e', oxblood:'#a8392a', line:'#5a4329' };

let mgActive=null, mgRafId=0, mgLastTs=0, mgCurrentDef=null, mgCurrentOpt={scale:'cows'};
const mgKeys={};
const mgCanvas = ()=>document.getElementById('gameCanvas');
let mgCtx = null;

function getCtx(){ if(!mgCtx) mgCtx=mgCanvas().getContext('2d'); return mgCtx; }

function launchMinigame(gameId, scale, onComplete){
  syncSkillsFromStats();
  mgCurrentOpt.scale = scale||'cows';
  GS.afterMinigameHandler = onComplete;

  const defs = { run: mgStuntRunDef, recovery: mgRecoveryDef, crowd: mgCrowdDef };
  mgCurrentDef = defs[gameId]||defs.run;

  const contextTexts = {
    run_cows: `The ${GS.town} Fair. Three cows. The crowd is watching. This is what you came here to do.`,
    run_cars: `Live television. Nine cars. Nationals are watching.`,
    run_buses: `The defining moment. Everything has led here.`,
    recovery: `The body needs to remember how to work. This is the slow part.`,
    crowd: `Read the room. They're telling you what they want — if you're paying attention.`
  };
  const ctxKey = gameId==='run' ? `run_${scale}` : gameId;
  document.getElementById('mg-context-text').textContent = contextTexts[ctxKey]||'';
  document.getElementById('mg-eyebrow').textContent = gameId==='run' ? 'The Stunt' : gameId==='recovery' ? 'Recovery' : 'Work the Crowd';
  document.getElementById('stageTitle').textContent = mgCurrentDef.name;
  document.getElementById('stageTag').textContent = `N${GS.stats.nerve} P${GS.stats.precision} S${GS.stats.showmanship} C${GS.stats.condition}`;

  // Extra controls
  const ec = document.getElementById('extraControls');
  ec.innerHTML = '';
  if(mgCurrentDef.scales && gameId==='run'){
    const row = document.createElement('div'); row.className='scale-row';
    row.innerHTML='<span class="scale-lbl">Scale</span>';
    [['cows','Cows ×3'],['cars','Cars ×9'],['buses','Buses ×13']].forEach(([id,label])=>{
      const b=document.createElement('button');
      b.className='pill'+(mgCurrentOpt.scale===id?' active':''); b.textContent=label;
      b.onclick=()=>{ mgCurrentOpt.scale=id; [...row.querySelectorAll('.pill')].forEach(p=>p.classList.remove('active')); b.classList.add('active'); mgStartInstance(); };
      row.appendChild(b);
    });
    ec.appendChild(row);
  }

  showScreen('minigame');
  mgCtx = null; // reset context
  requestAnimationFrame(()=>{ mgCtx = mgCanvas().getContext('2d'); mgStartInstance(); });
}

function mgSizeCanvas(){
  const canvas=mgCanvas(); const cssW=canvas.clientWidth||canvas.parentElement.clientWidth;
  const cssH=Math.round(cssW*0.52); canvas.style.height=cssH+'px';
  const dpr=Math.min(window.devicePixelRatio||1,2);
  canvas.width=cssW*dpr; canvas.height=cssH*dpr;
  const ctx=getCtx(); ctx.setTransform(dpr,0,0,dpr,0,0); return {w:cssW,h:cssH};
}

function mgStartInstance(){
  cancelAnimationFrame(mgRafId);
  const d=mgSizeCanvas();
  mgActive=mgCurrentDef.factory(mgCurrentOpt);
  mgActive.finished_=false;
  mgActive.finish=res=>{
    if(mgActive.finished_)return; mgActive.finished_=true;
    setTimeout(()=>showMgResult(res),520);
  };
  mgActive.setControls=spec=>{ mgActive.controlSpec=spec; buildMgDeck(spec); };
  mgActive.setInstruction=t=>{ document.getElementById('instr').textContent=t; };
  if(mgActive.init) mgActive.init(d.w,d.h);
  document.getElementById('instr').textContent=mgActive.instructions||'';
  buildMgDeck(mgActive.controlSpec);
  mgLastTs=0; mgRafId=requestAnimationFrame(mgLoop);
}

function mgLoop(ts){
  if(!mgActive)return;
  if(!mgLastTs)mgLastTs=ts;
  let dt=(ts-mgLastTs)/1000; mgLastTs=ts; dt=clamp(dt,0,0.05);
  const canvas=mgCanvas();
  const w=canvas.clientWidth, h=Math.round(canvas.getBoundingClientRect().height);
  if(mgActive.update) mgActive.update(dt,w,h);
  const ctx=getCtx();
  if(mgActive.render){ ctx.clearRect(0,0,w,h); mgActive.render(ctx,w,h); }
  mgRafId=requestAnimationFrame(mgLoop);
}

function buildMgDeck(spec){
  const deckEl=document.getElementById('deck'); deckEl.innerHTML=''; if(!spec)return;
  if(spec.type==='pedals'){
    const lean=mkBtn('pedal lean','LEAN<small>brake · nose down</small>'), gas=mkBtn('pedal gas','GAS<small>throttle · nose up</small>');
    bindHold(lean,()=>mgActive&&mgActive.onLean&&mgActive.onLean(true),()=>mgActive&&mgActive.onLean&&mgActive.onLean(false));
    bindHold(gas,()=>mgActive&&mgActive.onGas&&mgActive.onGas(true),()=>mgActive&&mgActive.onGas&&mgActive.onGas(false));
    deckEl.appendChild(lean); deckEl.appendChild(gas);
  } else if(spec.type==='pad'){
    const wrap=document.createElement('div'); wrap.className='rocker'; const map={left:'◀',up:'▲',right:'▶',down:'▼'};
    spec.dirs.forEach(dir=>{ const b=mkBtn('dirbtn',map[dir]); b.dataset.dir=dir; bindHold(b,()=>mgAct(dir,true),()=>mgAct(dir,false)); wrap.appendChild(b); });
    deckEl.appendChild(wrap);
  } else if(spec.type==='choices'){
    const wrap=document.createElement('div'); wrap.className='choices';
    spec.choices.forEach(ch=>{
      const b=document.createElement('button'); b.className='choicebtn';
      b.innerHTML=ch.label+(ch.hint?'<span class="hint">'+ch.hint+'</span>':'')+'<span class="k">KEY '+ch.key+'</span>';
      if(ch.disabled) b.disabled=true;
      b.onclick=()=>mgActive&&mgActive.onChoice&&mgActive.onChoice(ch.id);
      wrap.appendChild(b);
    });
    deckEl.appendChild(wrap);
  }
}
function mkBtn(cls,html){ const b=document.createElement('button'); b.className=cls; b.innerHTML=html; b.type='button'; return b; }
function bindHold(el,onD,onU){ let on=false;
  const d=e=>{ e.preventDefault(); if(on)return; on=true; el.classList.add('held'); onD(); };
  const u=()=>{ if(!on)return; on=false; el.classList.remove('held'); onU(); };
  el.addEventListener('pointerdown',d); el.addEventListener('pointerup',u); el.addEventListener('pointercancel',u); el.addEventListener('pointerleave',u); }
function mgAct(dir,down){ if(mgActive&&mgActive.onDir) mgActive.onDir(dir,down); }

window.addEventListener('keydown',e=>{
  if(!mgActive||!screens.minigame.classList.contains('active'))return;
  const t=mgActive.controlSpec&&mgActive.controlSpec.type, c=e.code;
  if(t==='pedals'){
    if(c==='Space'||c==='ArrowRight'||c==='ArrowUp'){ e.preventDefault(); if(!mgKeys.gas){mgKeys.gas=true; mgActive.onGas&&mgActive.onGas(true); markPedal('gas',true);} }
    else if(c==='ArrowLeft'||c==='ArrowDown'){ e.preventDefault(); if(!mgKeys.lean){mgKeys.lean=true; mgActive.onLean&&mgActive.onLean(true); markPedal('lean',true);} }
  } else if(t==='pad'){
    const m={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}[c];
    if(m){ e.preventDefault(); if(!mgKeys[m]){mgKeys[m]=true; mgAct(m,true); markDir(m,true);} }
  } else if(t==='choices'){
    const i={Digit1:0,Digit2:1,Digit3:2}[c];
    const ch=mgActive.controlSpec.choices[i]; if(ch&&!ch.disabled) mgActive.onChoice&&mgActive.onChoice(ch.id);
  }
});
window.addEventListener('keyup',e=>{
  if(!mgActive)return;
  const t=mgActive.controlSpec&&mgActive.controlSpec.type, c=e.code;
  if(t==='pedals'){
    if(c==='Space'||c==='ArrowRight'||c==='ArrowUp'){ mgKeys.gas=false; mgActive.onGas&&mgActive.onGas(false); markPedal('gas',false); }
    else if(c==='ArrowLeft'||c==='ArrowDown'){ mgKeys.lean=false; mgActive.onLean&&mgActive.onLean(false); markPedal('lean',false); }
  } else if(t==='pad'){
    const m={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}[c];
    if(m){ mgKeys[m]=false; mgAct(m,false); markDir(m,false); }
  }
});
function markPedal(which,on){ const b=document.getElementById('deck').querySelector('.pedal.'+which); if(b)b.classList.toggle('held',on); }
function markDir(dir,on){ const b=document.getElementById('deck').querySelector('.dirbtn[data-dir="'+dir+'"]'); if(b)b.classList.toggle('held',on); }
window.addEventListener('resize',()=>{ if(mgActive&&screens.minigame.classList.contains('active')) mgSizeCanvas(); });

function showMgResult(res){
  cancelAnimationFrame(mgRafId);
  GS.minigameResult = res;
  const v=document.getElementById('rVerdict'); v.textContent=res.result; v.className='verdict '+res.result.toLowerCase();
  document.getElementById('rScore').textContent=res.score;
  document.getElementById('rDetail').textContent=res.details;
  document.getElementById('reporter').classList.add('on');
}

document.getElementById('rAgain').onclick=()=>{ document.getElementById('reporter').classList.remove('on'); mgStartInstance(); };
document.getElementById('rOut').onclick=()=>{
  document.getElementById('reporter').classList.remove('on');
  cancelAnimationFrame(mgRafId);
  // Call the completion handler
  if(GS.afterMinigameHandler) GS.afterMinigameHandler(GS.minigameResult);
};

/** Work the Crowd's completion handler. Placed only on the one M1 outcome
 *  where Duke is shown actively performing for the crowd; the other four
 *  outcomes (upright-but-shaky, chaos, two crash tiers) go straight to
 *  Earl as before. See notes for why this placement and not Danny's FR2
 *  head-to-head, the other candidate this session considered. */
function handleCrowdM1Result(res){
  if(res.result === 'SUCCESS') applyEffects({ stats:{ showmanship:1 } });
  goToScene('m1_earl_approach_perfect');
}

/* ---- Route stunt result to outcome scene ---- */
function handleStuntRunResult(res){
  const score = res.score;
  const result = res.result;
  let outcomeScene;

  if(result==='SUCCESS' && score>=80) outcomeScene = 'm1_stunt_perfect';
  else if(result==='SUCCESS') outcomeScene = 'm1_stunt_messy';
  else if(result==='PARTIAL') outcomeScene = 'm1_stunt_clipped';
  else {
    // FAIL — determine crash severity
    if(score<25) outcomeScene = 'm1_stunt_crash_bad';
    else outcomeScene = 'm1_stunt_crash_walk';
  }
  GS.flags.stuntOutcome = outcomeScene;

  // Route to crash minigame first if applicable
  if(outcomeScene === 'm1_stunt_crash_bad'){
    // Launch recovery minigame, then go to scene
    launchMinigame('recovery', null, (recovRes)=>{
      goToScene('m1_stunt_crash_bad');
    });
  } else {
    goToScene(outcomeScene);
  }
}

/* ================================================================
   HUB / FREE ROAM 1
   ================================================================ */
function showGameEnd(){
  showScreen('end');
  const m5Outcome = GS.flags.m5Outcome || null;
  const m5Complete = GS.flags.m5Complete || false;
  const outcome = GS.flags.m4Outcome || GS.flags.m3Outcome || 'unknown';
  const m4Stunt = GS.flags.m4Stunt || null;
  const relNames = { cal:'Cal', ruthie:'Ruthie', tommy:'Tommy', earl:'Earl Maddox', danny:'Danny', pete:'Pete' };
  const relStateNames = { loyal:'Loyal Partner', warm:'Warming Up', neutral:'Neutral', strained:'Strained', solid:'Solid', absent:'Absent', backer:'Business Partner', unknown:'—', mentor:'Mentor', antagonist:'Antagonist', poached:'Poached', frenemy:'Frenemy', nemesis:'Nemesis', ally:'Ally', hanger_on:'Hanger-On' };

  // Career track inference
  let track = 'Regional King';
  if(GS.stats.showmanship >= 4 && GS.stats.nerve >= 4 && GS.rels.earl !== 'absent'){
    track = 'The Legend';
  } else if(GS.stats.hustle >= 4 && GS.stats.showmanship >= 3){
    track = 'The Businessman';
  } else if(GS.stats.condition <= 1 || (GS.stats.nerve <= 1 && GS.stats.precision <= 1)){
    track = 'The Burnout';
  }

  const name = GS.name || 'Duke';

  // ── Expanded headline system ──────────────────────────────────
  let headlineText = '';

  // M5-specific headlines (highest priority)
  if(m5Complete){
    if(m5Outcome === 'disappear'){
      headlineText = `"He Disappeared in 1974. Some Say He's Still Out There."`;
    } else if(m5Outcome === 'walk_quiet'){
      headlineText = `"Nobody Remembers the Promoter's Handshake. They Remember the Fist."`;
    } else if(m5Outcome === 'mentor' && GS.rels.pete && GS.rels.pete !== 'absent'){
      headlineText = `"He Taught Me Everything — Danny 'Diamondback' Reeves Remembers Duke"`;
    } else if(m5Outcome === 'symbolic_own'){
      headlineText = `"${GS.town||'Buford County'}'s Own: ${name} Comes Home — And Stays"`;
    } else if(m5Outcome === 'retire_clean' && track === 'The Legend'){
      headlineText = `"${name}: America's Last Real Daredevil"`;
    } else if(m5Outcome === 'retire_clean'){
      headlineText = `"He Fell Three Times and Got Up Four — The ${name} Story"`;
    } else if(m5Outcome === 'last_stunt_win'){
      headlineText = `"The Jump That Broke Him Made Him Immortal"`;
    } else if(m5Outcome === 'last_stunt_loss'){
      headlineText = `"${name} Got Up. That's the Whole Story."`;
    } else if(m5Outcome === 'keep_going'){
      headlineText = `"${name} Made $4 Million and Spent $4.2 Million — And He'd Do It Again"`;
    } else if(m5Outcome === 'last_stunt_earl'){
      headlineText = `"Earl Maddox's Greatest Act Was a Man Named Duke"`;
    } else {
      headlineText = `"${name}: The Story Continues." — Circuit Press`;
    }
  }
  // M4 headlines (if M5 not reached)
  else if(m4Stunt === 'buses' && (outcome === 'triumph' || outcome === 'triumph_clean')){
    headlineText = `"${name}: America's Last Real Daredevil" — Circuit Press`;
  } else if(m4Stunt === 'symbolic'){
    headlineText = `"${GS.town||'Buford County'}'s Own: ${name} Comes Home" — Smithson Standard`;
  } else if(m4Stunt === 'inferno' && (outcome === 'triumph' || outcome === 'triumph_clean')){
    headlineText = `"He Walked Out of the Fire. The Rest Is History." — Regional Courier`;
  } else if(outcome === 'triumph_messy'){
    headlineText = `"That Last Ten Feet — The ${name} Story." — Circuit Press`;
  } else if(outcome === 'failure_walk' || outcome === 'failure'){
    headlineText = `"Nobody Remembers the Landing. They Remember the Fist." — Smithson Standard`;
  } else if(outcome === 'failure_bad'){
    headlineText = `"${name} Got Up. That's the Whole Story." — Regional Courier`;
  } else if(outcome === 'triumph' || outcome === 'triumph_clean'){
    if(GS.stats.showmanship >= 5) headlineText = `"${name} Made It Look Easy." — Regional Courier`;
    else if(GS.rels.cal === 'loyal') headlineText = `"Cal Briggs, Mechanic: 'I Kept His Bike Ready for Twelve Years, Just in Case'"`;
    else headlineText = `"${name} Clears the Distance." — Smithson Standard`;
  } else {
    headlineText = `"${name} of ${GS.town||'Buford County'}: The Story Continues."`;
  }

  // ── Earl relationship narrative ───────────────────────────────
  const earlState = GS.rels.earl || 'unknown';
  const earlNarr = {
    mentor: `Earl Maddox called it right at the county fair. He's been right about most of it since.`,
    backer: `Earl Maddox got his return on investment. So did Duke. They're both professionals about it.`,
    antagonist: `Earl Maddox was in the business of other people's ceilings. Duke found his own.`,
    absent: `Duke walked away from Earl's deal. The story he built is entirely his own.`,
    unknown: `Earl Maddox. The relationship is still being decided.`
  }[earlState] || '';

  // ── Dimension verdicts ────────────────────────────────────────
  const verdicts = [];
  if(GS.stats.condition >= 3) verdicts.push({ label:'Body', val:'Still running. Still right.' });
  else if(GS.stats.condition >= 1) verdicts.push({ label:'Body', val:'Carrying some damage. He knows where it is.' });
  else verdicts.push({ label:'Body', val:'The body kept its own account.' });

  if(GS.stats.showmanship >= 4) verdicts.push({ label:'Legacy', val:'They know the name. They know what it means.' });
  else if(GS.stats.showmanship >= 2) verdicts.push({ label:'Legacy', val:'The circuit knows. Some others do too.' });
  else verdicts.push({ label:'Legacy', val:'He did the work. The record exists.' });

  if(GS.rels.ruthie === 'solid') verdicts.push({ label:'Home', val:'She was in the crowd. She drove herself.' });
  else if(GS.rels.ruthie === 'strained') verdicts.push({ label:'Home', val:"She's still there. The distance is negotiable." });
  else if(GS.rels.ruthie === 'absent') verdicts.push({ label:'Home', val:"She left before the big shows. The question of whether Duke made the right call here doesn't have a clean answer." });
  else verdicts.push({ label:'Home', val:'The circuit was home. That might be enough.' });

  if(GS.rels.cal === 'loyal') verdicts.push({ label:'The Work', val:"Cal's still got the bike. It's right." });
  else verdicts.push({ label:'The Work', val:'The bike is what it is. Duke knows every inch of it.' });

  if(m5Complete && m5Outcome){
    const nerveVerdicts = {
      retire_clean: 'He went out as himself. No diminished version.',
      last_stunt_win: 'He went out on his own terms, and the terms held.',
      last_stunt_loss: 'He went out swinging. The body kept its own account.',
      walk_quiet: 'He went out quietly. That takes its own kind of nerve.',
      disappear: 'He went out on nobody\'s terms but his own.',
      keep_going: 'He kept going. The nerve question remains open.',
      mentor: 'He stepped back. Knowing when is its own kind of nerve.',
      symbolic_own: 'He chose the stunt that meant something. Not the one that paid the most.',
      last_stunt_earl: 'He trusted Earl with the last call. That\'s either brave or generous.',
    };
    verdicts.push({ label:'Nerve', val: nerveVerdicts[m5Outcome] || 'The nerve question was answered.' });
  }

  // ── Years-later coda ─────────────────────────────────────────
  let codaText = '';
  if(GS.rels.cal === 'loyal' && (outcome === 'triumph' || outcome === 'triumph_clean') && !m5Outcome){
    codaText = `"Cal Briggs kept the bike ready for twelve years, just in case."`;
  } else if(GS.rels.ruthie === 'solid' && m5Outcome === 'symbolic_own'){
    codaText = `"Ruthie Harlan: 'I always knew he'd come home.'"`;
  } else if(m5Outcome === 'mentor' && GS.rels.pete && GS.rels.pete !== 'absent'){
    codaText = `"He taught me everything — Danny 'Diamondback' Reeves remembers Duke."`;
  } else if(m5Outcome === 'disappear'){
    codaText = `"He disappeared in 1974. Some say he's still out there."`;
  } else if(m4Stunt === 'symbolic' && GS.flags.m4Outcome === 'triumph'){
    codaText = `"The kid in the front row — the one Duke nodded to — started riding at fourteen."`;
  }

  // ── M5 retrospective panels (if reached) ─────────────────────
  let m5PanelHTML = '';
  if(m5Complete){
    const panelLines = {
      retire_clean: ['He made the call. Earl first, then Cal, then Ruthie.', 'The announcement ran in three papers. Sandra got the county fair detail right.', 'He thought: that\'s the story. He thought: it\'s enough.'],
      last_stunt_win: ['He cleared it.', 'He held the landing. He looked at the gap from the other side.', 'He thought: that\'s the last number. He thought: I\'m done.'],
      last_stunt_loss: ['He didn\'t clear it.', 'He got up.', 'He thought: that\'s the last time I\'m going to make that sound happen. He thought: I\'m done.'],
      last_stunt_earl: ['Earl picked the canyon. Duke drove out alone the morning of.', 'He sat at the rim until the gap was just information.', 'He thought: alright. Let\'s go find out.'],
      walk_quiet: ['He told Cal on a Tuesday. Cal said: okay.', 'Some people never knew he retired.', 'He thought: the ones who need to know know.'],
      keep_going: ['He didn\'t stop.', 'The shows got smaller. The name didn\'t.', 'He thought: this is what continuing looks like.'],
      mentor: ['He called Pete. Pete said: I know.', 'The first time Duke watched Pete clear a distance he\'d cleared himself, he thought about the county fair.', 'He thought: the number went somewhere. He was glad it did.'],
      symbolic_own: ['He picked three cows.', 'Not because it was impressive. Because it was where it started.', 'He thought: they were all good numbers.'],
      disappear: ['He left.', 'He drove north. He slept for eleven hours.', 'In the morning he drove further north.'],
    };
    const panels = panelLines[m5Outcome] || ['The question was answered.', 'He answered it himself.', 'That was enough.'];
    m5PanelHTML = `
      <div style="margin-bottom:20px;border-top:1px solid var(--line);padding-top:16px;">
        <div style="font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:var(--cream-faint);margin-bottom:12px;">Retrospective</div>
        ${panels.map(p=>`<div style="font-size:14px;color:var(--cream-dim);line-height:1.65;margin-bottom:10px;padding-left:12px;border-left:2px solid var(--line-soft);">${p}</div>`).join('')}
      </div>`;
  }

  // ── Assemble HTML ─────────────────────────────────────────────
  let relLines = Object.entries(GS.rels)
    .filter(([,v])=> v && v !== 'unknown')
    .map(([k,v])=>
      `<div style="margin-bottom:4px;"><strong style="color:var(--gold)">${relNames[k]||k}:</strong> ${relStateNames[v]||v}</div>`
    ).join('');

  const verdictHTML = verdicts.map(v=>
    `<div style="margin-bottom:6px;"><span style="color:var(--gold);font-size:10px;letter-spacing:.15em;text-transform:uppercase;">${v.label} — </span><span style="color:var(--cream-dim);font-size:13px;">${v.val}</span></div>`
  ).join('');

  document.getElementById('end-summary').innerHTML = `
    <div style="font-family:var(--display);font-size:18px;color:var(--cream);margin-bottom:16px;line-height:1.3;">${headlineText}</div>
    <div style="font-size:12px;color:var(--cream-faint);margin-bottom:4px;letter-spacing:.2em;text-transform:uppercase;">Career Track</div>
    <div style="font-size:15px;color:var(--gold);margin-bottom:16px;font-family:var(--display);">${track}</div>
    ${earlNarr ? `<div style="font-size:13px;color:var(--cream-dim);margin-bottom:16px;font-style:italic;">${earlNarr}</div>` : ''}
    ${m5PanelHTML}
    <div style="font-size:13px;color:var(--cream-faint);margin-bottom:6px;letter-spacing:.2em;text-transform:uppercase;">Verdicts</div>
    <div style="margin-bottom:14px;">${verdictHTML}</div>
    <div style="font-size:13px;color:var(--cream-faint);margin-bottom:6px;letter-spacing:.2em;text-transform:uppercase;">Relationships</div>
    ${relLines}
    ${codaText ? `<div style="margin-top:20px;padding-top:14px;border-top:1px solid var(--line-soft);font-size:13px;color:var(--cream-faint);font-style:italic;letter-spacing:.02em;">${codaText}</div>` : ''}
  `;

  const statsEl = document.getElementById('end-stats');
  statsEl.innerHTML = '';
  STAT_NAMES.forEach(k=>{
    const chip = document.createElement('div');
    chip.style.cssText='background:var(--panel);border-radius:8px;padding:10px 16px;text-align:center;min-width:70px;';
    chip.innerHTML = `<div style="font-size:10px;letter-spacing:.2em;color:var(--gold);text-transform:uppercase;">${STAT_LABELS[k]}</div><div style="font-family:var(--display);font-size:28px;color:var(--cream);">${GS.stats[k]}</div>`;
    statsEl.appendChild(chip);
  });
}

function showHub(){
  showScreen('hub');
  renderHubFR1();
}

function renderHubFR1(){
  document.getElementById('hub-title').textContent = 'Free Roam — Early Days';
  document.getElementById('hub-sub').textContent = 'The weeks after the fair. Choose how to spend your time.';

  const eveningsEl = document.getElementById('hub-evenings');
  const pipsEl = document.getElementById('evening-pips');
  const total = GS.flags.hubEvenings;
  const used = GS.flags.hubEveningsUsed;
  eveningsEl.style.display = 'flex';
  pipsEl.innerHTML = '';
  for(let i=0;i<total;i++){
    const pip = document.createElement('div');
    pip.className = 'pip' + (i<used?' used':'');
    pipsEl.appendChild(pip);
  }

  const sectionsEl = document.getElementById('hub-sections');
  sectionsEl.innerHTML = '';

  // Day Scenes (no evening cost)
  const dayDone = GS.flags.hubDayScenesDone || [];
  const dayCards = [];
  if(!GS.flags.fairOrganizerDone){
    dayCards.push({ id:'fr1_organizer', name:'Lloyd Perkins', sub:'The fair organizer has a booking offer for next August.', tag:'Available · Free', _done:false });
  }
  // Gate on having played the scene, not on `wannabeMet`. Only one of the three
  // answers to the kid sets that flag — the two that turn him down set nothing,
  // so the card came straight back and the scene could be replayed forever.
  // `wannabeMet` has to keep meaning "Pete's thread is open", because that is
  // what Free Roam 2 reads it for; turning him away must not open it.
  if(!dayDone.includes('fr1_wannabe_intro') && (GS.flags.rickySigned||GS.flags.rickyLegacy)){
    dayCards.push({ id:'fr1_wannabe_intro', name:'The Young Wannabe', sub:'A kid found you at the gas station. He has a setup in his uncle\'s lot.', tag:'Available · Free', _done:false });
  }

  if(dayCards.length > 0){
    const sec = document.createElement('div');
    sec.innerHTML = `<div class="hub-section-label">Day Scenes — No Evening Cost</div>`;
    const grid = document.createElement('div'); grid.className='hub-cards';
    dayCards.forEach(card=>{
      const el = buildHubCard(card, false, 'fr1');
      grid.appendChild(el);
    });
    sec.appendChild(grid);
    sectionsEl.appendChild(sec);
  }

  // Evening choices
  const eveRemaining = total - used;
  const sec2 = document.createElement('div');
  sec2.innerHTML = `<div class="hub-section-label">Evening — ${eveRemaining} remaining</div>`;
  const grid2 = document.createElement('div'); grid2.className='hub-cards';

  const eveCards = [
    { id:'fr1_eve_ruthie', name:'Stay Home With Ruthie', sub:'Rebuild Nerve. Reset fatigue.', tag: GS.rels.ruthie==='unknown'?'(Ruthie not established)':'Costs 1 Evening', _disabled: GS.rels.ruthie==='unknown' },
    { id:'fr1_eve_cal', name:'Work With Cal', sub:'Precision up. Cal sometimes says something true.', tag:'Costs 1 Evening' },
    { id:'fr1_eve_practice', name:'Practice Alone', sub:'Precision and Nerve. The honest version of the work.', tag:'Costs 1 Evening' },
    { id:'fr1_eve_bar', name:'Bar With Tommy', sub:'Showmanship up. Condition down. Contacts possible.', tag:'Costs 1 Evening' },
    { id:'fr1_eve_contract', name:'Read the Contract', sub:`Earl's terms. Page fourteen has something worth finding.`, tag: GS.flags.earlResponse==='not_interested'?'(No contract yet)':'Costs 1 Evening', _disabled: GS.rels.earl==='absent' },
  ];

  eveCards.forEach(card=>{
    card._done = GS.flags.hubEveningsDone.includes(card.id);
    if(eveRemaining<=0 && !card._done) card._disabled=true;
    const el = buildHubCard(card, true, 'fr1');
    grid2.appendChild(el);
  });
  sec2.appendChild(grid2);
  sectionsEl.appendChild(sec2);

  // Out of evenings, or out of anything to spend one on. See hubExhausted().
  if(hubExhausted(eveRemaining, eveCards)){
    const m2btn = document.createElement('div');
    m2btn.style.textAlign='center'; m2btn.style.marginTop='24px';
    const b=document.createElement('button'); b.className='btn-main';
    b.style.fontSize='16px';
    b.textContent='Milestone 2 — The Investor Offer';
    b.onclick=()=> goToScene('_chapter_m2');
    m2btn.appendChild(b);
    sectionsEl.appendChild(m2btn);
  }
}

/**
 * Can this hub still be played, or is it time to offer the milestone?
 *
 * Every hub used to gate its milestone button on `eveRemaining <= 0` alone, and
 * that is why nobody has ever seen Milestone 4: Free Roam 3 hands out seven
 * evenings and never builds more than four cards, so the counter cannot reach
 * zero, the button never renders, and the run stops there permanently. FR1 and
 * FR2 have the same shape whenever Ruthie was not established in Milestone 1 —
 * which is five of the six ways to answer Earl — and FR4 whenever a
 * relationship has gone absent.
 *
 * A hub is done when the player is out of evenings OR out of anything to spend
 * one on. Call it after the `_disabled` pass, which is what decides "anything".
 */
function hubExhausted(eveRemaining, eveCards){
  if(eveRemaining <= 0) return true;
  return !eveCards.some(c => !c._done && !c._disabled);
}

function buildHubCard(card, isEvening, hubType){
  // A <button>. These were <div>s with an onclick, which meant the four free-roam
  // hubs — most of the choice a player gets to make in this game — could not be
  // reached by keyboard at all and were not announced as controls.
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'hub-card' + (card._disabled?' disabled':'') + (card._done?' completed':'');
  el.disabled = !!card._disabled || !!card._done;
  el.innerHTML = `
    <div class="hub-card-name">${card.name}</div>
    <div class="hub-card-sub">${card.sub}</div>
    <div class="hub-card-tag ${card._done?'done':isEvening?'cost':'available'}">${card._done?'✓ Done':card.tag}</div>
  `;
  if(!card._disabled && !card._done){
    el.onclick = ()=>{
      if(isEvening){
        if(hubType==='fr2'){
          GS.flags.fr2EveningsUsed = (GS.flags.fr2EveningsUsed||0)+1;
          GS.flags.fr2EveningsDone = GS.flags.fr2EveningsDone||[];
          GS.flags.fr2EveningsDone.push(card.id);
        } else if(hubType==='fr3'){
          GS.flags.fr3EveningsUsed = (GS.flags.fr3EveningsUsed||0)+1;
          GS.flags.fr3EveningsDone = GS.flags.fr3EveningsDone||[];
          GS.flags.fr3EveningsDone.push(card.id);
        } else if(hubType==='fr4'){
          GS.flags.fr4EveningsUsed = (GS.flags.fr4EveningsUsed||0)+1;
          GS.flags.fr4EveningsDone = GS.flags.fr4EveningsDone||[];
          GS.flags.fr4EveningsDone.push(card.id);
        } else {
          GS.flags.hubEveningsUsed++;
          GS.flags.hubEveningsDone.push(card.id);
        }
      } else {
        if(hubType==='fr4'){
          GS.flags.fr4DayScenesDone = GS.flags.fr4DayScenesDone||[];
          GS.flags.fr4DayScenesDone.push(card.id);
        } else if(hubType==='fr3'){
          GS.flags.fr3DayScenesDone = GS.flags.fr3DayScenesDone||[];
          GS.flags.fr3DayScenesDone.push(card.id);
        } else if(hubType==='fr2'){
          GS.flags.fr2DayScenesDone = GS.flags.fr2DayScenesDone||[];
          GS.flags.fr2DayScenesDone.push(card.id);
        } else {
          GS.flags.hubDayScenesDone = GS.flags.hubDayScenesDone||[];
          GS.flags.hubDayScenesDone.push(card.id);
        }
      }
      goToScene(card.id);
    };
  }
  return el;
}

function showHubFR2(){
  GS.flags.fr2Evenings = GS.flags.fr2Evenings || 6;
  GS.flags.fr2EveningsUsed = GS.flags.fr2EveningsUsed || 0;
  GS.flags.fr2EveningsDone = GS.flags.fr2EveningsDone || [];
  GS.flags.fr2DayScenesDone = GS.flags.fr2DayScenesDone || [];
  showScreen('hub');
  renderHubFR2();
}

function renderHubFR2(){
  document.getElementById('hub-title').textContent = 'Free Roam — Building the Act';
  document.getElementById('hub-sub').textContent = 'The shows are bigger. The distances are longer. Choose how to spend your time.';

  const eveningsEl = document.getElementById('hub-evenings');
  const pipsEl = document.getElementById('evening-pips');
  const total = GS.flags.fr2Evenings || 6;
  const used = GS.flags.fr2EveningsUsed || 0;
  eveningsEl.style.display = 'flex';
  pipsEl.innerHTML = '';
  for(let i=0;i<total;i++){
    const pip = document.createElement('div');
    pip.className = 'pip' + (i<used?' used':'');
    pipsEl.appendChild(pip);
  }

  const sectionsEl = document.getElementById('hub-sections');
  sectionsEl.innerHTML = '';

  const done2 = GS.flags.fr2DayScenesDone || [];
  const eveDone2 = GS.flags.fr2EveningsDone || [];

  // Day scenes
  const dayCards = [];
  if(GS.flags.dannyMet || GS.flags.dannySchemed){
    dayCards.push({ id:'fr2_danny_01', name:'Diamondback Danny', sub:"He's on the circuit. He noticed you signed with Earl.", tag:'Available · Free', _done: done2.includes('fr2_danny_01') });
    // Danny follow-up: public challenge
    if(GS.flags.fr2Danny01Done && !GS.flags.fr2Danny02Done && (GS.rels.danny==='nemesis'||GS.rels.danny==='frenemy')){
      dayCards.push({ id:'fr2_danny_02', name:'The Public Challenge', sub:"Danny went to the papers. Sandra has the quote.", tag:'Available · Free', _done: done2.includes('fr2_danny_02') });
    }
  }
  if(GS.flags.wannabeMet){
    dayCards.push({ id:'fr2_pete_01', name:'Pete Garland', sub:"He's gotten better. He has a fair coming up.", tag:'Available · Free', _done: done2.includes('fr2_pete_01') });
    // Pete mistake follow-up
    // Gate on the day scene actually having been played. This read
    // `GS.flags.fr2Pete01Done`, which nothing in the file ever sets — so the
    // card never appeared and `fr2_pete_02` plus its five outcome scenes were
    // unreachable. `done2` is pushed by buildHubCard, which is the same thing
    // the Danny follow-up above relies on.
    if(done2.includes('fr2_pete_01') && !GS.flags.fr2PeteMistakeDone && !done2.includes('fr2_pete_02')){
      dayCards.push({ id:'fr2_pete_02', name:"Pete's Mistake", sub:'Cal heard about it. So did half the county.', tag:'Available · Free', _done: false });
    }
  }
  if(!done2.includes('fr2_debt_01') && !eveDone2.includes('fr2_debt_01')){
    dayCards.push({ id:'fr2_debt_01', name:'The Cost', sub:'A twelve-hundred dollar problem. The cars for the next show.', tag:'Available · Free — one time', _done: false });
  }

  if(dayCards.length > 0){
    const sec = document.createElement('div');
    sec.innerHTML = `<div class="hub-section-label">Day Scenes — No Evening Cost</div>`;
    const grid = document.createElement('div'); grid.className='hub-cards';
    dayCards.forEach(card=>{
      const el = buildHubCard(card, false, 'fr2');
      grid.appendChild(el);
    });
    sec.appendChild(grid);
    sectionsEl.appendChild(sec);
  }

  // Evening choices
  const eveRemaining = total - used;
  const sec2 = document.createElement('div');
  sec2.innerHTML = `<div class="hub-section-label">Evening — ${eveRemaining} remaining</div>`;
  const grid2 = document.createElement('div'); grid2.className='hub-cards';

  const eveCards = [
    { id:'fr2_eve_cal', name:'Work With Cal', sub:"Suspension geometry. He already fixed the seal. He's telling you why.", tag:'Costs 1 Evening' },
    { id:'fr2_eve_ruthie', name:'Stay Home With Ruthie', sub:'She wants to come to a show. Find the right one.', tag: GS.rels.ruthie==='unknown'?'(Ruthie not established)':'Costs 1 Evening', _disabled: GS.rels.ruthie==='unknown' },
    { id:'fr2_eve_practice', name:'New Distances', sub:'Five cars. The geometry is different from three cows.', tag:'Costs 1 Evening' },
    { id:'fr2_eve_bar', name:'Bar With Tommy', sub:'He has a theory about Diamondback Danny. He might be right.', tag:'Costs 1 Evening' },
    { id:'fr2_eve_press', name:'Call Sandra', sub:'Earl announced you before you knew you were being announced.', tag:'Costs 1 Evening' },
  ];

  // Second Cal evening — available if first is done
  if(eveDone2.includes('fr2_eve_cal') && !eveDone2.includes('fr2_eve_cal_02')){
    eveCards.push({ id:'fr2_eve_cal_02', name:"Cal — Bike's Right", sub:"A Tuesday. Not a show night. He says the thing you were actually asking about.", tag:'Costs 1 Evening' });
  }
  // Second Ruthie evening — available if first is done and relationship is solid
  if((eveDone2.includes('fr2_eve_ruthie')) && !eveDone2.includes('fr2_eve_ruthie_02') && GS.rels.ruthie==='solid'){
    eveCards.push({ id:'fr2_eve_ruthie_02', name:"Ruthie's Question", sub:"Out of nowhere: what do you get out of it?", tag:'Costs 1 Evening' });
  }

  eveCards.forEach(card=>{
    card._done = eveDone2.includes(card.id);
    if(eveRemaining<=0 && !card._done) card._disabled=true;
    const el = buildHubCard(card, true, 'fr2');
    grid2.appendChild(el);
  });
  sec2.appendChild(grid2);
  sectionsEl.appendChild(sec2);

  // Milestone 3 trigger. See hubExhausted().
  if(hubExhausted(eveRemaining, eveCards)){
    const m3btn = document.createElement('div');
    m3btn.style.textAlign='center'; m3btn.style.marginTop='24px';
    const b=document.createElement('button'); b.className='btn-main';
    b.style.fontSize='16px';
    b.textContent='Milestone 3 — The Big Break';
    b.onclick=()=> goToScene('_chapter_m3');
    m3btn.appendChild(b);
    sectionsEl.appendChild(m3btn);
  }
}

// The stunt run reports `{ result, score, details }` — `result` is the field,
// and `handleStuntRunResult` (Milestone 1) reads it correctly. M3, M4 and M5
// each read `res.outcome`, which the run never sets, so every comparison below
// was `undefined === 'SUCCESS'` and every stunt from Milestone 3 on fell
// through to its failure branch no matter how well it was ridden.
function handleStuntRunM3(res){
  // M3 stunt result router — cars scale — four outcome states
  syncSkillsFromStats();
  const score = res.score || 0;
  const outcome = res.result;
  if(outcome === 'SUCCESS' && score >= 85){
    goToScene('m3_triumph_clean');
  } else if(outcome === 'SUCCESS' || outcome === 'PARTIAL'){
    goToScene('m3_triumph_messy');
  } else if(score >= 30){
    goToScene('m3_failure_walk');
  } else {
    // Hard crash. m3_failure_bad is the prose for going down; its own `next`
    // is the recovery minigame, so route through it rather than past it.
    goToScene('m3_failure_bad');
  }
}

function handleStuntRunM4(res){
  syncSkillsFromStats();
  const outcome = res.result;
  const choice = GS.flags.m4Choice || 'buses';
  if(outcome === 'SUCCESS' || outcome === 'PARTIAL'){
    if(choice === 'inferno') goToScene('m4_triumph_inferno');
    else goToScene('m4_triumph_buses');
  } else {
    if(choice === 'inferno') goToScene('m4_failure_inferno');
    else goToScene('m4_failure_buses');
  }
}

function showHubFR3(){
  GS.flags.fr3Evenings = GS.flags.fr3Evenings || 7;
  GS.flags.fr3EveningsUsed = GS.flags.fr3EveningsUsed || 0;
  GS.flags.fr3EveningsDone = GS.flags.fr3EveningsDone || [];
  GS.flags.fr3DayScenesDone = GS.flags.fr3DayScenesDone || [];
  showScreen('hub');
  renderHubFR3();
}

function renderHubFR3(){
  document.getElementById('hub-title').textContent = 'Free Roam — The Price of Fame';
  document.getElementById('hub-sub').textContent = 'Peak and early cracks. The cost is becoming visible. Choose how to spend your time.';

  const eveningsEl = document.getElementById('hub-evenings');
  const pipsEl = document.getElementById('evening-pips');
  const total = GS.flags.fr3Evenings || 7;
  const used = GS.flags.fr3EveningsUsed || 0;
  eveningsEl.style.display = 'flex';
  pipsEl.innerHTML = '';
  for(let i=0;i<total;i++){
    const pip = document.createElement('div');
    pip.className = 'pip' + (i<used?' used':'');
    pipsEl.appendChild(pip);
  }

  const sectionsEl = document.getElementById('hub-sections');
  sectionsEl.innerHTML = '';

  const done3 = GS.flags.fr3DayScenesDone || [];
  const eveDone3 = GS.flags.fr3EveningsDone || [];

  // Day scenes
  const dayCards = [];
  if(!done3.includes('fr3_hollis')){
    dayCards.push({ id:'fr3_hollis', name:'Reverend Hollis', sub:"He was at the Dallas show. He wants to say something different this time.", tag:'Available · Free', _done:false });
  }
  if(!done3.includes('fr3_press_sandra')){
    dayCards.push({ id:'fr3_press_sandra', name:'Sandra Blaine', sub:'She has a bigger offer. Regional TV, prime time, thirty minutes.', tag:'Available · Free', _done:false });
  }

  if(dayCards.length > 0){
    const sec = document.createElement('div');
    sec.innerHTML = `<div class="hub-section-label">Day Scenes — No Evening Cost</div>`;
    const grid = document.createElement('div'); grid.className='hub-cards';
    dayCards.forEach(card=>{
      const el = buildHubCard(card, false, 'fr3');
      grid.appendChild(el);
    });
    sec.appendChild(grid);
    sectionsEl.appendChild(sec);
  }

  // Evening choices
  const eveRemaining = total - used;
  const sec2 = document.createElement('div');
  sec2.innerHTML = `<div class="hub-section-label">Evening — ${eveRemaining} remaining</div>`;
  const grid2 = document.createElement('div'); grid2.className='hub-cards';

  const eveCards = [];

  if(GS.rels.earl !== 'absent'){
    eveCards.push({ id:'fr3_eve_earl', name:'Earl Maddox', sub:'He wants to renegotiate. The split and the extension are on the table.', tag:'Costs 1 Evening' });
  }
  if(GS.rels.ruthie !== 'unknown' && GS.rels.ruthie !== 'absent'){
    const ruthieSub = GS.flags.ruthieAsked
      ? "She saw how close it was. She's proud. Something shifted."
      : "She was in the sixth row. She wants to tell you what she saw.";
    eveCards.push({ id:'fr3_eve_ruthie', name:'Ruthie', sub: ruthieSub, tag:'Costs 1 Evening' });
  }
  eveCards.push({ id:'fr3_eve_cal', name:'Work With Cal', sub:'He has a question about what comes next. Buses are different from cars.', tag:'Costs 1 Evening' });
  if(GS.rels.tommy !== 'absent'){
    eveCards.push({ id:'fr3_eve_tommy', name:'Tommy', sub:"He's at the bar. He has something true to say and doesn't know it yet.", tag:'Costs 1 Evening' });
  }

  eveCards.forEach(card=>{
    card._done = eveDone3.includes(card.id);
    if(eveRemaining<=0 && !card._done) card._disabled=true;
    const el = buildHubCard(card, true, 'fr3');
    grid2.appendChild(el);
  });
  sec2.appendChild(grid2);
  sectionsEl.appendChild(sec2);

  // Milestone 4 trigger when the hub is spent. See hubExhausted().
  if(hubExhausted(eveRemaining, eveCards)){
    const canBuses = GS.stats.showmanship >= 4 && GS.stats.precision >= 3;
    const canInferno = GS.stats.nerve >= 4;
    const stuntsAvail = [canBuses?'Bus Stack':null, canInferno?'Inferno':null, 'Symbolic'].filter(Boolean);
    const m4btn = document.createElement('div');
    m4btn.style.textAlign='center'; m4btn.style.marginTop='24px';
    const b=document.createElement('button'); b.className='btn-main';
    b.style.fontSize='16px';
    b.textContent='Milestone 4 — The Defining Moment';
    b.onclick=()=> goToScene('_chapter_m4');
    m4btn.appendChild(b);
    const hint = document.createElement('div');
    hint.style.cssText='font-size:11px;color:var(--cream-faint);margin-top:8px;letter-spacing:.05em;';
    hint.textContent = `Available stunts: ${stuntsAvail.join(' · ')}`;
    m4btn.appendChild(hint);
    sectionsEl.appendChild(m4btn);
  }
}

/* ================================================================
   FREE ROAM 4 HUB
   ================================================================ */
function showHubFR4(){
  const isFailure = GS.flags.fr4Failure;
  GS.flags.fr4Evenings = GS.flags.fr4Evenings || (isFailure ? 5 : 6);
  GS.flags.fr4EveningsUsed = GS.flags.fr4EveningsUsed || 0;
  GS.flags.fr4EveningsDone = GS.flags.fr4EveningsDone || [];
  GS.flags.fr4DayScenesDone = GS.flags.fr4DayScenesDone || [];
  showScreen('hub');
  renderHubFR4();
}

function renderHubFR4(){
  const isFailure = GS.flags.fr4Failure;
  document.getElementById('hub-title').textContent = 'Free Roam — Aftermath';
  document.getElementById('hub-sub').textContent = isFailure
    ? 'After the fall. Some things are still standing. Choose how to spend your time.'
    : 'After the peak. The name means something now. Choose how to spend your time.';

  const eveningsEl = document.getElementById('hub-evenings');
  const pipsEl = document.getElementById('evening-pips');
  const total = GS.flags.fr4Evenings || 6;
  const used = GS.flags.fr4EveningsUsed || 0;
  eveningsEl.style.display = 'flex';
  pipsEl.innerHTML = '';
  for(let i=0;i<total;i++){
    const pip = document.createElement('div');
    pip.className = 'pip' + (i<used?' used':'');
    pipsEl.appendChild(pip);
  }

  const sectionsEl = document.getElementById('hub-sections');
  sectionsEl.innerHTML = '';

  const done4 = GS.flags.fr4DayScenesDone || [];
  const eveDone4 = GS.flags.fr4EveningsDone || [];

  // Day scenes
  const dayCards = [];
  if(!done4.includes('fr4_biographer')){
    dayCards.push({ id:'fr4_biographer', name:'The Biographer', sub:'A man named Fisk flew in from New York. He has a contract in his briefcase.', tag:'Available · Free', _done:false });
  }

  if(dayCards.length > 0){
    const sec = document.createElement('div');
    sec.innerHTML = `<div class="hub-section-label">Day Scenes — No Evening Cost</div>`;
    const grid = document.createElement('div'); grid.className='hub-cards';
    dayCards.forEach(card=>{
      const el = buildHubCard(card, false, 'fr4');
      grid.appendChild(el);
    });
    sec.appendChild(grid);
    sectionsEl.appendChild(sec);
  }

  // Evening choices
  const eveRemaining = total - used;
  const sec2 = document.createElement('div');
  sec2.innerHTML = `<div class="hub-section-label">Evening — ${eveRemaining} remaining</div>`;
  const grid2 = document.createElement('div'); grid2.className='hub-cards';

  const eveCards = [];

  // Night ride — always available
  eveCards.push({ id:'fr4_night_ride', name:'Night Ride', sub:'Twenty-two miles north. The fork seal holds. Just the road.', tag:'Costs 1 Evening' });

  // Ruthie — if not absent
  if(GS.rels.ruthie !== 'unknown'){
    const ruthieSub = GS.rels.ruthie === 'absent'
      ? 'He thought about calling her. He didn\'t.'
      : GS.rels.ruthie === 'solid'
        ? 'She cooked. She mentioned the hands. The thing Roy filmed.'
        : 'She\'s there. Careful with it. The thread is still warm.';
    eveCards.push({ id:'fr4_eve_ruthie', name:'Ruthie', sub: ruthieSub, tag:'Costs 1 Evening' });
  }

  // Cal — always
  eveCards.push({ id:'fr4_eve_cal', name:'Work With Cal', sub:'Garage. Vegas specs. The fork seal is ritual now. He has a question.', tag:'Costs 1 Evening' });

  // Tommy — if not absent
  if(GS.rels.tommy !== 'absent' && GS.rels.tommy !== 'unknown'){
    eveCards.push({ id:'fr4_eve_tommy', name:'Tommy', sub:"He was at the canyon. He saw you clear it. He said something true.", tag:'Costs 1 Evening' });
  }

  // Earl — if not absent
  if(GS.rels.earl !== 'absent'){
    const earlSub = isFailure
      ? 'He has a recovery package. The terms are worth reading carefully.'
      : 'The man from California is on the line. The Vegas offer is real.';
    eveCards.push({ id:'fr4_eve_earl', name:'Earl Maddox', sub: earlSub, tag:'Costs 1 Evening' });
  }

  // Special: Ruthie thread close (only if ruthie=solid and near the end)
  if(GS.rels.ruthie === 'solid' && !eveDone4.includes('fr4_ruthie_thread_close') && eveDone4.includes('fr4_eve_ruthie')){
    eveCards.push({ id:'fr4_ruthie_thread_close', name:'Wednesday Evening — Ruthie', sub:"She drove out on a weekday. She'll be there. That's what she said.", tag:'Costs 1 Evening' });
  }

  eveCards.forEach(card=>{
    card._done = eveDone4.includes(card.id);
    if(eveRemaining<=0 && !card._done) card._disabled=true;
    const el = buildHubCard(card, true, 'fr4');
    grid2.appendChild(el);
  });
  sec2.appendChild(grid2);
  sectionsEl.appendChild(sec2);

  // Milestone 5 trigger. See hubExhausted().
  if(hubExhausted(eveRemaining, eveCards)){
    const m5btn = document.createElement('div');
    m5btn.style.textAlign='center'; m5btn.style.marginTop='24px';
    const b=document.createElement('button'); b.className='btn-main';
    b.style.fontSize='16px';
    b.textContent='Milestone 5 — The Question';
    b.onclick=()=> goToScene('_chapter_m5');
    m5btn.appendChild(b);
    const hint = document.createElement('div');
    hint.style.cssText='font-size:11px;color:var(--cream-faint);margin-top:8px;letter-spacing:.05em;';
    hint.textContent = 'The question has been there for a while. It\'s time to answer it.';
    m5btn.appendChild(hint);
    sectionsEl.appendChild(m5btn);
  }
}

function handleStuntRunM5(res){
  syncSkillsFromStats();
  const outcome = res.result;   // see handleStuntRunM3
  if(outcome === 'SUCCESS' || outcome === 'PARTIAL'){
    goToScene('m5_stunt_win');
  } else {
    goToScene('m5_stunt_loss');
  }
}

/* ================================================================
   MINIGAME MODULES (copied from minigame test bed)
   ================================================================ */

/* ---- Recovery Core ---- */
function RecoveryCore(){
  const nerve=SKILLS.nerve, cond=SKILLS.condition;
  const LEN=[1,1,2,3], ROUNDS=LEN.length, TOTAL=LEN.reduce((a,b)=>a+b,0);
  const winHalf=0.10+(cond/100)*0.12, fillRate=1/1.30, target=0.80;
  const stepTime=1.45+(cond/100)*0.85, buffer=0.50+(nerve/100)*0.70;
  const dirsAll=['left','up','right','down'], arrow={left:'◀',right:'▶',up:'▲',down:'▼'};
  const rounds=[]; for(let r=0;r<ROUNDS;r++){ const seq=[]; let prev='';
    for(let i=0;i<LEN[r];i++){ let d; do{ d=dirsAll[round(rnd(3,0))]; }while(d===prev); prev=d; seq.push(d); } rounds.push(seq); }
  let roundIdx=0, stepIdx=0, phase='prep', t=0, timer=0, roundDur=1, fill=0, holding=null,
      stepsDone=0, roundsCleared=0, doneThisRound=0, stepRes=[], last='', flashBad=0, done=false;
  function startRound(){ stepIdx=0; doneThisRound=0; fill=0; holding=null; stepRes=[]; last='';
    roundDur=stepTime*rounds[roundIdx].length+buffer; timer=roundDur; phase='prep'; t=0; }
  startRound();
  function endRound(cleared){ if(cleared)roundsCleared++; last=cleared?'clear':'timeout'; phase='rest'; t=0; }
  function advance(){ roundIdx++; if(roundIdx>=ROUNDS)done=true; else startRound(); }
  return {
    reps:ROUNDS, dirs:()=>['left','up','right','down'],
    onDir(dir,down){ if(done||phase!=='active')return; const want=rounds[roundIdx][stepIdx];
      if(down){ if(dir===want)holding=dir; } else { if(dir===holding){ this._eval(); holding=null; } } },
    _eval(){ const good=Math.abs(fill-target)<=winHalf;
      if(good){ stepsDone++; doneThisRound++; stepRes.push('good'); last='good'; }
      else { stepRes.push('miss'); last=fill<target?'early':'late'; flashBad=0.30; }
      fill=0; stepIdx++;
      if(stepIdx>=rounds[roundIdx].length)endRound(doneThisRound===rounds[roundIdx].length); },
    update(dt){ if(done)return true;
      if(flashBad>0)flashBad-=dt;
      if(phase==='prep'){ t+=dt; if(t>=(rounds[roundIdx].length>1?1.05:0.7)){ phase='active'; t=0; } return false; }
      if(phase==='rest'){ t+=dt; if(t>=0.85){ advance(); return done; } return false; }
      timer-=dt;
      if(holding){ fill+=fillRate*dt; if(fill>=1.18){ this._eval(); holding=null; } }
      if(timer<=0&&phase==='active'){ timer=0; while(stepIdx<rounds[roundIdx].length){ stepRes.push('miss'); stepIdx++; } endRound(false); }
      return false; },
    result(){ const ratio=stepsDone/TOTAL; let res,score;
      if(roundsCleared===ROUNDS){ res='SUCCESS'; score=round(lerp(88,100,ratio)); }
      else if(ratio>=0.5){ res='PARTIAL'; score=round(lerp(48,80,(ratio-0.5)/0.5)); }
      else { res='FAIL'; score=round(clamp(12+ratio*60,10,44)); }
      return {result:res,score,details:'Recovery: cleared '+roundsCleared+' of '+ROUNDS+' rounds ('+stepsDone+'/'+TOTAL+' holds).',ok:roundsCleared,reps:ROUNDS}; },
    render(g,w,h){
      function rr(g,x,y,w,h,r){ g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); }
      g.fillStyle='rgba(12,8,4,0.82)'; g.fillRect(0,0,w,h);
      g.globalAlpha=.14; drawSeated(g,w*0.5,h*0.78,h*0.52); g.globalAlpha=1;
      if(done||roundIdx>=ROUNDS){ g.textAlign='center'; g.fillStyle=C_pal.creamDim; g.font='600 13px Oswald'; g.fillText('— done —',w/2,h*0.5); return; }
      const cx=w/2, seq=rounds[roundIdx], len=seq.length, combo=len>1;
      g.textAlign='center'; g.fillStyle=C_pal.creamDim; g.font='600 12px Oswald';
      g.fillText(combo?('COMBO — ROUND '+(roundIdx+1)+' / '+ROUNDS):('ROUND '+(roundIdx+1)+' / '+ROUNDS),cx,h*0.13);
      const tw=w*0.62, tx=cx-tw/2, ty=h*0.20, frac=clamp(timer/roundDur,0,1);
      g.fillStyle='#0e0905'; rr(g,tx-3,ty-3,tw+6,12,6); g.fill();
      g.fillStyle=phase==='rest'?(last==='clear'?C_pal.avocado:C_pal.oxblood):(frac<0.28?C_pal.oxblood:(frac<0.55?C_pal.gold:C_pal.avocado));
      rr(g,tx,ty,tw*(phase==='prep'?1:frac),6,3); g.fill();
      g.strokeStyle=C_pal.line; g.lineWidth=1; rr(g,tx,ty,tw,6,3); g.stroke();
      const ax=cx, ay=h*0.45, slot=Math.min(w*0.13,64), x0=cx-(len-1)*slot/2;
      for(let i=0;i<len;i++){ const px=x0+i*slot;
        const doneStep=i<stepRes.length, good=stepRes[i]==='good', cur=(i===stepIdx&&phase==='active');
        g.fillStyle=doneStep?(good?C_pal.avocado:C_pal.oxblood):(cur?C_pal.cream:'#5a4a33');
        g.font='400 '+(cur?46:38)+'px "Alfa Slab One",serif'; g.fillText(arrow[seq[i]],px,ay);
        if(cur){ g.strokeStyle=C_pal.gold; g.lineWidth=2; rr(g,px-slot*0.42,ay-42,slot*0.84,54,8); g.stroke(); } }
      if(phase==='prep'){ g.fillStyle=C_pal.gold; g.font='600 13px Oswald'; g.fillText(combo?'MEMORIZE THE COMBO':'GET READY',cx,h*0.62); }
      else if(phase==='active'){ g.fillStyle=C_pal.cream; g.font='600 13px Oswald'; g.fillText('HOLD '+arrow[seq[stepIdx]]+'  —  release in the band',cx,h*0.62); }
      else if(phase==='rest'){ g.fillStyle=last==='clear'?C_pal.avocado:C_pal.oxblood; g.font='400 20px "Alfa Slab One",serif'; g.fillText(last==='clear'?(combo?'COMBO CLEARED':'GOOD'):'TOO SLOW',cx,h*0.62); }
      const mh=h*0.40, mw=18, mx=w*0.83, my=h*0.30;
      g.fillStyle='#0e0905'; rr(g,mx,my,mw,mh,6); g.fill();
      const byb=my+mh*(1-(target+winHalf)), bhb=mh*2*winHalf;
      g.fillStyle=C_pal.avocadoDim; g.fillRect(mx,byb,mw,bhb); g.fillStyle=C_pal.avocado; g.fillRect(mx,byb,mw,3); g.fillRect(mx,byb+bhb-3,mw,3);
      const fh=mh*clamp(fill,0,1); g.fillStyle=fill>1?C_pal.oxblood:C_pal.gold; g.fillRect(mx,my+mh-fh,mw,fh);
      g.fillStyle=C_pal.faint; g.font='600 8px Oswald'; g.fillText('HOLD',mx+mw/2,my-5);
      const dy=h*0.92; for(let i=0;i<ROUNDS;i++){ const dx=cx-((ROUNDS-1)*16)/2+i*16;
        g.fillStyle=i<roundIdx?'#9aab4e':(i===roundIdx?C_pal.gold:'#3a2a1c'); g.beginPath(); g.arc(dx,dy,4,0,TAU); g.fill(); }
      if(flashBad>0){ g.fillStyle='rgba(168,57,42,'+flashBad+')'; g.fillRect(0,0,w,h); }
    }
  };
}

/* ---- Stunt Run ---- */
function createStuntRun(opts){
  const scale=(opts&&opts.scale)||'cows';
  const nerve=SKILLS.nerve, prec=SKILLS.precision, show=SKILLS.showmanship, cond=SKILLS.condition;
  const GY=420, START=80, RAMP_START=760, LIP=980, LAND_TOP=1600, LAND_END=2000, FINISH=2300, WORLD_END=2480;
  const RAMP_DEG=36, LAND_DEG=18, GRAV=340, WB=46, WR=13, LAND_LIP_H=70;
  const LIP_TOP_Y=GY-(LIP-RAMP_START)*tan(RAMP_DEG);
  const SCALES={ cows:{n:3,unit:'cows',label:'Milestone 1 · Cows'}, cars:{n:9,unit:'cars',label:'Milestone 3 · Cars'}, buses:{n:13,unit:'buses',label:'Milestone 4 · Bus Stack'} };
  const S=SCALES[scale]||SCALES.cows;
  const ACCEL=235, BRAKE=300, FRICT=26, VMAX=590;
  const GREEN_C=485, greenHalf=30+(nerve/100)*0.45*100*0.45;
  const yellowHalf=greenHalf*2.0;
  const TARGET_ANG=-LAND_DEG;
  const BAL_BAND=22+(prec/100)*14;
  const CTRL=150+(nerve/100)*170;
  const DRIFT_A=52+(1-cond/100)*150;
  const DRIFT_F1=2.1, DRIFT_F2=3.7;
  const WMAX=160;
  const TOL=16+(prec/100)*22;
  function terrainY(x){ if(x<RAMP_START)return GY; if(x<LIP)return GY-(x-RAMP_START)*tan(RAMP_DEG); if(x<LAND_TOP)return GY; if(x<LAND_END)return (GY-LAND_LIP_H)+(x-LAND_TOP)*tan(LAND_DEG); return GY; }
  function surfaceDeg(x){ if(x>=RAMP_START&&x<LIP)return RAMP_DEG; if(x>=LAND_TOP&&x<LAND_END)return -LAND_DEG; return 0; }
  let phase,v,gas,lean,cx,cy,vx,vy,th,w,totalRot,launchSpeed,approachScore,contactX,contactErr,crashT,crashSpin,landRes,rec,finished,cam,camY,dust,shakeT,airT,drift,balIn,balTot,driftSeed;
  function rr(g,x,y,w,h,r){ g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); }
  function setPhase(p){ phase=p; const self=run;
    if(p==='approach')self.setInstruction('Throttle up — hit the ramp with your speed in the GREEN.');
    else if(p==='air')self.setInstruction('Airborne! GAS lifts the nose, LEAN drops it. Fight the drift.');
    else if(p==='runout')self.setInstruction('Stuck it! Ride it out.');
    else if(p==='crashing')self.setInstruction('Down hard.');
    else if(p==='recovery'){ self.setInstruction('Get up. Hold each input in the band.'); self.setControls({type:'pad',dirs:['left','up','right','down']}); } }
  const run={
    name:'The Stunt Run', controlSpec:{type:'pedals'}, scales:true, tele:{},
    init(){ phase='approach'; v=0; gas=false; lean=false; cx=START; cy=GY-WR; vx=0; vy=0; th=0; w=0;
      totalRot=0; launchSpeed=0; approachScore=0; contactX=0; contactErr=0; crashT=0; crashSpin=0;
      landRes=null; rec=null; finished=false; cam=0; camY=0; dust=[]; shakeT=0;
      airT=0; drift=0; balIn=0; balTot=0; driftSeed=rnd(TAU,0); },
    onGas(d){ gas=d; }, onLean(d){ lean=d; },
    onDir(dir,down){ if(phase==='recovery'&&rec)rec.onDir(dir,down); },
    onTap(){}, onChoice(){},
    update(dt,W,H){
      if(finished)return;
      const steps=phase==='air'?3:1, h=dt/steps;
      for(let i=0;i<steps;i++)this._step(h);
      // Debug/telemetry channel. Nothing in the game reads it; the regression
      // suite steers the run off `th` and `w`, and a proportional loop on angle
      // alone oscillates straight through the landing band without `w`.
      this.tele={phase,v:round(v),th:round(th),w:round(w),totalRot:round(totalRot),launchSpeed:round(launchSpeed),cx:round(cx),cy:round(cy),vy:round(vy),contactX:round(contactX)};
      for(const p of dust){ p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=200*dt; p.life-=dt; }
      dust=dust.filter(p=>p.life>0);
      if(shakeT>0)shakeT-=dt;
    },
    _step(dt){
      if(phase==='approach'){
        if(gas)v+=ACCEL*dt; if(lean)v-=BRAKE*dt; v-=FRICT*dt*(gas?0.2:1); v=clamp(v,0,VMAX);
        const sd=surfaceDeg(cx); cx+=v*cos(sd)*dt; cy=terrainY(cx)-WR; th=sd;
        if(Math.random()<v/VMAX*0.6)dust.push({x:cx-20,y:cy+WR,vx:-rnd(40,10),vy:-rnd(30,0),life:rnd(.4,.2)});
        if(cx>=LIP){ launchSpeed=v; const dz=Math.abs(v-GREEN_C);
          approachScore=dz<=greenHalf?round(lerp(100,80,dz/greenHalf)):dz<=yellowHalf?round(lerp(78,48,(dz-greenHalf)/(yellowHalf-greenHalf))):round(clamp(46-(dz-yellowHalf)*0.3,15,46));
          cx=LIP; cy=LIP_TOP_Y-WR; vx=v*cos(RAMP_DEG); vy=-v*sin(RAMP_DEG); th=RAMP_DEG; w=0; totalRot=0; airT=0; setPhase('air'); } return; }
      if(phase==='air'){
        airT+=dt;
        drift=DRIFT_A*(0.6*Math.sin(DRIFT_F1*airT+driftSeed)+0.4*Math.sin(DRIFT_F2*airT+driftSeed*1.7));
        let torque=drift;
        if(gas)torque+=CTRL; if(lean)torque-=CTRL;
        w+=torque*dt; w*=(1-1.6*dt); w=clamp(w,-WMAX,WMAX);
        th+=w*dt; totalRot+=w*dt;
        if(airT>0.3){ balTot+=dt; if(Math.abs(normDeg(th-TARGET_ANG))<=BAL_BAND)balIn+=dt; }
        vy+=GRAV*dt; cx+=vx*dt; cy+=vy*dt;
        const s=sin(th),c_=cos(th);
        const fX=cx+(WB/2)*c_, fY=cy-(WB/2)*s, rX=cx-(WB/2)*c_, rY=cy+(WB/2)*s;
        const fpen=(fY+WR)-terrainY(fX), rpen=(rY+WR)-terrainY(rX);
        const pen=Math.max(fpen,rpen);
        if(pen>=-1&&vy>0){ contactX=(fpen>=rpen?fX:rX); this._land(); }
        else if(cx>WORLD_END){ this._crash('off'); } return; }
      if(phase==='runout'){
        const sd=surfaceDeg(cx); if(gas)v+=ACCEL*0.6*dt; v-=FRICT*1.4*dt; v=clamp(v,60,VMAX);
        cx+=v*cos(sd)*dt; cy=terrainY(cx)-WR; th=lerp(th,sd,clamp(dt*8,0,1));
        if(cx>=FINISH){ finished=true; this._finishRun(landRes); } return; }
      if(phase==='crashing'){
        crashT+=dt; th+=crashSpin*dt; cx+=vx*dt; vx*=(1-2*dt); vy+=GRAV*dt; cy+=vy*dt;
        const gy=terrainY(cx)-WR; if(cy>gy){ cy=gy; vy*=-0.3; crashSpin*=0.6; if(Math.random()<.5)dust.push({x:cx,y:cy+WR,vx:rnd(60,-60),vy:-rnd(120,40),life:rnd(.6,.3)}); }
        if(crashT>1.15){ rec=RecoveryCore(); setPhase('recovery'); } return; }
      if(phase==='recovery'){
        if(rec.update(dt)){ finished=true; const rr2=rec.result();
          const total=clamp(round(8+(landRes&&landRes.approach||approachScore)*0.12+rr2.score*0.28),0,40);
          this._finishRun({result:'FAIL',score:total, details:(landRes?landRes.crashMsg:'Went down.')+' Recovered '+rr2.ok+' of '+rr2.reps+' rounds.',approach:approachScore,air:0,landing:0,recovery:rr2.score}); } return; }
    },
    _land(){
      const slope=surfaceDeg(contactX), err=normDeg(th-slope);
      const flips=Math.floor(Math.abs(totalRot)/360);
      const balFrac=balTot>0?clamp(balIn/balTot,0,1):0;
      const airScore=round(clamp(38+balFrac*46+flips*12,0,100));
      if(contactX<LAND_TOP){ return this._crash('short'); }
      if(contactX>LAND_END){ return this._crash('long'); }
      if(Math.abs(err)<=TOL){
        const styleBonus=clamp(flips*8*(show/100)+(1-Math.abs(err)/TOL)*6+balFrac*8,0,26);
        const score=clamp(round(54+(1-Math.abs(err)/TOL)*20+approachScore*0.08+styleBonus),0,100);
        landRes={result:'SUCCESS',score,approach:approachScore,air:airScore,landing:round(lerp(60,100,1-Math.abs(err)/TOL)),
          details:'Cleared the '+S.unit+' and landed '+(Math.abs(err)<TOL*0.4?'dead level':(err>0?'a touch nose-high':'a touch nose-down'))+(flips>=1?(' '+flips+(flips>1?' flips!':' flip!')):''),crashMsg:''};
        v=Math.hypot(vx,vy)*0.85; shakeT=0.25; setPhase('runout'); return; }
      if(Math.abs(err)<=TOL*1.75){
        const score=clamp(round(42+(1-(Math.abs(err)-TOL)/(TOL*0.75))*16+approachScore*0.05+balFrac*8),35,66);
        landRes={result:'PARTIAL',score,approach:approachScore,air:airScore,landing:round(lerp(58,30,(Math.abs(err)-TOL)/(TOL*0.75))),
          details:'Rode out a rough landing — came down '+(err>0?'nose-high':'nose-down')+' and fought it.',crashMsg:''};
        v=Math.hypot(vx,vy)*0.7; shakeT=0.4; setPhase('runout'); return; }
      this._crash('angle');
    },
    _crash(kind){
      const msg=kind==='short'?'Came up short — into the '+S.unit+'.':kind==='long'?'Overshot the ramp.':kind==='angle'?'Bad body position — over-rotated.':kind==='off'?'Sailed past the landing entirely.':'Lost it.';
      landRes={crashMsg:msg,approach:approachScore};
      crashSpin=(th<0?-1:1)*rnd(420,260)*sign(th||1); vy=Math.max(vy,40); shakeT=0.6;
      for(let i=0;i<14;i++)dust.push({x:cx,y:cy+WR,vx:rnd(160,-160),vy:-rnd(180,40),life:rnd(.8,.3)});
      setPhase('crashing');
    },
    _finishRun(res){ this.finish(res); },
    render(g,W,H){
      const viewW=1020, scale_=W/viewW, viewH=H/scale_;
      cam=clamp(cx-viewW*0.34,0,WORLD_END-viewW+200);
      const baseCamY=GY-viewH*0.78; camY=Math.min(baseCamY,cy-viewH*0.40);
      const sx=x=>(x-cam)*scale_, sy=y=>(y-camY)*scale_;
      let shx=0,shy=0; if(shakeT>0){ shx=rnd(6,-6)*shakeT; shy=rnd(6,-6)*shakeT; }
      g.save(); g.translate(shx,shy);
      const sky=g.createLinearGradient(0,0,0,H); sky.addColorStop(0,'#3a2a1c'); sky.addColorStop(0.6,'#5a3f24'); sky.addColorStop(1,'#7a5530');
      g.fillStyle=sky; g.fillRect(-10,-10,W+20,H+20);
      g.fillStyle='rgba(224,116,47,.45)'; g.beginPath(); g.arc(sx(1300),sy(120),46*scale_,0,TAU); g.fill();
      g.fillStyle='#4a3622'; g.beginPath(); const hb=sy(GY); g.moveTo(-10,hb);
      for(let i=0;i<=10;i++){ const hx=-10+(W+20)*i/10; g.lineTo(hx,sy(GY)-(40+30*Math.sin(i*1.3+cam*0.0006))*scale_); } g.lineTo(W+10,hb); g.fill();
      g.fillStyle='#2a1d10'; g.beginPath(); g.moveTo(sx(0),H+10);
      for(let x=0;x<=WORLD_END;x+=14){ g.lineTo(sx(x),sy(terrainY(x))); } g.lineTo(sx(WORLD_END),H+10); g.closePath(); g.fill();
      g.strokeStyle=C_pal.line; g.lineWidth=3*scale_; g.beginPath();
      g.moveTo(sx(RAMP_START),sy(terrainY(RAMP_START))); g.lineTo(sx(LIP),sy(terrainY(LIP-0.1))); g.stroke();
      g.beginPath(); g.moveTo(sx(LAND_TOP),sy(terrainY(LAND_TOP))); g.lineTo(sx(LAND_END),sy(terrainY(LAND_END-0.1))); g.stroke();
      g.fillStyle=C_pal.oxblood; g.fillRect(sx(LIP)-2,sy(terrainY(LIP-0.1))-22*scale_,3*scale_,22*scale_);
      g.fillStyle=C_pal.gold; g.beginPath(); g.moveTo(sx(LIP),sy(terrainY(LIP-0.1))-22*scale_); g.lineTo(sx(LIP)+14*scale_,sy(terrainY(LIP-0.1))-17*scale_); g.lineTo(sx(LIP),sy(terrainY(LIP-0.1))-12*scale_); g.fill();
      const span=(LAND_TOP-LIP)-120, ox0=LIP+70;
      function scaleType(){ return scale||'cows'; }
      for(let i=0;i<S.n;i++){ const ox=ox0+(S.n>1?i/(S.n-1):0.5)*span; drawObstacle(g,sx(ox),sy(GY),scale_,scale_,scale_,scaleType()); }
      const cheering=(phase==='runout'||(landRes&&landRes.result==='SUCCESS'));
      for(let i=0;i<10;i++){ drawCrowdSil(g,sx(FINISH+30+i*16),sy(GY),70*scale_,cheering?'hands':'lean',1); }
      g.fillStyle=C_pal.line; g.lineWidth=2*scale_; g.beginPath(); g.moveTo(sx(FINISH),sy(GY)-60*scale_); g.lineTo(sx(FINISH),sy(GY)); g.stroke();
      if(phase!=='recovery'){ g.save(); g.translate(sx(cx),sy(cy)); g.rotate(-th*D2R); g.scale(scale_,scale_); drawBikeBig(g,phase==='crashing'); g.restore(); }
      for(const p of dust){ g.fillStyle='rgba(180,150,110,'+clamp(p.life,0,1)+')'; g.beginPath(); g.arc(sx(p.x),sy(p.y),3*scale_,0,TAU); g.fill(); }
      g.restore();
      if(phase==='approach'){ drawSpeedo(g,W,H,v,VMAX,GREEN_C,greenHalf,yellowHalf,cond,(LIP-cx)); }
      else if(phase==='air'){ drawBalanceHUD(g,W,H,th,TARGET_ANG,BAL_BAND,drift,balTot>0?balIn/balTot:0,totalRot); }
      else if(phase==='recovery'){ rec.render(g,W,H); }
      if(phase==='runout'&&landRes){ g.fillStyle=C_pal.cream; g.font='400 22px "Alfa Slab One",serif'; g.textAlign='center'; g.fillText('STUCK IT!',W/2,40); }
    }
  };
  return run;
}

/* ---- Recovery Standalone ---- */
function createRecovery(){
  let core=null;
  return { name:'The Recovery', controlSpec:{type:'pad',dirs:['left','up','right','down']},
    init(){ core=RecoveryCore(); },
    onDir(dir,down){ core.onDir(dir,down); }, onGas(){}, onLean(){}, onTap(){}, onChoice(){},
    update(dt){ if(core.update(dt)){ const r=core.result(); this.finish({result:r.result,score:r.score,
      details:'Cleared '+r.ok+' of '+r.reps+' rounds. '+(r.ok===r.reps?'Body came all the way back.':'It will take more than one session.')}); } },
    render(g,W,H){ g.fillStyle='#150e08'; g.fillRect(0,0,W,H); core.render(g,W,H); } };
}

/* ---- Work the Crowd ---- */
function createCrowd(){
  const nerve=SKILLS.nerve, show=SKILLS.showmanship;
  const N_=7, ROUNDS=3, unlocked=nerve>=45;
  const READ=3.8+(show/100)*3.2;
  const distinct=0.55+(show/100)*0.45;
  const MOOD={
    receptive:{call:'pump',name:'WARMING UP',tell:'Leaning in, nodding along — they\'re with you.',pose:'lean'},
    skeptical:{call:'build',name:'SKEPTICAL',tell:'Arms crossed, a few drifting away — not sold yet.',pose:'cross'},
    electric:{call:'unexpected',name:'ELECTRIC',tell:'On their feet, hands in the air — they want more.',pose:'hands'},
  };
  const PLAY={pump:'PUMP IT UP',build:'BUILD IT SLOW',unexpected:'THE UNEXPECTED'};
  const LEGEND=[
    {pose:'lean',tell:'LEANING IN',play:'PUMP IT UP',locked:false},
    {pose:'cross',tell:'ARMS CROSSED',play:'BUILD IT SLOW',locked:false},
    {pose:'hands',tell:'HANDS UP',play:'THE UNEXPECTED',locked:!unlocked},
  ];
  let energy=34,roundN=0,t=0,moodKey='',crowd=[],settled=false,phase='show',flash=0,feedTxt='',feedSub='',feedGood=false,done=false;
  function buildRound(){
    const pool=unlocked?['receptive','skeptical','electric']:['receptive','skeptical'];
    moodKey=pool[round(rnd(pool.length-0.5,0))];
    const dom=MOOD[moodKey].pose;
    const filler=moodKey==='skeptical'?'away':(moodKey==='electric'?'lean':'hands');
    crowd=[]; for(let i=0;i<N_;i++)crowd.push(Math.random()<0.72?dom:filler);
    t=0; settled=false; phase='show';
  }
  buildRound();
  function rr(g,x,y,w,h,r){ g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); }
  const game={
    name:'Work the Crowd',
    get correctCall(){ return MOOD[moodKey].call; },
    controlSpec:{type:'choices',choices:[
      {id:'pump',label:'Pump It Up',hint:'they\'re warming up',key:'1'},
      {id:'build',label:'Build It Slow',hint:'they\'re skeptical',key:'2'},
      {id:'unexpected',label:'The Unexpected',hint:unlocked?'they\'re electric':'needs Nerve 45+',key:'3',disabled:!unlocked},
    ]},
    init(){ energy=34; roundN=0; done=false; buildRound(); this.setInstruction&&this.setInstruction('Read their body language, then play the matching card.'); },
    onChoice(id){ if(settled||done)return; if(id==='unexpected'&&!unlocked)return;
      settled=true; flash=0.35; const correct=MOOD[moodKey].call, m=MOOD[moodKey];
      const base=id===correct?26:7, bonus=id===correct?(show/100)*10:0, speed=id===correct?clamp(1-t/READ,0,1)*6:0;
      energy=clamp(energy+base+bonus+speed-(id===correct?0:3),0,100);
      feedGood=id===correct;
      if(id===correct){ feedTxt='Nailed the read!'; feedSub='They were '+m.name+' — '+PLAY[correct]+' landed.'; }
      else { feedTxt='Misread them.'; feedSub='They were '+m.name+' — that wanted '+PLAY[correct]+'.'; }
      phase='feedback'; t=0; },
    onGas(){}, onLean(){}, onDir(){}, onTap(){},
    update(dt){ if(done)return;
      if(phase==='show'){ t+=dt; if(t>=READ){ settled=true; energy=clamp(energy-1,0,100);
        feedGood=false; feedTxt='You hesitated.'; feedSub='They were '+MOOD[moodKey].name+'.'; phase='feedback'; t=0; } }
      else if(phase==='feedback'){ if(flash>0)flash-=dt; t+=dt; if(t>=1.35){ roundN++;
        if(roundN>=ROUNDS){ done=true; this._end(); } else buildRound(); } } },
    _end(){ let res,score=round(energy);
      if(energy>=74)res='SUCCESS'; else if(energy>=46)res='PARTIAL'; else res='FAIL';
      this.finish({result:res,score,details:'Worked the crowd to '+round(energy)+'% energy over '+ROUNDS+' calls.'}); },
    render(g,W,H){
      g.fillStyle='#241a12'; g.fillRect(0,0,W,H);
      const gl=g.createRadialGradient(W/2,H*1.15,10,W/2,H*1.15,H*1.3); gl.addColorStop(0,'rgba(224,116,47,'+(0.10+energy/400)+')'); gl.addColorStop(1,'rgba(0,0,0,0)');
      g.fillStyle=gl; g.fillRect(0,0,W,H);
      const bx=W*0.16, bw=W*0.68, by=18, bh=14;
      g.fillStyle='#120b06'; rr(g,bx-4,by-4,bw+8,bh+8,6); g.fill();
      const eg=g.createLinearGradient(bx,0,bx+bw,0); eg.addColorStop(0,C_pal.oxblood); eg.addColorStop(0.5,C_pal.gold); eg.addColorStop(1,C_pal.avocado);
      g.fillStyle=eg; g.fillRect(bx,by,bw*energy/100,bh);
      g.strokeStyle=C_pal.line; g.lineWidth=1; g.strokeRect(bx,by,bw,bh);
      g.fillStyle=C_pal.creamDim; g.font='600 11px Oswald'; g.textAlign='left'; g.fillText('CROWD ENERGY',bx,by-7);
      g.textAlign='right'; g.fillStyle=C_pal.gold; g.font='700 12px "Space Mono"'; g.fillText(round(energy)+'%',bx+bw,by-7);
      g.textAlign='center'; g.fillStyle=C_pal.faint; g.font='600 10px Oswald'; g.fillText('CALL '+Math.min(roundN+1,ROUNDS)+' / '+ROUNDS,W/2,by-7);
      const ly=by+bh+12, chW=W*0.30, gapc=W*0.02, lx0=W/2-(chW*3+gapc*2)/2, chH=40;
      g.textAlign='center';
      for(let i=0;i<LEGEND.length;i++){ const L=LEGEND[i], cxl=lx0+i*(chW+gapc);
        const hot=phase==='feedback'&&MOOD[moodKey].pose===L.pose;
        g.fillStyle=L.locked?'#1a120a':(hot?'rgba(217,154,43,0.18)':'#160f08');
        rr(g,cxl,ly,chW,chH,6); g.fill();
        g.strokeStyle=hot?C_pal.gold:(L.locked?'#2a1f12':C_pal.line); g.lineWidth=hot?2:1; rr(g,cxl,ly,chW,chH,6); g.stroke();
        drawCrowdSil(g,cxl+chH*0.42,ly+chH*0.80,chH*0.92,L.pose,1);
        const tx=cxl+chH*0.78;
        g.textAlign='left';
        g.fillStyle=L.locked?'#5a4a33':C_pal.cream; g.font='700 11px Oswald'; g.fillText(L.tell,tx,ly+16);
        g.fillStyle=L.locked?'#4a3c28':C_pal.gold; g.font='700 11px "Space Mono"'; g.fillText(L.locked?'→ LOCKED':('→ '+L.play),tx,ly+31);
      }
      g.textAlign='center';
      const baseY=H*0.84, gap=W*0.82/N_, x0=W*0.09+gap/2, sScale=H*0.235;
      const energized=phase==='feedback'&&feedGood;
      for(let i=0;i<crowd.length;i++){ drawCrowdSil(g,x0+i*gap,baseY,sScale,energized?'hands':crowd[i],distinct); }
      g.strokeStyle=C_pal.line; g.lineWidth=2; g.beginPath(); g.moveTo(0,baseY+2); g.lineTo(W,baseY+2); g.stroke();
      const py=ly+chH+14;
      if(phase==='show'){
        g.fillStyle=C_pal.creamDim; g.font='600 11px Oswald'; g.fillText('WHAT DO THEY WANT?',W/2,py);
        g.fillStyle=C_pal.cream; g.font='500 14px Oswald'; g.fillText(MOOD[moodKey].tell,W/2,py+19);
        const frac=clamp(1-t/READ,0,1), tw=W*0.46;
        g.fillStyle='#3a2a1c'; rr(g,W/2-tw/2,py+28,tw,7,4); g.fill();
        g.fillStyle=frac<0.3?C_pal.oxblood:C_pal.gold; rr(g,W/2-tw/2,py+28,tw*frac,7,4); g.fill();
      } else {
        g.fillStyle=feedGood?C_pal.avocado:C_pal.oxblood; g.font='400 18px "Alfa Slab One",serif'; g.fillText(feedTxt,W/2,py+4);
        g.fillStyle=C_pal.creamDim; g.font='500 12px Oswald'; g.fillText(feedSub,W/2,py+23);
      }
      if(flash>0){ g.fillStyle=(feedGood?'rgba(154,171,78,':'rgba(168,57,42,')+flash+')'; g.fillRect(0,0,W,H); }
    }
  };
  return game;
}

/* ---- Game defs ---- */
const mgStuntRunDef = { name:'The Stunt Run', factory:(o)=>createStuntRun(o), scales:true };
const mgRecoveryDef = { name:'The Recovery', factory:()=>createRecovery() };
const mgCrowdDef = { name:'Work the Crowd', factory:()=>createCrowd() };

/* ================================================================
   CANVAS DRAW HELPERS (from minigame source)
   ================================================================ */
function drawSpeedo(g,W,H,v,vmax,gc,gh,yh,cond_,distToLip){
  const bx=W*0.5-W*0.34, bw=W*0.68, by=H*0.10, bh=18;
  g.fillStyle='rgba(18,11,6,.85)'; const rr_=(g,x,y,w,h,r)=>{ g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); };
  rr_(g,bx-8,by-26,bw+16,bh+58,8); g.fill();
  const X=s=>bx+(clamp(s,0,vmax)/vmax)*bw;
  g.fillStyle=C_pal.oxblood; g.fillRect(bx,by,bw,bh);
  g.fillStyle='#7a5a1e'; g.fillRect(X(gc-yh),by,X(gc+yh)-X(gc-yh),bh);
  g.fillStyle=C_pal.avocadoDim; g.fillRect(X(gc-gh),by,X(gc+gh)-X(gc-gh),bh);
  g.fillStyle=C_pal.avocado; g.fillRect(X(gc-gh),by,X(gc+gh)-X(gc-gh),3);
  g.strokeStyle='#00000055'; g.lineWidth=1; for(let i=0;i<=10;i++){ const tx=bx+bw*i/10; g.beginPath(); g.moveTo(tx,by); g.lineTo(tx,by+bh); g.stroke(); }
  const shake=cond_<60?(1-cond_/100)*Math.sin(performance.now()/40)*3:0;
  const nx=X(v)+shake; g.fillStyle=C_pal.gold; g.fillRect(nx-2,by-8,4,bh+14);
  g.fillStyle=C_pal.cream; g.beginPath(); g.moveTo(nx,by-10); g.lineTo(nx-6,by-18); g.lineTo(nx+6,by-18); g.fill();
  g.fillStyle=C_pal.creamDim; g.font='600 11px Oswald'; g.textAlign='left'; g.fillText('SPEED',bx,by-12);
  g.textAlign='right'; g.fillStyle=v>=gc-gh&&v<=gc+gh?C_pal.avocado:C_pal.creamDim; g.fillText(v>=gc-gh&&v<=gc+gh?'✓ IN THE ZONE':'',bx+bw,by-12);
  g.textAlign='center'; g.fillStyle=C_pal.creamDim; g.font='500 11px Oswald'; g.fillText('RAMP IN '+Math.max(0,round(distToLip))+'\u2009px',W/2,by+bh+18);
}
function drawBalanceHUD(g,W,H,th,target,band,drift_,balFrac,totalRot){
  const err=normDeg(th-target), MAXE=72;
  const tw=W*0.62, tx=W/2-tw/2, ty=46, bh=22;
  const rr_=(g,x,y,w,h,r)=>{ g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); };
  g.fillStyle='rgba(18,11,6,.82)'; rr_(g,tx-12,ty-32,tw+24,bh+66,9); g.fill();
  g.fillStyle=C_pal.creamDim; g.font='600 11px Oswald'; g.textAlign='left'; g.fillText('BALANCE',tx,ty-14);
  const mw=tw*0.30, mx=tx+tw-mw, my=ty-24;
  g.fillStyle='#2a1d10'; rr_(g,mx,my,mw,7,3); g.fill();
  g.fillStyle=C_pal.gold; rr_(g,mx,my,mw*clamp(balFrac,0,1),7,3); g.fill();
  g.fillStyle=C_pal.faint; g.font='500 9px Oswald'; g.textAlign='right'; g.fillText('CONTROL',mx+mw,my-3);
  const px=e=>tx+tw*(clamp(e,-MAXE,MAXE)+MAXE)/(2*MAXE);
  g.fillStyle='#2a1d10'; rr_(g,tx,ty,tw,bh,6); g.fill();
  const gx0=px(-band), gx1=px(band);
  g.fillStyle=C_pal.avocadoDim; g.fillRect(gx0,ty,gx1-gx0,bh);
  g.fillStyle=C_pal.avocado; g.fillRect(gx0,ty,2,bh); g.fillRect(gx1-2,ty,2,bh);
  g.fillStyle=C_pal.faint; g.fillRect(px(0)-1,ty,2,bh);
  g.font='500 9px Oswald'; g.fillStyle=C_pal.faint; g.textAlign='left'; g.fillText('◀ NOSE DOWN',tx,ty+bh+12);
  g.textAlign='right'; g.fillText('NOSE UP ▶',tx+tw,ty+bh+12);
  const bx_=px(err), inBand=Math.abs(err)<=band;
  if(Math.abs(drift_)>10){ const dir=sign(drift_), ax=bx_+dir*20, ay=ty-9;
    g.fillStyle=C_pal.orange; g.beginPath(); g.moveTo(ax+dir*9,ay); g.lineTo(ax-dir*3,ay-6); g.lineTo(ax-dir*3,ay+6); g.closePath(); g.fill(); }
  g.fillStyle=inBand?C_pal.avocado:C_pal.gold; g.beginPath(); g.arc(bx_,ty+bh/2,10,0,TAU); g.fill();
  g.fillStyle='#120b06'; g.beginPath(); g.arc(bx_,ty+bh/2,4,0,TAU); g.fill();
  g.textAlign='center'; g.font='700 13px Oswald';
  if(inBand){ g.fillStyle=C_pal.avocado; g.fillText('✓ STEADY',W/2,ty+bh+30); }
  else { g.fillStyle=C_pal.gold; g.fillText(err>0?'EASE THE NOSE DOWN — LEAN':'BRING THE NOSE UP — GAS',W/2,ty+bh+30); }
  const flips=Math.floor(Math.abs(totalRot)/360);
  if(flips>=1){ g.fillStyle=C_pal.orange; g.font='700 13px Oswald'; g.textAlign='left'; g.fillText(flips+'× FLIP',16,28); }
}
function drawBikeBig(g,crashed){
  g.lineWidth=4; g.lineCap='round';
  g.strokeStyle=C_pal.creamDim; g.fillStyle='#0e0905';
  for(const wx of [-23,23]){ g.beginPath(); g.arc(wx,0,13,0,TAU); g.fill(); g.beginPath(); g.arc(wx,0,13,0,TAU); g.stroke();
    g.strokeStyle='#3a2a1c'; for(let a=0;a<6;a++){ g.beginPath(); g.moveTo(wx,0); g.lineTo(wx+Math.cos(a)*11,Math.sin(a)*11); g.stroke(); } g.strokeStyle=C_pal.creamDim; }
  g.strokeStyle=C_pal.gold; g.lineWidth=4; g.beginPath(); g.moveTo(-23,0); g.lineTo(-6,-12); g.lineTo(14,-12); g.lineTo(23,0); g.stroke();
  g.beginPath(); g.moveTo(14,-12); g.lineTo(22,-20); g.stroke();
  g.fillStyle=crashed?C_pal.oxblood:C_pal.orangeDim;
  g.beginPath(); g.moveTo(-8,-12); g.lineTo(0,-30); g.lineTo(8,-30); g.lineTo(12,-12); g.closePath(); g.fill();
  g.strokeStyle=crashed?C_pal.oxblood:C_pal.orangeDim; g.lineWidth=5;
  g.beginPath(); g.moveTo(6,-26); g.lineTo(20,-20); g.stroke();
  g.beginPath(); g.moveTo(-2,-14); g.lineTo(-14,-6); g.stroke();
  g.fillStyle='#0e0905'; g.beginPath(); g.arc(6,-34,6,0,TAU); g.fill();
  g.fillStyle=C_pal.gold; g.fillRect(8,-36,4,3);
}
function drawObstacle(g,x,gy,sx,sy,sc,type){
  g.save(); g.translate(x,gy); g.scale(sc,sc);
  if(type==='cows'){ g.fillStyle='#2a1d10'; const rr_=(g,x,y,w,h,r)=>{ g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); }; rr_(g,-16,-22,32,18,5); g.fill();
    g.fillStyle='#1c130b'; g.beginPath(); g.arc(-18,-18,6,0,TAU); g.fill();
    g.fillStyle=C_pal.creamDim; g.fillRect(-6,-19,4,4); g.fillRect(3,-15,5,4);
    g.fillStyle='#3a2a1c'; g.fillRect(-12,-6,5,8); g.fillRect(8,-6,5,8); }
  else if(type==='cars'){ g.fillStyle='#241910'; const rr_=(g,x,y,w,h,r)=>{ g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); }; rr_(g,-16,-20,32,14,4); g.fill();
    g.fillStyle='#2f2117'; rr_(g,-10,-29,20,10,3); g.fill();
    g.fillStyle='#120c07'; g.beginPath(); g.arc(-9,-6,5,0,TAU); g.arc(9,-6,5,0,TAU); g.fill();
    g.fillStyle=C_pal.gold; g.globalAlpha=.5; g.fillRect(13,-18,3,5); g.globalAlpha=1; }
  else { g.fillStyle='#241910'; const rr_=(g,x,y,w,h,r)=>{ g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); }; rr_(g,-15,-50,30,46,4); g.fill();
    g.fillStyle='#3a2a1c'; for(let r=0;r<3;r++)for(let c_=0;c_<2;c_++) g.fillRect(-10+c_*12,-46+r*14,8,9);
    g.fillStyle='#120c07'; g.beginPath(); g.arc(-8,-4,5,0,TAU); g.arc(8,-4,5,0,TAU); g.fill(); }
  g.restore();
}
function drawSeated(g,x,y,s){
  g.save(); g.translate(x,y); g.fillStyle=C_pal.cream;
  g.beginPath(); g.arc(0,-s*0.42,s*0.09,0,TAU); g.fill();
  const rr_=(g,x,y,w,h,r)=>{ g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); };
  rr_(g,-s*0.12,-s*0.33,s*0.24,s*0.30,s*0.06); g.fill();
  rr_(g,-s*0.22,-s*0.04,s*0.44,s*0.10,s*0.05); g.fill();
  g.restore();
}
function drawCrowdSil(g,x,baseY,s,state,distinct){
  g.save(); g.translate(x,baseY); const col='#15100a'; g.fillStyle=col;
  const headR=s*0.13, bodyW=s*0.30, bodyH=s*0.55, ex=distinct;
  const rr_=(g,x,y,w,h,r)=>{ g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); };
  if(state==='away'){ g.beginPath(); g.arc(s*0.10*ex,-bodyH-headR,headR,0,TAU); g.fill();
    g.save(); g.rotate(0.18*ex); rr_(g,-bodyW/2,-bodyH,bodyW,bodyH,bodyW*0.4); g.fill(); g.restore(); }
  else if(state==='cross'){ g.beginPath(); g.arc(0,-bodyH-headR,headR,0,TAU); g.fill();
    rr_(g,-bodyW*0.62,-bodyH,bodyW*1.24,bodyH,bodyW*0.3); g.fill();
    g.fillStyle='#0c0805'; g.fillRect(-bodyW*0.6,-bodyH*0.62,bodyW*1.2,s*0.05*ex+s*0.03); }
  else if(state==='hands'){ g.beginPath(); g.arc(0,-bodyH-headR,headR,0,TAU); g.fill();
    rr_(g,-bodyW/2,-bodyH,bodyW,bodyH,bodyW*0.4); g.fill();
    g.lineWidth=s*0.07; g.strokeStyle=col; g.lineCap='round';
    g.beginPath(); g.moveTo(-bodyW*0.3,-bodyH*0.9); g.lineTo(-bodyW*0.55,-bodyH-headR*2*ex-2); g.stroke();
    g.beginPath(); g.moveTo(bodyW*0.3,-bodyH*0.9); g.lineTo(bodyW*0.55,-bodyH-headR*2*ex-2); g.stroke(); }
  else { g.save(); g.rotate(-0.16*ex); g.beginPath(); g.arc(s*0.06,-bodyH-headR,headR,0,TAU); g.fill();
    rr_(g,-bodyW/2,-bodyH,bodyW,bodyH,bodyW*0.4); g.fill(); g.restore(); }
  g.restore();
}

/* ================================================================
   BOOT
   ================================================================ */

document.getElementById('btn-begin').onclick = showSetup;
document.getElementById('btn-start').onclick = startGame;
document.getElementById('stat-continue-btn').onclick = afterStats;
document.getElementById('btn-play-again').onclick = ()=>{ slot.reset(); location.reload(); };

// The hub bar is the one that matters: it is reachable four times mid-run,
// which is what "export before you close the tab" needs to be worth anything.
// The title bar carries import only — there is nothing worth exporting from a
// title screen, and Continue covers the save that is already there.
const hubBar = mountSaveBar(document.getElementById('save-bar-hub'), slot, {
  getState: ()=> ({ name:GS.name, town:GS.town, stats:{...GS.stats}, rels:{...GS.rels},
                    flags:{...GS.flags}, scene:currentScene, screen:'hub' }),
  setState: s => applyState(s),
  buttons: ['export','import','reset'],
});

mountSaveBar(document.getElementById('save-bar-title'), slot, {
  getState: ()=> slot.load() || slot.fresh(),
  setState: s => applyState(s),
  buttons: ['import'],
});

// Continue, only when there is something to continue. `slot.load()` has already
// run validate + repair by the time it returns, so a corrupt or foreign blob
// leaves the title screen exactly as it was rather than booting on garbage.
{
  const saved = slot.load();
  if(saved){
    const btn = document.getElementById('btn-continue');
    btn.style.display = '';
    btn.onclick = ()=> applyState(saved);
    document.getElementById('btn-begin').textContent = 'New Game';
  }
}

// This is a module, so nothing above is global. Two audiences need names:
// the `_gateRoute`/`_requires` closures inside SCENES (which already close over
// their own scope, so nothing to do), and the regression suite in
// Projects/daredevil/test/, which drives the page from outside.
window.__dd = {
  GS, SCENES, slot,
  goToScene, applyState, persist, currentHubRoute,
  get scene(){ return currentScene; },
  get mg(){ return mgActive; },
};
