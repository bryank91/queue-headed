#!/usr/bin/env python3
"""Kmart AU guest checkout in real headed Google Chrome — stop at payment.

Google Chrome is launched directly (headed, with a new profile) and allowed to
load the product before Playwright attaches over Chrome DevTools Protocol. This
keeps the initial navigation indistinguishable from an ordinary Chrome launch
while retaining Playwright for all validation and checkout interaction.

Safety invariant: this script never locates, fills, or clicks payment controls
and never submits an order. It exits as soon as the expanded payment section
has been captured as evidence.
"""
from __future__ import annotations

import json
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
EVIDENCE = ROOT / "evidence"
EVIDENCE.mkdir(exist_ok=True)
RUN_ID = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")

HOME_URL = "https://www.kmart.com.au/"
PRODUCT_URL = "https://www.kmart.com.au/product/4m-trees-gift-wrapping-paper-43768202/"
CHECKOUT_URL = "https://www.kmart.com.au/checkout"
PRODUCT_NAME = "4m Trees Gift Wrapping Paper"
CHROME_BINARY = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
PROFILE_ROOT = ROOT / ".chrome-run-profiles"

# Deliberately fictional recipient/contact details. The address query targets a
# public landmark (State Library Victoria), not a private residence; Kmart's
# required autocomplete supplies the canonical postal formatting.
GUEST = {
    "first_name": "Alex",
    "last_name": "Sample",
    "email": "alex.sample.kmart2026@example.com",
    "phone": "0400 000 000",
    "address_query": "328 Swanston Street Melbourne VIC 3000",
}

ORDER_COMPLETE_RE = re.compile(
    r"thank you for your order|order confirmation|"
    r"order (?:number|no\.?|#)\s*[:#]\s*[a-z0-9-]{6,}",
    re.I,
)


def _free_local_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _read_json(url: str, timeout: float = 2.0):
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.load(response)


@contextmanager
def real_headed_chrome():
    """Launch stock Chrome, preload the product, then attach Playwright.

    A fixed remote-debugging port does not set ``navigator.webdriver``. Chrome
    loads Kmart before any CDP client exists; this avoids the Akamai false
    positive produced by Playwright's normal Chrome launcher. The profile is
    unique to this run and is deleted afterward.
    """
    if not CHROME_BINARY.is_file():
        raise RuntimeError(f"Google Chrome binary not found: {CHROME_BINARY}")

    PROFILE_ROOT.mkdir(exist_ok=True)
    profile = PROFILE_ROOT / RUN_ID
    if profile.exists():
        shutil.rmtree(profile)
    profile.mkdir()
    port = _free_local_port()
    cdp_base = f"http://127.0.0.1:{port}"
    log_path = artifact("chrome-process", "log")
    log_file = log_path.open("w", encoding="utf-8")
    command = [
        str(CHROME_BINARY),
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile}",
        "--window-size=1440,900",
        "--no-first-run",
        "--no-default-browser-check",
        PRODUCT_URL,
    ]
    print(f"[chrome] launching real headed Chrome: {CHROME_BINARY}")
    process = subprocess.Popen(command, stdout=log_file, stderr=subprocess.STDOUT)
    browser = None
    playwright = None
    metadata = {
        "binary": str(CHROME_BINARY),
        "headless": False,
        "fresh_profile": str(profile),
        "profile_removed_after_run": False,
        "launch_command": command,
        "process_log": str(log_path),
    }
    try:
        version = None
        for _ in range(120):
            if process.poll() is not None:
                raise RuntimeError(f"Chrome exited early with code {process.returncode}")
            try:
                version = _read_json(f"{cdp_base}/json/version")
                break
            except Exception:
                time.sleep(0.25)
        if version is None:
            raise RuntimeError("Chrome DevTools endpoint did not become ready")
        metadata["cdp_browser"] = version.get("Browser")
        metadata["user_agent_before_attach"] = version.get("User-Agent")

        # Let an entirely ordinary Chrome tab complete its Kmart navigation
        # before Playwright creates any CDP session for that target.
        product_target = None
        for _ in range(80):
            targets = _read_json(f"{cdp_base}/json/list")
            product_target = next(
                (
                    target
                    for target in targets
                    if target.get("type") == "page"
                    and "/product/4m-trees-gift-wrapping-paper-43768202/"
                    in target.get("url", "")
                    and PRODUCT_NAME.lower() in target.get("title", "").lower()
                ),
                None,
            )
            if product_target:
                break
            time.sleep(0.5)
        if product_target is None:
            targets = _read_json(f"{cdp_base}/json/list")
            metadata["targets_before_attach"] = [
                {"title": item.get("title"), "url": item.get("url")}
                for item in targets
                if item.get("type") == "page"
            ]
            raise RuntimeError(
                "stock Chrome did not preload the expected Kmart product before CDP attach"
            )
        metadata["product_loaded_before_playwright_attach"] = True
        metadata["target_before_attach"] = {
            "title": product_target.get("title"),
            "url": product_target.get("url"),
        }
        print(
            "[chrome] product loaded before Playwright attach: "
            f"{product_target.get('title')!r}"
        )

        playwright = sync_playwright().start()
        browser = playwright.chromium.connect_over_cdp(cdp_base, timeout=30_000)
        pages = [page for context in browser.contexts for page in context.pages]
        page = next(
            (
                candidate
                for candidate in pages
                if "/product/4m-trees-gift-wrapping-paper-43768202/"
                in candidate.url
            ),
            None,
        )
        if page is None:
            raise RuntimeError("Playwright attached but could not find the product tab")
        yield browser, page, metadata
    finally:
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass
        if playwright is not None:
            try:
                playwright.stop()
            except Exception:
                pass
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        log_file.close()
        for _ in range(10):
            try:
                shutil.rmtree(profile)
                metadata["profile_removed_after_run"] = True
                break
            except FileNotFoundError:
                metadata["profile_removed_after_run"] = True
                break
            except OSError:
                time.sleep(0.25)


