// The sentences both sides of a sending say, kept in one place so the
// screens and the browser test read the same words.

import { count } from '../../components/words.js';

export const SENTENCES = {
  noPeer: 'This browser cannot connect straight to another device. Send the project file instead: Export the project under Project file, and open it on the other device with Import a project file.',
  preparing: 'Getting the project ready to send…',
  offer: 'On the other device, open Schedule Visualizer 2, go to Project, and choose Receive a project. Scan this code with it, or copy the code across.',
  answerWanted: 'Then the other device shows a reply code. Scan it here, or paste it.',
  connecting: 'Connecting to the other device…',
  waitOffer: 'On the sending device, choose Send this project. Scan its code here, or paste it.',
  replyShown: 'Show this reply to the sending device: scan it there, or copy it across. This device waits for the project.',
  sentAll: 'Every part is sent. Waiting for the other device to say whether it takes the project…',
  applied: 'Received and applied: the other device has replaced its project with this one.',
  notTaken: 'The other device did not take the project, so nothing was changed there. Its screen says why.',
  lostSending: 'The connection to the other device closed before it said whether it took the project. Look at the other device; if it has not taken it, send it again, or send the project file instead.',
  lostReceiving: 'The connection closed before the whole project arrived, so nothing was changed. Try sending it again, or ask for the project file instead.',
  checking: 'Every part has arrived. Checking it…',
  replacing: 'Replacing this project…',
  kept: 'You kept your project. Nothing was changed, and the other device has been told.',
  readOnly: 'This tab is read-only while the project is open in another tab, so it cannot take a project from another device. Close the other tab, or receive it there.',
  noChannelSending: 'No direct connection yet. Many school networks keep their devices from connecting to each other, and then this cannot work. If the other device is still connecting this may still go through, but you can send the project file instead: export it here, pass it on by mail, a shared drive or a USB stick, and open it there with Import a project file.',
  noChannelReceiving: 'No connection yet. If the sending device has taken this reply code, the network may be keeping the two devices apart, as many school networks do. Ask for the project file instead and open it with Import a project file under Project file. This device keeps waiting meanwhile.',
};

export function partsWords(done, total) {
  return done + ' of ' + count(total, 'part');
}
