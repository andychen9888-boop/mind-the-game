'use strict';
// Stage 3 — EXPLAIN with a model deployed in Microsoft Foundry (Azure OpenAI, OpenAI-compatible v1 API).
// Small agent loop: explainer → deterministic guard → reviewer → (one revision) → guard.
// If anything fails, the caller gets the offline template output and an explicit rejection record;
// the case is then labelled "offline-template", never "AI".
// Configuration (server-side environment only; never ship keys to the browser):
//   MTG_AI_BASE_URL   e.g. https://<resource>.openai.azure.com/openai/v1
//   MTG_AI_API_KEY    key for that resource (or use MTG_AI_BEARER_TOKEN for Entra ID tokens)
//   MTG_AI_MODEL      deployment name
const { explainTemplate, makeNames } = require('./explain-template.cjs');
const { validateExplanation } = require('./validate-explanation.cjs');

function aiConfig(env = process.env) {
  const base = (env.MTG_AI_BASE_URL || (env.AZURE_OPENAI_ENDPOINT ? env.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, '') + '/openai/v1' : '')).replace(/\/+$/, '');
  const key = env.MTG_AI_API_KEY || env.AZURE_OPENAI_API_KEY || '';
  const token = env.MTG_AI_BEARER_TOKEN || '';
  const model = env.MTG_AI_MODEL || env.AZURE_OPENAI_DEPLOYMENT || '';
  const temperature = env.MTG_AI_TEMPERATURE === undefined || env.MTG_AI_TEMPERATURE === '' ? undefined : Number(env.MTG_AI_TEMPERATURE);
  return { configured: Boolean(base && model && (key || token)), base, key, token, model, temperature };
}

const BI = { type: 'object', additionalProperties: false, required: ['zh', 'en'], properties: { zh: { type: 'string' }, en: { type: 'string' } } };
const ROW = { type: 'object', additionalProperties: false, required: ['kind', 'label', 'text', 'refs'], properties: { kind: { type: 'string', enum: ['observation', 'interpretation', 'outcome', 'limit', 'unknown', 'watch', 'recap'] }, label: BI, text: BI, refs: { type: 'array', items: { type: 'string' } } } };
const EXPLANATION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['phases', 'summary'],
  properties: {
    phases: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'title', 'short', 'sub', 'simple', 'deep', 'insight', 'evidence'], properties: { id: { type: 'string' }, title: BI, short: BI, sub: BI, simple: { type: 'array', items: ROW }, deep: { type: 'array', items: ROW }, insight: BI, evidence: BI } } },
    summary: { type: 'object', additionalProperties: false, required: ['title', 'intro', 'cards'], properties: { title: BI, intro: BI, cards: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['tag', 'title', 'text', 'playerIds', 'phaseIds'], properties: { tag: { type: 'string' }, title: BI, text: BI, playerIds: { type: 'array', items: { type: 'string' } }, phaseIds: { type: 'array', items: { type: 'string' } } } } } } }
  }
};
// The model only rewrites text. Structure (ids, row kinds, refs, cards, playerIds) is copied from the
// deterministic draft, so the model cannot drop a contribution or invent a reference.
const ROWTXT = { type: 'object', additionalProperties: false, required: ['text'], properties: { text: BI } };
const REWRITE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['phases', 'summary'],
  properties: {
    phases: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'title', 'short', 'sub', 'simple', 'insight'], properties: { id: { type: 'string' }, title: BI, short: BI, sub: BI, simple: { type: 'array', items: ROWTXT }, insight: BI } } },
    summary: { type: 'object', additionalProperties: false, required: ['title', 'intro', 'cards'], properties: { title: BI, intro: BI, cards: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: BI } } } } }
  }
};
function draftForModel(t) {
  return {
    phases: t.phases.map(p => ({ id: p.id, title: p.title, short: p.short, sub: p.sub, insight: p.insight,
      simple: p.simple.map(r => ({ kind: r.kind, label: r.label.en, text: r.text })), tacticalNotesForContext: p.deep.map(r => r.text.en) })),
    summary: { title: t.summary.title, intro: t.summary.intro, cards: t.summary.cards.map(c => ({ player: c.title, text: c.text })) }
  };
}
// Merge rewritten text into the draft structure; returns null when the shape does not match.
function merge(t, r) {
  if (!r || !Array.isArray(r.phases) || r.phases.length !== t.phases.length) return null;
  const out = JSON.parse(JSON.stringify({ phases: t.phases, summary: t.summary }));
  for (const [i, p] of out.phases.entries()) {
    const q = r.phases[i];
    if (!q || q.id !== p.id || q.simple.length !== p.simple.length) return null;
    for (const k of ['title', 'short', 'sub', 'insight']) p[k] = q[k];
    p.simple.forEach((row, j) => { row.text = q.simple[j].text; });
    // deep (tactical) rows stay exactly as the deterministic draft wrote them
  }
  if (!r.summary || r.summary.cards.length !== out.summary.cards.length) return null;
  out.summary.title = r.summary.title; out.summary.intro = r.summary.intro;
  out.summary.cards.forEach((c, j) => { c.text = r.summary.cards[j].text; });
  return out;
}
const REVIEW_SCHEMA = { type: 'object', additionalProperties: false, required: ['issues'], properties: { issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['phaseId', 'quote', 'reason'], properties: { phaseId: { type: 'string' }, quote: { type: 'string' }, reason: { type: 'string' } } } } } };

