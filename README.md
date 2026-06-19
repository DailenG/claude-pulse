# Pulse for Claude Code

A local, zero-dependency dashboard for [Claude Code](https://claude.com/claude-code). It reads the session logs Claude Code already writes to `~/.claude` and shows, live:

- context fill of your active session
- tokens spent this hour, today, this week and all time
- estimated API-equivalent cost, broken down by model and project
- every session, what it was about and when it last moved
- a feed of what Claude actually did (edits, commands, searches)
- usage against your plan budgets
- a notification when Claude is waiting for you to approve an `Allow` prompt

No account, no telemetry, no network calls. Everything stays on your machine.

<!-- Add screenshots here once you run it locally:
![Overview](docs/overview.png)
![Usage](docs/usage.png)
-->

## Run it

Requires Node 18+.

```bash
git clone https://github.com/<you>/claude-pulse.git
cd claude-pulse
node bin/cli.js
```

Or, once published to npm:

```bash
npx claude-pulse
```

It opens `http://127.0.0.1:4317`. Options:

```
claude-pulse --port 4317   # change the port
claude-pulse --no-open     # do not open the browser
```

## How it works

Claude Code logs every session as JSONL under `~/.claude/projects/`. Each assistant
message carries a `usage` block (input, output and cache tokens) with a timestamp.
Pulse reads those files (read only), caches each file by modification time so
unchanged sessions are never re-parsed, and aggregates the numbers. The browser
gets live updates over Server-Sent Events.

## Notifications when Claude needs you

Claude Code can run a hook when it needs your attention. Point its `Notification`
event at the bundled script and Pulse will show a banner and fire a desktop
notification, even if the tab is in the background.

Add this to `~/.claude/settings.json` (use the absolute path to your clone):

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node /absolute/path/to/claude-pulse/hooks/notify-hook.js" }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node /absolute/path/to/claude-pulse/hooks/stop-hook.js" }
        ]
      }
    ]
  }
}
```

Keep `claude-pulse` running and you are set.

## Phone push (optional)

To get a push on your phone when Claude needs you or finishes, pick a hard to
guess topic name, install the free [ntfy](https://ntfy.sh) app and subscribe to
that topic, then set it in `~/.claude-pulse.json`:

```json
{ "ntfyTopic": "claude-pulse-9f3a7c" }
```

With the hooks above wired, the `Notification` hook pushes when Claude is waiting
for you, and the `Stop` hook pushes when a turn finishes (debounced to 30s so a
back and forth does not spam you). Anyone who knows the topic can read it, so use
a random name.

## Configuration

Copy `config.example.json` to `~/.claude-pulse.json` and edit. Every field is optional.

```json
{
  "plan": "max20",
  "contextLimit": 200000,
  "idleMinutes": 10,
  "budgets": { "fiveHour": 140, "day": 360, "week": 1100 }
}
```

### About limits

Anthropic does not publish exact subscription limits, and they are usage based
rather than a fixed token count. Pulse cannot read your real plan ceiling, so the
budgets above are rough API-equivalent estimates you adjust to match what you
observe. The `pro`, `max5` and `max20` presets are starting points, not official
numbers. Token cost is estimated from public API list prices purely as a usage
proxy; subscription users do not pay per token.

## Privacy

Pulse never sends anything anywhere. It reads local files under `~/.claude`,
serves a dashboard on `127.0.0.1` only, and keeps its own small runtime state in
`~/.claude-pulse/`. There is no analytics and no external dependency.

## License

MIT
