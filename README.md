# queue-headed

Drop-day tooling: a Cloudflare Waiting Room queue watcher for
[Toymate](https://toymate.com.au/) (`toymate/`), a Discord mirror that
**auto-triggers it the moment a Toymate link appears in an alert channel**
(`discord-mirror/`), and Kmart checkout experiments (`kmart/`).

| Directory | What it is | Docs |
|---|---|---|
| [`toymate/`](toymate/README.md) | Multi-profile headed-browser watcher that holds N Cloudflare queue tickets in parallel and pings you on macOS when you clear the gate | [README](toymate/README.md) |
| [`discord-mirror/`](discord-mirror/README.md) | Selfbot that mirrors Discord messages and — via `toymateTrigger` — forks the Toymate watcher when a matching message/link arrives, posting lifecycle updates to a webhook | [README](discord-mirror/README.md) |
| [`kmart/`](kmart/README.md) | Separate Kmart AU guest-checkout experiments (not part of the Toymate flow) | [README](kmart/README.md) |

## How the pieces fit together

```
Alert bot posts https://toymate.com.au/... in the Discord alert channel
        │
        ▼
discord-mirror (ToymateTrigger)  ── matches channel/author + "toymate.com.au" in
        │                            message text, embed URLs, embed titles/fields
        ▼  forks (Node IPC)
toymate/watcher.js  ── launches 3 real Chrome windows, one persistent profile each,
        │                each holding its own Cloudflare queue ticket
        ▼
One profile clears the gate
        ├─► macOS notification: "[Profile 2/3] ✅ gate cleared"
        ├─► Discord webhook post:  ✅ queue cleared
        ├─► other 2 profile windows close (closeOthersOnClear)
        └─► you buy — in the cleared Chrome profile window
```

## Prerequisites

- **macOS** (real Chrome via Playwright + macOS notifications + AppleScript focus check)
- **Node.js 22+**
- **Google Chrome** installed (the watcher drives your real Chrome, not bundled Chromium)
- A **Discord account** (the mirror is a selfbot — see ToS note at the bottom) and a
  server with an **alert channel** where Toymate links get posted
- Optional: a **Toymate account** (pre-logging in makes checkout faster)

## Setup

### 1. Toymate watcher

```bash
cd toymate
npm install
cp config.example.yml config.yml
```

Leave `config.yml` at the defaults for a first run. The options that matter:

| Key | Default | Meaning |
|---|---|---|
| `profileCount` | `3` | Parallel Chrome profiles = queue tickets. ~1–2 GB RAM at 3. |
| `pollIntervalMs` | `4000` | How often each profile re-checks the page. |
| `openOnClear` | `true` | Opens the cleared URL in your default browser when a profile clears. |
| `closeOthersOnClear` | `true` | Closes the other profile windows and exits after one profile clears. |
| `suppressWhenChromeFocused` | `true` | Skips the macOS ping if Chrome is already frontmost. |
| `maxRuntimeMs` | `0` | `0` = run until killed or cleared. |

Profile cookies persist under `toymate/profiles/profile-N/` — log in once and
every later run is already authenticated.

### 2. Discord mirror

```bash
cd discord-mirror
npm install
cp config.example.yml config.yml
```

Fill in `config.yml`:

```yaml
token: "PERSONAL_DISCORD_ACCOUNT_TOKEN"   # the selfbot account
status: "online"
logMessage: ""
db:
  directory: "data"                        # DuckDB path; only used by message mirroring

mirrors: {}                                # leave empty if you only want the trigger

toymateTrigger:
  enabled: true
  channelIds: ["ALERT_CHANNEL_ID"]         # required — where Toymate links appear
  authorIds: ["ALERT_BOT_ID"]              # optional; empty/omitted = any author
  contentIncludes:                         # at least one rule must match
    - "toymate.com.au"                     # matches links in text AND embed URLs
  cooldownSeconds: 300                     # ignore re-triggers for 5 min after one fired
  watcherPath: "../toymate/watcher.js"
  watcherConfigPath: "../toymate/config.yml"
  workingDirectory: "../toymate"
  notifications:
    enabled: true
    webhookUrls: ["STATUS_WEBHOOK_URL"]    # channel that receives lifecycle posts
    postWaitingRoom: true
    postCleared: true
```

Notes:

- Matching is tested against the **message text plus every embed URL, embed
  title/description, and embed field** — so both a bare `https://toymate.com.au/`
  and a bot embed carrying the link in `embed.url` trigger it.
  `contentEquals` (exact match), `contentIncludes` (substring), and `regex`
  (case-insensitive) are all supported; use any combination.
- `channelIds` is required — with an empty list nothing ever matches.
- Paths in the trigger block resolve **relative to the mirror's `config.yml`**.

**Finding the IDs** (Discord → Settings → Advanced → enable *Developer Mode*):

- **Channel ID** — right-click the alert channel → *Copy ID* → `channelIds`
- **Bot author ID** — right-click the alert bot's avatar → *Copy User ID* → `authorIds`
- **Status webhook** — in the channel that should receive the lifecycle posts:
  channel ⚙️ → *Integrations → Webhooks → New webhook → Copy URL*

### 3. One-time macOS permissions

The "is Chrome frontmost?" check runs AppleScript via your terminal. If macOS
prompts for **Accessibility** permission, grant it to your terminal app.
Verify with:

```bash
cd toymate && npm run test:focus
```

Without the permission the watcher still works, but you'll get pings even when
you're already looking at the browser.

## Pre-drop dry run

Do this before the real drop so the only unknown on drop day is the queue.

1. **Watcher sanity:** `cd toymate && npm run verify` — one-shot live page
   inspector; confirm the site loads and no waiting room is present.
2. **Tests (optional):** `npm test` (regex unit tests, seconds) and
   `npm run test:e2e` (mock waiting-room end-to-end, ~1 min).
3. **Pre-login:** `npm start` in `toymate/`. Three Chrome windows open on the
   storefront — log into your Toymate account in each, then Ctrl-C. Cookies
   persist for future runs.
4. **Start the mirror:** `cd discord-mirror && npm start`.
5. **Trigger test:** temporarily add *your own* user ID to `authorIds`
   (or clear the list), then post `https://toymate.com.au/` in the alert
   channel. Expect: a `🟡 Toymate watcher started with 3 profile(s).` webhook
   post, the mirror console logging `[Toymate] Starting watcher: …`, and three
   Chrome windows opening. With no queue active they just idle on the
   storefront. Stop the watcher with `pkill -f "toymate/watcher.js"`, then
   remove your user ID from `authorIds` and restart the mirror.
6. **Confirm the guards:** posting another link immediately should log
   `[Toymate] Trigger ignored because …` (already-running / cooldown).

## Drop day

1. Leave the mirror running (any terminal; it just waits for the message).
2. The alert bot posts the Toymate link → three Chrome windows open, each
   joining the queue with its own ticket. You'll get `⏳ … entered the
   Cloudflare queue` posts (if the queue is active) and a `🟡 started` post.
3. **Don't close the Chrome windows** — closing a window forfeits that
   profile's place in line. Leave them alone; each window shows its own
   queue position and estimated wait.
4. If a **CAPTCHA or Cloudflare challenge** appears in any window, solve it
   manually — the watcher keeps polling after the page clears.
5. When a profile clears: macOS notification
   `[Profile N/3] ✅ gate cleared`, a `✅ queue cleared` Discord post, the
   other windows close, and the URL opens in your default browser.
   **Buy in the cleared Chrome profile window** — that profile holds the
   ticket that got through; a fresh browser session does not inherit it.
   Complete checkout in that same window.
6. The watcher exits itself after clearing (`ℹ️ stopped` post).

## Stopping things

- **Mirror:** Ctrl-C in its terminal.
- **Watcher** (when started by the mirror, it outlives the mirror as an
  orphan process): `pkill -f "toymate/watcher.js"`.
- **Watcher** (started directly with `npm start` in `toymate/`): Ctrl-C.
- The watcher also stops on its own after a clear (`closeOthersOnClear`) or
  when `maxRuntimeMs` is reached.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Link posted, nothing happens | Mirror not running; `enabled: false`; wrong `channelIds`; `authorIds` doesn't include the posting bot; or no rule matches (try clearing `authorIds`). The mirror console logs every decision — watch it while you test. |
| `🟡 started` post, but Chrome windows never appear | Watcher crashed — check the mirror terminal for `[Toymate]`-prefixed output and any `⚠️` error post. Common: Chrome missing, `config.yml` missing in `toymate/`. |
| `⚠️ Toymate watcher error: … path is missing …` | `watcherPath` / `watcherConfigPath` wrong — they resolve relative to the mirror's `config.yml`. |
| Webhook posts missing | Wrong/expired webhook URL, or the `post*` flag for that event is `false`. |
| Pings fire even though you're watching Chrome | Accessibility permission not granted to your terminal — re-run `npm run test:focus`. |
| Queue detection stops working after a drop | Cloudflare may have reworded the waiting-room page — run `npm run verify` and check the strings in `STATES` in `toymate/watcher.js`. |
| A window closed and the ticket is gone | Expected: that profile is out of the queue; the other profiles keep waiting. |

## ToS & responsible use

- The mirror runs on a **Discord selfbot** (personal-account token), which
  violates Discord's ToS. The account used for mirroring can be banned — use a
  throwaway account, not one you care about.
- **Cloudflare explicitly forbids automation** in its ToS; entries can be voided
  and accounts banned.
- Multi-profile = multiple queue tickets = multiple odds. That's unambiguously
  against the spirit of a fair queue. Use it sparingly, for items you actually
  want, at a price you're happy to pay.
