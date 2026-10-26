#!/usr/bin/env node
'use strict';
// SYNTHETIC scenario 3: high press. The opponent plays out from the back, two presses force a
// rushed pass, the ball is won in the final third and a quick pass leads to a goal. Fictional teams.
const path = require('node:path');
const { build } = require('./lib.cjs');
const root = path.resolve(__dirname, '../..');
const nm = (team, short, zh, en) => team === 'eas' ? { zh: `東港 ${short} 號 ${zh}`, en: `EAS #${short} ${en}` } : { zh: `河畔 ${short} 號 ${zh}`, en: `RIV #${short} ${en}` };
const W = (team, id, short, zh, en, role, waypoints) => ({ id, team, short, name: nm(team, short, zh, en), role, waypoints });
const F = (team, id, short, zh, en, role, base, follow) => ({ id, team, short, name: nm(team, short, zh, en), role, base, follow });
const ATT = { kx: 0.5, ky: 0.15, minX: 3 };
const DEF = { kx: 0.3, ky: 0.3, maxX: 98 };
build({
  caseId: 'synthetic-press-03',
  script: 'scripts/synthetic/generate-press-03.cjs',
  menuLabel: { zh: '合成高位逼搶：前場搶回球後射門（虛構球隊）', en: 'Synthetic high press: win it high, score fast (fictional teams)' },
  method: 'Hand-authored waypoints for the players involved; team-shape following for the others; 0.5 s sampling; ball and press events authored by hand.',
  realism: 'Football-realistic by design (opponent builds from the goalkeeper, the striker presses the centre-back, a midfielder wins the ball in the final third, quick pass and shot). Not derived from any real match, tracking feed or broadcast.',
  t0: 1200.0, t1: 1205.5, cameraHalfWidth: 36,
  match: { competition: { zh: '合成示範賽（虛構）', en: 'Synthetic demo fixture (fictional)' }, home: 'eas', away: 'riv', attackingTeam: 'eas', scoreBefore: [0, 0], scoreAfter: [1, 0] },
  teams: {
    eas: { name: { zh: '東港競技（虛構）', en: 'Eastport Athletic (fictional)' }, short: 'EAS', kit: { body: '#b0303a', ring: '#f4d7da', shirt: '#c23a45', stripe: '#f4f4f4', badge: '#6e1a22' } },
    riv: { name: { zh: '河畔隊（虛構）', en: 'Riverside (fictional)' }, short: 'RIV', kit: { body: '#2d5fa8', ring: '#d8e4f6', shirt: '#3a6fbd', stripe: null, badge: '#1c3c6b' } }
  },
  players: [
    F('eas', 'p1', '1', '門將', 'goalkeeper', 'GK', [8, 50], { kx: 0.1, ky: 0.05, minX: 4, maxX: 20 }),
    F('eas', 'p4', '4', '中後衛', 'centre-back', 'CB', [46, 38], ATT),
    F('eas', 'p5', '5', '中後衛', 'centre-back', 'CB', [46, 62], ATT),
    F('eas', 'p2', '2', '右後衛', 'right-back', 'RB', [56, 84], ATT),
    F('eas', 'p3', '3', '左後衛', 'left-back', 'LB', [56, 16], ATT),
    F('eas', 'p6', '6', '防守中場', 'holding midfielder', 'DM', [62, 50], ATT),
    W('eas', 'p8', '8', '中場', 'midfielder', 'CM', [[1200.0, 70, 52], [1202.2, 72, 50], [1202.8, 77.5, 45.5], [1203.4, 78, 45], [1205.5, 82, 44]]),
    W('eas', 'p10', '10', '前腰', 'playmaker', 'AM', [[1200.0, 76, 30], [1202.6, 80, 32], [1203.9, 85, 38], [1204.2, 85.5, 38.5], [1205.5, 88, 40]]),
    W('eas', 'p9', '9', '中鋒', 'centre-forward', 'ST', [[1200.0, 78, 42], [1201.2, 80, 36], [1202.2, 87, 30], [1203.0, 88, 31], [1205.5, 90, 34]]),
    W('eas', 'p11', '11', '左邊鋒', 'left winger', 'LW', [[1200.0, 72, 18], [1202.6, 76, 20], [1204.6, 88, 24], [1205.5, 89, 25]]),
    W('eas', 'p7', '7', '右邊鋒', 'right winger', 'RW', [[1200.0, 72, 76], [1202.6, 74, 72], [1204.6, 86, 62], [1205.5, 87, 60]]),
    W('riv', 'q1', '1', '門將', 'goalkeeper', 'GK', [[1200.0, 96, 50], [1203.4, 95, 49], [1204.2, 96, 46], [1205.5, 96, 46]]),
    W('riv', 'q4', '4', '中後衛', 'centre-back', 'CB', [[1200.0, 90, 34], [1201.4, 88, 28], [1202.0, 88, 28], [1205.5, 92, 34]]),
    F('riv', 'q5', '5', '中後衛', 'centre-back', 'CB', [88, 64], DEF),
    F('riv', 'q2', '2', '右後衛', 'right-back', 'RB', [82, 14], DEF),
    F('riv', 'q3', '3', '左後衛', 'left-back', 'LB', [82, 86], DEF),
    W('riv', 'q6', '6', '防守中場', 'holding midfielder', 'DM', [[1200.0, 82, 50], [1202.7, 79, 44], [1203.2, 79.5, 45], [1205.5, 84, 46]]),
    F('riv', 'q8', '8', '中場', 'midfielder', 'CM', [72, 34], DEF),
    F('riv', 'q10', '10', '中場', 'midfielder', 'CM', [72, 66], DEF),
    F('riv', 'q7', '7', '邊鋒', 'winger', 'RW', [64, 20], DEF),
    F('riv', 'q11', '11', '邊鋒', 'winger', 'LW', [64, 80], DEF),
    F('riv', 'q9', '9', '中鋒', 'centre-forward', 'ST', [58, 50], DEF)
  ],
  events: [
    { type: 'pass', t: 1200.5, dur: 0.9, actor: 'q1', recipient: 'q4', start: [96, 50], end: [88, 28] },
    { type: 'press', t: 1201.2, dur: 1.0, actor: 'p9', recipient: 'q4', start: [80, 36], end: [87, 30] },
    { type: 'pass', t: 1202.0, dur: 0.7, actor: 'q4', recipient: 'q6', start: [88, 28], end: [79, 44] },
    { type: 'press', t: 1202.2, dur: 0.6, actor: 'p8', recipient: 'q6', start: [72, 50], end: [78, 45] },
    { type: 'run', t: 1202.6, dur: 1.4, actor: 'p10', start: [80, 32], end: [85, 38] },
    { type: 'run', t: 1202.6, dur: 2.0, actor: 'p11', start: [76, 20], end: [88, 24] },
    { type: 'run', t: 1202.6, dur: 2.0, actor: 'p7', start: [74, 72], end: [86, 62] },
    { type: 'regain', t: 1202.9, dur: 0.3, actor: 'p8', start: [79, 44], end: [78, 45], detail: 'tackle' },
    { type: 'pass', t: 1203.4, dur: 0.5, actor: 'p8', recipient: 'p10', start: [78, 45], end: [85, 38] },
    { type: 'shot', t: 1204.2, dur: 0.4, actor: 'p10', start: [85.5, 38.5], end: [100, 46] },
    { type: 'goal', t: 1204.6, dur: 0.1, actor: 'p10', start: [100, 46], end: [100, 46] }
  ].sort((a, b) => a.t - b.t)
}, path.join(root, 'data/synthetic/press-03.input.json'));