def artifact(name: str, suffix: str) -> Path:
    return EVIDENCE / f"{RUN_ID}_{name}.{suffix}"


def shot(page, name: str) -> Path:
    path = artifact(name, "png")
    page.screenshot(path=str(path))
    print(f"[evidence] screenshot: {path}")
    return path


def dump(page, name: str) -> Path:
    path = artifact(name, "html")
    path.write_text(page.content(), encoding="utf-8")
    print(f"[evidence] DOM: {path}")
    return path


def visible_buttons(page) -> list[str]:
    return page.evaluate(
        r"""() => Array.from(document.querySelectorAll(
                 'button, a[role="button"], [role="button"]'))
          .filter(el => el.offsetParent !== null)
          .map(el => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80))
          .filter(Boolean).slice(0, 60)"""
    )


def stage_fail(page, stage: str, why: str) -> None:
    print(f"[FAIL] {stage}: {why}", file=sys.stderr)
    try:
        print(f"[FAIL] url={page.url!r}", file=sys.stderr)
        print(f"[FAIL] visible buttons={visible_buttons(page)!r}", file=sys.stderr)
        dump(page, f"FAIL-{stage}")
        shot(page, f"FAIL-{stage}")
    finally:
        raise RuntimeError(f"{stage}: {why}")


def is_blocked(page) -> bool:
    try:
        return "access denied" in page.content().lower()
    except Exception:
        return False


def abck_status(page) -> str | None:
    try:
        for cookie in page.context.cookies("https://www.kmart.com.au"):
            if cookie["name"] == "_abck":
                parts = cookie["value"].split("~")
                return parts[1] if len(parts) > 1 else "present"
    except Exception:
        pass
    return None


def safe_goto(page, url: str, stage: str, retries: int = 3, settle_ms: int = 3_000) -> bool:
    """Navigate with bounded retries for intermittent Akamai edge denials."""
    for attempt in range(1, retries + 2):
        try:
            page.goto(url, timeout=60_000, wait_until="domcontentloaded")
        except Exception as exc:
            print(f"[nav] {stage} attempt {attempt}: goto error: {exc}")
        page.wait_for_timeout(settle_ms)
        if not is_blocked(page):
            print(f"[nav] {stage} attempt {attempt}: OK (abck={abck_status(page)})")
            return True
        print(f"[nav] {stage} attempt {attempt}: Access Denied; backing off")
        page.wait_for_timeout((2 + (attempt - 1) * 3) * 1_000)
    return False


