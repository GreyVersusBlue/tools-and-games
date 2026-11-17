// Hearth — the island, heard — the synth buses and every one-shot.
// Classic scripts sharing one global scope; the load order in index.html is the old single file’s order and it matters.
// ---------- audio: the island, heard (sprint 6) ----------
// everything here uses Math.random, never R() — sound must not touch the simulation's stream
let AC=null,audioOn=false,musOn=true,master=null,ambG,sfxG,musG,windG,windF,rainG,rainW,rainV,rainT,whisG,crickG,waveG,waveF,sprG,padG,nBuf=null;
let padOsc=[],birdT=0,gullT=3,creakT=5,musT=3,musKey='',sfxN=0,lastKnock=0,crackT=.3,plopT=.4,callT=4,gooseT=2,owlT=9,frogT=3,murG=null,motifKey='';
const cur={x:0,y:0};
const ar=(a,b)=>b===undefined?Math.random()*a:a+Math.random()*(b-a);
const store=(k,v)=>{try{localStorage.setItem('hearth.'+k,v)}catch(e){}};
const pref=k=>{try{return localStorage.getItem('hearth.'+k)}catch(e){return null}};
const KEYS={spring:[293.66,[0,2,4,7,9]],summer:[196.00,[0,2,4,7,9]],autumn:[220.00,[0,3,5,7,10]],winter:[164.81,[0,3,5,7,10]]};
function noiseBuf(){const b=AC.createBuffer(1,AC.sampleRate*2,AC.sampleRate);const d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;return b}
function mkPan(p){if(!AC.createStereoPanner)return AC.createGain();const n=AC.createStereoPanner();n.pan.value=Math.max(-1,Math.min(1,p));return n}
// how loud and how far to the side a thing at (x,y) is, from wherever the watcher is looking
function place(x,y){const dx=x-cur.x,d=Math.hypot(dx,y-cur.y);return{g:Math.max(.08,1-d/42),p:Math.max(-1,Math.min(1,dx/30))}}
// A11: per-bed make-up gains, measured so each bed alone reads the same RMS on rainG as the old single high-passed bed did
const RAINK=[1.013,6.39,3.48];
// what the view is over, as three weights that sum to 1: [water, village, trees]. Reads only; nothing here is drawn from R().
function rainMix(){const cx=cur.x|0,cy=cur.y|0;let wet=0,n=0;for(let dy=-4;dy<=4;dy+=2)for(let dx=-4;dx<=4;dx+=2){n++;if(at(cx+dx,cy+dy)===WATER)wet++}
  let dh=99;for(const h of houses)dh=Math.min(dh,Math.hypot(h.x+1-cur.x,h.y+1-cur.y));
  let dt=99;for(const t of trees){const d=Math.hypot(t.x-cur.x,t.y-cur.y);if(d<dt)dt=d}
  const a=wet/n,b=Math.max(0,1-dh/7)*(1-a),c=Math.max(.15,Math.max(0,1-dt/6))*(1-a)*(1-b*.7);
  const s=a+b+c;return[a/s,b/s,c/s]}
