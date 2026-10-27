'use strict';
// Shared builder for SYNTHETIC scenarios (fictional teams; nothing from real matches).
// A player either follows hand-authored waypoints [t, x, y] or a team-shape rule: a base position
// shifted with the (slightly lagged) ball, which keeps uninvolved players football-realistic
// without hand-placing every one. A simulated broadcast camera marks far-away players as null.
const fs = require('node:fs');
const path = require('node:path');

const lerp = (a, b, q) => a + (b - a) * q;
const r1 = v => Math.round(v * 10) / 10;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function waypointAt(w, t) {
  if (t <= w[0][0]) return [w[0][1], w[0][2]];
  for (let i = 1; i < w.length; i++) if (t <= w[i][0]) { const q = (t - w[i - 1][0]) / (w[i][0] - w[i - 1][0]); return [lerp(w[i - 1][1], w[i][1], q), lerp(w[i - 1][2], w[i][2], q)]; }
  const l = w[w.length - 1]; return [l[1], l[2]];
}

function makeBall(events) {
  const ballEvents = events.filter(e => e.type !== 'run' && e.type !== 'press');
  return t => {
    let last = ballEvents[0].start;
    for (const e of ballEvents) {
      if (t < e.t) return last;
      if (t <= e.t + e.dur) { const q = (t - e.t) / e.dur; return [lerp(e.start[0], e.end[0], q), lerp(e.start[1], e.end[1], q)]; }
      last = e.end;
    }
    return last;
  };
}

// Team-shape follower: attackers push up with the ball; defenders keep goal-side and compact.
function follow(p, ball, t) {
  const lagged = [0, 0.4, 0.8, 1.2].map(d => ball(t - d)).reduce((a, b) => [a[0] + b[0] / 4, a[1] + b[1] / 4], [0, 0]);
  const f = p.follow;
  const x = p.base[0] + f.kx * (lagged[0] - 50), y = p.base[1] + f.ky * (lagged[1] - 50);
  // Soft depth limit: approaching maxX, the shift slows down smoothly instead of stopping dead, so a
  // back line keeps staggered depths rather than standing in one straight row on the limit.
  let xx = x;
  if (f.maxX !== undefined && f.maxX < 95) { const soft = f.maxX - 10; if (xx > soft) xx = soft + 10 * (1 - Math.exp(-(xx - soft) / 10)); }
  return [clamp(xx, f.minX ?? 1, f.maxX ?? 99), clamp(y, 2, 98)];
}

function build(spec, outFile) {
  const ball = makeBall(spec.events);
  const events = spec.events.map((e, i) => ({ id: 'e' + String(i + 1).padStart(2, '0'), ...e }));
  const frames = [];
  for (let t = spec.t0; t <= spec.t1 + 1e-9; t += spec.step || 0.5) {
    const tt = Math.round(t * 10) / 10, b = ball(tt), positions = {};
    for (const p of spec.players) {
      const [x, y] = p.waypoints ? waypointAt(p.waypoints, tt) : follow(p, ball, tt);
      positions[p.id] = Math.abs(x - b[0]) <= spec.cameraHalfWidth ? [r1(x), r1(y)] : null;
    }
    frames.push({ t: tt, ball: b.map(r1), positions });
  }
  const out = {
    inputVersion: 'mtg-synthetic-input-1', caseId: spec.caseId, dataKind: 'synthetic', menuLabel: spec.menuLabel,
    generator: { script: spec.script, method: spec.method, visibilityModel: `Simulated broadcast camera window: players more than ${spec.cameraHalfWidth} normalized units from the ball (along the pitch length) are null (not observed).`, realism: spec.realism },
    match: spec.match,
    coordinates: { range: [0, 100], units: 'normalized pitch (0 = attacking team goal line)', measured: false, attackingDirection: 'ltr' },
    teams: spec.teams,
    players: spec.players.map(({ waypoints, base, follow: _f, ...p }) => p),
    events, frames
  };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1) + '\n');
  const hidden = frames.reduce((n, f) => n + Object.values(f.positions).filter(v => v === null).length, 0);
  console.log(`Wrote ${path.basename(outFile)}: ${spec.players.length} players, ${events.length} events, ${frames.length} frames, ${hidden} null (off-camera) positions`);
}
module.exports = { build };
