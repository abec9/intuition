import {readFile,writeFile} from 'node:fs/promises';
import {createCatalogScenario} from '../catalog-scenario.mjs';
import {validateProfessionCatalog} from '../profession-catalog.mjs';
import {createGame,ask} from '../game.mjs';
import {generateAnswer,modelStatus} from '../llm.mjs';
const catalog=validateProfessionCatalog(JSON.parse(await readFile(new URL('../professions.json',import.meta.url),'utf8')));
const roles=['barista','courier','software_developer','teacher','architect','photographer'];
const game=createGame(createCatalogScenario({...catalog,professions:catalog.professions.filter(p=>roles.includes(p.id))}));
const person=game.characters.find(p=>p.professionRules.id==='barista');
const report={model:await modelStatus(),name:person.name,profession:person.profession,turns:[]};
const realFetch=globalThis.fetch;
let stages=[];
globalThis.fetch=async(url,options)=>{
  const start=Date.now(),response=await realFetch(url,options);
  if(options?.body){const b=JSON.parse(options.body);const result=await response.clone().json();stages.push({stage:b.messages[0].content.match(/^ЭТАП: (\w+)/)?.[1],seconds:(Date.now()-start)/1000,answer:result.choices?.[0]?.message?.content}); console.log(JSON.stringify({stage:stages.at(-1).stage,seconds:stages.at(-1).seconds}));}
  return response;
};
for(const question of [
 'Привет! Я Саша, моего кота зовут Финик.',
 'Как зовут моего кота? Предложи занятие для тихого вечера дома, без музыки.',
 'Почему кофе бывает горьким? Объясни просто, без лекции.',
 'Ты бариста? Только честно: да или нет.'
]){
  stages=[];const start=Date.now();let answer,error;
  try{answer=await ask(game,person.id,question,generateAnswer);}catch(e){error=e.message;}
  const turn={question,answer,error,seconds:(Date.now()-start)/1000,stages};report.turns.push(turn);
  await writeFile(new URL('./live-dialogue-pipeline.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({question,answer,error,seconds:turn.seconds,stages:stages.length}));
}
if(report.turns.some(t=>t.error))process.exitCode=1;
