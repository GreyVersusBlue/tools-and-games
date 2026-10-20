// The connection between the two devices (ARCHITECTURE 15): one WebRTC
// peer connection with one data channel, and nothing else on the network.
//
//   const peer = createPeer({ onChannel, onTrouble })
//   peer.offer()            → the offer, once its candidates are gathered
//   peer.answer(offer)      → the answer to another device's offer, gathered
//   peer.accept(answer)     the sending device takes the receiving one's answer
//   peer.close()
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
// sendFrames(channel, frames, onSent) sends the envelope's frames in order
// with back-pressure: while more than BUFFER_HIGH bytes are waiting in the
// channel it waits for `bufferedamountlow` (at BUFFER_LOW) before the next.

export const NO_CHANNEL_MS = 20000;
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
    close() {
      if (closed) return;
      closed = true;
      try {
        if (channel) channel.close();
      } catch { /* already gone */ }
      pc.close();
    },
  };
}

// Waits until the channel's buffer is down to its low mark, or the channel
// has closed (the caller then finds it not open).
function drained(channel) {
  return new Promise((resolve) => {
    const done = () => {
      channel.removeEventListener('bufferedamountlow', done);
      channel.removeEventListener('close', done);
      resolve();
    };
    channel.addEventListener('bufferedamountlow', done);
    channel.addEventListener('close', done);
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
// byte has left this device.
export async function sendFrames(channel, frames, onSent) {
  channel.bufferedAmountLowThreshold = BUFFER_LOW;
  for (let i = 0; i < frames.length; i += 1) {
    if (channel.bufferedAmount > BUFFER_HIGH) await drained(channel);
    if (channel.readyState !== 'open') throw new ChannelClosed();
    channel.send(frames[i]);
    if (onSent) onSent(i);
  }
  if (channel.bufferedAmount > 0) {
    channel.bufferedAmountLowThreshold = 0;
    while (channel.bufferedAmount > 0 && channel.readyState === 'open') await drained(channel);
  }
  if (channel.readyState !== 'open') throw new ChannelClosed();
}
