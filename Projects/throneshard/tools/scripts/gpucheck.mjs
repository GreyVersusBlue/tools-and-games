import { chromium } from 'playwright';
const variants = [
  ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'],
  ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'],
  ['--use-gl=egl', '--ignore-gpu-blocklist', '--enable-gpu'],
];
for (const args of variants) {
  for (const channel of [undefined, 'chromium']) {
    try {
      const b = await chromium.launch({ args, channel, headless: true });
      const p = await b.newPage();
      const r = await p.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); if (!c) return 'no webgl2'; const e = c.getExtension('WEBGL_debug_renderer_info'); return c.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : c.RENDERER); });
      console.log(channel ?? 'shell', args.join(' '), '=>', r);
      await b.close();
    } catch (e) { console.log(channel ?? 'shell', args.join(' '), 'ERR', e.message.split('\n')[0]); }
  }
}
