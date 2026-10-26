#!/usr/bin/env node
'use strict';
// SYNTHETIC scenario 2: patient build-up from the goalkeeper, switch of play, cross, headed goal.
// Fictional teams. Involved players follow hand-authored waypoints; the rest follow the team shape.
const path = require('node:path');
const { build } = require('./lib.cjs');
const root = path.resolve(__dirname, '../..');
const W = (id, short, zh, en, role, waypoints) => ({ id, team: 'wes', short, name: { zh: `西野 ${short} 號 ${zh}`, en: `WES #${short} ${en}` }, role, waypoints });
const F = (team, id, short, zh, en, role, base, follow) => ({ id, team, short, name: team === 'wes' ? { zh: `西野 ${short} 號 ${zh}`, en: `WES #${short} ${en}` } : { zh: `湖岸 ${short} 號 ${zh}`, en: `LAK #${short} ${en}` }, role, base, follow });
const ATT = { kx: 0.55, ky: 0.18, minX: 3 };          // attackers move up with the ball
const DEF = { kx: 0.45, ky: 0.35, maxX: 98 };         // defenders shuffle toward the ball, stay goal-side
build({
  caseId: 'synthetic-buildup-02',
  script: 'scripts/synthetic/generate-buildup-02.cjs',
  menuLabel: { zh: '合成組織進攻：門將出球、轉移、頭球（虛構球隊）', en: 'Synthetic build-up: from the keeper to a headed goal (fictional teams)' },
  method: 'Hand-authored waypoints for the players involved in the move; team-shape following for the others; 0.5 s sampling; ball events authored by hand.',
  realism: 'Football-realistic by design (short goal kick, build-up through the midfield, switch to the far full-back, cross for a header). Not derived from any real match, tracking feed or broadcast.',
  t0: 1659.5, t1: 1676.5, cameraHalfWidth: 36,
  match: { competition: { zh: '合成示範賽（虛構）', en: 'Synthetic demo fixture (fictional)' }, home: 'wes', away: 'lak', attackingTeam: 'wes', scoreBefore: [1, 1], scoreAfter: [2, 1] },
  teams: {
    wes: { name: { zh: '西野流浪者（虛構）', en: 'Westfield Rovers (fictional)' }, short: 'WES', kit: { body: '#2f6b3a', ring: '#e8d36a', shirt: '#3a7d46', stripe: '#e8d36a', badge: '#1d3d23' } },
    lak: { name: { zh: '湖岸聯（虛構）', en: 'Lakeshore United (fictional)' }, short: 'LAK', kit: { body: '#5b3f8c', ring: '#e7def5', shirt: '#6a4ca0', stripe: null, badge: '#36245a' } }
  },
  players: [
    W('a1', '1', '門將', 'goalkeeper', 'GK', [[1659.5, 5, 50], [1676.5, 9, 50]]),
    W('a5', '5', '中後衛', 'centre-back', 'CB', [[1659.5, 15, 32], [1661.5, 16, 30], [1664, 24, 32], [1670, 38, 34], [1676.5, 44, 36]]),
    F('wes', 'a4', '4', '中後衛', 'centre-back', 'CB', [24, 66], ATT),
    F('wes', 'a2', '2', '右後衛', 'right-back', 'RB', [34, 86], ATT),
    W('a3', '3', '左後衛', 'left-back', 'LB', [[1659.5, 30, 12], [1664.5, 42, 12], [1666.4, 50, 10], [1667.8, 52, 10], [1670.0, 64, 12], [1670.6, 65, 12], [1676.5, 72, 16]]),
    W('a6', '6', '防守中場', 'holding midfielder', 'DM', [[1659.5, 26, 46], [1662.4, 28, 44], [1664.5, 36, 46], [1665.2, 37, 47], [1676.5, 50, 46]]),
    W('a8', '8', '中場', 'midfielder', 'CM', [[1659.5, 38, 66], [1664.0, 42, 63], [1665.8, 44, 62], [1666.4, 44.5, 61.5], [1676.5, 62, 58]]),
    W('a10', '10', '前腰', 'playmaker', 'AM', [[1659.5, 50, 40], [1670.0, 70, 38], [1671.0, 72, 38], [1674.5, 86, 38], [1676.5, 88, 38]]),
    W('a11', '11', '左邊鋒', 'left winger', 'LW', [[1659.5, 58, 10], [1669.0, 66, 12], [1671.3, 70, 14], [1673.4, 84, 16], [1676.5, 86, 18]]),
    W('a9', '9', '中鋒', 'centre-forward', 'ST', [[1659.5, 62, 46], [1670.0, 80, 44], [1671.0, 82, 44], [1674.8, 93, 52], [1676.5, 94, 50]]),
    W('a7', '7', '右邊鋒', 'right winger', 'RW', [[1659.5, 60, 84], [1670.0, 76, 72], [1671.0, 78, 70], [1674.8, 91, 62], [1676.5, 92, 60]]),
    F('lak', 'b1', '1', '門將', 'goalkeeper', 'GK', [95, 50], { kx: 0.04, ky: 0.12, maxX: 99, minX: 92 }),
    F('lak', 'b2', '2', '右後衛', 'right-back', 'RB', [80, 18], DEF),
    F('lak', 'b4', '4', '中後衛', 'centre-back', 'CB', [82, 40], DEF),
    F('lak', 'b5', '5', '中後衛', 'centre-back', 'CB', [82, 58], DEF),
    F('lak', 'b3', '3', '左後衛', 'left-back', 'LB', [80, 80], DEF),
    F('lak', 'b6', '6', '防守中場', 'holding midfielder', 'DM', [68, 50], DEF),
    F('lak', 'b8', '8', '中場', 'midfielder', 'CM', [64, 34], DEF),
    F('lak', 'b10', '10', '中場', 'midfielder', 'CM', [64, 66], DEF),
    F('lak', 'b7', '7', '邊鋒', 'winger', 'RW', [56, 20], DEF),
    F('lak', 'b11', '11', '邊鋒', 'winger', 'LW', [56, 80], DEF),
    F('lak', 'b9', '9', '中鋒', 'centre-forward', 'ST', [48, 50], DEF)
  ],
  events: [
    { type: 'pass', t: 1660.0, dur: 1.0, actor: 'a1', recipient: 'a5', start: [5, 50], end: [16, 30], detail: 'goal kick, short' },
    { type: 'pass', t: 1661.5, dur: 0.9, actor: 'a5', recipient: 'a6', start: [16, 30], end: [28, 44] },
    { type: 'carry', t: 1663.0, dur: 1.5, actor: 'a6', start: [28, 44], end: [36, 46] },
    { type: 'run', t: 1664.5, dur: 1.9, actor: 'a3', start: [42, 12], end: [50, 10] },
    { type: 'pass', t: 1665.0, dur: 0.8, actor: 'a6', recipient: 'a8', start: [37, 47], end: [44, 62] },
    { type: 'pass', t: 1666.4, dur: 1.4, actor: 'a8', recipient: 'a3', start: [44.5, 61.5], end: [52, 10], detail: 'switch' },
    { type: 'carry', t: 1668.0, dur: 2.0, actor: 'a3', start: [52, 10], end: [64, 12] },
    { type: 'pass', t: 1670.6, dur: 0.7, actor: 'a3', recipient: 'a11', start: [65, 12], end: [70, 14] },
    { type: 'run', t: 1670.0, dur: 4.8, actor: 'a9', start: [80, 44], end: [93, 52] },
    { type: 'run', t: 1670.0, dur: 4.8, actor: 'a7', start: [76, 72], end: [91, 62] },
    { type: 'run', t: 1671.0, dur: 3.5, actor: 'a10', start: [72, 38], end: [86, 38] },
    { type: 'carry', t: 1671.4, dur: 2.0, actor: 'a11', start: [70, 14], end: [84, 16] },
    { type: 'cross', t: 1673.8, dur: 1.0, actor: 'a11', recipient: 'a9', start: [84, 16], end: [93, 52] },
    { type: 'shot', t: 1674.9, dur: 0.4, actor: 'a9', start: [93, 52], end: [100, 47], detail: 'header' },
    { type: 'goal', t: 1675.3, dur: 0.1, actor: 'a9', start: [100, 47], end: [100, 47] }
  ].sort((a, b) => a.t - b.t)
}, path.join(root, 'data/synthetic/buildup-02.input.json'));
