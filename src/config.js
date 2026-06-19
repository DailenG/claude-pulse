'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// API list prices per 1M tokens (USD). Used only to estimate an
// "API-equivalent" cost for subscription users, who do not pay per token.
// Override any of these in ~/.claude-pulse.json -> "pricing".
const PRICING = {
  opus:    { in: 15, out: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  sonnet:  { in: 3,  out: 15, cacheWrite: 3.75,  cacheRead: 0.3 },
  haiku:   { in: 1,  out: 5,  cacheWrite: 1.25,  cacheRead: 0.1 },
  default: { in: 3,  out: 15, cacheWrite: 3.75,  cacheRead: 0.3 },
};

// Anthropic does not publish exact subscription limits, and they are usage
// based rather than a hard token number. These are rough API-equivalent
// budgets (USD) per rolling window, meant as a starting point. Edit them in
// ~/.claude-pulse.json -> "budgets" to match what you actually observe.
const PLAN_BUDGETS = {
  pro:    { fiveHour: 8,   day: 20,  week: 60 },
  max5:   { fiveHour: 35,  day: 90,  week: 280 },
  max20:  { fiveHour: 140, day: 360, week: 1100 },
  custom: { fiveHour: null, day: null, week: null },
};

function priceFor(model, pricing) {
  const p = pricing || PRICING;
  const m = String(model || '').toLowerCase();
  if (m.includes('opus')) return p.opus;
  if (m.includes('sonnet')) return p.sonnet;
  if (m.includes('haiku')) return p.haiku;
  return p.default;
}

function configPath() {
  return path.join(os.homedir(), '.claude-pulse.json');
}

function loadConfig() {
  const defaults = {
    plan: 'unknown',      // we cannot detect the real plan, so never claim one
    contextLimit: 200000, // Opus/Sonnet default; 1M is auto-detected per session
    idleMinutes: 10,      // a session is "active" if it moved within this window
    pricing: PRICING,
    budgets: null,        // filled from the plan preset unless set explicitly
    ntfyTopic: '',        // ntfy.sh topic for phone push; empty = off
  };

  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch (e) {
    // no user config yet, defaults are fine
  }

  const cfg = Object.assign({}, defaults, user);
  cfg.pricing = Object.assign({}, PRICING, user.pricing || {});
  // Budgets are opt-in only. We never derive a USD budget from the plan: real
  // subscription limits are not exposed by Anthropic, and the API-equivalent
  // cost dwarfs any small preset, which produced nonsense like "2232% of limit".
  cfg.budgets = user.budgets || { fiveHour: null, day: null, week: null };
  // if the user pinned contextLimit explicitly, never auto-bump it to 1M
  cfg.contextLimitExplicit = Object.prototype.hasOwnProperty.call(user, 'contextLimit');
  return cfg;
}

function saveConfig(partial) {
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch (e) {}
  const next = Object.assign({}, cur, partial || {});
  // when the plan changes, drop stale explicit budgets so the preset applies
  if (partial && partial.plan && !partial.budgets) delete next.budgets;
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2));
  return loadConfig();
}

module.exports = { loadConfig, saveConfig, priceFor, PRICING, PLAN_BUDGETS, configPath };
