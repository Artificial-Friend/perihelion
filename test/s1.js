// Stage 1 walkthrough: title, found, base view, control room tabs, hangar.
module.exports = async (page, shot) => {
  await shot('title', 3000);
  await page.click('[data-act=new]');
  await page.fill('#coName', 'Meridian Orbital');
  await page.click('[data-act=found]');
  await shot('intro', 2500);
  await page.click('[data-act=close]');
  await page.evaluate(() => { P.debug.cam.snap(); });
  await shot('base', 4000);
  await page.click('[data-act=tab][data-v=recovery]');
  await shot('recovery', 1500);
  await page.click('[data-act=openhangar]');
  await shot('hangar', 4000);
  await page.click('[data-act=build][data-v=frame]');
  await shot('hangar-build', 2000);
  await page.click('[data-act=closehangar]');
  await page.evaluate(() => { P.debug.game.focus('earth'); P.debug.cam.snap(); });
  await shot('earth', 4000);
};
