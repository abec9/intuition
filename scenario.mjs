import { randomInt, randomUUID } from 'node:crypto';
import {nameMatchesPortrait} from './identity.mjs';
import {portraits} from './portraits.mjs';

// Only portrait constraints are fixed. All story content comes from the local model.
export const portraitSlots=portraits.slice(0,6);
const string={type:'string'};
export const personalSchema={type:'string',minLength:500,maxLength:1800};
export const castSummarySchema={type:'object',additionalProperties:false,required:['title','setting','characters'],properties:{title:{type:'string',minLength:3,maxLength:90},setting:{type:'string',minLength:10,maxLength:260},characters:{type:'array',minItems:6,maxItems:6,items:{type:'object',additionalProperties:false,required:['name','trait','voice','intro'],properties:{name:{type:'string',minLength:2,maxLength:28},trait:{type:'string',minLength:4,maxLength:65},voice:{type:'string',minLength:5,maxLength:120},intro:{type:'string',minLength:6,maxLength:150}}}}}};
export const scenarioSchema={type:'object',additionalProperties:false,required:['title','setting','characters'],properties:{
  title:string,setting:string,characters:{type:'array',minItems:6,maxItems:6,items:{type:'object',additionalProperties:false,required:['name','trait','voice','intro','personal','profession','hints','reveal','aliases'],properties:{
    name:string,trait:string,voice:string,intro:string,personal:personalSchema,profession:string,
    hints:{type:'array',minItems:3,maxItems:3,items:string},reveal:string,
    aliases:{type:'array',minItems:1,maxItems:3,items:string}
  }}}
}};
export const castSchema={...castSummarySchema,properties:{...castSummarySchema.properties,characters:{...castSummarySchema.properties.characters,items:{...castSummarySchema.properties.characters.items,required:[...castSummarySchema.properties.characters.items.required,'personal'],properties:{...castSummarySchema.properties.characters.items.properties,personal:personalSchema}}}}};
export function castSchemaFor(roster){const item=castSchema.properties.characters.items;return {...castSchema,properties:{...castSchema.properties,characters:{...castSchema.properties.characters,items:{...item,required:[...item.required,'portraitId'],properties:{...item.properties,portraitId:{type:'string',enum:roster.map(p=>p.id)}}}}}};}
export const rolesSchema={type:'object',additionalProperties:false,required:['characters'],properties:{characters:{type:'array',minItems:6,maxItems:6,items:{type:'object',additionalProperties:false,required:['profession','hints','reveal','aliases'],properties:{profession:string,hints:{type:'array',minItems:3,maxItems:3,items:string},reveal:string,aliases:{type:'array',minItems:1,maxItems:3,items:string}}}}}};
export function castPrompt(roster=portraitSlots){return `Придумай шесть незнакомых людей для камерного разговора. Только русский JSON по схеме. Новая история ${randomUUID()}. Порядок портретов: ${roster.map((p,i)=>`${i+1}: portraitId=${p.id}, ${p.gender}, ${p.age} лет`).join('; ')}.
У каждого человека укажи точный portraitId из списка. Имена, отчества, род местоимений и возраст в биографии строго соответствуют его portraitId. Не чередуй мужчин и женщин автоматически: следуй данным каждого портрета. Используй полные однозначные русскоязычные имена, без Саши, Жени, Вали и Шуры; имя не должно определять профессию. Для каждого: имя name, два качества trait, манера речи voice, вступительная фраза intro и развёрнутый психологический портрет personal.
КАЖДЫЙ personal — самостоятельный связный текст из 8–12 содержательных предложений, ориентир 800–1100 символов, СТРОГО минимум 500 и максимум 1800 символов. Это не анкета и не список эпитетов. Опиши прошлое и одно конкретное воспоминание, важные отношения, увлечение и повседневную привычку, ценность, уязвимость, внутреннее противоречие, поведение в споре, реакцию на сближение и личное желание. Свяжи эти детали причинами: почему человек таким стал, чего избегает, как проявляет симпатию. Включи конкретные факты, которые он сможет последовательно вспоминать в разговоре. Без диагнозов и повторения одинаковых характеристик у всех шестерых. Это обычные живые люди: у части из них благополучное прошлое, тёплые отношения, чувство юмора и радости. Не объясняй каждого травмой, одиночеством и страхом отвержения. Воспоминания бытовые и правдоподобные, без трагедий ради драматизма. Предпочитай конкретный поступок абстрактным рассуждениям об истинности и глубине души; не используй метафоры бурь, стен и руин. Не используй повторения и пустые фразы для объёма.
Не придумывай профессии или занятия по работе. Никаких рабочих навыков, клиентов, показателей, документов, униформы или рабочего распорядка. Не связывай личность со стереотипами профессии. Люди разные, без карикатур и пафоса. intro — короткая живая реплика незнакомцу, не монолог. title — название места встречи, setting — одно предложение об атмосфере. name до 28 символов, trait до 65, voice до 120, intro до 150, title до 90, setting до 260. Не сокращай personal до этих размеров: каждому человеку нужен полный портрет. Только русский JSON.`;}
export function validateCast(raw,roster=portraitSlots){
  if(!raw||!Array.isArray(raw.characters)||raw.characters.length!==6)throw new Error('Нужны ровно шесть людей.');
  raw.characters.forEach((p,i)=>{if(!nameMatchesPortrait(p.name,roster[i]))throw new Error(`Имя ${p.name} не соответствует портрету ${roster[i].id}: ${roster[i].gender}, ${roster[i].age} лет.`);});
  return {title:checkText(raw.title,'title',3,90),setting:checkText(raw.setting,'setting',10,260),characters:raw.characters.map((p,i)=>({
    name:checkText(p.name,'name',2,28),trait:checkText(p.trait,'trait',4,65),voice:checkText(p.voice,'voice',5,120),intro:checkText(p.intro,'intro',6,150),personal:checkText(p.personal,`personal персонажа ${i+1}`,personalSchema.minLength,personalSchema.maxLength)
  }))};
}
export function rolesPrompt(cast,previousProfessions=[]){return `Ты автор сложной игры на угадывание профессии. Придумай шесть разных настоящих профессий и скрытые подсказки для УЖЕ СОЗДАННЫХ людей. Порядок неизменен. Не меняй их характеры и биографии, не выбирай профессию по стереотипу характера, хобби или пола. Предыдущие профессии, которых лучше избегать: ${previousProfessions.join(', ')||'нет'}.
Люди: ${JSON.stringify(cast.characters.map(p=>({name:p.name,personal:p.personal}))) }
Верни JSON с characters, для каждого: profession (название в именительном падеже, до 40 символов), hints (ровно 3 разных коротких наблюдения о переживаниях на работе), reveal (2 предложения, объясняющих связь hints с profession после финала), aliases (1–2 обозначения той же самой профессии, не соседних профессий).
КРИТИЧНО: hints описывают ТОЛЬКО переживания, отношения к ошибкам, ожидание от других людей, удовлетворение результатом. НИКАКИХ объектов или действий, по которым узнаётся ремесло: документов, паспортов, виз, штампов, пациентов, сцены, печей, чертежей, уборки, перевозки, программирования, языков, инструмента, формы, материалов, должностных обязанностей, места работы и точного распорядка. Не называй профессию или однокоренные слова. Отдельная hints подходит многим профессиям; сочетание трёх даёт зацепку. Не делай все hints про порядок и точность. Они правдивы для выбранной профессии, но звучат как человеческие реакции. Каждый hint 1 предложение до 140 символов. reveal до 230 символов. Только русский язык, только JSON.`;}
export function normalized(text){return text.normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[\u200b-\u200f\uFEFF]/g,'');}
function stem(word){
  // Strip recognizable inflectional endings instead of arbitrary final letters.
  if(word.length<=3||['меню','такси','кино','кафе','кофе'].includes(word)||!/^[а-я]+$/.test(word))return word;
  const base=word.replace(/(?:иями|ями|ами|ого|ему|ому|ыми|ими|ией|ов|ев|ей|ом|ем|ах|ях|ую|юю|ый|ий|ая|яя|ое|ее|ые|ие|ых|их|а|я|ы|и|у|ю|ь|й)$/,'');
  return base.length>=3?base:word;
}
export function professionTerms(characters){
  const result=[];
  for(const p of characters){
    for(const name of [p.profession,...(p.aliases||[]),...(p.professionRules?.aliases||[])]){
      const words=normalized(name).match(/[а-яa-z]+/g)||[];
      // Match a descriptive alias as a phrase, never ban each ordinary noun in it.
      if(words.length)result.push(words.map(stem).join(' '));
    }
    const words=normalized(p.profession).match(/[а-яa-z]{4,}/g)||[];
    const head=words.find(w=>!['мастер','оператор','специалист','старший','младший','ведущий','агент'].includes(w)&&!/(ый|ий|ая|ое|ые|ого|ной|ный)$/.test(w));
    if(head)result.push(stem(head));
  }
  return [...new Set(result)];
}
export function mentionsProfession(text,terms){
  const words=normalized(text).match(/[а-яa-z]+/g)||[];
  const matches=(word,part)=>{
    if(!word)return false;
    if(part.length<=3){
      if(word===part)return true;
      return /^[а-я]+$/.test(part)&&['а','у','е','ом','ы','и','ой','ов','ам','ами','ах','ей','ем','я','ю','ям','ями','ях','ь'].includes(word.startsWith(part)?word.slice(part.length):'!');
    }
    return word.startsWith(part);
  };
  return terms.some(term=>{const parts=term.split(' ');return words.some((_,i)=>parts.every((part,j)=>matches(words[i+j],part)));});
}
function checkText(value,label,min,max){if(typeof value!=='string'||value.trim().length<min||value.length>max||/[<>]/.test(value))throw new Error(`Поле ${label}: нужен текст от ${min} до ${max} символов.`);return value.trim();}
export function validateScenario(raw,roster=portraitSlots){
  if(roster.length!==6||roster.some(p=>!p)||new Set(roster.map(p=>p.id)).size!==6)throw new Error('Нужны шесть разных портретов.');
  if(!raw||!Array.isArray(raw.characters)||raw.characters.length!==6)throw new Error('Нужны ровно шесть персонажей.');
  const title=checkText(raw.title,'title',3,90),setting=checkText(raw.setting,'setting',10,260);
  const characters=raw.characters.map((p,i)=>{
    const slot=roster[i];
    if(!Array.isArray(p.hints)||p.hints.length!==3)throw new Error('Нужны три косвенные подсказки на персонажа.');
    if(!Array.isArray(p.aliases)||p.aliases.length<1||p.aliases.length>3)throw new Error('Нужны 1–3 обозначения профессии для фильтра.');
    return {...slot,name:checkText(p.name,'name',2,28),trait:checkText(p.trait,'trait',4,65),voice:checkText(p.voice,'voice',5,120),intro:checkText(p.intro,'intro',6,150),personal:checkText(p.personal,'personal',personalSchema.minLength,personalSchema.maxLength),profession:checkText(p.profession,'profession',3,60),hints:p.hints.map(h=>checkText(h,'hint',12,220)),reveal:checkText(p.reveal,'reveal',20,450),aliases:p.aliases.map(a=>checkText(a,'alias',3,60)),...(p.professionRules?{professionRules:structuredClone(p.professionRules)}:{})};
  });
  if(new Set(characters.map(p=>normalized(p.profession))).size!==6)throw new Error('Профессии должны быть разными.');
  if(new Set(characters.map(p=>normalized(p.name))).size!==6)throw new Error('Имена должны быть разными.');
  characters.forEach(p=>{if(!nameMatchesPortrait(p.name,p))throw new Error(`Имя ${p.name} не соответствует полу портрета.`);});
  const terms=professionTerms(characters);
  if(terms.length<6)throw new Error('Нужны конкретные названия профессий, а не общие должности.');
  const publicTexts=[title,setting,...characters.flatMap(p=>[p.name,p.trait,p.intro,p.personal,...p.hints])];
  if(publicTexts.some(t=>/[\u3400-\u9fff]/u.test(t)))throw new Error('Тексты должны быть на русском языке, без иероглифов.');
  if(publicTexts.some(t=>mentionsProfession(t,terms)))throw new Error('Имена, вступления, личные факты и подсказки не должны содержать названий профессий или их однокоренных слов.');
  return {title,setting,characters};
}
export function chooseTarget(characters,previousTarget){
  const pool=characters.filter(p=>normalized(p.profession)!==normalized(previousTarget||''));
  return (pool.length?pool:characters)[randomInt((pool.length?pool:characters).length)].id;
}
