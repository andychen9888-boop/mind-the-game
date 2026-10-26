'use strict';
// Stage 2 — INTERPRET: event-rule segmentation and observable features per phase.
// Every feature is derived from the synthetic input; nothing is measured in metres or seconds of
// real play, and players with null positions are reported as unknown instead of estimated.
const BALL_TYPES = new Set(['regain', 'pass', 'carry', 'cross', 'through-ball', 'layoff', 'shot', 'goal', 'tackle', 'clearance', 'save']);
const DELIVERY = new Set(['pass', 'cross', 'through-ball', 'layoff']);
const FINAL_THIRD_X = 100 * 2 / 3;
const BOX = { x: 84.2, yMin: 21.1, yMax: 78.9 }; // drawn penalty area in pitch units
const MIN_PHASE = 1.5;
const SWITCH_DY = 40; // lateral movement (pitch units, 0-100 across) that counts as a switch of play
const MOVE = 3; // pitch units counted as "moved"

const lerp = (a, b, q) => a + (b - a) * q;
const r1 = v => Math.round(v * 10) / 10;
const third = ([x]) => x < 100 / 3 ? 'defensive' : x < FINAL_THIRD_X ? 'middle' : 'final';
const lane = ([, y]) => y < 100 / 3 ? 'left' : y < 200 / 3 ? 'central' : 'right';
const inBox = ([x, y]) => x >= BOX.x && y >= BOX.yMin && y <= BOX.yMax;
const zone = p => ({ third: third(p), lane: lane(p), box: inBox(p) });

function frameAt(frames, t) {
  if (t <= frames[0].t) return frames[0];
  for (let i = 1; i < frames.length; i++) {
    if (t <= frames[i].t) {
      const a = frames[i - 1], b = frames[i], q = (t - a.t) / (b.t - a.t), positions = {};
      for (const id of Object.keys(a.positions)) {
        const p = a.positions[id], n = b.positions[id];
        positions[id] = p && n ? [r1(lerp(p[0], n[0], q)), r1(lerp(p[1], n[1], q))] : null;
      }
      return { t, ball: [r1(lerp(a.ball[0], b.ball[0], q)), r1(lerp(a.ball[1], b.ball[1], q))], positions };
    }
  }
  return frames[frames.length - 1];
}

// Ball position from the event list (source of truth), not from the sampled frames.
function ballFromEvents(events, t) {
  const ball = events.filter(e => BALL_TYPES.has(e.type));
  let last = ball[0].start;
  for (const e of ball) {
    if (t < e.t) return last;
    if (t <= e.t + e.dur) { const q = (t - e.t) / e.dur; return [r1(lerp(e.start[0], e.end[0], q)), r1(lerp(e.start[1], e.end[1], q))]; }
    last = e.end;
  }
  return last;
}

