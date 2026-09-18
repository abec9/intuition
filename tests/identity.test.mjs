import test from 'node:test';
import assert from 'node:assert/strict';
import {alignCast,nameMatchesPortrait} from '../identity.mjs';
import {portraitSlots,validateScenario} from '../scenario.mjs';
import {portraits} from '../portraits.mjs';
import {fixture} from './fixture.mjs';

test('names and patronymics must match the portrait, including older women',()=>{
  const woman=portraits.find(p=>p.gender==='женщина'&&p.age===65),man=portraitSlots[0];
  for(const name of ['Максим Андреевич','Илья','Никита','Ирина Андреевич'])assert.equal(nameMatchesPortrait(name,woman),false,name);
  for(const name of ['Любовь Андреевна','Вера Петровна','Анна'])assert.equal(nameMatchesPortrait(name,woman),true,name);
  assert.equal(nameMatchesPortrait('Илья',man),true);assert.equal(nameMatchesPortrait('Никита',man),true);
  assert.equal(nameMatchesPortrait('Максим Андреевна',man),false);
  const raw=fixture();raw.characters[1].name='Максим Андреевич';assert.throws(()=>validateScenario(raw),/Имя/);
});
test('a shuffled generated cast is attached by portrait identity and duplicate IDs are rejected',()=>{
  const characters=fixture().characters.map((p,i)=>({...p,portraitId:portraitSlots[i].id}));
  const result=alignCast({characters:[...characters].reverse()},portraitSlots);
  assert.deepEqual(result.characters,characters);
  assert.throws(()=>alignCast({characters:characters.map(p=>({...p,portraitId:portraitSlots[0].id}))},portraitSlots));
  assert.throws(()=>alignCast(fixture(),portraitSlots));
});
