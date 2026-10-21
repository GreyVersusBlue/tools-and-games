// The Send to another device card (spec 13.5, DESIGN 5.7, ARCHITECTURE 15):
// the whole project straight from one device to another, with no server and
// no file. One device shows a code, as a QR code and as text; the other scans
// it with its camera or pastes it, and the reverse for the reply. Then the
// project goes over a direct WebRTC data channel.
//
//   send.js      the sending device's dialog
//   receive.js   the receiving device's dialog
//   peer.js      the connection: no ICE servers, back-pressure
//   codes.js     the codes on screen: the QR code, copy, paste, the camera
//   dialog.js    the dialog both run in
//   common.js    what the two share
//   words.js     their sentences
//
// The envelope, the hash, the reply and the codes are engine/transfer.js's;
// the QR code is vendor/qr-encode's and vendor/qr-decode's.

import { h } from '../../components/dom.js';
import { card } from '../../components/card.js';
import { openSend } from './send.js';
import { openReceive } from './receive.js';

// The card's own stylesheet; index.html may link it (data-sheet="transfer").
const SHEET = new URL('./transfer.css', import.meta.url).href;
function loadSheet() {
  if (document.querySelector('link[data-sheet="transfer"]')) return;
  document.head.append(h('link', { rel: 'stylesheet', href: SHEET, data: { sheet: 'transfer' } }));
}

export function transferCard(ctx) {
  loadSheet();
  const send = h('button', { type: 'button', class: 'btn', data: { action: 'send-project' } }, 'Send this project…');
  const receive = h('button', { type: 'button', class: 'btn', data: { action: 'receive-project' } }, 'Receive a project…');
  send.addEventListener('click', () => openSend(ctx, send));
  receive.addEventListener('click', () => openReceive(ctx, receive));
  const element = card({ id: 'transfer', title: 'Send to another device' },
    h('p', { class: 'card__lead' }, 'Pass the whole project straight to a colleague’s device, with no file and nothing kept anywhere else on the way. One device shows a code; the other scans it with its camera or pastes it, and then the same the other way round.'),
    h('div', { class: 'card__buttons' }, send, receive),
    h('p', { class: 'card__small' }, 'Both devices must be on a network that lets them reach each other, and many school networks do not. Then the project file above is the way. The receiving device asks before anything is replaced. The camera is on only while you scan a code.'),
  );
  return { element, update() {} };
}
