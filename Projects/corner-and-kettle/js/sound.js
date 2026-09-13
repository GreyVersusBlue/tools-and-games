// sound.js — every sound the shop makes, synthesized with WebAudio. There is
// not one audio file in the project.
//
// A leaf: it imports nothing. `isMuted` is asked on every beep rather than
// passed once, so the mute button takes effect mid-shift.

export function createSound(isMuted){
  let audioCtx = null;
  function getAudioCtx(){
    if(audioCtx) return audioCtx;
    try{ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }
    catch(e){ audioCtx = null; }
    return audioCtx;
  }
  function beep(freq, duration, type, vol, delay){
    if(isMuted()) return;
    const ctx = getAudioCtx();
    if(!ctx) return;
    try{
      const t0 = ctx.currentTime + (delay||0);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type||'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(vol||0.15, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0+duration);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0+duration+0.02);
    }catch(e){}
  }
  return {
    shot(){ beep(880,0.1,'square',0.12); beep(700,0.1,'square',0.08,0.07); },
    steam(){ beep(320,0.28,'sawtooth',0.06); beep(260,0.2,'sawtooth',0.05,0.12); },
    blend(){ beep(150,0.15,'sawtooth',0.09); beep(170,0.15,'sawtooth',0.08,0.08); beep(140,0.15,'sawtooth',0.07,0.16); },
    serve(happy){
      if(happy){ beep(660,0.12,'sine',0.16); beep(990,0.16,'sine',0.14,0.09); }
      else { beep(320,0.2,'sine',0.12); beep(260,0.22,'sine',0.1,0.08); }
    },
  };
}
