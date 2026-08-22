#!/usr/bin/env node
/**
 * queue-headed — multi-profile headed-browser watcher for toymate.com.au's
 * Cloudflare Waiting Room.
 *
 * ⚠️  This script might only work with toymate.com.au.
 * The Cloudflare detection patterns, the start URL, the browser locale, the
 * timezone, and the Accept-Language header are all hardcoded for Toymate.
 * The only knob you change at runtime is `profileCount` (the number of
 * parallel Chrome instances — i.e. the number of queue tickets you want to
 * hold). To point this at a different site, edit the constants at the top of
 * the file.
 *
 * What this watcher does:
 *   - Launches N parallel Chrome instances, each in its own profile, each
 *     holding its own Cloudflare queue ticket. More tickets = more chances
 *     to clear the gate during a high-traffic drop.
 *   - For each profile, polls every few seconds. State machine:
 *        WAITING_ROOM  -> Cloudflare waiting room. Wait. Don't notify — the
 *                          user can see this on the browser window.
 *        THROUGH       -> Title changed. You're past the gate. Notify (unless
 *                          Chrome is already frontmost), open the page.
 *   - Notifications ONLY fire on the "gate cleared" transition. WAITING_ROOM
 *     is silent — you can see it on the browser window yourself.
 *
 * Run:
 *   node watcher.js
 *
 * Stop with Ctrl-C. Don't close individual Chrome windows while they're in a
 * waiting room — that loses that profile's place in line.
 */

const { chromium } = require('playwright');
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ============================================================
// HARD-CODED SETTINGS — tuned for toymate.com.au.
// To customize: edit this block. Nothing here is runtime-configurable.
// ============================================================
const HARD_CODED = {
  // The site to watch.
  startUrl:             'https://toymate.com.au/',

  // Poll cadence (ms). Cloudflare refreshes the WR every ~30s; 4s polling
  // catches the transition quickly without hammering the site.
  pollIntervalMs:       4000,

  // Base dir for per-profile Chrome data. Each profile gets
  //   <base>/profile-<index>/
  profileBaseDir:       path.join(process.env.HOME, 'queue-headed', 'profiles'),

  // Stop the whole watcher after this many ms. 0 = forever.
  maxRuntimeMs:         0,

  // Open the cleared page in your default browser when a profile gets through.
  openOnClear:          true,

  // When a profile clears the gate, close the *other* profiles' Chrome
  // windows (their tickets are now redundant).
  closeOthersOnClear:   false,

  // Skip notifications when Google Chrome is the frontmost app — if you're
  // already looking at the browser, you can see the state change yourself.
  suppressWhenChromeFocused: true,

  // macOS notification subtitle (the small grey text).
  notifySubtitle:       'Queue Watcher',

  // Terminal logging.
  verbose:              true,

  // Browser locale + timezone + Accept-Language. Wrong values may cause CF
  // to serve a different regional variant or look suspicious.
  locale:               'en-AU',
  timezoneId:           'Australia/Sydney',
  acceptLanguage:       'en-AU,en;q=0.9',

  // Which browser to launch. 'chrome' = Google Chrome (must be installed).
  // For tests on machines without Chrome, the e2e test overrides this.
  channel:              'chrome',

  // Headed (default) vs headless. Headed is required so the user can see the
  // browser window. Headless is used by the e2e test.
  headless:             false,

  // Test hooks — null in production. The e2e test sets these to capture
  // notifications and state transitions.
  notifyHook:           null,
  stateChangeHook:      null,
};

// ============================================================
// USER CONFIG — the one knob.
// ============================================================
const CONFIG = {
  // Number of parallel Chrome profiles. Each holds its own queue ticket.
  // 1 = single profile. Higher = more chances, more CPU/RAM.
  profileCount:         3,
};

// ============================================================
// TEST INFRASTRUCTURE — used by the e2e test only. Leave as-is in production.
// ============================================================
// Each field, if non-null, overrides the corresponding HARD_CODED value. In
// production code path these are always null and HARD_CODED values are used.
const TEST = Object.fromEntries(Object.keys(HARD_CODED).map(k => [k, null]));

