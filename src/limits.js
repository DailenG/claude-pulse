'use strict';

// Detect a real Claude Code limit notice and read the exact reset time from it.
// Claude Code, when you hit a usage limit, writes one short assistant message
// whose entire text is e.g. "You've hit your session limit · resets 6:10pm
// (Europe/Brussels)". We anchor on that exact shape so prose that merely talks
// about limits (long messages) and tool results (role: user) never match.

const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const LIMIT_RE = /^you['’]ve hit your (?:session|usage|account) limit\s*[·]\s*resets\s+(\d{1,2}:\d{2}\s*[ap]m)(?:\s*\(([^)]+)\))?/i;

let cache = { at: 0, result: undefined };

// Turn "6:10pm" into the first timestamp that clock occurs at or after `afterMs`
// (the reset always lands after the moment you hit the limit). Interpreted in
// the machine's local timezone, which is the user's, the same as the message.
function resetTimestamp(timeStr, afterMs) {
  const m = /(\d{1,2}):(\d{2})\s*([ap])m/i.exec(timeStr || '');
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toLowerCase() === 'p') h += 12;
  const min = parseInt(m[2], 10);
  const base = new Date(afterMs);
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, min, 0, 0);
  if (d.getTime() <= afterMs) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function textOf(o) {
  const c = o && o.message && o.message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    for (let i = 0; i < c.length; i++) {
      const part = c[i];
      if (part && part.type === 'text' && typeof part.text === 'string') return part.text;
    }
  }
  return '';
}

// The most recent real limit hit that is still in effect (reset still ahead),
// or null. Cached for 20s; cheap because files without the phrase are skipped.
function detectLimit(nowMs) {
  const now = nowMs || Date.now();
  if (cache.result !== undefined && now - cache.at < 20000) return cache.result;
  let best = null;
  let dirs;
  try { dirs = fs.readdirSync(PROJECTS_DIR); } catch (e) { cache = { at: now, result: null }; return null; }
  for (let di = 0; di < dirs.length; di++) {
    const dp = path.join(PROJECTS_DIR, dirs[di]);
    let files;
    try { files = fs.readdirSync(dp); } catch (e) { continue; }
    for (let fi = 0; fi < files.length; fi++) {
      if (!files[fi].endsWith('.jsonl')) continue;
      const fp = path.join(dp, files[fi]);
      let st;
      try { st = fs.statSync(fp); } catch (e) { continue; }
      if (now - st.mtimeMs > 8 * 3600 * 1000) continue; // only recently active logs
      let raw;
      try { raw = fs.readFileSync(fp, 'utf8'); } catch (e) { continue; }
      if (raw.indexOf('hit your') === -1) continue; // fast skip
      const lines = raw.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line || line.indexOf('hit your') === -1) continue;
        let o;
        try { o = JSON.parse(line); } catch (e) { continue; }
        if (!o.message || o.message.role !== 'assistant') continue;
        const mm = LIMIT_RE.exec(textOf(o).trim());
        if (!mm) continue;
        const hitT = o.timestamp ? Date.parse(o.timestamp) : st.mtimeMs;
        if (!best || hitT > best.hitT) best = { hitT: hitT, timeStr: mm[1].replace(/\s+/g, ''), tz: mm[2] || '' };
        break; // newest match in this file is enough
      }
    }
  }
  let result = null;
  if (best) {
    const resetsAt = resetTimestamp(best.timeStr, best.hitT);
    // still in effect only if the hit is recent and its reset has not passed
    if (resetsAt && resetsAt > now && now - best.hitT < 6 * 3600 * 1000) {
      result = { hitT: best.hitT, resetsAt: resetsAt, resetText: best.timeStr, tz: best.tz };
    }
  }
  cache = { at: now, result: result };
  return result;
}

module.exports = { detectLimit, resetTimestamp };
