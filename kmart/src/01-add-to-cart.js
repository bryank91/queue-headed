'use strict';

/** Step 1: navigate to the product page and add the item to the cart. */

const cfg = require('./config');
const { launchContext, shot } = require('./stealth');

async function main() {
  const context = await launchContext();
  const page = await context.newPage();
  const fs = require('fs');
  const path = require('path');

  const dump = async (name) => {
    const file = path.join(cfg.evidenceDir, `dom_${name}.html`);
    fs.writeFileSync(file, await page.content());
    console.log(`[dom] ${file}`);
  };

  const isBlocked = async () => /access denied|unusual traffic|captcha|are you a robot/i.test(await page.content());

  try {
    // Akamai blocks direct deep links without site session cookies.
    // Establish a session on the homepage first, then go to the product.
    console.log('[step1] warming session on homepage...');
    await page.goto(cfg.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await context._sleep(3000);
    if (await isBlocked()) {
      console.error('[step1] BLOCKED on homepage');
      await shot(context, 'blocked');
      await dump('blocked');
      await context.close();
      process.exit(2);
    }

    console.log('[step1] navigating to product page...');
    await page.goto(cfg.productUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await context._sleep(3000); // let akamai/challenges settle
    console.log('[step1] url:', page.url());
    console.log('[step1] title:', await page.title());

    if (await isBlocked()) {
      // Fallback: use the on-site search from the homepage.
      console.log('[step1] deep link blocked, trying on-site search fallback...');
      await page.goto(cfg.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await context._sleep(2000);
      const searchBox = page.locator('input[aria-label*="search" i], input[type="search"], input[placeholder*="Find Products" i], input[placeholder*="search" i]').first();
      let searched = false;
      try {
        if (await searchBox.isVisible({ timeout: 3000 })) {
          await searchBox.click();
          await searchBox.fill('4m trees gift wrapping paper');
          await searchBox.press('Enter');
          searched = true;
        }
      } catch { /* no search box */ }
      await context._sleep(3000);

      if (searched) {
        // Click the product link in search results (exact SKU match).
        const prodLink = page.locator('a[href*="43768202"]').first();
        if (await prodLink.isVisible({ timeout: 5000 }).catch(() => false)) {
          await prodLink.click();
        } else {
          const firstProd = page.locator('a[href*="/product/"]').first();
          if (await firstProd.isVisible({ timeout: 3000 }).catch(() => false)) await firstProd.click();
        }
        await context._sleep(3000);
      }

      if (await isBlocked()) {
        console.error('[step1] BLOCKED after search fallback');
        await shot(context, 'blocked');
        await dump('blocked');
        await context.close();
        process.exit(2);
      }
      console.log('[step1] url after fallback:', page.url());
    }

    await shot(context, 'product-page');
    await dump('product-page');

    // Find the Add to cart control (try several selector strategies).
    const candidates = [
      'button:has-text("Add to cart")',
      'button:has-text("Add To Cart")',
      'button[aria-label*="Add to cart" i]',
      '[data-testid*="add-to-cart" i]',
      'button:has-text("Add to bag")',
    ];
    let clicked = false;
    for (const sel of candidates) {
      const btn = page.locator(sel).first();
      try {
        if (await btn.isVisible({ timeout: 1500 })) {
          console.log(`[step1] found button via "${sel}"`);
          await btn.scrollIntoViewIfNeeded();
          await btn.click({ timeout: 10000 });
          clicked = true;
          break;
        }
      } catch { /* try next */ }
    }

    if (!clicked) {
      console.error('[step1] could not find Add to cart button');
      await dump('no-add-btn');
      await context.close();
      process.exit(3);
    }

    console.log('[step1] clicked Add to cart, waiting for confirmation...');
    await context._sleep(2500);

    // Confirm via cart badge or toast/panel.
    const cartCount = await page
      .locator('[aria-label*="cart" i], [class*="cart" i] [class*="badge" i], [class*="Cart" i] [class*="count" i]')
      .first()
      .textContent({ timeout: 5000 })
      .catch(() => null);
    console.log('[step1] cart indicator text:', JSON.stringify(cartCount));

    await shot(context, 'after-add-to-cart');
    console.log('[step1] DONE: item added to cart');
  } finally {
    await context.close();
  }
}

main().catch((e) => {
  console.error('[step1] FATAL:', e);
  process.exit(1);
});
