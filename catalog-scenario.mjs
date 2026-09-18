import {randomInt} from 'node:crypto';
import {characterProfiles} from './characters.mjs';
import {loadProfessionCatalog,selectProfessions,assignProfessions,ProfessionCatalogError} from './profession-catalog.mjs';
import {professionTerms,validateScenario,mentionsProfession} from './scenario.mjs';
import {safeExamples} from './profession-rules.mjs';
import {portraitSlots} from './scenario.mjs';

const settings=[
 ['Вечерняя встреча','За окном постепенно темнеет. Шестеро незнакомцев собрались за большим столом и присматриваются друг к другу.'],
 ['Дождливый выходной','По стеклу стучит дождь. Пахнет свежим чаем, и никто из собравшихся не торопится уходить.'],
 ['Перед началом','До общего вечера ещё есть время. Шестеро гостей знакомятся, пока остальные не подошли.'],
 ['После прогулки','За окном мягкий вечерний свет. Разговор начинается с коротких реплик и осторожных улыбок.'],
 ['Субботнее знакомство','Встреча только начинается. Слышен тихий смех, и у каждого найдётся своя история для разговора.']
];

export function createCatalogScenario(catalog,previousProfessions=[],roster=portraitSlots){
  const selected=assignProfessions(selectProfessions(catalog,previousProfessions),roster);
  const terms=professionTerms(selected.map(p=>({profession:p.title,aliases:p.aliases})));
  const characters=roster.map((slot,i)=>{
    const person=characterProfiles.find(p=>p.id===slot.id),rules=selected[i];
    if(!person)throw new ProfessionCatalogError(`Не найден личный портрет ${slot.id}.`);
    const hints=safeExamples(rules.softHints,rules,terms).filter(t=>t.trim().length>=12&&t.length<=220);
    if(hints.length<3)throw new ProfessionCatalogError(`В справочнике «${rules.title}» меньше трёх безопасных подсказок. Проверь softHints и ограничения этой профессии.`);
    const shuffled=[...hints];for(let j=shuffled.length-1;j>0;j--){const k=randomInt(j+1);[shuffled[j],shuffled[k]]=[shuffled[k],shuffled[j]];}
    const sentence=rules.description.match(/^.{20,350}?(?:[.!?](?:\s|$)|$)/u)?.[0]?.trim();
    const reveal=sentence||`Скрытая профессия — ${rules.title}. Косвенные подсказки отражают привычки внимания и отношение к ответственности.`;
    // A biography is independent of the role; reject accidental explicit role names.
    if([person.personal,person.intro,person.name,person.trait].some(t=>mentionsProfession(t,terms)))throw new ProfessionCatalogError('Личный портрет случайно называет одну из профессий. Нужно проверить совместимость справочника с биографиями.');
    return {...person,profession:rules.title,aliases:[rules.title,...rules.aliases.filter(a=>a!==rules.title)].slice(0,3),hints:shuffled.slice(0,3),reveal,professionRules:structuredClone({...rules,softHints:shuffled})};
  });
  const options=settings.filter(s=>!s.some(t=>mentionsProfession(t,terms)));
  const [title,setting]=(options.length?options:settings)[randomInt((options.length?options:settings).length)];
  return {...validateScenario({title,setting,characters},roster),professionVocabulary:professionTerms(catalog.professions.map(p=>({profession:p.title,aliases:p.aliases})))};
}

export async function prepareCatalogScenario(previousProfessions=[],roster=portraitSlots){
  // Read afresh for each new game; edits never mutate roles in an existing game.
  const file=process.env.PROFESSIONS_FILE||new URL('./professions.json',import.meta.url);
  return createCatalogScenario(await loadProfessionCatalog(file),previousProfessions,roster);
}
