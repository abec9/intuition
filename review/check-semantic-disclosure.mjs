import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {validateProfessionCatalog} from '../profession-catalog.mjs';
import {createCatalogScenario} from '../catalog-scenario.mjs';
import {createGame,ask} from '../game.mjs';
import {runDialoguePipeline} from '../dialogue-pipeline.mjs';
import {generateAnswer,modelStatus} from '../llm.mjs';
import {characterProfiles} from '../characters.mjs';
const catalog=validateProfessionCatalog(JSON.parse(await readFile(new URL('../professions.json',import.meta.url),'utf8')));
const roster=[characterProfiles.find(p=>p.name==='Лев Аркадьевич'),...characterProfiles.filter(p=>p.name!=='Лев Аркадьевич').slice(0,5)];
const scenario=createCatalogScenario(catalog,[],roster);
const game=createGame(scenario),person=game.characters[0];
for(const [i,job] of [[0,'lab_technician'],[1,'teacher']]){
 const rules=catalog.professions.find(p=>p.id===job);
 Object.assign(game.characters[i],{profession:rules.title,professionRules:rules,aliases:rules.aliases});
}
game.targetId=game.characters[1].id;game.targetProfession='Учитель';
const model=(await modelStatus()).model;
const report={model,replays:process.argv.includes('--live-only')?JSON.parse(await readFile(new URL('./semantic-disclosure-check.json',import.meta.url),'utf8')).replays:[],live:[]};
const save=()=>writeFile(new URL('./semantic-disclosure-check.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
async function complete(spec){
 const started=Date.now();
 const res=await fetch('http://192.168.1.192:1234/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,messages:spec.messages,max_tokens:spec.max_tokens,temperature:spec.temperature,stream:false,chat_template_kwargs:{enable_thinking:false},...(spec.schema?{response_format:{type:'json_schema',json_schema:{name:spec.stage,strict:true,schema:spec.schema}}}:{})}),signal:AbortSignal.timeout(120000)});
 if(!res.ok)throw Error(await res.text());const data=await res.json();
 return {content:data.choices[0].message.content,truncated:data.choices[0].finish_reason==='length',seconds:(Date.now()-started)/1000};
}
// Capture the actual production review prompt, then replay historical outputs
// against the real local reviewer. These are not hand-written review verdicts.
let reviewSpec;
await runDialoguePipeline(game,person.id,'любишь детей учить?',undefined,async spec=>{
 if(spec.stage==='question_intent')return {content:'{"intent":"preference"}'};
 if(spec.stage==='human_draft')return {content:'Мне приятно видеть, как человек начинает понимать.'};
 reviewSpec=spec;return {content:'{"occupationDisclosure":"none","safe":true,"consistent":true,"relevant":true,"natural":true,"issues":[]}'};
});
const cases=[
 ['lev-log','любишь детей учить?','Сам я скорее за воспитанием в плане терпения и игры. Люблю придумывать новые правила для настольных игр с внуком — это поближе к обучению, чем к чему-то официальному. А вот за парту сажать и учить кого-то, это уже совсем другой труд.','excludes'],
 ['oksana-log','любишь детей учить?','Нет, я не занимаюсь преподаванием. Мне ближе работа с вещами и тем, что можно потрогать руками, а не объяснение уроков.','excludes'],
 ['lev-followup-log','но ты же занимаешься этим трудом?','Если вы имеете в виду преподавание или какую-то педагогическую смену, то нет. Я работаю руками и головой над процессами, которые требуют строгой последовательности и внимания к деталям. Моя работа — это про скрупулёзность и следование регламенту, а не про объяснение уроков.','excludes'],
 ['preference-allowed','любишь детей учить?','Да, особенно когда видишь, как человек вдруг понял. Только терпения мне не всегда хватает.','none'],
 ['knowledge-allowed','Почему детям трудно усидеть на месте?','Детям нужно движение, а долго удерживать внимание бывает трудно. Короткие перерывы часто помогают.','none'],
 ['indirect-contrast','Какая часть этого занятия тебе ближе?','Я в этой истории обычно по другую сторону: мне объясняют, а я слушаю. Объяснять целому классу оставляю другим.','excludes']
];
for(const [name,question,candidate,expected] of (process.argv.includes('--live-only')?[]:cases)){
 const packet={...JSON.parse(reviewSpec.messages[1].content),question,candidate,directGuess:name==='lev-followup-log',history:name==='lev-followup-log'?[{question:cases[0][1],answer:cases[0][2]}]:[]};
 const result=await complete({...reviewSpec,messages:[reviewSpec.messages[0],{role:'user',content:JSON.stringify(packet)}]});
 const verdict=JSON.parse(result.content);report.replays.push({name,question,candidate,expected,verdict,seconds:result.seconds});await save();console.log(name,verdict.occupationDisclosure,result.seconds);
}
for(const question of ['любишь детей учить?','но ты же занимаешься этим трудом?']){
 const stages=[],start=Date.now();
 const entry={question};
 try{entry.answer=await ask(game,person.id,question,(g,id,q,signal)=>runDialoguePipeline(g,id,q,signal,async spec=>{const result=await complete(spec);stages.push({stage:spec.stage,...result});console.log(spec.stage,result.seconds);return result;}));}
 catch(error){entry.error=error.message;}
 report.live.push({...entry,stages,seconds:(Date.now()-start)/1000});await save();console.log(JSON.stringify(entry));
}
assert(report.replays.every(c=>c.verdict.occupationDisclosure===c.expected),'A real semantic verdict disagreed with the reviewed expectation');
assert(report.live.every(c=>c.answer&&!c.error),'A live dialogue did not finish');