function segment(input) {
  const ball = input.events.filter(e => BALL_TYPES.has(e.type));
  const first = input.frames[0].t, last = input.frames[input.frames.length - 1].t;
  const cuts = [];
  const regain = ball.find(e => e.type === 'regain');
  // A pressing sequence starts with the first press before the regain, so the press is shown.
  const press = regain && input.events.find(e => e.type === 'press' && e.t <= regain.t && regain.t - e.t < 6);
  const anchor = press ? press.t : regain ? regain.t : ball[0].t;
  const start = Math.max(first, anchor - 0.5);
  cuts.push(press ? { t: start, rule: 'press-start', zh: '第一次逼搶前片刻', en: 'just before the first press' }
    : regain ? { t: start, rule: 'possession-start', zh: '球權開始（奪回球權前片刻）', en: 'possession start (just before the regain)' }
    : { t: start, rule: 'possession-start', zh: '球權開始（第一次觸球前片刻）', en: 'possession start (just before the first touch)' });
  const team = id => input.players.find(p => p.id === id).team;
  const own = ball.filter(e => e.t >= start && team(e.actor) === input.match.attackingTeam);
  const midEntry = own.find(e => e.type !== 'regain' && e.start[0] < 100 / 3 && e.end[0] >= 100 / 3);
  if (midEntry) cuts.push({ t: midEntry.t, rule: 'middle-third-entry', zh: '球首次進入中場三分之一', en: 'first ball movement into the middle third', eventId: midEntry.id });
  const sw = own.find(e => DELIVERY.has(e.type) && Math.abs(e.end[1] - e.start[1]) >= SWITCH_DY);
  if (sw) cuts.push({ t: sw.t, rule: 'switch-of-play', zh: '橫向大範圍轉移', en: 'switch of play across the pitch', eventId: sw.id });
  const entry = own.find(e => e.type !== 'regain' && e.start[0] < FINAL_THIRD_X && e.end[0] >= FINAL_THIRD_X);
  if (entry) cuts.push({ t: entry.t, rule: 'final-third-entry', zh: '球首次進入前場三分之一', en: 'first ball movement into the final third', eventId: entry.id });
  const shotIdx = own.findIndex(e => e.type === 'shot');
  if (shotIdx > 0) {
    const finalBall = [...own.slice(0, shotIdx)].reverse().find(e => DELIVERY.has(e.type));
    if (finalBall) cuts.push({ t: finalBall.t, rule: 'final-ball', zh: '射門前最後一次傳送', en: 'last delivery before the shot', eventId: finalBall.id });
  }
  const endEvent = [...ball].reverse().find(e => e.type === 'goal' || e.type === 'shot') || ball[ball.length - 1];
  const end = Math.min(last, r1(endEvent.t + endEvent.dur + 0.7));
  cuts.forEach(c => { c.t = Math.max(c.t, start); });
  cuts.sort((a, b) => a.t - b.t);
  // Drop cuts that would create a phase shorter than MIN_PHASE.
  const kept = [];
  for (const c of cuts) {
    if (kept.length && c.t - kept[kept.length - 1].t < MIN_PHASE) continue;
    if (end - c.t < MIN_PHASE && kept.length) continue;
    kept.push(c);
  }
  return kept.map((c, i) => ({ start: r1(c.t), end: i < kept.length - 1 ? r1(kept[i + 1].t) : end, rule: c }));
}

