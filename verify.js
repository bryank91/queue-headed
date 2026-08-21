#!/usr/bin/env node
// Quick inspector: opens toymate.com.au in real Chrome and dumps what it sees.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const userDataDir = path.join(process.env.HOME, 'toymate-watcher', 'chrome-profile');
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 900 },
    locale: 'en-AU',
    timezoneId: 'Australia/Sydney',
    args: [
      '--disable-blink-features=AutomationControlled',
    ],
  });
  const page = await context.newPage();

  console.log('Navigating to https://toymate.com.au/ ...');
  const resp = await page.goto('https://toymate.com.au/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('  status:', resp && resp.status(), '|', resp && resp.url());

  // Wait for JS to render
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => console.log('  networkidle timeout (ok)'));

  const title = await page.title();
  console.log('Title:', title);

  const finalUrl = page.url();
  console.log('Final URL:', finalUrl);

  // Dump all link hrefs that look interesting
  const links = await page.$$eval('a[href]', as => as.map(a => ({
    text: (a.innerText || '').trim().slice(0, 80),
    href: a.getAttribute('href'),
  })));
  console.log(`\nLinks (${links.length} total):`);
  for (const l of links) {
    const interesting = /(runfair|eql|queue|drop|launch|waitlist|pokemon|trading|sneaker|raffle)/i.test(l.text + ' ' + (l.href||''));
    if (interesting) console.log('  *', l.href, '||', l.text);
  }
  // Print the first 20 links too so we see the menu structure
  console.log('\nFirst 20 links:');
  for (const l of links.slice(0, 20)) console.log('  -', l.href, '||', l.text);

  // Look for queue/launch/raffle/waitlist/drop text anywhere on the page
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const keywords = ['queue', 'launch', 'drop', 'raffle', 'waitlist', 'enter', 'join', 'fair', 'eql', 'runfair', 'pokemon'];
  console.log('\nKeyword hits in body text:');
  for (const k of keywords) {
    const re = new RegExp(`\\b${k}\\b`, 'i');
    if (re.test(bodyText)) {
      const idx = bodyText.search(re);
      const excerpt = bodyText.slice(Math.max(0, idx - 40), idx + 80).replace(/\s+/g, ' ');
      console.log(`  [${k}] ...${excerpt}...`);
    }
  }

  // Look for the EQL script tags specifically
  const scripts = await page.$$eval('script[src]', ss => ss.map(s => s.getAttribute('src')));
  const eqlScripts = scripts.filter(s => /eql|runfair/i.test(s || ''));
  console.log('\nEQL/runfair script tags:', eqlScripts.length ? eqlScripts : 'none');
  if (scripts.length) console.log('First 5 script srcs:', scripts.slice(0, 5));

  // Save the full HTML for offline inspection
  const fs = require('fs');
  fs.writeFileSync('/tmp/toymate.html', await page.content());
  console.log('\nFull HTML saved to /tmp/toymate.html');

  await context.close();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
