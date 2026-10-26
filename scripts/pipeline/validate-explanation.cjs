'use strict';
// Guards for explainer output (AI or template) BEFORE it reaches the player.
// Rejects: wrong structure, references to events outside the phase, players that do not exist,
// fabricated precision (%, xG, metres, speeds), and missing unknowns when positions are missing.
const { FABRICATION_PATTERNS } = require('../lib/case-schema.cjs');
const ROW_KINDS = ['observation', 'interpretation', 'outcome', 'limit', 'unknown', 'watch', 'recap'];

function validateExplanation(explanation, input, interp, { coverage = false } = {}) {
  const errors = [];
  const isBi = v => v && typeof v.zh === 'string' && v.zh.trim() && typeof v.en === 'string' && v.en.trim();
  const texts = [];
  const bi = (v, p) => { if (!isBi(v)) errors.push(`${p}: expected {zh, en}`); else texts.push([p, v.zh], [p, v.en]); };
  const shirts = new Set(input.players.map(p => p.short));
  const eventIds = new Set(input.events.map(e => e.id));
  if (!explanation || !Array.isArray(explanation.phases)) return ['explanation.phases missing'];
  if (explanation.phases.length !== interp.phases.length) errors.push(`expected ${interp.phases.length} phases, got ${explanation.phases.length}`);
  interp.phases.forEach((ph, i) => {
    const ex = explanation.phases[i];
    const p = `phases[${i}]`;
    if (!ex) return;
    if (ex.id !== ph.id) errors.push(`${p}.id: expected ${ph.id}`);
    for (const k of ['title', 'short', 'sub', 'insight', 'evidence']) bi(ex[k], `${p}.${k}`);
    const allowed = new Set([...ph.ballEvents, ...ph.runs].map(e => e.id));
    for (const level of ['simple', 'deep']) {
      const rows = ex[level];
      if (!Array.isArray(rows) || rows.length < 2 || rows.length > 4) { errors.push(`${p}.${level}: 2-4 rows required`); continue; }
      rows.forEach((r, j) => {
        const rp = `${p}.${level}[${j}]`;
        if (!ROW_KINDS.includes(r.kind)) errors.push(`${rp}.kind invalid`);
        bi(r.label, rp + '.label'); bi(r.text, rp + '.text');
        (r.refs || []).forEach(id => {
          if (!eventIds.has(id)) errors.push(`${rp}.refs: unknown event ${id}`);
          else if (!allowed.has(id)) errors.push(`${rp}.refs: event ${id} is not part of ${ph.id}`);
        });
      });
      if (!rows.some(r => r.kind === 'observation')) errors.push(`${p}.${level}: needs an observation row`);
    }
    const hidden = ph.unobserved.attackers.length + ph.unobserved.defenders.length;
    if (hidden && Array.isArray(ex.deep) && !ex.deep.some(r => r.kind === 'unknown')) errors.push(`${p}.deep: ${hidden} players are unobserved; an "unknown" row is required`);
  });
  if (coverage) {
    // Every observed forward off-ball runner must be named in that stage, and every attacking
    // participant must have a summary card: the product exists to show these contributions.
    const att = input.match.attackingTeam;
    const short = id => input.players.find(p => p.id === id).short;
    const mentions = (txt, id) => new RegExp('(^|[^0-9])' + short(id) + '\\s*號|#' + short(id) + '(?![0-9])').test(txt);
    interp.phases.forEach((ph, i) => {
      const ex = explanation.phases[i]; if (!ex) return;
      const all = [...(ex.simple || []), ...(ex.deep || [])].map(r => (r.text || {}).zh + ' ' + (r.text || {}).en).join(' ') + ' ' + ((ex.insight || {}).zh || '') + ' ' + ((ex.insight || {}).en || '');
      ph.runners.filter(r => r.observed && r.forward).forEach(r => { if (!mentions(all, r.id)) errors.push(`phases[${i}]: off-ball runner ${short(r.id)} is not mentioned`); });
    });
    const carded = new Set(((explanation.summary || {}).cards || []).flatMap(c => c.playerIds || []));
    const participants = new Set(interp.phases.flatMap(p => [...p.ballEvents.flatMap(e => [e.actor, e.recipient]), ...p.runners.filter(r => r.observed && r.forward).map(r => r.id)]).filter(id => id && input.players.find(p => p.id === id).team === att));
    participants.forEach(id => { if (!carded.has(id)) errors.push(`summary: attacking participant ${short(id)} has no card`); });
  }
  const s = explanation.summary || {};
  bi(s.title, 'summary.title'); bi(s.intro, 'summary.intro');
  if (!Array.isArray(s.cards) || !s.cards.length) errors.push('summary.cards: required');
  (s.cards || []).forEach((c, i) => {
    if (typeof c.tag !== 'string') errors.push(`summary.cards[${i}].tag: string required`); else texts.push([`summary.cards[${i}].tag`, c.tag]);
    bi(c.title, `summary.cards[${i}].title`); bi(c.text, `summary.cards[${i}].text`);
    (c.playerIds || []).forEach(id => { if (!input.players.some(p => p.id === id)) errors.push(`summary.cards[${i}]: unknown player ${id}`); });
    (c.phaseIds || []).forEach(id => { if (!interp.phases.some(p => p.id === id)) errors.push(`summary.cards[${i}]: unknown phase ${id}`); });
  });
  for (const [p, t] of texts) {
    for (const [re, what] of FABRICATION_PATTERNS) if (re.test(t)) errors.push(`${p}: ${what} "${t.match(re)[0]}" is not supported by the data`);
    // Shirt numbers mentioned must exist in this case ("12 號", "#12").
    for (const m of t.matchAll(/(?:#|＃)(\d{1,2})\b|(\d{1,2})\s*號/g)) { const n = m[1] || m[2]; if (!shirts.has(n)) errors.push(`${p}: mentions shirt ${n}, which no player in this case wears`); }
    if (/<[a-z/!]/i.test(t)) errors.push(`${p}: markup is not allowed in explanation text`);
  }
  return errors;
}
module.exports = { validateExplanation };