function interpret(input) {
  const team = id => input.players.find(p => p.id === id).team;
  const att = input.match.attackingTeam;
  const phases = segment(input).map((seg, i) => {
    const inPhase = e => e.t >= seg.start && e.t < seg.end;
    const ballEvents = input.events.filter(e => e.type !== 'run' && inPhase(e));
    const runs = input.events.filter(e => e.type === 'run' && e.t < seg.end && e.t + e.dur > seg.start);
    const fA = { ...frameAt(input.frames, seg.start), ball: ballFromEvents(input.events, seg.start) };
    const fB = { ...frameAt(input.frames, seg.end), ball: ballFromEvents(input.events, seg.end) };
    const ballStart = fA.ball, ballEnd = fB.ball;
    const visible = (f, id) => f.positions[id] !== null;
    const defenders = input.players.filter(p => p.team !== att).map(p => p.id);
    const ahead = f => defenders.filter(id => visible(f, id) && f.positions[id][0] > f.ball[0]).length;
    const frames = input.frames.filter(f => f.t >= seg.start && f.t <= seg.end).concat([fA, fB]);
    const unobserved = input.players.filter(p => frames.some(f => f.positions[p.id] === null)).map(p => p.id);
    const retreating = defenders.filter(id => visible(fA, id) && visible(fB, id) && fB.positions[id][0] - fA.positions[id][0] > MOVE);
    const recipients = new Set(ballEvents.map(e => e.recipient).filter(Boolean));
    const actors = new Set(ballEvents.map(e => e.actor));
    // Off-ball runners in this phase: run event overlaps the phase and they do not touch the ball here.
    const runners = [...new Set(runs.map(r => r.actor))].filter(id => !actors.has(id) && !recipients.has(id)).map(id => {
      const a = fA.positions[id], b = fB.positions[id];
      if (!a || !b) return { id, observed: false };
      const d = [b[0] - a[0], b[1] - a[1]];
      // Defenders near the runner at phase end who moved the same way (co-movement, not causation).
      const coMoving = defenders.filter(did => visible(fA, did) && visible(fB, did)).map(did => {
        const da = fA.positions[did], db = fB.positions[did], dd = [db[0] - da[0], db[1] - da[1]];
        const len = Math.hypot(...d) * Math.hypot(...dd);
        return { id: did, near: Math.hypot(db[0] - b[0], db[1] - b[1]), cos: len ? (d[0] * dd[0] + d[1] * dd[1]) / len : 0, moved: Math.hypot(...dd) };
      }).filter(x => x.near < 10 && x.cos > 0.7 && x.moved > MOVE).sort((x, y) => x.near - y.near).map(x => x.id);
      const laterTouch = input.events.find(e => e.t >= seg.end && (e.recipient === id || (e.actor === id && e.type !== 'run')));
      return { id, observed: true, forward: d[0] > MOVE, coMoving, laterTouchEventId: laterTouch ? laterTouch.id : null };
    });
    // Visible defenders the ball travelled past during each forward delivery (synthetic positions).
    const bypassed = ballEvents.filter(e => ['pass', 'through-ball', 'cross'].includes(e.type) && e.end[0] > e.start[0]).map(e => {
      const f = frameAt(input.frames, e.t);
      return { eventId: e.id, defenders: defenders.filter(id => f.positions[id] && f.positions[id][0] > e.start[0] && f.positions[id][0] < e.end[0]) };
    });
    const switches = ballEvents.filter(e => DELIVERY.has(e.type) && Math.abs(e.end[1] - e.start[1]) >= SWITCH_DY).map(e => {
      const f = frameAt(input.frames, e.t);
      const near = y => defenders.filter(id => f.positions[id] && Math.abs(f.positions[id][1] - y) < 25).length;
      return { eventId: e.id, nearOld: near(e.start[1]), nearNew: near(e.end[1]) };
    });
    const pressEvents = ballEvents.filter(e => e.type === 'press');
    const shot = ballEvents.find(e => e.type === 'shot'), goal = ballEvents.find(e => e.type === 'goal');
    const kind = ballEvents.some(e => e.type === 'regain') ? 'regain' : shot ? 'finish' : 'progression';
    return {
      id: 'p' + (i + 1), start: seg.start, end: seg.end, rule: seg.rule, kind,
      ballEvents, runs, runners, bypassed, switches, pressEvents, ballStart, ballEnd,
      zoneStart: zone(ballStart), zoneEnd: zone(ballEnd),
      defendersAheadStart: ahead(fA), defendersAheadEnd: ahead(fB),
      retreatingDefenders: retreating,
      unobserved: { attackers: unobserved.filter(id => team(id) === att), defenders: unobserved.filter(id => team(id) !== att) },
      shot: shot || null, goal: goal || null,
      focus: [...new Set([...ballEvents.flatMap(e => [e.actor, e.recipient]).filter(Boolean), ...runners.map(r => r.id), ...runners.flatMap(r => r.coMoving || []).slice(0, 2)])]
    };
  });
  // Off-ball runs that started in an earlier phase and ended with a touch later (e.g. a late arrival).
  phases.forEach(ph => {
    ph.arrivals = ph.ballEvents.filter(e => ['shot', 'pass', 'carry'].includes(e.type)).map(e => {
      const run = input.events.find(r => r.type === 'run' && r.actor === (e.type === 'shot' ? e.actor : e.recipient) && r.t < ph.start);
      return run ? { playerId: run.actor, runEventId: run.id, sincePhase: phases.find(p => run.t >= p.start && run.t < p.end)?.id } : null;
    }).filter(Boolean).filter((a, i, all) => all.findIndex(b => b.playerId === a.playerId) === i);
  });
  return { phases, frameAt: t => frameAt(input.frames, t), ballAt: t => ballFromEvents(input.events, t) };
}
module.exports = { interpret, frameAt, ballFromEvents, zone, BOX, FINAL_THIRD_X };
