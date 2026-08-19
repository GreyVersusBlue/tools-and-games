// Hearth — the island, heard — the synth buses and every one-shot.
// Classic scripts sharing one global scope; the load order in index.html is the old single file’s order and it matters.
// ---------- audio: the island, heard (sprint 6) ----------
// everything here uses Math.random, never R() — sound must not touch the simulation's stream
let AC=null,audioOn=false,musOn=true,master=null,ambG,sfxG,musG,windG,windF,rainG,crickG,waveG,waveF,sprG,padG,nBuf=null;
let padOsc=[],birdT=0,gullT=3,creakT=5,musT=3,musKey='',sfxN=0,lastKnock=0;
const cur={x:0,y:0};
const ar=(a,b)=>b===undefined?Math.random()*a:a+Math.random()*(b-a);
const store=(k,v)=>{try{localStorage.setItem('hearth.'+k,v)}catch(e){}};
const pref=k=>{try{return localStorage.getItem('hearth.'+k)}catch(e){return null}};
const KEYS={spring:[293.66,[0,2,4,7,9]],summer:[196.00,[0,2,4,7,9]],autumn:[220.00,[0,3,5,7,10]],winter:[164.81,[0,3,5,7,10]]};
function noiseBuf(){const b=AC.createBuffer(1,AC.sampleRate*2,AC.sampleRate);const d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;return b}
function mkPan(p){if(!AC.createStereoPanner)return AC.createGain();const n=AC.createStereoPanner();n.pan.value=Math.max(-1,Math.min(1,p));return n}
// how loud and how far to the side a thing at (x,y) is, from wherever the watcher is looking
function place(x,y){const dx=x-cur.x,d=Math.hypot(dx,y-cur.y);return{g:Math.max(.08,1-d/42),p:Math.max(-1,Math.min(1,dx/30))}}
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
  {const hp=AC.createBiquadFilter();hp.type='highpass';hp.frequency.value=2200;rainG=AC.createGain();rainG.gain.value=0;hp.connect(rainG).connect(master);loop(hp)}
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
  windG.gain.setTargetAtTime(({clear:.045,overcast:.06,rain:.07,thunder:.12,fog:.03,snow:.055})[wx]+(s==='winter'?.012:0),t,2);
  windF.frequency.setTargetAtTime(storm?640:wx==='fog'?250:380,t,4);
  crickG.gain.setTargetAtTime(night&&!rain&&s!=='winter'?.045:0,t,2);
  // the sea, from where you are looking
  {const sh=nearestShore(cur.x,cur.y),d=sh?Math.hypot(sh.x-cur.x,sh.y-cur.y):40;
    const v=Math.max(0,1-d/18)*(frozen?.3:1)*(storm?1.8:rain?1.2:1);
    waveG.gain.setTargetAtTime(.01+v*.075,t,.7)}
  // and the spring, if there is one near
  {let d=99;for(const sp of springs)d=Math.min(d,Math.hypot(sp.x-cur.x,sp.y-cur.y));
    sprG.gain.setTargetAtTime(d<9?.022*(1-d/9):0,t,.9)}
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
