// Field operations · reload mid-race and mid-flight: state comes back from storage.
module.exports = async (page, shot) => {
  const base = 'http://127.0.0.1:8766/';
  await page.goto(base + '#rec-mars-dev'); await page.waitForFunction(() => window.P && P.frames > 3);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.P && P.frames > 3);
  await page.click('#modal [data-act=close]');
  await page.click('[data-act=rec-send][data-v=safe]');
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => { const s = P.debug.ui.field.rec.s; return { ev: s.crews[0].ev, mode: s.crews[0].mode, credits: Math.round(s.credits) }; });
  await page.evaluate(() => P.debug.ui.field.persist(true));
  await page.reload(); await page.waitForFunction(() => window.P && P.frames > 3);
  const after = await page.evaluate(() => { const s = P.debug.ui.field.rec.s; return { ev: s.crews[0].ev, mode: s.crews[0].mode, credits: Math.round(s.credits), modal: !document.getElementById('modal').hidden }; });
  console.log('race before', JSON.stringify(before), 'after reload', JSON.stringify(after));
  if (after.ev !== before.ev || !['out', 'hold'].includes(after.mode) || after.modal) throw new Error('race state lost on reload');
  await shot('rec-reloaded', 1500);
  // Hopper: launch, reload mid-flight.
  await page.goto(base + '#hop-mars-dev'); await page.reload(); await page.waitForFunction(() => window.P && P.frames > 3);
  await page.click('#modal [data-act=close]');
  await page.click('.it.job [data-act=hop-accept]');
  await page.waitForTimeout(800);
  await page.click('[data-act=hop-launch]');
  await page.waitForTimeout(1500);
  await page.evaluate(() => P.debug.ui.field.persist(true));
  await page.reload(); await page.waitForFunction(() => window.P && P.frames > 3);
  const fl = await page.evaluate(() => { const f = P.debug.ui.field.hop.s.flight; return f && { to: f.to, phase: P.debug.ui.field.hop.where(P.debug.ui.field.now()).phase }; });
  console.log('flight after reload', JSON.stringify(fl));
  if (!fl) throw new Error('flight lost on reload');
  await shot('hop-reloaded', 1500);
  // Skip well past hand-off without watching: reload and the computer has landed it.
  await page.evaluate(() => { P.debug.ui.field.leaveSim(); });
  await page.evaluate(() => { P.debug.setClockSkew(900); });
  await page.evaluate(() => P.debug.ui.act('field-enter', 'hop:mars'));
  await page.waitForTimeout(1500);
  const done = await page.evaluate(() => { const s = P.debug.ui.field.hop.s; return { flight: !!s.flight, site: s.site, earned: s.earned }; });
  console.log('after a long absence', JSON.stringify(done));
  if (done.flight || !done.earned) throw new Error('away landing did not complete');
  await shot('hop-away-landed', 1500);
};
