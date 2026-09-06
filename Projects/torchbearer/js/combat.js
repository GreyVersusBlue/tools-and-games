// combat.js — Torchbearer's combat engine, out of the page.
//
// `Combat` in torchbearer.html was 905 lines: Dijkstra movement and Bresenham
// line of sight and `effAC` and `strike` interleaved with thirteen render
// methods, calling `App.log` from inside damage resolution and driving its own
// clock with `setTimeout`. Nothing in it could be run from Node, so every rule
// in here — flanking, Feint, MAP, Shield Block, Crossbow Ace — had been checked
// exactly once each, by a session clicking through a browser, and then never
// again.
//
// It came out in two cuts, split by dependency rather than by feature. The
// first took everything a Strike passes through: geometry, conditions, the AC
// and attack math, damage, saves, and the two strike paths. The second took
// everything else that is a rule: `start` and the turn loop, the player's
// actions from the button id down, the spells, and the monster AI. What stays
// in the page is exactly what needs a DOM — the thirteen render methods and the
// spell menu's cards — and it reaches the engine through the hooks below.
//
// The seams, all of them methods a test can leave alone and the page overrides:
//
//   1. **Events, not `App.log`.** Every line the engine writes to the Chronicle
//      is `this.log(text)`, which pushes `{kind, text, cls}` onto `this.events`
//      and hands it to `onEvent`. Dice go through `this.seal` and skill checks
//      through `this.check`, both of which emit `{kind:"roll", ...}` with the
//      d20, the arithmetic and the degree. The page turns those back into
//      `App.log` and `App.rollSeal`, so the Chronicle reads exactly as it did;
//      a test reads the array (locked #89).
//   2. **`defer(fn, ms)` is the clock.** Everything that was `setTimeout` is
//      `this.defer`. Here it calls `fn` at once, so a monster's whole turn — and
//      every monster turn after it, until a player's comes round — resolves
//      inside one call. The page overrides it with `setTimeout` and keeps its
//      300–900ms pacing (locked #92).
//   3. **`start` takes the party and the flags as arguments** rather than
//      reading `App.party()` and `App.flags`. The flags object is mutated in
//      place — `surprise-round` and `fatigued-start` are consumed — because the
//      page relies on that.
//   4. **The view hooks are no-ops.** `renderAll`, `hint`, `toast`, `mount`,
//      `floatText` and `autosave` do nothing here. Nothing in this file knows a
//      colour it did not already carry as data.
//
// The page's `Combat` is `newCombat()` with its view methods assigned over the
// top, so `this` is one object and no call site changed. A test builds a bare
// engine with `newCombat({cbs, order, ...})`, or a real one with `start`.

import { Registry } from "./registry.js";
import { Dice, skillMod, CHAR_LEVEL, SIZES, sizeIndex, levelDC } from "./rules.js";
import { esc, cap } from "./text.js";

/**
 * The reactions the engine implements, and the triggers each answers to.
 *
 * This table IS the contract for a monster's `"reactions": [...]` field, the
 * same way the validator is the contract for everything else content can say.
 * `registry.js` keeps its own copy of the ids because the dependency runs the
 * other way (combat imports registry, never the reverse); `smoke.mjs` asserts
 * the two lists are identical, which is the only thing keeping them honest.
 *
 * `qualifies` and `resolve` are called with the engine as `this`. `ctx` is the
 * trigger's payload, and a `resolve` that changes the outcome does it by
 * mutating `ctx` — `dmg` for Shield Block, `acBonus` for Nimble Dodge — which
 * the triggering action reads back before it completes.
 */
export const REACTIONS = {
  "reactive-strike": {
    name: "Reactive Strike",
    triggers: ["move-out-of-reach", "manipulate"],
    qualifies(cb, ctx){
      if(!ctx.actor || ctx.actor.side===cb.side) return false;
      if(!cb.attacks || !cb.attacks.length) return false;
      const R=this.reachOf(cb);
      // A manipulate action provokes from anyone already within reach; a move
      // provokes only from the square where it leaves that reach.
      if(!ctx.from) return this.dist(cb,ctx.actor)<=R;
      return this.dist(cb,ctx.from)<=R && this.dist(cb,ctx.to)>R;
    },
    resolve(cb, ctx){
      this.log(`<b>Reactive Strike!</b> ${esc(cb.name)} lashes out as ${esc(ctx.actor.name)} ${ctx.from?"moves":"fumbles with something"}.`);
      this.reactiveStrike(cb, ctx.actor);
    }
  },
  "shield-block": {
    name: "Shield Block",
    triggers: ["incoming-damage"],
    qualifies(cb, ctx){
      return cb===ctx.target && cb.shieldRaised && ctx.dmg>0
        && ["slashing","piercing","bludgeoning"].includes(ctx.dtype);
    },
    resolve(cb, ctx){
      const blocked=Math.min(5,ctx.dmg); ctx.dmg-=blocked;
      this.log(`${esc(cb.name)} <b>Shield Blocks</b>: ${blocked} damage rings off steel.`);
    }
  },
  "nimble-dodge": {
    name: "Nimble Dodge",
    triggers: ["incoming-attack"],
    qualifies(cb, ctx){ return cb===ctx.target && !cb.nimbleUsed; },
    resolve(cb, ctx){
      ctx.acBonus+=2; cb.nimbleUsed=true;
      this.log(`${esc(cb.name)} <b>Nimbly Dodges</b> (+2 AC).`);
    }
  }
};

/**
 * The four Athletics maneuvers, and the DC each is measured against.
 *
 * Every one of them is `10 + the target's own save modifier` for the named
 * save, read through `saveMod` so a frightened or clumsy target is genuinely
 * easier to throw. That is the plain PF2e formula, and it is deliberately
 * *not* Demoralize's `10 + save + CHAR_LEVEL`: Feint and Hide already use the
 * plain form against Perception, so two of the three shipped skill DCs were
 * already right and Demoralize is the odd one out (locked #106). Changing
 * Demoralize is a balance change to every fight in the game and is not this
 * phase's business.
 *
 * All four have the attack trait: each takes the MAP penalty already on the
 * actor and raises it afterwards, exactly as a Strike does.
 */
export const MANEUVERS = {
  trip:    { name: "Trip",    save: "reflex",    hint: "Trip: choose an adjacent foe." },
  shove:   { name: "Shove",   save: "fortitude", hint: "Shove: choose an adjacent foe." },
  grapple: { name: "Grapple", save: "fortitude", hint: "Grapple: choose an adjacent foe." },
  disarm:  { name: "Disarm",  save: "reflex",    hint: "Disarm: choose an adjacent foe.", trained: true }
};

/**
 * Which skill a Recall Knowledge check about a creature uses, by the first of
 * its traits that names one. Occultism is the fallback, the same way it is at
 * the table for something nobody has a category for.
 */
export const LORE_SKILL = {
  undead: "religion", spirit: "religion", fiend: "religion", celestial: "religion",
  beast: "nature", animal: "nature", fey: "nature", plant: "nature",
  humanoid: "society", orc: "society", giant: "society", goblin: "society", dwarf: "society",
  construct: "crafting", elemental: "arcana", dragon: "arcana", monitor: "arcana",
  aberration: "occultism", incorporeal: "occultism"
};

