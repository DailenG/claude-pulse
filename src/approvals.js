'use strict';

// Shared state between the PreToolUse hook and the dashboard, all on local disk.
//   alive            - server heartbeat; the hook refuses to block if it is stale
//   pending/<id>     - a tool waiting for your decision
//   decisions/<id>   - your answer, written by the dashboard
//   rules.json       - standing auto allow rules (allow all / per tool)
//   token            - shared secret for approving from another device on the LAN

const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = path.join(os.homedir(), '.claude-pulse');
const PENDING = path.join(DIR, 'pending');
const DECISIONS = path.join(DIR, 'decisions');
const RULES = path.join(DIR, 'rules.json');
const ALIVE = path.join(DIR, 'alive');
const TOKEN = path.join(DIR, 'token');

function ensure() {
  for (const d of [DIR, PENDING, DECISIONS]) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} }
}

function heartbeat() { ensure(); try { fs.writeFileSync(ALIVE, String(Date.now())); } catch (e) {} }
function isAlive(maxAgeMs) {
  try { return Date.now() - (parseInt(fs.readFileSync(ALIVE, 'utf8'), 10) || 0) < (maxAgeMs || 10000); }
  catch (e) { return false; }
}

function readPending() {
  ensure();
  let files = [];
  try { files = fs.readdirSync(PENDING); } catch (e) {}
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(PENDING, f), 'utf8'))); } catch (e) {}
  }
  // drop stale requests (hook gone) older than 5 min
  const now = Date.now();
  const fresh = out.filter(r => r.time && now - r.time < 5 * 60 * 1000);
  out.sort((a, b) => (a.time || 0) - (b.time || 0));
  return fresh.sort((a, b) => (a.time || 0) - (b.time || 0));
}
function writePending(req) { ensure(); try { fs.writeFileSync(path.join(PENDING, req.id + '.json'), JSON.stringify(req)); } catch (e) {} }
function removePending(id) { try { fs.unlinkSync(path.join(PENDING, id + '.json')); } catch (e) {} }

function writeDecision(id, decision) { ensure(); try { fs.writeFileSync(path.join(DECISIONS, id + '.json'), JSON.stringify(decision)); } catch (e) {} }
function readDecision(id) { try { return JSON.parse(fs.readFileSync(path.join(DECISIONS, id + '.json'), 'utf8')); } catch (e) { return null; } }
function removeDecision(id) { try { fs.unlinkSync(path.join(DECISIONS, id + '.json')); } catch (e) {} }

function readRules() {
  try {
    const r = JSON.parse(fs.readFileSync(RULES, 'utf8'));
    if (typeof r.enabled !== 'boolean') r.enabled = false; // remote approvals are opt-in
    if (typeof r.paused !== 'boolean') r.paused = false;   // pause is independent of approvals
    return r;
  } catch (e) { return { enabled: false, allowAll: false, allowTools: [], denyTools: [], paused: false }; }
}
function writeRules(r) { ensure(); try { fs.writeFileSync(RULES, JSON.stringify(r, null, 2)); } catch (e) {} }

function token() {
  ensure();
  try { const t = fs.readFileSync(TOKEN, 'utf8').trim(); if (t) return t; } catch (e) {}
  const t = (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
  try { fs.writeFileSync(TOKEN, t); } catch (e) {}
  return t;
}

module.exports = {
  DIR, PENDING, DECISIONS,
  ensure, heartbeat, isAlive,
  readPending, writePending, removePending,
  writeDecision, readDecision, removeDecision,
  readRules, writeRules, token,
};
