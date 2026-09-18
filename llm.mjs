import {alignCast,nameMatchesPortrait} from './identity.mjs';
import {portraitSlots} from './scenario.mjs';
import {castSchemaFor,castSummarySchema,personalSchema,rolesSchema,castPrompt,rolesPrompt,validateCast,validateScenario,professionTerms,mentionsProfession} from './scenario.mjs';
import {characterPrompt, cleanReply, isSafeReply, GameError} from './game.mjs';
import {prepareQuestion,givesProfessionalVerdict} from './profession-rules.mjs';
import {runDialoguePipeline} from './dialogue-pipeline.mjs';
export {prepareQuestion} from './profession-rules.mjs';
export const endpoint=(process.env.LLM_BASE_URL||'http://192.168.1.192:1234').replace(/\/$/,'');
let cachedModel=process.env.LLM_MODEL||null;
export async function modelStatus(){
  const response=await fetch(`${endpoint}/api/v0/models`,{signal:AbortSignal.timeout(8000)});
  if(response.ok){
    const {data=[]}=await response.json();const loaded=data.filter(m=>m.state==='loaded'&&m.type!=='embeddings');
    const model=loaded.find(m=>m.id===cachedModel)||loaded[0];
    if(model){cachedModel=model.id;return {connected:true,model:model.id};}
    throw new Error('No loaded model');
  }
  const fallback=await fetch(`${endpoint}/v1/models`,{signal:AbortSignal.timeout(8000)});if(!fallback.ok)throw new Error('Model unavailable');
  const {data=[]}=await fallback.json();const model=data.find(m=>m.id===cachedModel);
  if(!model)throw new Error('Set LLM_MODEL for this server');
  return {connected:true,model:cachedModel};
}
// Rebuild from this character's complete transcript on every request, across rounds.
// The model server itself is stateless; no shared conversation or summarization is used.
export function conversationMessages(game,id,question){
  const person=game.characters.find(p=>p.id===id);
  if(!person)throw new GameError('Выбери персонажа.',400);
  const prepared=prepareQuestion(question,game);
  return [
    // Some model templates reject an assistant turn before the first user turn.
    // Preserve the displayed introduction as context, without inventing a user message.
    {role:'system',content:characterPrompt(game,id,prepared.direct?'':question)+'\nТвоя вступительная реплика, уже показанная собеседнику: '+person.intro},
    ...game.history.filter(h=>h.characterId===id).flatMap(h=>[
      {role:'user',content:person.professionRules?h.question:prepareQuestion(h.question,game).content},
      {role:'assistant',content:h.answer}
    ]),
    {role:'user',content:person.professionRules?question:prepared.content}
  ];
}
export async function generateAnswer(game,id,question,signal){
  if(signal?.aborted)throw new GameError('Разговор остановлен. Вопрос не потрачен.');
  try{await modelStatus();}catch{throw new GameError('Локальная модель не отвечает. Проверь LM Studio. Вопрос не потрачен.',502);}
  if(game.characters.find(p=>p.id===id)?.professionRules)return runDialoguePipeline(game,id,question,signal,completeDialogueStage);
  const prepared=prepareQuestion(question,game);
  const messages=conversationMessages(game,id,question);
  for(let attempt=0;attempt<2;attempt++){
    let response;
    try{response=await fetch(`${endpoint}/v1/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:cachedModel,messages,temperature:0.45,max_tokens:250,stream:false,chat_template_kwargs:{enable_thinking:false}}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000)});}catch{if(signal?.aborted)throw new GameError('Разговор остановлен. Вопрос не потрачен.');throw new GameError('Не удалось дождаться модели. Проверь, что LM Studio работает. Вопрос не потрачен — можно повторить.',502);}
    if(!response.ok){
      const detail=await response.text();
      if(/jinja|prompt template|No user query|roles must alternate/i.test(detail))throw new GameError('Модель отклонила формат диалога. Вопрос не потрачен. Обнови игру и повтори запрос.',502);
      throw new GameError('Модель не смогла ответить. Повтори вопрос — он не потрачен.',502);
    }
    const result=await response.json();const choice=result.choices?.[0];const answer=cleanReply(choice?.message?.content);
    const givesVerdict=prepared.direct&&givesProfessionalVerdict(answer);
    if(choice?.finish_reason!=='length'&&isSafeReply(answer,game,id)&&!givesVerdict)return answer;
    if(attempt===0)messages[0].content+='\nПредыдущий вариант не прошёл проверку. Ответь коротко и буквально по вопросу, без выдуманных материалов, мест, рабочего распорядка и физических условий. Только разрешённые факты. Не упоминай проверку.';
  }
  throw new GameError('Персонаж чуть не выдал лишнее. Попробуй переформулировать вопрос — попытка не потрачена.',502);
}

async function completeDialogueStage({stage,messages,temperature,max_tokens,schema},signal){
  const minimumRetryTokens={question_intent:220,reply_review:900,human_draft:900,targeted_repair:900};
  for(let attempt=0;attempt<2;attempt++){
    const tokenBudget=attempt?Math.max(max_tokens*2,minimumRetryTokens[stage]||max_tokens*2):max_tokens;
    const stageMessages=attempt?[{...messages[0],content:messages[0].content+'\nПредыдущий ответ оборвался из-за лимита. Верни полный законченный результат. Для JSON верни один валидный объект без пояснений; для реплики — короткий завершённый текст.'},...messages.slice(1)]:messages;
    let response;
    try{
      response=await fetch(`${endpoint}/v1/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:cachedModel,messages:stageMessages,...(/gemma-4|qwen3\.5/i.test(cachedModel||'')?{reasoning_effort:'none'}:{}),temperature:attempt?0:temperature,max_tokens:tokenBudget,stream:false,chat_template_kwargs:{enable_thinking:false},...(schema?{response_format:{type:'json_schema',json_schema:{name:stage==='question_intent'?'intuition_question_intent':'intuition_reply_review',strict:true,schema}}}:{})}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000)});
    }catch{
      if(signal?.aborted)throw new GameError('Разговор остановлен. Вопрос не потрачен.');
      throw new GameError('Не удалось дождаться модели. Повтори вопрос — он не потрачен.',502);
    }
    if(!response.ok){
      const detail=await response.text();
      if(/jinja|prompt template|No user query|roles must alternate/i.test(detail))throw new GameError('Модель отклонила формат диалога. Вопрос не потрачен.',502);
      throw new GameError('Модель не смогла закончить ответ. Повтори вопрос — он не потрачен.',502);
    }
    try{
      const result=await response.json(),choice=result.choices?.[0];
      if(typeof choice?.message?.content!=='string')throw Error('Empty completion');
      if(choice.finish_reason==='length'&&attempt===0)continue;
      return {content:choice.message.content,truncated:choice.finish_reason==='length'};
    }catch{throw new GameError('Модель вернула неполный ответ. Повтори вопрос — он не потрачен.',502);}
  }
}

