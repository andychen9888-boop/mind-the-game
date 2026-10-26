// Local OpenAI-compatible mock: returns the offline template as the "model" output (test only).
const http=require('http');const root=process.argv[2]||require('path').resolve(__dirname,'../..');
const {ingest}=require(root+'/scripts/pipeline/ingest.cjs');const {interpret}=require(root+'/scripts/pipeline/interpret.cjs');const {explainTemplate}=require(root+'/scripts/pipeline/explain-template.cjs');
const i=ingest(root+'/data/synthetic/counter-01.input.json');const ex=explainTemplate(i,interpret(i));
http.createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{const j=JSON.parse(b);const ok=req.headers['api-key']==='mock-key';const name=j.response_format.json_schema.name;
const content=name==='mtg_review'?{issues:[]}:{phases:ex.phases.map(p=>({...p,title:{zh:'[模擬模型] '+p.title.zh,en:'[mock model] '+p.title.en}})),summary:ex.summary};
res.writeHead(ok?200:401,{'content-type':'application/json'});res.end(JSON.stringify(ok?{model:j.model,choices:[{message:{content:JSON.stringify(content)}}]}:{error:'bad key'}))})}).listen(8099,'127.0.0.1');