// the hearth is lit by night, or on a fire night at any hour; how far its crackle carries is 10 tiles
const fireLit=()=>!!fires.length&&(isNight()||storyDay===dayCount);
function startAudio(){AC=new (window.AudioContext||window.webkitAudioContext)();nBuf=noiseBuf();
  master=AC.createGain();master.gain.value=audioOn?1:0;master.connect(AC.destination);
  ambG=AC.createGain();ambG.connect(master);sfxG=AC.createGain();sfxG.connect(master);musG=AC.createGain();musG.gain.value=0;musG.connect(master);
  const loop=dest=>{const s=AC.createBufferSource();s.buffer=nBuf;s.loop=true;s.connect(dest);s.start();return s};
  const lfo=(hz,depth,param)=>{const o=AC.createOscillator();o.type='sine';o.frequency.value=hz;const g=AC.createGain();g.gain.value=depth;o.connect(g).connect(param);o.start()};
  // wind: bandpassed noise that opens up in a storm
  windF=AC.createBiquadFilter();windF.type='bandpass';windF.frequency.value=380;windF.Q.value=.6;
  windG=AC.createGain();windG.gain.value=.05;windF.connect(windG).connect(ambG);loop(windF);lfo(.11,.03,windG.gain);
  // waves: a low wash that swells, louder the closer the shore is to where you are looking
  waveF=AC.createBiquadFilter();waveF.type='lowpass';waveF.frequency.value=560;waveF.Q.value=.9;
  waveG=AC.createGain();waveG.gain.value=0;waveF.connect(waveG).connect(ambG);loop(waveF);
  lfo(.085,240,waveF.frequency);lfo(.062,.016,waveG.gain);
  // rain goes straight to the master: it is the thing everything else ducks under
  // A11: three beds crossfaded by what is under the view (water: bright hiss, village: roofs near 1.8 kHz, trees: a low soft wash). rainG is still
  // the one level the game sets, and the beds' own gains are equal-power weights, so the sum stays where the single bed was.
  {rainG=AC.createGain();rainG.gain.value=0;rainG.connect(master);
    const bed=(type,f,q,k,off)=>{const fl=AC.createBiquadFilter();fl.type=type;fl.frequency.value=f;fl.Q.value=q;const gn=AC.createGain();gn.gain.value=0;const k2=AC.createGain();k2.gain.value=k;
      const sr=AC.createBufferSource();sr.buffer=nBuf;sr.loop=true;sr.connect(fl).connect(k2).connect(gn).connect(rainG);sr.start(0,off);return gn};
    rainW=bed('highpass',3400,.7,RAINK[0],.31);rainV=bed('bandpass',1800,5,RAINK[1],.77);rainT=bed('lowpass',1100,.6,RAINK[2],1.23)}
  // wind's thin whistle: a narrow band that only opens in winter and in storms
  {const bp=AC.createBiquadFilter();bp.type='bandpass';bp.frequency.value=1250;bp.Q.value=14;whisG=AC.createGain();whisG.gain.value=0;bp.connect(whisG).connect(ambG);loop(bp);lfo(.13,260,bp.frequency);lfo(.21,.006,whisG.gain)}
  // A12: the market's murmur, a band of noise whose formant drifts; it only opens at midday, near the market, with three or more at it
  {const bp=AC.createBiquadFilter();bp.type='bandpass';bp.frequency.value=650;bp.Q.value=1.4;murG=AC.createGain();murG.gain.value=0;bp.connect(murG).connect(ambG);loop(bp);lfo(.23,260,bp.frequency);lfo(.37,180,bp.frequency)}
  // a spring, if you are standing near one
  {const bp=AC.createBiquadFilter();bp.type='bandpass';bp.frequency.value=3000;bp.Q.value=1.6;sprG=AC.createGain();sprG.gain.value=0;bp.connect(sprG).connect(ambG);loop(bp);lfo(.7,900,bp.frequency)}
  // crickets
  {const cr=AC.createOscillator();cr.type='triangle';cr.frequency.value=4200;const cl=AC.createOscillator();cl.frequency.value=17;const clg=AC.createGain();clg.gain.value=1;cl.connect(clg);
    crickG=AC.createGain();crickG.gain.value=0;const cg2=AC.createGain();cg2.gain.value=0;clg.connect(cg2.gain);cr.connect(cg2).connect(crickG).connect(ambG);cr.start();cl.start()}
  // the pad the music sits on: root and fifth, retuned when the season turns
  padG=AC.createGain();padG.gain.value=.055;padG.connect(musG);
  for(let i=0;i<2;i++){const o=AC.createOscillator();o.type='triangle';o.frequency.value=110;const g=AC.createGain();g.gain.value=i?.34:.5;o.connect(g).connect(padG);o.start();padOsc.push(o)}
  musKey='';tuneMusic()}
function tuneMusic(){if(!AC||!padOsc.length)return;const s=sea();if(s===musKey)return;musKey=s;
  const k=KEYS[s][0]/2,t=AC.currentTime;padOsc[0].frequency.setTargetAtTime(k,t,4);padOsc[1].frequency.setTargetAtTime(k*Math.pow(2,7/12),t,4)}
function note(f,dur,vol,type,pan,bus,when){if(!AC)return;const t=when||AC.currentTime;
  const o=AC.createOscillator(),g=AC.createGain();o.type=type||'sine';o.frequency.value=f;
  g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(vol,t+.14);g.gain.exponentialRampToValueAtTime(.0004,t+dur);
  const p=mkPan(pan||0);o.connect(g).connect(p).connect(bus||musG);o.start(t);o.stop(t+dur+.06)}
