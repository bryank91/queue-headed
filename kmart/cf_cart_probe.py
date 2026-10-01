"""Probe: add to bag, go to cart, WAIT for item to render, dump selectors."""
import os
import re
import sys
import time
from camoufox.sync_api import Camoufox

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cf_checkout import (HOME_URL, PRODUCT_URL, CART_URL, EVIDENCE,
                         safe_goto, shot, dump, visible_buttons)

def main() -> int:
    with Camoufox(headless=False) as browser:
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        print("[p] warmup + product")
        safe_goto(page, HOME_URL, "home", retries=2)
        page.wait_for_timeout(4000)
        safe_goto(page, PRODUCT_URL, "product", retries=4, after_wait=4.0)
        page.wait_for_selector('[data-testid="product-button"]', timeout=30_000, state="attached")
        page.wait_for_timeout(1500)
        page.locator('button[data-testid="product-button"]').click()
        print("[p] clicked add-to-bag")
        page.wait_for_timeout(3000)
        shot(page, "probe-after-add")
        # go to cart
        safe_goto(page, CART_URL, "cart", retries=3)
        # POLL for the item to render (SPA async)
        found = False
        for i in range(30):
            body = page.inner_text("body")
            if "4m Trees" in body:
                found = True
                print(f"[p] item rendered after ~{i*1.5:.0f}s")
                break
            page.wait_for_timeout(1500)
        print(f"[p] item found={found}")
        shot(page, "probe-cart")
        dump(page, "probe-cart")
        print("[p] visible buttons:")
        for b in visible_buttons(page):
            print("   -", b)
        # quantity / price / checkout button details
        info = page.evaluate("""() => {
          const out = {qty:null, subtotal:null, checkoutBtns:[], itemNodes:0};
          const q = document.querySelector('input[type=number]'); if(q) out.qty=q.value;
          const subs = Array.from(document.querySelectorAll('*')).filter(e=>/subtotal/i.test(e.textContent||'') && e.children.length<3);
          if(subs.length) out.subtotal = subs[subs.length-1].textContent.trim().slice(0,60);
          document.querySelectorAll('button, a[role=button], [role=button]').forEach(el=>{
            const t=(el.textContent||'').trim().replace(/\\s+/g,' ');
            if(/checkout/i.test(t) && el.offsetParent!==null) out.checkoutBtns.push({text:t.slice(0,50), testid:el.getAttribute('data-testid')||'', cls:(el.className||'').toString().slice(0,60), href:el.getAttribute('href')||''});
          });
          out.itemNodes = document.querySelectorAll('[data-testid*="item" i], [class*="line-item" i], [class*="cart-item" i]').length;
          return out;
        }""")
        print("[p] info:", info)
    return 0

if __name__ == "__main__":
    sys.exit(main())
