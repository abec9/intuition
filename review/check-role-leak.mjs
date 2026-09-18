import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {validateProfessionCatalog} from '../profession-catalog.mjs';
import {createCatalogScenario} from '../catalog-scenario.mjs';
import {characterProfiles} from '../characters.mjs';
import {createGame,ask} from '../game.mjs';
import {generateAnswer,modelStatus} from '../llm.mjs';
import {factualEditIssues,hardReplyIssues} from '../dialogue-pipeline.mjs';
const catalog=validateProfessionCatalog(JSON.parse(await readFile(new URL('../professions.json',import.meta.url),'utf8')));
const subset={...catalog,professions:catalog.professions.filter(p=>['lab_technician','architect','teacher','photographer','ux_designer','barista'].includes(p.id))};
const olga=characterProfiles.find(p=>p.name==='Ольга Сергеевна');
const roster=[olga,...characterProfiles.filter(p=>p.id!==olga.id).slice(0,5)];
let scenario;
for(let i=0;i<100;i++){scenario=createCatalogScenario(subset,[],roster);if(scenario.characters[0].professionRules.id==='lab_technician')break;}
assert.equal(scenario.characters[0].professionRules.id,'lab_technician');
const game=createGame(scenario),person=game.characters[0];
const stages=[],originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 const start=Date.now(),response=await originalFetch(url,options);
 if(options?.body){const req=JSON.parse(options.body),result=await response.clone().json();const stage=req.messages[0].content.match(/^ЭТАП: (\w+)/)?.[1];stages.push({stage,seconds:(Date.now()-start)/1000,answer:result.choices?.[0]?.message?.content});console.log(stage,stages.at(-1).seconds);}
 return response;
};
const report={model:await modelStatus(),name:person.name,profession:person.profession,question:'UX-дизайнер?'};
console.log(JSON.stringify(report));
const start=Date.now();
try{report.answer=await ask(game,person.id,report.question,generateAnswer);}catch(e){report.error=e.message;}
report.seconds=(Date.now()-start)/1000;report.stages=stages;
await writeFile(new URL('./role-leak-check.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({answer:report.answer,error:report.error,seconds:report.seconds}));
assert(!report.error,report.error);
assert.deepEqual(factualEditIssues(report.question,'Да, работаю.',report.answer),[]);

assert.deepEqual(hardReplyIssues(game,person.id,report.question,report.answer),[]);
