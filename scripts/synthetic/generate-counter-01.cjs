#!/usr/bin/env node
'use strict';
// Generates data/synthetic/counter-01.input.json: a SYNTHETIC, football-realistic counterattack
// between two FICTIONAL teams. Nothing here is taken from a real match or tracking provider.
// Positions come from hand-authored waypoints, sampled every 0.5 s. A simulated broadcast
// camera window (centred on the ball) marks players outside the frame as null, so the pipeline
// must handle missing positions the same way it would with real video annotation.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

const T0 = 3789.5, T1 = 3801.0, STEP = 0.5, CAMERA_HALF_WIDTH = 34;
const team = (id, short, zh, en, kit) => ({ id, short, name: { zh, en }, kit });
const teams = [
  team('nor', 'NOR', '北橋 FC（虛構）', 'Northbridge FC (fictional)', { body: '#c9652c', ring: '#f1d2a7', shirt: '#d9773c', stripe: '#1f2b3a', badge: '#1f2b3a' }),
  team('har', 'HAR', '港城聯（虛構）', 'Harbor City (fictional)', { body: '#1f6f73', ring: '#cfe8e4', shirt: '#2a8287', stripe: null, badge: '#164a4d' })
];
const P = (id, teamId, short, zh, en, role, waypoints) => ({ id, team: teamId, short, name: { zh, en }, role, waypoints });
// waypoints: [t, x, y]. x: 0 = Northbridge goal, 100 = Harbor goal. Northbridge attack left to right.
const players = [
  P('n1', 'nor', '1', '北橋 1 號 門將', 'NOR #1 goalkeeper', 'GK', [[3789.5, 6, 50], [3801, 9, 50]]),
  P('n2', 'nor', '2', '北橋 2 號 右後衛', 'NOR #2 right-back', 'RB', [[3789.5, 30, 78], [3792, 32, 78], [3795.5, 40, 78], [3799, 50, 78], [3801, 54, 78]]),
  P('n4', 'nor', '4', '北橋 4 號 中後衛', 'NOR #4 centre-back', 'CB', [[3789.5, 24, 60], [3792, 26, 60], [3795.5, 32, 58], [3799, 38, 58], [3801, 42, 58]]),
  P('n5', 'nor', '5', '北橋 5 號 中後衛', 'NOR #5 centre-back', 'CB', [[3789.5, 24, 40], [3792, 26, 40], [3795.5, 32, 40], [3799, 38, 40], [3801, 42, 40]]),
  P('n3', 'nor', '3', '北橋 3 號 左後衛', 'NOR #3 left-back', 'LB', [[3789.5, 30, 22], [3792, 32, 22], [3795.5, 40, 24], [3799, 48, 26], [3801, 52, 26]]),
  P('n6', 'nor', '6', '北橋 6 號 防守中場', 'NOR #6 holding midfielder', 'DM', [[3789.5, 40, 58], [3790, 38, 55], [3792, 40, 53], [3795.5, 46, 52], [3799, 54, 52], [3801, 56, 52]]),
  P('n10', 'nor', '10', '北橋 10 號 前腰', 'NOR #10 playmaker', 'AM', [[3789.5, 45, 38], [3791.5, 46, 42], [3795, 63, 47], [3795.5, 63.5, 47], [3799, 72, 50], [3801, 74, 50]]),
  P('n8', 'nor', '8', '北橋 8 號 中場', 'NOR #8 midfielder', 'CM', [[3789.5, 42, 62], [3792, 44, 62], [3795.5, 62, 60], [3799, 79, 57], [3799.5, 80, 57], [3801, 81, 57]]),
  P('n7', 'nor', '7', '北橋 7 號 右邊鋒', 'NOR #7 right winger', 'RW', [[3789.5, 55, 80], [3791.5, 55, 80], [3796.5, 80, 76], [3798.5, 88, 68], [3801, 89, 68]]),
  P('n9', 'nor', '9', '北橋 9 號 中鋒', 'NOR #9 centre-forward', 'ST', [[3789.5, 57, 48], [3791.5, 57, 48], [3797, 80, 40], [3799, 82, 40], [3801, 84, 42]]),
  P('n11', 'nor', '11', '北橋 11 號 左邊鋒', 'NOR #11 left winger', 'LW', [[3789.5, 55, 20], [3792, 58, 20], [3795.5, 68, 22], [3799, 78, 26], [3801, 80, 28]]),
  P('h1', 'har', '1', '港城 1 號 門將', 'HAR #1 goalkeeper', 'GK', [[3789.5, 95, 50], [3795.5, 95, 52], [3799, 95, 53], [3800, 96, 50], [3801, 96, 49]]),
  P('h2', 'har', '2', '港城 2 號 右後衛', 'HAR #2 right-back', 'RB', [[3789.5, 62, 18], [3792, 66, 22], [3795.5, 74, 28], [3799, 82, 34], [3801, 84, 36]]),
  P('h4', 'har', '4', '港城 4 號 中後衛', 'HAR #4 centre-back', 'CB', [[3789.5, 66, 42], [3792, 70, 44], [3795.5, 76, 44], [3797, 81, 42], [3799, 84, 42], [3801, 86, 44]]),
  P('h5', 'har', '5', '港城 5 號 中後衛', 'HAR #5 centre-back', 'CB', [[3789.5, 66, 62], [3792, 70, 62], [3795.5, 76, 62], [3799, 86, 62], [3801, 88, 58]]),
  P('h3', 'har', '3', '港城 3 號 左後衛', 'HAR #3 left-back', 'LB', [[3789.5, 58, 84], [3792, 62, 82], [3795.5, 72, 80], [3799, 84, 73], [3801, 87, 68]]),
  P('h6', 'har', '6', '港城 6 號 防守中場', 'HAR #6 holding midfielder', 'DM', [[3789.5, 50, 50], [3792, 52, 50], [3795.5, 62, 52], [3799, 74, 54], [3801, 78, 55]]),
  P('h8', 'har', '8', '港城 8 號 中場', 'HAR #8 midfielder', 'CM', [[3789.5, 41, 57], [3792, 42, 54], [3795.5, 52, 52], [3799, 64, 54], [3801, 70, 56]]),
  P('h10', 'har', '10', '港城 10 號 中場', 'HAR #10 midfielder', 'CM', [[3789.5, 38, 34], [3792, 42, 36], [3795.5, 50, 38], [3799, 58, 40], [3801, 62, 42]]),
  P('h7', 'har', '7', '港城 7 號 邊鋒', 'HAR #7 winger', 'RW', [[3789.5, 30, 26], [3792, 33, 28], [3795.5, 40, 32], [3799, 48, 34], [3801, 52, 36]]),
  P('h9', 'har', '9', '港城 9 號 中鋒', 'HAR #9 centre-forward', 'ST', [[3789.5, 28, 50], [3792, 32, 50], [3795.5, 38, 50], [3799, 46, 50], [3801, 50, 50]]),
  P('h11', 'har', '11', '港城 11 號 邊鋒', 'HAR #11 winger', 'LW', [[3789.5, 32, 72], [3792, 35, 70], [3795.5, 42, 68], [3799, 50, 66], [3801, 54, 64]])
];
// Ball events (synthetic). dur = time the ball travels or the carry lasts.
const events = [
  { type: 'regain', t: 3790.0, dur: 0.3, actor: 'n6', start: [40, 56], end: [38, 55], detail: 'interception' },
  { type: 'pass', t: 3790.8, dur: 0.6, actor: 'n6', recipient: 'n10', start: [38, 55], end: [46, 42] },
  { type: 'carry', t: 3791.6, dur: 3.4, actor: 'n10', start: [46, 42], end: [63, 47] },
  { type: 'run', t: 3791.6, dur: 4.9, actor: 'n7', start: [55, 80], end: [80, 76] },
  { type: 'run', t: 3791.6, dur: 5.4, actor: 'n9', start: [57, 48], end: [80, 40] },
  { type: 'run', t: 3792.0, dur: 7.2, actor: 'n8', start: [44, 62], end: [80, 57] },
  { type: 'through-ball', t: 3795.4, dur: 0.9, actor: 'n10', recipient: 'n7', start: [63, 47], end: [80, 76] },
  { type: 'carry', t: 3796.4, dur: 2.1, actor: 'n7', start: [80, 76], end: [88, 68] },
  { type: 'pass', t: 3798.9, dur: 0.6, actor: 'n7', recipient: 'n8', start: [88, 68], end: [80, 57], detail: 'cutback' },
  { type: 'shot', t: 3799.7, dur: 0.5, actor: 'n8', start: [80, 57], end: [100, 47] },
  { type: 'goal', t: 3800.2, dur: 0.1, actor: 'n8', start: [100, 47], end: [100, 47] }
].map((e, i) => ({ id: 'e' + String(i + 1).padStart(2, '0'), ...e }));

