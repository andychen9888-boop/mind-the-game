'use strict';
// Exercises the AI agent loop with a mocked OpenAI-compatible endpoint (no network, no key).
// It proves the control flow and guards. It does NOT prove a real Foundry deployment works.
const path=require('node:path');const assert=require('node:assert/strict');const root=path.resolve(__dirname,'..');
const {ingest}=require(root+'/scripts/pipeline/ingest.cjs');const {interpret}=require(root+'/scripts/pipeline/interpret.cjs');
const {explainWithAI}=require(root+'/scripts/pipeline/explain-ai.cjs');const {explainTemplate}=require(root+'/scripts/pipeline/explain-template.cjs');
const i=ingest(root+'/data/synthetic/counter-01.input.json');const r=interpret(i);const good=explainTemplate(i,r);
const bad=JSON.parse(JSON.stringify(good));bad.phases[0].simple[0].text.en+=' He sprinted at 31 km/h.';
const env={MTG_AI_BASE_URL:'https://mock.invalid/openai/v1',MTG_AI_API_KEY:'test-key',MTG_AI_MODEL:'mock-deploy'};
function mock(seq){const calls=[];const f=async(url,opt)=>{const b=JSON.parse(opt.body);calls.push({url,hdr:opt.headers,schema:b.response_format.json_schema.name,model:b.model});const next=seq.shift();const content=JSON.stringify(next);return {ok:true,status:200,text:async()=>JSON.stringify({model:'mock-deploy',choices:[{message:{content}}]})}};f.calls=calls;return f}
(async()=>{
 const strip=x=>({phases:x.phases,summary:x.summary});
 let f=mock([strip(good),{issues:[]}]);let x=await explainWithAI(i,r,{env,fetchImpl:f});
 assert.equal(x.mode,'ai-rewritten');assert.equal(f.calls[0].url,'https://mock.invalid/openai/v1/chat/completions');assert(f.calls[0].hdr['api-key']);console.log('A clean:',x.mode,JSON.stringify(x.aiAttempt),'calls',f.calls.map(c=>c.schema).join('>'),'url',f.calls[0].url,'auth',Object.keys(f.calls[0].hdr).join(','));
 f=mock([strip(bad),{issues:[{phaseId:'p1',quote:'31 km/h',reason:'speed not in facts'}]},strip(good),{issues:[]}]);x=await explainWithAI(i,r,{env,fetchImpl:f});
 assert.equal(x.mode,'ai-rewritten');assert.deepEqual(x.aiAttempt.steps,['explainer','reviewer','revision','reviewer']);console.log('B revised:',x.mode,JSON.stringify(x.aiAttempt),'calls',f.calls.map(c=>c.schema).join('>'));
 f=mock([strip(bad),{issues:[]},strip(bad)]);x=await explainWithAI(i,r,{env,fetchImpl:f});
 assert.equal(x.mode,'offline-template');assert.equal(x.aiAttempt.status,'rejected');console.log('C rejected:',x.mode,JSON.stringify(x.aiAttempt));
 const causal=JSON.parse(JSON.stringify(good));causal.phases[2].insight.en='#8 scored because the defender was fooled.';
 f=mock([strip(causal),{issues:[{phaseId:'p3',quote:'fooled',reason:'intent'}]},strip(causal),{issues:[{phaseId:'p3',quote:'fooled',reason:'still unsupported'}]}]);x=await explainWithAI(i,r,{env,fetchImpl:f});
 assert.equal(x.mode,'offline-template');assert.equal(x.aiAttempt.status,'rejected');assert(x.aiAttempt.reasons[0].startsWith('reviewer'));console.log('E revision re-reviewed and rejected:',JSON.stringify(x.aiAttempt));
 const origErr=console.error;console.error=()=>{};
 const err=async()=>({ok:false,status:401,text:async()=>'{"error":"unauthorized for deployment secret-resource-eastus"}'});x=await explainWithAI(i,r,{env,fetchImpl:err});
 assert.equal(x.mode,'offline-template');assert.equal(x.aiAttempt.status,'error');assert(!JSON.stringify(x.aiAttempt).includes('secret-resource'),'provider body leaked');console.error=origErr;console.log('D http error:',x.mode,JSON.stringify(x.aiAttempt));
// F: rate limit then success; the call is retried with the Retry-After hint
 const {chat}=require(root+'/scripts/pipeline/explain-ai.cjs');let n=0;const waits=[];
 const rl=async()=>(++n<3?{ok:false,status:429,headers:{get:k=>k==='retry-after'?'7':null},text:async()=>'{}'}:{ok:true,status:200,text:async()=>JSON.stringify({model:'m',choices:[{message:{content:'{"issues":[]}'}}]})});
 console.error=()=>{};const out=await chat({base:'https://mock.invalid/openai/v1',key:'k',model:'m'},[],'mtg_review',{},rl,{sleepImpl:async ms=>waits.push(ms)});console.error=origErr;
 assert.deepEqual(out.data,{issues:[]});assert.deepEqual(waits,[7000,7000]);console.log('F rate limit retried:',n,'calls, waits',waits);
 console.log('PASS mocked AI loop (6 scenarios)');})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
