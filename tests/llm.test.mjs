import test from 'node:test';
import assert from 'node:assert/strict';
import {generateScenario,generateAnswer,conversationMessages} from '../llm.mjs';
import {createGame,ask} from '../game.mjs';
import {portraitSlots} from '../scenario.mjs';
import {fixture} from './fixture.mjs';

test('first question and follow-up use alternating user and assistant turns',async(t)=>{
  const game=createGame(fixture()),id=game.characters[0].id;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(String(url).endsWith('/api/v0/models'))return Response.json({data:[{id:'local-test',type:'llm',state:'loaded'}]});
    const {messages}=JSON.parse(options.body);
    assert.equal(messages[0].role,'system');
    messages.slice(1).forEach((message,i)=>assert.equal(message.role,i%2?'assistant':'user'));
    return Response.json({choices:[{finish_reason:'stop',message:{content:'Мне важно выслушать человека и не торопиться с выводами.'}}]});
  });
  assert.deepEqual(conversationMessages(game,id,'Привет').map(m=>m.role),['system','user']);
  await ask(game,id,'Как ты относишься к людям?',generateAnswer);
  await ask(game,id,'Почему?',generateAnswer);
  assert.equal(game.history.length,2);
  assert.equal(game.questions,2);
});

test('template failure reports a format error and preserves the question',async(t)=>{
  const game=createGame(fixture()),id=game.characters[0].id;
  t.mock.method(globalThis,'fetch',async(url)=>{
    if(String(url).endsWith('/api/v0/models'))return Response.json({data:[{id:'local-test',type:'llm',state:'loaded'}]});
    return Response.json({error:'Error rendering prompt with jinja template: No user query found in messages.'},{status:400});
  });
  await assert.rejects(ask(game,id,'Привет',generateAnswer),/отклонила формат диалога/);
  assert.equal(game.questions,0);
  assert.equal(game.history.length,0);
  assert.equal(game.busy,false);
});

test('local generation repairs oversized UI fields while preserving all six complete profiles',async(t)=>{
  const raw=fixture(),calls=[];
  const short={title:raw.title,setting:raw.setting,characters:raw.characters.map(({name,trait,voice,intro})=>({name,trait,voice,intro}))};
  const changedNames=short.characters.map((p,i)=>({...p,name:['Вера','Марк','Ника','Илья','Мира','Лев'][i]}));
  const cast={...short,characters:short.characters.map((p,i)=>({...p,portraitId:portraitSlots[i].id,voice:'Очень длинное описание манеры речи. '.repeat(8),personal:raw.characters[i].personal}))};
  const replies={
    intuition_people:cast,
    intuition_short_fields:{...short,characters:changedNames},
    intuition_roles:{characters:raw.characters.map(({profession,hints,reveal,aliases})=>({profession,hints,reveal,aliases}))},
    intuition_subtle_clues:{groups:raw.characters.map(p=>({hints:p.hints}))}
  };
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(String(url).endsWith('/api/v0/models'))return Response.json({data:[{id:'local-test',type:'llm',state:'loaded'}]});
    const body=JSON.parse(options.body),name=body.response_format.json_schema.name;calls.push(body);
    assert(name in replies);
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(replies[name])}}]});
  });
  const result=await generateScenario();
  assert.deepEqual(result.characters.map(p=>p.name),raw.characters.map(p=>p.name));
  assert.deepEqual(result.characters.map(p=>p.personal),raw.characters.map(p=>p.personal));
  assert.deepEqual(calls.map(c=>c.response_format.json_schema.name),Object.keys(replies));
  assert.equal(calls[0].max_tokens,6500);
  assert(calls[1].messages[0].content.includes('voice'));
  assert(!calls[1].messages[0].content.includes(raw.characters[0].personal));
});

test('a revealing sentence is removed only when the complete profile still exceeds 500 characters',async(t)=>{
  const raw=fixture(),calls=[];
  const cast={title:raw.title,setting:raw.setting,characters:raw.characters.map(({name,trait,voice,intro,personal})=>({name,trait,voice,intro,personal}))};
  cast.characters.forEach((p,i)=>{p.portraitId=portraitSlots[i].id;});
  cast.characters[0].personal+=' Раньше работал геологом.';
  const replies={
    intuition_people:cast,
    intuition_roles:{characters:raw.characters.map(({profession,hints,reveal,aliases})=>({profession,hints,reveal,aliases}))},
    intuition_subtle_clues:{groups:raw.characters.map(p=>({hints:p.hints}))}
  };
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(String(url).endsWith('/api/v0/models'))return Response.json({data:[{id:'local-test',type:'llm',state:'loaded'}]});
    const body=JSON.parse(options.body),name=body.response_format.json_schema.name;calls.push(name);assert(name in replies);
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(replies[name])}}]});
  });
  const scenario=await generateScenario();
  assert.deepEqual(calls,Object.keys(replies));
  assert.deepEqual(scenario.characters.map(p=>p.personal),raw.characters.map(p=>p.personal));
});

test('short leaking fields fall back to neutral text when model repair is invalid',async(t)=>{
  const raw=fixture(),cast={title:raw.title,setting:raw.setting,characters:raw.characters.map(({name,trait,voice,intro,personal},i)=>({name,trait,voice,intro,personal,portraitId:portraitSlots[i].id}))};
  const subtle={groups:raw.characters.map(p=>({hints:[...p.hints]}))};
  subtle.groups[0].hints[0]='Архивист сразу замечает чужую неточность.';
  const replies={
    intuition_people:cast,
    intuition_roles:{characters:raw.characters.map(({profession,hints,reveal,aliases})=>({profession,hints,reveal,aliases}))},
    intuition_subtle_clues:subtle,
    intuition_private_portraits:{texts:['x']}
  };
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(String(url).endsWith('/api/v0/models'))return Response.json({data:[{id:'local-test',type:'llm',state:'loaded'}]});
    const body=JSON.parse(options.body),name=body.response_format.json_schema.name;assert(name in replies);
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(replies[name])}}]});
  });
  const scenario=await generateScenario();
  assert.equal(scenario.characters[0].hints[0],'Мне важно сначала понять человека, а потом делать выводы.');
});
