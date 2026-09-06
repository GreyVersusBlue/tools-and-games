// rules.js — PF2e Remaster character math, lifted out of torchbearer.html.
//
// Every function below was already pure: it touches no DOM, holds no state and
// depends on nothing but `Registry` and the constants at the top of this file.
// They were a module pasted into an HTML file, and nothing could call them from
// Node, so the level-3 numbers the whole game rests on had never been checked
// against the Player Core once. `test/smoke.mjs` imports this and builds all
// eight core classes under plain Node.
//
// Moved verbatim, with two deliberate changes:
//
//   1. `Dice` takes an injectable random source (`setDiceSource`), so a test can
//      pin a natural 20 without patching a global. The default is Math.random,
//      which is what the page has always used.
//   2. `assuranceFloor`/`assuranceDegree` were computed inline inside
//      Story.choose and Story.resolveCheck. Two rounds found two bugs in that
//      arithmetic, so it is a named function here with a check on it.
//
// `CHAR_LEVEL` is exported rather than duplicated: Phase 6 (a hero who levels)
// has one place to change.

import { Registry } from "./registry.js";

export const PROF_VAL = {U:0,partial:1,T:2,E:4,M:6,L:8};
export const ABILITIES = ["str","dex","con","int","wis","cha"];
export const SKILLS = {
  acrobatics:"dex", arcana:"int", athletics:"str", crafting:"int", deception:"cha",
  diplomacy:"cha", intimidation:"cha", medicine:"wis", nature:"wis", occultism:"int",
  performance:"cha", religion:"wis", society:"int", stealth:"dex", survival:"wis", thievery:"dex"
};
export const CHAR_LEVEL = 3;

/* ---------- Dice ----------
   `d` is the only entry point that consumes randomness, so an injected source
   pins every roll in the game: Dice.roll, Combat's strikes, everything. */
let randomSource = Math.random;
/** Swap the underlying [0,1) source. Pass nothing to restore Math.random. */
export function setDiceSource(fn){ randomSource = fn || Math.random; }
export const Dice = {
  d(n){ return 1+Math.floor(randomSource()*n); },
  roll(formula){ // "2d6+3", "1d8", "3", "2d8+16"
    let total=0; const parts=String(formula).replace(/\s/g,"").split("+");
    const detail=[];
    for(const p of parts){
      const m = p.match(/^(\d*)d(\d+)$/);
      if(m){ const n=parseInt(m[1]||"1"), s=parseInt(m[2]);
        for(let i=0;i<n;i++){ const r=this.d(s); total+=r; detail.push(r);} }
      else { const v=parseInt(p)||0; total+=v; if(v) detail.push("+"+v); }
    }
    return {total,detail:detail.join(","),formula};
  },
  degree(d20, total, dc){
    let deg = total>=dc+10?3 : total>=dc?2 : total<=dc-10?0 : 1;
    if(d20===20) deg=Math.min(3,deg+1);
    if(d20===1) deg=Math.max(0,deg-1);
    return deg; // 0 critFail 1 fail 2 success 3 critSuccess
  }
};

/* Collect every effects[] array active on a build */
export function activeEffects(build){
  const out=[]; const push=(src,effs)=>{ (effs||[]).forEach(e=>out.push({src,e})); };
  const anc=Registry.ancestries[build.ancestry], her=anc&&(anc.heritages||[]).find(h=>h.id===build.heritage);
  if(her) push(her.name,her.effects);
  const cls=Registry.classes[build.cls];
  if(cls){ (cls.features||[]).forEach(f=>{ if(f.level<=CHAR_LEVEL) push(f.name,f.effects); if(f.special) out.push({src:f.name,e:{special:f.special}}); }); }
  const sub=cls&&cls.subclass&&(cls.subclass.options||[]).find(o=>o.id===build.subclass);
  if(sub) push(sub.name,sub.effects);
  Object.values(build.feats).flat().filter(Boolean).forEach(fid=>{
    const f=Registry.feats[fid]; if(f) push(f.name,f.effects);
  });
  /* `{"grantFeat":"shield-block"}` is documented in §6 of the authoring guide as
     "fixed feat by id", and three pieces of core content use it that way: the
     Fighter's level-1 Shield Block feature and both Warpriest Cleric doctrines.
     Nothing read it. The only handling anywhere was the Builder counting
     "class-1" and "general" as extra feat *slots*, so a Fighter with a raised
     steel shield never blocked a single hit — Combat gates the reaction on
     `specials.includes("shield-block")`, and that special only ever arrived if
     the player happened to spend a general feat on the same thing the class
     sheet already promised them. Resolving it here fixes all three.
     `out.filter` snapshots the array, so a granted feat's own grants are not
     expanded: one level deep, no cycles. */
  const granted=new Set();
  out.filter(x=>typeof x.e.grantFeat==="string").forEach(({src,e})=>{
    const f=Registry.feats[e.grantFeat];
    if(f && !granted.has(f.id)){ granted.add(f.id); push(`${src} → ${f.name}`, f.effects); }
  });
  return out;
}

