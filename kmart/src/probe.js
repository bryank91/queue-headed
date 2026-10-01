'use strict';

/** Probe: which paths are allowed under a verified (_abck=0) session? */
const { launchContext } = require('./stealth');
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

async function probe(page, url, { referer } = {}) {
  if (referer) await page.setExtraHTTPHeaders({ Referer: referer });
  else await page.setExtraHTTPHeaders({});
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 1500));
  const title = await page.title();
  const blocked = /access denied/i.test(await page.content());
  console.log(`[probe] ${resp ? resp.status() : '?'} ${url} -> title="${title.slice(0, 50)}" blocked=${blocked}`);
  await page.setExtraHTTPHeaders({});
  return { status: resp ? resp.status() : null, blocked, title };
}

async function main() {
  const context = await launchContext({ freshProfile: true });
  const page = await context.newPage();
  await page.goto(cfg.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await humanize(page, context);
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = await getAbckStatus(context);
    if (s === '0') break;
  }
  console.log('[probe] _abck:', await getAbckStatus(context));
  await new Promise((r) => setTimeout(r, 2000));

  await probe(page, 'https://www.kmart.com.au/beauty/');
  await probe(page, 'https://www.kmart.com.au/product/28-pack-polymer-clay-43342051/');
  await probe(page, 'https://www.kmart.com.au/product/28-pack-polymer-clay-43342051/', { referer: 'https://www.kmart.com.au/' });
  await probe(page, 'https://www.kmart.com.au/search/?q=gift%20wrapping%20paper', { referer: 'https://www.kmart.com.au/' });
  await probe(page, 'https://www.kmart.com.au/cart', { referer: 'https://www.kmart.com.au/' });

  await context.close();
}

main().catch((e) => { console.error('[probe] FATAL:', e); process.exit(1); });
