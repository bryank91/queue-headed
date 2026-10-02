# Discord Mirror
Make your account behave like a bot and mirror messages from a server to another (through webhooks).

> For the full end-to-end setup (including the Toymate queue watcher that
> `toymateTrigger` launches), see the [root README](../README.md).

# Showcase

> Original message (from server A):\
![](https://i.imgur.com/ogelJ23.png)\
Mirrored message (to server B):\
![](https://i.imgur.com/C42OT64.png)

# Main Features

- Replace mentions and other content before mirroring a message.
- Disguise mirrored messages as the original author or use a custom webhook profile.
- Support mirroring as many channels as you want to as many webhooks as you want.
- Prevent specific users and roles from being mirrored.

# How To Use
1. Install [NodeJS](https://nodejs.org/en/download).
2. Run `npm install`.
3. Copy `config.example.yml` to `config.yml`.
4. Configure the YAML, including the Discord token, mirror settings, and any
   Toymate trigger settings.
5. Run `migration.sql` against your DuckDB database if mirroring is enabled.
6. Run `npm start` to compile and start the listener.

## Toymate trigger

The optional `toymateTrigger` block listens for a configured message in a
configured channel, starts `../toymate/watcher.js`, and sends lifecycle
updates to the configured Discord webhook channel. It launches the number of
profiles configured in `toymate/config.yml` (currently 1 by default).

Example:

```yaml
toymateTrigger:
  enabled: true
  channelIds: ["SOURCE_CHANNEL_ID"]
  authorIds: ["ALERT_BOT_ID"]
  contentEquals: ["Toymate queue is open"]
  cooldownSeconds: 300
  watcherPath: "../toymate/watcher.js"
  watcherConfigPath: "../toymate/config.yml"
  workingDirectory: "../toymate"
  notifications:
    enabled: true
    webhookUrls: ["DISCORD_WEBHOOK_URL"]
    postWaitingRoom: true
    postCleared: true
```

### Triggering on a Toymate link

Rules are matched against the message content **and** every embed URL, embed
title/description, and embed field — so both plain-text links
(`https://toymate.com.au/`) and bot embeds that carry the link in `embed.url`
trigger the queue. For a "link appeared" trigger, set:

```yaml
toymateTrigger:
  enabled: true
  channelIds: ["ALERT_CHANNEL_ID"]
  contentIncludes:
    - "toymate.com.au"
```

While the watcher runs, lifecycle updates (`🟡 started`, `⏳ waiting room`,
`✅ cleared`, `ℹ️ stopped`, `⚠️ error`) are posted to the configured webhook
channel, and a second trigger message is ignored (cooldown + already-running
guards).

The trigger is disabled by default. `config.yml` is ignored by Git because it
contains credentials and local settings; use `config.example.yml` as the safe
template.

## EB Games trigger

`ebGamesTrigger` uses the same matching rules and lifecycle handling, but
launches `../ebgames/watcher.js` with its own configuration and browser
profiles. The local EB Games AU V2 alert channel can match the embed title
`Queue is up!`; no EB Games link needs to appear in that alert. Configure a
separate channel ID so a Toymate alert cannot start the EB Games watcher.
See `config.example.yml` and `../ebgames/README.md` for setup.

# Configuration guide
Each option in `config.yml` is either self explanatory or has a comment above describing it:
```yml
# Token of the personal Discord account that will mirror messages.
# Learn how to find your account token here: https://www.androidauthority.com/get-discord-token-3149920/
token: "insert_your_token_here"

# Status of the account that will mirror messages.
# Available options: online, offline, idle, dnd.
#
# Note that you should not be logged into the account
# when the bot starts for this option to take effect.
status: "online"

# Message sent in the console when a message is mirrored.
# You can set this to "" to disable it.
logMessage: "[%date%] Mirrored @%author%'s message from %server% #%channel%."

mirrors:
   # The following contains a mirror with its options.
   # Every option is optional and can be removed if not required.
   1:
      # You can find the id of a channel by enabling the Developer mode in your
      # Discord account settings and Right-Click -> Copy ID on a channel.
      channelIds:
         - "insert_channel_id_to_mirror_here"
      # Webhooks are used to send mirrored messages to specific channels.
      # You can create a webhook for a channel with:
      # Edit channel -> Integrations -> Webhooks -> New webook.
      webhookUrls:
         - "insert_destionation_webhook_url_here"
      ignoredUserIds:
         - "insert_user_id_not_to_mirror_here"
      ignoredRoleIds:
         - "insert_role_id_not_to_mirror_here"
      requirements:
         minEmbedsCount: 0
         minContentLength: 0
         minAttachmentsCount: 0
      options:
         useWebhookProfile: false
         removeAttachments: false
         mirrorMessagesFromBots: true
         mirrorReplyMessages: true
         mirrorMessagesOnEdit: false
      # Replacements to perform before mirroring a message.
      # The where: option is used to specify which part of a message
      # should be replaced. The available options are:
      #
      # everywhere, message_content, embed_author, embed_author_url,
      # embed_author_icon_url, embed_title, embed_description, embed_url,
      # embed_field_name, embed_field_value, embed_image_url, embed_thumbnail_url
      # embed_footer, embed_footer_icon_url, embed_color.
      replacements:
         1:
            replace: "insert_text_to_replace_here"
            with: "insert_replaced_text_here"
            where: "everywhere"
         # To replace mentions of @roles, @users or #channels,
         # you have to replace their ids. For example:
         # 2:
         #    replace: "insert_role_id_to_replace_here"
         #    with: "insert_replaced_role_id_here"
         #    where: "everywhere"
         #
         # To replace everything with a specific text, you can use the wildcard (*):
         # 3:
         #    replace: "*"
         #    with: "this_text_will_replace_everything"
         #    where: "everywhere"
   # You can create as many mirrors as you want, so that different
   # channels can be mirrored to different webhooks. For example:
   # 2:
   #   channelIds:
   #     - "insert_channel_id_to_mirror_here"
   #   webhookUrls:
   #     - "insert_destionation_webhook_url_here"
```

## SQLite Set Up
```
docker pull keinos/sqlite3:latest
docker run --rm -it -v "$(pwd):/workspace" -w /workspace keinos/sqlite3
.open <dbname>.db
```

## DuckDB Setup

# Disclaimer

Note that using a Discord self bot is against the Discord TOS, and i take no responsibility for any consequences that may arise from using it.
