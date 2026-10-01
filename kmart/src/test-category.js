'use strict';

/** Test: from a working category page, click a product link -> does /product/ load? */
const { launchContext, shot } = require('./stealth');
const cfg = require('./config');

async function getAbckStatus(context) {
  const cookies = await context.cookies('https://www.kmart.com.au');
  const abck = cookies.find((c) => c.name === '_abck');
  return abck ? (abck.value.split('~')[1] ?? 'NO-STATUS') : 'MISSING';
}

async function humanize(page, context, rounds = 40) {
  const vp = page.viewportSize();
  let x = vp.width / 2, y = vp.height / 2;
  for (let i = 0; i < rounds; i++) {
    const tx = 100 + Math.random() * (vp.width - 200);
    const ty = 100 + Math.random() * (vp.height - 200);
    const steps = 5 + Math.floor(Math.random() * 8);
    for (let s = 0; s < steps; s++) {
      x += (tx - x) / steps + (Math.random() - 0.5) * 8;
      y += (ty - y) / steps + (Math.random() - 0.5) * 8;
      await page.mouse.move(x, y, { steps: 2 });
      await new Promise((r) => setTimeout(r, 15 + Math.random() * 40));
    }
    if (i % 10 === 9) {
      await page.mouse.wheel(0, 200 + Math.random() * 300);
      await new Promise((r) => setTimeout(r, 300 + Math.random() * 400));
    }
  }
}

async function findVisibleProductLink(page, maxScrolls = 20) {
  for (let i = 0; i < maxScrolls; i++) {
    const links = page.locator('a[href*="/product/"]');
    const n = await links.count();
    for (let j = 0; j < Math.min(n, 30); j++) {
      const cand = links.nth(j);
      if (await cand.isVisible({ timeout: 200 }).catch(() => false)) return cand;
    }
    await page.mouse.wheel(0, 700);
    await new Promise((r) => setTimeout(r, 700));
  }
  return null;
}

async function main() {
  const context = await launchContext({ freshProfile: true });
  const page = await context.newPage();
  await page.goto(cfg.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await humanize(page, context);
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if ((await getAbckStatus(context)) === '0') break;
  }
  console.log('[cat] _abck:', await getAbckStatus(context));

  console.log('[cat] goto /beauty/ ...');
  await page.goto('https://www.kmart.com.au/beauty/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2000));
  console.log('[cat] beauty title:', await page.title());
  await humanize(page, context, 25);

  const link = await findVisibleProductLink(page);
  if (!link) { console.error('[cat] no visible product link on /beauty/'); await context.close(); process.exit(1); }
  const href = await link.getAttribute('href');
  console.log('[cat] clicking product link:', href);
  await link.hover();
  await new Promise((r) => setTimeout(r, 400));
  await link.click();
  await new Promise((r) => setTimeout(r, 4000));
  const title = await page.title();
  const blocked = /access denied/i.test(await page.content());
  console.log(`[cat] RESULT: title="${title.slice(0, 60)}" blocked=${blocked} url=${page.url()}`);
  await shot(context, blocked ? 'cat-blocked' : 'cat-product-loaded');

  await context.close();
}

main().catch((e) => { console.error('[cat] FATAL:', e); process.exit(1); });
