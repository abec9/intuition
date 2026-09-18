import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateProfessionCatalog,loadProfessionCatalog,selectProfessions,assignProfessions} from '../profession-catalog.mjs';

function catalog(){return {version:1,professions:Array.from({length:12},(_,i)=>({
  id:`test_${i}`,title:`Тестовая профессия ${i}`,difficulty:'medium',description:'Описание работы.',
  psychologicalTrace:['Привычка проверять своё первое впечатление.'],forbiddenWords:['Запрет','Запрет'],
  softHints:['Стараюсь дать людям время исправиться.','Не спешу с первым впечатлением.','Люблю сначала понять причину.'],answerStyle:'Спокойная речь.',
  goodAnswers:['Я готов выслушать и другую сторону.'],badAnswers:['Моя профессия — тестовая.'],
  directQuestionEvasion:['Давайте познакомимся поближе.'],tooObviousSignals:['Прямое описание работы.']
}))};}

test('catalog preserves authored fields and removes duplicate restrictions without changing input',()=>{
  const raw=catalog(),before=structuredClone(raw),result=validateProfessionCatalog(raw);
  assert.deepEqual(raw,before);
  assert.deepEqual(result.professions[0].forbiddenWords,['Запрет']);
  for(const key of Object.keys(raw.professions[0]).filter(k=>k!=='forbiddenWords'))assert.deepEqual(result.professions[0][key],raw.professions[0][key]);
});

test('catalog rejects duplicate roles and incomplete entries with an actionable field name',()=>{
  const duplicate=catalog();duplicate.professions[1].title=duplicate.professions[0].title;
  assert.throws(()=>validateProfessionCatalog(duplicate),/повтор профессии/);
  const incomplete=catalog();delete incomplete.professions[0].psychologicalTrace;
  assert.throws(()=>validateProfessionCatalog(incomplete),/professions\[0\].psychologicalTrace/);
  const invalid=catalog();invalid.professions[0].softHints=[null];
  assert.throws(()=>validateProfessionCatalog(invalid),/softHints\[0\]/);
});

test('selection uses six unique authored roles, avoids the previous six and does not change catalog order',()=>{
  const raw=validateProfessionCatalog(catalog()),before=structuredClone(raw);
  const first=selectProfessions(raw),second=selectProfessions(raw,first.map(p=>p.title));
  assert.equal(new Set(first.map(p=>p.id)).size,6);
  assert(!second.some(p=>first.includes(p)));
  assert.deepEqual(raw,before);
  const six={...raw,professions:raw.professions.slice(0,6)};
  assert.equal(new Set(selectProfessions(six,six.professions.map(p=>p.id)).map(p=>p.id)).size,6);
  assert.throws(()=>selectProfessions({...raw,professions:raw.professions.slice(0,2)}),/не менее 6/);
});

test('loader reports truncated JSON and missing files, and accepts a complete UTF-8 catalog',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'intuition-catalog-')),file=join(dir,'professions.json');
  try{
    await assert.rejects(loadProfessionCatalog(file),/не найден/);
    await writeFile(file,'{"version":1,"professions":[{"id":"gardener","title":"Сад');
    await assert.rejects(loadProfessionCatalog(file),/оборванный JSON/);
    await writeFile(file,'\uFEFF'+JSON.stringify(catalog()));
    assert.equal((await loadProfessionCatalog(file)).professions.length,12);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('age constraints use a valid matching instead of an unlucky greedy assignment',()=>{
  const ordinary={id:'any'},senior={id:'senior',minAge:50};
  const assigned=assignProfessions([ordinary,senior],[{age:60},{age:22}]);
  assert.deepEqual(assigned.map(p=>p.id),['senior','any']);
  assert.throws(()=>assignProfessions([senior],[{age:22}]),/Возрастные ограничения/);
});
