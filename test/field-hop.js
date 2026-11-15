// Field operations · Hopper courier walkthrough (run with Q='#hop-<loc>-dev').
// The landing is flown with real key presses from a simple feedback loop reading the instruments.
module.exports = async (page, shot) => {
  await shot('hop-intro', 2500);
  await page.click('#modal [data-act=close]');
  await shot('hop-start', 1500);
  await page.click('.it.job [data-act=hop-accept]');
  await shot('hop-plan', 2500);
  await page.click('[data-act=hop-launch]');
  await shot('hop-climb', 2000);
  await page.click('[data-act=field-skip][data-v="60"]');
  await shot('hop-coast', 1500);
  // Skip to just before hand-off.
  const left = await page.evaluate(() => { const f = P.debug.ui.field.hop.s.flight; return f.tHandoff - P.debug.ui.field.now(); });
  for (let k = 0; k < Math.floor((left - 4) / 30); k++) await page.click('[data-act=field-skip][data-v="30"]');
  await page.waitForFunction(() => !!P.debug.ui.field.hop.liveLanding(), null, { timeout: 60000 });
  await shot('hop-handoff', 300);
  const held = new Set();
  const hold = async (k, on) => { if (on && !held.has(k)) { await page.keyboard.down(k); held.add(k); } else if (!on && held.has(k)) { await page.keyboard.up(k); held.delete(k); } };
  let shotTaken = false;
  for (let i = 0; i < 1200; i++) {
    const st = await page.evaluate(() => { const h = P.debug.ui.field.hop, s = h.liveLanding(); if (!s) return null; const sp = h.spec(), g = h.body().g; return { ...s, net: sp.thrust / (s.mass + s.prop) - g, g, T: sp.thrust, m: s.mass + s.prop }; });
    if (!st || st.done) break;
    const vzRef = -Math.max(1.2, Math.sqrt(2 * 0.45 * st.net * Math.max(0, st.z - 8)));
    const need = (st.g + (vzRef - st.vz) * 1.5) * st.m / st.T;
    await hold('w', st.thr < need - 0.05); await hold('s', st.thr > need + 0.05);
    const lim = Math.min(20, 0.2 * st.z + 0.3), vxRef = Math.max(-lim, Math.min(lim, -0.1 * st.x));
    const want = st.z < 4 ? 0 : (vxRef - st.vx) * 0.25;
    await hold('d', want > 0.08 + st.ang); await hold('a', want < -0.08 + st.ang);
    if (!shotTaken && st.z < 400) { shotTaken = true; await shot('hop-landing', 0); }
    await page.waitForTimeout(40);
  }
  for (const k of [...held]) await hold(k, false);
  await shot('hop-result', 1200);
  console.log('landing', await page.evaluate(() => JSON.stringify(P.debug.ui.field.hopView.lastResultCache && { kind: P.debug.ui.field.hopView.lastResultCache.d.kind, vz: P.debug.ui.field.hopView.lastResultCache.d.vz.toFixed(2), x: P.debug.ui.field.hopView.lastResultCache.d.x.toFixed(1), earned: P.debug.ui.field.hopView.lastResultCache.earned })));
  await page.click('[data-act=hop-result]');
  await shot('hop-after', 1500);
  await page.click('[data-act=hop-tab][data-v=hopper]');
  await shot('hop-hopper-tab', 1200);
};