// Effective value: TEST override if set, otherwise the hardcoded default.
function cfg(key) { return TEST[key] !== null ? TEST[key] : HARD_CODED[key]; }

// ============================================================
// STATE DETECTION — Cloudflare Waiting Room regexes.
// ============================================================
const STATES = {
  CLOUDFLARE_TITLE: /waiting room powered by cloudflare/i,
  CLOUDFLARE_BODY:  /you are now in line|estimated wait time is|virtual queue/i,
};

// ============================================================
// macOS HELPERS
// ============================================================

// True if Google Chrome is the frontmost application. Used to suppress
// notifications when the user is already looking at the browser window.
function isChromeFocused() {
  if (!cfg('suppressWhenChromeFocused')) return false;
  try {
    const out = execSync(
      `osascript -e 'tell application "System Events" to (frontmost of process "Google Chrome")'`,
      { encoding: 'utf8', timeout: 2000 }
    ).trim();
    return out === 'true';
  } catch (_) {
    // AppleScript can fail (Accessibility permission not granted). Default to
    // "not focused" so notifications still fire — safer than silent failure.
    return false;
  }
}

function notify(title, body, opts = {}) {
  // Test hook: when set, capture the call and skip the macOS-specific bits.
  if (cfg('notifyHook')) { cfg('notifyHook')(title, body, opts); return; }
  const { force = false } = opts;
  if (!force && isChromeFocused()) {
    // User is already at the browser — they can see the state change
    // themselves. Skip the notification + sound entirely.
    return;
  }
  const safe = (s) => String(s).replace(/"/g, '\\"');
  try {
    execSync(
      `osascript -e 'display notification "${safe(body)}" with title "${safe(title)}" subtitle "${safe(cfg('notifySubtitle'))}"'`,
      { stdio: 'ignore' }
    );
  } catch (_) { /* non-fatal */ }
  try { execSync('afplay /System/Library/Sounds/Glass.aiff', { stdio: 'ignore' }); }
  catch (_) { try { execSync('say "queue update"', { stdio: 'ignore' }); } catch (__) {} }
}

function openInBrowser(url) {
  try { spawn('open', [url], { detached: true, stdio: 'ignore' }).unref(); } catch (_) {}
}

// ============================================================
// PER-PROFILE STATE
// ============================================================
// Shared across profiles so one clearing can notify + optionally close others.
const profileContexts = new Map(); // index -> { context, page, cleared }

function profileLabel(i, n) {
  return `[Profile ${i + 1}/${n}]`;
}

// ============================================================
// SINGLE-PROFILE RUNNER
// ============================================================
async function runProfile(index, total) {
  const profileDir = path.join(cfg('profileBaseDir'), `profile-${index + 1}`);
  fs.mkdirSync(profileDir, { recursive: true });

  const tag = profileLabel(index, total);
  const log = (...a) => cfg('verbose') && console.log(new Date().toISOString().slice(11, 19), tag, ...a);

  log('Launching Chrome (profile dir:', profileDir + ')…');
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: cfg('channel'),
    headless: cfg('headless'),
    viewport: { width: 1280, height: 900 },
    locale: cfg('locale'),
    timezoneId: cfg('timezoneId'),
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
  });

  const page = await context.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': cfg('acceptLanguage') });

  profileContexts.set(index, { context, page, cleared: false });

  log('Opening', cfg('startUrl'));
  try {
    await page.goto(cfg('startUrl'), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  } catch (e) {
    log('Initial navigation error (often Cloudflare challenge):', e.message);
  }

  let lastState = null;
  let lastWaitMinutes = null;
  const startedAt = Date.now();

  const probe = async () => {
    const title = await page.title().catch(() => '');
    const body  = ((await page.locator('body').innerText().catch(() => '')) || '');
    const url   = page.url();
    let waitMinutes = null;
    const m = body.match(/estimated wait time is\s*(\d+)\s*minutes?/i);
    if (m) waitMinutes = parseInt(m[1], 10);

    if (STATES.CLOUDFLARE_TITLE.test(title) || STATES.CLOUDFLARE_BODY.test(body)) {
      return { state: 'WAITING_ROOM', title, url, waitMinutes, body };
    }
    return { state: 'THROUGH', title, url, body, waitMinutes };
  };

  log('Watching for state changes…');
  while (true) {
    if (cfg('maxRuntimeMs') && Date.now() - startedAt > cfg('maxRuntimeMs')) {
      log('Max runtime reached, exiting this profile.');
      break;
    }

    let p;
    try { p = await probe(); }
    catch (e) {
      p = { state: lastState || 'WAITING_ROOM', title: '', url: page.url(), body: '', waitMinutes: null };
      log('Probe error:', e.message);
    }

    // Periodic wait-time log (terminal only — never a notification).
    if (p.state === 'WAITING_ROOM' && p.waitMinutes !== null && p.waitMinutes !== lastWaitMinutes) {
      log(`In Cloudflare waiting room — estimated wait: ${p.waitMinutes} min`);
      lastWaitMinutes = p.waitMinutes;
    }

    // Notifications are intentionally only fired on the "gate cleared"
    // transition below (THROUGH). WAITING_ROOM is silent — you can see it
    // on the browser window yourself. notify() additionally suppresses if
    // Chrome is already the frontmost app.

    if (p.state !== lastState) {
      if (cfg('stateChangeHook')) cfg('stateChangeHook')(p.state, p.url, p.title, index, total);
      log('State:', lastState || '∅', '→', p.state, '| url:', p.url, '| title:', p.title);
      lastState = p.state;

      if (p.state === 'THROUGH') {
        notify(`${tag} ✅ gate cleared`, 'You\'re past the Cloudflare queue. Page opened in your default browser.');
        profileContexts.get(index).cleared = true;
        if (cfg('openOnClear')) openInBrowser(p.url);

        if (cfg('closeOthersOnClear')) {
          for (const [i, { context: otherCtx }] of profileContexts) {
            if (i !== index) {
              log('Closing other profile', i + 1, '(gate already cleared by us)…');
              otherCtx.close().catch(() => {});
            }
          }
        }
      }
      // WAITING_ROOM transitions are intentionally silent — you can see
      // them on the browser window. No notify() call.
    }

    await page.waitForTimeout(cfg('pollIntervalMs'));
  }

  log('Exiting.');
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  const log = (...a) => cfg('verbose') && console.log(new Date().toISOString().slice(11, 19), '[main]', ...a);
  fs.mkdirSync(cfg('profileBaseDir'), { recursive: true });

  log(`Starting ${CONFIG.profileCount} parallel profile(s)…`);

  // Run all profiles concurrently. If one crashes, the others keep going.
  const tasks = [];
  for (let i = 0; i < CONFIG.profileCount; i++) {
    tasks.push(runProfile(i, CONFIG.profileCount).catch(e => {
      console.error(`[Profile ${i + 1}] fatal:`, e.message);
      notify(`${cfg('notifySubtitle')}: profile ${i + 1} crashed`, String(e.message || e), { force: false });
    }));
  }

  // Heartbeat so you can see the watcher is alive even when nothing's happening.
  const heartbeat = setInterval(() => {
    if (!cfg('verbose')) return;
    const cleared = Array.from(profileContexts.values()).filter(c => c.cleared).length;
    console.log(new Date().toISOString().slice(11, 19), '[main]',
      `profiles=${profileContexts.size}/${CONFIG.profileCount} cleared=${cleared}`);
  }, 60_000);
  heartbeat.unref();

  await Promise.allSettled(tasks);
  log('All profiles finished.');
}

// Only auto-run when invoked as a script. When required as a module (e.g.
// by the e2e test) the caller invokes main() itself.
if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal:', err);
    notify(`${cfg('notifySubtitle')} crashed`, String(err && err.message || err), { force: false });
    process.exit(1);
  });
}

module.exports = {
  CONFIG, HARD_CODED, TEST, STATES,
  runProfile, main, notify, isChromeFocused,
  profileContexts, profileLabel, cfg,
};