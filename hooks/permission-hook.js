#!/usr/bin/env node
'use strict';

/*
 * Claude Code "PreToolUse" hook for Pulse: approve tools from the dashboard.
 *
 * Safety first. This hook can pause a tool while it waits for your click, so it
 * is built to NEVER hang Claude:
 *   - if Pulse is not running (stale heartbeat) it returns immediately and the
 *     normal terminal prompt happens, exactly as without this hook
 *   - read only tools are auto allowed so they never wait
 *   - standing rules (allow all / per tool) answer instantly
 *   - a hard timeout falls back to the normal prompt
 *   - any error falls back to the normal prompt
 *
 * Wire it to PreToolUse in ~/.claude/settings.json (see README). Opt in.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const DIR = path.join(os.homedir(), '.claude-pulse');
const PENDING = path.join(DIR, 'pending');
const DECISIONS = path.join(DIR, 'decisions');
const ALIVE = path.join(DIR, 'alive');
const RULES = path.join(DIR, 'rules.json');
const TOKEN = path.join(DIR, 'token');
const CONFIG = path.join(os.homedir(), '.claude-pulse.json');

const SAFE = ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'TodoWrite', 'WebFetch', 'WebSearch'];
// How long to wait for your click before falling back to the normal terminal
// prompt. Short by default so Claude never feels stuck; override with
// "approvalTimeoutMs" in ~/.claude-pulse.json.
function timeoutMs() {
  var v = (readJson(CONFIG, {}) || {}).approvalTimeoutMs;
  v = parseInt(v, 10);
  if (!v || v < 5000) return 60 * 1000;
  return Math.min(v, 10 * 60 * 1000);
}
const POLL_MS = 300;
const HEARTBEAT_MAX = 10 * 1000;

function passthrough() { process.exit(0); }                 // no output = normal permission flow
function decide(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason || 'Pulse' },
  }));
  process.exit(0);
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function readJson(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fb; } }
function aliveFresh() { try { return Date.now() - (parseInt(fs.readFileSync(ALIVE, 'utf8'), 10) || 0) < HEARTBEAT_MAX; } catch (e) { return false; } }
function readStdin() {
  return new Promise(function (r) {
    var d = ''; if (process.stdin.isTTY) return r('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', function (c) { d += c; });
    process.stdin.on('end', function () { r(d); });
    setTimeout(function () { r(d); }, 800);
  });
}
function summarize(tool, input) {
  if (!input || typeof input !== 'object') return tool;
  var h = input.command || input.file_path || input.path || input.pattern || input.url || input.description || '';
  return String(h).replace(/\s+/g, ' ').trim().slice(0, 200);
}
function lanIp() {
  try {
    var ifs = os.networkInterfaces();
    for (var k in ifs) for (var i = 0; i < ifs[k].length; i++) {
      var a = ifs[k][i];
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  } catch (e) {}
  return '';
}
function pushNtfy(input) {
  var topic = '';
  try { topic = (readJson(CONFIG, {}) || {}).ntfyTopic || ''; } catch (e) {}
  if (!topic) return Promise.resolve();
  var tool = input._tool, summary = input._summary, id = input._id, project = input._project;
  var rt = 'https://ntfy.sh/' + encodeURIComponent(topic + '-reply');
  return new Promise(function (resolve) {
    // the buttons post the answer back through ntfy; Pulse is subscribed to the
    // reply topic, so no LAN, IP or open port is needed. Works anywhere.
    var headers = {
      'Title': ('Allow ' + tool + (project ? ' in ' + project : '')).replace(/[^\x20-\x7E]/g, ''),
      'Tags': 'lock', 'Priority': 'high',
      'Actions': [
        'http, Allow, ' + rt + ', method=POST, body=allow|once|' + id + ', clear=true',
        'http, Allow all, ' + rt + ', method=POST, body=allow|all|' + id + ', clear=true',
        'http, Deny, ' + rt + ', method=POST, body=deny|once|' + id + ', clear=true',
      ].join('; '),
    };
    var data = Buffer.from(String(summary || tool), 'utf8');
    headers['Content-Length'] = data.length;
    var req = https.request({ method: 'POST', hostname: 'ntfy.sh', path: '/' + encodeURIComponent(topic), headers: headers },
      function (res) { res.on('data', function () {}); res.on('end', resolve); });
    req.on('error', resolve); req.write(data); req.end();
    setTimeout(resolve, 2500);
  });
}

(async function () {
  try {
    var raw = await readStdin();
    var input = {}; try { input = JSON.parse(raw); } catch (e) {}
    var tool = input.tool_name || input.toolName || 'Tool';

    // read only tools never wait
    if (SAFE.indexOf(tool) !== -1) return passthrough();

    var rules = readJson(RULES, { enabled: false, allowAll: false, allowTools: [], denyTools: [], paused: false });
    // pause works independently of remote approvals: stop further actions on tap
    if (rules.paused) return decide('deny', 'Paused from Pulse - resume on your phone or the dashboard to continue');
    if (!rules.enabled) return passthrough();   // remote approvals are opt-in; off by default
    if (rules.denyTools && rules.denyTools.indexOf(tool) !== -1) return decide('deny', 'Denied by Pulse rule');
    if (rules.allowAll || (rules.allowTools && rules.allowTools.indexOf(tool) !== -1)) return decide('allow', 'Allowed by Pulse rule');

    // if Pulse is not up, do nothing special: normal terminal prompt
    if (!aliveFresh()) return passthrough();

    var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var cwd = input.cwd || '';
    var project = cwd ? path.basename(cwd) : '';
    var summary = summarize(tool, input.tool_input || input.toolInput);
    try { fs.mkdirSync(PENDING, { recursive: true }); } catch (e) {}
    try {
      fs.writeFileSync(path.join(PENDING, id + '.json'), JSON.stringify({
        id: id, time: Date.now(), sessionId: input.session_id || input.sessionId || null,
        cwd: cwd, project: project, tool: tool, summary: summary,
      }));
    } catch (e) { return passthrough(); }

    pushNtfy({ _tool: tool, _summary: summary, _id: id, _project: project });

    var start = Date.now(), decision = null, deadline = timeoutMs();
    while (Date.now() - start < deadline) {
      decision = readJson(path.join(DECISIONS, id + '.json'), null);
      if (decision) break;
      await sleep(POLL_MS);
    }
    try { fs.unlinkSync(path.join(PENDING, id + '.json')); } catch (e) {}
    try { fs.unlinkSync(path.join(DECISIONS, id + '.json')); } catch (e) {}

    if (!decision) return passthrough();                       // timed out, normal prompt
    if (decision.decision === 'deny') return decide('deny', 'Denied in Pulse');
    return decide('allow', 'Approved in Pulse');
  } catch (e) {
    return passthrough();                                      // never block on a bug
  }
})();
