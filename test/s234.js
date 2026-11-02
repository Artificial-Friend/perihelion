// Stages 2-4 via the development stage selector.
module.exports = async (page, shot) => {
  const close = async () => { await page.waitForTimeout(900); await page.evaluate(() => document.querySelector('#modal').hidden = true); };
  // Stage 2
  await page.click('[data-act=devjump][data-v="2"]');
  await close();
  await page.evaluate(() => P.debug.cam.snap());
  await shot('s2-board', 4000);
  await page.click('[data-act=contract][data-v=pod]');
  await page.evaluate(() => P.debug.cam.snap());
  await shot('s2-plans', 4000);
  await page.click('button.plan[data-v=balanced]');
  await shot('s2-transfer', 3000);
  await page.click('[data-act=dev-hold]');
  await shot('s2-hold', 4000);
  await page.click('[data-act=grapple]');
  await shot('s2-debrief', 3500);
  await page.click('[data-act=done]');
  // Stage 3
  await page.click('[data-act=dev-title]');
  await page.click('[data-act=devjump][data-v="3"]');
  await close();
  await page.evaluate(() => P.debug.cam.snap());
  await shot('s3-docked', 4000);
  await page.click('button.plan[data-act=sel3]');
  await shot('s3-plans', 2500);
  await page.click('button.plan[data-act=depart]');
  await page.evaluate(() => { P.debug.cam.setDist(2e5); P.debug.cam.snap(); });
  await shot('s3-flight', 4000);
  await page.evaluate(() => { P.debug.cam.setDist(3e8); P.debug.cam.snap(); });
  await shot('s3-system', 4000);
  // Stage 4
  await page.click('[data-act=dev-title]');
  await page.click('[data-act=devjump][data-v="4"]');
  await close();
  await shot('s4-claim', 3000);
  await page.click('[data-act=claim]');
  await page.evaluate(() => P.debug.cam.snap());
  for (const [i, m] of [[0, 'hab'], [2, 'dock'], [4, 'pd']]) {
    await page.click(`[data-act=slot][data-v="${i}"]`);
    await page.click(`[data-act=buildmod][data-v=${m}]`);
    await page.click('[data-act=dev-timers]');
  }
  await page.click('[data-act=dev-raid]');
  await shot('s4-station', 4000);
};
