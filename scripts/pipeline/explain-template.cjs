'use strict';
// Stage 3 — EXPLAIN (offline): deterministic bilingual templates driven only by interpreted
// features. This is NOT an AI model; the case is marked generation.explanations = "offline-template".
// Output shape is the same one an AI explainer must return (see explain-schema in validate step).

function makeNames(input) {
  const att = input.match.attackingTeam;
  const byId = Object.fromEntries(input.players.map(p => [p.id, p]));
  const teamShort = { zh: t => input.teams[t].name.zh.replace(/（.*）/, ''), en: t => input.teams[t].name.en.replace(/ \(.*\)/, '') };
  const n = (id, lang) => {
    const p = byId[id];
    if (lang === 'zh') return p.team === att ? `${p.short} 號` : `${teamShort.zh(p.team)} ${p.short} 號`;
    return p.team === att ? `#${p.short}` : `${teamShort.en(p.team).split(' ')[0]} #${p.short}`;
  };
  const list = (ids, lang) => {
    const names = ids.map(id => n(id, lang));
    if (lang === 'zh') return names.join('、');
    return names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  };
  return { n, list, byId, att };
}

const ZONE = {
  zh: z => z.box ? '禁區內' + ({ left: '左側', central: '中路', right: '右側' })[z.lane] : ({ defensive: '後場', middle: '中場', final: '前場' })[z.third] + ({ left: '左路', central: '中路', right: '右路' })[z.lane],
  en: z => z.box ? `the ${({ left: 'left side of the', central: 'centre of the', right: 'right side of the' })[z.lane]} penalty area` : `the ${({ left: 'left', central: 'central', right: 'right' })[z.lane]} channel of the ${({ defensive: 'defensive', middle: 'middle', final: 'final' })[z.third]} third`
};

const SIDE = { zh: { left: '左側', central: '中路', right: '右側' }, en: { left: 'left side', central: 'centre', right: 'right side' } };
function eventSentence(e, N, lang, ctx = {}) {
  const A = N.n(e.actor, lang), B = e.recipient ? N.n(e.recipient, lang) : '';
  const lane = ctx.zone ? ctx.zone(e.start).lane : null;
  const running = ctx.running ? ctx.running(e) : false;
  const zh = {
    regain: e.detail === 'tackle' ? `${A}搶下球，奪回球權。` : `${A}截下對手的傳球，奪回球權。`,
    press: `${A}上前逼搶持球的${B}。`,
    pass: e.detail === 'cutback' ? `${A}從禁區${lane ? SIDE.zh[lane] : ''}把球往回傳給${B}。` : e.detail === 'switch' ? `${A}一腳長傳，把球轉到另一側給${B}。` : /goal kick/.test(e.detail || '') ? `${A}開球時沒有大腳，短傳給${B}。` : `${A}把球傳給${B}。`,
    carry: `${A}帶球向前推進。`,
    'through-ball': running ? `${A}送出直塞，找到已經在往前跑的${B}。` : `${A}送出直塞給${B}。`,
    cross: `${A}從${lane ? SIDE.zh[lane].replace('側', '路').replace('中路路', '中路') : '邊路'}傳中，找到禁區裡的${B}。`, layoff: `${A}把球回做給${B}。`,
    shot: e.detail === 'header' ? `${A}頭球攻門。` : `${A}射門。`, goal: '球進了。'
  };
  const en = {
    regain: e.detail === 'tackle' ? `${A} wins the ball back with a tackle.` : `${A} intercepts a pass and wins the ball back.`,
    press: `${A} presses ${B} on the ball.`,
    pass: e.detail === 'cutback' ? `${A} cuts the ball back from the ${lane ? SIDE.en[lane] + ' of the' : ''} area to ${B}.`.replace('the  area', 'the area') : e.detail === 'switch' ? `${A} switches play with a long pass to ${B} on the other side.` : /goal kick/.test(e.detail || '') ? `${A} takes the goal kick short to ${B}.` : `${A} passes to ${B}.`,
    carry: `${A} carries the ball forward.`,
    'through-ball': running ? `${A} plays a through ball to ${B}, who is already running.` : `${A} plays a through ball to ${B}.`,
    cross: `${A} crosses from the ${lane ? SIDE.en[lane].replace(' side', '') : 'wing'} to ${B} in the box.`, layoff: `${A} lays the ball off to ${B}.`,
    shot: e.detail === 'header' ? `${A} heads at goal.` : `${A} shoots.`, goal: 'The shot goes in.'
  };
  return (lang === 'zh' ? zh : en)[e.type] || '';
}

