"""Network + console probe: what does the cart page request, and what fails?"""
import os
import re
import sys
import time
from camoufox.sync_api import Camoufox

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cf_checkout import (HOME_URL, PRODUCT_URL, CART_URL, safe_goto)

STATIC = re.compile(r"\.(js|css|png|jpe?g|webp|svg|woff2?|ico|mp4|gif)(\?|$)", re.I)

def main() -> int:
    reqs = []
    cons = []
    with Camoufox(headless=False) as browser:
        page = browser.new_page(viewport={"width": 1440, "height": 900})

        def on_resp(resp):
            u = resp.url
            if "kmart.com.au" not in u or STATIC.search(u):
                return
            try:
                ct = resp.headers.get("content-type", "")
            except Exception:
                ct = ""
            reqs.append((resp.status, resp.request.resource_type, ct[:40], u))

        def on_console(msg):
            if msg.type in ("error", "warning"):
                cons.append(f"[{msg.type}] {msg.text[:200]}")

        page.on("response", on_resp)
        page.on("console", on_console)

        safe_goto(page, HOME_URL, "home", retries=2)
        page.wait_for_timeout(3000)
        safe_goto(page, PRODUCT_URL, "product", retries=4, after_wait=4.0)
        page.wait_for_selector('[data-testid="product-button"]', timeout=30_000, state="attached")
        page.wait_for_timeout(1000)
        page.locator('button[data-testid="product-button"]').click()
        page.wait_for_timeout(2500)
        # clear, then go to cart to isolate cart-page requests
        reqs.clear()
        print("[net] goto cart (capturing requests)")
        page.goto(CART_URL, timeout=60_000, wait_until="domcontentloaded")
        page.wait_for_timeout(18000)

        print(f"[net] {len(reqs)} kmart API/network responses on cart page:")
        for status, rtype, ct, u in reqs:
            short = u.replace("https://www.kmart.com.au", "")
            print(f"   {status} {rtype:10s} {ct:38s} {short[:110]}")
        print(f"[net] {len(cons)} console error/warn:")
        for c in cons[:25]:
            print("   ", c)
    return 0

if __name__ == "__main__":
    sys.exit(main())
