#!/usr/bin/env node
/**
 * Quick inspector for toymate.com.au — opens the site in real Chrome and
 * dumps what it sees. Useful for debugging state detection before running the
 * full watcher.
 *
 * ⚠️  Like watcher.js, this might only work with toymate.com.au. The URL,
 * locale, and timezone are hardcoded for Toymate.
 *
 * Run:
 *   node verify.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const URL          = 'https://toymate.com.au/';
const PROFILE_DIR  = path.join(process.env.HOME, 'queue-headed', 'profiles', 'profile-verify');

(async () => {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 900 },
    locale: 'en-AU',
    timezoneId: 'Australia/Sydney',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = await context.newPage();

  console.log('Navigating to', URL, '...');
  const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('  status:', resp && resp.status(), '|', resp && resp.url());

  await page.waitForLoadState('networkidle', { timeout: 20000 })
    .catch(() => console.log('  networkidle timeout (ok — Cloudflare challenges don\'t networkidle)'));

  console.log('Title:', await page.title());
  console.log('Final URL:', page.url());

  const links = await page.$$eval('a[href]', as => as.map(a => ({
    text: (a.innerText || '').trim().slice(0, 80),
    href: a.getAttribute('href'),
  })));
  console.log(`\nLinks (${links.length} total):`);
  for (const l of links) {
    const interesting = /(runfair|eql|queue|drop|launch|waitlist|pokemon|trading|sneaker|raffle)/i.test(l.text + ' ' + (l.href||''));
    if (interesting) console.log('  *', l.href, '||', l.text);
  }
  console.log('\nFirst 20 links:');
  for (const l of links.slice(0, 20)) console.log('  -', l.href, '||', l.text);

  const bodyText = await page.locator('body').innerText().catch(() => '');
  const keywords = ['queue', 'launch', 'drop', 'raffle', 'waitlist', 'enter', 'join', 'fair', 'eql', 'runfair', 'pokemon', 'waiting room'];
  console.log('\nKeyword hits in body text:');
  for (const k of keywords) {
    const re = new RegExp(`\\b${k}\\b`, 'i');
    if (re.test(bodyText)) {
      const idx = bodyText.search(re);
      const excerpt = bodyText.slice(Math.max(0, idx - 40), idx + 80).replace(/\s+/g, ' ');
      console.log(`  [${k}] ...${excerpt}...`);
    }
  }

  const scripts = await page.$$eval('script[src]', ss => ss.map(s => s.getAttribute('src')));
  const eqlScripts = scripts.filter(s => /eql|runfair/i.test(s || ''));
  console.log('\nEQL/runfair script tags:', eqlScripts.length ? eqlScripts : 'none');
  if (scripts.length) console.log('First 5 script srcs:', scripts.slice(0, 5));

  fs.writeFileSync('/tmp/queue-headed-inspect.html', await page.content());
  console.log('\nFull HTML saved to /tmp/queue-headed-inspect.html');

  await context.close();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });