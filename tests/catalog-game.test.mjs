import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogFixture} from './catalog-fixture.mjs';
import {validateProfessionCatalog} from '../profession-catalog.mjs';
import {createCatalogScenario} from '../catalog-scenario.mjs';
import {characterProfiles} from '../characters.mjs';
import {portraits,selectPortraits} from '../portraits.mjs';
import {nameMatchesPortrait} from '../identity.mjs';
import {createGame,publicState,ask,eliminate,isSafeReply,characterPrompt} from '../game.mjs';
import {conversationMessages,prepareQuestion} from '../llm.mjs';
import {dialogueContext} from '../dialogue.mjs';
import {reviewProfessionCatalog} from '../catalog-review.mjs';

function game(){return createGame(createCatalogScenario(validateProfessionCatalog(catalogFixture())));}

test('all 36 authored biographies have matching names and at least 500 characters',()=>{
  assert.equal(characterProfiles.length,36);
  assert.equal(new Set(characterProfiles.map(p=>p.personal)).size,36);
  for(const p of characterProfiles){assert(nameMatchesPortrait(p.name,p));assert(p.personal.length>=500&&p.personal.length<=1800);}
});

test('catalog games start without model requests; roles are fixed, distinct and independent of appearance',async(t)=>{
  t.mock.method(globalThis,'fetch',()=>{throw Error('Starting a game must not contact the model');});
  const catalog=validateProfessionCatalog(catalogFixture()),roster=portraits.slice(0,6),seen=new Set();
  for(let n=0;n<20;n++){
    const scenario=createCatalogScenario(catalog,[],roster),g=createGame(scenario);
    assert.equal(new Set(g.characters.map(p=>p.profession)).size,6);
    assert(g.characters.some(p=>p.profession===g.targetProfession));
    for(let i=0;i<6;i++)assert.equal(g.characters[i].personal,characterProfiles[i].personal);
    const state=publicState(g);seen.add(g.characters[0].profession);
    for(const p of state.characters)for(const key of ['profession','professionRules','personal','aliases','hints','description','forbiddenWords'])assert(!(key in p));
    assert(!('dialogueMemory' in state));
    const before=structuredClone(g.characters);
    await ask(g,g.characters[0].id,'Привет',async()=> 'Мне приятно познакомиться.');
    eliminate(g,g.characters[1].id);
    assert.deepEqual(g.characters,before);
  }
  assert(seen.size>1);
  const first=createCatalogScenario(catalog),second=createCatalogScenario(catalog,first.characters.map(p=>p.profession),selectPortraits());
  assert(!second.characters.some(p=>first.characters.some(old=>old.profession===p.profession)));
});

test('only selected private dossier and personal conversation reach the model',async()=>{
  const g=game(),[p,other]=g.characters;
  await ask(g,p.id,'Я Саша, моего кота зовут Финик.',async()=> 'Рада знакомству, Саша.');
  await ask(g,other.id,'Моя собака — Рекс.',async()=> 'Спасибо, что рассказали.');
  const prompt=characterPrompt(g,p.id),messages=JSON.stringify(conversationMessages(g,p.id,'Помнишь имя моего кота?'));
  assert(prompt.includes(p.professionRules.description));
  assert(prompt.includes(p.profession));
  for(const c of g.characters.filter(c=>c.id!==p.id)){assert(!prompt.includes(c.profession));assert(!prompt.includes(c.personal));}
  assert(messages.includes('Финик'));assert(!messages.includes('Рекс'));
  assert.deepEqual(conversationMessages(g,p.id,'Привет').map(m=>m.role),['system','user','assistant','user']);
});

test('professional clues and direct guesses have separate private memory and survive rounds',async()=>{
  const g=game(),[p,other,third]=g.characters,reply=async()=> 'Мне важно сначала понять человека.';
  await ask(g,p.id,'Привет',reply);
  const first=dialogueContext(g,p.id,'Что утомляет?').detail;
  assert(first);
  await ask(g,p.id,'Что утомляет?',reply);
  assert(g.dialogueMemory[p.id].offeredHints.includes(first));
  assert.notEqual(dialogueContext(g,p.id,'За что благодарят?').detail,first);
  assert.equal(dialogueContext(g,other.id,'За что благодарят?').detail,null);
  await ask(g,p.id,`Ты ${p.profession}?`,reply);
  assert.equal(g.dialogueMemory[p.id].directGuesses,1);
  assert.equal(g.dialogueMemory[p.id].offeredHints.length,1);
  eliminate(g,third.id);
  assert.notEqual(dialogueContext(g,p.id,'Что утомляет?').detail,first);
  assert(!('dialogueMemory' in publicState(g)));
});

test('aliases, restricted roots and topics block leaks, while ordinary words remain allowed',()=>{
  const g=game(),p=g.characters.find(p=>p.profession==='Архитектор')||g.characters[0];
  p.professionRules={...p.professionRules,title:'Архитектор',aliases:['Зодчий'],forbiddenWords:['чертёж','здан','стро','фасад'],forbiddenTopics:['строительные нормы'],badAnswers:[],tooObviousSignals:[]};
  for(const text of ['Я занят чертежами.','Я возводил здания.','Это зодчий.','Я знаю строительные нормы.'])assert.equal(isSafeReply(text,g,p.id),false,text);
  assert.equal(isSafeReply('Я предпочитаю сначала выслушать человека.',g,p.id),true);
  for(const q of ['Ты умеешь читать чертежи?','Ты зодчий?','Это связано со стройкой?']){
    const prepared=prepareQuestion(q,g);assert(prepared.direct,q);assert(!prepared.content.includes(q));
  }
});

test('review catches safe examples that violate the same profession restrictions',()=>{
  const raw=catalogFixture();raw.professions[0].goodAnswers=['Мне нравятся красивые фасады.'];raw.professions[0].directQuestionEvasion=['Почти, ты прав.'];
  const report=reviewProfessionCatalog(raw);
  assert.equal(report.ready,false);
  assert(report.issues.some(i=>i.id==='role_0'&&i.field==='goodAnswers[0]'&&i.severity==='error'));
  assert(report.issues.some(i=>i.id==='role_0'&&i.field==='directQuestionEvasion[0]'&&i.severity==='error'));
});

