#!/usr/bin/env node
/**
 * queue-headed — headed-browser watcher shared by Toymate and EB Games.
 *
 * Queue detection currently recognizes Cloudflare Waiting Room wording.
 * Runtime settings such as the start URL, profile count, browser locale,
 * timezone, polling cadence, and notification behaviour are loaded from
 * config.yml.
 *
 * What this watcher does:
 *   - Launches N parallel Chrome instances, each in its own profile, each
 *     holding its own Cloudflare queue ticket. More tickets = more chances
 *     to clear the gate during a high-traffic drop.
 *   - For each profile, polls every few seconds. State machine:
 *        WAITING_ROOM  -> Cloudflare waiting room. Wait. Don't notify — the
 *                          user can see this on the browser window.
 *        NOT_IN_QUEUE  -> A normal site page. Stay silent and keep watching.
 *        THROUGH       -> A queue was previously seen and has cleared. Notify
 *                          (unless Chrome is already frontmost), open the page.
 *   - A configured browser-open notification reports that an alert launched
 *     Chrome. A separate gate-cleared notification fires only after a profile
 *     has seen a queue and then clears it.
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
const yaml = require('yaml');
const { STATES, classifyPage } = require('./state');

function expandHome(value) {
  return value.startsWith('~/')
    ? path.join(process.env.HOME || process.cwd(), value.slice(2))
    : value;
}

function loadYamlConfig() {
  const configPath = process.env.QUEUE_CONFIG_PATH || process.env.TOYMATE_CONFIG_PATH || path.join(__dirname, 'config.yml');
  const document = yaml.parse(fs.readFileSync(configPath, 'utf8')) || {};
  const toymate = document.queue || document.toymate || document;
  const configDir = path.dirname(path.resolve(configPath));
  const resolveConfigPath = (value) => {
    const expanded = expandHome(String(value));
    return path.isAbsolute(expanded) ? expanded : path.resolve(configDir, expanded);
  };

  if (!toymate.startUrl || !Number.isInteger(toymate.profileCount)) {
    throw new Error(`Invalid queue watcher YAML config: ${configPath}`);
  }

  return {
    ...toymate,
    ...toymate.browser,
    profileBaseDir: resolveConfigPath(toymate.profileBaseDir),
  };
}

// Production settings come exclusively from the selected YAML file. HARD_CODED is
// retained as a compatibility export for the existing test harness; it is not
// a source of defaults.
const HARD_CODED = loadYamlConfig();
const CONFIG = { profileCount: HARD_CODED.profileCount };

// ============================================================
// TEST INFRASTRUCTURE — used by the e2e test only. Leave as-is in production.
// ============================================================
// Each field, if non-null, overrides the corresponding YAML value. In
// production these are all null and the YAML values are used.
const TEST = Object.fromEntries(Object.keys(HARD_CODED).map(k => [k, null]));
TEST.notifyHook = null;
TEST.stateChangeHook = null;

// Effective value: TEST override if set, otherwise the YAML value.
function cfg(key) { return TEST[key] !== null && TEST[key] !== undefined ? TEST[key] : HARD_CODED[key]; }

function emitStatus(type, details = {}) {
  if (typeof process.send !== 'function') return;
  try { process.send({ source: cfg('statusSource') || 'toymate', type, ...details }); } catch (_) {}
}

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
let stopRequested = false;
let browserOpenNotified = false;

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

  if (cfg('notifyOnBrowserOpen') && !browserOpenNotified) {
    browserOpenNotified = true;
    notify(`${cfg('siteName') || 'Queue'} alert received`, 'Browser opened. Checking whether the waiting room is active.', { force: true });
  }

  log('Opening', cfg('startUrl'));
  try {
    await page.goto(cfg('startUrl'), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  } catch (e) {
    log('Initial navigation error (often Cloudflare challenge):', e.message);
  }

  let lastState = null;
  let lastWaitMinutes = null;
  let queueSeen = false;
  const startedAt = Date.now();

  const probe = async () => {
    const title = await page.title().catch(() => '');
    const body  = ((await page.locator('body').innerText().catch(() => '')) || '');
    const url   = page.url();
    return { ...classifyPage(title, body, queueSeen), title, url, body };
  };

  log('Watching for state changes…');
  while (true) {
    if (stopRequested) {
      log('Stopping because another profile cleared the queue.');
      break;
    }
    if (cfg('maxRuntimeMs') && Date.now() - startedAt > cfg('maxRuntimeMs')) {
      log('Max runtime reached, exiting this profile.');
      break;
    }

    let p;
    try { p = await probe(); }
    catch (e) {
      p = { state: lastState || 'NOT_IN_QUEUE', title: '', url: page.url(), body: '', waitMinutes: null };
      log('Probe error:', e.message);
    }

    // Periodic wait-time log (terminal only — never a notification).
    if (p.state === 'WAITING_ROOM' && p.waitMinutes !== null && p.waitMinutes !== lastWaitMinutes) {
      log(`In Cloudflare waiting room — estimated wait: ${p.waitMinutes} min`);
      lastWaitMinutes = p.waitMinutes;
    }

    if (p.state === 'WAITING_ROOM') queueSeen = true;

    // WAITING_ROOM is silent. The browser-open notification has already
    // reported the alert; gate-cleared notification fires on THROUGH.

    if (p.state !== lastState) {
      if (cfg('stateChangeHook')) cfg('stateChangeHook')(p.state, p.url, p.title, index, total);
      log('State:', lastState || '∅', '→', p.state, '| url:', p.url, '| title:', p.title);
      lastState = p.state;

      if (p.state === 'WAITING_ROOM') emitStatus('waiting_room', { profile: index + 1, total });

      if (p.state === 'THROUGH' && queueSeen) {
        notify(`${tag} ✅ gate cleared`, 'You\'re past the Cloudflare queue. Page opened in your default browser.');
        profileContexts.get(index).cleared = true;
        emitStatus('cleared', { profile: index + 1, total, url: p.url });
        if (cfg('openOnClear')) openInBrowser(p.url);

        if (cfg('closeOthersOnClear')) {
          stopRequested = true;
          for (const [i, { context: otherCtx }] of profileContexts) {
            if (i !== index) {
              log('Closing other profile', i + 1, '(gate already cleared by us)…');
              otherCtx.close().catch(() => {});
            }
          }
        }

        break;
      }
      // WAITING_ROOM and NOT_IN_QUEUE transitions are intentionally silent.
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
  emitStatus('started', { profiles: CONFIG.profileCount });

  // Run all profiles concurrently. If one crashes, the others keep going.
  const tasks = [];
  for (let i = 0; i < CONFIG.profileCount; i++) {
    tasks.push(runProfile(i, CONFIG.profileCount).catch(e => {
      if (stopRequested) return;
      console.error(`[Profile ${i + 1}] fatal:`, e.message);
      emitStatus('error', { profile: i + 1, message: String(e.message || e) });
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
  for (const { context } of profileContexts.values()) {
    await context.close().catch(() => {});
  }
  log('All profiles finished.');
  emitStatus('stopped', { reason: stopRequested ? 'cleared' : 'finished' });
}

// Only auto-run when invoked as a script. When required as a module (e.g.
// by the e2e test) the caller invokes main() itself.
if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal:', err);
    emitStatus('error', { message: String(err && err.message || err) });
    notify(`${cfg('notifySubtitle')} crashed`, String(err && err.message || err), { force: false });
    process.exit(1);
  });
}

module.exports = {
  CONFIG, HARD_CODED, TEST, STATES,
  runProfile, main, notify, isChromeFocused,
  profileContexts, profileLabel, cfg,
};
