// Field operations · real mouse input: map clicks, pad picking, slider drags, drag-pan vs click.
module.exports = async (page, shot) => {
  const base = 'http://127.0.0.1:8766/' + (process.env.PAGE || '');
  const fail = m => { throw new Error(m); };
  // ---- Recovery: choose a side by clicking the map beside the hazard area.
  await page.goto(base + '#rec-mars-dev'); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForFunction(() => window.P && P.frames > 3);
  await page.click('#modal [data-act=close]');
  const pt = await page.evaluate(() => {
    const f = P.debug.ui.field, R = f.rec, e = R.s.tut, t = f.now(), pr = R.pred(e, t), v = f.view;
    const side = { x: pr.c.x - Math.sin(e.heading) * (pr.b + 1.5), y: pr.c.y + Math.cos(e.heading) * (pr.b + 1.5) };
    const q = v.toScr(side); return { x: q.x, y: q.y };
  });
  await page.mouse.move(pt.x, pt.y); await page.waitForTimeout(300);
  await shot('mouse-rec-hover', 300);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(400);
  const sent = await page.evaluate(() => { const c = P.debug.ui.field.rec.s.crews[0]; return { ev: c.ev, mode: c.mode, aim: c.aim }; });
  console.log('map click sent the crew:', JSON.stringify(sent));
  if (!sent.ev || sent.aim === null) fail('clicking beside the hazard area did not send the crew');
  // Drag-pan must move the map and not count as a click.
  const before = await page.evaluate(() => ({ cx: P.debug.ui.field.view.cx, aim: P.debug.ui.field.rec.s.crews[0].aim, sel: P.debug.ui.field.recView.sel }));
  await page.mouse.move(400, 400); await page.mouse.down(); await page.mouse.move(470, 430, { steps: 8 }); await page.mouse.up();
  await page.mouse.move(500, 300); await page.mouse.wheel(0, -400); await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ cx: P.debug.ui.field.view.cx, zoom: P.debug.ui.field.view.zoom, aim: P.debug.ui.field.rec.s.crews[0].aim, sel: P.debug.ui.field.recView.sel }));
  console.log('drag and wheel:', JSON.stringify(before), '→', JSON.stringify(after));
  if (after.zoom <= 1) fail('wheel did not zoom');
  if (after.aim !== before.aim || after.sel !== before.sel) fail('a drag was taken as a click');
  await shot('mouse-rec-zoomed', 600);
  // ---- Hopper: pick a pad on the map, drag both sliders, launch with those values.
  await page.goto(base + '#hop-mars-dev'); await page.reload(); await page.waitForFunction(() => window.P && P.frames > 3);
  await page.click('#modal [data-act=close]');
  await page.click('.it.job [data-act=hop-accept]'); await page.waitForTimeout(500);
  const bel = await page.evaluate(() => { const f = P.debug.ui.field, s = f.hop.W.site('bel'), q = f.view.toScr(s.p); return { x: q.x, y: q.y }; });
  await page.mouse.click(bel.x, bel.y); await page.waitForTimeout(800);
  const dest = await page.evaluate(() => P.debug.ui.field.hopView.dest);
  console.log('clicked pad →', dest);
  if (dest !== 'bel') fail('clicking a pad did not select it');
  const sl = async (name, frac) => { const b = await page.locator(`input[data-in=${name}]`).boundingBox(); await page.mouse.click(b.x + b.width * frac, b.y + b.height / 2); await page.waitForTimeout(500); };
  await sl('gamma', 0.75); await sl('prop', 0.95);
  const want = await page.evaluate(() => ({ g: P.debug.ui.field.hopView.gamma, p: P.debug.ui.field.hopView.prop, plan: P.debug.ui.field.hopView.plan && Math.round(P.debug.ui.field.hopView.plan.gamma) }));
  await shot('mouse-hop-plan', 600);
  await page.click('[data-act=hop-launch]'); await page.waitForTimeout(600);
  const fl = await page.evaluate(() => { const f = P.debug.ui.field.hop.s.flight; return f && { to: f.to, gamma: Math.round(f.gamma * 180 / Math.PI), load: Math.round(f.propLoad) }; });
  console.log('sliders', JSON.stringify(want), '→ flight', JSON.stringify(fl));
  if (!fl || fl.to !== 'bel') fail('launch did not go to the picked pad');
  if (Math.abs(fl.gamma - want.g) > 1) fail('launch angle from the slider was not used');
  if (Math.abs(fl.load - want.p) > 60) fail('propellant load from the slider was not used');
  await shot('mouse-hop-flying', 1000);
};
