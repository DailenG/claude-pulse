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

![Overview](docs/overview.png)

| Ambient office view | Approve from the dashboard or your phone |
| --- | --- |
| ![Office](docs/office.png) | ![Approve](docs/approve.png) |

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

## Keep it running

Run in the foreground and Pulse dies when you close that terminal. To keep it
alive independently, run it in the background:

```bash
claude-pulse start     # run detached, survives closing the terminal
claude-pulse status    # is it running?
claude-pulse stop      # stop it
claude-pulse restart   # stop and start again
```

If your terminal crashes, `claude-pulse start` brings it back in one command,
and a background instance is not affected by the crash in the first place.

On macOS you can hand Pulse to the system so it starts at login and respawns
itself if it ever dies:

```bash
claude-pulse install-service     # start at login, auto-restart
claude-pulse uninstall-service   # remove it
```

## Recover a lost session

Terminal crashed, laptop froze, hit a session limit? Nothing is lost: Claude
Code writes every session to disk as it happens. One command brings the last one
back, prints a recap and saves a readable transcript:

```bash
claude-pulse recover        # the most recent session
claude-pulse recover 2      # the one before that
claude-pulse recover <id>   # a specific session
```

It saves a light markdown file under `~/.claude-pulse/exports/` (a 15 MB log
becomes a ~180 KB file) and prints a link to read the full transcript in the
browser or on your phone. You can also open any session in the dashboard and use
**open transcript** / **download .md**.

While Pulse runs it also **auto-snapshots** every recently active session to
`~/.claude-pulse/exports/snapshots/` (one file per session, rewritten only when
it changes). So the latest state is always on disk even if you never run
`recover`. Set `snapshotMinutes` to `0` in `~/.claude-pulse.json` to turn it off.

To back up everything at once, `claude-pulse export-all` writes every session
into a single small gzipped markdown file, or use **download all history** on the
Sessions screen.

## Search every session

Lost where you did something? The **Sessions** screen has a search box that
scans every session on disk for a word or phrase and jumps you straight to the
transcript. It works from your phone too.

## On your phone

The simplest phone control is the ntfy notification itself: it carries working
`Allow` / `Allow all` / `Deny` buttons (see above), no network setup at all.

For a richer view, open `http://<your-machine>:4317/phone` on the same Wi-Fi
(needs `bindLan: true`) to see what Claude is doing right now plus a **Pause /
Resume** button. Pausing stops Claude from running further tools until you
resume. Both need the `PreToolUse` hook wired.

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

The easy way is one command:

```bash
claude-pulse install-hooks     # wires the hooks into ~/.claude/settings.json (safe to re-run)
claude-pulse uninstall-hooks   # removes them
```

It backs up your settings once, merges next to any hooks you already have, and
never adds a duplicate. Restart Claude Code afterwards. To do it by hand instead,
add this to `~/.claude/settings.json` (use the absolute path to your clone):

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
    ],
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node /absolute/path/to/claude-pulse/hooks/permission-hook.js" }
        ]
      }
    ]
  }
}
```

Keep `claude-pulse` running and you are set.

## Approve tools from the dashboard (and your phone)

With the `PreToolUse` hook wired, when Claude wants to run something that needs
permission, an approval card appears in Pulse with `Allow`, `Allow all` and
`Deny`. `Allow all` stops asking for the rest of the run.

This is built to never hang Claude. Read only tools pass straight through, and if
Pulse is not running, has not heard from you within the approval timeout (60s by
default, set `approvalTimeoutMs`), or hits any error, it falls back to the normal
terminal prompt. Nothing breaks if you ignore it. The phone push carries `Allow`,
`Allow all` and `Deny` buttons.

To approve from your phone, you only need an `ntfyTopic` (below) and the ntfy
app. The push notification carries `Allow`, `Allow all` and `Deny` buttons, and
tapping one sends the answer back through ntfy to a private reply topic that
Pulse listens on. No same Wi-Fi, no IP, no open port: it works from anywhere,
even on cellular. Pulse only acts on a reply while it is actually waiting for
that request, so a stale notification can do nothing.

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

If you set `budgets` (below), Pulse also pushes when a rolling window crosses 80%
then 100% of its budget, so you find out from your pocket, not by checking.

## Configuration

Copy `config.example.json` to `~/.claude-pulse.json` and edit. Every field is optional.

```json
{
  "plan": "max20",
  "contextLimit": 200000,
  "idleMinutes": 10,
  "approvalTimeoutMs": 60000,
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
