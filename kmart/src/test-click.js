'use strict';

/** Test: click a real product link from the homepage (real referer) vs direct goto. */
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
  for (let i = 0; i < 40; i++) {
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

async function main() {
  const context = await launchContext({ freshProfile: true });
  const page = await context.newPage();
  await page.goto(cfg.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('[t] status after load:', await getAbckStatus(context));
  await humanize(page, context);
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = await getAbckStatus(context);
    console.log(`[t] +${(i + 1) * 2}s _abck:`, s);
    if (s === '0') break;
  }
  await new Promise((r) => setTimeout(r, 2000));

  // TEST A: click a real product link on the homepage.
  console.log('\n[TEST A] clicking a real product link from homepage...');
  // Scroll down until a product link becomes visible.
  let prodLink = page.locator('a[href*="/product/"]').first();
  let visible = false;
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, 600);
    await new Promise((r) => setTimeout(r, 800));
    for (let j = 0; j < 20; j++) {
      const cand = page.locator('a[href*="/product/"]').nth(j);
      if (await cand.isVisible({ timeout: 300 }).catch(() => false)) {
        prodLink = cand;
        visible = true;
        break;
      }
    }
    if (visible) break;
  }
  if (!visible) { console.error('[TEST A] no visible product link found'); await context.close(); process.exit(1); }
  const href = await prodLink.getAttribute('href');
  console.log('[TEST A] link:', href);
  await prodLink.hover();
  await new Promise((r) => setTimeout(r, 500));
  await prodLink.click();
  await new Promise((r) => setTimeout(r, 4000));
  const tA = await page.title();
  const bA = /access denied/i.test(await page.content());
  console.log(`[TEST A] result: title="${tA}" blocked=${bA} url=${page.url()}`);
  await shot(context, bA ? 'tA-blocked' : 'tA-product-via-click');

  // TEST B: from the (hopefully) loaded product page, goto the target product URL.
  if (!bA) {
    console.log('\n[TEST B] from product page, goto target product URL...');
    await page.goto(cfg.productUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 3000));
    const tB = await page.title();
    const bB = /access denied/i.test(await page.content());
    console.log(`[TEST B] result: title="${tB}" blocked=${bB} url=${page.url()}`);
    await shot(context, bB ? 'tB-blocked' : 'tB-target-product');
  }

  await context.close();
}

main().catch((e) => { console.error('[t] FATAL:', e); process.exit(1); });