const plural = (n, one, many) => n === 1 ? one : many;
// Insert a space between CJK characters and a following/preceding digit or Latin word: "傳給 10 號".
const zhSpace = s => s.replace(/([\u4e00-\u9fff])([0-9A-Za-z#])/g, '$1 $2').replace(/([0-9A-Za-z])([\u4e00-\u9fff])/g, '$1 $2').replace(/ 號/g, ' 號').replace(/(\d) 號/g, '$1 號');
function tidy(o) {
  if (Array.isArray(o)) return o.map(tidy);
  if (o && typeof o === 'object') { const r = {}; for (const [k, v] of Object.entries(o)) r[k] = k === 'zh' && typeof v === 'string' ? zhSpace(v) : tidy(v); return r; }
  return o;
}

function explainPhase(ph, ctx) {
  const { input, N, phases, index } = ctx;
  const next = phases[index + 1];
  const bi = f => ({ zh: f('zh'), en: f('en') });
  const evIds = ph.ballEvents.map(e => e.id);
  const runIds = ph.runs.map(r => r.id);
  const runners = ph.runners.filter(r => r.observed && r.forward);
  const recipientRunning = e => !!e.recipient && input.events.some(r => r.type === 'run' && r.actor === e.recipient && r.t <= e.t && r.t + r.dur >= e.t);
  const sctx = { zone: ctx.zone, running: recipientRunning };
  const story = lang => ph.ballEvents.slice(0, 5).map(e => eventSentence(e, N, lang, sctx)).join(lang === 'zh' ? '' : ' ');
  const runnerLine = lang => runners.length ? (lang === 'zh' ? `同時，${N.list(runners.map(r => r.id), 'zh')}沒有拿球，也在往前跑。` : ` Meanwhile ${N.list(runners.map(r => r.id), 'en')} ${runners.length > 1 ? 'run' : 'runs'} forward without the ball.`) : '';
  const att = input.teams[input.match.attackingTeam].name, def = input.teams[input.match.home === input.match.attackingTeam ? input.match.away : input.match.home].name;
  const defName = { zh: def.zh.replace(/（.*）/, ''), en: def.en.replace(/ \(.*\)/, '') };
  const hiddenDef = ph.unobserved.defenders, hiddenAtt = ph.unobserved.attackers;

  // --- theme: which kind of moment this stage is (decides titles and wording)
  const has = t => ph.ballEvents.some(e => e.type === t);
  const rule = ph.rule.rule;
  const delivery = ph.ballEvents.find(e => ['pass', 'cross', 'through-ball', 'layoff'].includes(e.type) && e.detail !== 'switch');
  const theme = (ph.pressEvents || []).length ? 'press' : has('regain') ? 'regain'
    : ph.kind === 'finish' ? (ph.ballEvents.some(e => e.detail === 'cutback') ? 'cutback' : has('cross') ? 'cross' : 'finish')
    : rule === 'possession-start' ? 'buildup' : rule === 'middle-third-entry' ? 'midfield' : rule === 'switch-of-play' ? 'switch'
    : has('through-ball') ? 'in-behind' : 'final-third';
  const headed = ph.ballEvents.some(e => e.type === 'shot' && e.detail === 'header');
  // --- titles
  const deliveries = ph.ballEvents.filter(e => ['pass', 'through-ball', 'cross', 'layoff'].includes(e.type));
  const TITLES = {
    regain: [{ zh: '搶回球，立刻向前。', en: 'Win it back. Go forward.' }, { zh: '奪回球權', en: 'Win the ball' }],
    press: [{ zh: '前場逼搶，搶回球。', en: 'Press high. Win it back.' }, { zh: '高位逼搶', en: 'High press' }],
    buildup: [{ zh: '從門將開始組織。', en: 'It starts with the keeper.' }, { zh: '門將出球', en: 'From the keeper' }],
    midfield: [{ zh: '把球帶出後場。', en: 'Out of the back.' }, { zh: '帶出後場', en: 'Into midfield' }],
    switch: [{ zh: '一腳轉移到另一側。', en: 'Switch the play.' }, { zh: '大範圍轉移', en: 'Switch' }],
    'in-behind': [{ zh: '把球送到防線身後。', en: 'Play it in behind.' }, { zh: '直塞身後', en: 'In behind' }],
    'final-third': [{ zh: '推進到前場。', en: 'Into the final third.' }, { zh: '進入前場', en: 'Final third' }],
    cutback: [{ zh: '回敲，後插上，完成射門。', en: 'Cutback. Late run. Finish.' }, { zh: '回敲射門', en: 'Cutback & shot' }],
    cross: [headed ? { zh: '傳中，頭球破門。', en: 'Cross. Header. Goal.' } : { zh: '傳中，完成射門。', en: 'Cross and finish.' }, headed ? { zh: '傳中頭球', en: 'Cross & header' } : { zh: '傳中射門', en: 'Cross & shot' }],
    finish: [{ zh: '最後一傳，完成射門。', en: 'Final ball. Finish.' }, { zh: '最後一傳', en: 'Final ball' }]
  };
  const [title, short] = TITLES[theme];
  const sub = bi(l => ph.ballEvents.filter(e => e.type !== 'goal').map(e => `${N.n(e.actor, l)} ${l === 'zh' ? ({ regain: '奪回球權', pass: e.detail === 'switch' ? '轉移' : '傳球', carry: '帶球', 'through-ball': '直塞', shot: e.detail === 'header' ? '頭球' : '射門', cross: '傳中', layoff: '回做', press: '逼搶' })[e.type] : (e.type === 'shot' && e.detail === 'header' ? 'header' : e.detail === 'switch' ? 'switch' : e.type.replace('-', ' '))}`).join(' → '));

  // --- simple rows
  const first = ph.ballEvents[0], sw = (ph.switches || [])[0], swEv = sw && ph.ballEvents.find(e => e.id === sw.eventId);
  const presser = (ph.pressEvents || [])[0], winner = ph.ballEvents.find(e => e.type === 'regain');
  const shooter = ph.ballEvents.find(e => e.type === 'shot');
  const offer = {
    press: presser && winner && bi(l => l === 'zh' ? `${N.n(presser.actor, 'zh')}上前逼搶，${N.n(winner.actor, 'zh')}${ph.zoneEnd.third === 'final' ? '在前場' : ''}搶回球權。搶回球的地方${ph.zoneEnd.third === 'final' ? '已經離對方球門很近' : '在' + ZONE.zh(ph.zoneEnd)}。` : `${N.n(presser.actor, 'en')} presses and ${N.n(winner.actor, 'en')} wins the ball back${ph.zoneEnd.third === 'final' ? ' high up the pitch, already close to the opponent\'s goal' : ''}.`),
    buildup: bi(l => l === 'zh' ? '門將沒有把球大腳踢遠，而是短傳給後方隊友。球隊先在自己半場保住球，再一步一步往前傳。' : 'Instead of kicking it long, the keeper passes short. The team keeps the ball in its own half and moves it forward one pass at a time.'),
    midfield: bi(l => l === 'zh' ? `${N.n(first.actor, 'zh')}把球從後場帶進球場中段，下一次傳球就能從更前面的位置出發。` : `${N.n(first.actor, 'en')} takes the ball out of the defensive third, so the next pass starts from further up the pitch.`),
    switch: sw ? bi(l => l === 'zh' ? `轉移就是把球從球場一側傳到另一側。傳球當下，原本那一側附近看得到 ${sw.nearOld} 名${defName.zh}球員，新的一側只有 ${sw.nearNew} 名${sw.nearNew < sw.nearOld ? '，球到了對手比較少的地方' : ''}。` : `A switch moves the ball from one side of the pitch to the other. At the moment of the pass, ${sw.nearOld} visible ${defName.en} ${plural(sw.nearOld, 'player is', 'players are')} near the old side and ${sw.nearNew} near the new side${sw.nearNew < sw.nearOld ? ', so the ball reaches the less crowded side' : ''}.`) : { zh: '球從一側轉到另一側。', en: 'The ball moves from one side to the other.' },
    cross: shooter && bi(l => l === 'zh' ? `傳中就是從邊路把球送進禁區。這一球找到禁區裡的${N.n(shooter.actor, 'zh')}，${headed ? `由${N.n(shooter.actor, 'zh')}用頭把球頂向球門` : `由${N.n(shooter.actor, 'zh')}射門`}。` : `A cross sends the ball from the wing into the penalty area. This one finds ${N.n(shooter.actor, 'en')}, who ${headed ? 'heads it at goal' : 'shoots'}.`),
    finish: shooter && bi(l => l === 'zh' ? `最後一傳交給${N.n(shooter.actor, 'zh')}，${N.n(shooter.actor, 'zh')}完成射門。` : `The final pass reaches ${N.n(shooter.actor, 'en')}, who shoots.`),
    regain: {
      zh: ph.retreatingDefenders.length >= 3 ? `奪回球權後的這幾秒，畫面中多名${defName.zh}球員往自己球門方向移動。趁他們還在回跑時向前推進，比較有機會在對手站好位置之前把球帶到前面。` : `奪回球權後立刻向前，讓進攻在對手調整之前展開。`,
      en: ph.retreatingDefenders.length >= 3 ? `In the seconds after the regain, several visible ${defName.en} players move toward their own goal. Pushing forward while they are still running back gives a chance to advance before they are set.` : `Going forward right after the regain starts the attack before the opponent adjusts.`
    },
    'final-third': null,
    progression: (() => { const b = (ph.bypassed.find(x => x.defenders.length) || { defenders: [] }).defenders.length;
      const key = ph.ballEvents.find(e => ['pass', 'through-ball', 'cross'].includes(e.type));
      const run = key && recipientRunning(key), fin = ph.zoneEnd.third === 'final';
      const zh = (b ? `這一傳越過畫面中 ${b} 名${defName.zh}球員，` : '這一傳') + (run ? '直接交給已經在跑的隊友' : '交給隊友') + (fin ? '，球到了前場。' : '。');
      const en = (b ? `This pass travels past ${b} visible ${defName.en} ${plural(b, 'player', 'players')} ` : 'The pass goes ') + (run ? 'to a teammate who is already running' : 'to a teammate') + (fin ? ', taking the attack into the final third.' : '.');
      return { zh, en }; })(),
    cutback: { zh: '回敲把球從禁區深處往回送，交給從後面跟上來的隊友射門。', en: 'The cutback moves the ball back from deep in the area to a teammate arriving from behind, who shoots.' }
  };
  const offerFor = offer[theme] || offer.progression;
  const changes = ph.goal
    ? { zh: `球進了：${att.zh.replace(/（.*）/, '')} ${input.match.scoreAfter[0]}–${input.match.scoreAfter[1]}。`, en: `Goal: ${att.en.replace(/ \(.*\)/, '')} ${input.match.scoreAfter[0]}–${input.match.scoreAfter[1]}.` }
    : bi(l => {
      const nx = next && next.ballEvents[0];
      const where = ZONE[l](ph.zoneEnd);
      return l === 'zh' ? `這段結束時，球在${where}${nx ? `，接下來由${N.n(nx.actor, 'zh')}決定下一步` : ''}。` : `At the end of this stage the ball is in ${where}${nx ? `; ${N.n(nx.actor, 'en')} makes the next decision` : ''}.`;
    });
  const simple = [
    { kind: 'observation', label: { zh: '發生什麼', en: 'What happened' }, text: bi(l => story(l) + runnerLine(l)), refs: evIds.concat(runners.length ? runIds : []) },
    { kind: 'interpretation', label: { zh: '有什麼作用', en: 'What it offers' }, text: offerFor, refs: evIds },
    { kind: 'outcome', label: { zh: '接著改變什麼', en: 'What changes' }, text: changes, refs: evIds.slice(-1) }
  ];

  // --- deep rows (observation with counts that the data supports, inference with caveat, unknowns)
  const obs = bi(l => {
    const parts = [story(l)];
    if (l === 'zh') {
      parts.push(`開始時，畫面中位於球前方（靠近${defName.zh}球門）的${defName.zh}球員有 ${ph.defendersAheadStart} 人；結束時有 ${ph.defendersAheadEnd} 人。`);
      if (ph.retreatingDefenders.length) parts.push(`這段期間，可見範圍內有 ${ph.retreatingDefenders.length} 名${defName.zh}球員往自己球門方向移動。`);
    } else {
      parts.push(` At the start, ${ph.defendersAheadStart} visible ${defName.en} ${plural(ph.defendersAheadStart, 'player is', 'players are')} ahead of the ball (closer to their goal); at the end, ${ph.defendersAheadEnd}.`);
      if (ph.retreatingDefenders.length) parts.push(` During the stage, ${ph.retreatingDefenders.length} visible ${defName.en} ${plural(ph.retreatingDefenders.length, 'player moves', 'players move')} toward their own goal.`);
    }
    return parts.join('');
  });
  const coLines = l => {
    const pairs = runners.filter(r => r.coMoving.length);
    if (!pairs.length) return '';
    const list = pairs.map(r => l === 'zh' ? `${N.n(r.id, 'zh')}（鄰近：${N.n(r.coMoving[0], 'zh')}）` : `${N.n(r.id, 'en')} (nearby: ${N.n(r.coMoving[0], 'en')})`);
    return l === 'zh'
      ? `無球跑動時，鄰近的防守者也朝同一方向移動：${list.join('、')}。資料只顯示同時移動，不能證明防守者是被跑動吸引。`
      : `During the off-ball runs, a nearby defender moved the same way: ${list.join(', ')}. The data shows simultaneous movement only; it does not prove the defenders were drawn by the runs.`;
  };
  const runnerNames = l => N.list(runners.map(r => r.id), l);
  const chain = ph.ballEvents.flatMap(e => [e.actor, e.recipient]).filter(Boolean).filter((v, i, a) => a[i - 1] !== v);
  const interp = {
    press: { zh: `在對手半場搶回球，代表離球門的距離很短。${coLines('zh')}`, en: `Winning the ball in the opponent's half means the goal is close. ${coLines('en')}` },
    buildup: { zh: `短傳組織讓球權留在己方，這段的傳球順序是${chain.map(id => N.n(id, 'zh')).join(' → ')}。這只描述這一次的順序，不代表這種組織每次都會成功。${coLines('zh')}`, en: `Short build-up keeps the ball; the passing order here is ${chain.map(id => N.n(id, 'en')).join(' → ')}. This describes one sequence only and does not mean this build-up always works. ${coLines('en')}` },
    midfield: { zh: `把球帶進中段，讓進攻的起點往前移。${runners.length ? `同時，${runnerNames('zh')}在無球狀態下往前移動。` : ''}${coLines('zh')}`, en: `Bringing the ball into midfield moves the starting point of the attack forward. ${runners.length ? `Meanwhile ${runnerNames('en')} ${runners.length > 1 ? 'move' : 'moves'} forward without the ball. ` : ''}${coLines('en')}` },
    switch: { zh: `以轉移當下看得到的球員計算，球從${sw ? sw.nearOld : '?'} 名對手附近的一側，移到只有 ${sw ? sw.nearNew : '?'} 名的一側。畫面外的對手不在計算內。${coLines('zh')}`, en: `Counting only players visible at the moment of the pass, the ball moves from a side with ${sw ? sw.nearOld : '?'} opponents nearby to a side with ${sw ? sw.nearNew : '?'}. Opponents outside the view are not counted. ${coLines('en')}` },
    'final-third': { zh: `${runners.length ? `進入前場時，${runnerNames('zh')}同時往禁區跑，提供了不同的接應位置。` : '球進入前場。'}${coLines('zh')}`, en: `${runners.length ? `As the ball enters the final third, ${runnerNames('en')} ${runners.length > 1 ? 'run' : 'runs'} toward the box, offering different receiving positions. ` : 'The ball reaches the final third. '}${coLines('en')}` },
    cross: { zh: `得分機會來自邊路傳中${ph.arrivals.length ? `，以及${N.list(ph.arrivals.map(a => a.playerId), 'zh')}從第 ${phases.findIndex(p => p.id === ph.arrivals[0].sincePhase) + 1} 階段就開始的前插` : ''}。${runners.length ? `${runnerNames('zh')}也同時跑向禁區。` : ''}這是可觀察的配合順序，不是射門品質評分。`, en: `The chance combines a cross from the wing${ph.arrivals.length ? ` with a forward run by ${N.list(ph.arrivals.map(a => a.playerId), 'en')} that began in stage ${phases.findIndex(p => p.id === ph.arrivals[0].sincePhase) + 1}` : ''}. ${runners.length ? `${runnerNames('en')} ${runners.length > 1 ? 'also run' : 'also runs'} into the box. ` : ''}This is an observable sequence, not a shot-quality score.` },
    regain: { zh: `快速轉換的價值在於對手回位前推進。${coLines('zh')}`, en: `The value of a quick transition is advancing before the opponent recovers. ${coLines('en')}` },
    'in-behind': { zh: `直塞送到跑動中隊友的路線上，資料中接球與接下來的帶球推進幾乎連成一個動作。${coLines('zh')}`, en: `The through ball is played into a runner’s path; in the data, the reception and the following carry form almost one continuous action. ${coLines('en')}` },
    cutback: { zh: `射門機會來自禁區內的回敲，以及${ph.arrivals.length ? `${N.list(ph.arrivals.map(a => a.playerId), 'zh')}從第 ${phases.findIndex(p => p.id === ph.arrivals[0].sincePhase) + 1} 階段就開始的前插` : '後方隊友的跟進'}。這是可觀察的配合順序，不是射門品質評分。`, en: `The chance combines a cutback from inside the area with ${ph.arrivals.length ? `a forward run by ${N.list(ph.arrivals.map(a => a.playerId), 'en')} that began in stage ${phases.findIndex(p => p.id === ph.arrivals[0].sincePhase) + 1}` : 'support arriving from behind'}. This is an observable sequence, not a shot-quality score.` }
  };
  const lastPass = [...ph.ballEvents].reverse().find(e => ['pass', 'through-ball', 'layoff'].includes(e.type) && N.byId[e.actor].team === N.att);
  interp.finish = { zh: `射門機會來自${lastPass ? N.n(lastPass.actor, 'zh') + '的最後一傳' : '最後一傳'}${ph.arrivals.length ? `，以及${N.list(ph.arrivals.map(a => a.playerId), 'zh')}從第 ${phases.findIndex(p => p.id === ph.arrivals[0].sincePhase) + 1} 階段就開始的跑動` : ''}。${runners.length ? `${runnerNames('zh')}也同時往前跑。` : ''}這是可觀察的配合順序，不是射門品質評分。`, en: `The chance comes from ${lastPass ? 'the final pass by ' + N.n(lastPass.actor, 'en') : 'the final pass'}${ph.arrivals.length ? ` and a run by ${N.list(ph.arrivals.map(a => a.playerId), 'en')} that began in stage ${phases.findIndex(p => p.id === ph.arrivals[0].sincePhase) + 1}` : ''}. ${runners.length ? `${runnerNames('en')} ${runners.length > 1 ? 'also run' : 'also runs'} forward. ` : ''}This is an observable sequence, not a shot-quality score.` };
  const interpFor = interp[theme] || interp['final-third'];
  const unknownRow = {
    kind: hiddenDef.length || hiddenAtt.length ? 'unknown' : 'limit',
    label: { zh: '未知與限制', en: 'Unknowns & limits' },
    text: bi(l => {
      const hidden = [...hiddenAtt, ...hiddenDef];
      const a = hidden.length
        ? (l === 'zh' ? `這段有 ${hidden.length} 名球員在模擬鏡頭外（${N.list(hidden, 'zh')}），位置未知，以上判讀沒有把他們算進去。` : `${hidden.length} players are outside the simulated camera view in this stage (${N.list(hidden, 'en')}). Their positions are unknown and are not included above.`)
        : (l === 'zh' ? '這段所有球員都在模擬鏡頭內。' : 'All players are inside the simulated camera view in this stage.');
      return a + (l === 'zh' ? '這是合成資料，不代表任何真實球隊或球員的意圖。' : ' This is synthetic data and says nothing about any real team or player’s intent.');
    })
  };
  const deep = [
    { kind: 'observation', label: { zh: '觀察', en: 'Observation' }, text: obs, refs: evIds },
    { kind: 'interpretation', label: { zh: '戰術解讀', en: 'Interpretation' }, text: { zh: interpFor.zh.trim(), en: interpFor.en.trim() }, refs: evIds.concat(runners.filter(r => r.coMoving.length).map(r => ph.runs.find(x => x.actor === r.id).id)) },
    unknownRow
  ];

  // --- insight: always about a contribution other than the goal or assist when one exists
  const regainEv = ph.ballEvents.find(e => e.type === 'regain');
  const featured = ctx.featured || new Set();
  const decoy = runners.find(r => !r.laterTouchEventId && !featured.has(r.id));
  const special = theme === 'press' ? bi(l => l === 'zh' ? `記住${N.n(presser.actor, 'zh')}：這次逼搶之後，隊友就在前場搶回了球。` : `Remember ${N.n(presser.actor, 'en')}: right after that press, a teammate wins the ball high up.`)
    : theme === 'buildup' ? bi(l => l === 'zh' ? `記住${N.n(first.actor, 'zh')}：這次進攻從${N.n(first.actor, 'zh')}的短傳開始。` : `Remember ${N.n(first.actor, 'en')}: this attack starts with that short pass.`)
    : theme === 'switch' && swEv ? bi(l => l === 'zh' ? `看${N.n(swEv.actor, 'zh')}：一腳把球轉到另一側${sw.nearNew < sw.nearOld ? '，對手比較少的那一側' : ''}。` : `Watch ${N.n(swEv.actor, 'en')}: one pass moves the ball to the other side${sw.nearNew < sw.nearOld ? ', where there are fewer opponents' : ''}.`)
    : theme === 'midfield' ? bi(l => l === 'zh' ? `看${N.n(first.actor, 'zh')}：把球從後場帶進中段的人。` : `Watch ${N.n(first.actor, 'en')}: the player who brings the ball out of the back.`) : null;
  const insight = special || (regainEv
    ? bi(l => l === 'zh' ? `記住${N.n(regainEv.actor, 'zh')}：沒有進球或助攻，但這次反擊從${N.n(regainEv.actor, 'zh')}的搶斷開始。` : `Remember ${N.n(regainEv.actor, 'en')}: no goal or assist, but the counterattack starts with that interception.`)
    : decoy
      ? bi(l => l === 'zh' ? `看${N.n(decoy.id, 'zh')}：整段沒有碰到球，但一直在往前跑。` : `Watch ${N.n(decoy.id, 'en')}: never touches the ball here, but keeps running forward.`)
      : ph.arrivals.length
        ? bi(l => { const p = N.n(ph.arrivals[0].playerId, l), k = phases.findIndex(x => x.id === ph.arrivals[0].sincePhase) + 1; return l === 'zh' ? `${headed ? '頭球' : '射門'}的是${p}。在${headed ? '頭球' : '射門'}之前，${p}從第 ${k} 階段就開始往前跑。` : `${p} ${headed ? 'heads it in' : 'takes the shot'}, after a forward run that started in stage ${k}.`; })
        : { zh: '別只看持球的人。', en: 'Look beyond the ball carrier.' });
  [regainEv && regainEv.actor, decoy && !regainEv && !special ? decoy.id : null].filter(Boolean).forEach(id => featured.add(id));
  const evidence = bi(l => {
    const ids = [...evIds, ...runIds];
    return l === 'zh'
      ? `合成事件 ${ids.join('、')}；位置來自合成輸入檔，每 0.5 秒一筆，鏡頭外為 null。分段規則：${ph.rule.zh}。`
      : `Synthetic events ${ids.join(', ')}. Positions come from the synthetic input, sampled every 0.5 s; off-camera positions are null. Segmentation rule: ${ph.rule.en}.`;
  });
  return tidy({ title, short, sub, simple, deep, insight, evidence });
}

function explainSummary(interp, ctx) {
  const { input, N } = ctx;
  const att = input.match.attackingTeam;
  const order = [];
  const roles = {};
  const add = (id, zh, en, tag, phaseId) => { if (N.byId[id].team !== att) return; if (!roles[id]) { roles[id] = { zh: [], en: [], tags: [], phases: new Set() }; order.push(id); } if (!roles[id].zh.includes(zh)) { roles[id].zh.push(zh); roles[id].en.push(en); roles[id].tags.push(tag); } roles[id].phases.add(phaseId); };
  for (const ph of interp.phases) {
    for (const e of ph.ballEvents) {
      const B = e.recipient ? { zh: N.n(e.recipient, 'zh'), en: N.n(e.recipient, 'en') } : null;
      const map = { regain: ['搶回球權', 'wins the ball back', 'WIN'], press: [`上前逼搶${B && B.zh}`, `presses ${B && B.en}`, 'PRESS'], cross: [`傳中給${B && B.zh}`, `crosses to ${B && B.en}`, 'DELIVER'], pass: e.detail === 'switch' ? [`把球轉移到另一側給${B && B.zh}`, `switches play to ${B && B.en}`, 'SWITCH'] : /goal kick/.test(e.detail || '') ? [`短傳開球給${B && B.zh}`, `plays the goal kick short to ${B && B.en}`, 'START'] : e.detail === 'cutback' ? [`回敲給${B && B.zh}`, `cuts the ball back to ${B && B.en}`, 'DELIVER'] : [`傳球給${B && B.zh}`, `passes to ${B && B.en}`, 'CONNECT'], carry: ['帶球推進', 'carries the ball forward', 'CARRY'], 'through-ball': [`直塞找到${B && B.zh}`, `plays ${B && B.en} in behind`, 'UNLOCK'], shot: e.detail === 'header' ? ['頭球破門', 'scores with a header', 'FINISH'] : ['完成射門', 'takes the shot', 'FINISH'] }[e.type];
      if (map) add(e.actor, map[0], map[1], map[2], ph.id);
    }
    for (const r of ph.runners.filter(r => r.observed && r.forward)) {
      if (roles[r.id] && roles[r.id].tags.includes('RUN')) { roles[r.id].phases.add(ph.id); continue; } // one run entry per player
      const co = r.coMoving.length ? { zh: `（鄰近的${N.n(r.coMoving[0], 'zh')}同時朝同方向移動，不代表因果）`, en: ` (the nearby ${N.n(r.coMoving[0], 'en')} moved the same way at the same time; not proof of cause)` } : { zh: '', en: '' };
      add(r.id, `無球向前跑${co.zh}`, `runs forward without the ball${co.en}`, 'RUN', ph.id);
    }
  }
  const cards = order.map((id, i) => {
    const r = roles[id];
    const touched = r.tags.some(t => t !== 'RUN');
    const PRIORITY = ['FINISH', 'DELIVER', 'UNLOCK', 'SWITCH', 'WIN', 'PRESS', 'START', 'CARRY', 'CONNECT', 'RUN'];
    const tag = PRIORITY.find(t => r.tags.includes(t));
    return {
      tag: `${String(i + 1).padStart(2, '0')} / ${tag}`,
      title: { zh: N.byId[id].name.zh, en: N.byId[id].name.en },
      text: { zh: r.zh.join('；') + (touched ? '。' : '；全程沒有碰到球。'), en: r.en.join('; ').replace(/^./, c => c.toUpperCase()) + (touched ? '.' : '; never touches the ball.') },
      playerIds: [id], phaseIds: [...r.phases]
    };
  });
  return tidy({
    title: { zh: '進球背後，還有這些貢獻。', en: 'More than a name on the scoresheet.' },
    intro: { zh: '以下根據合成事件與位置整理，每張卡都能對回事件編號。這是角色描述，不是功勞排名。', en: 'Built from the synthetic events and positions; every card traces back to event IDs. These are roles, not a ranking of credit.' },
    cards
  });
}

function explainTemplate(input, interp) {
  const N = makeNames(input);
  const ctx = { input, N, phases: interp.phases, zone: require('./interpret.cjs').zone, featured: new Set() };
  return {
    mode: 'offline-template',
    model: null,
    phases: interp.phases.map((ph, index) => ({ id: ph.id, ...explainPhase(ph, { ...ctx, index }) })),
    summary: explainSummary(interp, ctx)
  };
}
module.exports = { explainTemplate, makeNames };
