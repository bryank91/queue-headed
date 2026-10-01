'use strict';

/** Diagnostic: load homepage, inspect Akamai cookies over time, test a deep path. */
const { launchContext, shot } = require('./stealth');

async function main() {
  const context = await launchContext({ freshProfile: true });
  const page = await context.newPage();

  const dumpCookies = async (tag) => {
    const cookies = await context.cookies('https://www.kmart.com.au');
    console.log(`\n[diag:${tag}] cookies:`);
    for (const c of cookies) {
      const v = c.value.length > 60 ? c.value.slice(0, 60) + `...(${c.value.length})` : c.value;
      console.log(`  ${c.name} = ${v}`);
    }
  };

  await page.goto('https://www.kmart.com.au/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('[diag] homepage loaded, title:', await page.title());
  await dumpCookies('home-immediate');

  await new Promise((r) => setTimeout(r, 8000));
  await dumpCookies('home-after-8s');

  // Is the Akamai sensor script present and did it run?
  const sensorInfo = await page.evaluate(() => {
    const scripts = Array.from(document.scripts).map((s) => s.src).filter((s) => /akam|1XSQI|bmsc|_abck|sensor/i.test(s));
    return {
      akamScripts: scripts,
      akamJs: typeof window.akamJs,
      hasCookieStore: 'cookieStore' in window,
      ua: navigator.userAgent,
      webdriver: navigator.webdriver,
      languages: navigator.languages,
      platform: navigator.platform,
      hwConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
    };
  });
  console.log('\n[diag] sensor/fingerprint:', JSON.stringify(sensorInfo, null, 2));

  // Test: same-origin fetch of the product URL from the page (carries all cookies).
  const fetchTest = await page.evaluate(async () => {
    try {
      const r = await fetch('/product/4m-trees-gift-wrapping-paper-43768202/', { credentials: 'include' });
      const text = await r.text();
      return { status: r.status, isAccessDenied: /access denied/i.test(text), len: text.length };
    } catch (e) {
      return { error: String(e) };
    }
  });
  console.log('\n[diag] in-page fetch of product URL:', JSON.stringify(fetchTest));

  await new Promise((r) => setTimeout(r, 5000));
  await context.close();
}

main().catch((e) => {
  console.error('[diag] FATAL:', e);
  process.exit(1);
});
