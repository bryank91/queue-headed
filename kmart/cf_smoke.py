"""Camoufox smoke test: can we load the Kmart product page?"""
import sys
import time
from camoufox.sync_api import Camoufox

PRODUCT_URL = "https://www.kmart.com.au/product/4m-trees-gift-wrapping-paper-43768202/"
EVIDENCE = "/Users/bryankho/Code/queue-headed/kmart/evidence"

def main() -> int:
    with Camoufox(headless=False, humanize=False) as browser:
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        print("[cf1] goto product page...")
        resp = page.goto(PRODUCT_URL, timeout=60_000, wait_until="domcontentloaded")
        time.sleep(4)
        status = resp.status if resp else None
        title = page.title()
        content = page.content()
        blocked = "access denied" in content.lower()
        print(f"[cf1] status={status} title={title!r} blocked={blocked}")
        # Akamai cookie state
        for c in page.context.cookies("https://www.kmart.com.au"):
            if c["name"] in ("_abck", "ak_bmsc"):
                val = c["value"]
                print(f"[cf1] cookie {c['name']} = {val[:40]}{'...' if len(val) > 40 else ''} (status={val.split('~')[1] if c['name'] == '_abck' else '-'})")
        page.screenshot(path=f"{EVIDENCE}/cf-smoke-{'blocked' if blocked else 'product'}.png")
        page.evaluate("() => { document.title; }")
        print(f"[cf1] UA: {page.evaluate('navigator.userAgent')}")
        return 0 if not blocked else 2

if __name__ == "__main__":
    sys.exit(main())
