# queue-headed

> **⚠️  This script might only work with [toymate.com.au](https://toymate.com.au/).**
> Runtime settings are stored in `config.yml`, which is intentionally ignored
> because it is local configuration. Copy `config.example.yml` to create it.

Multi-profile **headed-browser** watcher that holds N Cloudflare Waiting Room
queue tickets for Toymate in parallel and notifies you on macOS the moment
you clear the gate.

## Quick start

```bash
git clone https://github.com/bryank91/queue-headed.git
cd queue-headed/toymate
npm install
npx playwright install chromium
cp config.example.yml config.yml
npm start                  # launches the configured parallel Chrome instances
```

When a profile clears the gate you'll get a labelled macOS notification:

> `[Profile 2/3] ✅ gate cleared` — You're past the Cloudflare queue.

Notifications are **auto-suppressed when Google Chrome is the frontmost app** —
if you're already looking at the browser, you can see the page state yourself
and don't need a ping.

## What it watches

| Queue system | What it does |
|---|---|
| **Cloudflare Waiting Room** | Detects the "Waiting Room powered by Cloudflare" page, waits for Cloudflare to redirect you to Toymate's real site. |

The detection regexes live in `STATES` in `watcher.js`. They're generic
Cloudflare WR strings, but Toymate-specific markup changes (e.g. Cloudflare
rewording "in line") could break them.

## Configuration

Copy `config.example.yml` to `config.yml` and edit the YAML:

```yaml
toymate:
  startUrl: "https://toymate.com.au/"
  profileCount: 3
  profileBaseDir: "profiles"
  pollIntervalMs: 4000
  suppressWhenChromeFocused: true
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

**One event only.** Everything else (entering a queue, periodic waiting) is
silent — you see it on the browser window.

| Event | Notification |
|---|---|
| Cleared the gate | `[Profile N/M] ✅ gate cleared` + opens page |

## Heads up

- Cloudflare **forbids automation** in their Terms of Service. They can void
  entries or ban accounts.
- Multi-profile is unambiguously against the spirit of a fair queue. N tickets
  = N× odds. Use responsibly.
- 3 Chrome instances ≈ 1–2 GB RAM and noticeable CPU. Drop `profileCount`
  if your Mac struggles.
- If you see a CAPTCHA in any Chrome window, solve it manually; the watcher
  keeps going once the page clears.
- The "is Chrome frontmost?" check uses AppleScript + System Events. If
  macOS prompts you for **Accessibility** permission for your terminal,
  grant it. Without it, notifications will fire even when you're at the
  browser. Re-run `npm run test:focus` after granting permission to verify.

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
