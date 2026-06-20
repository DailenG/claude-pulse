'use strict';

// Periodically save a light markdown snapshot of every recently active session,
// so a crash, freeze or closed terminal never loses one. Cheap by design: only
// sessions that changed since the last pass are rewritten, and we keep a single
// file per session (snapshots/<sid8>.md), so disk use stays bounded.

const fs = require('fs');
const os = require('os');
const path = require('path');
const transcript = require('./transcript');

const SNAP_DIR = path.join(os.homedir(), '.claude-pulse', 'exports', 'snapshots');
const lastMtime = new Map();

function snapshotActive(config) {
  const windowMin = (config && config.snapshotWindowMin) || 120;
  const cutoff = Date.now() - windowMin * 60000;
  let n = 0;
  try { fs.mkdirSync(SNAP_DIR, { recursive: true }); } catch (e) {}
  for (const s of transcript.listSessions()) {
    if (s.mtimeMs < cutoff) continue;                 // only recently active sessions
    if (lastMtime.get(s.sid) === s.mtimeMs) continue; // unchanged since last snapshot
    try {
      fs.writeFileSync(path.join(SNAP_DIR, s.sid.slice(0, 8) + '.md'), transcript.renderMarkdown(s.file, {}));
      lastMtime.set(s.sid, s.mtimeMs);
      n++;
    } catch (e) {}
  }
  return n;
}

module.exports = { snapshotActive, SNAP_DIR };
