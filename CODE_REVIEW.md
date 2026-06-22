# Pulse for Claude Code — Code Review & Recommendations

*An independent review of the full source tree (~4,200 LOC, zero runtime dependencies). Every file under `bin/`, `src/`, `hooks/`, and `public/` was read. The intent is a constructive, devil's-advocate critique: the goal is to stress-test the design and surface the highest-value improvements, not to relitigate decisions that are already sound.*

---

## Overall assessment

Pulse is a thoughtfully built tool with a clear, consistent design philosophy. The read-only / local-first / fail-open principles described in the README are actually upheld in the code, the comments explain the reasoning behind non-obvious choices, and the documentation is candid about the limits of its own estimates. Those are signs of careful engineering and are worth preserving through any future change.

The findings below cluster into three areas:

1. **Web security model** — the authentication/token mechanism is partially implemented and currently bypassable; one state-changing endpoint has no protection at all. This is the most important section of the document. See [SEC-1](#sec-1).
2. **Performance at scale** — the dashboard works well today, but an O(N²) aggregation runs on every refresh and grows more expensive the longer Claude Code is used. See [PERF-1](#perf-1).
3. **Test & CI safety net** — there is currently no automated test coverage for code that gates security decisions and parses logs. See [QUAL-1](#qual-1).

A few additional correctness items are worth attention, notably a Windows functionality gap ([BUG-1](#bug-1)) and a timeout mismatch ([BUG-2](#bug-2)). The P0 items in the [roadmap](#prioritized-roadmap) are small, self-contained, and would resolve the only findings that rise to the level of a release blocker.

---

## Assessment by dimension

| Dimension | Rating | Summary |
|---|---|---|
| **Architecture & design** | Strong | Clean module boundaries; sound read-only / fail-open philosophy. |
| **Readability & comments** | Strong | Comments explain the *why*; clear naming; mostly small functions. |
| **Documentation (README)** | Strong | Thorough, accurate, well-diagrammed, candid about caveats. |
| **Security** | Needs attention | Good instincts, but the LAN/CSRF/token model is bypassable. Highest priority. |
| **Performance / efficiency** | Adequate | Effective file cache, limited by an O(N²) aggregation and synchronous I/O. |
| **Maintainability** | Adequate | Notable duplication; one very long function; no tests. |
| **Correctness / robustness** | Solid, with exceptions | Mostly reliable; a few specific bugs noted below. |
| **OSS readiness** | Needs attention | Missing CI, tests, `SECURITY.md`, `repository` metadata, contribution guide. |

---

## Strengths worth preserving

These are explicit strengths; any refactor should take care not to regress them:

- **Zero dependencies, in practice.** No `node_modules`, no supply-chain surface. Rare and valuable.
- **Per-file parse cache keyed on `mtimeMs` + `size`** (`src/engine.js:140`). Unchanged session files are never re-parsed — the right design.
- **Defense-in-depth in the permission hook** (`hooks/permission-hook.js`): stale-heartbeat passthrough, a read-only allowlist, standing rules, a hard timeout, and a catch-all that defaults to passthrough. Five independent layers, all failing *open* so Claude is never blocked. This is well considered.
- **Releasing other waiting hooks on a single decision** (`hooks/permission-hook.js:160-166`) — re-reading `rules.json` mid-wait so one "Allow all" tap frees parallel tool calls. A non-obvious concurrency case, correctly handled.
- **Replay protection on ntfy replies** (`src/ntfy.js:41`) — only acting on a decision when a matching pending request exists. Good security reasoning (with room to harden further — see [SEC-3](#sec-3)).
- **Consistent HTML escaping** across the server-rendered pages (`escHtml` in `src/transcript.js`, `esc` in `public/phonepage.js` and `public/app.js`). Tool inputs and session titles rendered into the dashboard and transcript pages are escaped consistently; no stored-XSS path was found.
- **Honest framing of estimates.** The cost / limit / ETA features are clearly labelled as approximations in both UI and docs.

---

## Security findings

> Threat-model note: Pulse is local-first. The default configuration binds to `127.0.0.1` and makes no outbound calls, which is the correct default. The findings below matter most when (a) the recommended hooks are installed, (b) `bindLan: true`, or (c) `ntfyTopic` is set — with the exception of SEC-1, which applies even in the default localhost-only configuration.

### <a name="sec-1"></a>SEC-1 — CSRF: a visited web page can change approval state · **Severity: High**

`POST /api/rules` (`src/server.js:260-270`) performs no token check, no `isLocal` check, and no `Origin`/`Host` validation. It reads a JSON body and writes `rules.json` directly.

Because the body is sent as a string, the browser classifies it as a *simple* cross-origin request (no CORS preflight). Any web page open in the browser while Pulse is running can therefore issue:

```js
fetch('http://127.0.0.1:4317/api/rules', {
  method: 'POST',
  body: JSON.stringify({ enabled: true, allowAll: true }),
});
```

CORS blocks the page from reading the **response**, but the **side effect still occurs**: `allowAll` is now enabled. If the `PreToolUse` hook is installed (the recommended setup), the hook will then `decide('allow')` for every tool call (`hooks/permission-hook.js:135`), disabling Claude Code's permission prompts in both the terminal and the dashboard. This is achievable with a single fire-and-forget request.

`POST /api/config` (`src/server.js:149-160`) is exposed the same way, with lower impact (it rewrites plan / budgets / `contextLimit`).

`/api/decision` and `/api/pause` do gate non-local callers with a token (`src/server.js:172`, `:218`), but they trust loopback unconditionally (`isLocal` ⇒ token skipped). That leaves them reachable via DNS-rebinding, where the browser's TCP peer is loopback. `/api/decision` additionally requires a random pending `id` (partial protection); `/api/pause` requires nothing and could be used to freeze Claude.

**Suggested mitigations (defense in depth):**
1. **Validate the `Host` header** on every request and reject anything other than `127.0.0.1:<port>` / `localhost:<port>`. This closes DNS-rebinding inexpensively.
2. **Reject state-changing requests that carry a cross-origin `Origin`/`Referer`.** A same-origin dashboard fetch never sends a foreign `Origin`.
3. **Require the device token for all mutating endpoints** (`/api/rules`, `/api/config`, `/api/decision`, `/api/pause`) and remove the `isLocal` bypass. The dashboard can carry the token as `/phone` does today (see SEC-2 first).
4. Add `Content-Security-Policy` and `X-Content-Type-Options: nosniff` to dashboard responses.

### <a name="sec-2"></a>SEC-2 — The device token is served to unauthenticated clients · **Severity: Medium** (applies when `bindLan` is on)

The token in `~/.claude-pulse/token` is described as a "shared secret for approving from another device on the LAN" (`src/approvals.js:8`). However, `GET /phone` embeds it in the page and serves it to any client that can reach the route, and `/phone` itself is unauthenticated (`src/server.js:209-212` → `phonepage.render(approvals.token())` → `public/phonepage.js:45`).

With `bindLan: true`, any device on the network can fetch `/phone`, read `var TOKEN = "..."` from the page source, and then call `/api/decision` (including `scope: "all"`) and `/api/pause`. In effect, the token does not protect against an actor who can already reach the server — which is the scenario it was intended to guard.

**Suggested mitigation:** treat the token as a bearer secret transferred out-of-band — printed in the CLI on `start`, shown as a QR code, or supplied via a URL fragment the page retains but never re-serves. At minimum, avoid returning the secret from an unauthenticated route. Pair this with SEC-5.

### <a name="sec-3"></a>SEC-3 — ntfy public relay exposure (documented; can be hardened) · **Severity: Medium** (opt-in)

This trade-off is already disclosed in the README's Security section, which is to the project's credit. The mechanics: approval prompts (tool name, a ~200-character command summary, and project name) are POSTed to the public `ntfy.sh/<topic>` (`hooks/permission-hook.js:80-105`), and the request `id` travels in that push. A subscriber to `<topic>` can read the id and POST `allow|all|<id>` to `<topic>-reply`, which Pulse acts on if the request is still pending (`src/ntfy.js:33-46`).

The replay/pending check is a meaningful mitigation, and "use a long random topic" is reasonable guidance. Residual considerations:
- Command summaries can convey sensitive paths or commands to a third-party relay.
- `<topic>-reply` is derivable from `<topic>`, so topic secrecy is the only control.

**Suggested mitigation:** recommend ntfy access tokens or self-hosting as the default posture for anyone enabling this, and consider omitting the raw command summary from the push body (send the tool name and project, keep the summary local).

### <a name="sec-4"></a>SEC-4 — Non-cryptographic randomness for the token and request ids · **Severity: Low–Medium**

The token is generated as `Date.now().toString(36) + Math.random()...` (`src/approvals.js:66`), and the pending `id` is similar (`hooks/permission-hook.js:140`). `Math.random()` is not cryptographically secure and is partially predictable.

**Suggested mitigation:** use `crypto.randomBytes(16).toString('hex')` for the token and `crypto.randomUUID()` for ids — single-line changes, no new dependency.

### <a name="sec-5"></a>SEC-5 — Read endpoints are unauthenticated under `bindLan` · **Severity: Medium** (opt-in, documented)

With `bindLan: true`, `/api/stats`, `/api/session`, `/api/search`, `/transcript`, `/api/export`, and `/api/export-all` are readable by any device on the network without authentication. The README does warn about this. Because transcripts can contain source code, secrets, and prompts, this is a confidentiality consideration worth tightening.

**Suggested mitigation:** when `bindLan` is enabled, gate all endpoints behind the token (resolved per SEC-2), not only the two mutating ones.

### <a name="sec-6"></a>SEC-6 — Static-file path handling (minor hardening) · **Severity: Informational**

`serveStatic` (`src/server.js:86-97`) normalizes the path and checks `fp.startsWith(PUBLIC_DIR)`. Attempts to defeat this (encoded `../`, absolute paths) did not succeed — `path.normalize` plus the prefix check hold, and an attacker cannot create sibling files. The only refinement is that `startsWith(PUBLIC_DIR)` lacks a separator boundary; `fp === PUBLIC_DIR || fp.startsWith(PUBLIC_DIR + path.sep)` would future-proof it. Not currently exploitable.

---

## Performance & efficiency findings

### <a name="perf-1"></a>PERF-1 — O(N²) aggregation in the refresh path · **Impact: High; grows with usage**

Within `scan()`, the session list maps up to 50 sessions and calls `sessionTokens(allTokens, sid)` and `sessionCost(allTokens, sid, pricing)` per session (`src/engine.js:330-331`). Each of those performs a full linear scan of `allTokens` (`src/engine.js:441-450`), which holds every assistant usage record across all history. The result is O(sessions × all-tokens-ever), recomputed on every refresh.

`getStats` caches for only 1200 ms (`src/server.js:63`) and `broadcast()` fires every 2 s whenever a tab is open (`src/server.js:289`), so this pass runs continuously and becomes more expensive the longer Claude Code is used — which counteracts the benefit of the per-file cache.

**Suggested fix:** make one pass over `allTokens` to build `tokensBySid` / `costBySid` maps, then look those up in the `.map`. This converts O(N²) to O(N) (~15 lines).

### <a name="perf-2"></a>PERF-2 — Redundant full passes over `allTokens` · **Impact: Medium**

Independently of PERF-1, `scan()` traverses `allTokens` at least four times: window/model/project buckets (`:261`), latest-context and max-context (`:289`), a full `.sort()` of all timestamps for block resets (`:389`), and the peak-spend buckets (`:404`). These can be consolidated into one or two passes. The `sortedTs` sort is O(N log N) over all history on every refresh.

### <a name="perf-3"></a>PERF-3 — Synchronous I/O and full-file reads in the request path · **Impact: Medium**

The server is single-threaded, but several handlers perform blocking I/O:
- `searchSessions` (`src/search.js:18-43`) reads every session file fully and synchronously per query, then reads each matching file a second time via `parseLog` (`src/search.js:25`, then `:28`). For large histories this blocks the event loop for the duration of the search.
- `/api/export-all` builds one in-memory string of all sessions and `gzipSync`s it (`src/server.js:251-258`, `src/transcript.js:195-201`). `gzipSync` blocks the loop; if it blocks past 10 s, the approval hook's heartbeat goes stale (`hooks/permission-hook.js:44`) and pending approvals fall back to the terminal mid-export.
- `listJsonl()` / `listSessions()` perform synchronous `readdirSync` + `statSync` on every `scan` and every search/transcript call.

**Suggested fixes:** (1) reuse the already-read `raw` buffer for `parseLog` in search rather than re-reading; (2) move export-all and search to async fs plus streaming `zlib.gzip` so the loop keeps serving; (3) consider an interval-driven file index rather than re-listing on every request.

### <a name="perf-4"></a>PERF-4 — `sessionDigest` worst-case full-history scan · **Impact: Low**

When a `sid` does not match a `<sid>.jsonl` filename, the fallback `if (!files.length) files = all;` (`src/engine.js:514`) reads every session file. Filenames normally equal the sid, so this is rare, but a single malformed `?sid=` triggers a full-disk read. Consider capping or removing the fallback.

---

## Code quality & maintainability findings

### <a name="qual-1"></a>QUAL-1 — No automated tests or CI · **Priority: High**

There are currently no tests in the repository and no CI workflow. Given that the code (a) parses semi-structured logs whose format may evolve, (b) computes cost-like figures, and (c) gates security decisions, this is the largest maintainability risk: a regression in `applyMessage` parsing, the `isLocal` logic, or cost aggregation could ship undetected.

**Suggested approach:** Node's built-in `node:test` + `assert` (zero dependencies, consistent with the project's ethos). Priority targets:
- `src/ntfy.js` `applyMessage` — decision parsing, the replay/pending guard, malformed input.
- The `/api/decision` / `/api/rules` authorization logic (and a regression test for the SEC-1 fix once applied).
- `src/engine.js` cost/window aggregation against a small fixture `.jsonl`.
- `src/transcript.js` `parseLog` + `escHtml` (assert no unescaped `<` survives).
- A minimal GitHub Actions workflow running the tests on Node 18 / 20 / 22.

### <a name="qual-2"></a>QUAL-2 — Duplication across the hooks and ntfy code · **Priority: Medium**

Several helpers are copied across files and have begun to diverge between copies:

| Helper | Locations |
|---|---|
| `readStdin` | `hooks/notify-hook.js:27`, `hooks/stop-hook.js:22`, `hooks/permission-hook.js:56` |
| `desktopNotify` / `shellQuote` / `q` | all three hooks (`:53` / `:57` / `:108`) |
| ntfy push over HTTPS | all three hooks **and** `src/ntfy.js:14` (four implementations) |
| `toolHint` | `src/engine.js:39`, `src/transcript.js:48` |
| `lanIp` | `bin/cli.js:11`, `hooks/permission-hook.js:70` |
| `readJson` / empty-catch JSON read | most files |
| `isLocal` computation | `src/server.js:166` and `:216` |

These live in the same package, so a shared `hooks/lib.js` (or `src/shared.js`) carries no dependency-isolation cost. Consolidating would remove roughly 150 lines and prevent the copies from drifting — they already differ (for example, `notify-hook` plays no sound while the others do).

### <a name="qual-3"></a>QUAL-3 — Dead code and unused configuration · **Priority: Low**

- `PLAN_BUDGETS` is defined in `src/config.js:21` and imported in `src/server.js:6` but is never used; the `loadConfig` comment (`:64-66`) explains that deriving budgets from plans was intentionally dropped. The constant and import can be removed.
- The `lanUrl` config field (`src/config.js:50`) is defined but never read.
- In `loadConfig`, the `budgets: null` default (`:48`) is immediately overwritten by `cfg.budgets = user.budgets || {...}` (`:67`), making the default unreachable.

### <a name="qual-4"></a>QUAL-4 — `scan()` carries many responsibilities · **Priority: Low–Medium**

`src/engine.js:186-439` handles parsing, windowing, model/project/hourly/daily buckets, context, ETA, resets, and peaks in a single ~250-line function. It is well sectioned and readable, but its size makes it harder to test in isolation and to change safely. Extracting `computeWindows`, `computeContext`, `computeEta`, and `computeResets` as pure functions would make each unit-testable and reduce the surface area of any single change. This is best done after tests exist (QUAL-1).

### <a name="qual-5"></a>QUAL-5 — Broad silent `catch (e) {}` blocks · **Priority: Low**

Empty catches are used throughout. Many are legitimately best-effort (disk writes that must not crash the hook). However, swallowing all errors makes field diagnosis difficult, and one case is a subtle pitfall: `readRules` returns the all-default object on any parse error (`src/approvals.js:53-59`), so a corrupted `rules.json` silently resets approval state. Defaulting to approvals-off is the *safe* direction, but the event is currently invisible.

**Suggested fix:** a small `debug(e)` helper gated on `process.env.PULSE_DEBUG` that the catches call — silent by default, diagnosable on demand.

### <a name="qual-6"></a>QUAL-6 — Open-source metadata and project files · **Priority: Medium for a community project**

`package.json` lacks `repository`, `bugs`, and `homepage` (useful once published to npm and for source links). The `author` field reads "Nikita Vdoudikoff" while the README clone URL is `github.com/nikitadoudikov/...`; these are worth reconciling. There is no `SECURITY.md` (recommended given the security surface — provide a disclosure path), no `CONTRIBUTING.md`, and no issue/PR templates. The `files` allowlist in `package.json` is correctly scoped.

---

## Correctness & robustness findings

### <a name="bug-1"></a>BUG-1 — Desktop notifications are a no-op on Windows · **Priority: High for Windows users**

`desktopNotify` in all three hooks branches only on `darwin` and `linux` (`hooks/notify-hook.js:53-62`, `hooks/stop-hook.js:57-67`, `hooks/permission-hook.js:108-119`). On `win32` it does nothing. Because the README presents desktop notifications as a general feature, Windows users receive a degraded experience with no error or explanation.

**Suggested fix:** add a `win32` branch (for example, a toast via `powershell` using the `Windows.UI.Notifications` API, or a console-bell fallback), or document the platform limitation explicitly.

### <a name="bug-2"></a>BUG-2 — `approvalTimeoutMs` above ~120 s has no effect · **Priority: Medium**

`install-hooks` writes `timeout: 120` (seconds) for the `PreToolUse` hook (`src/hooksetup.js:35`), while the hook itself accepts `approvalTimeoutMs` up to 600000 ms / 10 minutes (`hooks/permission-hook.js:37-42`). Claude Code terminates the hook at 120 s, so any configured value above ~120 s is silently capped and the approval falls back to the terminal. The README's manual install JSON omits `timeout` entirely, so hand-installers receive Claude Code's default hook timeout.

**Suggested fix:** keep the hook's maximum wait below its own `timeout`, derive the settings `timeout` from `approvalTimeoutMs` (plus a margin), add `timeout` to the README's manual JSON, and document that the two values must agree.

### <a name="bug-3"></a>BUG-3 — Non-atomic config and state writes · **Priority: Low**

`saveConfig` (`src/config.js:79`), `writeRules` (`src/approvals.js:61`), and the events file each use in-place `writeFileSync`. A crash or concurrent writer mid-write can leave truncated/corrupt JSON (which then silently resets, per QUAL-5). Probability is low; the standard remedy is to write to a temp file and `rename` (atomic on the same filesystem).

### <a name="bug-4"></a>BUG-4 — File-based protocol has no locking · **Priority: Low**

The pending/decision handshake coordinates three writers (the hook, the HTTP server, the ntfy subscriber) through files without locking. The replay guard and short-lived ids keep this largely safe, and decisions are roughly idempotent, but it is worth documenting the assumed ordering and adding a test for the "decision written as the hook times out" window (`hooks/permission-hook.js:155-169`).

---

## Prioritized roadmap

**P0 — Security correctness (small, high-value):**
- [ ] [SEC-1](#sec-1): add `Host`-header and `Origin` validation; require the token for all mutations; remove the `isLocal` bypass.
- [ ] [SEC-4](#sec-4): switch token and id generation to `crypto`.
- [ ] [SEC-2](#sec-2): stop serving the token from the unauthenticated `/phone` route.
- [ ] [BUG-1](#bug-1): add a Windows notification path (or document the limitation).

**P1 — Stability & confidence:**
- [ ] [QUAL-1](#qual-1): a `node:test` suite covering authorization, ntfy parsing, cost aggregation, and escaping; add CI.
- [ ] [PERF-1](#perf-1): pre-aggregate per-sid totals to eliminate the O(N²) pass.
- [ ] [BUG-2](#bug-2): reconcile `approvalTimeoutMs` with the hook `timeout`.
- [ ] [SEC-5](#sec-5): gate all endpoints behind the token when `bindLan` is on.

**P2 — Maintainability & polish:**
- [ ] [QUAL-2](#qual-2): extract shared hook/ntfy helpers.
- [ ] [PERF-3](#perf-3): async fs and streaming gzip; reuse the read buffer in search.
- [ ] [QUAL-3](#qual-3): remove dead `PLAN_BUDGETS` / `lanUrl`.
- [ ] [QUAL-6](#qual-6): add `repository` / `bugs` / `homepage`, `SECURITY.md`, `CONTRIBUTING.md`; reconcile author/URL.
- [ ] [QUAL-4](#qual-4) / [PERF-2](#perf-2): decompose `scan()` and consolidate redundant passes (after tests exist).

---

## Summary

The foundations here are sound: a clear design, readable code, accurate documentation, and a permission hook built with genuine care for not blocking Claude. This is not a rewrite candidate. The principal gaps are a web security model that needs to be completed, a performance path that scales poorly with history size, and the absence of an automated test net — each of which is common in a single-maintainer project and each of which is addressable incrementally. The P0 list is a focused, few-hour effort and resolves the only findings that would otherwise block recommending Pulse broadly.

*Every code reference above is `path:line` against the reviewed tree and should be clickable in an editor.*
