'use strict';

/** Click a product tile on /beauty/ and capture every network request + result. */
const { launchContext } = require('./stealth');
const cfg = require('./config');

async function main() {
  const context = await launchContext({ freshProfile: true });
  const page = await context.newPage();

  const reqs = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('kmart.com.au') && !/\.(js|css|png|jpg|jpeg|webp|svg|woff2?|ico|mp4)/i.test(u)) {
      reqs.push({ method: r.method(), url: u.replace('https://www.kmart.com.au', ''), ref: (r.headers()['referer'] || '').replace('https://www.kmart.com.au', '') });
    }
  });
  page.on('response', async (res) => {
    const u = res.url();
    if (u.includes('kmart.com.au') && !/\.(js|css|png|jpg|jpeg|webp|svg|woff2?|ico|mp4)/i.test(u)) {
      reqs.push({ status: res.status(), url: u.replace('https://www.kmart.com.au', '') });
    }
  });

  await page.goto(cfg.homeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 4000));
  reqs.length = 0; // reset after warm

  await page.goto('https://www.kmart.com.au/beauty/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 4000));
  reqs.length = 0; // reset before click

  // Find a visible product tile and click its center.
  let box = null, href = null;
  for (let i = 0; i < 12 && !box; i++) {
    const r = await page.evaluate(() => {
      for (const a of document.querySelectorAll('[data-testid="product-tile"], a[href*="/product/"]')) {
        const b = a.getBoundingClientRect();
        if (b.width > 40 && b.height > 40 && b.top > 0 && b.top < window.innerHeight - 40) {
          return { x: b.x + b.width / 2, y: b.y + b.height / 2, href: a.getAttribute('href') };
        }
      }
      return null;
    });
    if (r) { box = { x: r.x, y: r.y }; href = r.href; break; }
    await page.mouse.wheel(0, 700);
    await new Promise((r) => setTimeout(r, 800));
  }
  if (!box) { console.error('[n] no visible tile'); await context.close(); process.exit(1); }
  console.log('[n] clicking tile:', href);
  await page.mouse.move(box.x, box.y, { steps: 12 });
  await new Promise((r) => setTimeout(r, 500));
  await page.mouse.click(box.x, box.y);
  await new Promise((r) => setTimeout(r, 6000));

  console.log('\n[n] network requests after click:');
  for (const q of reqs.slice(0, 40)) console.log('   ', JSON.stringify(q));
  const title = await page.title();
  const blocked = /access denied/i.test(await page.content());
  console.log(`\n[n] FINAL: title="${title.slice(0, 60)}" blocked=${blocked} url=${page.url()}`);
  await context.close();
}

main().catch((e) => { console.error('[n] FATAL:', e); process.exit(1); });