// one-shots, all of them placed in the world
function knock(x,y,f0,f1,body,nf,nq,nv,ndur,lv){if(!AC||!audioOn||sfxN>5)return;
  const t=AC.currentTime;if(t-lastKnock<.085)return;                     // a village at work, not a machine shop
  lastKnock=t;sfxN++;
  const P=place(x,y),pan=mkPan(P.p);pan.connect(sfxG);
  const o=AC.createOscillator(),g=AC.createGain();o.type='sine';o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(f1,t+body);
  g.gain.setValueAtTime(lv*P.g,t);g.gain.exponentialRampToValueAtTime(.001,t+body*1.3);o.connect(g).connect(pan);o.start(t);o.stop(t+body*1.4);
  const n=AC.createBufferSource();n.buffer=nBuf;n.playbackRate.value=1+Math.random()*.3;
  const bp=AC.createBiquadFilter();bp.type='bandpass';bp.frequency.value=nf;bp.Q.value=nq;
  const ng=AC.createGain();ng.gain.setValueAtTime(nv*P.g,t);ng.gain.exponentialRampToValueAtTime(.001,t+ndur);
  n.connect(bp).connect(ng).connect(pan);n.start(t);n.stop(t+ndur+.02)}
const thock=(x,y)=>knock(x,y,190,68,.13,1500,1.2,.1,.1,.15);      // the axe going in
const hammer=(x,y)=>knock(x,y,340,150,.05,2700,1.6,.07,.06,.1);   // a nail, or something like one
const stoneTap=(x,y)=>knock(x,y,520,230,.09,850,2.4,.045,.11,.08); // stone set on stone, or something small left on it
function wayTune(){if(!AC||!audioOn)return;const k=KEYS[sea()],t=AC.currentTime; // three rising notes, once, the day a way is worked out
  [0,2,4].forEach((d,i)=>note(k[0]*Math.pow(2,k[1][d]/12),1.4,.05,'triangle',0,sfxG,t+i*.36))}
function creak(x,y){if(!AC||!audioOn||sfxN>5)return;sfxN++;const P=place(x,y),t=AC.currentTime;
  const o=AC.createOscillator();o.type='sawtooth';o.frequency.setValueAtTime(118,t);o.frequency.linearRampToValueAtTime(96,t+.9);
  const bp=AC.createBiquadFilter();bp.type='bandpass';bp.frequency.value=620;bp.Q.value=6;
  const g=AC.createGain();g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(.055*P.g,t+.25);g.gain.exponentialRampToValueAtTime(.0005,t+1);
  const v=AC.createOscillator();v.frequency.value=5.5;const vg=AC.createGain();vg.gain.value=6;v.connect(vg).connect(o.frequency);v.start(t);v.stop(t+1.1);
  o.connect(bp).connect(g).connect(mkPan(P.p)).connect(sfxG);o.start(t);o.stop(t+1.1)}
function gullCry(x,y){if(!AC||!audioOn||sfxN>5)return;sfxN++;const P=place(x,y),t=AC.currentTime;
  const o=AC.createOscillator();o.type='sawtooth';const f=760+Math.random()*260;
  o.frequency.setValueAtTime(f,t);o.frequency.exponentialRampToValueAtTime(f*1.7,t+.09);o.frequency.exponentialRampToValueAtTime(f*.72,t+.34);
  const lp=AC.createBiquadFilter();lp.type='lowpass';lp.frequency.value=2600;
  const g=AC.createGain();g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(.062*P.g,t+.04);g.gain.exponentialRampToValueAtTime(.0005,t+.38);
  o.connect(lp).connect(g).connect(mkPan(P.p)).connect(sfxG);o.start(t);o.stop(t+.4)}
function whoosh(x,y,len){if(!AC||!audioOn)return;const P=place(x,y),t=AC.currentTime,d=len||.9;
  const n=AC.createBufferSource();n.buffer=nBuf;n.loop=true;
  const bp=AC.createBiquadFilter();bp.type='bandpass';bp.Q.value=1.1;
  bp.frequency.setValueAtTime(300,t);bp.frequency.exponentialRampToValueAtTime(1700,t+d*.45);bp.frequency.exponentialRampToValueAtTime(380,t+d);
  const g=AC.createGain();g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(.11*P.g,t+d*.3);g.gain.exponentialRampToValueAtTime(.0005,t+d);
  n.connect(bp).connect(g).connect(mkPan(P.p)).connect(sfxG);n.start(t);n.stop(t+d+.05)}
