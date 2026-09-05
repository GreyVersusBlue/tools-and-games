// combat.js — the half of Torchbearer's combat that is rules, not pixels.
//
// `Combat` in torchbearer.html was 905 lines: Dijkstra movement and Bresenham
// line of sight and `effAC` and `strike` interleaved with thirteen render
// methods, calling `App.log` from inside damage resolution and driving its own
// clock with `setTimeout`. Nothing in it could be run from Node, so every rule
// in here — flanking, Feint, MAP, Shield Block, Crossbow Ace — had been checked
// exactly once each, by a session clicking through a browser, and then never
// again.
//
// This file is the first cut, split by dependency rather than by feature. What
// moved is everything a Strike passes through: geometry, conditions, the AC and
// attack math, damage, saves, and the two strike paths. What stayed in the page
// is everything that needs a DOM or a clock — the turn loop, the enemy AI, the
// action bar, the spell menu and `castAt`, and all rendering. Those are the
// next increment.
//
// Two seams make the split possible:
//
//   1. **Events, not `App.log`.** Every line the engine used to write straight
//      into the Chronicle is now `this.log(text)`, which pushes
//      `{kind, text, cls}` onto `this.events` and hands it to `onEvent`. The
//      page's `onEvent` calls `App.log`, so the Chronicle reads exactly as it
//      did; a test reads the array instead. Dice rolls go through `this.seal`,
//      which emits `{kind:"roll", ...}` with the d20, the arithmetic and the
//      degree, and the page turns that back into `App.rollSeal`.
//   2. **`floatText` is a no-op here.** The engine announces the number; the
//      page decides whether it floats up the screen in orange. Nothing in this
//      file knows a colour it did not already carry as data.
//
// The page's `Combat` is `newCombat()` with its view methods assigned over the
// top, so `this` is one object and no call site changed. A test builds a bare
// engine with `newCombat({cbs, order, ...})` and drives it directly.

import { Dice } from "./rules.js";
import { esc, cap } from "./text.js";

