// The receiving device (spec 13.5): the sending device's code is scanned or
// pasted, a reply code is shown for it, and the parts are put back together
// (engine/transfer.js). Once the whole project has arrived and its hash is
// right, it is read in full as a project file (engine/project-file.js) and
// the person is asked whether to replace their project with it, told what
// each holds. Replacing goes the way an import does (ui/project/files.js): a
// snapshot first when there is room ("Before receiving a project from another
// device"), a recovery point, then one undo step through replaceProject. The
// reply goes back either way, so the sending device can say what happened.
//
// dialog#transfer-receive carries data-state:
//   unavailable  no WebRTC in this browser
//   read-only    this tab is not the editing one
//   offer        the sending device's code is asked for
//   answering    the reply is being made
//   reply        the reply code is shown; waiting for the sending device.
//                After NO_CHANNEL_MS the dialog gains data-no-channel="true"
//                and the plain statement; it keeps waiting
//   receiving    parts arriving; data-parts="received/total". After STALL_MS
//                with nothing arriving on an open channel (here or in reply),
//                data-stalled="true" and the plain statement; it keeps waiting
//   checking     every part is in; the hash and the file are checked
//   confirm      "Replace my project" or "Keep my project"
//   read-only    this tab became the read-only one while the project came;
//                nothing is asked, and the sending device is told
//   replacing    the snapshot, the recovery point and the replacement
//   applied      replaced; the sending device has been told
//   kept         kept; the sending device has been told
//   lost         the connection closed before the project was whole
//   failed       the project did not arrive whole or could not be read. With
//                no reply to send (no header of this tool's to name the
//                sending), the connection is closed, so the sending device
//                ends too

import { h } from '../../components/dom.js';
import { figures } from '../../components/words.js';
import { createReceiver, decodeSignal, encodeSignal, ackMessage, TRANSFER_FORMAT } from '../../../engine/transfer.js';
import { readProjectFile } from '../../../engine/project-file.js';
import { replaceProject } from '../../../engine/actions.js';
import { CURRENT_VERSION } from '../../../engine/schema.js';
import { takeAutoSnapshot, snapshotRoom } from '../../../storage/snapshots.js';
import { holdsWords, importSafetyLine } from '../files.js';
import { transferDialog } from './dialog.js';
import { createPeer, peerAvailable, stallClock, NO_CHANNEL_MS, STALL_MS } from './peer.js';
import { codeShown, codeTaken } from './codes.js';
import { lines, progressLine, importRow, pasteAnywhere, subtleOf, messageOf, unavailableSentence, alternative } from './common.js';
import { SENTENCES } from './words.js';

export const SNAPSHOT_NAME = 'Before receiving a project from another device';
export const UNDO_LABEL = 'Receive a project from another device';

// The header's hash, read from the header frame here too, so a reply can
// name the sending it is about even when the receiver refused before the end.
function headerHash(message) {
  if (typeof message !== 'string') return null;
  try {
    const value = JSON.parse(message);
    return value && value.format === TRANSFER_FORMAT && typeof value.sha256 === 'string' ? value.sha256 : null;
  } catch {
    return null;
  }
}

function readOnly(ctx) {
  return Boolean(ctx.storage && ctx.storage.state && ctx.storage.state.readOnly);
}

