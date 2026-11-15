// Field operations at phone width (390 × 844): title, both modes, the landing with touch controls.
module.exports = async (page, shot) => {
  const base = 'http://127.0.0.1:8766/field.html';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForFunction(() => window.P && P.frames > 3);
  await shot('phone-title', 800);
  await page.goto(base + '#rec-earth-dev'); await page.reload(); await page.waitForFunction(() => window.P && P.frames > 3);
  await shot('phone-rec-intro', 800);
  await page.click('#modal [data-act=close]');
  await shot('phone-rec', 800);
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  console.log('page width', w);
  await page.goto(base + '#hop-mars-dev'); await page.reload(); await page.waitForFunction(() => window.P && P.frames > 3);
  await page.click('#modal [data-act=close]');
  await page.click('.it.job [data-act=hop-accept]');
  await shot('phone-hop-plan', 1000);
  await page.click('[data-act=hop-launch]');
  const left = await page.evaluate(() => P.debug.ui.field.hop.s.flight.tHandoff - P.debug.ui.field.now());
  await page.evaluate(s => P.debug.ui.field.act('field-skip', String(Math.ceil(s) + 1)), left); // the dev tray is hidden on phones
  await page.waitForFunction(() => !!P.debug.ui.field.hop.liveLanding(), null, { timeout: 60000 });
  await shot('phone-landing', 600);
  const tb = await page.locator('.ltouch').isVisible();
  console.log('touch controls visible:', tb);
};