function splash(x,y){if(!AC||!audioOn)return;const P=place(x,y),t=AC.currentTime;
  const n=AC.createBufferSource();n.buffer=nBuf;const bp=AC.createBiquadFilter();bp.type='bandpass';bp.Q.value=.9;
  bp.frequency.setValueAtTime(1600,t);bp.frequency.exponentialRampToValueAtTime(500,t+.5);
  const g=AC.createGain();g.gain.setValueAtTime(.12*P.g,t);g.gain.exponentialRampToValueAtTime(.0005,t+.6);
  n.connect(bp).connect(g).connect(mkPan(P.p)).connect(sfxG);n.start(t);n.stop(t+.65)}
// a lullaby, for a sleeping child: five notes down the season's scale, twice, slowly
function lullaby(x,y){if(!AC||!audioOn)return;const P=place(x,y),k=KEYS[sea()],t=AC.currentTime;
  const seq=[4,3,2,1,0,2,1,0];
  seq.forEach((d,i)=>{const f=k[0]*Math.pow(2,k[1][d]/12)*(d>3?1:2)/2;
    note(f,i===seq.length-1?2.4:1.1,.055*P.g,'sine',P.p*.5,sfxG,t+i*.62+(i>4?.3:0))})}
// ---------- the songs, heard (phase 1) ----------
// Sprint 16 built the songs completely except for the sound and said so on purpose. This is the sound.
// A tune is DERIVED, never stored: the degrees come off the island seed and the story's own chronicle index, the way yearName() and
// MADE() come off the seed. So a shared link hums the same phrase, save.js carries not one byte more than it did, and R() is never
// touched here — sound must not move the simulation's stream.
const SONG_STEPS=[-2,-1,-1,1,1,2];                                    // a phrase walks; it does not scatter
function songDegrees(ci){let a=(seed^Math.imul((ci|0)+1,2654435761))|0;
  const nx=()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
  const n=6+((nx()*5)|0),out=[];let d=2+((nx()*5)|0);                 // 6..10 degrees over two octaves of the season's five, starting mid-range
  for(let i=0;i<n;i++){out.push(d);let m=d+SONG_STEPS[(nx()*6)|0];
    if(m<0)m=-m;if(m>9)m=18-m;d=m}                                    // reflected at both ends, not clamped: a clamp parks the phrase on one note and calls it a tune
  out[n-1]=out[n-2]>=5?5:0;                                           // and it comes home: the last note is the root, in whichever octave the phrase ended up
  return out}
// degree -> hertz in the season's key. 0-4 is the scale, 5-9 the same five an octave up. The key is the ONLY thing that moves between
// hearings: a song made in spring and sung again in winter is the same tune, lower, which is the whole idea.
const songHz=(d,k)=>k[0]*Math.pow(2,(k[1][d%5]+(d>=5?12:0))/12)/2;
// The tune, at the fire. Pass one is the composer alone; on pass two the ones who know it come in, which is what the prose at the fire
// already says happens. Every voice is one note() per degree, scheduled ahead on sfxG, so the storm ducks this with everything else.
// Returns the degrees, or null when nothing sounded — a lost song is silent, and that is the design.
/* A13: a song that sounds sung. Each voice is one sawtooth through two band-pass filters at vowel formants (a different pair per voice) with a slow
   vibrato, so the fire-night song is a small choir and not five beeps; a child's voice is an octave up; a 180 ms feedback delay (gain .25) sits on
   the song and nothing else, for the hill. What was scheduled is kept in singNow, a presentation variable only folk.js reads: start (animT clock),
   beat, degrees, who sings on each pass. A lost song schedules nothing and leaves singNow alone. Math.random and R() are never called here. */
