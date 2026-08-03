// splice-social-block.mjs — insert the currently committed Tools/schedule-browser.html's
// gvb:social block into a freshly published file that has none.
//
//   node Tools/schedule/test/splice-social-block.mjs <fresh.html> [out.html]
//
// Why this exists: brBuildPublishedHTML() builds its own <head> from scratch and never
// generates a gvb:social block on its own (round 19). The block only gets into the committed
// copy through this script, or by hand. brPublish(), the live Publish button, always passes
// no socialBlock, so a fresh file downloaded straight from the generator has none — that is
// correct for a teacher's own copy, which has no canonical greyversusblue.com URL to claim.
//
// <fresh.html> is a file the live generator's Publish button already produced from the real
// blueprint and real schedule data. Neither exists in this repo (the real blueprint lives in
// whoever's browser localStorage last built it), so this script cannot regenerate that file
// itself and does not try to. It only carries the one piece that a full regeneration would
// otherwise silently drop: the gvb:social block, read from whatever
// Tools/schedule-browser.html currently has committed.
//
// Inserts the block between </title> and <style>, matching the order every committed page on
// the site already uses. Defaults to overwriting <fresh.html> in place if no output path is
// given. Does not touch Tools/schedule-browser.html and does not run sync-social-tags.mjs —
// both belong to prompt 22, not this one.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../../board-check/harness.mjs';

const START = '<!-- gvb:social:start';
const END = '<!-- gvb:social:end -->';

export function extractSocialBlock(html) {
  const s = html.indexOf(START);
  if (s === -1) throw new Error('no gvb:social:start marker found');
  const e = html.indexOf(END, s);
  if (e === -1) throw new Error('gvb:social:start with no matching gvb:social:end');
  return html.slice(s, e + END.length);
}

export function spliceSocialBlock(freshHtml, committedHtml) {
  const block = extractSocialBlock(committedHtml);
  if (freshHtml.includes(START)) {
    throw new Error('the fresh file already has a gvb:social block — did brPublish() change?');
  }
  const titleClose = freshHtml.indexOf('</title>');
  const styleOpen = freshHtml.indexOf('<style>');
  if (titleClose === -1 || styleOpen === -1 || styleOpen < titleClose) {
    throw new Error('expected </title> before <style> in the fresh file, found neither in that order');
  }
  const insertAt = titleClose + '</title>'.length;
  return freshHtml.slice(0, insertAt) + '\n' + block + freshHtml.slice(insertAt);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const freshPath = process.argv[2];
  if (!freshPath) {
    console.error('usage: node Tools/schedule/test/splice-social-block.mjs <fresh.html> [out.html]');
    process.exit(1);
  }
  const outPath = process.argv[3] || freshPath;
  const fresh = fs.readFileSync(freshPath, 'utf8');
  const committed = fs.readFileSync(path.join(SITE, 'Tools/schedule-browser.html'), 'utf8');
  const spliced = spliceSocialBlock(fresh, committed);
  fs.writeFileSync(outPath, spliced, 'utf8');
  console.log(`wrote ${path.relative(SITE, path.resolve(outPath))}, ${spliced.length} bytes (was ${fresh.length})`);
}
