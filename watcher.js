#!/usr/bin/env node
/**
 * Toymate queue watcher — Cloudflare Waiting Room edition, multi-profile.
 *
 * Toymate uses TWO queue systems layered together:
 *   1. Cloudflare Waiting Room — virtual queue Cloudflare runs in front of the
 *      site when traffic spikes. Title is "Waiting Room powered by Cloudflare",
 *      body says "You are now in line." with an ETA. Page auto-refreshes; you
 *      don't click anything. Cloudflare redirects to the real site when it's
 *      your turn.
 *   2. EQL (runfair.com) — used on specific product drops (e.g. Pokémon cards)
 *      once you're past the Cloudflare gate. That's where "Enter launch" lives.
 *
 * What this watcher does:
 *   - Launches N parallel Chrome instances (default 3), each in its own profile,
 *     each holding its own Cloudflare queue ticket. More tickets = more chances
 *     to clear the gate during a high-traffic drop.
 *   - For each profile, polls every few seconds. State machine:
 *        WAITING_ROOM  -> Cloudflare waiting room. Wait. Don't notify — the
 *                          user can see this on the browser window themselves.
 *        THROUGH       -> Title changed. You're in. Notify (unless the user
 *                          is already looking at the browser), open the page,
 *                          and (if it's an EQL drop page) auto-click Enter.
 *        DROP_ENTERED  -> Entered an EQL drop. Wait for selection. Don't notify.
 *        SELECTED      -> "You're in" / purchase state. Notify (unless at the
 *                          browser), open, stop.
 *        NOT_SELECTED  -> Lost the raffle. Notify (unless at the browser), stop.
 *   - Notifications ONLY fire on the three "outcome" states (THROUGH /
 *     SELECTED / NOT_SELECTED). They are auto-suppressed whenever Google Chrome
 *     is the frontmost application — if you're already at the browser, you can
 *     see the state change yourself and don't need a ping.
 *
 * Run:
 *   node watcher.js
 *
 * Stop with Ctrl-C. Don't close individual Chrome windows while they're in the
 * Cloudflare waiting room — that loses that profile's place in line.
 */

const { chromium } = require('playwright');
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ---------- config ----------
const CONFIG = {
  startUrl: 'https://toymate.com.au/',

  // Number of parallel Chrome profiles to run. Each holds its own queue
  // ticket. Set to 1 if you only want one. Higher = more chances, more CPU.
  profileCount: 3,

  // Base directory under which per-profile Chrome data dirs are created.
  // Each profile gets:   <base>/profile-<index>/
  profileBaseDir: path.join(process.env.HOME, 'toymate-watcher', 'profiles'),

  // Poll cadence. Cloudflare refreshes the waiting room every ~30s; this
  // is more frequent so we catch the moment we get through quickly.
  pollIntervalMs: 4000,

  // Suppress notifications when Google Chrome is the frontmost app. If you're
  // already looking at the browser, you can see the page state and don't need
  // a ping. Set to false to always notify regardless of focus.
  suppressWhenChromeFocused: true,

  // If we land on an EQL page after clearing the gate, click the first
  // "Enter launch" button we find.
  autoEnterDrops: true,

  // Stop the whole watcher after this many ms (0 = forever).
  maxRuntimeMs: 0,

  // Open the cleared page in your default browser when a profile gets
  // through. Useful if you want to act on it from Safari/your main Chrome.
  openOnClear: true,

  // When a profile clears the gate, automatically close the *other*
  // profiles' Chrome windows (their tickets are now redundant). Set to
  // false to keep them all open as backups.
  closeOthersOnClear: false,

  verbose: true,
};

