import {validateProfessionCatalog} from './profession-catalog.mjs';
import {revealsProfession,givesProfessionalVerdict,restrictionTerms} from './profession-rules.mjs';
import {normalized,mentionsProfession} from './scenario.mjs';

export function reviewProfessionCatalog(raw){
  const issues=[];
  const issue=(severity,id,field,message)=>issues.push({severity,id,field,message});
  let catalog;
  try{catalog=validateProfessionCatalog(raw);}catch(error){return {ready:false,count:raw?.professions?.length||0,issues:[{severity:'error',id:null,field:'structure',message:error.message}]};}
  const distribution={easy:0,medium:0,hard:0},seenHints=new Map();
  if(catalog.professions.length!==50)issue('error',null,'professions',`Ожидалось 50 профессий, получено ${catalog.professions.length}.`);
  const ranges={psychologicalTrace:[6,10],forbiddenWords:[12,25],forbiddenTopics:[6,10],softHints:[12,18],goodAnswers:[8,12],badAnswers:[8,12],directQuestionEvasion:[5,8],tooObviousSignals:[8,15]};
  for(const p of catalog.professions){
    distribution[p.difficulty]++;
    if(!/^[a-z]+(?:_[a-z0-9]+)*$/.test(p.id))issue('error',p.id,'id','Нужен уникальный идентификатор в latin_snake_case.');
    for(const [key,min,max] of [['description',500,900],['answerStyle',300,600]])if(p[key].length<min||p[key].length>max)issue('warning',p.id,key,`Длина ${p[key].length}; ожидается ${min}–${max} символов.`);
    for(const [key,[min,max]] of Object.entries(ranges))if(p[key].length<min||p[key].length>max)issue('warning',p.id,key,`Пунктов ${p[key].length}; ожидается ${min}–${max}.`);
    for(const key of ['psychologicalTrace','softHints','goodAnswers','directQuestionEvasion']){
      p[key].forEach((value,i)=>{
        if(revealsProfession(value,p))issue('error',p.id,`${key}[${i}]`,'Пример нарушает собственные запреты профессии: '+value);
        if(['softHints','goodAnswers'].includes(key)&&/моя работа|на работе|професси|клиент|заказчик|пациент/i.test(value))issue('error',p.id,`${key}[${i}]`,'Прямое описание работы вместо косвенной личной реакции.');
        if(key==='directQuestionEvasion'&&givesProfessionalVerdict(value))issue('error',p.id,`${key}[${i}]`,'Уклонение подтверждает или отрицает догадку: '+value);
      });
    }
    p.badAnswers.forEach((value,i)=>{if(!mentionsProfession(value,restrictionTerms(p)))issue('warning',p.id,`badAnswers[${i}]`,'Пример блокируется только при буквальном совпадении; проверь, хватает ли слов и тем для его перефразирования.');});
    for(const value of p.softHints){
      const key=normalized(value),other=seenHints.get(key);
      if(other)issue('warning',p.id,'softHints',`Такая же подсказка уже есть у ${other}: ${value}`);
      else seenHints.set(key,p.id);
    }
    // Short technical words are now matched as words with case endings, not
    // arbitrary prefixes: «ОТК» no longer bans «отказ», «баг» does not ban «багаж».
    for(const word of p.forbiddenWords)if(/^(?:время|человек|работа|дело|хорошо|плохо|короткий|жизнь|думать|делать|чувство|место|дом|руки|план)$/i.test(word)||word.length<3)issue('warning',p.id,'forbiddenWords',`Слишком общий запрет может мешать обычному диалогу: ${word}`);
  }
  for(const [level,expected] of Object.entries({easy:15,medium:25,hard:10}))if(distribution[level]!==expected)issue('warning',null,'difficulty',`${level}: ${distribution[level]}, ожидалось ${expected}.`);
  return {ready:!issues.some(i=>i.severity==='error'),count:catalog.professions.length,distribution,issues};
}

export function catalogReviewMarkdown(report){
  const lines=['# Проверка professions.json','',`Профессий: ${report.count}. Ошибок: ${report.issues.filter(i=>i.severity==='error').length}. Замечаний: ${report.issues.filter(i=>i.severity==='warning').length}.`,'','Автоматическая проверка выявляет ошибки структуры и явные противоречия. Правдоподобие профессий, естественность языка и косвенность намёков требуют отдельного чтения.',''];
  if(report.distribution)lines.push(`Сложность: ${JSON.stringify(report.distribution)}.`,'');
  for(const item of report.issues)lines.push(`- **${item.severity==='error'?'Ошибка':'Замечание'} · ${item.id||'база'} · ${item.field}:** ${item.message.replace(/\n/g,' ')}`);
  if(!report.issues.length)lines.push('Автоматические проверки пройдены.');
  return lines.join('\n')+'\n';
}