const SYSTEM_EXPLAINER = `You write the BEGINNER layer of Mind the Game, a replay that helps people see every contribution behind a goal, not only the scorer.
The tactical layer is already written by code and stays unchanged (you see it as tacticalNotesForContext). Your job: rewrite the stage titles, short labels, sub-captions, the three "simple" rows of each stage, the insight line, and the summary title, intro and card texts, for someone who has never watched football. Write natural Taiwanese Traditional Chinese (zh) and natural English (en).
Make it genuinely better than the draft: explain every football term in everyday words the first time it appears (e.g. a cutback = passing the ball back across from near the goal line; a through ball = a pass into the space behind defenders for a teammate to run onto); use concrete, friendly sentences; titles like a short match caption. Keep each simple row's role: 1) what happened, 2) what it offers, 3) what changes. Keep every player and contribution of the draft row you replace, especially players who run without the ball.
Hard rules: use ONLY information in FACTS and the draft; keep every number exactly; no speeds, distances, percentages, xG, ball height, shot placement, body orientation, intent ("wanted to", "想要", "意圖"), communication, or claims about what is generally effective; a defender moving with a runner is co-movement only, never cause. Refer to players exactly by displayName. Return the same number of phases, rows and cards in the same order. Plain text, no markup, a space between Chinese and numbers (例如「傳給 10 號」).`;
const SYSTEM_REVIEWER = `You are a strict fact-checker for football explanations. Compare EXPLANATION with FACTS and list every problem:
1. any statement not supported by FACTS: invented numbers, shot placement, ball height, orientation, speed, distance;
2. intent, motivation, communication, organisation or "purpose" attributed to players or teams;
3. generic claims of effectiveness ("is an effective way to", "提高效率") or causation: a run "created", "drew", "freed" or "made" something, a goal "came from" / "來自" / "創造" a run;
4. "unknown"/"limit" rows that claim something is unknown although FACTS contains it;
5. simple-view text that uses football jargon without explaining it.
(Omissions are checked by code; do not report them.)
Do NOT flag: hedged interpretation that follows directly from FACTS; statements about the limits of the data; the disclaimer that the data is synthetic (FACTS.dataKind says so); not mentioning something; whether every player is mentioned is checked by code. Quote the exact problematic text. Return an empty list only if there are no problems.`;

