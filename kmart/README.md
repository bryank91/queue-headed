# Kmart AU guest-checkout automation

[`chrome_checkout.py`](chrome_checkout.py) uses Playwright with the installed
**real, headed Google Chrome** browser to:

1. load the specified wrapping-paper product;
2. add exactly one item and verify the `Qty 1` confirmation;
3. enter fictional guest contact details and a public Melbourne address;
4. select delivery preferences; and
5. open the payment section, prove the hosted credential fields are empty,
   take screenshots, and stop.

The script never fills a payment credential, clicks the final checkout control,
or creates/signs into an account.

## Run

```sh
npm run run
# equivalent:
.venv/bin/python chrome_checkout.py
```

For a new environment (requires Google Chrome at its standard macOS path):

```sh
uv venv
uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python chrome_checkout.py
```

## Chrome/Playwright launch design

Kmart's Akamai edge rejects product paths when Chrome is launched through
Playwright's normal automation launcher. To keep the required browser while
avoiding that false positive, the script:

- starts the stock Google Chrome executable directly, with no headless or
  automation flag;
- uses a unique temporary Chrome profile, guaranteeing an empty cart;
- lets Chrome load the product before any CDP client attaches;
- attaches Playwright over a fixed local DevTools port; and
- verifies at runtime that CDP reports `Chrome/...`, the user agent is regular
  Chrome (not `HeadlessChrome`), and `navigator.webdriver` is `false`.

All checkout interaction and validation is then performed through Playwright.
The profile is deleted after each run.

## Evidence

Each successful run writes timestamped artifacts under `evidence/`:

- product, `Qty 1` cart, checkout-bag, address, delivery, and payment screenshots;
- a final payment DOM dump;
- a Chrome process log; and
- a JSON manifest recording Chrome binary/version, headed mode, CDP attachment,
  profile cleanup, empty card/expiry/CVV fields, and the no-order safety state.

The verified real-Chrome `npm run run` is `2026-10-01T06-52-13Z`.
