import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {reviewProfessionCatalog} from '../catalog-review.mjs';
import {validateProfessionCatalog} from '../profession-catalog.mjs';
import {professionTerms,mentionsProfession} from '../scenario.mjs';
import {isSafeReply} from '../game.mjs';

const raw=JSON.parse(await readFile(new URL('../professions.json',import.meta.url),'utf8'));
test('the shipped modern catalog has 50 reviewed roles and no contradictory examples',()=>{
  const report=reviewProfessionCatalog(raw);
  assert.equal(report.count,50);assert.equal(report.ready,true);
  assert.deepEqual(report.distribution,{easy:15,medium:25,hard:10});
  assert.deepEqual(report.issues,[]);
  const {professions}=validateProfessionCatalog(raw);
  const terms=professionTerms(professions.map(p=>({profession:p.title,aliases:p.aliases})));
  for(const p of professions){
    const game={terms,characters:[{id:p.id,professionRules:p}]};
    for(const key of ['softHints','goodAnswers','directQuestionEvasion'])for(const answer of p[key])assert(isSafeReply(answer,game,p.id),p.id+': '+answer);
    for(const answer of p.badAnswers)assert.equal(isSafeReply(answer,game,p.id),false,p.id+': '+answer);
  }
});

test('short words do not ban unrelated prefixes and inflected phrases still match',()=>{
  assert.equal(mentionsProfession('Я оставляю за собой право на отказ.',['отк']),false);
  assert.equal(mentionsProfession('Мой багаж уже собран.',['баг']),false);
  assert.equal(mentionsProfession('Кодекс мне знаком.',['код']),false);
  assert.equal(mentionsProfession('В этом коде были баги.',['код','баг']),true);
  assert.equal(mentionsProfession('Меня радует встреча.',professionTerms([{profession:'Повар',aliases:['меню']}])) ,false);
  assert.equal(mentionsProfession('Это хранитель старых вещей.',professionTerms([{profession:'Реставратор',aliases:['хранитель старых вещей']}])) ,true);
});
