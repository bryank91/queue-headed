# Toymate Queue Watcher (multi-profile)

Headed-browser watcher for the **Cloudflare Waiting Room** in front of
`toymate.com.au`, with a fallback for **EQL** drop pages once you're past the
gate. Runs N parallel Chrome profiles so you hold N separate queue tickets.

## What's going on
Toymate uses two layers:
- **Cloudflare Waiting Room** — virtual queue that holds high-traffic visitors
  on a page titled *"Waiting Room powered by Cloudflare"* with an ETA. Auto-
  refreshes; nothing to click.
- **EQL (runfair.com)** — only used on specific product drops (e.g. Pokémon
  sets). Has the actual "Enter launch" button.

This watcher handles both, with N parallel browser instances.

## Run
```
cd ~/toymate-watcher
node watcher.js
```
Stop with `Ctrl-C`. **Don't close any Chrome window** while a profile is in the
Cloudflare waiting room — that loses that profile's place in line.

## What it'll notify you about
**Three events only** — and every notification is auto-suppressed when Google
Chrome is already the frontmost app (you can see the page state yourself, no
need for a ping).

| Event | Notification |
|---|---|
| Cleared the Cloudflare gate | `[Profile N/M] ✅ gate cleared` + opens page |
| Got selected on an EQL drop | `[Profile N/M] 🎉 you're in!` + opens page |
| Not selected on an EQL drop | `[Profile N/M] not selected` |

Everything else (entering the queue, periodic waiting, drop entered) is silent
— you see it on the browser window. The terminal still logs state changes and
ETAs so you can `tail` the script's output if you want detail.

## Heads up
- Cloudflare and EQL both forbid automation. They can void entries or ban.
- Multi-profile is unambiguously against the spirit of a fair queue. N tickets
  = N× odds. Use responsibly.
- 3 Chrome instances ≈ 1–2 GB RAM and noticeable CPU. Bump it down if your
  Mac struggles.
- If you see a CAPTCHA in any Chrome window, solve it; the watcher keeps
  going once the page clears.
- The "is Chrome frontmost?" check uses AppleScript + System Events. If macOS
  prompts you for Accessibility permissions for the terminal, grant them.
  If permissions are denied, notifications fall back to "always notify"
  (safer default).

## Config
Open `watcher.js` and edit `CONFIG`:
- `profileCount` — **number of parallel Chrome profiles** (default `3`).
- `profileBaseDir` — base directory for per-profile Chrome data dirs.
- `startUrl` — change to a specific drop URL once you know it.
- `suppressWhenChromeFocused` — `true` (default) suppresses notifications when
  Chrome is frontmost. Set to `false` if you always want the ping.
- `pollIntervalMs` — `4000` is fine. Don't go below `3000`.
- `autoEnterDrops` — `true` to auto-click Enter on EQL drop pages, `false` to
  just notify and let you click.
- `openOnClear` — `true` to auto-open the cleared page in your default browser.
- `closeOthersOnClear` — `true` to close other profiles' Chrome windows the
  moment one clears the gate.
- `maxRuntimeMs` — `0` to run forever, or set a cap (ms).

## Files
- `watcher.js` — main script (multi-profile, focus-aware notifications).
- `verify.js` — one-shot page inspector (what's on toymate.com.au right now).
- `profiles/` — created on first run; one subdirectory per profile.

## Quick recipes
- Single profile, always notify: `profileCount: 1, suppressWhenChromeFocused: false`
- Five tickets, quiet: `profileCount: 5, suppressWhenChromeFocused: true`
- Auto-shut losers: `closeOthersOnClear: true`
