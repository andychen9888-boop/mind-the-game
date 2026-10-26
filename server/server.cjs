#!/usr/bin/env node
'use strict';
// Mind the Game server: serves app/ and exposes the AI explain step. No dependencies.
// Keys stay in this process's environment; the browser only ever sees /api/status (no secrets).
//   PORT (default 8000), HOST (default 127.0.0.1; use 0.0.0.0 in a container)
//   MTG_AI_BASE_URL, MTG_AI_API_KEY | MTG_AI_BEARER_TOKEN, MTG_AI_MODEL  (see scripts/pipeline/explain-ai.cjs)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const appDir = path.join(root, 'app');
const { ingest } = require('../scripts/pipeline/ingest.cjs');
const { interpret } = require('../scripts/pipeline/interpret.cjs');
const { explainWithAI, aiConfig } = require('../scripts/pipeline/explain-ai.cjs');
const { renderCase } = require('../scripts/pipeline/render-case.cjs');
const { validateCase } = require('../scripts/lib/case-schema.cjs');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const SECURITY = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' };
// Synthetic inputs the AI step may regenerate. Only these files can be read through the API.
const INPUTS = {
  'synthetic-counter-01': path.join(root, 'data/synthetic/counter-01.input.json'),
  'synthetic-buildup-02': path.join(root, 'data/synthetic/buildup-02.input.json'),
  'synthetic-press-03': path.join(root, 'data/synthetic/press-03.input.json')
};
const hits = new Map(); let busy = false;

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...SECURITY });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
// Behind a reverse proxy (Azure Container Apps, App Service) set TRUST_PROXY=1 so the client
// address comes from X-Forwarded-For instead of the proxy's own address.
function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') { const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (f) return f; }
  return req.socket.remoteAddress;
}
function rateLimited(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 60000);
  hits.set(ip, list);
  return list.length >= 6;
}
function recordHit(ip) { hits.get(ip).push(Date.now()); }
async function readBody(req, limit = 2048, ms = 5000) {
  let size = 0; const chunks = [];
  const timer = setTimeout(() => req.destroy(new Error('body timeout')), ms);
  try {
    for await (const c of req) { size += c.length; if (size > limit) throw new Error('body too large'); chunks.push(c); }
  } finally { clearTimeout(timer); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/status' && req.method === 'GET') {
      const cfg = aiConfig();
      return send(res, 200, { server: true, ai: { configured: cfg.configured, model: cfg.configured ? cfg.model : null, provider: cfg.configured ? 'Microsoft Foundry / Azure OpenAI (v1 chat completions)' : null }, regenerable: Object.keys(INPUTS) });
    }
    if (url.pathname === '/api/explain' && req.method === 'POST') {
      if (!aiConfig().configured) return send(res, 503, { error: 'AI is not configured on this server; the offline template explanations remain in use.' });
      const ip = clientIp(req);
      const { caseId } = await readBody(req);
      if (!Object.hasOwn(INPUTS, caseId)) return send(res, 400, { error: 'This case has no synthetic input that the AI step can use.' });
      if (rateLimited(ip)) return send(res, 429, { error: 'Too many requests; try again in a minute.' });
      // Check and take the lock in one synchronous step (no await in between).
      if (busy) return send(res, 429, { error: 'Another explanation is being generated; try again shortly.' });
      busy = true;
      recordHit(ip);
      try {
        const input = ingest(INPUTS[caseId]);
        const interp = interpret(input);
        const explanation = await explainWithAI(input, interp);
        const c = renderCase(input, interp, explanation);
        const { errors } = validateCase(c);
        if (errors.length) return send(res, 500, { error: 'Generated case failed validation', details: errors.slice(0, 5) });
        return send(res, 200, { case: c, aiAttempt: explanation.aiAttempt });
      } finally { busy = false; }
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(appDir, '.' + rel);
    if (!file.startsWith(appDir + path.sep)) return send(res, 403, { error: 'forbidden' });
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      send(res, 200, buf, TYPES[path.extname(file)] || 'application/octet-stream');
    });
  } catch (e) {
    // Only body/JSON errors reach here; the generation lock is released by its own finally.
    if (!res.headersSent) send(res, 400, { error: e instanceof SyntaxError ? 'invalid JSON body' : e.message === 'body too large' ? 'body too large' : 'bad request' });
  }
});
server.requestTimeout = 150000; // AI generation can take a while; body upload cannot
server.headersTimeout = 10000;
const port = Number(process.env.PORT || 8000), host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => {
  const cfg = aiConfig();
  console.log(`Mind the Game on http://${host}:${port}  (AI: ${cfg.configured ? 'configured, model ' + cfg.model : 'not configured — offline templates'})`);
});
