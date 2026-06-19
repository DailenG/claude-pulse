#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const { start } = require('../src/server');

function parseArgs(argv) {
  const out = { port: 4317, open: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') out.port = parseInt(argv[++i], 10) || out.port;
    else if (a === '--no-open') out.open = false;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--version' || a === '-v') out.version = true;
  }
  return out;
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const child = spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: platform === 'win32' });
    child.unref();
  } catch (e) {}
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`claude-pulse - local dashboard for Claude Code

Usage: claude-pulse [options]

Options:
  -p, --port <n>   port to listen on (default 4317)
      --no-open    do not open the browser automatically
  -h, --help       show this help
  -v, --version    show version
`);
    return;
  }
  if (args.version) {
    console.log(require('../package.json').version);
    return;
  }

  try {
    const { port } = await start({ port: args.port });
    const url = `http://127.0.0.1:${port}`;
    console.log(`\n  Pulse for Claude Code`);
    console.log(`  running at ${url}`);
    console.log(`  reading ~/.claude/projects (read only)\n`);
    console.log(`  press ctrl+c to stop\n`);
    if (args.open) openBrowser(url);
  } catch (e) {
    if (e && e.code === 'EADDRINUSE') {
      console.error(`\n  port ${args.port} is busy. try: claude-pulse --port ${args.port + 1}\n`);
    } else {
      console.error('  failed to start:', e && e.message);
    }
    process.exit(1);
  }
}

main();
