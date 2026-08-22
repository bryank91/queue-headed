#!/usr/bin/env node
/**
 * End-to-end mock test for queue-headed.
 *
 * Boots a local HTTP server that serves a fake Cloudflare Waiting Room
 * page for the first N seconds, then switches to a fake "cleared" page.
 * Runs the real watcher against it and asserts the state machine transitions
 * correctly and the gate-cleared notification fires.
 *
 * Requirements (one-time setup):
 *   npm install
 *   npx playwright install chromium
 *
 * Run:
 *   node test-e2e.js
 *   npm run test:e2e
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// --- Mode selection ---
//   (default)            → chromium-headless-shell, fastest, most CF-detectable
//   MODE=full-chromium   → full Chromium binary in headless mode (no display
//                          required). Same rendering pipeline as headed; better
//                          against Cloudflare's headless detection. Launch
//                          cost: ~20s for the persistent context.
//   MODE=headed          → headed Chromium. Works out of the box on:
//                            - macOS (real display)
//                            - WSL2 with WSLg (DISPLAY=:0 + Windows display)
//                            - Linux desktop with X11/Wayland
//                          On a headless Linux server without WSLg: install
//                          Xvfb (`apt-get install -y xvfb`) and run under
//                          `xvfb-run -a npm run test:e2e -- --mode=headed`.
const MODE = (process.env.TEST_MODE || process.argv.find(a => a.startsWith('--mode='))?.slice(7) || 'headless-shell').toLowerCase();

const MODE_CONFIG = {
  'headless-shell':  { headless: true,  channel: undefined,  wrDurationMs: 5000,  maxRuntimeMs: 25000,
                       note: 'chromium-headless-shell (fastest, most CF-detectable)' },
  'full-chromium':   { headless: true,  channel: 'chromium', wrDurationMs: 25000, maxRuntimeMs: 45000,
                       note: 'full Chromium binary, headless (no display needed)' },
  'headed':          { headless: false, channel: undefined,  wrDurationMs: 25000, maxRuntimeMs: 45000,
                       note: 'headed Chromium (real display)' },
};
if (!MODE_CONFIG[MODE]) {
  console.error(`Unknown mode "${MODE}". Valid: ${Object.keys(MODE_CONFIG).join(', ')}`);
  process.exit(2);
}

// On SIGINT/SIGTERM, clean up Chrome + HTTP server before exiting, so we
// don't leave orphan processes holding the test port.
let cleaningUp = false;
async function emergencyCleanup(signal) {
  if (cleaningUp) return;
  cleaningUp = true;
  console.log(`\n${signal} received, cleaning up…`);
  try {
    for (const [, { context }] of (require('./watcher').profileContexts || new Map())) {
      await context.close().catch(() => {});
    }
  } catch {}
  try { await stopServer(); } catch {}
  process.exit(130);
}
process.on('SIGINT',  () => emergencyCleanup('SIGINT'));
process.on('SIGTERM', () => emergencyCleanup('SIGTERM'));

const { wrDurationMs: WR_DURATION_MS, maxRuntimeMs: MAX_RUNTIME_MS } = MODE_CONFIG[MODE];
const POLL_INTERVAL_MS   = 1500;   // faster than production (4 s) for quicker test
const PORT               = 8765;
const BASE_URL           = `http://127.0.0.1:${PORT}/`;
const FIXTURES           = path.join(__dirname, 'test', 'fixtures');

// --- Load fixtures ---
const WAITING_ROOM_HTML = fs.readFileSync(path.join(FIXTURES, 'waiting-room.html'), 'utf8');
const CLEARED_HTML      = fs.readFileSync(path.join(FIXTURES, 'cleared.html'),      'utf8');

// --- Assertions tracker ---
const stateTransitions = [];
const notifications    = [];
let sawWaitingRoom = false;
let sawThrough     = false;

// --- HTTP server (switches content after WR_DURATION_MS) ---
const serverStart = Date.now();
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const elapsed = Date.now() - serverStart;
  const html = elapsed < WR_DURATION_MS ? WAITING_ROOM_HTML : CLEARED_HTML;
  res.end(html);
});

function startServer() {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve());
  });
}
function stopServer() {
  return new Promise((resolve) => {
    // Force-close any keep-alive connections from the browser (Node 18.2+).
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close(() => resolve());
  });
}

// --- Main ---
(async () => {
  console.log('=== queue-headed e2e mock test ===\n');

  // Sanity: playwright installed?
  let playwright;
  try {
    playwright = require('playwright');
  } catch (e) {
    console.error('FAIL — playwright not installed. Run:  npm install');
    process.exit(2);
  }
  // Sanity: chromium installed? (Launch a throwaway browser to check.)
  let probeBrowser;
  try {
    probeBrowser = await playwright.chromium.launch({
      headless: MODE_CONFIG[MODE].headless,
      channel:  MODE_CONFIG[MODE].channel,
    });
  } catch (e) {
    console.error(`FAIL — browser launch failed for mode "${MODE}".`);
    if (MODE === 'headed' && /DISPLAY|display/i.test(e.message)) {
      console.error('  Headed mode needs a display. Options:');
      console.error('    - macOS: just works');
      console.error('    - WSL2 with WSLg: just works (check `echo $DISPLAY`)');
      console.error('    - Headless Linux server: `apt-get install -y xvfb` then run under `xvfb-run`');
      console.error('    - Or use MODE=full-chromium for a similar-but-displayless test');
    } else {
      console.error('  Run:  npx playwright install chromium');
    }
    console.error('  underlying:', e.message.split('\n')[0]);
    process.exit(2);
  }
  await probeBrowser.close();

  console.log(`Mode: ${MODE} — ${MODE_CONFIG[MODE].note}`);

  console.log(`Starting mock server on ${BASE_URL}`);
  await startServer();
  console.log(`  → serving waiting-room.html for first ${WR_DURATION_MS} ms, then cleared.html\n`);

  // Import watcher AFTER the playwright sanity check so we fail fast.
  const watcher = require('./watcher');

  // Configure watcher for the test. Production knobs are hardcoded in
  // watcher.js. We override via watcher.TEST (test-only infrastructure):
  // each TEST field falls back to HARD_CODED when null.
  watcher.CONFIG.profileCount = 1;
  Object.assign(watcher.TEST, {
    startUrl:             BASE_URL,
    pollIntervalMs:       POLL_INTERVAL_MS,
    maxRuntimeMs:         MAX_RUNTIME_MS,
    openOnClear:          false,    // don't try to spawn `open`
    closeOthersOnClear:   false,
    verbose:              true,
    channel:              MODE_CONFIG[MODE].channel,
    headless:             MODE_CONFIG[MODE].headless,
    suppressWhenChromeFocused: true,
    notifySubtitle:       'queue-headed-test',
    stateChangeHook: (state, url, title) => {
      const elapsed = ((Date.now() - serverStart) / 1000).toFixed(1);
      console.log(`  [hook +${elapsed}s] state → ${state} | title: ${title}`);
      stateTransitions.push({ state, url, title, time: Date.now() });
      if (state === 'WAITING_ROOM') sawWaitingRoom = true;
      if (state === 'THROUGH')      sawThrough     = true;
    },
    notifyHook: (title, body, opts) => {
      const elapsed = ((Date.now() - serverStart) / 1000).toFixed(1);
      console.log(`  [hook +${elapsed}s] notify: "${title}" — ${body}`);
      notifications.push({ title, body, opts, time: Date.now() });
    },
  });

  console.log(`Starting watcher (max ${MAX_RUNTIME_MS / 1000}s)…\n`);

  const watcherStart = Date.now();
  await watcher.main();
  const watcherDuration = ((Date.now() - watcherStart) / 1000).toFixed(1);
  console.log(`\nWatcher exited after ${watcherDuration}s. Cleaning up…`);

  // The watcher intentionally leaves the BrowserContext open after runProfile
  // exits (so the user can keep the window up after a drop). For the test we
  // need to close it explicitly or the Node event loop stays alive forever.
  for (const [, { context }] of watcher.profileContexts) {
    await context.close().catch(() => {});
  }
  await stopServer();

  // --- Assertions ---
  console.log('\n=== Assertions ===');
  let pass = 0, fail = 0;
  function assert(name, cond, detail = '') {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else      { console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); fail++; }
  }

  const gateClearedNotif = notifications.find(n => /gate cleared/i.test(n.title));

  assert('saw WAITING_ROOM state at least once',          sawWaitingRoom);
  assert('saw THROUGH state at least once',               sawThrough);
  assert('state transition log has ≥ 2 entries',          stateTransitions.length >= 2,
         `got ${stateTransitions.length}`);
  assert('last transition is THROUGH',
         stateTransitions[stateTransitions.length - 1].state === 'THROUGH',
         `got "${stateTransitions[stateTransitions.length - 1].state}"`);
  assert('received gate-cleared notification',            !!gateClearedNotif);
  assert('exactly one gate-cleared notification fired',
         notifications.filter(n => /gate cleared/i.test(n.title)).length === 1,
         `got ${notifications.filter(n => /gate cleared/i.test(n.title)).length}`);
  assert('no notifications fired while page was still WR',
         notifications.length === 0 || /gate cleared/i.test(notifications[0].title),
         `first notification: "${notifications[0] && notifications[0].title}"`);
  assert('THROUGH transition came AFTER server switched content (≥ 4s)',
         stateTransitions.find(t => t.state === 'THROUGH') &&
         (stateTransitions.find(t => t.state === 'THROUGH').time - serverStart) >= WR_DURATION_MS,
         stateTransitions.find(t => t.state === 'THROUGH')
           ? `came at +${((stateTransitions.find(t => t.state === 'THROUGH').time - serverStart)/1000).toFixed(1)}s`
           : 'no THROUGH transition recorded');

  console.log(`\n${pass}/${pass + fail} passed${fail ? ` (${fail} FAILED)` : ''}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('Test runner error:', e);
  stopServer().catch(() => {});
  process.exit(1);
});