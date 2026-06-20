'use strict';

// Wire (or unwire) the Pulse hooks in ~/.claude/settings.json so users do not
// have to hand edit JSON. Idempotent: it never adds a hook that is already
// there, merges next to any hooks you already have, and keeps a one time backup.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const HOOKS_DIR = path.join(__dirname, '..', 'hooks');
const EVENTS = { Notification: 'notify-hook.js', Stop: 'stop-hook.js', PreToolUse: 'permission-hook.js' };

function load() {
  try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch (e) { return {}; }
}

function save(s) {
  try { fs.mkdirSync(path.dirname(SETTINGS), { recursive: true }); } catch (e) {}
  try { if (fs.existsSync(SETTINGS) && !fs.existsSync(SETTINGS + '.pulsebak')) fs.copyFileSync(SETTINGS, SETTINGS + '.pulsebak'); } catch (e) {}
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2));
}

function installHooks() {
  const s = load();
  s.hooks = s.hooks || {};
  let added = 0, already = 0;
  for (const ev of Object.keys(EVENTS)) {
    s.hooks[ev] = s.hooks[ev] || [];
    const has = s.hooks[ev].some((g) => (g.hooks || []).some((h) => (h.command || '').indexOf(EVENTS[ev]) !== -1));
    if (has) { already++; continue; }
    const hookObj = { type: 'command', command: 'node ' + path.join(HOOKS_DIR, EVENTS[ev]) };
    // give the approval hook room to wait for your click before Claude Code kills it
    if (ev === 'PreToolUse') hookObj.timeout = 120;
    s.hooks[ev].push({ matcher: '', hooks: [hookObj] });
    added++;
  }
  save(s);
  return { added, already };
}

function uninstallHooks() {
  const s = load();
  if (!s.hooks) return { removed: 0 };
  let removed = 0;
  for (const ev of Object.keys(EVENTS)) {
    if (!s.hooks[ev]) continue;
    const before = JSON.stringify(s.hooks[ev]);
    s.hooks[ev] = s.hooks[ev]
      .map((g) => Object.assign({}, g, { hooks: (g.hooks || []).filter((h) => (h.command || '').indexOf(EVENTS[ev]) === -1) }))
      .filter((g) => (g.hooks || []).length);
    if (JSON.stringify(s.hooks[ev]) !== before) removed++;
    if (!s.hooks[ev].length) delete s.hooks[ev];
  }
  save(s);
  return { removed };
}

module.exports = { installHooks, uninstallHooks, SETTINGS };