export function abilityMods(build){
  const mods={str:0,dex:0,con:0,int:0,wis:0,cha:0};
  const anc=Registry.ancestries[build.ancestry];
  if(anc){
    anc.boosts.forEach((b,i)=>{ if(b!=="free"&&mods[b]!==undefined) mods[b]++; });
    (anc.flaws||[]).forEach(f=>mods[f]--);
    (build.boosts.ancestry||[]).forEach(a=>{ if(a) mods[a]++; });
  }
  if(build.boosts.bgA) mods[build.boosts.bgA]++;
  if(build.boosts.bgFree) mods[build.boosts.bgFree]++;
  if(build.boosts.key) mods[build.boosts.key]++;
  (build.boosts.free||[]).forEach(a=>{ if(a) mods[a]++; });
  ABILITIES.forEach(a=>{ mods[a]=Math.min(4,mods[a]); });
  return mods;
}

export function finalizeCharacter(build){
  const anc=Registry.ancestries[build.ancestry];
  const cls=Registry.classes[build.cls];
  const bg=Registry.backgrounds[build.background];
  const abil=abilityMods(build);
  const effs=activeEffects(build);
  /* `{"special":"assurance","skill":"athletics"}` carries which skill it floors, but a
     bare map of x.e.special threw that away and collapsed every Assurance feat to the
     same string "assurance" — so Assurance (Arcana) and Assurance (Athletics) were
     indistinguishable and neither could be checked against a specific skill. Keyed as
     "assurance-<skill>" instead, matching the feat ids already in the Registry. */
  const specials=new Set(effs.filter(x=>x.e.special).map(x=>x.e.special==="assurance"?`assurance-${x.e.skill}`:x.e.special));
  const notes=effs.filter(x=>x.e.note).map(x=>`${x.src}: ${x.e.note}`);

  // proficiencies
  const prof={perception:cls.perception, classDC:cls.classDC||"T",
    saves:{...cls.saves}, attacks:{unarmed:"T",simple:"U",martial:"U",advanced:"U",...cls.attacks},
    defenses:{unarmored:"T",light:"U",medium:"U",heavy:"U",...cls.defenses},
    spellcasting: cls.spellcasting? "T":"U"};
  // skills
  const skills={}; Object.keys(SKILLS).forEach(s=>skills[s]="U");
  (bg.skills||[]).forEach(s=>skills[s]="T");
  build.skills.forEach(s=>{ if(skills[s]==="U") skills[s]="T"; });
  // skill increase at 3 → builder stores in build.skillIncrease (raise T→E)
  const lores=[]; if(bg.lore) lores.push({name:bg.lore,rank:"T"});

  // apply effects
  let tradition = cls.spellcasting? cls.spellcasting.tradition : null;
  let focusMax=0; const focusSpells=[]; const resists=[]; let hpBonus=0, speedBonus=0, initBonus=0; const sensesExtra=[];
  /* A `bonus` carrying a `vs` is conditional — it applies to one kind of check
     and nothing else, so there is no single number on the sheet to add it to.
     They are collected here rather than dropped, and the check sites that know
     about a condition read them by name. Phase 4 wires exactly one: Sensate
     Gnome's `{"target":"perception","vs":"seek"}`, which Combat.seek adds. The
     rest stay collected and unread until the site that means them exists. */
  const condBonuses=[];
  effs.forEach(({src,e})=>{
    if(e.profUp){ const t=e.profUp.target;
      if(e.profUp.ifSubclass && !(build.subclass||"").includes(e.profUp.ifSubclass)) return;
      const up=(cur)=> PROF_VAL[e.profUp.rank]>PROF_VAL[cur]? e.profUp.rank:cur;
      if(t==="perception") prof.perception=up(prof.perception);
      else if(t.startsWith("save.")){ const s=t.split(".")[1];
        if(s==="all"){} else prof.saves[s]=up(prof.saves[s]); }
    }
    if(e.attackProf) Object.entries(e.attackProf).forEach(([k,v])=>{ if(PROF_VAL[v]>PROF_VAL[prof.attacks[k]||"U"]) prof.attacks[k]=v; });
    if(e.armorProf) Object.entries(e.armorProf).forEach(([k,v])=>{ if(PROF_VAL[v]>PROF_VAL[prof.defenses[k]||"U"]) prof.defenses[k]=v; });
    if(e.trainSkill && e.trainSkill!=="choice"){ if(skills[e.trainSkill]==="U") skills[e.trainSkill]="T"; }
    if(e.grantLore) lores.push({name:e.grantLore,rank:e.rank||"T"});
    if(e.bonus){ const b=e.bonus;
      if(b.vs) condBonuses.push({target:b.target,value:b.value,type:b.type||"untyped",vs:b.vs});
      if(b.target==="speed"&&!b.vs) speedBonus+=b.value;
      else if(b.target==="hp") hpBonus+=b.value;
      else if(b.target==="initiative") initBonus+=b.value;
    }
    if(e.resist) resists.push({type:e.resist.type, value:e.resist.value==="halfLevel"?Math.max(1,Math.floor(CHAR_LEVEL/2)):e.resist.value});
    if(e.focusPoints) focusMax=Math.min(3,focusMax+e.focusPoints);
    if(e.grantFocusSpell) focusSpells.push(e.grantFocusSpell);
    if(e.grantFocusSpellChoice){ const pick=build.focusChoices[src]||e.grantFocusSpellChoice[0]; focusSpells.push(pick); }
    if(e.tradition) tradition=e.tradition;
    if(e.sense) sensesExtra.push(e.sense);
    if(e.font) specials.add("font-"+e.font);
  });
  if(build.skillIncrease && skills[build.skillIncrease]==="T") skills[build.skillIncrease]="E";
  if(specials.has("toughness")) hpBonus+=CHAR_LEVEL;

  // gear
  const wep = Registry.items[build.gear.weapon]||Registry.items["fist"];
  const wep2 = build.gear.weapon2? Registry.items[build.gear.weapon2]:null;
  const rng = build.gear.ranged? Registry.items[build.gear.ranged]:null;
  const armor = Registry.items[build.gear.armor]||Registry.items["explorers-clothing"];
  // deadly simplicity: deity weapon die up one step (approx: apply to simple weapons)
  const dieUp=d=>({"1d4":"1d6","1d6":"1d8","1d8":"1d10","1d10":"1d12","1d12":"1d12"}[d]||d);

  const lvl=CHAR_LEVEL;
  const profB=(rank)=> rank==="U"?0:PROF_VAL[rank]+lvl;
  const armorRank = prof.defenses[armor.prof]||"U";
  const dexToAC = Math.min(abil.dex, armor.dexCap!==undefined?armor.dexCap:5);
  const ac = 10 + profB(armorRank==="U"?"U":armorRank) + dexToAC + armor.acBonus;
  const hp = anc.hp + (cls.hp+abil.con)*lvl + hpBonus;
  let speed = anc.speed + speedBonus - (specials.has("ignore-armor-speed")?0:(armor.speedPen||0));

  const saves={};
  ["fort","ref","will"].forEach(s=>{
    const ab=s==="fort"?"con":s==="ref"?"dex":"wis";
    saves[s]=profB(prof.saves[s])+abil[ab];
  });
  const perception=profB(prof.perception)+abil.wis;
  const keyAbil = build.boosts.key || cls.keyAbility[0];
  /* Class DC was computed nowhere: `keyAbil` was a dead local, assigned and never
     read, so the number the Player Core prints on every class sheet did not exist
     in this game. It is on the sheet now, by the standard formula. */
  const classDC = 10 + profB(prof.classDC) + abil[keyAbil];

  function weaponAttack(item,opts){
    if(!item) return null;
    const cat=item.prof; let rank=prof.attacks[cat]||"U";
    if(rank==="partial") rank=item.rogueOk?"T":"U";
    const finesse=(item.traits||[]).includes("finesse");
    const isRanged=!!item.range;
    const atkAbil = isRanged? "dex" : (finesse? (abil.dex>abil.str?"dex":"str") : "str");
    let dmgAbil = isRanged? ((item.traits||[]).includes("propulsive")? Math.floor(abil.str/2):0) : abil.str;
    if(!isRanged && finesse && specials.has("racket-thief") && abil.dex>abil.str) dmgAbil=abil.dex;
    let die=item.damage;
    if(specials.has("deadly-simplicity") && item.prof==="simple") die=dieUp(die);
    const itemAtk = 1; // +1 weapon potency rune, standard 3rd-level kit
    return {name:item.name, id:item.id, bonus:profB(rank)+abil[atkAbil]+itemAtk, die,
      dmgMod:typeof dmgAbil==="number"?dmgAbil:0, damageType:item.damageType,
      traits:item.traits||[], range:item.range?Math.floor(item.range/5):1, ranged:isRanged,
      statusDmg:(specials.has("emblazon")?1:0)};
  }
  const attacks=[weaponAttack(wep)];
  if(wep2) attacks.push(weaponAttack(wep2));
  if(rng) attacks.push(weaponAttack(rng));
  if(specials.has("witchs-armaments")) attacks.push({name:"Eldritch Nails",id:"nails",bonus:profB("T")+Math.max(abil.dex,abil.str)+0,die:"1d6",dmgMod:abil.str,damageType:"slashing",traits:["agile","finesse"],range:1,ranged:false,statusDmg:0});
  if(!wep2 && !attacks.some(a=>a&&!a.ranged)) attacks.push(weaponAttack(Registry.items["fist"]));

  // spellcasting
  let casting=null;
  if(cls.spellcasting){
    const sc=cls.spellcasting;
    const castAbil=abil[sc.ability];
    const dc=10+profB("T")+castAbil, atk=profB("T")+castAbil;
    let cantrips=[...build.spells.cantrips,...(sc.grantCantrips||[])];
    cantrips=[...new Set(cantrips)];
    casting={tradition,type:sc.type,ability:sc.ability,dc,attack:atk,
      cantrips, r1:[...build.spells.r1], r2:[...build.spells.r2],
      slots:{1:sc.slots["1"],2:sc.slots["2"]},
      font: specials.has("font-heal")? {spell:"heal",uses:4}:null};
  }
  return {
    name:build.name||"The Nameless", level:lvl, build,
    ancestry:anc.name, heritage:(anc.heritages.find(h=>h.id===build.heritage)||{}).name,
    background:bg.name, className:cls.name,
    subclassName: cls.subclass? ((cls.subclass.options.find(o=>o.id===build.subclass)||{}).name||"") : "",
    abil, keyAbil, classDC, hpMax:hp, ac, speed, saves, perception, initBonus,
    skills, lores, prof, specials:[...specials], notes, resists, condBonuses,
    attacks:attacks.filter(Boolean), casting, focusMax, focusSpells:[...new Set(focusSpells)],
    senses:[...new Set([...(anc.senses||[]),...sensesExtra])],
    consumables:[{id:"healing-potion-minor",count:2+(specials.has("cauldron")?2:0)}]
  };
}

/* skill modifier for a finalized character */
export function skillMod(ch, skill){
  if(skill==="perception") return ch.perception;
  const rank=ch.skills[skill]||"U";
  const b= rank==="U"?0:PROF_VAL[rank]+ch.level;
  return b+ch.abil[SKILLS[skill]];
}

/* ---------- Assurance ----------
   Locked as a floor, not a bonus: `10 + proficiency bonus`, no ability
   modifier, and forgoing the roll always yields exactly a success or a failure,
   never a critical either way — the authoring guide's own wording is "forgo the
   roll and take 10 + your proficiency bonus". Untrained is a bonus of 0, so the
   floor is a flat 10. This arithmetic was inline in two places in the page and
   was wrong twice; it is one function with checks on it now. */
export function assuranceFloor(ch, skill){
  const rank = ch.skills[skill] || "U";
  return 10 + (rank === "U" ? 0 : PROF_VAL[rank] + ch.level);
}
/** 2 (success) or 1 (failure). Never 0 or 3 — Assurance cannot crit. */
export function assuranceDegree(floor, dc){ return floor >= dc ? 2 : 1; }
