// Headless WebGPU (SwiftShader) screenshot runner.
// usage: node test/shots.js <outdir> <script.js>   — script exports async (page, shot) => {}
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = process.argv[2] || 'shots', script = require(path.resolve(process.argv[3]));
  require('fs').mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const page = await b.newPage({ viewport: { width: 1440, height: 860 } });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push(String(e)));
  page.setDefaultTimeout(240000);
  await page.goto('http://127.0.0.1:8766/' + (process.env.Q || ''));
  await page.waitForFunction(() => window.P && window.P.frames > 3, null, { timeout: 240000 });
  let n = 0;
  const shot = async (name, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: path.join(out, String(++n).padStart(2, '0') + '-' + name + '.png'), timeout: 240000 }); console.log('shot', name); };
  try { await script(page, shot); } catch (e) { console.log('SCRIPT ERROR', e.message); errs.push(e.message); }
  console.log('errors:', errs.length ? errs.slice(0, 12).join('\n') : 'none');
  await b.close();
})();