export function openReceive(ctx, opener) {
  let peer = null;
  let taken = null;
  let channel = null;
  let timer = null;
  let stall = null;
  let closed = false;
  let offered = false;
  // the sending this reply will be about, once the header has come
  let digest = null;
  // whether the reply has gone, or there is no channel left to send it on
  let replied = false;
  const dialog = transferDialog({
    id: 'transfer-receive',
    title: 'Receive a project from another device',
    opener,
    onClose() {
      closed = true;
      clearTimeout(timer);
      if (stall) stall.stop();
      if (taken) taken.stop();
      // closing while the question is asked is keeping this project; the
      // reply is let go before the connection is
      if (dialog.element.dataset.state === 'confirm' && reply(false)) {
        if (peer) peer.closeAfter();
      } else if (peer) {
        peer.close();
      }
    },
  });
  const talk = lines();

  function reply(applied) {
    if (replied || !channel || !digest) return false;
    replied = true;
    try {
      if (channel.readyState !== 'open') return false;
      channel.send(ackMessage(digest, applied));
      return true;
    } catch {
      return false;
    }
  }

  function failed(sentence) {
    clearTimeout(timer);
    if (stall) stall.stop();
    // with no reply to send, the closed connection is what tells the
    // sending device; otherwise it ends the run once the reply is in
    if (!reply(false) && peer) peer.close();
    dialog.show('failed', sentence, [importRow(dialog)]);
  }

  function noChannel() {
    if (closed || dialog.element.dataset.state !== 'reply' || dialog.element.dataset.noChannel === 'true') return;
    dialog.element.dataset.noChannel = 'true';
    dialog.body.append(alternative('no-channel', SENTENCES.noChannelReceiving, importRow(dialog)));
  }

  function stalled() {
    const state = dialog.element.dataset.state;
    if (closed || (state !== 'reply' && state !== 'receiving') || dialog.element.dataset.stalled === 'true') return;
    dialog.element.dataset.stalled = 'true';
    dialog.body.append(alternative('stalled', SENTENCES.stalledReceiving, importRow(dialog)));
  }

  async function replace(read, room) {
    dialog.show('replacing', SENTENCES.replacing, []);
    if (readOnly(ctx)) {
      failed(SENTENCES.readOnly);
      return;
    }
    if (room && !room.error && !room.full) {
      const snapshot = await takeAutoSnapshot('import', SNAPSHOT_NAME);
      if (!snapshot.ok) {
        failed('The project was not received, and nothing has changed, because the snapshot could not be taken first. ' + snapshot.text);
        return;
      }
    }
    const before = ctx.store.project;
    try {
      try {
        await ctx.storage.takeRecoveryPoint('import');
      } catch { /* storage has said so itself; the replacement is still one undo step */ }
      await ctx.storage.keepFileImages(read.project, read.images);
      ctx.store.apply(replaceProject, { project: read.project, label: UNDO_LABEL });
    } catch (error) {
      failed('The project was not received, and nothing has changed. ' + messageOf(error));
      return;
    }
    if (ctx.store.project === before) {
      failed('The project was not received, and nothing has changed.');
      return;
    }
    const told = reply(true);
    const notes = read.notes.slice();
    if (read.migratedFrom < CURRENT_VERSION) notes.unshift('It was saved in an older format and has been brought up to date.');
    dialog.show('applied',
      'Received and applied: ' + holdsWords(read.summary) + ' are here now. Undo brings back the project that was here.'
        + (told ? '' : ' The sending device had gone, so it could not be told.'),
      notes.length > 0 ? [h('ul', null, notes.map((note) => h('li', null, note)))] : []);
    ctx.toast({ text: 'Received a project from another device.', action: { label: 'Undo', run: ctx.undo } });
  }

  async function ask(text) {
    let read;
    try {
      read = readProjectFile(text, { ids: ctx.ids, clock: ctx.clock });
    } catch (error) {
      failed('The project arrived whole but cannot be read, so nothing was changed. ' + messageOf(error));
      return;
    }
    if (closed) return;
    const here = figures(ctx.store.project);
    const room = await snapshotRoom();
    if (closed) return;
    if (readOnly(ctx)) {
      // another tab became the editing one while the project came
      reply(false);
      dialog.show('read-only', SENTENCES.readOnly, []);
      return;
    }
    const school = read.project.settings.schoolName;
    const replaceButton = h('button', { type: 'button', class: 'btn btn--danger', data: { action: 'replace-project' } }, 'Replace my project');
    const keepButton = h('button', { type: 'button', class: 'btn', data: { action: 'keep-project' } }, 'Keep my project');
    replaceButton.addEventListener('click', () => replace(read, room));
    keepButton.addEventListener('click', () => {
      const told = reply(false);
      dialog.show('kept', told ? SENTENCES.kept : 'You kept your project. Nothing was changed.', []);
    });
    dialog.show('confirm', 'The whole project has arrived and checks out. Replace your project with it?', [
      // the name in a bdi of its own, so its script and any direction marks
      // in it stay inside it (as Snapshots names do)
      h('p', { data: { line: 'arrived' } }, ...(school === '' ? ['It has no school name'] : ['It is ', h('bdi', null, school)]), '. It holds ' + holdsWords(read.summary) + '.'),
      h('p', { data: { line: 'here' } }, 'It takes the place of everything in this project: ' + holdsWords({ ...here, images: 0 }) + '.'),
      h('p', { data: { line: 'safety' } }, importSafetyLine(room, SNAPSHOT_NAME, 'it')),
      h('div', { class: 'card__buttons xfer__ask' }, replaceButton, keepButton),
    ], keepButton);
  }

  function onChannel(open) {
    if (closed) return;
    channel = open;
    clearTimeout(timer);
    delete dialog.element.dataset.noChannel;
    const statement = dialog.body.querySelector('[data-alternative="no-channel"]');
    if (statement) statement.remove();
    const receiver = createReceiver({ subtle: subtleOf() });
    const progress = progressLine(dialog, 'Received');
    let finishing = false;
    stall = stallClock(STALL_MS, stalled);
    channel.addEventListener('close', () => {
      replied = true;
      stall.stop();
      const state = dialog.element.dataset.state;
      if (!closed && (state === 'reply' || state === 'receiving')) dialog.show('lost', SENTENCES.lostReceiving, [importRow(dialog)]);
    });
    channel.addEventListener('message', async (event) => {
      if (finishing || closed) return;
      stall.poke();
      if (dialog.element.dataset.stalled === 'true') {
        delete dialog.element.dataset.stalled;
        const said = dialog.body.querySelector('[data-alternative="stalled"]');
        if (said) said.remove();
      }
      if (!digest) digest = headerHash(event.data);
      let state;
      try {
        state = receiver.accept(event.data);
      } catch (error) {
        finishing = true;
        failed(messageOf(error));
        return;
      }
      if (state.total !== null) {
        if (dialog.element.dataset.state !== 'receiving') dialog.show('receiving', 'Connected. The project is arriving…', [progress.element]);
        progress.set(state.received, state.total);
      }
      if (!state.ended) return;
      finishing = true;
      stall.stop();
      dialog.show('checking', SENTENCES.checking, []);
      let out;
      try {
        out = await receiver.finish();
      } catch (error) {
        failed(messageOf(error));
        return;
      }
      if (!closed) ask(out.text);
    });
  }

  async function takeOffer(text) {
    if (offered || closed) return;
    const subtle = subtleOf();
    let offer;
    try {
      offer = await decodeSignal(text, { subtle, expect: 'offer' });
    } catch (error) {
      talk.refuse(messageOf(error));
      return;
    }
    if (offered || closed) return;
    offered = true;
    taken.stop();
    dialog.show('answering', 'Making the reply code…', []);
    let code;
    try {
      peer = createPeer({ onChannel, onTrouble: noChannel });
      code = await encodeSignal(await peer.answer(offer), { subtle });
    } catch (error) {
      if (!closed) failed('No reply code could be made for this code: ' + messageOf(error) + ' Start again on the sending device.');
      return;
    }
    if (closed) return;
    // the channel may have opened while the code was being made
    if (dialog.element.dataset.state !== 'answering') return;
    const shown = codeShown(code, { kind: 'answer', label: 'The reply QR code to scan with the sending device' });
    dialog.show('reply', SENTENCES.replyShown, [shown.element]);
    timer = setTimeout(noChannel, NO_CHANNEL_MS);
  }

  function start() {
    if (!peerAvailable() || !subtleOf()) {
      dialog.show('unavailable', unavailableSentence(), [importRow(dialog)]);
      return;
    }
    if (readOnly(ctx)) {
      dialog.show('read-only', SENTENCES.readOnly, []);
      return;
    }
    taken = codeTaken({ kind: 'offer', label: 'The code from the sending device', button: 'Connect', connect: takeOffer, say: talk.say });
    dialog.show('offer', SENTENCES.waitOffer, [taken.element, talk.said, talk.refused]);
  }

  pasteAnywhere(dialog, () => dialog.element.dataset.state === 'offer' && !offered, (text) => {
    taken.field.value = text;
    takeOffer(text);
  });
  start();
  return dialog;
}
