import {readFile} from 'node:fs/promises';
import {randomInt} from 'node:crypto';

export class ProfessionCatalogError extends Error {
  constructor(message){super(message);this.name='ProfessionCatalogError';}
}

const listFields=['psychologicalTrace','forbiddenWords','softHints','goodAnswers','badAnswers'];
const normalized=value=>value.normalize('NFKC').toLowerCase().replace(/ё/g,'е');
function text(value,field){
  if(typeof value!=='string'||!value.trim())throw new ProfessionCatalogError(`professions.json: ${field} должен содержать непустой текст.`);
  return value.trim();
}

// Validate authored data without repairing or inventing missing profession records.
export function validateProfessionCatalog(raw){
  if(!raw||raw.version!==1)throw new ProfessionCatalogError('professions.json: поддерживается version: 1.');
  if(!Array.isArray(raw.professions)||!raw.professions.length)throw new ProfessionCatalogError('professions.json: нужен непустой массив professions.');
  const ids=new Set(),titles=new Set();
  const professions=raw.professions.map((entry,index)=>{
    const prefix=`professions[${index}]`;
    if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new ProfessionCatalogError(`professions.json: ${prefix} должен быть объектом.`);
    const result={};
    for(const key of ['id','title','difficulty','description','answerStyle'])result[key]=text(entry[key],`${prefix}.${key}`);
    if(!/^[a-z]+(?:_[a-z0-9]+)*$/.test(result.id))throw new ProfessionCatalogError(`professions.json: ${prefix}.id должен быть в latin_snake_case.`);
    if(result.title.length>60)throw new ProfessionCatalogError(`professions.json: ${prefix}.title длиннее 60 символов.`);
    if(!['easy','medium','hard'].includes(result.difficulty))throw new ProfessionCatalogError(`professions.json: ${prefix}.difficulty — easy, medium или hard.`);
    if(ids.has(result.id)||titles.has(normalized(result.title)))throw new ProfessionCatalogError(`professions.json: повтор профессии ${result.id} / ${result.title}.`);
    ids.add(result.id);titles.add(normalized(result.title));
    for(const key of listFields){
      if(!Array.isArray(entry[key])||!entry[key].length)throw new ProfessionCatalogError(`professions.json: ${prefix}.${key} должен быть непустым массивом строк.`);
      result[key]=[...new Set(entry[key].map((value,i)=>text(value,`${prefix}.${key}[${i}]`)))];
    }
    for(const key of ['aliases','forbiddenTopics','directQuestionEvasion','tooObviousSignals']){
      if(entry[key]!==undefined&&!Array.isArray(entry[key]))throw new ProfessionCatalogError(`professions.json: ${prefix}.${key} должен быть массивом строк.`);
      result[key]=[...new Set((entry[key]||[]).map((value,i)=>text(value,`${prefix}.${key}[${i}]`)))];
    }
    if(result.softHints.length<3)throw new ProfessionCatalogError(`professions.json: ${prefix}.softHints — нужны хотя бы 3 разные подсказки.`);
    for(const key of ['minAge','maxAge'])if(entry[key]!==undefined){
      if(!Number.isInteger(entry[key])||entry[key]<18||entry[key]>120)throw new ProfessionCatalogError(`professions.json: ${prefix}.${key} должен быть целым возрастом от 18 до 120.`);
      result[key]=entry[key];
    }
    if((result.minAge||18)>(result.maxAge||120))throw new ProfessionCatalogError(`professions.json: ${prefix}.minAge больше maxAge.`);
    return result;
  });
  return {version:1,professions};
}

export async function loadProfessionCatalog(file=new URL('./professions.json',import.meta.url)){
  let source;
  try{source=await readFile(file,'utf8');}
  catch(error){throw new ProfessionCatalogError(error.code==='ENOENT'?'Файл professions.json не найден. Добавь полный справочник в папку игры.':'Не удалось прочитать professions.json. Проверь доступ к файлу.');}
  let raw;
  try{raw=JSON.parse(source.replace(/^\uFEFF/,''));}
  catch{throw new ProfessionCatalogError('professions.json содержит некорректный или оборванный JSON. Нужен полный файл; генерация ещё не запущена.');}
  return validateProfessionCatalog(raw);
}

export function selectProfessions(catalog,previousProfessions=[],count=6){
  if(!Number.isInteger(count)||count<1)throw new ProfessionCatalogError('Количество профессий должно быть положительным целым числом.');
  if(catalog.professions.length<count)throw new ProfessionCatalogError(`В professions.json только ${catalog.professions.length} профессий. Для этой партии нужно не менее ${count} разных профессий.`);
  const previous=new Set(previousProfessions.map(normalized));
  const fresh=[],recent=[];
  for(const entry of catalog.professions)(previous.has(normalized(entry.id))||previous.has(normalized(entry.title))?recent:fresh).push(entry);
  function shuffle(items){for(let i=items.length-1;i>0;i--){const j=randomInt(i+1);[items[i],items[j]]=[items[j],items[i]];}return items;}
  return shuffle([...shuffle(fresh),...shuffle(recent)].slice(0,count));
}

export function assignProfessions(professions,roster){
  // Backtracking avoids missing a valid assignment when a constrained role
  // needs a portrait that an unconstrained role could otherwise take first.
  function assign(index,remaining){
    if(index===roster.length)return [];
    for(const profession of remaining){
      if(roster[index].age<(profession.minAge||18)||roster[index].age>(profession.maxAge||120))continue;
      const rest=assign(index+1,remaining.filter(p=>p!==profession));
      if(rest)return [profession,...rest];
    }
    return null;
  }
  if(professions.length!==roster.length)throw new ProfessionCatalogError('Для каждого персонажа нужна отдельная профессия.');
  const assignment=assign(0,professions);
  if(!assignment)throw new ProfessionCatalogError('Возрастные ограничения профессий не подходят выбранным персонажам. Проверь minAge/maxAge в справочнике.');
  return assignment;
}
