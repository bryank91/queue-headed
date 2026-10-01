'use strict';

/** Full run: fresh profile -> add to cart -> checkout -> stop at payment. */

const cfg = require('./config');
const { launchContext, shot } = require('./stealth');
const { spawnSync } = require('child_process');

async function main() {
  console.log('[run] starting full checkout automation run');
  const t0 = Date.now();

  // Step 1: product -> cart
  const s1 = spawnSync(process.execPath, [require('path').join(__dirname, '01-add-to-cart.js')], { stdio: 'inherit' });
  if (s1.status !== 0) {
    console.error(`[run] step1 failed with code ${s1.status}`);
    process.exit(s1.status || 1);
  }

  // Step 2: cart -> payment
  const s2 = spawnSync(process.execPath, [require('path').join(__dirname, '02-checkout-to-payment.js')], { stdio: 'inherit' });
  if (s2.status !== 0) {
    console.error(`[run] step2 failed with code ${s2.status}`);
    process.exit(s2.status || 1);
  }

  console.log(`[run] SUCCESS: full flow completed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('[run] Evidence in:', cfg.evidenceDir);
}

main().catch((e) => {
  console.error('[run] FATAL:', e);
  process.exit(1);
});
