module.exports = async (page, shot) => {
  const errs = []; page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  const step = async (name, fn) => { const n = errs.length; await fn(); await page.waitForTimeout(2500); console.log(name, '->', errs.length - n, errs.slice(n, n + 2).join(' | ')); };
  const close = async () => { await page.waitForTimeout(900); await page.evaluate(() => document.querySelector('#modal').hidden = true); };
  await step('jump2', async () => { await page.click('[data-act=devjump][data-v="2"]'); await close(); });
  await step('contract', () => page.click('[data-act=contract][data-v=pod]'));
  await step('plan', () => page.click('button.plan[data-v=balanced]'));
  await step('hold', () => page.click('[data-act=dev-hold]'));
  await step('grapple', () => page.click('[data-act=grapple]'));
  await step('done', () => page.click('[data-act=done]'));
  await step('title', () => page.click('[data-act=dev-title]'));
  await step('jump3', async () => { await page.click('[data-act=devjump][data-v="3"]'); await close(); });
  await step('jump4', async () => { await page.click('[data-act=dev-title]'); await page.click('[data-act=devjump][data-v="4"]'); await close(); });
};
