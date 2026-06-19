'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadConfig, saveConfig, PLAN_BUDGETS } = require('./config');
const { scan, sessionDigest } = require('./engine');
const notify = require('./notify');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

let statsCache = { at: 0, data: null };

function getStats() {
  const now = Date.now();
  if (statsCache.data && now - statsCache.at < 1200) return statsCache.data;

  const config = loadConfig();
  const data = scan(config);

  // strip synthetic / empty model buckets for a clean breakdown
  for (const k of Object.keys(data.byModel)) {
    if (!data.byModel[k].tokens || k === '<synthetic>') delete data.byModel[k];
  }

  const events = notify.readEvents(20);
  data.waiting = notify.computeWaiting(events, data.sessions, now);
  data.notifications = events.slice(0, 10);

  statsCache = { at: now, data };
  return data;
}

function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const fp = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!fp.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(buf);
  });
}

function sendJson(res, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, cb) {
  let data = '';
  req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
  req.on('end', () => { let o = {}; try { o = JSON.parse(data || '{}'); } catch (e) {} cb(o); });
}

const sseClients = new Set();

function broadcast() {
  if (!sseClients.size) return;
  let payload;
  try { payload = JSON.stringify(getStats()); } catch (e) { return; }
  const frame = `event: stats\ndata: ${payload}\n\n`;
  for (const res of sseClients) {
    try { res.write(frame); } catch (e) {}
  }
}

function handleSse(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write('retry: 3000\n\n');
  sseClients.add(res);
  // initial push
  try { res.write(`event: stats\ndata: ${JSON.stringify(getStats())}\n\n`); } catch (e) {}
  req.on('close', () => sseClients.delete(res));
}

function createServer() {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/api/stats') return sendJson(res, getStats());
    if (url === '/api/events') return handleSse(req, res);
    if (url === '/api/health') return sendJson(res, { ok: true });
    if (url === '/api/session') {
      const q = new URLSearchParams(req.url.split('?')[1] || '');
      const sid = q.get('sid');
      if (!sid) { res.writeHead(400); return res.end('sid required'); }
      try { return sendJson(res, sessionDigest(sid, loadConfig())); }
      catch (e) { res.writeHead(500); return res.end('error'); }
    }
    if (url === '/api/config' && req.method === 'POST') {
      return readBody(req, (body) => {
        const partial = {};
        const PLANS = ['unknown', 'pro', 'max5', 'max20', 'custom'];
        if (body && PLANS.indexOf(body.plan) !== -1) partial.plan = body.plan;
        if (body && body.budgets) partial.budgets = body.budgets;
        if (body && body.contextLimit) partial.contextLimit = body.contextLimit;
        const cfg = saveConfig(partial);
        statsCache.at = 0;
        sendJson(res, { ok: true, config: cfg });
      });
    }
    if (url === '/api/config') return sendJson(res, loadConfig());
    return serveStatic(req, res);
  });
  return server;
}

function start(opts) {
  const options = opts || {};
  const port = options.port || 4317;
  notify.ensureRuntimeDir();

  const server = createServer();

  // periodic live push (cheap thanks to the per-file parse cache)
  const timer = setInterval(broadcast, 2000);
  timer.unref && timer.unref();

  // instant push when the hook appends a notification
  try {
    fs.watch(notify.runtimeDir(), () => { statsCache.at = 0; broadcast(); });
  } catch (e) {}

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, port }));
  });
}

module.exports = { start, getStats, createServer };
