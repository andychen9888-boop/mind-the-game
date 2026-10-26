// Browser regression test for Mind the Game. Usage: node regress.cjs [url] [shotDir]
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const url = process.argv[2] || 'http://127.0.0.1:8000/';
const shotDir = process.argv[3] || require('os').tmpdir();
const results = []; const ok = (name, cond, info='') => { results.push([cond?'PASS':'FAIL', name, info]); };
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  async function fastSpeed(page){ await page.evaluate(()=>{const s=document.getElementById('speed');const o=document.createElement('option');o.value='6';o.textContent='6x';s.appendChild(o);s.value='6';s.dispatchEvent(new Event('change'));}); }
  const st = page => page.evaluate(()=>window.MTG.getState());
  async function waitStop(page, ms=8000){ await page.waitForFunction(()=>{const s=window.MTG.getState();return !s.playing && s.progress>=1}, null, {timeout:ms}); }
  const caseIds = await (async()=>{ const p = await browser.newPage(); await p.goto(url); const ids = await p.evaluate(()=>window.MTG.cases?window.MTG.cases.map(c=>c.caseId):[null]); await p.close(); return ids; })();
  for (const cid of caseIds) {
    const tag = cid || 'default';
    const page = await browser.newPage({ viewport:{width:1366,height:900} });
    page.on('pageerror', e => errors.push(tag+': '+e.message));
    page.on('console', m => { if (m.type()==='error') errors.push(tag+' console: '+m.text()); });
    await page.goto(url + (cid ? '#case=' + cid : ''));
    if (cid) await page.waitForFunction(id=>window.MTG.getState().caseId===id, cid, {timeout:5000});
    const n = await page.evaluate(()=>window.MTG.phases.length);
    ok(`[${tag}] loads with phases`, n>0, `n=${n}`);
    await fastSpeed(page);
    // Stage pause
    await page.click('#play'); await waitStop(page);
    const s0 = await st(page); await page.waitForTimeout(700); const s0b = await st(page);
    ok(`[${tag}] stage 1 stops and stays`, s0.stage===0 && s0b.stage===0 && !s0b.playing);
    const railCount = await page.locator('#phaseRail button').count(); ok(`[${tag}] rail matches phases`, railCount===n, `${railCount}`);
    const label = await page.textContent('#stageLabel'); ok(`[${tag}] stage label uses phase count`, label.includes(String(n).padStart(2,'0')), label);
    // step through all stages via next
    for (let i=1;i<n;i++){ await page.click('#next'); await waitStop(page); const s=await st(page); ok(`[${tag}] next → stage ${i+1} stops`, s.stage===i && !s.playing); }
    const nextTxt = await page.textContent('#next'); ok(`[${tag}] last stage next = summary`, /貢獻|contribution/i.test(nextTxt), nextTxt);
    await page.click('#next'); await page.waitForTimeout(200);
    ok(`[${tag}] summary opens`, await page.evaluate(()=>document.getElementById('summaryDialog').open));
    const cards = await page.locator('#contributions .contribution').count(); ok(`[${tag}] summary cards`, cards>0, `${cards}`);
    await page.screenshot({path:`${shotDir}/${tag}-summary.png`});
    await page.click('#backToReplay');
    // previous
    await page.click('#previous'); ok(`[${tag}] previous`, (await st(page)).stage===n-2);
    // language & mode keep stage
    const before = await st(page); await page.click('#language'); await page.click('#deepMode'); const after = await st(page);
    ok(`[${tag}] lang/mode keep stage`, before.stage===after.stage && after.lang!==before.lang && after.mode==='deep');
    await page.click('#language');
    // scrubber
    await page.evaluate(()=>{const s=document.getElementById('scrubber');s.value=500;s.dispatchEvent(new Event('input'))});
    const sc = await st(page); ok(`[${tag}] scrubber`, Math.abs(sc.progress-0.5)<0.01 && !sc.playing);
    // full continuous replay
    await page.click('#fullReplay');
    await page.waitForFunction(()=>document.getElementById('summaryDialog').open, null, {timeout: 30000}).then(()=>ok(`[${tag}] continuous reaches summary`, true)).catch(()=>ok(`[${tag}] continuous reaches summary`, false));
    await page.click('#backToReplay');
    // focus chip
    const chips = await page.locator('#focusChips button').count();
    if (chips>1){ await page.locator('#focusChips button').nth(1).click(); ok(`[${tag}] focus chip`, (await st(page)).focus!=='all'); }
    // keyboard: focus a player node and press Enter
    await page.locator('#players [role=button]').first().focus(); await page.keyboard.press('Enter');
    ok(`[${tag}] keyboard focus player`, (await st(page)).focus!=='all');
    // keyboard regressions from the 2026-10-25 review
    await page.evaluate(()=>{const s=document.getElementById('scrubber');s.value=0;s.dispatchEvent(new Event('input'))});
    const visibleNode = page.locator('#players [role=button]:not([visibility=hidden])').first();
    await visibleNode.focus(); await page.keyboard.press('Space');
    ok(`[${tag}] Space on avatar does not start playback`, !(await st(page)).playing);
    await page.focus('#evidence summary'); await page.keyboard.press('Space');
    ok(`[${tag}] Space opens evidence`, await page.evaluate(()=>document.getElementById('evidence').open) && !(await st(page)).playing);
    await page.locator('#phaseRail button').nth(1).focus(); await page.keyboard.press('Enter');
    ok(`[${tag}] focus stays on phase tab`, await page.evaluate(()=>document.activeElement && document.activeElement.dataset.stage==='1'));
    await page.click('#simpleMode'); await page.focus('#simpleMode'); await page.keyboard.press('ArrowRight');
    ok(`[${tag}] arrow key switches tab`, (await st(page)).mode==='deep' && await page.evaluate(()=>document.activeElement.id==='deepMode'));
    ok(`[${tag}] dialogs are named`, await page.evaluate(()=>[...document.querySelectorAll('dialog')].every(d=>d.getAttribute('aria-labelledby'))));
    await page.click('#viewToggle'); await page.evaluate(()=>{const s=document.getElementById('scrubber');s.value=700;s.dispatchEvent(new Event('input'))});
    const tilt = await page.evaluate(()=>({on:document.getElementById('pitch').classList.contains('tilt'),marks:document.querySelectorAll('#pitchTilt path').length,flatHidden:getComputedStyle(document.getElementById('pitchFlat')).display==='none',pressed:document.getElementById('viewToggle').getAttribute('aria-pressed')}));
    ok(`[${tag}] tilted view renders`, tilt.on && tilt.marks > 5 && tilt.flatHidden && tilt.pressed==='true', JSON.stringify(tilt));
    await page.click('#viewToggle');
    ok(`[${tag}] back to top-down view`, await page.evaluate(()=>!document.getElementById('pitch').classList.contains('tilt') && getComputedStyle(document.getElementById('pitchFlat')).display!=='none'));
    ok(`[${tag}] hash matches case`, cid ? await page.evaluate(id=>location.hash==='#case='+id, cid) : true);
    await page.screenshot({path:`${shotDir}/${tag}-desktop.png`});
    // mobile
    await page.setViewportSize({width:390,height:844}); await page.waitForTimeout(200);
    const overflow = await page.evaluate(()=>document.documentElement.scrollWidth - window.innerWidth);
    ok(`[${tag}] 390px no horizontal overflow`, overflow<=0, `overflow=${overflow}`);
    await page.screenshot({path:`${shotDir}/${tag}-mobile.png`, fullPage:true});
    await page.close();
  }
  ok('no JS errors', errors.length===0, errors.join(' | '));
  await browser.close();
  for (const r of results) console.log(r.join('  '));
  const fails = results.filter(r=>r[0]==='FAIL').length; console.log(`\n${results.length-fails}/${results.length} passed`); process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(2)});