export const CombatCore = {

  /* ---------- the event seam ---------- */
  /** Push an event and hand it to the view, if one is listening. */
  emit(ev){ this.events.push(ev); if(this.onEvent) this.onEvent(ev); return ev; },
  /** A Chronicle line. `text` is HTML — every caller escapes its own names. */
  log(text,cls){ return this.emit({kind:"log",text,cls:cls||"combat"}); },
  /** A d20 result. The page renders this as the wax seal; a test reads `deg`. */
  seal(title,d20,math,deg){ return this.emit({kind:"roll",text:title,cls:"roll",d20,math,deg}); },
  /** A skill check against a DC — Demoralize, Feint, Battle Medicine. This is
      what `App.rollCheck` was, routed through the seal. */
  check(title,mod,dc){
    const d20=Dice.d(20), total=d20+mod;
    const deg=Dice.degree(d20,total,dc);
    this.seal(title,d20,`${d20}${mod>=0?"+":""}${mod} = ${total} vs DC ${dc}`,deg);
    return {d20,total,deg};
  },

  /* ---------- the reaction bus ---------- */
  /**
   * Offer `name` to everyone who could react to it, in initiative order.
   *
   * Before Phase 3 the three reactions fired from wherever they happened to be
   * reachable: Shield Block and Nimble Dodge from inside the damage and the
   * attack path, Reactive Strike from a `provokeAlong` that refused any mover
   * that was not a foe. They are all here now, and a reaction resolves before
   * the action that triggered it completes — the caller passes what it is
   * about to do in `ctx`, and reads `ctx` back afterwards.
   *
   * One reaction per combatant per trigger, and `reactionUsed` is the whole
   * budget: it is set false at the start of that combatant's turn and nowhere
   * else. A reaction that drops the actor ends the offer — two fighters do not
   * both get to strike a hound the first one killed. `ctx.dryRun` walks the
   * same list and resolves nothing, which is how Mobility knows whether it
   * saved the mover from anything.
   */
  trigger(name, ctx){
    ctx=ctx||{}; ctx.fired=[];
    const line=this.order.length? this.order : this.cbs;
    for(const cb of line){
      if(cb.dead||(cb.dying||0)>0||cb.reactionUsed) continue;
      if(cb===ctx.actor) continue;
      // A readied action goes first and is not a reaction id: it lives on the
      // combatant rather than in REACTIONS, so content cannot name it, but it
      // spends the same one reaction per turn everything else does.
      if(this.readyFires(cb,name,ctx)){
        if(ctx.dryRun){ ctx.fired.push({cb,rid:"readied"}); continue; }
        cb.reactionUsed=true; cb.readied=null; ctx.fired.push({cb,rid:"readied"});
        this.log(`<b>Readied Strike!</b> ${esc(cb.name)} was waiting for ${esc(ctx.actor.name)}.`);
        this.reactiveStrike(cb,ctx.actor);
        if(ctx.actor.dead||(ctx.actor.dying||0)>0) break;
        continue;
      }
      for(const rid of this.reactionsOf(cb)){
        const r=REACTIONS[rid];
        if(!r||!r.triggers.includes(name)) continue;
        if(!r.qualifies.call(this,cb,ctx)) continue;
        if(ctx.dryRun){ ctx.fired.push({cb,rid}); break; }
        if(this.reactionsOf(cb).length>1&&!this.askReaction(cb,rid,ctx)) continue;
        cb.reactionUsed=true; ctx.fired.push({cb,rid});
        r.resolve.call(this,cb,ctx);
        break;
      }
      // A reaction that puts the actor down ends the offer: there is no longer
      // an action in progress for anyone else to interrupt.
      if(ctx.actor&&(ctx.actor.dead||(ctx.actor.dying||0)>0)) break;
    }
    return ctx;
  },
  /** What `cb` can react with: a hero's feats, a companion's or a monster's data. */
  reactionsOf(cb){
    const src=(cb.char&&cb.char.specials)||cb.reactions||[];
    return src.filter(id=>REACTIONS[id]);
  },
  /** Reach in cells. Monster data may say `reach: 2`; everyone else threatens one. */
  reachOf(cb){ return cb.reach||1; },
  /**
   * A Reactive Strike, from either side of the board. A monster's attacks are
   * flat data and go through `strikeMonster`; a hero's are weapons and go
   * through `strike`. Neither raises the striker's MAP: the reaction happens on
   * somebody else's turn, and `mapCount` belongs to the striker's own.
   */
  reactiveStrike(cb,target){
    const atk=cb.attacks[this.meleeIdx(cb)];
    if(!atk) return;
    if(cb.side==="foe"){
      const map=cb.mapCount; cb.mapCount=0;
      this.strikeMonster(cb,target,{...atk,traits:atk.traits||[],die:atk.die||atk.damage,dmgMod:atk.dmgMod||0,
        range:atk.range,ranged:atk.range>1,statusDmg:0});
      cb.mapCount=map;
    } else this.strike(cb,target,atk,{noMAP:true});
  },
  /** True when Mobility covers a Stride that cost `cost` squares of `cb`'s speed. */
  mobilityCovers(cb,cost){
    if(!(cb.char&&cb.char.specials.includes("mobility"))) return false;
    return cost<=Math.floor(this.moveBudget(cb)/2);
  },

  /* ---------- detection ---------- */
  /**
   * Detection is a per-pair state, `detect[observerId][targetId]`, and its
   * absence means "whatever the target's own conditions say".
   *
   * Four states, and only the first three can be attacked:
   *
   *   observed   — the default, and what a cleared override falls back to.
   *   concealed  — DC 5 flat check. The `concealed` condition, on everyone.
   *   hidden     — DC 11. You know the square; you do not know the creature.
   *   undetected — the `invisible` condition. Nothing can target it at all,
   *                and a Seek that finds it only promotes it to hidden.
   *
   * The map holds only what an action put there, so a Hide against one foe is
   * invisible to the next one, and clearing an override restores the base the
   * conditions describe rather than flattening everything to observed.
   */
  detectState(obs,t){
    if(!obs||!t) return "observed";
    const row=this.detect[obs.id];
    if(row&&row[t.id]) return row[t.id];
    if(this.condVal(t,"invisible")) return "undetected";
    if(this.condVal(t,"concealed")) return "concealed";
    return "observed";
  },
  /** Write one pair. "observed" clears the override rather than pinning it,
      so a creature that is also `concealed` goes back to concealed. */
  setDetect(obs,t,state){
    const row=this.detect[obs.id]||(this.detect[obs.id]={});
    if(state==="observed") delete row[t.id]; else row[t.id]=state;
  },
  /** True when `obs` cannot see well enough to skip the flat check. */
  isHidden(obs,t){ const s=this.detectState(obs,t); return s==="hidden"||s==="undetected"; },
  /** The DC of the flat check `obs` rolls to affect `t`. 0 means no check. */
  flatCheckDC(obs,t){ const s=this.detectState(obs,t); return s==="observed"?0:s==="concealed"?5:11; },
  /**
   * The expiry rule, and the only one there is: a hidden creature that moves or
   * attacks gives the hiding place away. Every "hidden" override naming it is
   * dropped — an invisible one falls back to undetected, a concealed one to
   * concealed, everyone else to observed. Nothing else in the engine writes
   * detection, so nothing else has to clean up after it.
   */
  reveal(cb,why){
    let any=false;
    for(const oid of Object.keys(this.detect)){
      if(this.detect[oid][cb.id]==="hidden"){ delete this.detect[oid][cb.id]; any=true; }
    }
    if(any) this.log(`${esc(cb.name)} gives the hiding place away${why?", "+why:""}.`);
    return any;
  },
  /** Every position change runs through here. Hiding does not survive a move,
      and neither does Take Cover. */
  afterMove(cb){ cb.takingCover=false; this.reveal(cb,"on the move"); this.releaseHeldBy(cb,"as the grip is dragged off"); },
  /**
   * The flat check a hidden or concealed target forces before an attack or a
   * targeted spell resolves. True when the action goes through; false when it
   * finds empty air, and the caller has already spent the action either way.
   */
  flatCheck(att,def){
    const dc=this.flatCheckDC(att,def);
    if(!dc) return true;
    const d20=Dice.d(20);
    this.seal(`${att.name}: flat check vs ${this.detectState(att,def)} ${def.name}`,d20,`${d20} vs DC ${dc}`,d20>=dc?2:1);
    if(d20>=dc) return true;
    this.log(`${esc(att.name)} finds only the empty air where ${esc(def.name)} was.`);
    return false;
  },
  /**
   * Cover between two combatants, in AC, off the same Bresenham walk `losClear`
   * makes — reading what the line steps over rather than stopping at it. A wall
   * is greater cover (+4), a living body is lesser cover (+2), and the greater
   * wins: circumstance bonuses do not stack.
   *
   * Neither endpoint's own square is ever examined — the walk steps before it
   * reads, and stops before the last square — so a shooter in a doorway is not
   * its own cover and a target standing on a wall is not either. A wall
   * short-circuits, because nothing beats +4.
   */
  coverBonus(a,b){
    if(!a||!b||a.x===undefined||b.x===undefined) return 0;
    let x0=a.x,y0=a.y; const x1=b.x,y1=b.y;
    const dx=Math.abs(x1-x0), dy=Math.abs(y1-y0), sx=x0<x1?1:-1, sy=y0<y1?1:-1;
    let err=dx-dy, cover=0;
    while(!(x0===x1&&y0===y1)){
      const e2=2*err;
      if(e2>-dy){ err-=dy; x0+=sx; }
      if(e2<dx){ err+=dx; y0+=sy; }
      if(x0===x1&&y0===y1) break;
      if(this.walls.has(this.key(x0,y0))) return 4;
      const occ=this.occupied(x0,y0);
      if(occ) cover=Math.max(cover,2);
    }
    return cover;
  },
  /** Take Cover needs something to duck behind: a wall in one of the eight
      squares around you. */
  nearCover(cb){
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
      if(!dx&&!dy) continue;
      if(this.walls.has(this.key(cb.x+dx,cb.y+dy))) return true;
    }
    return false;
  },
  /**
   * Hide. One action, one Stealth roll, compared against each foe's Perception
   * DC separately.
   *
   * It is not a `resolveTargeted` case the way Feint is, because there is
   * nothing to point at: the tabletop action is one check against every
   * observer at once, and the per-pair map is what makes the results able to
   * differ. `edge-outwit`'s +2 finally has somewhere to go, and it lands on the
   * comparison against the hunted prey only, not on the roll everyone sees.
   */
  doHide(cb){
    const ch=cb.char; if(!ch) return;
    const foes=this.cbs.filter(c=>c.side!==cb.side&&!c.dead);
    const eligible=foes.filter(f=>this.canHideFrom(cb,f));
    if(!eligible.length){ this.toast("Nothing here to hide behind."); return; }
    this.spend(1);
    const mod=skillMod(ch,"stealth");
    const d20=Dice.d(20), total=d20+mod;
    this.seal(`${cb.name} Hides`,d20,`${d20}${mod>=0?"+":""}${mod} = ${total}`,2);
    let any=false;
    eligible.forEach(f=>{
      const bonus=(ch.specials.includes("edge-outwit")&&f.id===this.huntPreyId)?2:0;
      const dc=10+(f.perception||0);
      if(total+bonus>=dc){ this.setDetect(f,cb,"hidden"); any=true;
        this.log(`${esc(cb.name)} slips out of ${esc(f.name)}'s sight.`); }
      else this.log(`${esc(f.name)} keeps ${esc(cb.name)} in view.`);
    });
    if(any) cb.hideDC=total;
    this.armed=null; this.hint(""); this.renderAll();
  },
  /**
   * Whether `cb` has anything to hide behind, from `obs` specifically.
   *
   * Greater cover (a wall on the line) or concealment is enough on its own, and
   * so is having Taken Cover. A body in the way is lesser cover and is not —
   * unless the hero has `distracting-shadows`, whose whole text is "using
   * Medium and larger creatures as cover to Hide".
   */
  canHideFrom(cb,obs){
    if(this.condVal(cb,"concealed")||this.condVal(cb,"invisible")) return true;
    if(cb.takingCover) return true;
    const cover=this.coverBonus(obs,cb);
    if(cover>=4) return true;
    return cover>=2&&!!(cb.char&&cb.char.specials.includes("distracting-shadows"));
  },
  /** What a Seek rolls against. A creature that has Hidden is found at exactly
      the total it Hid with; anything else at 10 + its Stealth. */
  stealthDC(cb){
    if(cb.hideDC) return cb.hideDC;
    return 10+(cb.char? skillMod(cb.char,"stealth") : (cb.stealth!==undefined?cb.stealth:(cb.perception||0)));
  },
  /**
   * Seek. One Perception roll against the Stealth DC of everything hidden in a
   * burst of squares — `radius` 1 is the 15-foot burst the player's action
   * uses, and the AI sweeps wider from where it stands.
   *
   * A found creature becomes observed, unless it is invisible, in which case
   * finding it only makes it hidden: Seek beats the hiding place, not the
   * invisibility. `sensate-gnome`'s +2 is a conditional `bonus` off the sheet
   * (rules.js `condBonuses`), the first one anything reads.
   */
  seek(cb,pt,radius){
    const ch=cb.char;
    const mod=(ch? ch.perception : (cb.perception||0))+(ch? this.condBonus(ch,"perception","seek") : 0);
    const d20=Dice.d(20), total=d20+mod;
    this.seal(`${cb.name} Seeks`,d20,`${d20}${mod>=0?"+":""}${mod} = ${total}`,2);
    let found=0;
    this.cbs.filter(c=>c.side!==cb.side&&!c.dead&&this.isHidden(cb,c)
      &&Math.max(Math.abs(c.x-pt.x),Math.abs(c.y-pt.y))<=radius).forEach(t=>{
      if(total<this.stealthDC(t)) return;
      found++;
      const stillHidden=this.condVal(t,"invisible")>0;
      this.setDetect(cb,t,stillHidden?"hidden":"observed");
      this.log(`<b>${esc(cb.name)} finds ${esc(t.name)}</b>${stillHidden?" — an outline in the air, and no more":""}.`);
    });
    if(!found) this.log(`${esc(cb.name)} searches, and turns up nothing.`);
    return found;
  },
  /** A conditional `bonus` off the sheet — `{"target":"perception","vs":"seek"}`.
      Untyped stacking is not modelled; the largest one wins. */
  condBonus(ch,target,vs){
    return ((ch&&ch.condBonuses)||[]).filter(b=>b.target===target&&b.vs===vs)
      .reduce((m,b)=>Math.max(m,b.value),0);
  },
  /** The same, against a list of traits rather than one name: a save carries
      several (`magic`, `emotion`, `mental`), and any of them may match. */
  condBonusAny(ch,target,tags){
    const list=tags||[];
    return ((ch&&ch.condBonuses)||[]).filter(b=>b.target===target&&list.includes(b.vs))
      .reduce((m,b)=>Math.max(m,b.value),0);
  },

  /* ---------- size ---------- */
  /**
   * A combatant's size. It was in the monster schema and on every ancestry in
   * the pack, and until this phase nothing anywhere read either one.
   *
   * A hero's comes off the sheet (`rules.js` puts the ancestry's there), a
   * monster's off its Registry entry, and anything that names no size at all
   * is Medium — which is what every creature in both shipped adventures is.
   */
  sizeOf(cb){ return (cb&&((cb.char&&cb.char.size)||(cb.monster&&cb.monster.size)||cb.size))||"Medium"; },
  sizeIdx(cb){ return sizeIndex(this.sizeOf(cb)); },
  /**
   * Whether `cb` may wrestle `t` at all. One size larger is the rule; Titan
   * Wrestler — "you can Disarm, Grapple, Shove, or Trip creatures up to two
   * sizes larger than you", a note until now — makes it two.
   */
  canWrestle(cb,t){
    const reach=(cb.char&&cb.char.specials.includes("titan-wrestler"))?2:1;
    return this.sizeIdx(t)-this.sizeIdx(cb)<=reach;
  },

  /* ---------- Athletics maneuvers ---------- */
  /**
   * Trip, Shove, Grapple and Disarm: one Athletics check, one DC off the
   * target's own save, and the MAP before and after.
   *
   * The four outcomes are the Player Core's, mapped onto conditions the engine
   * already has. Trip and Grapple share the critical-failure clause — you go
   * down yourself — because the book's "your target can grab you or force you
   * to fall prone" has no engine for the first half and the second half is
   * already implemented.
   *
   * Grapple's Escape DC is the total that made the grab, exactly the way
   * Hide's DC is the total that made the hiding place (Phase 4's `hideDC`).
   * It is not PF2e's "the grabber's Class DC", and it is the reason a critical
   * Grapple is harder to break than an ordinary one without needing a second
   * condition value to carry the difference (locked #107).
   */
  maneuver(cb,t,kind){
    const m=MANEUVERS[kind], ch=cb.char;
    if(!m||!ch) return 1;
    if(!this.canWrestle(cb,t)){
      this.toast(`${t.name} is too big to ${m.name.toLowerCase()}.`);
      this.hint(`${t.name} is too big to ${m.name.toLowerCase()}.`);
      return null;
    }
    const mapPen=this.mapPenalty(cb,{traits:[]});
    const mod=skillMod(ch,"athletics")+mapPen+this.consumeAid(cb)
      -this.condVal(cb,"frightened")-this.condVal(cb,"sickened")-this.condVal(cb,"enfeebled");
    const dc=10+this.saveMod(t,m.save);
    const r=this.check(`${cb.name}: ${m.name} vs ${t.name}`,mod,dc);
    cb.mapCount++;
    if(kind==="trip"){
      if(r.deg>=2){ this.addCond(t,"prone",1);
        if(r.deg===3) this.applyDamage(t,Dice.roll("1d6").total,"bludgeoning",cb,"Trip"); }
      else if(r.deg===0){ this.addCond(cb,"prone",1); this.log(`${esc(cb.name)} overbalances and goes down instead.`); }
    } else if(kind==="shove"){
      if(r.deg>=2) this.push(cb,t,r.deg===3?2:1);
    } else if(kind==="grapple"){
      if(r.deg>=2){ this.grab(cb,t,r.total); }
      else if(r.deg===0){ this.addCond(cb,"prone",1); this.log(`${esc(cb.name)} loses the grip and the footing with it.`); }
    } else if(kind==="disarm"){
      if(r.deg>=2){ this.addCond(t,"disarmed",1,2);
        if(r.deg===3){ t.disarmDropped=true; this.log(`${esc(t.name)}'s weapon skitters away — it will cost an action to get back.`); } }
    }
    this.afterAttack(cb);
    return r.deg;
  },
  /**
   * Forced movement, in a straight line directly away from `shover`. It stops
   * at a wall, an edge or an occupied square, and it provokes nothing: being
   * shoved is not a Stride. It still counts as moving for everything else —
   * Take Cover ends, and a hiding place is given away.
   */
  push(shover,t,cells){
    const dx=Math.sign(t.x-shover.x), dy=Math.sign(t.y-shover.y);
    if(!dx&&!dy) return 0;
    let moved=0;
    for(let i=0;i<cells;i++){
      const nx=t.x+dx, ny=t.y+dy;
      if(!this.passable(nx,ny,t)||this.occupied(nx,ny)) break;
      t.x=nx; t.y=ny; moved++;
    }
    if(moved){ this.afterMove(t); this.log(`${esc(t.name)} is driven back ${moved*5} feet.`); }
    else this.log(`${esc(t.name)} is braced against something and does not give an inch.`);
    return moved;
  },
  /** Take hold. `dc` is the total that made the grab, and is what an Escape
      is rolled against. */
  grab(grabber,t,dc){
    t.grabbedBy=grabber.id; t.grabDC=dc;
    this.addCond(t,"grabbed",1);
    this.log(`${esc(grabber.name)} has ${esc(t.name)} fast. <b>Escape DC ${dc}.</b>`);
  },
  /** Let go, from either end. Safe to call on a combatant nothing is holding. */
  release(t,why){
    if(!this.condVal(t,"grabbed")&&!t.grabbedBy) return false;
    t.conditions=t.conditions.filter(c=>c.c!=="grabbed");
    t.grabbedBy=null; t.grabDC=0;
    this.log(`${esc(t.name)} is free${why?", "+why:""}.`);
    return true;
  },
  /** Everything `cb` is holding lets go — because `cb` died, or moved away. */
  releaseHeldBy(cb,why){
    this.cbs.filter(c=>c.grabbedBy===cb.id).forEach(c=>this.release(c,why));
  },
  /**
   * Escape, one action, against the DC the grab was made with. Athletics or
   * Acrobatics, whichever the hero is better at; a companion or a monster uses
   * its own Perception, which is the only general number a flat stat block has.
   * Escape has the attack trait, so it takes and raises the MAP.
   */
  doEscape(cb){
    if(!this.condVal(cb,"grabbed")){ this.toast("Nothing has hold of you."); return null; }
    const ch=cb.char;
    const base=ch? Math.max(skillMod(ch,"athletics"),skillMod(ch,"acrobatics")) : (cb.perception||0);
    const mod=base+this.mapPenalty(cb,{traits:[]})+this.consumeAid(cb);
    const dc=cb.grabDC||15;
    this.spend(1);
    const r=this.check(`${cb.name} Escapes`,mod,dc);
    cb.mapCount++;
    if(r.deg>=2) this.release(cb,"and out of reach of the grip");
    else this.log(`${esc(cb.name)} strains against the grip and stays held.`);
    this.armed=null; this.hint(""); this.renderAll();
    return r.deg;
  },
  /** Stand, one action. Trip needs an answer or prone is permanent, and until
      this phase nothing in the game removed the condition at all. */
  doStand(cb){
    if(!this.condVal(cb,"prone")){ this.toast("You are already on your feet."); return false; }
    if(this.condVal(cb,"grabbed")){ this.toast("You are grabbed — Escape first."); return false; }
    this.spend(1);
    cb.conditions=cb.conditions.filter(c=>c.c!=="prone");
    this.log(`${esc(cb.name)} gets back up.`);
    this.armed=null; this.hint(""); this.renderAll();
    return true;
  },

  /* ---------- Aid ---------- */
  /**
   * Prepare to Aid an ally, and the only action in the game that persists past
   * the end of the turn that spent it.
   *
   * The preparation is stored on both ends — `ally.aidedBy` so the ally's next
   * check can find it, `cb.aidPrepared` so the start of the aider's next turn
   * can drop it — and the die is rolled at the moment it is used, not now,
   * because that is where the ally's check is.
   */
  prepareAid(cb,t){
    if(t.aidedBy&&t.aidedBy.by!==cb.id) this.log(`${esc(t.name)} already has help coming.`);
    if(cb.aidPrepared){ const old=this.cbs.find(c=>c.id===cb.aidPrepared); if(old) old.aidedBy=null; }
    t.aidedBy={by:cb.id,round:this.round};
    cb.aidPrepared=t.id;
    this.log(`${esc(cb.name)} <b>prepares to Aid</b> ${esc(t.name)}.`);
  },
  /**
   * Spend a prepared Aid on the check `cb` is about to make, and return the
   * circumstance bonus it is worth: +1 on a success, +2 on a critical success,
   * −1 on a critical failure, 0 on a failure or when nobody is helping.
   *
   * The aider rolls Athletics against a flat DC 15 whatever the ally is doing.
   * The engine cannot know which skill the ally's next check will use — the
   * bonus is consumed from inside `strike`, from four skill actions and from
   * Escape — so one number stands for "lending a hand", and the guide says so
   * (locked #108). `cooperative-nature`'s +4 is the whole point of the feat
   * and finally has somewhere to land.
   */
  consumeAid(cb){
    const a=cb&&cb.aidedBy;
    if(!a) return 0;
    cb.aidedBy=null;
    const helper=this.cbs.find(c=>c.id===a.by);
    if(!helper) return 0;
    if(helper.aidPrepared===cb.id) helper.aidPrepared=null;
    if(helper.dead||(helper.dying||0)>0) return 0;
    const ch=helper.char;
    let mod=ch? skillMod(ch,"athletics") : (helper.initSkill!==undefined?helper.initSkill:(helper.perception||0));
    if(ch&&ch.specials.includes("cooperative-nature")) mod+=4;
    const r=this.check(`${helper.name} Aids ${cb.name}`,mod,15);
    const bonus=r.deg===3?2:r.deg===2?1:r.deg===0?-1:0;
    this.log(bonus>0? `${esc(helper.name)} lends a hand: <b>+${bonus}</b> to ${esc(cb.name)}.`
      : bonus<0? `${esc(helper.name)} gets in the way: <b>−1</b> to ${esc(cb.name)}.`
      : `${esc(helper.name)} cannot find an opening to help.`);
    return bonus;
  },

  /* ---------- Recall Knowledge ---------- */
  /** The skill a check about `t` uses, off the first trait that names one. */
  recallSkill(t){
    const traits=(t.monster&&t.monster.traits)||[];
    for(const tr of traits) if(LORE_SKILL[tr]) return LORE_SKILL[tr];
    return "occultism";
  },
  /**
   * Recall Knowledge: one check against the level-based DC, printing a line of
   * stat block into the Chronicle.
   *
   * A success is the two numbers a player is actually deciding on — AC and how
   * much of the creature is left. A critical success adds the saves, whatever
   * it is weak or immune to, and the monster's own optional `"lore"` string,
   * which is the one new field this phase adds to the content schema.
   *
   * Repeating it against the same creature is allowed and gets harder: +2 DC
   * per attempt already made, which is how the tabletop handles a player who
   * wants to keep rolling.
   */
  recallKnowledge(cb,t){
    const ch=cb.char; if(!ch) return 1;
    const skill=this.recallSkill(t);
    const tries=t.recallTries||0;
    const lvl=(t.monster&&t.monster.level!==undefined)? t.monster.level : 1;
    const dc=levelDC(lvl)+2*tries;
    t.recallTries=tries+1;
    const r=this.check(`${cb.name}: Recall Knowledge (${cap(skill)}) about ${t.name}`,
      skillMod(ch,skill)+this.consumeAid(cb),dc);
    const sign=n=>(n>=0?"+":"")+n;
    if(r.deg>=2){
      t.recalled=true;
      this.log(`<b>${esc(t.name)}</b> — AC ${t.ac}, HP ${t.hp}/${t.hpMax}.`);
      if(r.deg===3){
        const parts=[`Fort ${sign(t.saves.fort||0)}, Ref ${sign(t.saves.ref||0)}, Will ${sign(t.saves.will||0)}`];
        (t.weaknesses||[]).forEach(w=>parts.push(`weak to ${w.type} ${w.value}`));
        (t.resistances||[]).forEach(x=>parts.push(`resists ${x.type} ${x.value}`));
        if((t.immunities||[]).length) parts.push(`immune to ${t.immunities.join(", ")}`);
        this.log(parts.join(" · ") + ".");
        const lore=t.monster&&t.monster.lore;
        if(lore) this.log(`<i>${esc(lore)}</i>`);
      }
    } else if(r.deg===0) this.log(`${esc(cb.name)} remembers something about ${esc(t.name)}, and every word of it is wrong.`);
    else this.log(`${esc(cb.name)} comes up empty.`);
    return r.deg;
  },

  /* ---------- Delay and Ready ---------- */
  /**
   * Delay: a move within `this.order`, and nothing else.
   *
   * The combatant is spliced out of the initiative array and pushed onto the
   * end of it, so the rest of the round happens first and the delayed turn is
   * the last of it. Conditions do **not** tick — this is not `endTurn`, the
   * turn has not happened yet, and it ticks when the delayed turn ends like
   * anybody else's.
   *
   * Once per round, because two Delays in one round is a combatant that never
   * has to act. A combatant already last in the order has nothing to move past
   * and simply ends its turn.
   */
  doDelay(){
    const cb=this.cur();
    if(cb.delayedRound===this.round){ this.toast("You have already Delayed this round."); return false; }
    cb.delayedRound=this.round;
    this.log(`<b>${esc(cb.name)} Delays</b>, and waits for a better moment.`);
    if(this.turnIdx>=this.order.length-1){ this.endTurn(); return true; }
    this.order.splice(this.turnIdx,1); this.order.push(cb);
    if(this.checkEnd()) return true;
    // The slot the delayer vacated now holds the next combatant, so the index
    // stays where it is rather than advancing.
    let idx=this.turnIdx;
    while(this.order[idx]&&this.order[idx].dead){
      idx++;
      if(idx>=this.order.length){ idx=0; this.round++; this.surprise=false; break; }
    }
    this.beginTurn(idx);
    return true;
  },
  /**
   * Ready: two actions to arm one Strike against a trigger from the Phase 3
   * bus. The trigger is the same `move-out-of-reach` every Reactive Strike
   * answers to, read the other way round — a readied Strike fires when a foe
   * steps *into* reach, not out of it.
   *
   * A readied action is not a feat, so it is not in `REACTIONS` and not part of
   * the content contract a monster's `"reactions"` field names. It lives on the
   * combatant, it spends the same one reaction per turn everything else does,
   * and it is dropped at the start of the readier's next turn whether it fired
   * or not.
   */
  doReady(cb){
    if(this.actions<2){ this.toast("Ready takes two actions."); return false; }
    if(!cb.attacks||!cb.attacks.length){ this.toast("Nothing to Ready a Strike with."); return false; }
    this.spend(2);
    cb.readied={kind:"strike"};
    this.log(`${esc(cb.name)} <b>Readies</b> a Strike, and waits for something to come within reach.`);
    this.armed=null; this.hint(""); this.renderAll();
    return true;
  },
  /** True when `cb`'s readied Strike answers this trigger: an enemy that was
      outside reach at `ctx.from` and is inside it at `ctx.to`. */
  readyFires(cb,name,ctx){
    if(!cb.readied||name!=="move-out-of-reach") return false;
    if(!ctx.actor||ctx.actor.side===cb.side||!ctx.from||!ctx.to) return false;
    if(!cb.attacks||!cb.attacks.length) return false;
    const R=this.reachOf(cb);
    return this.dist(cb,ctx.from)>R&&this.dist(cb,ctx.to)<=R;
  },


  /* ---------- the view and clock seams: no-ops here, overridden by the page ---------- */
  /** The number that floats up the screen. The engine announces it; the page decides. */
  floatText(){},
  /** Redraw the tracker, the grid, the action bar and the party panel. */
  renderAll(){},
  /** The one-line prompt under the action bar. */
  hint(){},
  /** A transient message — "Not enough actions." */
  toast(){},
  /** Called once by `start`, after the intro line and before the first turn.
      The page builds the combat DOM here. */
  mount(){},
  /** Called by `finish(true)` after the party is restored. The page writes the save slot. */
  autosave(){},
  /** Asked before a reaction fires, and only when the choice is real: the
      combatant carries more than one reaction, so spending it here is spending
      it. Yes here, so a test sees the bus and not a stub; the page asks. */
  askReaction(cb,rid,ctx){ return true; },
  /** The clock. `fn` is the next thing to happen; `ms` is how long the page
      should wait before it. Here it happens now. */
  defer(fn,ms){ fn(); },

  key(x,y){ return x+","+y; },
  cur(){ return this.order[this.turnIdx]; },
  alive(side){ return this.cbs.filter(c=>c.side===side&&!c.dead); },
  spend(n){ this.actions-=n; },

  kill(cb){
    cb.dead=true; cb.hp=0;
    this.releaseHeldBy(cb,"as the grip goes slack");
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
    // Disarm's success clause: -2 with the weapon it was aimed at. The engine
    // has one weapon per attack entry and no way to say "that one", so it is
    // -2 on everything the target swings until the condition runs out.
    m-=2*this.condVal(cb,"disarmed");
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
    // Grabbed is immobilized plus off-guard; the immobilized half is enforced
    // by the action bar and the AI refusing to move, not here.
    if(this.condVal(target,"grabbed")) offGuard=true;
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
    /* Cover. `opts.from` names the body the line is drawn from, because
       strikeMonster hands in a bare {id,ranged} stand-in with no coordinates
       and locked #90 keeps that stub exactly as it is. Take Cover is the same
       circumstance bonus as standing behind something, so the two do not stack
       — the larger one is the whole of it. */
    const shooter=(opts&&opts.from)||(attacker&&attacker.x!==undefined?attacker:null);
    const cover=Math.max(shooter?this.coverBonus(shooter,target):0, target.takingCover?2:0);
    ac+=cover;
    return {ac,offGuard,cover};
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
    // Shield Block, on the bus: the reaction resolves against `ctx.dmg` before
    // temporary HP and the hit point total ever see the number.
    dmg=this.trigger("incoming-damage",{actor:attacker,target,dtype,dmg}).dmg;
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
    // A hidden or concealed target forces a flat check before anything else.
    // The action is spent and the MAP rises either way: the swing happened.
    if(!this.flatCheck(att,def)){
      if(!opts.exacting&&!opts.noMAP) att.mapCount++;
      this.afterAttack(att);
      return 1;
    }
    const mapPen=opts.noMAP?0:(()=>{ const saveSel=this.sel; this.sel=def; const p=this.mapPenalty(att,wpn); this.sel=saveSel; return p; })();
    // A prepared Aid resolves here, on the ally's next check, and the die that
    // decides it is rolled now rather than when the Aid was prepared.
    let mod=this.atkMod(att,wpn)+mapPen+this.consumeAid(att);
    const {ac,offGuard}=this.effAC(def,{...att,ranged:wpn.ranged},{forceOffGuard:opts.forceOffGuard||def.offGuardUntil===this.round});
    const fortune=att.buffs.some(b=>b.fortune);
    let d20=Dice.d(20);
    if(fortune){ const d2=Dice.d(20); d20=Math.max(d20,d2); att.buffs=att.buffs.filter(b=>!b.fortune); }
    // blur on defender
    if(def.buffs.some(b=>b.flag==="blurred")){ if(Dice.d(20)<=4){ this.log(`The blur swallows the blow — a clean miss.`); if(!opts.exacting&&!opts.noMAP) att.mapCount++; return 1; } }
    // The defender's own reaction, on the same bus a monster's attack uses.
    const acFinal=ac+this.trigger("incoming-attack",{actor:att,target:def,ranged:wpn.ranged,acBonus:0}).acBonus;
    const total=d20+mod;
    const deg=Dice.degree(d20,total,acFinal);
    this.seal(`${att.name}: ${wpn.name} vs ${def.name}${offGuard?" (off-guard)":""}`,d20,`${d20}${mod>=0?"+":""}${mod} = ${total} vs AC ${acFinal}`,deg);
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
      /* Mountain Strategy and Titan Slinger both carry `bonus-dmg-vs-large`,
         which has been on the sheet and inert since it shipped. +1 circumstance
         damage against anything Large or bigger, which is a size the engine can
         finally read. */
      if(att.char&&att.char.specials.includes("bonus-dmg-vs-large")&&this.sizeIdx(def)>=SIZES.indexOf("Large")) dmg+=1;
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
    this.afterAttack(att);
    return deg;
  },
  /** An attack gives the attacker's position away and ends Take Cover, whether
      it landed, missed, or never found the target at all. */
  afterAttack(att){ att.takingCover=false; this.reveal(att,"striking out of it"); },
  strikeMonster(foe,t,atk){
    if(!this.flatCheck(foe,t)){ foe.mapCount++; this.afterAttack(foe); return; }
    let mod=atk.bonus - this.condVal(foe,"frightened")-this.condVal(foe,"sickened")-this.condVal(foe,"enfeebled")-this.condVal(foe,"hexed")-this.condVal(foe,"night-shrouded")-2*this.condVal(foe,"disarmed");
    mod+= foe.mapCount===0?0: (atk.traits.includes("agile")? (foe.mapCount===1?-4:-8):(foe.mapCount===1?-5:-10));
    foe.mapCount++;
    const {ac,offGuard}=this.effAC(t,{id:foe.id,ranged:atk.ranged},{from:foe});
    const acFinal=ac+this.trigger("incoming-attack",{actor:foe,target:t,ranged:atk.ranged,acBonus:0}).acBonus;
    const d20=Dice.d(20), total=d20+mod;
    const deg=Dice.degree(d20,total,acFinal);
    this.seal(`${foe.name}: ${atk.name} vs ${t.name}`,d20,`${d20}+${mod} = ${total} vs AC ${acFinal}`,deg);
    if(deg>=2){
      let dmg=Dice.roll(atk.die).total;
      if(deg===3){ dmg*=2; (atk.onCrit||[]).forEach(c=>this.addCond(t,c.c,c.v,c.dur)); }
      this.applyDamage(t,dmg,atk.damageType,foe);
      if(atk.sneak&&offGuard) this.applyDamage(t,Dice.roll(atk.sneak).total,atk.damageType,foe);
    }
    this.afterAttack(foe);
  },
  /**
   * A save, with `tags` naming what it is against — a spell hands in `magic`
   * plus its own traits, a monster power hands in its own. That list is what a
   * conditional `{"target":"save.all","vs":X}` off the sheet is matched
   * against, which is the second reader `condBonuses` has ever had: Ancient-
   * Blooded Dwarf's +1 vs magic and Gutsy Halfling's +1 vs emotion were both
   * collected and unread until this phase.
   */
  rollSave(t,save,dc,label,tags){
    const mod=this.saveMod(t,save)+(t.char? this.condBonusAny(t.char,"save.all",tags):0);
    let d20=Dice.d(20);
    if(t.buffs&&t.buffs.some(b=>b.fortune)){ d20=Math.max(d20,Dice.d(20)); t.buffs=t.buffs.filter(b=>!b.fortune); }
    const total=d20+mod;
    const deg=Dice.degree(d20,total,dc);
    this.seal(`${t.name}: ${cap(save)} save vs ${label}`,d20,`${d20}${mod>=0?"+":""}${mod} = ${total} vs DC ${dc}`,deg);
    return deg;
  },

  /* ---------- the encounter, and the turn loop ---------- */
  start(encId, adv, opts){
    const enc = adv.encounters[encId];
    this.enc=enc; this.round=1; this.turnIdx=0; this.active=true; this.events=[]; this.detect={};
    this.mapW=enc.w; this.mapH=enc.h;
    this.walls=new Set((enc.terrain.walls||[]).map(w=>this.key(w[0],w[1])));
    this.diff=new Set((enc.terrain.diff||[]).map(w=>this.key(w[0],w[1])));
    const flags=opts.flags||{};
    this.surprise=!!flags["surprise-round"]; delete flags["surprise-round"];
    const fatigued=!!flags["fatigued-start"]; delete flags["fatigued-start"];
    this.onVictory=opts.onVictory; this.onDefeat=opts.onDefeat;
    // party
    this.cbs=[];
    const party=opts.party; // [heroCombatant, ...companionCombatants]
    party.forEach((cb,i)=>{
      const st=enc.pcStarts[i]||enc.pcStarts[0];
      cb.x=st[0]; cb.y=st[1]; cb.dead=false; cb.dying=0; cb.conditions=cb.conditions||[]; cb.buffs=[];
      if(fatigued) this.addCond(cb,"fatigued",1,99,true);
      this.cbs.push(cb);
    });
    // foes (scaled by party size)
    const n=party.length;
    enc.foes.forEach((f,i)=>{
      if(f.minParty&&n<f.minParty) return;
      const m=Registry.monsters[f.monster];
      const cb={id:"foe"+i, side:"foe", name:m.name, letter:m.name.match(/[A-Z]/g).slice(0,1)[0]+(i+1), monster:m,
        x:f.x,y:f.y, hpMax:m.hp, hp:m.hp, tempHP:0, ac:m.ac, saves:{...m.saves}, perception:m.perception,
        speed:Math.floor(m.speed/5), attacks:m.attacks, powers:(m.powers||[]).map(p=>({...p,cd:0})),
        conditions:[], buffs:[], slowedBase:m.slowed||0, weaknesses:m.weaknesses||[], resistances:m.resistances||[], immunities:m.immunities||[], boss:m.boss,
        reach:m.reach||1, reactions:m.reactions||[]};
      this.cbs.push(cb);
    });
    // boss flags
    if(enc.bossFlags){ Object.entries(enc.bossFlags).forEach(([flag,fx])=>{
      if(flags[flag]){ const boss=this.cbs.find(c=>c.boss);
        if(boss)(fx.applyToBoss||[]).forEach(c=>this.addCond(boss,c.c,c.v,c.dur,true));
        if(fx.log) this.log(fx.log); } }); }
    // initiative
    this.cbs.forEach(cb=>{
      const mod = cb.side==="pc"? (cb.char? cb.char.perception+cb.char.initBonus : cb.initSkill||cb.perception) : cb.perception;
      cb.init=Dice.d(20)+mod;
      if(this.surprise&&cb.side==="foe") cb.init-=100; // ambushed: act last
    });
    this.order=[...this.cbs].sort((a,b)=>b.init-a.init);
    this.log(`<b>${enc.name}.</b> ${esc(enc.intro||"")}`);
    this.mount();
    this.beginTurn(0,true);
  },

  beginTurn(idx,first){
    if(!this.active) return;
    this.turnIdx=idx;
    const cb=this.cur();
    if(cb.dead){ return this.nextTurn(); }
    // start-of-turn: persistent damage & recovery & cooldowns & buffs tick handled at end
    cb.reactionUsed=false; cb.shieldRaised=false; cb.nimbleUsed=false; cb.mapCount=0; cb.flourishUsed=false; cb.hexUsed=false; cb.reloadedThisTurn=false;
    // A readied action lasts until the start of your next turn, fired or not.
    cb.readied=null;
    // …and so does a prepared Aid, which is dropped from both ends here.
    if(cb.aidPrepared){ const al=this.cbs.find(c=>c.id===cb.aidPrepared); if(al&&al.aidedBy&&al.aidedBy.by===cb.id) al.aidedBy=null; cb.aidPrepared=null; }
    if(cb.side==="pc"&&cb.dying>0){
      const roll=Dice.d(20); const dc=10+cb.dying;
      if(roll>=dc){ cb.dying=Math.max(0,cb.dying-(roll>=dc+10?2:1));
        this.log(`${esc(cb.name)} fights toward the light (recovery ${roll} vs DC ${dc}). Dying ${cb.dying}.`);
        if(cb.dying===0){ cb.hp=1; this.log(`<b>${esc(cb.name)} regains consciousness!</b>`); } }
      else { cb.dying+= (roll<=dc-10?2:1);
        this.log(`${esc(cb.name)} slips deeper (recovery ${roll} vs DC ${dc}). Dying ${cb.dying}.`);
        if(cb.dying>= (cb.char&&cb.char.specials.includes("diehard")?5:4)){ this.kill(cb); return this.nextTurn(); } }
      if(cb.dying>0){ this.renderAll(); return this.defer(()=>this.nextTurn(),700); }
    }
    // persistent damage
    const pers=cb.conditions.filter(c=>c.c==="persistent");
    pers.forEach(p=>{ const dmg=Dice.roll(p.formula).total;
      this.applyDamage(cb,dmg,p.dtype,null,`persistent ${p.dtype}`);
      if(Dice.d(20)>=15){ cb.conditions=cb.conditions.filter(x=>x!==p); this.log(`The ${p.dtype} afflicting ${esc(cb.name)} ends.`); }});
    if(cb.dead) return this.nextTurn();
    // actions
    let acts=3;
    const stun=this.condVal(cb,"stunned"); if(stun){ acts-=stun; this.decCond(cb,"stunned",stun); }
    const slow=(cb.slowedBase||0)+this.condVal(cb,"slowed-feet");
    acts-=slow;
    // A critical Disarm put the weapon on the floor: picking it up is the
    // Interact action the book charges for it, spent before anything else.
    if(cb.disarmDropped){ cb.disarmDropped=false; acts-=1; this.log(`${esc(cb.name)} snatches up its weapon.`); }
    this.actions=Math.max(0,acts);
    (cb.powers||[]).forEach(p=>{ if(p.cd>0)p.cd--; });
    this.armed=null; this.sel=null;
    this.renderAll();
    if(cb.side==="foe"){ this.defer(()=>this.aiTurn(cb),600); }
  },

  endTurn(){
    const cb=this.cur();
    // tick buffs & decrementing conditions
    cb.buffs=cb.buffs.filter(b=>{ if(b.duration!==undefined){ b.duration--; return b.duration>0; } return true; });
    ["frightened","sickened"].forEach(n=>{ const v=this.condVal(cb,n);
      if(v){ const red = (n==="frightened"&&cb.char&&cb.char.specials.includes("bravery"))?2:1;
        this.decCond(cb,n,red); } });
    cb.conditions=cb.conditions.filter(c=>{
      if(c.dur!==undefined&&c.dur<99){ c.dur--; return c.dur>0; } return true; });
    this.nextTurn();
  },
  nextTurn(){
    if(!this.active) return;
    if(this.checkEnd()) return;
    let idx=this.turnIdx;
    for(let i=0;i<this.order.length;i++){
      idx=(idx+1)%this.order.length;
      if(idx===0){ this.round++; this.surprise=false; }
      if(!this.order[idx].dead) break;
    }
    this.beginTurn(idx);
  },
  checkEnd(){
    if(this.alive("foe").length===0){ this.finish(true); return true; }
    const pcs=this.alive("pc");
    if(pcs.length===0||pcs.every(c=>c.dying>0)){ this.finish(false); return true; }
    return false;
  },
  finish(victory){
    this.active=false;
    if(victory){
      this.log(`<b>Victory.</b> The ${esc(this.enc.name)} is yours. You bind wounds, steady breath, and refocus. (Half of missing HP recovered; focus restored.)`);
      this.cbs.filter(c=>c.side==="pc").forEach(cb=>{
        if(cb.dying>0){ cb.dying=0; cb.hp=1; }
        cb.hp=Math.min(cb.hpMax, cb.hp+Math.ceil((cb.hpMax-cb.hp)/2));
        cb.conditions=[]; cb.buffs=[];
        if(cb.resources) cb.resources.focus=cb.char?cb.char.focusMax:0;
      });
      this.autosave();
      this.defer(()=>this.onVictory(),900);
    } else {
      this.log(`<b>The line breaks.</b> Darkness takes the field.`);
      this.defer(()=>this.onDefeat(),900);
    }
  },


  /* ---------- the player's actions ---------- */
  targets(a){
    const cb=this.cur();
    const side=a.friendly? "pc":"foe";
    return this.cbs.filter(t=>t.side===side&&!t.dead&&(a.friendly||t.dying===0||true)
      &&this.dist(cb,t)<=a.range&&(a.range<=1||this.losClear(cb,t))
      // An undetected creature cannot be targeted at all — a hidden one can,
      // and pays for it with the flat check inside the action.
      &&(a.friendly||this.detectState(cb,t)!=="undetected")
      &&(!a.friendly||t.dying===0||a.canDowned));
  },
  actionClick(id){
    const cb=this.cur(); if(cb.side!=="pc") return;
    this.sel=null;
    const arm=(o,hint)=>{ this.armed={...o,btn:id}; this.hint(hint); this.renderAll(); };
    if(id==="end") return this.endTurn();
    if(id==="delay") return this.doDelay();
    // Grabbed is immobilized: the three ways to change square all refuse.
    if(["stride","step","charge"].includes(id)&&this.condVal(cb,"grabbed")){ this.toast("You are grabbed — Escape first."); return; }
    if(id==="stride") return arm({kind:"move",budget:this.moveBudget(cb),cost:1},"Choose a highlighted square to Stride to.");
    if(id==="step") return arm({kind:"move",budget:1,cost:1,step:true},"Step one square (no reactions).");
    if(id==="escape") return this.doEscape(cb);
    if(id==="stand") return this.doStand(cb);
    if(id==="ready") return this.doReady(cb);
    if(id==="takecover"){
      if(!this.nearCover(cb)){ this.toast("Nothing here to duck behind."); return; }
      cb.takingCover=true; this.spend(1);
      this.log(`${esc(cb.name)} <b>Takes Cover</b> (+2 AC until they move or strike).`);
      return this.renderAll(); }
    if(id==="hide") return this.doHide(cb);
    if(MANEUVERS[id]) return arm({kind:"target",range:1,cost:1,mode:id},MANEUVERS[id].hint);
    if(id==="aid") return arm({kind:"target",range:1,cost:1,mode:"aid",friendly:true,canDowned:true},"Aid: choose an adjacent ally to help on their next check.");
    if(id==="recall") return arm({kind:"target",range:6,cost:1,mode:"recall"},"Recall Knowledge: choose a foe to remember something about.");
    if(id==="seek") return arm({kind:"cell",range:6,cost:1,mode:"seek",radius:1},"Seek: choose a point within 30 ft to search.");
    if(id==="raise"){ cb.shieldRaised=true; this.spend(1); this.log(`${esc(cb.name)} raises a shield (+2 AC).`); return this.renderAll(); }
    if(id==="reload"){ this.spend(1); this.log(`${esc(cb.name)} reloads.`);
      this.trigger("manipulate",{actor:cb});
      if(!cb.dead&&(cb.dying||0)===0) cb.reloadedThisTurn=true;
      this.renderAll(); return this.checkEnd(); }
    if(id==="hunt") return arm({kind:"target",range:99,cost:1,mode:"hunt"},"Mark a foe as your hunted prey.");
    if(id==="demoralize") return arm({kind:"target",range:6,cost:1,mode:"demoralize"},"Choose a foe within 30 ft to Demoralize.");
    if(id==="feint") return arm({kind:"target",range:1,cost:1,mode:"feint"},"Feint: choose an adjacent foe.");
    if(id==="battlemed") return arm({kind:"target",range:1,cost:1,mode:"battlemed",friendly:true,canDowned:true},"Choose an adjacent ally to treat.");
    if(id.startsWith("strike")) return arm({kind:"target",range:cb.attacks[+id.slice(6)].range,cost:1,mode:"strike",atkIdx:+id.slice(6)},"Choose a target to Strike.");
    if(id==="powerattack") return arm({kind:"target",range:1,cost:2,mode:"powerattack",atkIdx:this.meleeIdx(cb)},"Power Attack: choose an adjacent foe.");
    if(id==="exacting") return arm({kind:"target",range:cb.attacks[this.meleeIdx(cb)].range,cost:1,mode:"exacting",atkIdx:this.meleeIdx(cb)},"Exacting Strike: a miss won't raise your MAP.");
    if(id==="intstrike") return arm({kind:"target",range:1,cost:2,mode:"intstrike",atkIdx:this.meleeIdx(cb)},"Intimidating Strike: choose an adjacent foe.");
    if(id==="brutish") return arm({kind:"target",range:1,cost:1,mode:"brutish",atkIdx:this.meleeIdx(cb)},"Brutish Shove.");
    if(id==="charge") return arm({kind:"move",budget:this.moveBudget(cb)*2,cost:2,charge:true},"Sudden Charge: move up to double speed, then Strike free.");
    if(id==="huntedshot") return arm({kind:"target",range:(cb.attacks.find(a=>a.ranged)||{range:12}).range,cost:1,mode:"huntedshot"},"Two shots at your prey.");
    if(id==="twintake") return arm({kind:"target",range:1,cost:1,mode:"twintake"},"Both blades on your prey.");
    if(id==="twinfeint") return arm({kind:"target",range:1,cost:2,mode:"twinfeint"},"Feint with the first, land the second.");
    if(id==="cackle"){ cb.cackled=true; cb.resources.focus=Math.min(cb.char.focusMax,cb.resources.focus+1);
      this.log(`${esc(cb.name)} <b>cackles</b>, and the patron leans closer. (+1 focus)`); return this.renderAll(); }
    if(id==="potion") return arm({kind:"target",range:1,cost:1,mode:"potion",friendly:true,canDowned:true},"Drink or administer: choose yourself or an adjacent ally.");
    if(id==="spells") return this.spellMenu(cb,false);
    if(id==="focus") return this.spellMenu(cb,true);
    if(id.startsWith("abil")) { const ab=cb.abilities[+id.slice(4)];
      return arm({kind:"target",range:ab.range,cost:ab.cost,mode:"companion-abil",abil:ab,friendly:ab.type==="heal",canDowned:true},ab.flavor||ab.name); }
  },

  cellClick(x,y){
    const a=this.armed; if(!a) return;
    const cb=this.cur();
    if(a.kind==="move"){
      const reach=this.reachable(cb,a.budget); const k=this.key(x,y);
      if(!reach[k]||this.occupied(x,y)) return;
      this.doMove(cb,x,y,reach,a);
    } else if(a.kind==="cell"){
      if(Math.max(Math.abs(x-cb.x),Math.abs(y-cb.y))>a.range) return;
      if(a.mode==="seek"){
        this.spend(a.cost); this.seek(cb,{x,y},a.radius);
        this.armed=null; this.hint(""); this.renderAll(); return this.checkEnd();
      }
      this.castAt(cb,a,{x,y});
    }
  },
  tokenClick(t){
    const a=this.armed; if(!a){ this.toast(`${t.name}: HP ${t.hp}/${t.hpMax} · AC ${t.ac}`); return; }
    const cb=this.cur();
    if(a.kind==="target"){
      if(!this.targets(a).includes(t)) return;
      this.sel=t;
      this.resolveTargeted(cb,a,t);
    } else if(a.kind==="cell"){ this.cellClick(t.x,t.y); }
  },
  doMove(cb,x,y,reach,a){
    // provoke reactive strikes when leaving reach of enemy fighters (foes only trigger PC fighters)
    const path=[]; let k=this.key(x,y);
    while(k){ const [px,py]=k.split(",").map(Number); path.unshift({x:px,y:py}); k=reach[k].prev; }
    // Mobility: "your movement at half Speed never provokes reactions." The
    // path's own cost decides it, so a Stride that starts short stays safe and
    // one square further is not. Nothing else in the game reads the special.
    const cost=(reach[this.key(x,y)]||{cost:0}).cost;
    if(!a.step){
      if(this.mobilityCovers(cb,cost)){
        if(this.provokeAlong(cb,path,{dryRun:true}).length)
          this.log(`${esc(cb.name)} moves at half speed. <b>Mobility</b> gives nothing away.`);
      } else this.provokeAlong(cb,path);
    }
    if(cb.dead||(cb.dying||0)>0){ this.spend(a.cost); this.armed=null; this.hint(""); this.renderAll(); return this.checkEnd(); }
    cb.x=x; cb.y=y;
    this.afterMove(cb);
    this.spend(a.cost); this.armed=null; this.hint("");
    if(a.charge){ this.armed={kind:"target",range:1,cost:0,mode:"strike",atkIdx:this.meleeIdx(cb),btn:"charge2"};
      this.hint("Now Strike an adjacent foe (free)."); }
    this.renderAll();
  },
  /**
   * Walk a move square by square and offer `move-out-of-reach` at each step.
   *
   * This used to open with `if(mover.side!=="foe") return;`, so a reaction
   * could only ever fire against a moving foe and the party was never once
   * threatened by one. It is symmetric now, and reach is read per combatant
   * rather than assumed to be one cell, so a Large monster with `"reach": 2`
   * threatens the ring outside the one it stands in. Pass `{dryRun:true}` to
   * find out who would strike without anyone striking.
   */
  provokeAlong(mover,path,opts){
    const fired=[];
    for(let i=1;i<path.length;i++){
      const ctx=this.trigger("move-out-of-reach",
        {actor:mover,from:path[i-1],to:path[i],dryRun:!!(opts&&opts.dryRun)});
      fired.push(...ctx.fired);
      if(mover.dead||(mover.dying||0)>0) break;
    }
    return fired;
  },

  resolveTargeted(cb,a,t){
    const done=(cost)=>{ this.spend(cost!==undefined?cost:a.cost); this.armed=null; this.sel=null; this.hint(""); this.renderAll(); this.checkEnd(); };
    switch(a.mode){
      case "hunt": this.huntPreyId=t.id; this.log(`${esc(cb.name)} <b>Hunts Prey</b>: ${esc(t.name)}.`); return done();
      case "trip": case "shove": case "grapple": case "disarm": {
        // A maneuver the hero is too small to attempt costs nothing and leaves
        // the action armed, the same way an out-of-range Strike does.
        const deg=this.maneuver(cb,t,a.mode);
        if(deg===null){ this.sel=null; return; }
        return done();
      }
      case "aid": {
        if(t===cb){ this.toast("You cannot Aid yourself."); this.sel=null; return; }
        this.prepareAid(cb,t); return done();
      }
      case "recall": this.recallKnowledge(cb,t); return done();
      case "demoralize": {
        const ch=cb.char; let mod=skillMod(ch,"intimidation")-this.condVal(cb,"frightened")-this.condVal(cb,"sickened");
        if(!ch.specials.includes("intimidating-glare")) mod-=4; // no shared language with the mindless dead
        if(ch.specials.includes("edge-outwit")&&t.id===this.huntPreyId) mod+=2; // Outwit vs hunted prey
        const dc=10+(t.saves.will||0)+CHAR_LEVEL;
        const r=this.check(`${cb.name} Demoralizes ${t.name}`,mod,dc);
        if(r.deg>=2){ this.addCond(t,"frightened",r.deg===3?2:1);
          if(r.deg===3&&ch.specials.includes("terrified-retreat")&&(t.monster&&t.monster.level<CHAR_LEVEL)) this.addCond(t,"fleeing",1,1); }
        t.demoralized=true; return done();
      }
      case "feint": {
        const ch=cb.char; let mod=skillMod(ch,"deception")-this.condVal(cb,"frightened")-this.condVal(cb,"sickened");
        if(ch.specials.includes("edge-outwit")&&t.id===this.huntPreyId) mod+=2; // Outwit vs hunted prey
        const dc=10+(t.perception||0);
        const r=this.check(`${cb.name} Feints ${t.name}`,mod,dc);
        if(r.deg>=2){
          const scoundrel=ch.specials.includes("racket-scoundrel");
          t.feint={by:cb.id,round:this.round,turnIdx:this.turnIdx,usesLeft:scoundrel?Infinity:1};
          this.log(`${esc(t.name)} is off-guard to ${scoundrel?"all of ":""}${esc(cb.name)}'s attacks${scoundrel?" this turn":" (next Strike)"}.`);
        } else this.log(`${esc(cb.name)}'s Feint fails to fool ${esc(t.name)}.`);
        return done();
      }
      case "battlemed": {
        const ch=cb.char;
        const r=this.check(`${cb.name}: Battle Medicine on ${t.name}`,skillMod(ch,ch.specials.includes("natural-medicine")&&ch.skills.nature!=="U"?"nature":"medicine"),15);
        if(r.deg>=2) this.heal(t,Dice.roll(r.deg===3?"2d8+10":"2d8").total);
        else if(r.deg===0) this.applyDamage(t,Dice.roll("1d8").total,"slashing",null,"botched surgery");
        return done();
      }
      case "potion": {
        // Drink or administer is a manipulate action, and manipulate provokes.
        // The reaction resolves first; a hero cut down mid-swig keeps the potion.
        this.trigger("manipulate",{actor:cb});
        if(cb.dead||(cb.dying||0)>0) return done();
        const id=cb.resources.potions.pop();
        const item=Registry.items[id];
        const h=Dice.roll(item&&item.heal?item.heal:"1d8").total;
        this.heal(t,h);
        this.log(`${esc(t.name)} drinks ${esc(item?item.name:"a healing potion")} (+${h}).`);
        return done();
      }
      case "strike": this.strike(cb,t,cb.attacks[a.atkIdx]); return done(a.btn==="charge2"?0:1);
      case "exacting": this.strike(cb,t,cb.attacks[a.atkIdx],{exacting:true}); return done();
      case "powerattack": { cb.mapCount++; this.strike(cb,t,cb.attacks[a.atkIdx],{extraDie:1}); return done(); }
      case "intstrike": { const hit=this.strike(cb,t,cb.attacks[a.atkIdx]);
        if(hit>=2) this.addCond(t,"frightened",hit===3?2:1); return done(); }
      case "brutish": { const hit=this.strike(cb,t,cb.attacks[a.atkIdx]);
        /* "…and you may Shove it." The Shove half of Brutish Shove was text
           until Phase 5 gave the engine a Shove — it is the free one the feat
           promises, so it costs no action and rolls no second check. */
        if(hit>=2){ t.offGuardUntil=this.round; this.addCond(t,"clumsy",1,1,true); this.log(`${esc(t.name)} is knocked off-balance (off-guard).`);
          if(!t.dead&&this.canWrestle(cb,t)) this.push(cb,t,1); } return done(); }
      case "huntedshot": { if(t.id!==this.huntPreyId){ this.hint("Hunted Shot only works on your prey."); return; }
        cb.flourishUsed=true; const w=cb.attacks.find(x=>x.ranged);
        this.strike(cb,t,w); if(!t.dead) this.strike(cb,t,w); return done(); }
      case "twintake": { if(t.id!==this.huntPreyId){ this.hint("Twin Takedown only works on your prey."); return; }
        cb.flourishUsed=true; this.strike(cb,t,cb.attacks[0]); if(!t.dead) this.strike(cb,t,cb.attacks[1]); return done(); }
      case "twinfeint": { this.strike(cb,t,cb.attacks[0]); if(!t.dead) this.strike(cb,t,cb.attacks[1],{forceOffGuard:true}); return done(); }
      case "companion-abil": { const ab=a.abil;
        if(ab.type==="heal"){ ab.uses--; const h=Dice.roll(ab.heal).total; this.heal(t,h);
          this.log(`${esc(cb.name)}: <b>${ab.name}</b> — ${esc(t.name)} regains ${h} HP. <i>${esc(ab.flavor||"")}</i>`); }
        return done(); }
      case "spell-target": return this.castAt(cb,a,t);
    }
  },


  /* ---------- spells ---------- */
  /** The rows of the spell menu: everything this caster could cast right now,
      each with `spent` (the pool is empty) and `hexBlocked` (a hex already
      cast this turn). The page renders these as cards; `armSpell` takes one. */
  spellRows(cb,focusOnly){
    const ch=cb.char, res=cb.resources;
    const rows=[];
    const add=(sp,label,rank,pool)=>rows.push({sp,label,rank,pool});
    if(focusOnly){
      ch.focusSpells.forEach(id=>{ const sp=Registry.spells[id]; if(!sp) return;
        add(sp,`${sp.name} ${sp.hex?"(hex — free, 1/turn)":"(1 focus)"}`,Math.ceil(CHAR_LEVEL/2),"focus"); });
    } else {
      ch.casting.cantrips.forEach(id=>{ const sp=Registry.spells[id]; if(sp) add(sp,`${sp.name} (cantrip)`,Math.ceil(CHAR_LEVEL/2),"cantrip"); });
      ch.casting.r1.forEach(id=>{ const sp=Registry.spells[id]; if(sp) add(sp,`${sp.name} (rank 1)`,1,"r1"); });
      ch.casting.r2.forEach(id=>{ const sp=Registry.spells[id]; if(sp) add(sp,`${sp.name} (rank 2)`,2,"r2"); });
      if(res.font>0) add(Registry.spells.heal,`Heal — Divine Font (rank 2)`,2,"font");
    }
    rows.forEach(r=>{
      r.spent = r.pool==="r1"? res.slots[1]<=0 : r.pool==="r2"? res.slots[2]<=0 : r.pool==="focus"? (!r.sp.hex&&res.focus<=0) : r.pool==="font"? res.font<=0 : false;
      r.hexBlocked = !!(r.sp.hex&&cb.hexUsed);
    });
    return rows;
  },
  armSpell(cb,r){
    const sp=r.sp; const cost=Math.min(3,sp.actions||2);
    if(cost>this.actions){ this.toast("Not enough actions."); return; }
    const a={kind:null,btn:"spell",mode:"spell-target",spell:sp,castRank:r.rank,pool:r.pool,cost};
    const rangeCells=Math.floor((sp.range||0)/5);
    if(sp.area&&sp.area.shape==="burst"){ a.kind="cell"; a.range=Math.max(1,rangeCells)||6; a.radius=Math.floor(sp.area.radius/5); }
    else if(sp.area&&(sp.area.shape==="cone"||sp.area.shape==="line")){ a.kind="cell"; a.range=Math.floor(sp.area.length/5); a.wedge=sp.area.shape; }
    else if(sp.area&&sp.area.shape==="emanation"){ this.armed=a; return this.castAt(cb,a,{x:cb.x,y:cb.y}); }
    else if(sp.partyBuff||sp.selfBuff){ this.armed=a; return this.castAt(cb,a,cb); }
    else { a.kind="target"; a.range=Math.max(1,rangeCells);
      a.friendly=!!(sp.heal||sp.allyBuff||sp.rankEffects[r.rank]&&sp.rankEffects[r.rank].heal||sp.special==="stabilize"||Object.values(sp.rankEffects)[0].heal);
      a.canDowned=true;
      if(sp.healOrHarmUndead) a.friendly=true; }
    this.armed=a; this.hint(`Casting ${sp.name} — choose ${a.kind==="cell"?"a point":"a target"}.`);
    this.renderAll();
  },
  spendSpell(cb,a){
    const res=cb.resources;
    if(a.pool==="r1") res.slots[1]--;
    else if(a.pool==="r2") res.slots[2]--;
    else if(a.pool==="font") res.font--;
    else if(a.pool==="focus"&&!a.spell.hex) res.focus--;
    if(a.spell.hex) cb.hexUsed=true;
  },
  effectFor(sp,rank){
    const keys=Object.keys(sp.rankEffects).map(Number).filter(k=>k<=rank).sort((a,b)=>b-a);
    return sp.rankEffects[keys[0]]||sp.rankEffects[Object.keys(sp.rankEffects)[0]]||{};
  },
  castAt(cb,a,target){
    const sp=a.spell, eff=this.effectFor(sp,a.castRank);
    // What a save against this spell is *against*, for a sheet's conditional
    // `save.all` bonuses. Every spell is magic; the rest are its own traits.
    const saveTags=["magic",...(sp.traits||[])];
    this.spendSpell(cb,a);
    this.spend(a.cost);
    this.log(`${esc(cb.name)} casts <b>${sp.name}</b>.`);
    const dc=cb.char.casting? cb.char.casting.dc : 10;
    const spellAtk=cb.char.casting? cb.char.casting.attack : 0;
    let victims=[];
    if(a.kind==="cell"){
      if(a.wedge==="line"){
        // all cells along Bresenham to target
        let x0=cb.x,y0=cb.y; const x1=target.x,y1=target.y;
        const dx=Math.abs(x1-x0),dy=Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1; let err=dx-dy;
        const cells=[];
        while(!(x0===x1&&y0===y1)&&cells.length<=a.range){
          const e2=2*err; if(e2>-dy){err-=dy;x0+=sx;} if(e2<dx){err+=dx;y0+=sy;}
          cells.push({x:x0,y:y0});
        }
        victims=this.cbs.filter(c=>!c.dead&&c.side!==cb.side&&cells.some(p=>p.x===c.x&&p.y===c.y));
      } else if(a.wedge==="cone"){
        const dirx=Math.sign(target.x-cb.x), diry=Math.sign(target.y-cb.y);
        victims=this.cbs.filter(c=>{ if(c.dead||c.side===cb.side) return false;
          const rx=c.x-cb.x, ry=c.y-cb.y;
          if(Math.max(Math.abs(rx),Math.abs(ry))>a.range||((rx===0)&&(ry===0))) return false;
          const okx=dirx===0||Math.sign(rx)===dirx||rx===0;
          const oky=diry===0||Math.sign(ry)===diry||ry===0;
          return okx&&oky&&Math.abs(Math.abs(rx)-Math.abs(ry))<=Math.max(Math.abs(rx),Math.abs(ry));
        });
      } else { // burst
        victims=this.cbs.filter(c=>!c.dead&&Math.max(Math.abs(c.x-target.x),Math.abs(c.y-target.y))<=a.radius);
        if(!sp.friendlyFire) victims=victims.filter(c=>c.side!==cb.side);
      }
    } else if(sp.area&&sp.area.shape==="emanation"){
      const rad=Math.floor(sp.area.radius/5);
      victims=this.cbs.filter(c=>!c.dead&&c!==cb&&c.side!==cb.side&&this.dist(c,cb)<=rad);
    } else victims=[target];

    // Multi-target attack spells (electric arc style handled via save; blazing bolt & needle etc single unless maxTargets)
    if(sp.maxTargets&&a.kind==="target"){
      const extra=this.cbs.filter(c=>c!==target&&!c.dead&&c.side!==cb.side&&this.dist(cb,c)<=a.range&&this.losClear(cb,c))
        .sort((x,y)=>this.dist(cb,x)-this.dist(cb,y)).slice(0,sp.maxTargets-1);
      victims=[target,...extra];
      if(extra.length) this.log(`The spell arcs to ${extra.map(e=>esc(e.name)).join(", ")} as well.`);
    }

    victims.forEach(t=>{
      // A spell that names a creature needs the same flat check a Strike does.
      // An area spell names a square instead, so it asks nothing.
      if(a.kind==="target"&&t.side!==cb.side&&!this.flatCheck(cb,t)) return;
      // Healing / friendly effects
      if(eff.heal||sp.healOrHarmUndead){
        const isUndead=t.monster&&(t.monster.traits||[]).includes("undead");
        if(sp.healOrHarmUndead&&isUndead){
          const dmg=Dice.roll(eff.heal).total;
          const save=this.rollSave(t,"fortitude",dc,sp.name,saveTags);
          const mult=[2,1,0.5,0][save];
          this.applyDamage(t,Math.floor(dmg*mult),"vitality",cb,sp.name);
        } else if(eff.heal){
          let formula=eff.heal;
          if(cb.char.specials.includes("healing-hands")&&sp.id==="heal") formula=formula.replace(/d8/g,"d10");
          const h=Dice.roll(formula).total; this.heal(t,h);
          this.log(`${esc(t.name)} regains ${h} HP.`);
        }
        if(eff.tempHP){ t.tempHP=Math.max(t.tempHP||0,eff.tempHP); }
        return;
      }
      if(sp.special==="stabilize"){ if(t.dying>0){ t.dying=0; t.hp=Math.max(t.hp,0); this.log(`${esc(t.name)} is stabilized.`); } return; }
      // Attack roll spells
      if(sp.attackRoll){
        const {ac}=this.effAC(t,{ranged:true},{from:cb});
        const d20=Dice.d(20), total=d20+spellAtk;
        const deg=Dice.degree(d20,total,ac);
        this.seal(`${sp.name} vs ${t.name}`,d20,`${d20}+${spellAtk} = ${total} vs AC ${ac}`,deg);
        if(deg>=2){ let dmg=(eff.damage||[]).reduce((s,d)=>s+Dice.roll(d.formula).total,0);
          if(cb.char.specials.includes("burn-it")&&(sp.traits||[]).includes("fire")) dmg+=1;
          if(deg===3){ dmg*=2; if(eff.critPersistent) t.conditions.push({c:"persistent",formula:eff.critPersistent.formula,dtype:eff.critPersistent.type,dur:99}); }
          (eff.damage||[]).length&&this.applyDamage(t,dmg,eff.damage[0].type,cb,sp.name);
        }
        cb.mapCount++; // attack trait
        return;
      }
      // Auto-hit
      if(sp.autoHit){ const dmg=(eff.damage||[]).reduce((s,d)=>s+Dice.roll(d.formula).total,0);
        this.applyDamage(t,dmg,eff.damage[0].type,cb,sp.name); return; }
      // Save spells
      if(sp.save){
        if(sp.livingOnly&&t.monster&&(t.monster.traits||[]).includes("undead")){
          if(sp.healsUndead){ const h=Dice.roll((eff.damage||[{formula:"1d8"}])[0].formula).total; t.hp=Math.min(t.hpMax,t.hp+h); this.log(`${esc(t.name)} drinks the void and knits together (+${h}).`); }
          else this.log(`${esc(t.name)} has no life to drain.`);
          return; }
        const deg=this.rollSave(t,sp.save,dc,sp.name,saveTags);
        if(sp.basic&&eff.damage){
          let dmg=eff.damage.reduce((s,d)=>s+Dice.roll(d.formula).total,0);
          if(cb.char.specials.includes("burn-it")&&(sp.traits||[]).includes("fire")) dmg+=1;
          const mult=[2,1,0.5,0][deg];
          if(mult>0) this.applyDamage(t,Math.floor(dmg*mult),eff.damage[0].type,cb,sp.name);
          else this.log(`${esc(t.name)} evades entirely.`);
        }
        const bucket= deg===0? eff.onCritFail||eff.onFail : deg===1? eff.onFail : deg===2? eff.onSuccess:null;
        (bucket||[]).forEach(c=>this.addCond(t,c.c==="bane"?"bane":c.c,c.v,c.dur));
        if(eff.persistent&&deg<=1) t.conditions.push({c:"persistent",formula:eff.persistent.formula,dtype:eff.persistent.type,dur:99});
        return;
      }
      // Buffs
      if(sp.partyBuff){
        const allies=this.cbs.filter(c=>c.side===cb.side&&!c.dead&&c.dying===0);
        allies.forEach(al=>al.buffs.push({name:sp.name,bonuses:sp.partyBuff.bonuses,duration:sp.partyBuff.duration+ (al===cb?1:1)}));
        this.log(`${sp.name} lifts the whole line (+1 for ${sp.partyBuff.duration} round${sp.partyBuff.duration>1?"s":""}).`); return;
      }
      if(sp.selfBuff){
        const sb=sp.selfBuff;
        if(sb.tempHP){ cb.tempHP=Math.max(cb.tempHP||0,sb.tempHP); this.log(`${esc(cb.name)} gains ${sb.tempHP} temporary HP.`); }
        if(sb.fortune) cb.buffs.push({name:sp.name,fortune:true});
        if(sb.bonus) cb.buffs.push({name:sp.name,bonuses:[sb.bonus],duration:sb.duration||1});
        if(sb.grantStrike){ const g=sb.grantStrike;
          cb.attacks=[{name:g.name,bonus:cb.attacks[0].bonus,die:g.damage,dmgMod:cb.char.abil.str+g.statusDmg,damageType:g.damageType,traits:g.traits,range:1,ranged:false},...cb.attacks.filter(x=>x.name!==g.name)];
          this.log(`${esc(cb.name)}'s hands crack into ${g.name.toLowerCase()}s!`); }
        return;
      }
      if(sp.allyBuff){
        const ab=sp.allyBuff;
        if(ab.fortune) t.buffs.push({name:sp.name,fortune:true});
        if(ab.bonus) t.buffs.push({name:sp.name,bonuses:[{...ab.bonus,target:ab.bonus.target==="next-check"?"attack":ab.bonus.target}],duration:ab.duration||1});
        if(ab.bonuses) t.buffs.push({name:sp.name,bonuses:ab.bonuses,duration:ab.duration||3});
        if(ab.flag) t.buffs.push({name:sp.name,flag:ab.flag,duration:ab.duration||10});
        if(ab.resistChoice){ t.resistances=[...(t.resistances||[]),{type:"fire",value:ab.resistChoice},{type:"cold",value:ab.resistChoice},{type:"electricity",value:ab.resistChoice},{type:"acid",value:ab.resistChoice},{type:"sonic",value:ab.resistChoice}];
          this.log(`${esc(t.name)} is warded against the elements (resist 5).`); }
        else this.log(`${esc(t.name)} is bolstered by ${sp.name}.`);
        return;
      }
    });
    this.reveal(cb,"speaking the words");
    this.armed=null; this.sel=null; this.hint("");
    this.renderAll(); this.checkEnd();
  },


  /* ---------- enemy AI ---------- */
  /**
   * One action of a monster's turn. Returns `{action, wait}` when the foe did
   * something and wants another step — `wait` is the pause the page puts
   * before it, in ms — or `null` when its turn is over, because it ended its
   * turn or the fight ended. Nothing in here waits; `aiTurn` decides how.
   */
  aiStep(foe){
    // A foe can now die between two of its own actions — a Reactive Strike as
    // it Strides out of reach — and a dead foe's turn has to be ended by
    // somebody or the loop stalls with nobody left to act. Before Phase 3 this
    // returned null and did nothing, which was unreachable only because the
    // party could not make a reaction.
    if(!this.active||foe.dead||this.actions<=0){ if(this.active) this.endTurn(); return null; }
    if(this.checkEnd()) return null;
    const standing=this.alive("pc").filter(p=>p.dying===0);
    if(!standing.length){ this.endTurn(); return null; }
    // A monster cannot swing at what it cannot detect. When it has lost every
    // hero it sweeps the three squares around itself for them instead, which is
    // the only reason a hero who Hides gets found again without a Seek of their
    // own on the other side.
    const pcs=standing.filter(p=>this.detectState(foe,p)!=="undetected");
    if(!pcs.length){
      this.log(`${esc(foe.name)} casts about for something it can no longer see.`);
      this.seek(foe,{x:foe.x,y:foe.y},3);
      this.spend(1); this.renderAll(); return {action:"seek",wait:500};
    }
    if(this.condVal(foe,"fleeing")){ // run from nearest
      const near=pcs.sort((a,b)=>this.dist(foe,a)-this.dist(foe,b))[0];
      const reach=this.reachable(foe,this.moveBudget(foe));
      let best=null,bd=-1;
      Object.keys(reach).forEach(k=>{ const [x,y]=k.split(",").map(Number);
        if(this.occupied(x,y)&&!(x===foe.x&&y===foe.y)) return;
        const d=Math.max(Math.abs(x-near.x),Math.abs(y-near.y));
        if(d>bd){bd=d;best={x,y};} });
      if(best){
        // Running away is still a Stride, and a Stride out of reach provokes.
        const path=[]; let pk=this.key(best.x,best.y);
        while(pk){ const [px,py]=pk.split(",").map(Number); path.unshift({x:px,y:py}); pk=reach[pk].prev; }
        this.provokeAlong(foe,path);
        if(!foe.dead){ foe.x=best.x; foe.y=best.y; this.afterMove(foe); }
      }
      if(foe.dead){ this.spend(this.actions); this.renderAll(); this.endTurn(); return null; }
      this.log(`${esc(foe.name)} flees in terror!`);
      this.spend(this.actions); this.renderAll(); return {action:"flee",wait:450};
    }
    // power?
    const pw=(foe.powers||[]).find(p=>p.cd<=0&&p.cost<=this.actions);
    if(pw){ const inRad=pcs.filter(p=>this.dist(foe,p)<=pw.radius);
      if(inRad.length>=Math.min(2,pcs.length)){
        this.log(`<b>${esc(foe.name)}: ${pw.name}!</b> <i>${esc(pw.flavor||"")}</i>`);
        inRad.forEach(t=>{
          const deg=this.rollSave(t,pw.save,pw.dc,pw.name,pw.traits||[]);
          const mult=[2,1,0.5,0][deg];
          if(mult>0) this.applyDamage(t,Math.floor(Dice.roll(pw.damage).total*mult),pw.damageType,foe,pw.name);
          const bucket=deg===0?pw.onCritFail||pw.onFail:deg===1?pw.onFail:null;
          (bucket||[]).forEach(c=>this.addCond(t,c.c,c.v,c.dur));
        });
        pw.cd=pw.cooldown; this.spend(pw.cost); this.renderAll(); return {action:"power",name:pw.name,wait:600};
      } }
    /* Standing up, and getting out of a grip. Before Phase 5 nothing in the
       engine removed either condition, so a tripped monster fought the rest of
       the fight from the floor and a grabbed one would have been held forever.
       Standing comes first, because prone is -2 to its attacks and off-guard to
       everyone; a grip is only worth an action when it wants to move, so the
       Escape sits down in the movement branch. `doStand` refuses while grabbed
       and spends nothing, so the `if` is what keeps the turn loop moving. */
    if(this.condVal(foe,"prone")&&!this.condVal(foe,"grabbed")&&this.doStand(foe)){
      this.renderAll(); return {action:"stand",wait:400};
    }
    // target: nearest (prefer downed? no — nearest standing, prefer lowest HP among adjacent)
    const adjacent=pcs.filter(p=>this.dist(foe,p)<=1);
    if(adjacent.length){
      const t=adjacent.sort((a,b)=>a.hp-b.hp)[0];
      if(foe.mapCount>=2){ this.spend(this.actions); return {action:"pass",wait:300}; }
      const atk=foe.attacks[foe.mapCount%foe.attacks.length]||foe.attacks[0];
      const atkObj={...atk,traits:atk.traits||[],die:atk.damage,dmgMod:0,range:atk.range,ranged:atk.range>1,statusDmg:0};
      this.strikeMonster(foe,t,atkObj);
      this.spend(1); this.renderAll(); return {action:"strike",target:t.id,wait:550};
    }
    // ranged?
    const ranged=foe.attacks.find(a=>a.range>1);
    const seen=pcs.filter(p=>this.losClear(foe,p));
    if(ranged&&seen.length&&foe.mapCount<2){
      const t=seen.sort((a,b)=>this.dist(foe,a)-this.dist(foe,b))[0];
      if(this.dist(foe,t)<=ranged.range){
        this.strikeMonster(foe,t,{...ranged,traits:ranged.traits||[],die:ranged.damage,dmgMod:0,ranged:true,statusDmg:0});
        this.spend(1); this.renderAll(); return {action:"shoot",target:t.id,wait:550};
      }
    }
    // move toward nearest — unless something has hold of it, in which case
    // breaking the grip is the move.
    if(this.condVal(foe,"grabbed")){
      this.doEscape(foe); this.renderAll(); return {action:"escape",wait:500};
    }
    const near=pcs.sort((a,b)=>this.dist(foe,a)-this.dist(foe,b))[0];
    const reach=this.reachable(foe,this.moveBudget(foe));
    let best=null,bd=1e9;
    Object.keys(reach).forEach(k=>{ const [x,y]=k.split(",").map(Number);
      if(this.occupied(x,y)&&!(x===foe.x&&y===foe.y)) return;
      const d=Math.max(Math.abs(x-near.x),Math.abs(y-near.y));
      if(d<bd||(d===bd&&reach[k].cost<((best&&reach[this.key(best.x,best.y)].cost)||1e9))){bd=d;best={x,y};} });
    if(best&&!(best.x===foe.x&&best.y===foe.y)){
      const path=[]; let k=this.key(best.x,best.y);
      while(k){ const [px,py]=k.split(",").map(Number); path.unshift({x:px,y:py}); k=reach[k].prev; }
      this.provokeAlong(foe,path);
      if(!foe.dead){ foe.x=best.x; foe.y=best.y; this.afterMove(foe); }
      this.spend(1); this.renderAll(); return {action:"move",to:{x:best.x,y:best.y},wait:450};
    }
    this.spend(this.actions); return {action:"pass",wait:300};
  },
  /** A monster's whole turn: step, wait, step, until `aiStep` says it is over.
      With the page's `defer` that is one action every half-second or so; with
      the engine's own it is one synchronous call. */
  aiTurn(foe){
    if(!this.active||foe.dead){ return this.nextTurn(); }
    const step=()=>{ const r=this.aiStep(foe); if(r) this.defer(step,r.wait); };
    step();
  }
};

