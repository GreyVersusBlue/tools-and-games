// Downloads the CC0 Quaternius source packs used by build.sh into $ART_SRC (default ~/.cache/throneshard-art) and
// unzips them. Uses a headless browser because itch.io serves free downloads through a short-lived signed flow.
//   node tools/blender/characters/fetch_sources.mjs
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
const OUT = process.env.ART_SRC || os.homedir() + '/.cache/throneshard-art';
const PACKS = [
  ['universal-base-characters', 'ubc'], ['universal-animation-library', 'ual1'], ['universal-animation-library-2', 'ual2'],
  ['modular-character-outfits-fantasy', 'mco'], ['bestiary-dungeon-monsters-kit', 'best'], ['lowpoly-medieval-weapons', 'wpn'],
];
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ acceptDownloads: true });
for (const [slug, dir] of PACKS) {
  if (fs.existsSync(`${OUT}/${dir}`)) { console.log('have', dir); continue; }
  const p = await ctx.newPage();
  await p.goto(`https://quaternius.itch.io/${slug}/purchase`);
  await p.waitForTimeout(1500);
  const nt = p.locator('a.direct_download_btn');
  if (await nt.count()) await nt.first().click();
  await p.waitForSelector('.upload a.download_btn', { timeout: 60000 });
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 600000 }), p.locator('.upload a.download_btn').first().click()]);
  const zip = `${OUT}/${dir}.zip`;
  await dl.saveAs(zip);
  fs.mkdirSync(`${OUT}/${dir}`, { recursive: true });
  execSync(`unzip -qo "${zip}" -d "${OUT}/${dir}"`);
  console.log('fetched', slug);
  await p.close();
}
await b.close();
