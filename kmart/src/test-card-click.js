'use strict';

/** Test: click a VISIBLE product link from /beauty/ -> does /product/ load? */
const { launchContext, shot } = require('./stealth');
const cfg = require('./config');

async function main() {
  const context = await launchContext({ freshProfile: true });
  const page = await context.newPage();
  await page.goto(cfg.homeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 4000));
  console.log('[c1] home ok');
  await page.goto('https://www.kmart.com.au/beauty/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 4000));

  // Scroll and find a product link with a real bounding box.
  let target = null, href = null;
  for (let i = 0; i < 10 && !target; i++) {
    const found = await page.evaluate(() => {
      for (const a of document.querySelectorAll('a[href*="/product/"]')) {
        const r = a.getBoundingClientRect();
        if (r.width > 50 && r.height > 50 && r.top > 0 && r.top < window.innerHeight - 50) {
          return a.href;
        }
      }
      return null;
    });
    if (found) { href = found; break; }
    await page.mouse.wheel(0, 800);
    await new Promise((r) => setTimeout(r, 900));
  }
  if (!href) { console.error('[c2] no visible product card found'); await context.close(); process.exit(1); }
  console.log('[c2] visible product card:', href);

  // Click it via a JS-located anchor (real trusted click at its center).
  const box = await page.evaluate((url) => {
    const a = Array.from(document.querySelectorAll('a[href*="/product/"]')).find((x) => x.href === url);
    if (!a) return null;
    const r = a.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, href);
  await page.mouse.move(box.x, box.y, { steps: 10 });
  await new Promise((r) => setTimeout(r, 400));
  await page.mouse.click(box.x, box.y);
  await new Promise((r) => setTimeout(r, 5000));

  const title = await page.title();
  const blocked = /access denied/i.test(await page.content());
  console.log(`[c3] RESULT: title="${title.slice(0, 60)}" blocked=${blocked} url=${page.url()}`);
  await shot(context, blocked ? 'c-blocked' : 'c-product-loaded');
  await context.close();
}

main().catch((e) => { console.error('[c] FATAL:', e); process.exit(1); });
