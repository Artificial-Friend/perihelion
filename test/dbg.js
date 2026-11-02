module.exports = async (page, shot) => {
  const errs = []; page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  const step = async (name, fn) => { const n = errs.length; await fn(); await page.waitForTimeout(2500); console.log(name, '->', errs.length - n, errs.slice(n, n + 2).join(' | ')); };
  const close = async () => { await page.waitForTimeout(900); await page.evaluate(() => document.querySelector('#modal').hidden = true); };
  await step('jump3', async () => { await page.click('[data-act=devjump][data-v="3"]'); await close(); });
  await step('sel', () => page.click('button.plan[data-act=sel3]'));
  await step('depart', () => page.click('button.plan[data-act=depart]'));
  await step('zoom', () => page.evaluate(() => { P.debug.cam.setDist(3e8); P.debug.cam.snap(); }));
  await step('title', () => page.click('[data-act=dev-title]'));
  await step('jump4', async () => { await page.click('[data-act=devjump][data-v="4"]'); await close(); });
  await step('claim', () => page.click('[data-act=claim]'));
  await step('snap', () => page.evaluate(() => P.debug.cam.snap()));
};
