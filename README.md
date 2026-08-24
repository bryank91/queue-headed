# Toymate queue automation

This project contains the Toymate Cloudflare watcher and the optional Discord
message trigger that starts it.

## Setup

Copy the safe YAML templates and fill in the local values:

```sh
cp toymate/config.example.yml toymate/config.yml
cp discord-mirror/config.example.yml discord-mirror/config.yml
```

Enable `toymateTrigger` in `discord-mirror/config.yml`, then set the source
channel/message filters and the destination Discord webhook URL. The watcher
profile count is `toymate.profileCount` and is `3` in the example.

## Run

```sh
cd toymate && npm install && npx playwright install chromium
cd ../discord-mirror && npm install && npm start
```

The Discord listener launches `toymate/watcher.js` when a configured message
appears. It sends start, queue-cleared, stop, and error updates to the webhook.
Local `config.yml` files are ignored by Git; never commit them.

## Tests

```sh
cd toymate && npm test && npm run test:e2e
cd ../discord-mirror && npm run test:trigger
```
