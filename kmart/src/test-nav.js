'use strict';

/** Test: wait for _abck=0, then real navigation to product URL. */
const { launchContext, shot } = require('./stealth');
const cfg = require('./config');

async function getAbckStatus(context) {
  const cookies = await context.cookies('https://www.kmart.com.au');
  const abck = cookies.find((c) => c.name === '_abck');
  return abck ? (abck.value.split('~')[1] ?? 'NO-STATUS') : 'MISSING';
}

async function humanize(page, context) {
  const vp = page.viewportSize();
  let x = vp.width / 2, y = vp.height / 2;
  for (let i = 0; i < 60; i++) {
    const tx = 100 + Math.random() * (vp.width - 200);
    const ty = 100 + Math.random() * (vp.height - 200);
    const steps = 5 + Math.floor(Math.random() * 8);
    for (let s = 0; s < steps; s++) {
      x += (tx - x) / steps + (Math.random() - 0.5) * 8;
      y += (ty - y) / steps + (Math.random() - 0.5) * 8;
      await page.mouse.move(x, y, { steps: 2 });
      await new Promise((r) => setTimeout(r, 15 + Math.random() * 40));
    }
    if (i % 12 === 11) {
      await page.mouse.wheel(0, 200 + Math.random() * 300);
      await new Promise((r) => setTimeout(r, 300 + Math.random() * 400));
    }
  }
  await page.mouse.wheel(0, -3000);
}

async function main() {
  const context = await launchContext({ freshProfile: true });
  const page = await context.newPage();
  await page.goto(cfg.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('[t] status after load:', await getAbckStatus(context));

  await humanize(page, context);

  let status;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    status = await getAbckStatus(context);
    console.log(`[t] +${(i + 1) * 2}s _abck:`, status);
    if (status === '0') break;
  }

  if (status === '0') {
    await new Promise((r) => setTimeout(r, 3000)); // let edge catch up
    console.log('[t] navigating to product page...');
    await page.goto(cfg.productUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 3000));
    const title = await page.title();
    const blocked = /access denied/i.test(await page.content());
    console.log('[t] product title:', title);
    console.log('[t] blocked:', blocked);
    await shot(context, blocked ? 't-blocked' : 't-product');
  }

  await context.close();
}

main().catch((e) => { console.error('[t] FATAL:', e); process.exit(1); });
