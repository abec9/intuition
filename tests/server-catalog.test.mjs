import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {catalogFixture} from './catalog-fixture.mjs';

test('HTTP catalog flow starts without LLM, hides dossiers and survives an unfinished file update',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'intuition-server-')),file=join(dir,'professions.json');
  await writeFile(file,JSON.stringify(catalogFixture()));
  let modelCalls=0;
  const model=http.createServer(async(req,res)=>{
    modelCalls++;
    res.setHeader('Content-Type','application/json');
    if(req.url==='/api/v0/models'){res.end(JSON.stringify({data:[{id:'local-test',type:'llm',state:'loaded'}]}));return;}
    let text='';for await(const chunk of req)text+=chunk;
    const {messages,response_format}=JSON.parse(text);assert.equal(messages[1].role,'user');
    if(response_format?.json_schema.name==='intuition_question_intent'){res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"intent":"conversation"}'}}]}));return;}
    if(response_format?.json_schema.name==='intuition_reply_review'){res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"occupationDisclosure":"none","safe":true,"consistent":true,"relevant":true,"natural":true,"useful":true,"issues":[]}'}}]}));return;}
    res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'Мне приятно познакомиться. Я люблю спокойные разговоры.'}}]}));
  });
  model.listen(0,'127.0.0.1');await once(model,'listening');
  const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',PUBLIC_ORIGIN:'',PROFESSIONS_FILE:file,LLM_BASE_URL:`http://127.0.0.1:${model.address().port}`},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
  try{
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Server startup timed out: '+stderr)),5000);
      child.stdout.once('data',()=>{clearTimeout(timer);resolve();});
      child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited: '+code+' '+stderr));});
      child.once('error',reject);
    });
    const base=`http://127.0.0.1:${port}`;let cookie;
    async function request(route,data){
      const headers={...(cookie?{cookie}:{}),...(data?{origin:base,'Content-Type':'application/json','X-Intuition-Client':'1'}:{})};
      const response=await fetch(base+route,{method:data?'POST':'GET',headers,body:data?JSON.stringify(data):undefined});
      if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
      return {status:response.status,value:await response.json()};
    }
    async function ready(){
      for(let i=0;i<60;i++){const {value}=await request('/api/game');if(!value.preparing)return value;await new Promise(resolve=>setTimeout(resolve,20));}
      throw Error('Game did not settle');
    }
    assert.equal((await request('/api/game/new',{})).status,202);
    const first=await ready();assert(first.id);assert.equal(first.characters.length,6);assert.equal(modelCalls,0);
    for(const p of first.characters)assert(!('professionRules' in p));
    for(const route of ['/professions.json','/characters.mjs','/../professions.json'])assert.equal((await fetch(base+route)).status,404);
    const asked=await request('/api/ask',{gameId:first.id,requestId:'first-question',characterId:first.characters[0].id,question:'Привет'});
    assert.equal(asked.status,200);assert.equal(asked.value.questions,1);assert.equal(asked.value.history.length,1);
    const callsBefore=modelCalls;
    await writeFile(file,'{"version":1,"professions":[');
    await request('/api/game/new',{});
    const failed=await ready();assert.equal(failed.id,first.id);assert.equal(failed.questions,1);assert.match(failed.generationError,/оборванный JSON/);assert.equal(modelCalls,callsBefore);
    await writeFile(file,JSON.stringify(catalogFixture()));
    await request('/api/game/new',{});
    const next=await ready();assert.notEqual(next.id,first.id);assert.equal(next.generationError,null);assert.equal(modelCalls,callsBefore);
  }finally{
    const closed=child.exitCode===null?once(child,'exit'):Promise.resolve();child.kill();await closed;
    await new Promise(resolve=>model.close(resolve));
    await rm(dir,{recursive:true,force:true});
  }
});
