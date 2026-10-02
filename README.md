# queue-headed

Headed Chrome queue watchers for Toymate and EB Games Australia, with optional
Discord alerts that launch each watcher independently. Kmart checkout experiments
are separate; see [kmart/README.md](kmart/README.md).

## Setup

Requires macOS, Node.js 22+, and Google Chrome.

Run from the repository root. Copy each template only if you don't already have
that `config.yml`:

```bash
npm install --prefix toymate
npm install --prefix discord-mirror
cp toymate/config.example.yml toymate/config.yml
cp ebgames/config.example.yml ebgames/config.yml
cp discord-mirror/config.example.yml discord-mirror/config.yml
```

EB Games shares Toymate's dependencies, but keeps its own config and Chrome
profiles. Both default to one profile; adjust `profileCount` in their configs.

For automatic launches, edit `discord-mirror/config.yml`:

- Set `token` to the Discord account token. Keep credentials private.
- Enable `toymateTrigger`, `ebGamesTrigger`, or both.
- Set each trigger's `channelIds` to its own alert channel; optionally restrict
  `authorIds` to the alert bot. Enable Discord Developer Mode to copy IDs.
- Match Toymate with `contentIncludes: ["toymate.com.au"]`; EB Games supports
  `["ebgames.com.au", "Queue is up!"]`. Rules also match embed text and URLs.
- For lifecycle posts, enable the trigger's `notifications` and fill
  `webhookUrls`. Create a webhook under channel Settings → Integrations.

Keep the template watcher paths: they resolve relative to the mirror config.
`mirrors: {}` is sufficient if you only want automatic watcher launches.

## Run

```bash
# Listen for Discord alerts (starts either watcher when its rules match):
npm start --prefix discord-mirror

# Or start a watcher directly:
npm start --prefix toymate
npm start --prefix ebgames
```

Before a drop, run the desired watcher, log in inside its Chrome window, then
stop with Ctrl-C. Cookies persist under each watcher's `profiles/` directory.
Use `npm run test:focus --prefix toymate` to check notifications; grant terminal
permissions if macOS prompts.

When an alert opens Chrome, the first notification confirms the launch.
A **gate-cleared** notification fires only after a waiting room was observed
and then cleared. Leave the queue window open, solve any challenges manually,
and **complete checkout in that same Chrome profile**; the default browser
opened on clear does not inherit its queue ticket.

Stop a direct run or the mirror with Ctrl-C. To stop a watcher launched by the
mirror, use `pkill -f "toymate/watcher.js"` or `pkill -f "ebgames/watcher.js"`.

EB Games waiting-room detection still needs validation during an active queue.
Discord selfbots violate Discord's terms and can lead to an account ban.

Detailed configuration and troubleshooting:
[Toymate](toymate/README.md) · [EB Games](ebgames/README.md) ·
[Discord mirror](discord-mirror/README.md).
