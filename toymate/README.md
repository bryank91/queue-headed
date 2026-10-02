# queue-headed

> **⚠️  This script might only work with [toymate.com.au](https://toymate.com.au/).**
> Runtime settings are stored in `config.yml`, which is intentionally ignored
> because it is local configuration. Copy `config.example.yml` to create it.

Headed-browser watcher that holds a Cloudflare Waiting Room ticket for Toymate.
The default is one Chrome profile. It notifies you when the browser opens and
when that profile clears a queue it actually entered.

> For the full end-to-end setup (including the Discord auto-trigger that
> starts this watcher when a Toymate link appears), see the
> [root README](../README.md).

## Quick start

```bash
git clone https://github.com/bryank91/queue-headed.git
cd queue-headed/toymate
npm install
npx playwright install chromium
cp config.example.yml config.yml
npm start                  # launches the configured Chrome profile
```

When the watcher opens Chrome, you'll get a macOS notification saying the alert
was received and the waiting-room status is being checked. If the profile later
clears a queue, you'll get a second notification:

> `[Profile 1/1] ✅ gate cleared` — You're past the Cloudflare queue.

The browser-open notification always fires. The gate-cleared notification is
suppressed when Google Chrome is the frontmost app, since you're already
looking at the browser.

## What it watches

| Queue system | What it does |
|---|---|
| **Cloudflare Waiting Room** | Detects the "Waiting Room powered by Cloudflare" page, waits for Cloudflare to redirect you to Toymate's real site. |

The detection regexes live in `state.js`. They're generic
Cloudflare WR strings, but Toymate-specific markup changes (e.g. Cloudflare
rewording "in line") could break them.

## Configuration

Copy `config.example.yml` to `config.yml` and edit the YAML:

```yaml
toymate:
  siteName: "Toymate"
  startUrl: "https://toymate.com.au/"
  profileCount: 1
  profileBaseDir: "profiles"
  pollIntervalMs: 4000
  suppressWhenChromeFocused: true
  notifyOnBrowserOpen: true
  maxRuntimeMs: 0
  openOnClear: true
  closeOthersOnClear: true
  browser:
    channel: "chrome"
    headless: false
    locale: "en-AU"
    timezoneId: "Australia/Sydney"
    acceptLanguage: "en-AU,en;q=0.9"
```

The watcher also emits structured status events when started, when a profile
enters the queue, when the queue clears, and when it stops. The Discord trigger
uses those events for webhook notifications.

## Run

```bash
npm start                  # or: node watcher.js — launches the watcher
npm run verify             # one-shot page inspector for Toymate
npm run test:focus         # smoke-test the focus-aware notification path
npm test                   # unit tests for state-detection regexes
npm run test:e2e           # end-to-end test against a local mock WR page
```

Stop with **Ctrl-C**. **Don't close individual Chrome windows** while a
profile is in a waiting room — that loses that profile's place in line.

### Test modes for `npm run test:e2e`

The e2e test runs against a local mock Cloudflare WR page served from
`http://127.0.0.1:8765/`. Three browser modes are available:

```bash
npm run test:e2e                            # chromium-headless-shell (default, ~27s)
TEST_MODE=full-chromium npm run test:e2e    # full Chromium in headless mode (~62s)
TEST_MODE=headed npm run test:e2e           # real headed Chromium (~47s, needs display)
```

## What it'll notify you about

There are two notification events. Entering a waiting room and periodic waiting
are silent; you can see them in the browser.

| Event | Notification |
|---|---|
| Browser opened after an alert | `Toymate alert received` — checks are starting; this does not confirm a waiting room |
| Cleared the gate | `[Profile N/M] ✅ gate cleared` + opens page |

## Heads up

- Cloudflare **forbids automation** in their Terms of Service. They can void
  entries or ban accounts.
- The default is one Chrome profile. Raising `profileCount` opens more windows
  and uses more memory.
- If you see a CAPTCHA in any Chrome window, solve it manually; the watcher
  keeps going once the page clears.
- The "is Chrome frontmost?" check uses AppleScript + System Events. If
  macOS prompts you for **Accessibility** permission for your terminal,
  grant it. Without it, gate-cleared notifications will fire even when you're
  at the browser. Re-run `npm run test:focus` after granting permission to verify.

## Files

- `watcher.js` — main script. Runtime settings are loaded from `config.yml`.
- `config.example.yml` — safe configuration template.
- `verify.js` — one-shot page inspector (dumps title, links, keywords, scripts)
- `test-focus.js` — smoke test for the focus-aware notify() path
- `test-states.js` — unit tests for the Cloudflare WR detection regexes
- `test-e2e.js` — end-to-end test with mock server + Playwright (3 browser modes)
- `test/fixtures/` — fake Cloudflare WR HTML + fake cleared-page HTML
- `package.json` — `start`, `verify`, `test*` npm scripts
- `.gitignore` — excludes `node_modules/`, `profiles/`, etc.

## License

MIT.
