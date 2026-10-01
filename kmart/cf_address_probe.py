"""Probe the addressInfo autocomplete: type candidate addresses, capture suggestions."""
import os
import re
import sys
import time
from camoufox.sync_api import Camoufox

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cf_checkout import (HOME_URL, PRODUCT_URL, EVIDENCE, safe_goto, shot, dump)

CANDIDATES = [
    "100 City Road Southbank VIC 3006",
]

def get_options(page):
    return page.evaluate("""() => {
      const opts = [];
      document.querySelectorAll('[role="option"], .MuiAutocomplete-option, li[role="option"]').forEach(o => {
        opts.push((o.textContent||'').trim().replace(/\\s+/g,' '));
      });
      const lb = document.querySelector('[role="listbox"]');
      return { count: opts.length, options: opts.slice(0,10), listboxVisible: !!(lb && lb.offsetParent!==null) };
    }""")

def type_address(page, text):
    loc = page.locator('#addressInfo')
    loc.scroll_into_view_if_needed(timeout=10_000)
    loc.click()
    loc.fill("")
    loc.press_sequentially(text, delay=35)
    page.wait_for_timeout(2500)

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
        page.wait_for_timeout(3000)
        page.goto(base + "/checkout", timeout=60_000, wait_until="domcontentloaded")
        page.wait_for_timeout(6000)
        # fill the simple fields
        page.fill('#email', "alex.sample.kmart2026@example.com")
        page.fill('#firstName', "Alex")
        page.fill('#lastName', "Sample")
        page.fill('#phone', "0400 000 000")
        print("[a] filled basic fields")
        page.get_by_role("button", name="Continue to delivery", exact=True).click()
        page.locator('#addressInfo').wait_for(state="visible", timeout=20_000)
        page.wait_for_timeout(1500)
        print("[a] advanced to delivery/address step")
        address = page.locator('#addressInfo')
        print(f"[a] address count={address.count()} visible={address.is_visible()}")
        print("[a] address diagnostics:", address.evaluate("""el => {
          const chain = []; let n = el;
          while (n && chain.length < 10) {
            const s = getComputedStyle(n), r = n.getBoundingClientRect();
            chain.push({tag:n.tagName, id:n.id, cls:n.className,
              display:s.display, visibility:s.visibility, opacity:s.opacity,
              rect:[r.x,r.y,r.width,r.height]});
            n = n.parentElement;
          }
          return chain;
        }"""))
        shot(page, "addr-before-type")
        for cand in CANDIDATES:
            print(f"\n[a] TYPE: {cand!r}")
            type_address(page, cand)
            opts = get_options(page)
            print(f"    -> listboxVisible={opts['listboxVisible']} options={opts['count']}")
            for o in opts["options"]:
                print("       *", o[:90])
            if opts["count"] > 0:
                dump(page, f"addr-cand-{cand[:12].replace(' ','')}")
                shot(page, f"addr-cand-{cand[:12].replace(' ','')}")
                # try selecting first option via keyboard
                page.keyboard.press("ArrowDown")
                page.wait_for_timeout(500)
                page.keyboard.press("Enter")
                page.wait_for_timeout(8000)
                val = page.input_value('#addressInfo')
                cont = page.locator('[data-testid="continueToPaymentButton"]')
                print(f"    -> after Down+Enter, addressInfo value={val!r}")
                print(f"    -> continue visible={cont.is_visible()} enabled={cont.is_enabled()}")
                print("    -> delivery form text:", page.locator('#delivery-form').inner_text()[:2000])
                dump(page, "addr-after-select")
                shot(page, "addr-after-select")
                break
    return 0

if __name__ == "__main__":
    sys.exit(main())
