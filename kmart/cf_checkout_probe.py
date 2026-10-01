"""Probe: add to bag, then navigate DIRECTLY to /checkout. See what renders."""
import os
import re
import sys
import time
from camoufox.sync_api import Camoufox

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cf_checkout import (HOME_URL, PRODUCT_URL, EVIDENCE, safe_goto, shot, dump, visible_buttons)

def try_checkout_urls(page, base):
    for u in [base + "/checkout", base + "/checkout/", base + "/cart/checkout"]:
        print(f"[c] try {u}")
        page.goto(u, timeout=60_000, wait_until="domcontentloaded")
        page.wait_for_timeout(8000)
        body = page.inner_text("body")
        blocked = "access denied" in body.lower()
        has_item = "4m Trees" in body
        print(f"[c]   blocked={blocked} has_item={has_item} title={page.title()!r} len={len(body)}")
        if not blocked and (has_item or re.search(r'checkout|shipping|delivery|sign in|guest|email', body, re.I)):
            return u
    return None

def main() -> int:
    base = "https://www.kmart.com.au"
    with Camoufox(headless=False) as browser:
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        safe_goto(page, HOME_URL, "home", retries=2)
        page.wait_for_timeout(3000)
        safe_goto(page, PRODUCT_URL, "product", retries=4, after_wait=4.0)
        page.wait_for_selector('[data-testid="product-button"]', timeout=30_000, state="attached")
        page.wait_for_timeout(1000)
        page.locator('button[data-testid="product-button"]').click()
        print("[c] clicked add-to-bag")
        page.wait_for_timeout(3000)
        url = try_checkout_urls(page, base)
        print(f"[c] checkout url = {url}")
        if url:
            shot(page, "probe-checkout")
            dump(page, "probe-checkout")
            print("[c] visible buttons:")
            for b in visible_buttons(page):
                print("   -", b)
        else:
            print("[c] no checkout url worked; last url=", page.url)
            dump(page, "probe-checkout-fail")
    return 0

if __name__ == "__main__":
    sys.exit(main())
