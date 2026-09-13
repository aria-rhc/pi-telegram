# pi-telegram

![pi-telegram screenshot](screenshot.png)

> Full pi build session: [View the session transcript](https://pi.dev/session/#14acfe07b7844c8abec55ed9fbddc17f), which captures the full pi session in which `pi-telegram` was built.

Telegram DM bridge for pi.

## Install

From git:

```bash
pi install git:github.com/badlogic/pi-telegram
```

Or for a single run:

```bash
pi -e git:github.com/badlogic/pi-telegram
```

## Configure

### Telegram

1. Open [@BotFather](https://t.me/BotFather)
2. Run `/newbot`
3. Pick a name and username
4. Copy the bot token

### pi

Start pi, then run:

```bash
/telegram-setup
```

Paste the bot token when prompted.

The extension stores config in:

```text
~/.pi/agent/telegram.json
```

## Connect a pi session

The Telegram bridge is session-local. Connect it only in the pi session that should own the bot:

```bash
/telegram-connect
```

To stop polling in the current session:

```bash
/telegram-disconnect
```

Check status:

```bash
/telegram-status
```

## Pair your Telegram account

After token setup and `/telegram-connect`:

1. Open the DM with your bot in Telegram
2. Send `/start`

The first DM user becomes the allowed Telegram user for the bridge. The extension only accepts messages from that user.

## Usage

Chat with your bot in Telegram DMs.

### Send text

Send any message in the bot DM. It is forwarded into pi with a `[telegram]` prefix.

### Send images and files

Send images, albums, or files in the DM.

The extension:
- downloads them to `~/.pi/agent/tmp/telegram`
- includes local file paths in the prompt
- forwards inbound images as image inputs to pi

### Ask for files back

If you ask pi for a file or generated artifact, pi should call the `telegram_attach` tool. The extension then sends those files with the next Telegram reply.

Examples:
- `summarize this image`
- `read this README and summarize it`
- `write me a markdown file with the plan and send it back`
- `generate a shell script and attach it`

### Stop a run

In Telegram, send:

```text
stop
```

or:

```text
/stop
```

That aborts the active pi turn.

### Queue follow-ups

If you send more Telegram messages while pi is busy, they are queued and processed in order.

## Streaming

The extension streams assistant text previews back to Telegram while pi is generating.

It tries Telegram draft streaming first with `sendMessageDraft`. If that is not supported for your bot, it falls back to `sendMessage` plus `editMessageText`.

## Notes

- Only one pi session should be connected to the bot at a time
- Replies are sent as normal Telegram messages, not quote-replies
- Long replies are split below Telegram's 4096 character limit
- Outbound files are sent via `telegram_attach`

### Proactive sends (telegram_send tool)

The agent can push a message to the paired Telegram chat at any time — even when the current turn was not triggered from Telegram (e.g. an out-of-band wake-up from another session) — by calling the `telegram_send` tool. It is not bound to an active Telegram turn, so it never gets mis-dropped by turn binding. Normal Telegram conversations are unaffected: replies to `[telegram]` messages still work exactly as before.

### CLI

The package also ships a small companion CLI (no dependencies, reads the same `~/.pi/agent/telegram.json` config):

```bash
pi-telegram send "build finished, reports at /tmp/report.md"
cat summary.txt | pi-telegram send
```

This lets scripts and non-agent runners notify the paired chat without going through a pi session.

## Changes vs upstream

This fork (`aria-rhc/pi-telegram`, branch `telegram-send-and-fixes`) extends `badlogic/pi-telegram` with the following changes (see richardchew/aria issue #134):

- **`telegram_send` tool** — proactive text messaging to the paired chat (`chat_id = config.allowedUserId`), registered alongside `telegram_attach`. Works with no active Telegram turn and no turn binding, so out-of-band reports are delivered deterministically instead of relying on turn replies.
- **`pi-telegram` CLI** — `pi-telegram send` reads the same config and sends text to the paired chat from scripts or other non-agent callers.
- **Queue-starvation fix** — `agent_end` used to early-return when the finished turn had no active Telegram turn, skipping the queue-dispatch code. A Telegram message arriving while a non-Telegram turn was running could sit stuck until the next Telegram message. Queued Telegram turns are now dispatched regardless of what kind of turn just ended.
- **Send-path hardening** —
  - `callTelegram` / `callTelegramMultipart` retry transient failures (network errors, HTTP 429/5xx, non-JSON error pages) with exponential backoff + jitter, honouring `retry_after`; aborts are never retried.
  - API failures surface as a typed `TelegramApiError` carrying `error_code` / `retry_after`.
  - No floating promises: fire-and-forget calls (preview flush timer, compaction notifications, media-group dispatch) all have `.catch` handlers.
  - `finalizePreview` in `agent_end` is wrapped in try/catch with a plain `sendMessage` fallback, so a draft/preview failure can no longer eat the final reply.
- **Tooling** — `tsconfig.json` added; typecheck with `npx tsc --noEmit`.

Normal turn-reply behaviour (implicit replies to `[telegram]` messages, streaming previews, attachments) is unchanged.

## License

MIT
