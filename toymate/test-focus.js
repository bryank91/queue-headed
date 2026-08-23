#!/usr/bin/env node
/**
 * Smoke test for the focus-aware notify() suppression.
 *
 *   1. Brings Terminal to the front (so Chrome is NOT frontmost).
 *   2. Calls notify() — should fire a real macOS notification.
 *   3. Brings Chrome to the front.
 *   4. Calls notify() — should be silently suppressed (no notification appears).
 *   5. Brings Terminal back to the front.
 *   6. Calls notify() — should fire again.
 *
 * Each notify() call prints "FIRED" or "SUPPRESSED" so you can see the path
 * it took even if you're not looking at Notification Center.
 */
const { execSync } = require('child_process');

// --- helpers copied verbatim from watcher.js (kept in sync manually) ---
const CONFIG = { suppressWhenChromeFocused: true };

function isChromeFocused() {
  if (!CONFIG.suppressWhenChromeFocused) return false;
  try {
    const out = execSync(
      `osascript -e 'tell application "System Events" to (frontmost of process "Google Chrome")'`,
      { encoding: 'utf8', timeout: 2000 }
    ).trim();
    return out === 'true';
  } catch (_) {
    return false;
  }
}

function notify(title, body, opts = {}) {
  const { force = false } = opts;
  const focused = isChromeFocused();
  const suppressed = !force && focused;
  console.log(`  notify("${title}") → ${suppressed ? 'SUPPRESSED (Chrome is frontmost)' : 'FIRED'}`);
  if (suppressed) return;
  const safe = (s) => String(s).replace(/"/g, '\\"');
  try {
    execSync(
      `osascript -e 'display notification "${safe(body)}" with title "${safe(title)}" subtitle "Focus test"'`,
      { stdio: 'ignore' }
    );
  } catch (_) {}
  try { execSync('afplay /System/Library/Sounds/Glass.aiff', { stdio: 'ignore' }); }
  catch (_) {}
}

function activate(appName) {
  try {
    execSync(`osascript -e 'tell application "${appName}" to activate'`);
  } catch (e) {
    console.log(`  (could not activate ${appName}: ${e.message})`);
  }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --- the test ---
(async () => {
  console.log('=== Focus-aware notify() smoke test ===\n');

  console.log('Step 1: bring Terminal to front (Chrome goes to back)');
  activate('Terminal');
  await sleep(800);
  console.log('  isChromeFocused() =', isChromeFocused(), '\n');

  console.log('Step 2: notify() while Chrome is in background — expect FIRED');
  notify('Test 1: should FIRE', 'If you see this, suppression is OFF when Chrome is in back.');
  await sleep(1500);
  console.log('');

  console.log('Step 3: bring Chrome to front');
  activate('Google Chrome');
  await sleep(800);
  console.log('  isChromeFocused() =', isChromeFocused(), '\n');

  console.log('Step 4: notify() while Chrome is frontmost — expect SUPPRESSED');
  notify('Test 2: should be SUPPRESSED', 'If you see this, suppression is BROKEN.');
  await sleep(1500);
  console.log('');

  console.log('Step 5: bring Terminal back to front');
  activate('Terminal');
  await sleep(800);
  console.log('  isChromeFocused() =', isChromeFocused(), '\n');

  console.log('Step 6: notify() again — expect FIRED');
  notify('Test 3: should FIRE again', 'Back to firing after Chrome moved to back.');
  await sleep(1500);
  console.log('');

  console.log('Step 7: force=true override — expect FIRED even with Chrome frontmost');
  activate('Google Chrome');
  await sleep(800);
  console.log('  isChromeFocused() =', isChromeFocused());
  notify('Test 4: force=true override', 'Force=true bypasses focus suppression.', { force: true });
  await sleep(1500);
  console.log('');

  console.log('=== done ===');
  // Leave Terminal frontmost so the user can see the output.
  activate('Terminal');
})().catch(e => { console.error(e); process.exit(1); });