const lerp = (a, b, q) => a + (b - a) * q;
function waypointAt(w, t) {
  if (t <= w[0][0]) return [w[0][1], w[0][2]];
  for (let i = 1; i < w.length; i++) if (t <= w[i][0]) { const q = (t - w[i - 1][0]) / (w[i][0] - w[i - 1][0]); return [lerp(w[i - 1][1], w[i][1], q), lerp(w[i - 1][2], w[i][2], q)]; }
  const l = w[w.length - 1]; return [l[1], l[2]];
}
function ballAt(t) {
  const ballEvents = events.filter(e => e.type !== 'run');
  let last = ballEvents[0].start;
  for (const e of ballEvents) {
    if (t < e.t) return last;
    if (t <= e.t + e.dur) { const q = (t - e.t) / e.dur; return [lerp(e.start[0], e.end[0], q), lerp(e.start[1], e.end[1], q)]; }
    last = e.end;
  }
  return last;
}
const r1 = v => Math.round(v * 10) / 10;
const frames = [];
for (let t = T0; t <= T1 + 1e-9; t += STEP) {
  const tt = Math.round(t * 10) / 10, ball = ballAt(tt), positions = {};
  for (const p of players) {
    const [x, y] = waypointAt(p.waypoints, tt);
    positions[p.id] = Math.abs(x - ball[0]) <= CAMERA_HALF_WIDTH ? [r1(x), r1(y)] : null;
  }
  frames.push({ t: tt, ball: ball.map(r1), positions });
}
const out = {
  inputVersion: 'mtg-synthetic-input-1',
  caseId: 'synthetic-counter-01',
  dataKind: 'synthetic',
  menuLabel: { zh: '合成反擊：虛構球隊示範（資料流程產生）', en: 'Synthetic counterattack: fictional teams (pipeline-generated)' },
  generator: {
    script: 'scripts/synthetic/generate-counter-01.cjs',
    method: 'Hand-authored waypoints for 22 fictional players, linear interpolation, 0.5 s sampling; ball events authored by hand.',
    visibilityModel: `Simulated broadcast camera window: players more than ${CAMERA_HALF_WIDTH} normalized units from the ball (along the pitch length) are null (not observed).`,
    realism: 'Football-realistic by design (4-3-3 vs recovering block, counterattack after an interception). Not derived from any real match, tracking feed or broadcast.'
  },
  match: { competition: { zh: '合成示範賽（虛構）', en: 'Synthetic demo fixture (fictional)' }, home: 'nor', away: 'har', attackingTeam: 'nor', scoreBefore: [0, 0], scoreAfter: [1, 0] },
  coordinates: { range: [0, 100], units: 'normalized pitch (0 = attacking team goal line)', measured: false, attackingDirection: 'ltr' },
  teams: Object.fromEntries(teams.map(t => [t.id, { name: t.name, short: t.short, kit: t.kit }])),
  players: players.map(({ waypoints, ...p }) => p),
  events,
  frames
};
const target = path.join(root, 'data/synthetic/counter-01.input.json');
fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
const hidden = frames.reduce((n, f) => n + Object.values(f.positions).filter(v => v === null).length, 0);
console.log(`Wrote ${path.relative(root, target)}: ${players.length} players, ${events.length} events, ${frames.length} frames, ${hidden} null (off-camera) positions`);