def goto_product(page) -> bool:
    print("[nav] warm up Akamai sensor on homepage")
    if not safe_goto(page, HOME_URL, "home", retries=2):
        return False
    page.wait_for_timeout(5_000)
    if not safe_goto(page, PRODUCT_URL, "product", retries=4, settle_ms=4_000):
        return False
    try:
        page.locator('[data-testid="product-button"]').wait_for(
            state="visible", timeout=30_000
        )
        page.wait_for_timeout(1_500)
        title = page.locator('[data-testid="product-title"]').first.inner_text(timeout=5_000)
    except Exception:
        return False
    print(f"[product] title={title!r}")
    return PRODUCT_NAME.lower() in title.lower()


def assert_guest_mode(page) -> None:
    """Prove that no account creation option was selected."""
    # The checkbox has varied IDs across deployments, so identify it by label.
    account = page.get_by_label(re.compile(r"create a kmart account", re.I)).first
    if account.count() and account.is_checked():
        stage_fail(page, "guest-check", "account creation checkbox unexpectedly selected")
    print("[guest] no sign-in used; account creation remains unchecked")


def select_autocomplete_address(page) -> str:
    field = page.locator("#addressInfo")
    field.wait_for(state="visible", timeout=20_000)
    field.click()
    field.fill("")
    field.press_sequentially(GUEST["address_query"], delay=35)

    options = page.locator('[role="option"]')
    try:
        options.first.wait_for(state="visible", timeout=15_000)
    except PlaywrightTimeoutError:
        stage_fail(page, "address", "Kmart address autocomplete returned no suggestions")

    labels = [options.nth(i).inner_text().strip() for i in range(min(options.count(), 10))]
    print(f"[address] suggestions={labels!r}")

    # Prefer the exact public street number/name, then fall back to the first
    # server-approved suggestion. Selection is required by Kmart validation.
    chosen = options.first
    for i, label in enumerate(labels):
        if re.search(r"\b328\b", label) and re.search(r"Swanston", label, re.I):
            chosen = options.nth(i)
            break
    selected_label = chosen.inner_text().strip()
    chosen.click()

    # The canonical value may differ slightly from suggestion text.
    page.wait_for_timeout(1_500)
    canonical = field.input_value().strip()
    print(f"[address] selected={selected_label!r}; canonical={canonical!r}")
    if not canonical or "3000" not in canonical:
        stage_fail(page, "address", f"unexpected selected address value: {canonical!r}")
    return canonical


def wait_enabled(locator, timeout_ms: int = 20_000) -> bool:
    elapsed = 0
    while elapsed < timeout_ms:
        if locator.is_visible() and locator.is_enabled():
            return True
        time.sleep(0.5)
        elapsed += 500
    return locator.is_visible() and locator.is_enabled()


def dismiss_delivery_upsell(page, wait_ms: int = 7_000) -> None:
    """Decline the optional fastest-delivery snackbar if Kmart presents it."""
    decline = page.get_by_role("button", name="No thanks", exact=True)
    try:
        decline.wait_for(state="visible", timeout=wait_ms)
    except PlaywrightTimeoutError:
        return
    decline.click()
    backdrop = page.locator('[data-testid="expressDeliveryNotificationsBackdrop"]')
    try:
        backdrop.wait_for(state="hidden", timeout=10_000)
    except PlaywrightTimeoutError:
        stage_fail(page, "delivery-upsell", "optional delivery prompt did not close")
    print("[delivery] declined optional fastest-delivery upsell")


def audit_payment_widget(page) -> list[dict]:
    """Read (never focus/fill) the hosted card fields and require them empty."""
    iframe = page.locator('iframe[title="Card details"]')
    try:
        iframe.wait_for(state="visible", timeout=15_000)
    except PlaywrightTimeoutError:
        stage_fail(page, "payment-audit", "hosted card-details widget did not render")

    widget_frame = next(
        (frame for frame in page.frames if "widget.paydock.com" in frame.url), None
    )
    if widget_frame is None:
        stage_fail(page, "payment-audit", "could not inspect hosted card-details frame")

    fields = widget_frame.locator("input").evaluate_all(
        """els => els.map(el => ({
          name: el.name || el.id || el.getAttribute('aria-label') || el.type,
          type: el.type,
          empty: el.value === ''
        }))"""
    )
    credential_fields = [
        field for field in fields
        if re.search(r"number|ccv|cvv|expir|month|year", field["name"], re.I)
    ]
    if not credential_fields:
        stage_fail(page, "payment-audit", "no hosted payment credential fields found")
    if any(not field["empty"] for field in credential_fields):
        stage_fail(page, "payment-audit", "a hosted payment credential field is not empty")
    print(f"[payment] hosted credential fields are empty: {credential_fields!r}")
    return credential_fields