async function generateJSON(name,schema,prompt,maxTokens){
  let response;
  try{response=await fetch(`${endpoint}/v1/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:cachedModel,messages:[{role:'system',content:prompt},{role:'user',content:'Создай новую историю сейчас. Только JSON.'}],temperature:0.7,max_tokens:maxTokens,stream:false,chat_template_kwargs:{enable_thinking:false},response_format:{type:'json_schema',json_schema:{name,strict:true,schema}}}),signal:AbortSignal.timeout(240000)});}catch{throw new GameError('Модель не успела подготовить историю. Проверь LM Studio и попробуй ещё раз.',502);}
  if(!response.ok)throw new GameError('Локальная модель не смогла создать сценарий. Проверь поддержку JSON Schema в LM Studio.',502);
  const result=await response.json();
  if(result.choices?.[0]?.finish_reason==='length')throw new Error('Ответ оборвался: сократи текст.');
  const raw=cleanReply(result.choices?.[0]?.message?.content).replace(/^```(?:json)?\s*|\s*```$/g,'');
  return JSON.parse(raw);
}
// Keep long portraits intact if the model only overshoots a short UI field.
async function generateCast(roster,correction){
  let raw=alignCast(await generateJSON('intuition_people',castSchemaFor(roster),castPrompt(roster)+correction,6500),roster);
  const wrong=raw.characters.map((p,i)=>!nameMatchesPortrait(p.name,roster[i])?i:-1).filter(i=>i>=0);
  if(wrong.length){
    const slots=wrong.map(i=>roster[i]),schema=castSchemaFor(slots);
    schema.properties.characters={...schema.properties.characters,minItems:slots.length,maxItems:slots.length};
    const repaired=alignCast(await generateJSON('intuition_identity_repair',schema,`Исправь людей, чьи имена не совпали с портретами. Верни только ${slots.length} исправленных персонажей, title и setting сохрани. Для каждого сохраняй точный portraitId. Требования: ${JSON.stringify(slots.map(p=>({portraitId:p.id,gender:p.gender,age:p.age})))}. Исходник: ${JSON.stringify({...raw,characters:wrong.map(i=>({...raw.characters[i],portraitId:roster[i].id}))})}. Полное имя и отчество обязаны соответствовать полу; исправь род местоимений, окончания, возраст и согласование во ВСЕХ полях, сохраняя остальные личные факты. personal не менее 500 символов, без профессий и рабочих обязанностей. Только JSON.`,Math.min(6500,slots.length*1600)),slots);
    wrong.forEach((index,i)=>{raw.characters[index]=repaired.characters[i];});
  }
  try{return validateCast(raw,roster);}catch(error){
    if(!Array.isArray(raw?.characters)||raw.characters.length!==6||raw.characters.some(p=>typeof p.personal!=='string'||p.personal.trim().length<personalSchema.minLength||p.personal.length>personalSchema.maxLength||/[<>]/.test(p.personal)))throw error;
    const brief={title:raw.title,setting:raw.setting,characters:raw.characters.map(({name,trait,voice,intro})=>({name,trait,voice,intro}))};
    const repaired=await generateJSON('intuition_short_fields',castSummarySchema,`Сократи поля уже созданной истории, сохрани смысл, имена и порядок шести людей. Пол и возраст по порядку: ${JSON.stringify(roster.map(p=>({gender:p.gender,age:p.age})))}. Новую историю не придумывай. Исходник: ${JSON.stringify(brief)}. Ошибка проверки: ${error.message}. name максимум 28 символов, trait — только два прилагательных, до 40 символов; voice — одно короткое предложение до 80 символов; intro — одна естественная реплика до 90 символов. title до 60 символов, setting до 180 символов. Только русский JSON по схеме.`,1600);
    return validateCast({...repaired,characters:repaired.characters.map((p,i)=>({...p,name:raw.characters[i].name,personal:raw.characters[i].personal}))},roster);
  }
}
// Repair only generated text that would disclose a role, keeping everyone else fixed.
async function repairLeaks(raw){
  const terms=professionTerms(raw.characters),entries=[];
  const fallback=(key)=>{
    if(key==='title')return 'Тихая встреча';
    if(key==='setting')return 'В комнате тепло и спокойно, разговор начинается без спешки.';
    if(key==='trait')return 'внимательный';
    if(key==='intro')return 'Расскажите, что вы заметили первым?';
    if(Number.isInteger(key))return 'Мне важно сначала понять человека, а потом делать выводы.';
    return null;
  };
  const valid=(text,min,max)=>typeof text==='string'&&text.trim().length>=min&&text.length<=max&&!/[<>\u3400-\u9fff]/u.test(text)&&!mentionsProfession(text,terms);
  const add=(object,key,min,max)=>{
    const value=object[key];
    if(typeof value!=='string'||(!mentionsProfession(value,terms)&&!/[\u3400-\u9fff]/u.test(value)))return;
    // A full generated paragraph need not be rebuilt for one revealing sentence.
    // Never pad or truncate a profile to force the minimum length.
    if(key==='personal'){
      const clean=value.split(/(?<=[.!?])\s+/u).filter(sentence=>!mentionsProfession(sentence,terms)&&!/[\u3400-\u9fff]/u.test(sentence)).join(' ');
      if(clean.length>=min&&clean.length<=max){object[key]=clean;return;}
    }
    entries.push({object,key,text:value,min,max});
  };
  add(raw,'title',3,90);add(raw,'setting',10,260);
  for(const p of raw.characters){
    add(p,'name',2,28);add(p,'trait',4,65);add(p,'intro',6,150);add(p,'personal',500,1800);
    p.hints.forEach((_,i)=>add(p.hints,i,12,220));
  }
  if(!entries.length)return raw;
  const schema={type:'object',additionalProperties:false,required:['texts'],properties:{texts:{type:'array',minItems:entries.length,maxItems:entries.length,items:{type:'string'}}}};
  const result=await generateJSON('intuition_private_portraits',schema,`Исправь только перечисленные фрагменты сценария, в том же порядке. Верни texts, по одному тексту на исходный фрагмент. Сохрани имена, личность, отношения и бытовые воспоминания. Удали упоминания работы, названия профессий и однокоренные слова. Запрещённые обозначения: ${raw.characters.flatMap(p=>[p.profession,...p.aliases]).join(', ')}. Вместо профессионального занятия оставь обычную личную привычку; не вводи другие профессии или специфические рабочие навыки. Если встретились иероглифы, замени на естественное русское выражение. Не добавляй пафос, трагедии, метафоры и новые травмы. Для психологического портрета ОБЯЗАТЕЛЬНО сохраняй минимум 500 символов связного содержательного текста, остальные размеры указаны в исходнике. Источники: ${JSON.stringify(entries.map(({text,min,max})=>({text,minSymbols:min,maxSymbols:max})))}`,Math.min(6500,entries.reduce((sum,e)=>sum+(e.min===500?1300:350),300)));
  if(!Array.isArray(result.texts)||result.texts.length!==entries.length)throw new Error('Нужно сохранить число исправляемых фрагментов.');
  entries.forEach((e,i)=>{
    const text=String(result.texts[i]||'').trim();
    if(valid(text,e.min,e.max)){e.object[e.key]=text;return;}
    const safe=fallback(e.key);
    if(safe&&valid(safe,e.min,e.max)){e.object[e.key]=safe;return;}
    e.object[e.key]=text;
  });
  return raw;
}
export async function generateScenario(previousProfessions=[],roster=portraitSlots){
  await modelStatus();
  let correction='';
  for(let attempt=0;attempt<2;attempt++){
    try{
      const cast=await generateCast(roster,correction);
      const hidden=await generateJSON('intuition_roles',rolesSchema,rolesPrompt(cast,previousProfessions)+correction,2800);
      if(!Array.isArray(hidden.characters)||hidden.characters.length!==6)throw new Error('Нужны ровно шесть профессий.');
      const hintSchema={type:'object',additionalProperties:false,required:['groups'],properties:{groups:{type:'array',minItems:6,maxItems:6,items:{type:'object',additionalProperties:false,required:['hints'],properties:{hints:{type:'array',minItems:3,maxItems:3,items:{type:'string'}}}}}}};
      const softened=await generateJSON('intuition_subtle_clues',hintSchema,`Перепиши 6 групп наблюдений как неочевидные человеческие реакции. Сохрани порядок 6 групп и по 3 разные мысли в каждой. Исходник: ${JSON.stringify(hidden.characters.map(p=>p.hints))}.\nУдали ВСЕ названия объектов, инструментов, профессий, физических материалов, документов, отраслей и специфические действия. Оставь только личное отношение к ошибкам, доверию, неопределённости, признанию, ожиданию, ответственности и результату. Без метафор, поэзии, отвлечённой философии. Каждая мысль — ясное повседневное предложение от первого лица, 8–16 слов. Не делай все ответы одинаковыми. Не добавляй новых фактов. Не начинай каждую фразу одинаково. Только русский JSON groups:[{hints:[...]}].`,1800);
      if(!Array.isArray(softened.groups)||softened.groups.length!==6)throw new Error('Нужны шесть групп наблюдений.');
      return validateScenario(await repairLeaks({title:cast.title,setting:cast.setting,characters:cast.characters.map((p,i)=>({...p,...hidden.characters[i],hints:softened.groups[i].hints}))}),roster);
    }catch(e){if(e instanceof GameError)throw e;console.warn('Scenario validation:',e.message);correction='\nПредыдущий вариант не прошёл проверку: '+e.message+' Исправь это.';}
  }
  throw new GameError('Сценарий не прошёл проверку целостности. Попробуй создать новую историю ещё раз.',502);
}
