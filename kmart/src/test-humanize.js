'use strict';

/** Test: does human-like interaction on the homepage make Akamai validate _abck? */
const { launchContext } = require('./stealth');

async function getAbckStatus(context) {
  const cookies = await context.cookies('https://www.kmart.com.au');
  const abck = cookies.find((c) => c.name === '_abck');
  if (!abck) return 'MISSING';
  return abck.value.split('~')[1] ?? 'NO-STATUS';
}

async function humanize(page, context) {
  const vp = page.viewportSize();
  // Wandering mouse: ~40 random-ish moves toward points of interest.
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
    // occasional scroll
    if (i % 12 === 11) {
      await page.mouse.wheel(0, 200 + Math.random() * 300);
      await new Promise((r) => setTimeout(r, 300 + Math.random() * 400));
    }
  }
  // Click a benign header element (search icon) and back.
  const icon = page.locator('[aria-label*="Search" i]').first();
  try {
    if (await icon.isVisible({ timeout: 2000 })) {
      await icon.hover();
      await new Promise((r) => setTimeout(r, 400));
      await icon.click();
      await new Promise((r) => setTimeout(r, 600));
      await page.keyboard.press('Escape');
    }
  } catch { /* ignore */ }
  // Scroll back to top
  await page.mouse.wheel(0, -3000);
  await context._sleep(500);
}

async function main() {
  const context = await launchContext({ freshProfile: true });
  const page = await context.newPage();
  await page.goto('https://www.kmart.com.au/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('[test] status after load:', await getAbckStatus(context));

  console.log('[test] humanizing for ~8s...');
  await humanize(page, context);

  for (const wait of [3, 5, 8]) {
    await new Promise((r) => setTimeout(r, wait * 1000));
    const status = await getAbckStatus(context);
    console.log(`[test] _abck status after +${wait}s:`, status);
    if (status === '0') break;
  }

  const fetchTest = await page.evaluate(async () => {
    try {
      const r = await fetch('/product/4m-trees-gift-wrapping-paper-43768202/', { credentials: 'include' });
      const text = await r.text();
      return { status: r.status, isAccessDenied: /access denied/i.test(text), len: text.length };
    } catch (e) { return { error: String(e) }; }
  });
  console.log('[test] in-page fetch of product URL:', JSON.stringify(fetchTest));

  await context.close();
}

main().catch((e) => { console.error('[test] FATAL:', e); process.exit(1); });