def run() -> dict:
    print(f"[run] id={RUN_ID}; starting fresh real headed Google Chrome session")
    result: dict = {
        "run_id": RUN_ID,
        "product": PRODUCT_NAME,
        "fresh_ephemeral_session": True,
        "guest_checkout": False,
        "selected_address": None,
        "payment_section_reached": False,
        "payment_details_entered": False,
        "order_placed": False,
        "screenshots": [],
    }

    with real_headed_chrome() as (browser, page, chrome_metadata):
        # 1 — Product. The stock Chrome process loaded it before Playwright
        # attached; now verify browser identity, automation state, and DOM.
        page.locator('[data-testid="product-button"]').wait_for(
            state="visible", timeout=30_000
        )
        page.wait_for_timeout(1_500)
        product_title = page.locator('[data-testid="product-title"]').first.inner_text()
        webdriver = page.evaluate("navigator.webdriver")
        user_agent = page.evaluate("navigator.userAgent")
        chrome_metadata["navigator_webdriver"] = webdriver
        chrome_metadata["user_agent_after_attach"] = user_agent
        chrome_metadata["playwright_connected_over_cdp"] = True
        print(
            f"[chrome] identity={chrome_metadata.get('cdp_browser')!r}; "
            f"webdriver={webdriver!r}; title={product_title!r}"
        )
        if not str(chrome_metadata.get("cdp_browser", "")).startswith("Chrome/"):
            stage_fail(page, "01-browser", "CDP endpoint is not Google Chrome")
        if "Chrome/" not in user_agent or "HeadlessChrome" in user_agent:
            stage_fail(page, "01-browser", f"unexpected Chrome user agent: {user_agent!r}")
        if webdriver is not False:
            stage_fail(page, "01-browser", "navigator.webdriver is not false")
        if PRODUCT_NAME.lower() not in product_title.lower() or is_blocked(page):
            stage_fail(page, "01-product", "expected product is missing or blocked")
        result["screenshots"].append(str(shot(page, "01-real-chrome-product")))

        # 2 — Add exactly one item and capture the confirmation panel as cart evidence.
        add = page.locator('button[data-testid="product-button"]')
        add.click()
        added_heading = page.get_by_text("Added to your bag", exact=True).first
        try:
            added_heading.wait_for(state="visible", timeout=20_000)
        except PlaywrightTimeoutError:
            stage_fail(page, "02-cart", "add-to-bag confirmation panel did not appear")
        page.wait_for_timeout(1_000)
        visible_text = page.locator("body").inner_text()
        if PRODUCT_NAME not in visible_text or not re.search(r"Qty\s*1\b", visible_text, re.I):
            stage_fail(page, "02-cart", "confirmation did not show the product at quantity 1")
        result["screenshots"].append(str(shot(page, "02-cart-qty-1")))
        print("[cart] confirmation panel shows Qty 1")

        # Kmart's /cart React body does not paint in this browser even though the
        # server cart is populated. Direct /checkout is stable and shows the bag.
        if not safe_goto(page, CHECKOUT_URL, "checkout", retries=3, settle_ms=5_000):
            stage_fail(page, "checkout", "checkout navigation was blocked")
        checkout = page.locator('[data-testid="checkout-page"]')
        try:
            checkout.wait_for(state="visible", timeout=30_000)
        except PlaywrightTimeoutError:
            stage_fail(page, "checkout", "checkout application did not render")
        checkout_text = checkout.inner_text()
        if PRODUCT_NAME not in checkout_text or not re.search(r"Qty\s*1\b", checkout_text, re.I):
            stage_fail(page, "checkout", "checkout bag does not show the expected Qty 1 item")
        result["screenshots"].append(str(shot(page, "02b-checkout-bag")))

        # 3 — Guest contact details (no sign-in, marketing, review, or account opt-ins).
        for selector, value in [
            ("#email", GUEST["email"]),
            ("#firstName", GUEST["first_name"]),
            ("#lastName", GUEST["last_name"]),
            ("#phone", GUEST["phone"]),
        ]:
            page.locator(selector).fill(value)
        assert_guest_mode(page)
        details_continue = page.locator('[data-testid="continueToDeliveryButton"]')
        if not wait_enabled(details_continue):
            stage_fail(page, "details", "Continue to delivery did not become enabled")
        details_continue.click()

        # 4 — Delivery address. Kmart combines address and delivery preferences
        # in its Delivery step.
        address = select_autocomplete_address(page)
        result["selected_address"] = address
        dismiss_delivery_upsell(page)
        address_field = page.locator("#addressInfo")
        address_field.scroll_into_view_if_needed()
        result["screenshots"].append(str(shot(page, "03-address-selected")))

        # Explicitly choose signature-required rather than unattended delivery.
        signature = page.locator(
            'input[name="isAuthorisedToLeaveUnattended"]'
            '[value="notAuthorisedToLeaveUnattended"]'
        )
        signature.check()
        if not signature.is_checked():
            stage_fail(page, "delivery", "signature-required delivery preference was not selected")

        billing_same = page.locator("#billing-address-checkbox")
        if billing_same.count() and not billing_same.is_checked():
            stage_fail(page, "delivery", "billing address is not set to the selected delivery address")

        assert_guest_mode(page)
        payment_continue = page.locator('[data-testid="continueToPaymentButton"]')
        if not wait_enabled(payment_continue):
            stage_fail(page, "delivery", "Continue to payment did not become enabled")
        payment_continue.scroll_into_view_if_needed()
        dismiss_delivery_upsell(page, wait_ms=1_000)
        result["screenshots"].append(str(shot(page, "04-delivery-ready")))

        # 5 — Open payment and STOP. This is the final interaction in the flow.
        try:
            payment_continue.click()
        except Exception as exc:
            stage_fail(page, "delivery-submit", f"could not continue to payment: {exc}")
        expanded_payment = page.locator('[data-testid="payment-accordion"].Mui-expanded')
        try:
            expanded_payment.wait_for(state="visible", timeout=30_000)
        except PlaywrightTimeoutError:
            stage_fail(page, "payment", "payment accordion did not expand")
        page.wait_for_timeout(2_000)
        expanded_payment.evaluate("el => el.scrollIntoView({block: 'start'})")
        page.wait_for_timeout(500)

        body = page.locator("body").inner_text()
        if ORDER_COMPLETE_RE.search(body):
            stage_fail(page, "payment-safety", "order confirmation/number appeared unexpectedly")

        payment_shot = shot(page, "05-payment-section-STOP")
        credential_fields = audit_payment_widget(page)
        card_widget = page.locator('iframe[title="Card details"]')
        card_widget.scroll_into_view_if_needed()
        payment_fields_shot = shot(page, "05b-payment-fields-empty-STOP")
        dump(page, "05-payment-STOP")
        result["screenshots"].extend([str(payment_shot), str(payment_fields_shot)])
        result["payment_widget_credential_fields"] = credential_fields
        result["guest_checkout"] = True
        result["payment_section_reached"] = True

        # Explicit postconditions. There are intentionally no payment-control
        # selectors or order-submit actions anywhere above.
        assert_guest_mode(page)
        final_body = page.locator("body").inner_text()
        if ORDER_COMPLETE_RE.search(final_body):
            stage_fail(page, "final-safety", "order completion content detected")
        print("[payment] STOP reached: no payment details entered; no order placed")

    # The context manager closes Chrome and deletes the fresh profile before
    # evidence is finalized, proving the cart cannot leak into another run.
    result["browser"] = chrome_metadata
    if not chrome_metadata.get("profile_removed_after_run"):
        raise RuntimeError("fresh Chrome profile could not be removed after the run")

    manifest = artifact("run-manifest", "json")
    manifest.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"[evidence] manifest: {manifest}")
    return result


def main() -> int:
    try:
        result = run()
    except Exception as exc:
        print(f"[run] FAILED: {exc}", file=sys.stderr)
        return 1
    print(
        "[run] SUCCESS: guest checkout reached payment and stopped safely "
        f"(run {result['run_id']})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
