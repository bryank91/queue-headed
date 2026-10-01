'use strict';

/** Smoke test: launch headed browser, load kmart.com.au, screenshot. */
const { launchContext, shot, pickExecutable } = require('./stealth');

async function main() {
  console.log('[smoke] executable:', pickExecutable() || '(bundled Chromium)');
  const context = await launchContext({ freshProfile: true });
  const page = await context.newPage();
  await page.goto('https://www.kmart.com.au/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await context._sleep(4000);
  const html = await page.content();
  const blocked = /access denied|unusual traffic|are you a robot|captcha/i.test(html);
  console.log('[smoke] url:', page.url());
  console.log('[smoke] title:', await page.title());
  console.log('[smoke] blocked:', blocked);
  await shot(context, blocked ? 'smoke-blocked' : 'smoke-home');
  await new Promise((r) => setTimeout(r, 5000));
  await context.close();
  process.exit(blocked ? 2 : 0);
}

main().catch((e) => {
  console.error('[smoke] FATAL:', e);
  process.exit(1);
});
