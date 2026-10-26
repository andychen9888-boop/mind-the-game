'use strict';
// Validator for Mind the Game case files (schema mtg-case-1). No dependencies.
// Returns {errors, warnings}; errors must be fixed before a case is built into app/cases.js.

const DATA_KINDS = ['manual-reconstruction', 'synthetic', 'licensed-tracking'];
const GEN_EXPLANATIONS = ['manual', 'offline-template', 'ai-rewritten', 'ai-generated', 'ai-generated-reviewed'];
const GEN_SEGMENTATION = ['manual', 'event-rules'];
const GEN_POSITIONS = ['illustrative', 'synthetic', 'video-estimated', 'measured'];
const IDENTITY = ['verified', 'named-in-sources', 'role-label', 'unknown', 'fictional'];
const ROW_KINDS = ['observation', 'interpretation', 'outcome', 'limit', 'unknown', 'watch', 'recap'];
const EVENT_TYPES = ['regain', 'pass', 'carry', 'cross', 'through-ball', 'layoff', 'run', 'shot', 'goal', 'tackle', 'clearance', 'save', 'press'];
const REF_TYPES = ['video-clock', 'event', 'synthetic-input'];
// Patterns that look like measured or invented precision. Case text must not contain them
// unless the data actually measures them (dataKind licensed-tracking).
const FABRICATION_PATTERNS = [
  [/\d+(?:\.\d+)?\s*(?:%|％|per\s?cent)/i, 'percentage'],
  [/百分之|成功勞|\d+\s*成(?:的)?(?:功勞|貢獻)/, 'percentage'],
  [/\bxG\b\s*[:=]?\s*\d|\d(?:\.\d+)?\s*xG\b/i, 'xG value'],
  [/\d+(?:\.\d+)?\s*(?:km\/h|m\/s|mph|km|公里|公尺|米|meters?|metres?|yards?|yds?|碼|m)(?![a-z])/i, 'measured distance/speed'],
];

