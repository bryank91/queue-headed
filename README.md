# queue-headed

Multi-profile **headed-browser** watcher for virtual queues. Point it at any
site that uses a [Cloudflare Waiting Room](https://developers.cloudflare.com/waiting-room/)
and/or an [EQL](https://www.eql.com/) drop page, and it'll hold a queue ticket
in N parallel Chrome instances and notify you the moment you clear the gate.

> Originally built for [Toymate](https://toymate.com.au/)'s Pokémon drops,
> but the startUrl is fully configurable — see [Configuration](#configuration).

## Quick start

```bash
git clone https://github.com/bryank91/queue-headed.git
cd queue-headed
npm install
npm start                                    # uses CONFIG.startUrl default
npm start -- https://example.com/raffle      # point at a different site
```

When a profile clears the gate you'll get a labelled macOS notification:

> `[Profile 2/3] ✅ gate cleared` — You're past the Cloudflare queue.

Notifications are **auto-suppressed when Google Chrome is the frontmost app** —
if you're already looking at the browser, you can see the page state yourself
and don't need a ping.

## What it watches

| Queue system | What it does |
|---|---|
| **Cloudflare Waiting Room** | Detects the "Waiting Room powered by Cloudflare" page, waits for Cloudflare to redirect you to the real site. |
| **EQL (runfair.com)** | Detects the drop page, auto-clicks "Enter launch", watches for selection. |
| **Anything else** | You'll need to add detection patterns — see [Extending](#extending-for-other-queue-systems) below. |

## Configuration

Open `watcher.js` and edit the `CONFIG` object, **or** just pass a URL on the
command line:

```bash
node watcher.js                       # uses CONFIG.startUrl
node watcher.js https://example.com   # overrides for this run
```

The most important option:

```js
startUrl: 'https://toymate.com.au/',  // ⬅️ any queue site
```

The full config:

| Key | Default | What it does |
|---|---|---|
| `startUrl` | `https://toymate.com.au/` | The site to watch. CLI arg overrides. |
| `profileCount` | `3` | Number of parallel Chrome instances (separate queue tickets). |
| `profileBaseDir` | `~/queue-headed/profiles/` | Where per-profile Chrome data lives. |
| `pollIntervalMs` | `4000` | How often to check page state. Don't go below `3000`. |
| `suppressWhenChromeFocused` | `true` | Skip notifications when Chrome is frontmost. |
| `autoEnterDrops` | `true` | Auto-click "Enter launch" on EQL drop pages. |
| `openOnClear` | `true` | Open the cleared page in your default browser. |
| `closeOthersOnClear` | `false` | Shut down other profiles' Chrome windows once one wins. |
| `notifySubtitle` | `"Queue Watcher"` | Small grey text in macOS notifications. |
| `maxRuntimeMs` | `0` | Hard cap (ms). `0` = run forever. |
| `verbose` | `true` | Terminal logging. |

## Run

```bash
npm start                  # or: node watcher.js
npm run verify             # one-shot page inspector for the configured URL
npm run verify -- https://other-site.com
npm run test:focus         # smoke-test the focus-aware notify() path
```

Stop with **Ctrl-C**. **Don't close individual Chrome windows** while a
profile is in a waiting room — that loses that profile's place in line.

## What it'll notify you about

**Three events only.** Everything else (entering a queue, periodic waiting,
entering a drop) is silent — you see it on the browser window.

| Event | Notification |
|---|---|
| Cleared the gate | `[Profile N/M] ✅ gate cleared` + opens page |
| Got selected on a drop | `[Profile N/M] 🎉 you're in!` + opens page |
| Not selected on a drop | `[Profile N/M] not selected` |

## Heads up

- Cloudflare and EQL both **forbid automation** in their Terms of Service.
  They can void entries or ban accounts.
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

## Extending for other queue systems

The detection logic lives in `STATES` near the top of `watcher.js`. To support
a site that uses a different virtual-queue provider, add a new state:

```js
const STATES = {
  // existing patterns...
  QUEUEIT_BODY: /queue-it|waiting room by queue-it/i,  // your custom pattern
};
```

…and add the matching branch in the `probe()` function:

```js
if (STATES.QUEUEIT_BODY.test(body)) return { state: 'WAITING_ROOM', /* ... */ };
```

The state machine itself (`WAITING_ROOM` → `THROUGH` → `DROP_ENTERED` →
`SELECTED` / `NOT_SELECTED`) is queue-system-agnostic — you just need to map
the upstream provider's "you're waiting" indicator onto `WAITING_ROOM` and
their "you got through" indicator onto `THROUGH`.

## Files

- `watcher.js` — main script (multi-profile, focus-aware notifications)
- `verify.js` — one-shot page inspector (dumps title, links, keywords, scripts)
- `test-focus.js` — smoke test for the focus-aware notify() path
- `package.json` — `start`, `verify`, `test:focus` npm scripts
- `.gitignore` — excludes `node_modules/`, `profiles/`, etc.

## License

MIT.
