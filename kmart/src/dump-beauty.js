'use strict';

/** Minimal: load /beauty/ (no humanization) and dump product link structure. */
const { launchContext } = require('./stealth');
const cfg = require('./config');

async function main() {
  const context = await launchContext({ freshProfile: true });
  const page = await context.newPage();
  console.log('[d1] goto home');
  await page.goto(cfg.homeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 4000));
  console.log('[d1] home title:', await page.title());

  console.log('[d2] goto /beauty/');
  await page.goto('https://www.kmart.com.au/beauty/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 5000));
  console.log('[d2] beauty title:', await page.title());

  await page.mouse.wheel(0, 1500);
  await new Promise((r) => setTimeout(r, 3000));

  const info = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/product/"]'));
    return {
      total: links.length,
      sample: links.slice(0, 5).map((a) => {
        const r = a.getBoundingClientRect();
        return { href: a.getAttribute('href')?.slice(0, 80), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), text: a.textContent.trim().slice(0, 30) };
      }),
      scrollY: window.scrollY,
      docHeight: document.body.scrollHeight,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  require('fs').writeFileSync(`${cfg.evidenceDir}/dom_beauty.html`, await page.content());
  console.log('[d3] saved dom_beauty.html');
  await context.close();
}

main().catch((e) => { console.error('[d] FATAL:', e); process.exit(1); });