let singNow=null;
const FORMANTS=[[700,1100],[600,1250],[800,1000],[500,1400],[650,1150]];
const SONG_LEAD=.2,SONG_BEAT=.38,SONG_GAP=.45,SONG_MAKEUP=1.7;     /* two narrow formants pass little of a sawtooth: this brings the choir back to the level the five beeps measured (peak 0.103) */
function songVoice(deg,k,t,beat,vol,pan,vi,kid,dest){const o=AC.createOscillator(),vib=AC.createOscillator(),vg=AC.createGain(),sum=AC.createGain();
  o.type='sawtooth';vib.frequency.value=5+vi*.35;vg.gain.value=kid?14:9;vib.connect(vg).connect(o.detune);   /* cents; a child's wobbles a little more */
  const fm=FORMANTS[vi%FORMANTS.length],sc=kid?1.18:1;
  for(const f of fm){const bp=AC.createBiquadFilter();bp.type='bandpass';bp.frequency.value=f*sc;bp.Q.value=5;o.connect(bp);bp.connect(sum)}
  deg.forEach((d,i)=>{const f=songHz(d,k)*(kid?2:1),at=t+i*beat,g=AC.createGain();g.gain.value=0;o.frequency.setValueAtTime(f,at);
    g.gain.setValueAtTime(.0001,at);g.gain.linearRampToValueAtTime(vol*SONG_MAKEUP,at+.14);g.gain.exponentialRampToValueAtTime(.0004,at+beat*2.1);
    sum.connect(g);g.connect(dest)});
  const end=t+deg.length*beat+beat*2.1+.06;o.start(t);vib.start(t);o.stop(end);vib.stop(end)}
function songTune(sg,voices){if(!sg||sg.lost)return null;const deg=songDegrees(sg.ci);
  const vs=Math.max(1,Math.min(4,(voices|0)||1)),beat=SONG_BEAT,t2=SONG_LEAD+deg.length*beat+SONG_GAP;
  const names=[sg.comp].concat((sg.kn||[]).filter(n=>n!==sg.comp)).filter(n=>n!=null&&n!=='').slice(0,vs);
  singNow={a:animT+SONG_LEAD,beat,deg,names,second:animT+t2,end:animT+t2+(deg.length+1)*beat};   /* the tune is a fact about the island; the picture follows it with or without the sound */
  if(!AC||!audioOn)return deg;
  const k=KEYS[sea()],t=AC.currentTime+SONG_LEAD,bus=AC.createGain(),dly=AC.createDelay(.5),fb=AC.createGain(),wet=AC.createGain();
  dly.delayTime.value=.18;fb.gain.value=.25;wet.gain.value=.25;bus.connect(sfxG);bus.connect(dly);dly.connect(fb).connect(dly);dly.connect(wet).connect(sfxG);
  const kidOf=n=>{const q=n&&byName(n);return !!q&&isKid(q)};
  songVoice(deg,k,t,beat,.05,-.12,0,kidOf(names[0]),bus);
  const tt=t+deg.length*beat+SONG_GAP;
  for(let v=0;v<vs;v++){const pan=vs<2?0:(v/(vs-1))*1.1-.55;songVoice(deg,k,tt+v*.02,beat,v?.026:.05,pan,v,kidOf(names[v]),bus)}
  setTimeout(()=>{try{bus.disconnect();wet.disconnect();fb.gain.value=0}catch(e){}},(deg.length*beat*2+SONG_GAP+beat*2.1+2.5)*1000);
  return deg}
// ---------- A12: the island's own voices ----------
// Math.random for the sound, never R(). Nothing here is written to the simulation; every function only reads it. The one thing that is a
// function of the seed is the dawn motif, and it is derived, never stored, the way a tune is.
function voice(f0,f1,dur,vol,type,fil,fq,pan,bus,when,vib){const t=when||AC.currentTime,o=AC.createOscillator(),g=AC.createGain(),lp=AC.createBiquadFilter();
  o.type=type;o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(f1,t+dur*.8);lp.type='bandpass';lp.frequency.value=fil;lp.Q.value=fq;
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+Math.min(.04,dur*.3));g.gain.exponentialRampToValueAtTime(.0005,t+dur);
  if(vib){const v=AC.createOscillator(),vg=AC.createGain();v.frequency.value=vib[0];vg.gain.value=vib[1]*vol;v.connect(vg).connect(g.gain);v.start(t);v.stop(t+dur+.05)}
  o.connect(lp).connect(g).connect(mkPan(pan)).connect(bus||ambG);o.start(t);o.stop(t+dur+.05)}
