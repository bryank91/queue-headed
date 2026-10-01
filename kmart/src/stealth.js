'use strict';

const fs = require('fs');
const { chromium } = require('playwright');
const cfg = require('./config');

/** Pick the best available real browser executable. */
function pickExecutable() {
  for (const p of cfg.candidateExecutables) {
    if (fs.existsSync(p)) return p;
  }
  return undefined; // fall back to Playwright's bundled Chromium
}

/**
 * Launch a persistent, headed browser context with anti-bot hygiene:
 * - real installed Chrome/Brave binary (real fingerprint, no HeadlessChrome UA)
 * - persistent user-data-dir (realistic cookies/localStorage across runs)
 * - no automation flags that leak CDP
 */
async function launchContext({ freshProfile = false } = {}) {
  const fs2 = require('fs');
  let profileDir = cfg.profileDir;
  if (freshProfile) {
    profileDir = `${cfg.profileDir}-${Date.now()}`;
  }
  fs2.mkdirSync(profileDir, { recursive: true });
  fs2.mkdirSync(cfg.evidenceDir, { recursive: true });

  const executablePath = pickExecutable();
  console.log(`[stealth] executable: ${executablePath || '(bundled Chromium)'}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    executablePath,
    channel: undefined,
    viewport: cfg.viewport,
    locale: 'en-AU',
    timezoneId: 'Australia/Melbourne',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  // Minimal stealth: hide webdriver flag, keep everything else native.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  // Polite human-ish pacing helper.
  context._sleep = (ms = 800) => new Promise((r) => setTimeout(r, ms + Math.random() * 600));

  return context;
}

/** Timestamped screenshot into the evidence dir. */
async function shot(context, name) {
  const file = `${cfg.evidenceDir}/${new Date().toISOString().replace(/[:.]/g, '-')}_${name}.png`;
  const page = context.pages()[context.pages().length - 1] || (await context.newPage());
  await page.screenshot({ path: file, fullPage: false });
  console.log(`[evidence] ${file}`);
  return file;
}

module.exports = { launchContext, shot, pickExecutable };
