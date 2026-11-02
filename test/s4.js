module.exports = async (page, shot) => {
  const close = async () => { await page.waitForTimeout(900); await page.evaluate(() => document.querySelector('#modal').hidden = true); };
  await page.click('[data-act=devjump][data-v="4"]');
  await close();
  await page.click('[data-act=claim]');
  await page.evaluate(() => P.debug.cam.snap());
  await shot('s4-claimed', 3000);
  for (const [i, m] of [[0, 'hab'], [2, 'dock'], [4, 'pd']]) {
    await page.click(`[data-act=slot][data-v="${i}"]`);
    await page.click(`[data-act=buildmod][data-v=${m}]`);
    await shot('s4-b' + m, 1500);
    await page.click('[data-act=dev-timers]');
  }
  await page.click('[data-act=slot][data-v="6"]');
  await page.click('[data-act=buildmod][data-v=refinery]');
  await page.click('[data-act=dev-raid]');
  await shot('s4-station', 3000);
  await page.evaluate(() => { P.debug.cam.setDist(0.12); P.debug.cam.snap(); });
  await shot('s4-close', 3000);
};
