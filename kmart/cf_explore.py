"""Probe Kmart product page DOM: buttons, add-to-cart controls, key text."""
import sys
import time
from camoufox.sync_api import Camoufox

PRODUCT_URL = "https://www.kmart.com.au/product/4m-trees-gift-wrapping-paper-43768202/"
EVIDENCE = "/Users/bryankho/Code/queue-headed/kmart/evidence"

PROBE_JS = """
() => {
  const out = { buttons: [], links: [], inputs: [], headings: [], bodyTextSample: '' };
  document.querySelectorAll('button, [role="button"]').forEach((el) => {
    const t = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
    if (t) out.buttons.push({ text: t, id: el.id || '', testid: el.getAttribute('data-testid') || '', cls: (el.className || '').toString().slice(0, 80), visible: el.offsetParent !== null });
  });
  document.querySelectorAll('a[href*="cart" i]').forEach((el) => {
    const t = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
    out.links.push({ href: el.getAttribute('href'), text: t });
  });
  document.querySelectorAll('input, select, textarea').forEach((el) => {
    out.inputs.push({ tag: el.tagName, type: el.type || '', name: el.name || '', ph: el.placeholder || '', label: el.getAttribute('aria-label') || '' });
  });
  document.querySelectorAll('h1, h2').forEach((el) => out.headings.push((el.textContent || '').trim().slice(0, 100)));
  out.bodyTextSample = document.body.innerText.slice(0, 1500);
  return out;
}
"""

def main() -> int:
    with Camoufox(headless=False) as browser:
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        resp = page.goto(PRODUCT_URL, timeout=60_000, wait_until="domcontentloaded")
        time.sleep(6)
        print(f"[p1] status={resp.status if resp else None} title={page.title()!r}")
        info = page.evaluate(PROBE_JS)
        print("[p1] headings:", info["headings"][:5])
        print(f"[p1] buttons ({len(info['buttons'])}):")
        for b in info["buttons"][:25]:
            print("   -", b)
        print(f"[p1] cart links ({len(info['links'])}):")
        for l in info["links"][:10]:
            print("   -", l)
        print(f"[p1] inputs ({len(info['inputs'])}):")
        for i in info["inputs"][:10]:
            print("   -", i)
        print("[p1] body sample:", info["bodyTextSample"][:800].replace("\n", " | "))
        open(f"{EVIDENCE}/dom_cf_product.html", "w").write(page.content())
        page.screenshot(path=f"{EVIDENCE}/cf-product-probe.png", full_page=False)
    return 0

if __name__ == "__main__":
    sys.exit(main())