// spring: two notes, the second a fourth or so up
function twoNote(){if(!AC||!audioOn)return;const f=ar(1700,2500),t=AC.currentTime,pn=ar(-.6,.6);
  voice(f*1.04,f,.17,.105,'sine',f,1,pn,ambG,t);voice(f*1.3,f*1.25,.22,.105,'sine',f*1.3,1,pn,ambG,t+.2)}
// summer, by day: a dry buzz, noise through a high narrow band, chopped at insect speed
function buzz(){if(!AC||!audioOn)return;const t=AC.currentTime,d=ar(.9,1.5),n=AC.createBufferSource();n.buffer=nBuf;n.loop=true;
  const bp=AC.createBiquadFilter();bp.type='bandpass';bp.frequency.value=ar(5200,6400);bp.Q.value=7;const g=AC.createGain(),pn=mkPan(ar(-.7,.7));
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.4,t+.25);g.gain.setValueAtTime(.4,t+d-.3);g.gain.linearRampToValueAtTime(0,t+d);
  const ch=AC.createOscillator(),cg=AC.createGain();ch.type='square';ch.frequency.value=ar(48,70);cg.gain.value=.35;const base=AC.createGain();base.gain.value=.65;
  const am=AC.createGain();am.gain.value=0;ch.connect(cg).connect(am.gain);base.connect(am.gain);
  n.connect(bp).connect(am).connect(g).connect(pn).connect(ambG);n.start(t);n.stop(t+d+.05);ch.start(t);ch.stop(t+d+.05)}
// autumn: a goose, from wherever the geese are. Silent when there are none in the air.
function gooseCall(){if(!geese||!AC||!audioOn||sfxN>5)return false;sfxN++;const P=place(geese.x,geese.y),t=AC.currentTime,f=ar(380,470);
  voice(f,f*1.28,.3,.18*P.g,'sawtooth',900,1.6,P.p,ambG,t);voice(f*1.18,f*.9,.34,.18*P.g,'sawtooth',900,1.6,P.p,ambG,t+.36);return true}
// winter: one low caw, now and then
function caw(){if(!AC||!audioOn)return;const f=ar(210,260);voice(f*1.1,f*.7,.5,.14,'sawtooth',f*2.4,1.2,ar(-.5,.5),ambG)}
// a clear night outside winter: an owl, two soft notes
function owl(){if(!AC||!audioOn)return;const t=AC.currentTime,pn=ar(-.6,.6);voice(430,415,.55,.095,'sine',430,1.2,pn,ambG,t);voice(345,320,.75,.095,'sine',345,1.2,pn,ambG,t+.62)}
// frogs, at a spring at dusk: a short pulsed croak, placed at the water
function frog(x,y){if(!AC||!audioOn)return;const P=place(x,y),t=AC.currentTime,f=ar(150,210);
  for(let i=0;i<2+((Math.random()*3)|0);i++)voice(f,f*.8,.14,.12*P.g,'square',f*3,2,P.p,ambG,t+i*.17,[32,.8])}
// the market's level as a gain target, from the state alone: midday, within 8 tiles of the market, three or more of them at it
function murLevel(){const m=getB('market');if(!m)return 0;const f=dayFrac();if(f<=.45||f>=.56)return 0;
  let n=0;for(const p of people)if(p.task==='market')n++;if(n<3)return 0;
  return Math.max(0,1-Math.hypot(m.x+1.5-cur.x,m.y+1.5-cur.y)/8)*Math.min(1,n/5)}
// the dawn motif: three to five notes, off the seed alone by the walk a song takes (songDegrees(-1) multiplies its index by nothing, so this
// phrase is the seed's own and no story's). Two devices on one link agree; two islands do not.
const motifDegrees=()=>songDegrees(-1).slice(0,3+((seed>>>0)%3));
function dawnMotif(){if(!AC||!audioOn)return null;const deg=motifDegrees(),k=KEYS[sea()],t=AC.currentTime+.1;
  deg.forEach((d,i)=>note(songHz(d,k)*2,2.2,.3,'sine',0,musG,t+i*.75));return deg}
