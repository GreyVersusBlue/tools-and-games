// The staff browser's entry. It finds the schedule (inside the page, from the
// planner's preview, or nowhere) and hands it to the shell. As a published
// file this module is the last one in the page's single script; served from
// the tool's folder it is loaded as a module with the others beside it. It is
// the same code both ways.

import { inlineData, isFramed, watchPreview, siblingData, readPublished } from './source.js';
import { mountShell } from './shell.js';

const root = document.getElementById('app');
const shell = mountShell(root, { win: window, doc: document });

const inline = inlineData(document);
if (inline.found) {
  if (inline.broken) shell.damaged();
  else await shell.show(inline.value);
} else if (isFramed(window)) {
  shell.waiting('Waiting for the planner…');
  watchPreview(window, (data) => {
    shell.show(data);
  });
} else {
  const beside = await siblingData();
  if (beside.found && readPublished(beside.value).kind !== 'damaged') await shell.show(beside.value);
  else shell.nothing();
}
document.documentElement.dataset.ready = 'true';