function validateCase(c) {
  const errors = [], warnings = [];
  const err = (p, m) => errors.push(`${p}: ${m}`);
  const warn = (p, m) => warnings.push(`${p}: ${m}`);
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const str = v => typeof v === 'string' && v.trim().length > 0;
  const texts = [];
  const bi = (v, p, optional = false) => {
    if (v == null && optional) return;
    if (!isObj(v) || !str(v.zh) || !str(v.en)) return err(p, 'expected {zh, en} non-empty strings');
    texts.push([p, v.zh], [p, v.en]);
  };
  const inRange = v => Number.isFinite(v) && v >= 0 && v <= 100;
  const xy = (v, p) => { if (!(Array.isArray(v) && v.length === 2 && v.every(inRange))) err(p, 'expected [x, y] in 0..100 or null'); };

  if (!isObj(c)) return { errors: ['case: not an object'], warnings };
  if (c.schemaVersion !== 'mtg-case-1') err('schemaVersion', 'must be mtg-case-1');
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(c.caseId || '')) err('caseId', 'lowercase slug required');
  if (!DATA_KINDS.includes(c.dataKind)) err('dataKind', 'one of ' + DATA_KINDS.join(', '));
  const g = c.generation || {};
  if (!GEN_EXPLANATIONS.includes(g.explanations)) err('generation.explanations', 'one of ' + GEN_EXPLANATIONS.join(', '));
  if (!GEN_SEGMENTATION.includes(g.segmentation)) err('generation.segmentation', 'one of ' + GEN_SEGMENTATION.join(', '));
  if (!GEN_POSITIONS.includes(g.positions)) err('generation.positions', 'one of ' + GEN_POSITIONS.join(', '));
  if (c.dataKind === 'synthetic' && g.positions !== 'synthetic') err('generation.positions', 'synthetic cases must use synthetic positions');
  if (c.dataKind === 'manual-reconstruction' && g.positions === 'measured') err('generation.positions', 'manual reconstruction cannot claim measured positions');
  if (g.explanations && g.explanations.startsWith('ai-') && !str(g.model)) err('generation.model', 'AI-generated explanations must name the model/deployment that produced them');
  bi(c.menuLabel, 'menuLabel');
  if (c.attackingDirection !== 'ltr') err('attackingDirection', 'renderer currently supports ltr only');
  if (!isObj(c.coordinates) || c.coordinates.measured !== false && c.dataKind !== 'licensed-tracking') err('coordinates.measured', 'must be false unless licensed tracking');

  // Teams and players
  const teams = isObj(c.teams) ? c.teams : (err('teams', 'missing'), {});
  for (const [id, t] of Object.entries(teams)) {
    bi(t.name, `teams.${id}.name`);
    if (!str(t.short)) err(`teams.${id}.short`, 'required');
    if (!isObj(t.kit) || !['body', 'ring', 'shirt', 'badge'].every(k => /^#[0-9a-f]{6}$/i.test(t.kit[k] || ''))) err(`teams.${id}.kit`, 'body/ring/shirt/badge hex colours required');
  }
  const m = c.match || (err('match', 'missing'), {});
  for (const k of ['home', 'away', 'attackingTeam']) if (!teams[m[k]]) err(`match.${k}`, 'unknown team');
  bi(m.headline, 'match.headline'); bi(m.subline, 'match.subline');
  for (const k of ['scoreBefore', 'scoreAfter']) if (!(Array.isArray(m[k]) && m[k].length === 2 && m[k].every(Number.isInteger))) err(`match.${k}`, '[home, away] integers');

  const players = Array.isArray(c.players) ? c.players : (err('players', 'missing'), []);
  const ids = new Set();
  players.forEach((p, i) => {
    const path = `players[${i}]`;
    if (!/^[a-z0-9_-]+$/i.test(p.id || '')) err(path + '.id', 'invalid');
    if (ids.has(p.id)) err(path + '.id', 'duplicate ' + p.id);
    ids.add(p.id);
    bi(p.name, path + '.name');
    bi(p.tag, path + '.tag', true);
    if (!teams[p.team]) err(path + '.team', 'unknown team ' + p.team);
    if (!IDENTITY.includes(p.identityStatus)) err(path + '.identityStatus', 'one of ' + IDENTITY.join(', '));
    if (c.dataKind === 'synthetic' && p.identityStatus !== 'fictional') err(path + '.identityStatus', 'synthetic cases must use fictional players');
    if (typeof p.short !== 'string' || p.short.length > 3) err(path + '.short', 'string of at most 3 chars');
  });
  for (const k of ['scorer', 'assist']) if (m[k] != null && !ids.has(m[k])) err(`match.${k}`, 'unknown player ' + m[k]);

  // Snapshots: every player listed; position or null (= not observed). Never a fake [0,0].
  const snaps = isObj(c.snapshots) ? c.snapshots : (err('snapshots', 'missing'), {});
  for (const [name, s] of Object.entries(snaps)) {
    if (!isObj(s)) { err(`snapshots.${name}`, 'must be an object of player positions'); continue; }
    for (const id of ids) {
      if (!(id in s)) { err(`snapshots.${name}.${id}`, 'missing (use null when not observed)'); continue; }
      if (s[id] !== null) { xy(s[id], `snapshots.${name}.${id}`); if (s[id][0] === 0 && s[id][1] === 0) warn(`snapshots.${name}.${id}`, '[0,0] looks like a missing-value placeholder; use null'); }
    }
    for (const id of Object.keys(s)) if (!ids.has(id)) err(`snapshots.${name}.${id}`, 'unknown player');
  }

  // Optional per-snapshot provenance (observed / manual / interpolated / not-observed)
  if (c.snapshotProvenance != null) for (const [name, s] of Object.entries(c.snapshotProvenance)) {
    if (!snaps[name]) { err(`snapshotProvenance.${name}`, 'unknown snapshot'); continue; }
    for (const [id, p] of Object.entries(s)) {
      if (!['observed', 'manual', 'interpolated', 'not-observed', 'illustrative', 'synthetic'].includes(p)) err(`snapshotProvenance.${name}.${id}`, 'invalid value ' + p);
      if ((p === 'not-observed') !== (snaps[name][id] === null)) err(`snapshotProvenance.${name}.${id}`, 'must be not-observed exactly when the position is null');
    }
  }

  // Events
  const events = Array.isArray(c.events) ? c.events : (err('events', 'must be an array (may be empty)'), []);
  const eventIds = new Set();
  events.forEach((e, i) => {
    const path = `events[${i}]`;
    if (!str(e.id) || eventIds.has(e.id)) err(path + '.id', 'missing or duplicate');
    eventIds.add(e.id);
    if (!Number.isFinite(e.t)) err(path + '.t', 'match-clock seconds required');
    if (!EVENT_TYPES.includes(e.type)) err(path + '.type', 'one of ' + EVENT_TYPES.join(', '));
    for (const k of ['actor', 'recipient']) if (e[k] != null && !ids.has(e[k])) err(`${path}.${k}`, 'unknown player ' + e[k]);
    for (const k of ['start', 'end']) if (e[k] != null) xy(e[k], `${path}.${k}`);
  });
  for (let i = 1; i < events.length; i++) if (events[i].t < events[i - 1].t) err(`events[${i}].t`, 'events must be in time order');

  // Phases
  const phases = Array.isArray(c.phases) ? c.phases : [];
  if (!phases.length) err('phases', 'at least one phase required');
  const phaseIds = new Set();
  const checkRefs = (refs, path) => (refs || []).forEach((r, j) => { if (!eventIds.has(r)) err(`${path}[${j}]`, 'unknown event ' + r); });
  phases.forEach((ph, i) => {
    const path = `phases[${i}]`;
    if (!str(ph.id) || phaseIds.has(ph.id)) err(path + '.id', 'missing or duplicate');
    phaseIds.add(ph.id);
    if (!(Number.isFinite(ph.start) && Number.isFinite(ph.end) && ph.end > ph.start)) err(path, 'start < end required');
    if (i && phases[i - 1].end !== ph.start) err(path + '.start', 'phases must be contiguous');
    if (i && phases[i - 1].to !== ph.from) err(path + '.from', 'must equal previous phase "to" snapshot');
    for (const k of ['from', 'to']) if (!snaps[ph[k]]) err(`${path}.${k}`, 'unknown snapshot ' + ph[k]);
    for (const k of ['title', 'short', 'sub', 'insight', 'evidence']) bi(ph[k], `${path}.${k}`);
    if (!Array.isArray(ph.focus)) err(path + '.focus', 'array of player ids required (may be empty)');
    (Array.isArray(ph.focus) ? ph.focus : []).forEach(id => { if (!ids.has(id)) err(path + '.focus', 'unknown player ' + id); });
    const b = ph.ball;
    if (!(Array.isArray(b) && b.length >= 2 && b.every(Array.isArray) && b[0][0] === 0 && b[b.length - 1][0] === 1)) err(path + '.ball', 'array of [t,x,y] samples spanning t=0..1');
    else b.forEach((pt, j) => {
      if (!(Array.isArray(pt) && pt.length === 3 && Number.isFinite(pt[0]))) return err(`${path}.ball[${j}]`, '[t, x, y]');
      xy(pt.slice(1), `${path}.ball[${j}]`);
      if (j && !(pt[0] > b[j - 1][0])) err(`${path}.ball[${j}]`, 't must increase');
    });
    (ph.arcSegments || []).forEach(s => { if (!(Number.isInteger(s) && b && s >= 0 && s < b.length - 1)) err(path + '.arcSegments', 'invalid segment ' + s); });
    if (ph.zone != null && !(Array.isArray(ph.zone) && ph.zone.length === 4 && ph.zone.every(inRange))) err(path + '.zone', '[cx, cy, w, h]');
    for (const level of ['simple', 'deep']) {
      const rows = ph[level];
      if (!(Array.isArray(rows) && rows.length)) { err(`${path}.${level}`, 'at least one row'); continue; }
      rows.forEach((r, j) => {
        const rp = `${path}.${level}[${j}]`;
        if (!ROW_KINDS.includes(r.kind)) err(rp + '.kind', 'one of ' + ROW_KINDS.join(', '));
        bi(r.label, rp + '.label'); bi(r.text, rp + '.text');
        if (!isObj(r)) return err(rp, 'row must be an object');
        checkRefs(r.refs, rp + '.refs');
      });
      if (level === 'deep' && !rows.some(r => r.kind === 'observation')) err(`${path}.deep`, 'needs an observation row');
    }
    checkRefs(ph.eventIds, path + '.eventIds');
    if (ph.verification != null) {
      if (!['confirmed', 'partly-confirmed', 'not-verifiable', 'contradicted', 'synthetic-by-construction'].includes(ph.verification.status)) err(path + '.verification.status', 'invalid');
      bi(ph.verification.note, path + '.verification.note');
    }
    (ph.keyframes || []).forEach((k, j) => {
      if (!(Array.isArray(k) && k.length === 2 && k[0] > 0 && k[0] < 1 && snaps[k[1]])) err(`${path}.keyframes[${j}]`, '[t in (0,1), snapshot name]');
      if (j && !(k[0] > ph.keyframes[j - 1][0])) err(`${path}.keyframes[${j}]`, 't must increase');
    });
    const refs = ph.evidenceRefs || [];
    if (!refs.length) err(path + '.evidenceRefs', 'every phase needs at least one evidence reference');
    refs.forEach((r, j) => {
      if (!REF_TYPES.includes(r.type)) err(`${path}.evidenceRefs[${j}].type`, 'one of ' + REF_TYPES.join(', '));
      if (r.type === 'event' && !eventIds.has(r.id)) err(`${path}.evidenceRefs[${j}]`, 'unknown event ' + r.id);
    });
  });
  if (Array.isArray(m.scoreBefore) && Array.isArray(m.scoreAfter) && String(m.scoreBefore) !== String(m.scoreAfter) && !Number.isFinite(m.goalTime)) err('match.goalTime', 'required when the score changes');
  if (Number.isFinite(m.goalTime) && phases.length && !(m.goalTime >= phases[0].start && m.goalTime <= phases[phases.length - 1].end)) err('match.goalTime', 'outside phase range');

  // UI and summary
  const ui = c.ui || {};
  (ui.chips || []).forEach(id => { if (!ids.has(id)) err('ui.chips', 'unknown player ' + id); });
  (ui.labelWhenRelevant || []).forEach(id => { if (!ids.has(id)) err('ui.labelWhenRelevant', 'unknown player ' + id); });
  bi(ui.footer, 'ui.footer');
  const s = c.summary || (err('summary', 'missing'), {});
  bi(s.title, 'summary.title'); bi(s.intro, 'summary.intro');
  (s.cards || []).forEach((card, i) => {
    if (typeof card.tag !== 'string') err(`summary.cards[${i}].tag`, 'string required'); else texts.push([`summary.cards[${i}].tag`, card.tag]);
    bi(card.title, `summary.cards[${i}].title`); bi(card.text, `summary.cards[${i}].text`);
    (card.playerIds || []).forEach(id => { if (!ids.has(id)) err(`summary.cards[${i}].playerIds`, 'unknown player ' + id); });
    (card.phaseIds || []).forEach(id => { if (!phaseIds.has(id)) err(`summary.cards[${i}].phaseIds`, 'unknown phase ' + id); });
  });
  if (!(s.cards || []).length) err('summary.cards', 'at least one card');
  if (!(isObj(c.about) && Array.isArray(c.about.zh) && Array.isArray(c.about.en) && c.about.zh.length && c.about.en.length)) err('about', '{zh: [...], en: [...]} paragraphs required');
  else [...c.about.zh, ...c.about.en].forEach((t, i) => texts.push(['about', t]));
  if (!Array.isArray(c.sources) || !c.sources.length) err('sources', 'at least one source/provenance entry');
  else c.sources.forEach((s, i) => { if (s.url != null && !/^https:\/\/[^\s"'<>]+$/.test(s.url)) err(`sources[${i}].url`, 'must be null or an https:// URL'); });

  // Fabricated-precision lint on all user-facing text
  if (c.dataKind !== 'licensed-tracking') for (const [p, t] of texts) for (const [re, what] of FABRICATION_PATTERNS) if (re.test(t)) err(p, `contains a ${what} ("${t.match(re)[0]}") that this data cannot support`);
  return { errors, warnings };
}

module.exports = { validateCase, DATA_KINDS, ROW_KINDS, EVENT_TYPES, FABRICATION_PATTERNS };
