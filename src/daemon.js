'use strict';

// Run Pulse detached from the terminal that started it, so closing or crashing
// that terminal does not take Pulse down. start() spawns the server in its own
// process group and records the pid; the parent command returns immediately.
// On macOS, installService() goes further and hands Pulse to launchd, which
// starts it at login and respawns it if it ever dies.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const STATE_DIR = path.join(os.homedir(), '.claude-pulse');
const PID_FILE = path.join(STATE_DIR, 'pulse.pid');
const LOG_FILE = path.join(STATE_DIR, 'pulse.log');
const CLI = path.join(__dirname, '..', 'bin', 'cli.js');
const PLIST_LABEL = 'com.claude-pulse';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', PLIST_LABEL + '.plist');

function ensureDir() { try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch (e) {} }

function readState() {
  try { return JSON.parse(fs.readFileSync(PID_FILE, 'utf8')); } catch (e) { return null; }
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function running() {
  const s = readState();
  return s && isAlive(s.pid) ? s : null;
}

function start(opts = {}) {
  ensureDir();
  const cur = running();
  if (cur) {
    console.log(`already running (pid ${cur.pid}) at http://127.0.0.1:${cur.port}`);
    return cur;
  }
  const port = opts.port || 4317;
  const out = fs.openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, [CLI, 'run', '--no-open', '--port', String(port)], {
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  const state = { pid: child.pid, port, startedAt: new Date().toISOString() };
  fs.writeFileSync(PID_FILE, JSON.stringify(state));
  console.log(`Pulse started in the background (pid ${child.pid})`);
  console.log(`  http://127.0.0.1:${port}`);
  console.log(`  it keeps running after you close this terminal`);
  console.log(`  stop:   claude-pulse stop`);
  console.log(`  status: claude-pulse status`);
  console.log(`  log:    ${LOG_FILE}`);
  return state;
}

function stop() {
  const s = readState();
  if (!s || !isAlive(s.pid)) {
    console.log('not running');
    try { fs.unlinkSync(PID_FILE); } catch (e) {}
    return;
  }
  try { process.kill(s.pid, 'SIGTERM'); } catch (e) {}
  try { fs.unlinkSync(PID_FILE); } catch (e) {}
  console.log(`stopped (pid ${s.pid})`);
}

function restart(opts) {
  stop();
  return start(opts);
}

function status() {
  const s = running();
  if (s) {
    console.log(`running (pid ${s.pid}) at http://127.0.0.1:${s.port}`);
    console.log(`  since ${s.startedAt}`);
  } else if (fs.existsSync(PLIST_PATH)) {
    console.log('not in the pid file, but a launch agent is installed (launchd manages it).');
    console.log('  check: launchctl list | grep claude-pulse');
  } else {
    console.log('not running. start with: claude-pulse start');
  }
}

function installService(opts = {}) {
  if (process.platform !== 'darwin') {
    console.log('install-service is macOS only. on this OS use: claude-pulse start');
    return;
  }
  ensureDir();
  const port = opts.port || 4317;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${CLI}</string>
    <string>run</string>
    <string>--no-open</string>
    <string>--port</string>
    <string>${port}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG_FILE}</string>
  <key>StandardErrorPath</key><string>${LOG_FILE}</string>
</dict>
</plist>
`;
  // a manual background instance would hold the port, so retire it first
  stop();
  try { fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true }); } catch (e) {}
  fs.writeFileSync(PLIST_PATH, plist);
  try { execFileSync('launchctl', ['unload', PLIST_PATH], { stdio: 'ignore' }); } catch (e) {}
  try {
    execFileSync('launchctl', ['load', '-w', PLIST_PATH], { stdio: 'ignore' });
  } catch (e) {
    console.error('could not load the launch agent:', e && e.message);
    return;
  }
  console.log(`installed launch agent "${PLIST_LABEL}"`);
  console.log(`  Pulse now starts at login and respawns itself if it ever dies`);
  console.log(`  http://127.0.0.1:${port}`);
  console.log(`  remove with: claude-pulse uninstall-service`);
}

function uninstallService() {
  if (process.platform !== 'darwin') { console.log('nothing to remove on this OS'); return; }
  try { execFileSync('launchctl', ['unload', '-w', PLIST_PATH], { stdio: 'ignore' }); } catch (e) {}
  try {
    fs.unlinkSync(PLIST_PATH);
    console.log('removed launch agent. Pulse will no longer start at login.');
  } catch (e) {
    console.log('no launch agent was installed');
  }
}

module.exports = { start, stop, restart, status, installService, uninstallService, running };