function crackle(g,k,fx){if(!AC||!audioOn)return;const t=AC.currentTime,src=AC.createBufferSource();src.buffer=nBuf;
  const bp=AC.createBiquadFilter();bp.type='bandpass';bp.frequency.value=ar(1400,4800);bp.Q.value=2.5;const gn=AC.createGain(),v=.25*g*k*(.7+Math.random()*.3);
  gn.gain.setValueAtTime(0,t);gn.gain.linearRampToValueAtTime(v,t+.002);gn.gain.exponentialRampToValueAtTime(.0005,t+ar(.025,.07));
  src.connect(bp).connect(gn).connect(mkPan((fx-cur.x)/30)).connect(ambG);src.start(t,ar(1.5));src.stop(t+.09)}
function plop(w){if(!AC||!audioOn)return;const o=AC.createOscillator(),gn=AC.createGain(),t=AC.currentTime,f=ar(220,420);o.type='sine';
  o.frequency.setValueAtTime(f,t);o.frequency.exponentialRampToValueAtTime(f*.45,t+.09);
  gn.gain.setValueAtTime(0,t);gn.gain.linearRampToValueAtTime(.05*w,t+.006);gn.gain.exponentialRampToValueAtTime(.001,t+.12);o.connect(gn).connect(mkPan(ar(-.5,.5))).connect(ambG);o.start(t);o.stop(t+.14)}
function chirp(){if(!AC||!audioOn)return;const o=AC.createOscillator(),gn=AC.createGain(),t=AC.currentTime;o.type='sine';const f=2200+Math.random()*1800;
  o.frequency.setValueAtTime(f,t);o.frequency.exponentialRampToValueAtTime(f*1.5,t+.06);o.frequency.exponentialRampToValueAtTime(f*.9,t+.13);
  gn.gain.setValueAtTime(0,t);gn.gain.linearRampToValueAtTime(.06,t+.02);gn.gain.linearRampToValueAtTime(0,t+.15);
  o.connect(gn).connect(mkPan(ar(-.6,.6))).connect(ambG);o.start(t);o.stop(t+.16)}
function plink(v){if(!AC||!audioOn)return;const o=AC.createOscillator(),gn=AC.createGain(),t=AC.currentTime;
  o.frequency.setValueAtTime(600,t);o.frequency.exponentialRampToValueAtTime(180,t+.25);
  gn.gain.setValueAtTime(v||.15,t);gn.gain.exponentialRampToValueAtTime(.001,t+.3);o.connect(gn).connect(sfxG);o.start(t);o.stop(t+.3)}
function thunder(d){if(!AC||!audioOn)return;const t=AC.currentTime+d*.9;const src=AC.createBufferSource();src.buffer=nBuf;
  const lp=AC.createBiquadFilter();lp.type='lowpass';lp.frequency.setValueAtTime(160,t);lp.frequency.exponentialRampToValueAtTime(50,t+1.6+d*.4);
  const gn=AC.createGain();const v=.5/(1+d*.5);gn.gain.setValueAtTime(0,t);gn.gain.linearRampToValueAtTime(v,t+.05+d*.03);gn.gain.exponentialRampToValueAtTime(.001,t+1.8+d*.5);
  src.connect(lp).connect(gn).connect(master);src.start(t);src.stop(t+2.2+d*.5)}
