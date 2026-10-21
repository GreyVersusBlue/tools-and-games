// The connection between the two devices (ARCHITECTURE 15): one WebRTC
// peer connection with one data channel, and nothing else on the network.
//
//   const peer = createPeer({ onChannel, onTrouble })
//   peer.offer()            → the offer, once its candidates are gathered
//   peer.answer(offer)      → the answer to another device's offer, gathered
//   peer.accept(answer)     the sending device takes the receiving one's answer
//   peer.close()            at once; peer.signal is aborted
//   peer.closeAfter()       once what was sent has left (or FLUSH_MS), then close()
//
// `iceServers` is always empty. A STUN or TURN server is somebody else's
// computer, and the tool makes no offsite request, ever; so the two devices
// find each other only by the addresses they have themselves, which works on
// one network that lets its devices talk to each other and fails on one that
// keeps them apart (many school networks). That failure is not an error
// here: the channel just never opens, and the screens say so after
// NO_CHANNEL_MS.
//
// Candidates are not trickled: there is no server to carry them, so each
// code has to hold every candidate. offer() and answer() wait for the
// gathering to finish, or GATHER_MS, whichever comes first.
//
// onChannel(channel) is called once with the open data channel (binaryType
// "arraybuffer", ordered). onTrouble() is called when the connection says it
// has failed, so the screen need not wait out the clock to say so.
//
// sendFrames(channel, frames, onSent, signal) sends the envelope's frames in
// order with back-pressure: while more than BUFFER_HIGH bytes are waiting in
// the channel it waits for `bufferedamountlow` (at BUFFER_LOW) before the
// next. RTCPeerConnection.close() fires no event on its channels, so a wait
// would last for ever after it; peer.signal is aborted by close(), and
// sendFrames given it stops there and drops the frames left.
//
// stallClock(ms, onStall) is the watch on an open channel that stops
// carrying anything: poke() at every sign of progress, stop() at the end.

export const NO_CHANNEL_MS = 20000;
export const STALL_MS = 20000;
export const FLUSH_MS = 1000;
export const GATHER_MS = 4000;
export const BUFFER_HIGH = 256 * 1024;
export const BUFFER_LOW = 64 * 1024;
export const CHANNEL_LABEL = 'sv2-transfer';

export function peerAvailable() {
  return typeof globalThis.RTCPeerConnection === 'function';
}

function gathered(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', changed);
      resolve();
    };
    const changed = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, GATHER_MS);
    pc.addEventListener('icegatheringstatechange', changed);
  });
}

function plain(description) {
  return { type: description.type, sdp: description.sdp };
}

export function createPeer(options) {
  const opts = options || {};
  const pc = new RTCPeerConnection({ iceServers: [] });
  let channel = null;
  let opened = false;
  let closed = false;
  const ending = new AbortController();

  function take(next) {
    channel = next;
    channel.binaryType = 'arraybuffer';
    const open = () => {
      if (opened || closed) return;
      opened = true;
      if (opts.onChannel) opts.onChannel(channel);
    };
    if (channel.readyState === 'open') open();
    else channel.addEventListener('open', open);
  }

  pc.addEventListener('connectionstatechange', () => {
    if (!closed && pc.connectionState === 'failed' && opts.onTrouble) opts.onTrouble();
  });
  pc.addEventListener('datachannel', (event) => {
    if (!channel && event.channel.label === CHANNEL_LABEL) take(event.channel);
  });

  return {
    get opened() {
      return opened;
    },
    async offer() {
      take(pc.createDataChannel(CHANNEL_LABEL, { ordered: true }));
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      return plain(pc.localDescription);
    },
    async answer(offer) {
      await pc.setRemoteDescription(offer);
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      return plain(pc.localDescription);
    },
    async accept(answer) {
      await pc.setRemoteDescription(answer);
    },
    get signal() {
      return ending.signal;
    },
    close() {
      if (closed) return;
      closed = true;
      ending.abort();
      try {
        if (channel) channel.close();
      } catch { /* already gone */ }
      pc.close();
    },
    // A last message (the reply) is let go before the connection is: closed
    // in the same task it was sent in, it may never leave this device.
    closeAfter() {
      if (closed) return Promise.resolve();
      const waiting = channel && channel.readyState === 'open' && channel.bufferedAmount > 0
        ? new Promise((resolve) => {
          const timer = setTimeout(done, FLUSH_MS);
          function done() {
            clearTimeout(timer);
            channel.removeEventListener('bufferedamountlow', check);
            channel.removeEventListener('close', done);
            ending.signal.removeEventListener('abort', done);
            resolve();
          }
          function check() {
            if (channel.bufferedAmount === 0) done();
          }
          channel.bufferedAmountLowThreshold = 0;
          channel.addEventListener('bufferedamountlow', check);
          channel.addEventListener('close', done);
          ending.signal.addEventListener('abort', done);
        })
        : Promise.resolve();
      return waiting.then(() => this.close());
    },
  };
}

// Waits until the channel's buffer is down to its low mark, or the channel
// has closed, or `signal` says the connection has (the caller then finds it
// not open).
function drained(channel, signal) {
  return new Promise((resolve) => {
    const done = () => {
      channel.removeEventListener('bufferedamountlow', done);
      channel.removeEventListener('close', done);
      if (signal) signal.removeEventListener('abort', done);
      resolve();
    };
    channel.addEventListener('bufferedamountlow', done);
    channel.addEventListener('close', done);
    if (signal) signal.addEventListener('abort', done);
  });
}

export class ChannelClosed extends Error {
  constructor() {
    super('The connection closed while the project was being sent.');
    this.name = 'ChannelClosed';
  }
}

// onSent(index) after frame `index` is handed to the channel. Resolves once
// every frame is handed over and the channel's buffer is empty, so every
// byte has left this device; throws ChannelClosed once the channel or
// `signal` says the connection has gone.
export async function sendFrames(channel, frames, onSent, signal) {
  const gone = () => channel.readyState !== 'open' || Boolean(signal && signal.aborted);
  channel.bufferedAmountLowThreshold = BUFFER_LOW;
  for (let i = 0; i < frames.length; i += 1) {
    if (channel.bufferedAmount > BUFFER_HIGH) await drained(channel, signal);
    if (gone()) throw new ChannelClosed();
    channel.send(frames[i]);
    if (onSent) onSent(i);
  }
  if (channel.bufferedAmount > 0) {
    channel.bufferedAmountLowThreshold = 0;
    while (channel.bufferedAmount > 0 && !gone()) await drained(channel, signal);
  }
  if (gone()) throw new ChannelClosed();
}

// onStall() once `ms` pass with no poke(). A poke after it starts the clock
// again (and the caller takes back what it said); stop() ends the watch.
export function stallClock(ms, onStall) {
  let timer = null;
  let stopped = false;
  const arm = () => {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(onStall, ms);
  };
  arm();
  return {
    poke: arm,
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