// ---------- state detection ----------
const STATES = {
  CLOUDFLARE_TITLE: /waiting room powered by cloudflare/i,
  CLOUDFLARE_BODY:  /you are now in line|estimated wait time is|virtual queue/i,
  EQL_ENTERED:      /entry\s*submitted|you('?re|\s*are)\s*(in\s*the\s*queue|in!)|waiting\s*for\s*(selection|the\s*draw)|good\s*luck/i,
  EQL_SELECTED:     /you('?re|\s*are)\s*(in|through|selected|chosen)|proceed\s*to\s*(checkout|purchase|buy)|complete\s*(your\s*)?order|buy\s*now/i,
  EQL_NOT_SELECTED: /not\s*selected|didn['’]t\s*(get|make)\s*it|unfortunately|try\s*again\s*next\s*time/i,
};

const EQL_ENTER_SELECTORS = [
  'button:has-text("Enter launch")',
  'button:has-text("Enter the launch")',
  'button:has-text("Enter now")',
  'button:has-text("Join queue")',
  'button:has-text("Enter queue")',
  'button:has-text("Enter")',
  'a:has-text("Enter launch")',
  'a:has-text("Enter now")',
  '[data-testid="enter-launch"]',
  '[data-testid*="enter"]',
];

// ---------- macOS helpers ----------

// Returns true if Google Chrome is the frontmost application. Used to suppress
// notifications when the user is already looking at the browser window.
function isChromeFocused() {
  if (!CONFIG.suppressWhenChromeFocused) return false;
  try {
    const out = execSync(
      `osascript -e 'tell application "System Events" to (frontmost of process "Google Chrome")'`,
      { encoding: 'utf8', timeout: 2000 }
    ).trim();
    return out === 'true';
  } catch (_) {
    // If the AppleScript call fails (e.g. Accessibility permission not granted
    // for the terminal), assume the user is NOT at the browser so notifications
    // still fire — safer default than silent failure.
    return false;
  }
}

function notify(title, body, opts = {}) {
  const { force = false } = opts;
  if (!force && isChromeFocused()) {
    // User is already looking at a Chrome window — they can see the state
    // change themselves. Skip the notification + sound entirely.
    return;
  }
  const safe = (s) => String(s).replace(/"/g, '\\"');
  try {
    execSync(
      `osascript -e 'display notification "${safe(body)}" with title "${safe(title)}" subtitle "Toymate Watcher"'`,
      { stdio: 'ignore' }
    );
  } catch (_) { /* non-fatal */ }
  try { execSync('afplay /System/Library/Sounds/Glass.aiff', { stdio: 'ignore' }); }
  catch (_) { try { execSync('say "Toymate update"', { stdio: 'ignore' }); } catch (__) {} }
}

function openInBrowser(url) {
  try { spawn('open', [url], { detached: true, stdio: 'ignore' }).unref(); } catch (_) {}
}

// ---------- per-profile state ----------
// Shared across profiles so one clearing can notify + optionally close others.
const profileContexts = new Map(); // index -> { context, page, cleared }
let anyCleared = false;

function profileLabel(i, n) {
  return `[Profile ${i + 1}/${n}]`;
}

// ---------- single-profile runner ----------
async function runProfile(index, total) {
  const profileDir = path.join(CONFIG.profileBaseDir, `profile-${index + 1}`);
  fs.mkdirSync(profileDir, { recursive: true });

  const tag = profileLabel(index, total);
  const log = (...a) => CONFIG.verbose && console.log(new Date().toISOString().slice(11, 19), tag, ...a);

  log('Launching Chrome (profile dir:', profileDir + ')…');
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 900 },
    locale: 'en-AU',
    timezoneId: 'Australia/Sydney',
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
  });

  const page = await context.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });

  profileContexts.set(index, { context, page, cleared: false });

  log('Opening', CONFIG.startUrl);
  try {
    await page.goto(CONFIG.startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
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
    if (STATES.EQL_SELECTED.test(body))     return { state: 'SELECTED', title, url, body };
    if (STATES.EQL_NOT_SELECTED.test(body)) return { state: 'NOT_SELECTED', title, url, body };
    if (STATES.EQL_ENTERED.test(body))      return { state: 'DROP_ENTERED', title, url, body };
    return { state: 'THROUGH', title, url, body, waitMinutes };
  };

  log('Watching for state changes…');
  while (true) {
    if (CONFIG.maxRuntimeMs && Date.now() - startedAt > CONFIG.maxRuntimeMs) {
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

    // Notifications are intentionally only fired on the three "outcome" state
    // transitions below (THROUGH / SELECTED / NOT_SELECTED). WAITING_ROOM and
    // DROP_ENTERED are silent — you can see them on the browser window
    // yourself, and we don't want to spam you. notify() will additionally
    // suppress if Chrome is already the frontmost app.

    if (p.state !== lastState) {
      log('State:', lastState || '∅', '→', p.state, '| url:', p.url, '| title:', p.title);
      lastState = p.state;

      if (p.state === 'THROUGH') {
        notify(`${tag} ✅ gate cleared`, 'You\'re past the Cloudflare queue. Page opened in your default browser.');
        profileContexts.get(index).cleared = true;
        anyCleared = true;
        if (CONFIG.openOnClear) openInBrowser(p.url);

        if (CONFIG.closeOthersOnClear) {
          for (const [i, { context: otherCtx }] of profileContexts) {
            if (i !== index) {
              log('Closing other profile', i + 1, '(gate already cleared by us)…');
              otherCtx.close().catch(() => {});
            }
          }
        }

        if (CONFIG.autoEnterDrops && /runfair\.com|eql\.com/.test(p.url)) {
          log('Landed on EQL — looking for Enter button…');
          let entered = false;
          for (const sel of EQL_ENTER_SELECTORS) {
            const loc = page.locator(sel).first();
            if (await loc.count()) {
              try {
                if (await loc.isVisible({ timeout: 1500 })) {
                  log('Clicking Enter (' + sel + ') in 2-4s…');
                  await page.waitForTimeout(2000 + Math.random() * 2000);
                  await loc.click({ timeout: 5000 });
                  entered = true;
                  break;
                }
              } catch (_) {}
            }
          }
          if (entered) {
            log('Entered EQL drop. Continuing to watch for selection.');
          } else {
            log('No EQL Enter button visible — click it manually if there is one.');
          }
        }
      } else if (p.state === 'SELECTED') {
        notify(`${tag} 🎉 you're in!`, 'Purchase page opened. Move fast.');
        if (CONFIG.openOnClear) openInBrowser(p.url);
        // Close other profiles too — the mission is accomplished.
        if (CONFIG.closeOthersOnClear) {
          for (const [i, { context: otherCtx }] of profileContexts) {
            if (i !== index) otherCtx.close().catch(() => {});
          }
        }
        break;
      } else if (p.state === 'NOT_SELECTED') {
        notify(`${tag} not selected`, 'Better luck next drop. This profile stopping.');
        break;
      }
      // WAITING_ROOM and DROP_ENTERED transitions are intentionally silent —
      // you can see them on the browser window. No notify() call.
    }

    await page.waitForTimeout(CONFIG.pollIntervalMs);
  }

  log('Exiting.');
}

// ---------- main ----------
(async () => {
  log = (...a) => CONFIG.verbose && console.log(new Date().toISOString().slice(11, 19), '[main]', ...a);
  fs.mkdirSync(CONFIG.profileBaseDir, { recursive: true });

  log(`Starting ${CONFIG.profileCount} parallel profile(s)…`);

  // Run all profiles concurrently. If one crashes, the others keep going.
  const tasks = [];
  for (let i = 0; i < CONFIG.profileCount; i++) {
    tasks.push(runProfile(i, CONFIG.profileCount).catch(e => {
      console.error(`[Profile ${i + 1}] fatal:`, e.message);
      notify(`Toymate: profile ${i + 1} crashed`, String(e.message || e), false);
    }));
  }

  // Heartbeat so you can see the watcher is alive even when nothing's happening.
  const heartbeat = setInterval(() => {
    if (!CONFIG.verbose) return;
    const cleared = Array.from(profileContexts.values()).filter(c => c.cleared).length;
    console.log(new Date().toISOString().slice(11, 19), '[main]',
      `profiles=${profileContexts.size}/${CONFIG.profileCount} cleared=${cleared}`);
  }, 60_000);
  heartbeat.unref();

  await Promise.allSettled(tasks);
  log('All profiles finished.');
  process.exit(0);
})().catch((err) => {
  console.error('Fatal:', err);
  notify('Toymate watcher crashed', String(err && err.message || err), false);
  process.exit(1);
});

// Local log shim so the early main() logs work before the reassignment above.
function log() {}
