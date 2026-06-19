'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Runtime dir shared with the Claude Code hook. The hook appends one JSON
// object per line here when Claude needs attention (a permission prompt,
// "waiting for input", or a finished run).
const RUNTIME_DIR = path.join(os.homedir(), '.claude-pulse');
const EVENTS_FILE = path.join(RUNTIME_DIR, 'events.jsonl');

function eventsPath() { return EVENTS_FILE; }
function runtimeDir() { return RUNTIME_DIR; }

function ensureRuntimeDir() {
  try { fs.mkdirSync(RUNTIME_DIR, { recursive: true }); } catch (e) {}
}

function readEvents(limit) {
  let raw;
  try { raw = fs.readFileSync(EVENTS_FILE, 'utf8'); } catch (e) { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch (e) {}
  }
  out.sort((a, b) => (b.time || 0) - (a.time || 0));
  return limit ? out.slice(0, limit) : out;
}

// A notification is "waiting" if it is recent and the session it belongs to
// has not produced newer activity (which would mean the prompt was answered).
function computeWaiting(events, sessions, now) {
  const t = now || Date.now();
  const recentMs = 30 * 60 * 1000; // ignore stale prompts older than 30 min
  const bySid = {};
  for (const s of sessions || []) bySid[s.sid] = s;

  for (const ev of events) {
    if (ev.type !== 'permission' && ev.type !== 'notification') continue;
    if (!ev.time || t - ev.time > recentMs) continue;
    const s = ev.sessionId ? bySid[ev.sessionId] : null;
    // resolved if the session moved after the prompt fired
    if (s && s.lastT && s.lastT > ev.time + 1500) continue;
    return {
      time: ev.time,
      message: ev.message || 'Claude needs your attention',
      sessionId: ev.sessionId || null,
      project: s ? s.project : (ev.cwd ? path.basename(ev.cwd) : null),
    };
  }
  return null;
}

module.exports = { readEvents, computeWaiting, eventsPath, runtimeDir, ensureRuntimeDir };
