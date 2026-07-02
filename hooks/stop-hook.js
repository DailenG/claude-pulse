#!/usr/bin/env node
'use strict';

/*
 * Claude Code "Stop" hook for Pulse.
 *
 * Fires when Claude finishes a turn (it is now your turn). Sends a phone push
 * via ntfy.sh so you know to come back, debounced so a rapid back-and-forth
 * does not spam you. Requires "ntfyTopic" in ~/.claude-pulse.json.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

const RUNTIME = path.join(os.homedir(), '.claude-pulse');
const LAST = path.join(RUNTIME, 'last-stop-push');
const COOLDOWN = 30 * 1000;

function readStdin() {
  return new Promise(function (r) {
    var d = '';
    if (process.stdin.isTTY) return r('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', function (c) { d += c; });
    process.stdin.on('end', function () { r(d); });
    setTimeout(function () { r(d); }, 500);
  });
}
function readConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude-pulse.json'), 'utf8')); }
  catch (e) { return {}; }
}
function push(t, title, msg, tags) {
  if (!t) return Promise.resolve();
  const cfg = readConfig();
  const transport = cfg.ntfyServerHttps !== false ? https : http;
  return new Promise(function (res) {
    var data = Buffer.from(msg || '', 'utf8');
    var req = transport.request({
      method: 'POST', hostname: cfg.ntfyServer || 'ntfy.sh', path: '/' + encodeURIComponent(t),
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': data.length,
        'Title': String(title || 'Claude Code').replace(/[^\x20-\x7E]/g, ''),
        'Tags': tags || 'white_check_mark',
        'Priority': 'default',
      },
    }, function (r) { r.on('data', function () {}); r.on('end', res); });
    req.on('error', res);
    req.write(data); req.end();
    setTimeout(res, 2500);
  });
}

function shellQuote(s) { return '"' + String(s).replace(/["\\]/g, '\\$&') + '"'; }
function desktopNotify(title, body, sound) {
  try {
    if (process.platform === 'darwin') {
      var script = 'display notification ' + shellQuote(body) + ' with title ' + shellQuote(title);
      spawn('osascript', ['-e', script], { stdio: 'ignore', detached: true }).unref();
      if (sound) spawn('afplay', ['/System/Library/Sounds/' + sound + '.aiff'], { stdio: 'ignore', detached: true }).unref();
    } else if (process.platform === 'linux') {
      spawn('notify-send', [title, body], { stdio: 'ignore', detached: true }).unref();
    }
  } catch (e) {}
}

(async function () {
  const raw = await readStdin();
  let input = {}; try { input = JSON.parse(raw); } catch (e) {}

  // debounce so a rapid back-and-forth does not spam you
  try { const last = parseInt(fs.readFileSync(LAST, 'utf8'), 10) || 0; if (Date.now() - last < COOLDOWN) return process.exit(0); } catch (e) {}
  try { fs.mkdirSync(RUNTIME, { recursive: true }); fs.writeFileSync(LAST, String(Date.now())); } catch (e) {}

  const project = input.cwd ? path.basename(input.cwd) : '';
  // desktop banner always; phone push only if an ntfy topic is set
  desktopNotify('Claude finished' + (project ? ' · ' + project : ''), 'Your turn', 'Glass');
  const t = (readConfig().ntfyTopic || '').trim();
  if (t) await push(t, 'Claude finished' + (project ? ' (' + project + ')' : ''), 'Your turn' + (project ? ' in ' + project : ''), 'white_check_mark');
  process.exit(0);
})();