function facts(input, interp) {
  const N = makeNames(input);
  const name = id => ({ zh: N.n(id, 'zh'), en: N.n(id, 'en') });
  return {
    dataKind: 'synthetic (fictional teams and players)',
    attackingTeam: input.teams[input.match.attackingTeam].name, defendingTeam: input.teams[input.match.attackingTeam === input.match.home ? input.match.away : input.match.home].name,
    scoreBefore: input.match.scoreBefore, scoreAfter: input.match.scoreAfter,
    players: input.players.map(p => ({ id: p.id, displayName: name(p.id), role: p.role, team: p.team })),
    stages: interp.phases.map((ph, i) => ({
      id: ph.id, index: i + 1, segmentationRule: ph.rule.en, kind: ph.kind,
      events: [...ph.ballEvents, ...ph.runs].map(e => ({ id: e.id, type: e.type, detail: e.detail || null, actor: e.actor, recipient: e.recipient || null })),
      ballZoneStart: ph.zoneStart, ballZoneEnd: ph.zoneEnd,
      visibleDefendersAheadOfBall: { start: ph.defendersAheadStart, end: ph.defendersAheadEnd },
      visibleDefendersMovingTowardOwnGoal: ph.retreatingDefenders.length,
      visibleDefendersBypassedByForwardPass: ph.bypassed.map(b => ({ eventId: b.eventId, count: b.defenders.length })),
      offBallRunners: ph.runners.map(r => ({ id: r.id, observed: r.observed, movedForward: !!r.forward, nearbyDefendersMovingSameWay: r.coMoving || [], touchesBallLater: !!r.laterTouchEventId })),
      runsStartedInEarlierStage: ph.arrivals,
      unobservedPlayers: [...ph.unobserved.attackers, ...ph.unobserved.defenders]
    }))
  };
}

// Rate limits (HTTP 429) and transient 5xx errors are retried with the server's Retry-After hint,
// at most 3 retries and 20 s per wait, so a 50K-tokens-per-minute deployment can finish a full run.
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function chat(cfg, messages, schemaName, schema, fetchImpl = fetch, { maxRetries = 3, maxWaitMs = 20000, sleepImpl = sleep } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cfg.key) headers['api-key'] = cfg.key; else headers.authorization = 'Bearer ' + cfg.token;
  let res, body;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetchImpl(cfg.base + '/chat/completions', {
        method: 'POST', headers,
        body: JSON.stringify({ model: cfg.model, messages, ...(Number.isFinite(cfg.temperature) ? { temperature: cfg.temperature } : {}), response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } } }),
        signal: AbortSignal.timeout(120000)
      });
      body = await res.text();
    } catch (netErr) {
      // Connection reset / DNS / timeout: retry like a 5xx, then give up with a safe message.
      const detail = (netErr.cause && (netErr.cause.code || netErr.cause.message)) || netErr.name;
      if (attempt >= maxRetries) { console.error('[mtg-ai] network error: ' + detail); const e = new Error('model call failed (network: ' + detail + ')'); e.safe = true; throw e; }
      console.error(`[mtg-ai] network error (${detail}); retrying (attempt ${attempt + 1} of ${maxRetries})`);
      await sleepImpl(Math.min(maxWaitMs, 2000 * 2 ** attempt));
      continue;
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= maxRetries) break;
    const h = n => (res.headers && typeof res.headers.get === 'function' ? res.headers.get(n) : null);
    const hinted = Number(h('retry-after-ms')) || Number(h('retry-after')) * 1000 || 0;
    const wait = Math.min(maxWaitMs, hinted || 2000 * 2 ** attempt);
    console.error(`[mtg-ai] HTTP ${res.status}; retrying in ${Math.round(wait / 1000)} s (attempt ${attempt + 1} of ${maxRetries})`);
    await sleepImpl(wait);
  }
  if (!res.ok) {
    // Full provider error stays in the server log; callers only get the status code.
    console.error(`[mtg-ai] model call failed: HTTP ${res.status} ${body.slice(0, 500)}`);
    const e = new Error(`model call failed (HTTP ${res.status})`); e.safe = true; throw e;
  }
  const json = JSON.parse(body);
  const msg = json.choices && json.choices[0] && json.choices[0].message;
  if (!msg || msg.refusal) throw new Error('model refused or returned no message');
  return { data: JSON.parse(msg.content), model: json.model || cfg.model, usage: json.usage || null };
}