/**
 * The hero as a combatant — HP, saves, a copy of the attacks, and the pools
 * (spell slots, focus, font, potions) a fight spends from. The page caches the
 * result on `App.heroCb` so HP carries between fights; a test builds a fresh
 * one per encounter.
 */
export function heroCombatant(ch){
  return {id:"hero",side:"pc",name:ch.name,char:ch,hpMax:ch.hpMax,hp:ch.hpMax,tempHP:0,ac:ch.ac,reach:1,
    saves:{fort:ch.saves.fort,ref:ch.saves.ref,will:ch.saves.will},perception:ch.perception,
    speed:Math.floor(ch.speed/5),attacks:ch.attacks.map(a=>({...a})),conditions:[],buffs:[],dying:0,wounded:0,
    resources:{slots:ch.casting?{1:ch.casting.slots[1],2:ch.casting.slots[2]}:{1:0,2:0},
      focus:ch.focusMax,font:ch.casting&&ch.casting.font?ch.casting.font.uses:0,
      potions:Array((ch.consumables.find(c=>c.id==="healing-potion-minor")||{count:0}).count).fill("healing-potion-minor")}};
}
/** A companion as a combatant, from its Registry entry. */
export function companionCombatant(id){
  const c=Registry.companions[id];
  return {id:"comp-"+id,side:"pc",name:c.name,subtitle:c.subtitle,hpMax:c.hp,hp:c.hp,tempHP:0,ac:c.ac,
    reach:c.reach||1,reactions:c.reactions||[],
    saves:{...c.saves},perception:c.perception,initSkill:c.initSkill,speed:Math.floor(c.speed/5),
    attacks:c.attacks.map(a=>({...a,die:a.damage,dmgMod:0,traits:a.traits||[],ranged:a.range>1})),
    abilities:(c.abilities||[]).map(a=>({...a})),conditions:[],buffs:[],dying:0,wounded:0,resources:{slots:{1:0,2:0},focus:0,font:0,potions:[]}};
}

/**
 * A fresh engine. `over` patches any field, which is how a test stands up a
 * two-combatant board without a pack, an adventure or a browser.
 */
export function newCombat(over){
  return Object.assign(Object.create(CombatCore), {
    active:false, cbs:[], order:[], turnIdx:0, round:1, enc:null,
    mapW:0, mapH:0, walls:new Set(), diff:new Set(),
    actions:0, armed:null, sel:null, huntPreyId:null, surprise:false, detect:{},
    onVictory:null, onDefeat:null,
    events:[], onEvent:null
  }, over||{});
}
