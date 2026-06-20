#!/usr/bin/env node
'use strict';

// Save a Claude Code session to a light markdown file. Works with no server
// running. See src/transcript.js for the rendering.

const fs = require('fs');
const t = require('../src/transcript');

function parseArgs(argv) {
  const out = { full: false, gz: false, list: false, sid: null };
  for (const a of argv) {
    if (a === '--full') out.full = true;
    else if (a === '--gz') out.gz = true;
    else if (a === '--list' || a === '-l') out.list = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('-')) out.sid = a;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`claude-pulse-export - save a Claude Code session to a light markdown file

Usage:
  claude-pulse-export [session] [options]

  session   session id (or prefix), or "latest" (default)

Options:
  -l, --list   list recent sessions and exit
      --full   include full tool inputs (bigger file)
      --gz     also write a gzipped copy
  -h, --help   show this help

Works with no server running. Reads ~/.claude/projects (read only),
writes to ~/.claude-pulse/exports/.`);
    return;
  }

  if (args.list) {
    const all = t.listSessions().slice(0, 25);
    if (!all.length) { console.log('no sessions found under ~/.claude/projects'); return; }
    for (const s of all) {
      const mb = (s.size / 1048576).toFixed(1);
      console.log(`${s.sid}  ${new Date(s.mtimeMs).toISOString().slice(0, 16).replace('T', ' ')}  ${mb} MB`);
    }
    return;
  }

  const s = t.findSession(args.sid);
  if (!s) { console.error(`no session matching "${args.sid || 'latest'}". try --list`); process.exit(1); }

  const r = t.saveExport(s, args);
  console.log(`exported ${s.sid}`);
  console.log(`  raw log: ${(s.size / 1048576).toFixed(1)} MB  ->  export: ${(Buffer.byteLength(r.md) / 1024).toFixed(0)} KB`);
  console.log(`  ${r.path}`);
  if (r.gz) console.log(`  ${r.gz}  (${(fs.statSync(r.gz).size / 1024).toFixed(0)} KB)`);
}

main();
