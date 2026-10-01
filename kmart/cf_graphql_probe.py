"""Capture GraphQL response bodies: add-to-bag mutation + cart query."""
import os
import re
import sys
import json
import time
from camoufox.sync_api import Camoufox

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cf_checkout import (HOME_URL, PRODUCT_URL, CART_URL, safe_goto)

STATIC = re.compile(r"\.(js|css|png|jpe?g|webp|svg|woff2?|ico|mp4|gif)(\?|$)", re.I)

def summarize(body_text, label):
    print(f"\n===== {label} (len={len(body_text)}) =====")
    try:
        j = json.loads(body_text)
        s = json.dumps(j)
    except Exception:
        s = body_text
    # search for item names / errors / cart size
    for pat in [r'4m Trees', r'Gift Wrapping', r'"errors"', r'"totalCount"', r'"items"', r'addItemsToCart', r'cartId', r'"quantity"', r'OutOfStock', r'"success"']:
        n = len(re.findall(pat, s))
        if n:
            print(f"   {pat}: {n}")
    # show error block if present
    m = re.search(r'"errors":(\[.*?\])\s*[,}]', s)
    if m:
        print("   ERRORS:", m.group(1)[:500])
    # show a slice around 'items'
    i = s.find('"items"')
    if i > -1:
        print("   items slice:", s[i:i+400])

def main() -> int:
    caps = []  # (phase, url, status, body)
    phase = {"name": "init"}
    with Camoufox(headless=False) as browser:
        page = browser.new_page(viewport={"width": 1440, "height": 900})

        def on_resp(resp):
            u = resp.url
            if "gateway/graphql" not in u:
                return
            try:
                body = resp.text()
            except Exception:
                body = ""
            caps.append((phase["name"], resp.status, body))

        page.on("response", on_resp)

        safe_goto(page, HOME_URL, "home", retries=2)
        page.wait_for_timeout(3000)
        safe_goto(page, PRODUCT_URL, "product", retries=4, after_wait=4.0)
        page.wait_for_selector('[data-testid="product-button"]', timeout=30_000, state="attached")
        page.wait_for_timeout(1000)
        phase["name"] = "add-to-bag"
        page.locator('button[data-testid="product-button"]').click()
        page.wait_for_timeout(5000)
        phase["name"] = "cart-page"
        page.goto(CART_URL, timeout=60_000, wait_until="domcontentloaded")
        page.wait_for_timeout(12000)

    print(f"[g] {len(caps)} graphql responses captured")
    for name, status, body in caps:
        summarize(body, f"{name} status={status}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