async function explainWithAI(input, interp, { env = process.env, fetchImpl = fetch, log = () => {}, debug = false } = {}) {
  const cfg = aiConfig(env);
  const template = explainTemplate(input, interp);
  if (!cfg.configured) return { ...template, aiAttempt: { status: 'not-configured' } };
  const F = facts(input, interp);
  const trace = [];
  try {
    const user = 'FACTS JSON:\n' + JSON.stringify(F) + '\n\nDRAFT JSON (deterministic templates):\n' + JSON.stringify(draftForModel(template));
    const rewrite = async (messages) => { const r = await chat(cfg, messages, 'mtg_rewrite', REWRITE_SCHEMA, fetchImpl); const m = merge(template, r.data); return { ...r, raw: r.data, data: m || { phases: [], summary: {} }, shapeOk: !!m }; };
    let draft = await rewrite([{ role: 'system', content: SYSTEM_EXPLAINER }, { role: 'user', content: user }]);
    trace.push('explainer');
    let guard = draft.shapeOk ? validateExplanation(draft.data, input, interp, { coverage: true }) : ['rewrite did not keep the draft structure (phase/row/card counts)'];
    const review = await chat(cfg, [{ role: 'system', content: SYSTEM_REVIEWER }, { role: 'user', content: 'FACTS JSON:\n' + JSON.stringify(F) + '\n\nEXPLANATION JSON:\n' + JSON.stringify(draft.data) }], 'mtg_review', REVIEW_SCHEMA, fetchImpl);
    trace.push('reviewer');
    const issues = review.data.issues || [];
    log(`guard errors: ${guard.length}, reviewer issues: ${issues.length}`);
    if (guard.length || issues.length) {
      const feedback = [...guard.map(g => 'VALIDATOR: ' + g), ...issues.map(i => `REVIEWER (${i.phaseId}): "${i.quote}" — ${i.reason}`)].join('\n');
      draft = await rewrite([{ role: 'system', content: SYSTEM_EXPLAINER }, { role: 'user', content: user }, { role: 'assistant', content: JSON.stringify(draft.raw) }, { role: 'user', content: 'Fix every problem below. Remove unsupported claims rather than rephrasing them. Keep the same structure.\n' + feedback }]);
      trace.push('revision');
      guard = draft.shapeOk ? validateExplanation(draft.data, input, interp, { coverage: true }) : ['rewrite did not keep the draft structure (phase/row/card counts)'];
      if (!guard.length) {
        // The revision must pass the reviewer again; otherwise it is rejected.
        const second = await chat(cfg, [{ role: 'system', content: SYSTEM_REVIEWER }, { role: 'user', content: 'FACTS JSON:\n' + JSON.stringify(F) + '\n\nEXPLANATION JSON:\n' + JSON.stringify(draft.data) }], 'mtg_review', REVIEW_SCHEMA, fetchImpl);
        trace.push('reviewer');
        const left = second.data.issues || [];
        if (left.length) return { ...template, aiAttempt: { status: 'rejected', model: draft.model, steps: trace, reasons: left.slice(0, 10).map(i => `reviewer (${i.phaseId}): "${i.quote}" — ${i.reason}`) }, ...(debug ? { debugDraft: draft.data } : {}) };
      }
    }
    if (guard.length) return { ...template, aiAttempt: { status: 'rejected', model: draft.model, steps: trace, reasons: guard.slice(0, 10) }, ...(debug ? { debugDraft: draft.data } : {}) };
    return { mode: 'ai-rewritten', model: draft.model, phases: draft.data.phases, summary: draft.data.summary, aiAttempt: { status: 'accepted', model: draft.model, steps: trace, reviewerIssuesBeforeRevision: issues.length } };
  } catch (e) {
    if (!e.safe) console.error('[mtg-ai] ' + e.message);
    return { ...template, aiAttempt: { status: 'error', steps: trace, reasons: [e.safe ? e.message : 'model call failed (see server log)'] } };
  }
}
module.exports = { explainWithAI, aiConfig, facts, chat, EXPLANATION_SCHEMA };
