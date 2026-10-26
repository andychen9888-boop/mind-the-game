'use strict';
// Stage 1 — INGEST: load a synthetic input file (mtg-synthetic-input-1) and reject malformed data.
const fs = require('node:fs');
const EVENT_TYPES = ['regain', 'pass', 'carry', 'cross', 'through-ball', 'layoff', 'run', 'shot', 'goal', 'tackle', 'clearance', 'save', 'press'];

function ingest(file) {
  const input = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = [];
  if (input.inputVersion !== 'mtg-synthetic-input-1') errors.push('inputVersion must be mtg-synthetic-input-1');
  if (input.dataKind !== 'synthetic') errors.push('this pipeline only accepts dataKind "synthetic"');
  const ids = new Set(input.players.map(p => p.id));
  if (ids.size !== input.players.length) errors.push('duplicate player ids');
  for (const p of input.players) if (!input.teams[p.team]) errors.push(`player ${p.id}: unknown team ${p.team}`);
  const xyOk = v => Array.isArray(v) && v.length === 2 && v.every(n => Number.isFinite(n) && n >= 0 && n <= 100);
  input.events.forEach((e, i) => {
    if (!EVENT_TYPES.includes(e.type)) errors.push(`event ${e.id}: unknown type ${e.type}`);
    if (!ids.has(e.actor)) errors.push(`event ${e.id}: unknown actor ${e.actor}`);
    if (e.recipient != null && !ids.has(e.recipient)) errors.push(`event ${e.id}: unknown recipient ${e.recipient}`);
    if (!xyOk(e.start) || !xyOk(e.end)) errors.push(`event ${e.id}: start/end must be [x,y] in 0..100`);
    if (!(e.dur > 0)) errors.push(`event ${e.id}: dur must be > 0`);
    if (i && e.t < input.events[i - 1].t) errors.push(`event ${e.id}: events must be time-ordered`);
  });
  const ballTypes = input.events.filter(e => e.type !== 'run');
  if (!ballTypes.length) errors.push('at least one ball event (not only runs) is required');
  if (!input.events.some(e => e.type === 'shot' || e.type === 'goal')) errors.push('the sequence must end in a shot or goal');
  if (!Array.isArray(input.frames) || input.frames.length < 2) errors.push('at least two frames are required');
  (input.frames || []).forEach((f, i) => {
    if (i && !(f.t > input.frames[i - 1].t)) errors.push(`frame ${i}: times must increase`);
    for (const id of ids) {
      if (!(id in f.positions)) errors.push(`frame ${f.t}: missing ${id} (use null for not observed)`);
      else if (f.positions[id] !== null && !xyOk(f.positions[id])) errors.push(`frame ${f.t}: bad position for ${id}`);
    }
  });
  if (errors.length) { const e = new Error('ingest failed:\n  ' + errors.join('\n  ')); e.details = errors; throw e; }
  input.sourceFile = require('node:path').relative(require('node:path').resolve(__dirname, '../..'), file);
  return input;
}
module.exports = { ingest };
