# Kmart AU checkout automation — completed real-Chrome state

The maintained entry point is [`chrome_checkout.py`](chrome_checkout.py). It
runs product → cart → guest details → delivery → payment in one fresh **headed
Google Chrome** session controlled by Playwright over CDP, then stops before any
payment or order action.

## Verified run

Run ID: `2026-10-01T06-52-13Z`

```sh
npm run run
```

The run exited successfully. Key browser proof in the manifest:

- binary: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- CDP browser: `Chrome/154.0.8037.93`
- `headless: false`
- regular Chrome user agent (no `HeadlessChrome`)
- `navigator.webdriver: false`
- `playwright_connected_over_cdp: true`
- fresh profile removed after completion

## Evidence

- `evidence/2026-10-01T06-52-13Z_run-manifest.json`
- `evidence/2026-10-01T06-52-13Z_verification.json`
- `evidence/2026-10-01T06-52-13Z_chrome-process.log`
- `evidence/2026-10-01T06-52-13Z_01-real-chrome-product.png`
- `evidence/2026-10-01T06-52-13Z_02-cart-qty-1.png`
- `evidence/2026-10-01T06-52-13Z_02b-checkout-bag.png`
- `evidence/2026-10-01T06-52-13Z_03-address-selected.png`
- `evidence/2026-10-01T06-52-13Z_04-delivery-ready.png`
- `evidence/2026-10-01T06-52-13Z_05-payment-section-STOP.png`
- `evidence/2026-10-01T06-52-13Z_05b-payment-fields-empty-STOP.png`
- `evidence/2026-10-01T06-52-13Z_05-payment-STOP.html`

The hosted Paydock fields were inspected read-only and were empty for
`cardNumber`, `expiry_date`, and `cardCvv`. No order-confirmation text or order
number appeared, and the final `Check out securely` control was never clicked.

## Why Chrome is launched before Playwright attaches

Kmart's Akamai edge blocks product paths when Chrome is started through the
normal Playwright launcher. The maintained script instead starts stock Chrome
itself on a fixed local debugging port, lets the product finish loading, and
then attaches Playwright. This still uses Playwright for the complete cart and
checkout flow while satisfying the real headed Chrome requirement.
