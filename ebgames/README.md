# EB Games queue watcher

This uses the same headed Chrome queue watcher as Toymate, with a separate
configuration and one persistent browser profile for EB Games Australia.
It opens `https://www.ebgames.com.au/` and watches for the Cloudflare waiting
room before reporting that a profile has cleared the queue. A normal page load
does not count as a queue clear.

When the browser opens, a macOS notification says `EB Games alert received`.
It means the Discord alert launched the watcher; it does not confirm that the
site has placed the browser in a waiting room. A separate gate-cleared
notification fires only after the watcher saw a waiting room and then exited it.

## Setup

Install dependencies in `../toymate`, then copy `config.example.yml` to
`config.yml` in this directory. Run `npm start` here to start it directly, or
enable `ebGamesTrigger` in `../discord-mirror/config.yml` to launch it from a
Discord alert. Press Ctrl-C to stop a direct run.

The EB Games queue page has not been captured during an active drop. Its exact
waiting-room wording still needs a live validation. A fresh browser profile
currently lands on a Cloudflare `Just a moment...` page; the watcher treats
that as an interstitial rather than a cleared queue. Solve any challenge in
the browser window and leave it open.
