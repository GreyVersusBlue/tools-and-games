// The sending device (spec 13.5): the project file is packed into the
// envelope (engine/transfer.js), an offer is made and shown as a code, the
// receiving device's reply is scanned or pasted, and once the channel is open
// every part goes over with back-pressure. The dialog ends saying "Received
// and applied" only when the other device's reply says so.
//
// dialog#transfer-send carries data-state:
//   unavailable  no WebRTC in this browser; the project file is offered
//   preparing    the file is being packed and the offer made
//   offer        the code is shown; the reply is asked for
//   connecting   the reply is taken; waiting for the channel. After
//                NO_CHANNEL_MS (or when the connection says it failed) the
//                dialog gains data-no-channel="true" and the plain statement
//                with the project file; it keeps waiting all the same
//   sending      parts going over; data-parts="sent/total"
//   sent         every part has left; waiting for the reply
//   applied      the other device replaced its project with this one
//   not-taken    the other device kept its own (or could not take this one)
//   lost         the connection closed before the other device answered
//   failed       something here went wrong; the sentence says what

import { h } from '../../components/dom.js';
import { buildExport } from '../../../engine/exports.js';
import { packTransfer, encodeSignal, decodeSignal, readAck } from '../../../engine/transfer.js';
import { transferDialog } from './dialog.js';
import { createPeer, peerAvailable, sendFrames, NO_CHANNEL_MS } from './peer.js';
import { codeShown, codeTaken } from './codes.js';
import { lines, progressLine, exportRow, pasteAnywhere, subtleOf, messageOf } from './common.js';
import { SENTENCES } from './words.js';

export function openSend(ctx, opener) {
  let peer = null;
  let taken = null;
  let timer = null;
  let closed = false;
  let answered = false;
  let answeredDone = false;
  let packed = null;
  const dialog = transferDialog({
    id: 'transfer-send',
    title: 'Send this project to another device',
    opener,
    onClose() {
      closed = true;
      clearTimeout(timer);
      if (taken) taken.stop();
      if (peer) peer.close();
    },
  });
  const talk = lines();

  function failed(sentence) {
    clearTimeout(timer);
    if (taken) taken.stop();
    if (peer) peer.close();
    const other = lines();
    dialog.show('failed', sentence, [h('p', null, 'You can send the project file instead.'), exportRow(ctx, other.say), other.said]);
  }

  function finished(state, sentence) {
    answeredDone = true;
    clearTimeout(timer);
    dialog.show(state, sentence, []);
    // the reply is in; the channel has nothing more to carry
    setTimeout(() => peer && peer.close(), 0);
  }

  function noChannel() {
    if (closed || dialog.element.dataset.state !== 'connecting' || dialog.element.dataset.noChannel === 'true') return;
    dialog.element.dataset.noChannel = 'true';
    const other = lines();
    dialog.body.append(h('div', { class: 'xfer__alternative', data: { line: 'no-channel' } },
      h('p', { role: 'alert' }, SENTENCES.noChannelSending),
      exportRow(ctx, other.say),
      other.said));
  }

  async function onChannel(channel) {
    if (closed) return;
    clearTimeout(timer);
    delete dialog.element.dataset.noChannel;
    const chunks = packed.header.chunks;
    const progress = progressLine(dialog, 'Sent');
    channel.addEventListener('message', (event) => {
      if (answeredDone) return;
      let ack;
      try {
        ack = readAck(event.data, packed.sha256);
      } catch (error) {
        finished('failed', messageOf(error));
        return;
      }
      if (ack.applied) {
        finished('applied', SENTENCES.applied);
        ctx.toast({ text: 'The other device received and applied this project.' });
      } else {
        finished('not-taken', SENTENCES.notTaken);
      }
    });
    channel.addEventListener('close', () => {
      if (!closed && !answeredDone) {
        answeredDone = true;
        dialog.show('lost', SENTENCES.lostSending, []);
      }
    });
    dialog.show('sending', 'Connected. Sending the project…', [progress.element]);
    progress.set(0, chunks);
    try {
      // frame 0 is the header and the last the trailer; the parts are between
      await sendFrames(channel, packed.frames, (index) => {
        if (index >= 1 && index <= chunks) progress.set(index, chunks);
      });
    } catch (error) {
      return; // the close listener has said so
    }
    if (!closed && !answeredDone) dialog.show('sent', SENTENCES.sentAll, []);
  }

  async function takeAnswer(text) {
    if (answered || closed) return;
    let answer;
    try {
      answer = await decodeSignal(text, { subtle: subtleOf(), expect: 'answer' });
    } catch (error) {
      talk.refuse(messageOf(error));
      return;
    }
    if (answered || closed) return;
    answered = true;
    taken.stop();
    dialog.show('connecting', SENTENCES.connecting, []);
    timer = setTimeout(noChannel, NO_CHANNEL_MS);
    try {
      await peer.accept(answer);
    } catch (error) {
      failed('This reply code could not be used: ' + messageOf(error) + ' Start again with a new code.');
    }
  }

  async function prepare() {
    const subtle = subtleOf();
    if (!peerAvailable() || !subtle) {
      const other = lines();
      dialog.show('unavailable', SENTENCES.noPeer, [exportRow(ctx, other.say), other.said]);
      return;
    }
    dialog.show('preparing', SENTENCES.preparing, []);
    let code;
    try {
      const project = ctx.store.project;
      const file = buildExport(project, 'project', { date: ctx.clock(), images: await ctx.storage.imagesForFile(project) });
      packed = await packTransfer(file.text, { projectId: project.id, subtle });
      if (closed) return;
      peer = createPeer({ onChannel, onTrouble: noChannel });
      code = await encodeSignal(await peer.offer(), { subtle });
    } catch (error) {
      if (!closed) failed('The project cannot be sent this way: ' + messageOf(error));
      return;
    }
    if (closed) return;
    const shown = codeShown(code, { kind: 'offer', label: 'The QR code to scan with the other device' });
    taken = codeTaken({ kind: 'answer', label: 'The reply code from the other device', button: 'Connect', connect: takeAnswer, say: talk.say });
    dialog.show('offer', SENTENCES.offer, [shown.element, h('p', { class: 'xfer__then' }, SENTENCES.answerWanted), taken.element, talk.said, talk.refused]);
    dialog.element.dataset.chunks = String(packed.header.chunks);
  }

  pasteAnywhere(dialog, () => dialog.element.dataset.state === 'offer' && !answered, (text) => {
    taken.field.value = text;
    takeAnswer(text);
  });
  prepare();
  return dialog;
}
