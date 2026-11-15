// Field operations · Recovery race walkthrough (run with Q='?dev').
module.exports = async (page, shot) => {
  // Opened with #rec-<loc>-dev, straight into the mode.
  await shot('rec-intro', 2500);
  await page.click('#modal [data-act=close]');
  await shot('rec-start', 1500);
  // Send the crew to the teaching capsule from the panel.
  await page.click('[data-act=rec-send][data-v=safe]');
  await shot('rec-sent', 1500);
  for (let k = 0; k < 4; k++) await page.click('[data-act=field-skip][data-v="60"]');
  await shot('rec-waiting', 1500);
  for (let k = 0; k < 3; k++) await page.click('[data-act=field-skip][data-v="60"]');
  await shot('rec-after-impact', 1500);
  await page.click('[data-act=rec-tab][data-v=crews]');
  await shot('rec-crews', 1200);
  await page.click('[data-act=rec-tab][data-v=log]');
  await shot('rec-log', 1200);
  console.log('state', await page.evaluate(() => JSON.stringify({ c: P.debug.ui.field.rec.s.credits, claims: P.debug.ui.field.rec.s.claims, crew: P.debug.ui.field.rec.s.crews[0].mode })));
};