export const CombatCore = {

  /* ---------- the event seam ---------- */
  /** Push an event and hand it to the view, if one is listening. */
  emit(ev){ this.events.push(ev); if(this.onEvent) this.onEvent(ev); return ev; },
  /** A Chronicle line. `text` is HTML — every caller escapes its own names. */
  log(text,cls){ return this.emit({kind:"log",text,cls:cls||"combat"}); },
  /** A d20 result. The page renders this as the wax seal; a test reads `deg`. */
  seal(title,d20,math,deg){ return this.emit({kind:"roll",text:title,cls:"roll",d20,math,deg}); },
  /** View-only. The page overrides this with the DOM version. */
  floatText(){},

  key(x,y){ return x+","+y; },
  cur(){ return this.order[this.turnIdx]; },
  alive(side){ return this.cbs.filter(c=>c.side===side&&!c.dead); },
  spend(n){ this.actions-=n; },

  kill(cb){
    cb.dead=true; cb.hp=0;
    this.log(`<b>${esc(cb.name)} ${cb.side==="foe"?"is destroyed":"falls, and does not rise"}.</b>`);
  },

  /* ---------- conditions & math ---------- */
  condVal(cb,name){ const c=cb.conditions.find(x=>x.c===name); return c? c.v:0; },
  addCond(cb,name,v,dur,silent){
    if(cb.immunities&&(cb.immunities.includes("mental"))&&["frightened","stunned","bane","hexed","night-shrouded"].includes(name)&&name!=="stunned") { if(!silent) this.log(`${esc(cb.name)} is immune (mindless).`); return; }
    if(name==="frightened"&&cb.char&&cb.char.specials.includes("reduce-frightened")) v=Math.max(0,v-1);
    if(v<=0) return;
    const ex=cb.conditions.find(x=>x.c===name);
    if(ex){ ex.v=Math.max(ex.v,v); if(dur!==undefined) ex.dur=Math.max(ex.dur||0,dur); }
    else cb.conditions.push({c:name,v,dur});
    if(!silent) this.log(`${esc(cb.name)} is <b>${name} ${v>1||["frightened","enfeebled","sickened","clumsy","stunned"].includes(name)?v:""}</b>.`);
  },
  decCond(cb,name,by){ const c=cb.conditions.find(x=>x.c===name); if(!c) return;
    c.v-=by||1; if(c.v<=0) cb.conditions=cb.conditions.filter(x=>x!==c); },
  buffSum(cb,target){
    let status=0, circ=0;
    cb.buffs.forEach(b=>(b.bonuses||[]).forEach(x=>{
      if(x.target===target||x.target==="all"){ if(x.type==="status") status=Math.max(status,x.value); else circ=Math.max(circ,x.value); }}));
    return status+circ;
  },
  atkMod(cb,attack){
    let m=attack.bonus;
    m-=this.condVal(cb,"frightened")+this.condVal(cb,"sickened");
    if(!attack.ranged) m-=this.condVal(cb,"enfeebled");
    m-=this.condVal(cb,"bane")+this.condVal(cb,"hexed")+this.condVal(cb,"night-shrouded");
    if(this.condVal(cb,"prone")) m-=2;
    m+=this.buffSum(cb,"attack");
    return m;
  },
  effAC(target,attacker,opts){
    let ac=target.ac;
    ac-=this.condVal(target,"frightened")+this.condVal(target,"sickened")+this.condVal(target,"clumsy")+this.condVal(target,"fatigued");
    ac+=this.buffSum(target,"ac");
    if(target.shieldRaised) ac+=2;
    /* Outwit (Ranger edge): +1 circumstance AC against your own hunted prey —
       the defensive half of edge-outwit. huntPreyId is a single global (only
       the hero can be a Ranger), so this never needs to be per-character. */
    if(attacker&&target.char&&target.char.specials.includes("edge-outwit")&&this.huntPreyId===attacker.id) ac+=1;
    let offGuard=false;
    if(this.condVal(target,"prone")) offGuard=true;
    if(opts&&opts.forceOffGuard) offGuard=true;
    if(this.surprise&&target.side==="foe") offGuard=true;
    /* Surprise Attack (Rogue, level 1): "creatures that haven't acted [in round 1]
       are off-guard to you" — narrower than the scripted-ambush `this.surprise`
       flag above (which is a scene-authored freebie against the whole party).
       This one is per-attacker and expires the instant a foe takes its turn,
       not at the end of the round, so it is checked against turn order rather
       than a flat round number. */
    if(this.round===1&&attacker&&attacker.char&&attacker.char.specials.includes("surprise-attack")
       &&this.order.indexOf(target)>=this.turnIdx) offGuard=true;
    /* Feint: off-guard to the specific feinter's attacks only, for the rest of
       their own turn (round+turnIdx unchanged) — a single Strike on a plain
       Feint, every attack this turn if the feinter has racket-scoundrel. */
    if(attacker&&target.feint&&target.feint.by===attacker.id&&target.feint.round===this.round
       &&target.feint.turnIdx===this.turnIdx&&target.feint.usesLeft>0){
      offGuard=true; target.feint.usesLeft--;
    }
    if(attacker&&!attacker.ranged&&this.isFlanking(attacker,target)) offGuard=true;
    if(offGuard&&!(target.char&&target.char.specials.includes("deny-advantage"))) ac-=2;
    return {ac,offGuard};
  },
  isFlanking(attacker,target){
    if(this.dist(attacker,target)>1) return false;
    return this.cbs.some(a=>a!==attacker&&a.side===attacker.side&&!a.dead&&a.dying===0&&this.dist(a,target)<=1
      && (a.x+attacker.x===2*target.x && a.y+attacker.y===2*target.y));
  },
  saveMod(cb,save){
    let m=cb.saves[save==="fortitude"?"fort":save==="reflex"?"ref":"will"]||0;
    m-=this.condVal(cb,"frightened")+this.condVal(cb,"sickened")+this.condVal(cb,"fatigued")+this.condVal(cb,"hexed");
    if(save==="reflex") m-=this.condVal(cb,"clumsy");
    m+=this.buffSum(cb,"saves");
    // fortune from bit of luck / guidance
    return m;
  },
  applyDamage(target,amount,dtype,attacker,label){
    if((target.immunities||[]).includes(dtype)){ this.log(`${esc(target.name)} is immune to ${dtype}.`); return 0; }
    let dmg=amount;
    const w=(target.weaknesses||[]).find(x=>x.type===dtype||x.type==="physical"&&["slashing","piercing","bludgeoning"].includes(dtype));
    if(w){ dmg+=w.value; this.log(`Weakness to ${w.type}! +${w.value}.`); }
    const r=(target.resistances||[]).concat(target.char? target.char.resists:[]).find(x=>x&&(x.type===dtype||(x.type==="physical"&&["slashing","piercing","bludgeoning"].includes(dtype))));
    if(r){ dmg=Math.max(0,dmg-r.value); }
    // shield block
    if(target.side==="pc"&&target.shieldRaised&&!target.reactionUsed&&target.char&&target.char.specials.includes("shield-block")
       &&["slashing","piercing","bludgeoning"].includes(dtype)&&dmg>0){
      target.reactionUsed=true; const blocked=Math.min(5,dmg); dmg-=blocked;
      this.log(`${esc(target.name)} <b>Shield Blocks</b>: ${blocked} damage rings off steel.`);
    }
    if(target.tempHP>0){ const t=Math.min(target.tempHP,dmg); target.tempHP-=t; dmg-=t; }
    target.hp=Math.max(0,target.hp-dmg);
    this.floatText(target,"-"+dmg, dtype==="fire"?"#E8845A":dtype==="cold"?"#8CC7E8":"#E86A5A");
    if(target.hp===0){
      if(target.side==="foe") this.kill(target);
      else if(target.dying===0){ target.dying=1+(target.wounded||0); target.wounded=(target.wounded||0)+1;
        target.conditions=[]; this.log(`<b>${esc(target.name)} falls! Dying ${target.dying}.</b>`); }
    }
    return dmg;
  },
  heal(target,amount){
    if(target.dying>0){ target.dying=0; this.log(`${esc(target.name)} is pulled back from the brink.`); }
    const h=Math.min(amount,target.hpMax-target.hp);
    target.hp+=h; this.floatText(target,"+"+h,"#8FD68F");
    return h;
  },

  /* ---------- geometry ---------- */
  dist(a,b){ return Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y)); },
  occupied(x,y){ return this.cbs.find(c=>!c.dead&&c.x===x&&c.y===y); },
  passable(x,y,mover){
    if(x<0||y<0||x>=this.mapW||y>=this.mapH) return false;
    if(this.walls.has(this.key(x,y))) return false;
    const occ=this.occupied(x,y);
    if(occ&&occ!==mover&&!(occ.side===mover.side)) return false; // can't pass enemies
    return true;
  },
  losClear(a,b){
    let x0=a.x,y0=a.y; const x1=b.x,y1=b.y;
    const dx=Math.abs(x1-x0), dy=Math.abs(y1-y0), sx=x0<x1?1:-1, sy=y0<y1?1:-1;
    let err=dx-dy;
    while(!(x0===x1&&y0===y1)){
      const e2=2*err;
      if(e2>-dy){ err-=dy; x0+=sx; }
      if(e2<dx){ err+=dx; y0+=sy; }
      if(x0===x1&&y0===y1) break;
      if(this.walls.has(this.key(x0,y0))) return false;
    }
    return true;
  },
  reachable(cb,budget){ // Dijkstra with 5-10-5 diagonals & difficult terrain; returns {key:{cost,prev}}
    const start={x:cb.x,y:cb.y}; const out={}; out[this.key(cb.x,cb.y)]={cost:0,prev:null,diag:0};
    const pq=[{x:cb.x,y:cb.y,cost:0,diag:0}];
    while(pq.length){
      pq.sort((a,b)=>a.cost-b.cost); const n=pq.shift();
      const k=this.key(n.x,n.y); if(out[k]&&out[k].cost<n.cost) continue;
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
        if(!dx&&!dy) continue;
        const nx=n.x+dx, ny=n.y+dy;
        if(!this.passable(nx,ny,cb)) continue;
        const diagN=(dx&&dy)? n.diag+1:n.diag;
        let step=(dx&&dy)? ((n.diag%2)?2:1):1;
        if(this.diff.has(this.key(nx,ny))) step+=1;
        const cost=n.cost+step;
        if(cost>budget) continue;
        const nk=this.key(nx,ny);
        if(!out[nk]||out[nk].cost>cost){ out[nk]={cost,prev:k,diag:diagN}; pq.push({x:nx,y:ny,cost,diag:diagN}); }
      }
    }
    return out;
  },
  meleeIdx(cb){ const i=cb.attacks.findIndex(a=>!a.ranged); return i<0?0:i; },
  moveBudget(cb){ let s=cb.speed||Math.floor((cb.char?cb.char.speed:25)/5);
    if(this.condVal(cb,"gripped")) s=Math.max(1,s-1);
    return s; },
  mapPenalty(cb,a){
    if(cb.mapCount===0) return 0;
    const agile=(a.traits||[]).includes("agile");
    const flurry=cb.char&&cb.char.specials.includes("edge-flurry")&&this.huntPreyId&&this.sel&&this.sel.id===this.huntPreyId;
    const base=flurry? (agile?[0,-2,-4]:[0,-3,-6]) : (agile?[0,-4,-8]:[0,-5,-10]);
    return base[Math.min(2,cb.mapCount)];
  },

  /* ---------- strikes ---------- */
  strike(att,def,wpn,opts){
    opts=opts||{};
    const mapPen=opts.noMAP?0:(()=>{ const saveSel=this.sel; this.sel=def; const p=this.mapPenalty(att,wpn); this.sel=saveSel; return p; })();
    let mod=this.atkMod(att,wpn)+mapPen;
    const {ac,offGuard}=this.effAC(def,{...att,ranged:wpn.ranged},{forceOffGuard:opts.forceOffGuard||def.offGuardUntil===this.round});
    const fortune=att.buffs.some(b=>b.fortune);
    let d20=Dice.d(20);
    if(fortune){ const d2=Dice.d(20); d20=Math.max(d20,d2); att.buffs=att.buffs.filter(b=>!b.fortune); }
    // blur on defender
    if(def.buffs.some(b=>b.flag==="blurred")){ if(Dice.d(20)<=4){ this.log(`The blur swallows the blow — a clean miss.`); if(!opts.exacting&&!opts.noMAP) att.mapCount++; return 1; } }
    const total=d20+mod;
    const deg=Dice.degree(d20,total,ac);
    this.seal(`${att.name}: ${wpn.name} vs ${def.name}${offGuard?" (off-guard)":""}`,d20,`${d20}${mod>=0?"+":""}${mod} = ${total} vs AC ${ac}`,deg);
    if(!opts.noMAP&&!(opts.exacting&&deg<2)) att.mapCount++;
    if(deg>=2){
      /* Crossbow Ace: "against your hunted prey, or after reloading" — die
         improves 1d8→1d10 and +2 circumstance damage. reload-1 is the only
         trait this checks, so it never fires on a non-crossbow weapon. */
      const craceOn=att.char&&att.char.specials.includes("crossbow-ace")&&(wpn.traits||[]).includes("reload-1")
        &&(this.huntPreyId===def.id||att.reloadedThisTurn);
      let dice=craceOn?"1d10":wpn.die; const extra=opts.extraDie||0;
      let dmg=Dice.roll(dice).total+(extra?Dice.roll(dice).total:0)+ (wpn.dmgMod||0)+(wpn.statusDmg||0)+(craceOn?2:0);
      dmg+=this.buffSum(att,"damage");
      if(!wpn.ranged&&this.condVal(att,"enfeebled")) dmg=Math.max(1,dmg-this.condVal(att,"enfeebled"));
      // precision: sneak attack / precision edge / companion sneak
      let precision=0;
      const sneaky=(att.char&&att.char.specials.includes("sneak-attack"))||wpn.sneak;
      const qualifies=wpn.ranged||(wpn.traits||[]).includes("agile")||(wpn.traits||[]).includes("finesse")||(att.char&&att.char.specials.includes("racket-ruffian"));
      if(sneaky&&offGuard&&qualifies) precision+=Dice.roll(wpn.sneak||"1d6").total;
      if(att.char&&att.char.specials.includes("edge-precision")&&this.huntPreyId===def.id&&!att.precisionUsedRound){ precision+=Dice.roll("1d8").total; att.precisionUsedRound=this.round; }
      dmg+=precision;
      // runic weapon bonus die
      att.buffs.forEach(b=>(b.bonuses||[]).forEach(x=>{ if(x.target==="bonus-die") dmg+=Dice.roll(x.value).total; }));
      if(deg===3){ dmg*=2;
        const deadly=(wpn.traits||[]).find(t=>t.startsWith("deadly"));
        if(deadly) dmg+=Dice.roll("1"+deadly.split("-")[1]).total;
        (wpn.onCrit||[]).forEach(c=>this.addCond(def,c.c,c.v,c.dur));
      }
      this.applyDamage(def,dmg,wpn.damageType,att);
      if(precision) this.log(`(${precision} precision damage within.)`);
    }
    return deg;
  },
  strikeMonster(foe,t,atk){
    let mod=atk.bonus - this.condVal(foe,"frightened")-this.condVal(foe,"sickened")-this.condVal(foe,"enfeebled")-this.condVal(foe,"hexed")-this.condVal(foe,"night-shrouded");
    mod+= foe.mapCount===0?0: (atk.traits.includes("agile")? (foe.mapCount===1?-4:-8):(foe.mapCount===1?-5:-10));
    foe.mapCount++;
    const {ac,offGuard}=this.effAC(t,{id:foe.id,ranged:atk.ranged});
    // nimble dodge
    let acFinal=ac;
    if(t.char&&t.char.specials.includes("nimble-dodge")&&!t.nimbleUsed&&!t.reactionUsed){ acFinal+=2; t.nimbleUsed=true; t.reactionUsed=true;
      this.log(`${esc(t.name)} <b>Nimbly Dodges</b> (+2 AC).`); }
    const d20=Dice.d(20), total=d20+mod;
    const deg=Dice.degree(d20,total,acFinal);
    this.seal(`${foe.name}: ${atk.name} vs ${t.name}`,d20,`${d20}+${mod} = ${total} vs AC ${acFinal}`,deg);
    if(deg>=2){
      let dmg=Dice.roll(atk.die).total;
      if(deg===3){ dmg*=2; (atk.onCrit||[]).forEach(c=>this.addCond(t,c.c,c.v,c.dur)); }
      this.applyDamage(t,dmg,atk.damageType,foe);
      if(atk.sneak&&offGuard) this.applyDamage(t,Dice.roll(atk.sneak).total,atk.damageType,foe);
    }
  },
  rollSave(t,save,dc,label){
    const mod=this.saveMod(t,save);
    let d20=Dice.d(20);
    if(t.buffs&&t.buffs.some(b=>b.fortune)){ d20=Math.max(d20,Dice.d(20)); t.buffs=t.buffs.filter(b=>!b.fortune); }
    const total=d20+mod;
    const deg=Dice.degree(d20,total,dc);
    this.seal(`${t.name}: ${cap(save)} save vs ${label}`,d20,`${d20}${mod>=0?"+":""}${mod} = ${total} vs DC ${dc}`,deg);
    return deg;
  }
};

/**
 * A fresh engine. `over` patches any field, which is how a test stands up a
 * two-combatant board without a pack, an adventure or a browser.
 */
export function newCombat(over){
  return Object.assign(Object.create(CombatCore), {
    active:false, cbs:[], order:[], turnIdx:0, round:1, enc:null,
    mapW:0, mapH:0, walls:new Set(), diff:new Set(),
    actions:0, armed:null, sel:null, huntPreyId:null, surprise:false,
    events:[], onEvent:null
  }, over||{});
}