function audioTick(dt){sfxN=0;if(!AC||!audioOn)return;const t=AC.currentTime,s=sea(),night=isNight();
  const duck=storm?.4:rain?.62:wx==='snow'?.85:1;                        // everything steps back under rain
  ambG.gain.setTargetAtTime(duck,t,1.2);sfxG.gain.setTargetAtTime(.5+.5*duck,t,.7);
  rainG.gain.setTargetAtTime(rain?(storm?.14:.09):0,t,1.5);
  {const m=rainMix();rainW.gain.setTargetAtTime(Math.sqrt(m[0]),t,.6);rainV.gain.setTargetAtTime(Math.sqrt(m[1]),t,.6);rainT.gain.setTargetAtTime(Math.sqrt(m[2]),t,.6);
    // sparse low plops on the water, only while it is raining and the view is over the sea
    plopT-=dt;if(plopT<=0){plopT=ar(.18,.7);if(rain&&Math.random()<m[0])plop(m[0]*(storm?1.3:1))}}
  whisG.gain.setTargetAtTime((s==='winter'?.012:0)+(storm?.016:0),t,2.5);
  windG.gain.setTargetAtTime(({clear:.045,overcast:.06,rain:.07,thunder:.12,fog:.03,snow:.055})[wx]+(s==='winter'?.012:0),t,2);
  windF.frequency.setTargetAtTime(storm?640:wx==='fog'?250:380,t,4);
  crickG.gain.setTargetAtTime(night&&!rain&&s!=='winter'?.045:0,t,2);
  // the sea, from where you are looking
  {const sh=nearestShore(cur.x,cur.y),d=sh?Math.hypot(sh.x-cur.x,sh.y-cur.y):40;
    const v=Math.max(0,1-d/18)*(frozen?.3:1)*(storm?1.8:rain?1.2:1);
    waveG.gain.setTargetAtTime(.01+v*.075*(.7+.3*(tide()+1)/2),t,.7)}   // fuller at high water
  // and the spring, if there is one near
  {let d=99;for(const sp of springs)d=Math.min(d,Math.hypot(sp.x-cur.x,sp.y-cur.y));
    sprG.gain.setTargetAtTime(d<9?.022*(1-d/9):0,t,.9)}
  // the fire's crackle: short band-passed clicks at random intervals, heard within 10 tiles, fuller on a fire night
  crackT-=dt;if(crackT<=0){const fd=Math.hypot(center.x-cur.x,center.y-cur.y),g=Math.max(0,1-fd/10);crackT=ar(.07,.45);if(g>.02&&fireLit())crackle(g,storyDay===dayCount?1.6:1,center.x)}
  // A12: the island's own voices, by season and hour
  {const e=edges(),f=dayFrac();
    murG.gain.setTargetAtTime(.1*murLevel(),t,1.2);
    callT-=dt;if(callT<=0){callT=ar(5,14);if(!night&&!rain&&wx!=='snow'){
      if(s==='spring'&&Math.random()<.7)twoNote();else if(s==='summer'&&Math.random()<.2)buzz();else if(s==='winter'&&Math.random()<.25)caw()}}
    gooseT-=dt;if(gooseT<=0){gooseT=ar(1.4,3);if(s==='autumn')gooseCall()}
    owlT-=dt;if(owlT<=0){owlT=ar(10,26);if(night&&wx==='clear'&&s!=='winter')owl()}
    frogT-=dt;if(frogT<=0){frogT=ar(.7,2.2);if(isDusk()&&(s==='spring'||s==='summer')&&!rain){let b=null,bd=14;for(const sp of springs){const d=Math.hypot(sp.x-cur.x,sp.y-cur.y);if(d<bd){bd=d;b=sp}}if(b)frog(b.x,b.y)}}
    const mk=dayCount+':'+seed;if(motifKey!==mk&&!night&&f<e[0]+.1&&musOn&&!storm&&musG.gain.value>.15){motifKey=mk;dawnMotif()}}
  // music: the season's key, gone by nightfall
  tuneMusic();
  const want=(!night&&!storm&&musOn)?.5:0;musG.gain.setTargetAtTime(want*duck,t,want?7:4);
  if(want>0){musT-=dt;if(musT<=0){musT=ar(1.9,4.2);const k=KEYS[s],sc=k[1];
    const deg=sc[(Math.random()*sc.length)|0],oct=Math.random()<.28?12:0,pan=ar(-.55,.55);
    const f=k[0]*Math.pow(2,(deg+oct)/12);
    note(f,ar(1.8,2.9),.042,'sine',pan);
    if(Math.random()<.34)note(f*Math.pow(2,(Math.random()<.5?3:4)/12),2.3,.026,'triangle',pan*-.6,musG,t+ar(.3,.7))}}
  // birds, gulls, and the mill turning
  birdT-=dt;if(birdT<=0){birdT=ar(.3,3);if(!night&&!rain&&wx!=='snow'&&Math.random()<(s==='winter'?.2:.7)){chirp();if(Math.random()<.5)setTimeout(chirp,120+Math.random()*100)}}
  gullT-=dt;if(gullT<=0){gullT=ar(4,15);if(gulls.length>2&&!night&&Math.random()<.6){const g=gulls[(Math.random()*gulls.length)|0];gullCry(g.x,g.y)}}
  creakT-=dt;if(creakT<=0){creakT=ar(4,10);const m=getB('mill');
    if(m&&Math.random()<({clear:.4,overcast:.55,rain:.6,thunder:.9,fog:.25,snow:.5})[wx])creak(m.x+1,m.y+1)}}
