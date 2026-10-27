#!/usr/bin/env node
'use strict';
// Offline checks for Mind the Game. No dependencies, no browser.
// Does NOT validate tactical truth or browser behaviour (see docs/WORKLOG.md for browser tests).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const results = [];
const check = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name + ' — ' + e.message.split('\n')[0]]); } };

check('player script parses', () => {
  const html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'expected one inline script');
  new vm.Script(scripts[0][1]);
  assert(html.includes('<script src="cases.js"></script>'), 'cases.js must be loaded before the player');
});
check('player has no case-specific content', () => {
  const html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
  // Every team name, team code and named player from any case file must stay out of the player.
  const names = new Set(['stage===4', 'stage<4', 'Math.min(4']);
  for (const f of fs.readdirSync(path.join(root, 'data/cases')).filter(f => f.endsWith('.json'))) {
    const k = JSON.parse(fs.readFileSync(path.join(root, 'data/cases', f), 'utf8'));
    for (const t of Object.values(k.teams)) { names.add(t.name.en.replace(/ \(.*\)/, '')); names.add(t.short + ' '); }
    for (const p of k.players) if (p.identityStatus === 'named-in-sources' || p.identityStatus === 'verified') names.add(p.name.en);
  }
  const hits = [...names].filter(s => s.trim().length > 2 && html.includes(s));
  assert.equal(hits.length, 0, 'found ' + hits.join(', '));
});
check('all cases valid and app/cases.js up to date', () => {
  execFileSync(process.execPath, [path.join(root, 'scripts/build-cases.cjs'), '--check'], { stdio: 'pipe' });
});
check('cases.js loads and exposes cases', () => {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app/cases.js'), 'utf8'), ctx);
  const cases = ctx.window.MTG_CASES;
  assert(Array.isArray(cases) && cases.length >= 4, 'expected at least four cases');
  const counts = cases.map(c => c.phases.length);
  assert(new Set(counts).size > 1, 'cases should cover different stage counts, got ' + counts.join(','));
});
check('synthetic inputs and cases are reproducible', () => {
  const { ingest } = require('./pipeline/ingest.cjs');
  const { interpret } = require('./pipeline/interpret.cjs');
  const { explainTemplate } = require('./pipeline/explain-template.cjs');
  const { renderCase } = require('./pipeline/render-case.cjs');
  const os = require('node:os');
  const gens = fs.readdirSync(path.join(root, 'scripts/synthetic')).filter(f => /^generate-.*\.cjs$/.test(f));
  assert(gens.length >= 3, 'expected at least three synthetic generators');
  for (const g of gens) {
    const name = g.replace(/^generate-|\.cjs$/g, '');
    const inputPath = path.join(root, 'data/synthetic', name + '.input.json');
    const before = fs.readFileSync(inputPath, 'utf8');
    execFileSync(process.execPath, [path.join(root, 'scripts/synthetic', g)], { stdio: 'pipe' });
    const after = fs.readFileSync(inputPath, 'utf8');
    if (before !== after) { fs.writeFileSync(inputPath, before); throw new Error(g + ' no longer reproduces ' + name + '.input.json'); }
    const input = ingest(inputPath);
    const stored = JSON.parse(fs.readFileSync(path.join(root, 'data/cases', input.caseId + '.json'), 'utf8'));
    if (stored.generation.explanations !== 'offline-template') continue; // AI output is not deterministic
    const interp = interpret(input);
    const fresh = renderCase(input, interp, explainTemplate(input, interp));
    assert.equal(JSON.stringify(JSON.parse(JSON.stringify(fresh))), JSON.stringify(stored), input.caseId + ' differs from pipeline output; rerun node scripts/pipeline/run.cjs');
  }
});
check('synthetic defenders are not parked on the goal line', () => {
  for (const f of fs.readdirSync(path.join(root, 'data/synthetic')).filter(f => f.endsWith('.input.json'))) {
    const d = JSON.parse(fs.readFileSync(path.join(root, 'data/synthetic', f), 'utf8'));
    const att = d.match.attackingTeam;
    for (const p of d.players.filter(p => p.team !== att && p.role !== 'GK')) {
      const deep = d.frames.filter(fr => fr.positions[p.id] && fr.positions[p.id][0] > 95).length;
      assert(deep <= 1, `${f}: ${p.name.en} is beyond the six-yard line in ${deep} frames`);
    }
  }
});
check('explanation guard rejects fabricated or dangling content', () => {
  const { ingest } = require('./pipeline/ingest.cjs');
  const { interpret } = require('./pipeline/interpret.cjs');
  const { explainTemplate } = require('./pipeline/explain-template.cjs');
  const { validateExplanation } = require('./pipeline/validate-explanation.cjs');
  const input = ingest(path.join(root, 'data/synthetic/counter-01.input.json'));
  const interp = interpret(input);
  const ok = explainTemplate(input, interp);
  assert.deepEqual(validateExplanation(ok, input, interp), []);
  const tamper = (fn) => { const x = JSON.parse(JSON.stringify(ok)); fn(x); return validateExplanation(x, input, interp).length > 0; };
  assert(tamper(x => { x.phases[0].simple[0].text.en += ' He ran at 32 km/h.'; }), 'speed not rejected');
  assert(tamper(x => { x.phases[0].insight.zh = '佔 40% 功勞'; }), 'percentage not rejected');
  assert(tamper(x => { x.phases[1].simple[0].refs = ['e99']; }), 'unknown event not rejected');
  assert(tamper(x => { x.phases[2].simple[0].refs = ['e01']; }), 'out-of-phase event not rejected');
  assert(tamper(x => { x.phases[0].insight.en = 'Watch #23.'; }), 'non-existent shirt not rejected');
  assert(tamper(x => { x.phases[1].deep = x.phases[1].deep.filter(r => r.kind !== 'unknown'); }), 'missing unknowns not rejected');
  assert(tamper(x => { x.phases[0].title.en = '<img src=x onerror=alert(1)>'; }), 'markup not rejected');
});
check('case validator rejects broken references', () => {
  const { validateCase } = require('./lib/case-schema.cjs');
  const c = JSON.parse(fs.readFileSync(path.join(root, 'data/cases/synthetic-counter-01.json'), 'utf8'));
  assert.deepEqual(validateCase(c).errors, []);
  const bad = JSON.parse(JSON.stringify(c));
  bad.phases[0].focus.push('ghost'); bad.snapshots.B0.n6 = [0, 0]; delete bad.snapshots.B1.n9; bad.summary.cards[0].phaseIds = ['p9'];
  bad.phases[1].simple[0].text.zh += '跑了 12 公尺';
  const { errors, warnings } = validateCase(bad);
  assert(errors.some(e => e.includes('ghost')) && errors.some(e => e.includes('B1.n9')) && errors.some(e => e.includes('p9')) && errors.some(e => e.includes('公尺')), 'missing expected errors');
  assert(warnings.some(w => w.includes('[0,0]')), '[0,0] placeholder not flagged');
});
check('validator covers review findings (2026-10-25)', () => {
  const { validateCase } = require('./lib/case-schema.cjs');
  const base = JSON.parse(fs.readFileSync(path.join(root, 'data/cases/synthetic-counter-01.json'), 'utf8'));
  const fails = (fn, why) => { const x = JSON.parse(JSON.stringify(base)); fn(x); let r; try { r = validateCase(x); } catch (e) { throw new Error(why + ': validator threw ' + e.message); } assert(r.errors.length, why + ' was accepted'); };
  fails(x => { delete x.phases[0].focus; }, 'missing focus');
  fails(x => { x.sources[0].url = 'javascript:alert(1)'; }, 'javascript: URL');
  fails(x => { x.match.goalTime = null; }, 'score change without goalTime');
  fails(x => { x.phases[0].ball[1] = null; }, 'null ball sample');
  fails(x => { x.snapshots.B0 = null; }, 'null snapshot');
  fails(x => { x.summary.cards[0].tag = '40% OF THE GOAL'; }, 'percentage in card tag');
  fails(x => { x.phases[0].simple[0].text.en += ' He covered 25m.'; }, 'bare metres');
  fails(x => { x.phases[0].simple[0].text.en += ' 40 per cent of the credit.'; }, 'per cent');
});
check('segmentation ignores opponent events before the regain', () => {
  const { interpret } = require('./pipeline/interpret.cjs');
  const { ingest } = require('./pipeline/ingest.cjs');
  const input = ingest(path.join(root, 'data/synthetic/counter-01.input.json'));
  input.events.unshift({ id: 'e00', type: 'pass', t: 3787, dur: 0.5, actor: 'h4', recipient: 'h6', start: [60, 40], end: [70, 50] });
  const phases = interpret(input).phases;
  assert(phases[0].start >= 3789.5 && phases[0].rule.rule === 'possession-start', 'first stage starts at ' + phases[0].start + ' via ' + phases[0].rule.rule);
  assert(!phases.some(p => p.ballEvents.some(e => e.id === 'e00')), 'opponent pass ended up in a stage');
});
check('AI agent loop (mocked endpoint)', () => {
  execFileSync(process.execPath, [path.join(root, 'scripts/test-ai-loop.cjs')], { stdio: 'pipe' });
});
check('no secrets or private media in app/', () => {
  const files = fs.readdirSync(path.join(root, 'app'), { recursive: true }).filter(f => fs.statSync(path.join(root, 'app', f)).isFile());
  for (const f of files) {
    assert(!/\.(mov|mp4|mkv|env)$/i.test(f), 'unexpected file in app/: ' + f);
    const t = fs.readFileSync(path.join(root, 'app', f), 'utf8');
    assert(!/(api[-_]?key|AZURE_OPENAI_API_KEY)\s*[:=]\s*["'][^"']{8,}/i.test(t) && !/\bsk-[A-Za-z0-9]{20,}/.test(t), 'possible secret in app/' + f);
  }
});
for (const [s, n] of results) console.log(`${s}  ${n}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} checks passed. This does not validate tactical truth or browser behaviour.`);
process.exit(failed ? 1 : 0);
