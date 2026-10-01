'use strict';

/** Step 2: cart -> guest checkout (dummy AU address) -> stop at payment section. */

const cfg = require('./config');
const { launchContext, shot } = require('./stealth');

const A = cfg.address;

async function clickByText(page, patterns, { timeout = 8000 } = {}) {
  for (const re of patterns) {
    const loc = page.locator('button, a, [role="button"], input[type="radio"]+label, [role="radio"]', { hasText: re }).first();
    try {
      if (await loc.isVisible({ timeout })) {
        await loc.click({ timeout: 5000 });
        console.log(`[step2] clicked: ${re}`);
        return true;
      }
    } catch { /* next */ }
  }
  return false;
}

async function fillIfVisible(page, selector, value, label) {
  const el = page.locator(selector).first();
  try {
    if (await el.isVisible({ timeout: 2000 })) {
      await el.click();
      await el.fill(value);
      console.log(`[step2] filled ${label}: ${value}`);
      return true;
    }
  } catch { /* not visible */ }
  return false;
}

async function fillAddress(page, context) {
  // Generic strategy: find inputs by label/placeholder/name patterns and fill.
  const specs = [
    { label: 'first name', value: A.firstName, match: /(first|given)\s*name/i },
    { label: 'last name', value: A.lastName, match: /(last|family|surname)\s*name/i },
    { label: 'street', value: A.street1, match: /(street|address)\s*(line|no|number)?\s*1?|suburb|street/i },
    { label: 'postcode', value: A.postcode, match: /(postcode|postal)/i },
    { label: 'phone', value: A.phone, match: /(phone|mobile)/i },
    { label: 'email', value: A.email, match: /email/i },
  ];

  // Collect all visible text inputs on the page.
  const inputs = page.locator('input:visible');
  const n = await inputs.count();
  for (let i = 0; i < n; i++) {
    const inp = inputs.nth(i);
    let info = '';
    try {
      info = [
        await inp.getAttribute('name'),
        await inp.getAttribute('id'),
        await inp.getAttribute('placeholder'),
        await inp.getAttribute('type'),
        await inp.evaluate((el) => {
          const lab = el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`));
          return lab ? lab.textContent : '';
        }),
      ].filter(Boolean).join(' | ');
    } catch { continue; }

    for (const s of specs) {
      if (s.match.test(info)) {
        const type = (await inp.getAttribute('type')) || 'text';
        if (type === 'hidden') continue;
        const cur = await inp.inputValue().catch(() => '');
        if (cur) continue; // don't clobber prefilled
        try {
          await inp.click();
          await inp.fill(s.value);
          console.log(`[step2] filled "${s.label}" -> ${info.slice(0, 90)}`);
          break;
        } catch { /* skip */ }
      }
    }
  }

  // State select (dropdown) — pick VIC.
  const stateSel = page.locator('select:visible').first();
  try {
    if (await stateSel.isVisible({ timeout: 1500 })) {
      const opts = await stateSel.locator('option').allTextContents();
      console.log('[step2] select options:', opts.slice(0, 12).join(', '));
      const vic = opts.find((o) => /vic|victoria/i.test(o));
      if (vic) {
        await stateSel.selectOption({ label: vic });
        console.log('[step2] selected state:', vic);
      }
    }
  } catch { /* no select */ }

  await context._sleep(800);
}

async function main() {
  const context = await launchContext();
  const page = await context.newPage();

  try {
    console.log('[step2] navigating to cart...');
    await page.goto(cfg.cartUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await context._sleep(2500);
    console.log('[step2] url:', page.url(), 'title:', await page.title());
    await shot(context, 'cart');

    // Proceed to checkout.
    const ok = await clickByText(page, [/go to checkout/i, /checkout/i, /continue to checkout/i]);
    if (!ok) {
      console.error('[step2] no checkout button found');
      require('fs').writeFileSync(`${cfg.evidenceDir}/dom_cart.html`, await page.content());
      process.exit(3);
    }
    await context._sleep(2000);

    // If a sign-in / account gate appears, take the guest path (no login by contract).
    if (await page.locator('text=/sign in|log in|log in to continue/i').first().isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('[step2] account gate detected, looking for guest option...');
      await shot(context, 'account-gate');
      const guest = await clickByText(page, [/continue as guest/i, /guest checkout/i, /checkout as guest/i, /continue without/i, /skip/i]);
      if (!guest) {
        console.error('[step2] BLOCKED: forced login with no guest option');
        require('fs').writeFileSync(`${cfg.evidenceDir}/dom_gate.html`, await page.content());
        process.exit(4);
      }
    }
    await context._sleep(2000);
    console.log('[step2] url after checkout click:', page.url());

    // Shipping address step.
    await fillAddress(page, context);
    await shot(context, 'address-filled');
    require('fs').writeFileSync(`${cfg.evidenceDir}/dom_address.html`, await page.content());

    // Continue past address (delivery options).
    await clickByText(page, [/continue/i, /next/i, /delivery/i]);
    await context._sleep(2500);
    await shot(context, 'delivery-options');
    require('fs').writeFileSync(`${cfg.evidenceDir}/dom_delivery.html`, await page.content());

    // Pick first delivery option if a choice is presented, then continue.
    await clickByText(page, [/home delivery/i, /standard/i, /express/i, /^delivery/i]);
    await context._sleep(1500);
    await clickByText(page, [/continue/i, /next/i, /confirm/i, /place/i].slice(0, 3));
    await context._sleep(2500);
    console.log('[step2] url before payment check:', page.url());

    // Verify we are at the payment section.
    const bodyText = await page.evaluate(() => document.body.innerText);
    const atPayment = /(card number|credit card|debit card|pay now|payment|mm\/yy|security code|cvv)/i.test(bodyText);
    await shot(context, atPayment ? 'payment-section' : 'pre-payment');

    if (atPayment) {
      console.log('[step2] SUCCESS: reached payment section. STOPPING HERE (no payment data, no order).');
    } else {
      console.error('[step2] payment section NOT detected. Page text (first 800 chars):');
      console.error(bodyText.slice(0, 800));
      require('fs').writeFileSync(`${cfg.evidenceDir}/dom_pre_payment.html`, await page.content());
      process.exit(5);
    }
  } finally {
    // Leave the browser open for 15s so a human can visually confirm, then close.
    await new Promise((r) => setTimeout(r, 15000));
    await context.close();
  }
}

main().catch((e) => {
  console.error('[step2] FATAL:', e);
  process.exit(1);
});
