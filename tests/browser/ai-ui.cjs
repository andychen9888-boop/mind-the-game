const { chromium } = require(process.env.PW_CORE || 'playwright-core');
(async()=>{const b=await chromium.launch({channel:'chrome'});let fails=0;const ok=(n,c,i='')=>{console.log(c?'PASS':'FAIL',n,i);if(!c)fails++};
for(const [url,expect] of [['http://127.0.0.1:8000/','static'],['http://127.0.0.1:8001/','unconfigured'],['http://127.0.0.1:8002/','ready'],['file://'+require('path').resolve(__dirname,'../../app/index.html'),'static']]){
 const p=await b.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));await p.goto(url+'#case=synthetic-counter-01');await p.waitForFunction(()=>window.MTG.getAI().state!=='checking',null,{timeout:5000});
 const st=await p.evaluate(()=>window.MTG.getAI().state);ok(`${url} state`,st===expect,st+' '+(await p.textContent('#aiStatus')));
 await p.click('#aboutBtn');const btn=await p.$('#aiRegenerate');ok(`${url} regenerate button only when ready`,!!btn===(expect==='ready'));
 if(btn){await btn.click();await p.waitForFunction(()=>window.MTG.case.generation.explanations==='ai-generated',null,{timeout:10000});ok('regenerated case is AI-labelled',true);
  await p.click('#aboutDialog [data-close]');const note=await p.evaluate(()=>{document.getElementById('evidence').open=true;return document.querySelector('.gen-note').textContent});ok('evidence shows AI + model',/AI 生成.*mock-deploy/.test(note),note);
  ok('AI title shown',(await p.textContent('#lessonTitle')).includes('模擬模型'));
  await p.click('#aboutBtn');await p.screenshot({path:require('os').tmpdir()+'/mtg-ai-ready-about.png'});}
 if(url.startsWith('file'))ok('file:// works with two cases',await p.evaluate(()=>window.MTG.cases.length===2));
 ok(`${url} no errors`,!errs.length,errs.join('|'));await p.close()}
await b.close();console.log(fails?`${fails} failed`:'all passed');process.exit(fails?1:0)})();
