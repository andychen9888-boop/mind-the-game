#!/usr/bin/env node
'use strict';
// Mind the Game pipeline: ingest → interpret → explain → render (→ personalize in the player).
// Usage: node scripts/pipeline/run.cjs data/synthetic/counter-01.input.json [--explainer template|ai] [--dry-run]
const fs = require('node:fs');
const path = require('node:path');
const { ingest } = require('./ingest.cjs');
const { interpret } = require('./interpret.cjs');
const { explainTemplate } = require('./explain-template.cjs');
const { renderCase } = require('./render-case.cjs');
const { validateCase } = require('../lib/case-schema.cjs');
const root = path.resolve(__dirname, '../..');

async function main() {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--')) || 'data/synthetic/counter-01.input.json';
  const explainer = (args[args.indexOf('--explainer') + 1] && args.includes('--explainer')) ? args[args.indexOf('--explainer') + 1] : 'template';
  const input = ingest(path.resolve(root, file));
  console.log(`ingest     ${input.players.length} players, ${input.events.length} events, ${input.frames.length} frames`);
  const interp = interpret(input);
  console.log(`interpret  ${interp.phases.length} stages: ` + interp.phases.map(p => `${p.id}[${p.rule.rule}]`).join(' '));
  let explanation;
  if (explainer === 'ai') {
    const { explainWithAI } = require('./explain-ai.cjs');
    explanation = await explainWithAI(input, interp);
  } else explanation = explainTemplate(input, interp);
  console.log(`explain    mode=${explanation.mode}${explanation.model ? ' model=' + explanation.model : ''}`);
  const c = renderCase(input, interp, explanation);
  const { errors, warnings } = validateCase(c);
  warnings.forEach(w => console.warn('WARN ' + w));
  if (errors.length) { errors.forEach(e => console.error('FAIL ' + e)); process.exit(1); }
  const out = path.join(root, 'data/cases', c.caseId + '.json');
  if (args.includes('--dry-run')) { console.log('render     (dry run) valid case, not written'); return c; }
  fs.writeFileSync(out, JSON.stringify(c, null, 1) + '\n');
  console.log(`render     wrote ${path.relative(root, out)} (${c.phases.length} stages); run node scripts/build-cases.cjs to publish to app/cases.js`);
  return c;
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { main };
