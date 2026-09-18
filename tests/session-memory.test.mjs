import test from 'node:test';
import assert from 'node:assert/strict';
import {previousGameForGeneration,rememberGeneratedGame} from '../session-memory.mjs';

const roster=n=>Array.from({length:6},(_,i)=>({id:`p${n}-${i}`}));

test('session game log is cleared before the game after every third generated story',()=>{
  const session={game:{id:'first'},usedPortraits:[],gamesCreated:0,clearGameLogBeforeNext:false};
  for(let i=1;i<=2;i++){
    assert.equal(previousGameForGeneration(session),session.game);
    rememberGeneratedGame(session,roster(i));
    assert.equal(session.gamesCreated,i);
    assert.equal(session.clearGameLogBeforeNext,false);
    assert.equal(session.usedPortraits.length,i*6);
  }
  assert.equal(previousGameForGeneration(session),session.game);
  rememberGeneratedGame(session,roster(3));
  assert.equal(session.gamesCreated,3);
  assert.equal(session.clearGameLogBeforeNext,true);
  assert.deepEqual(session.usedPortraits,[]);
  assert.equal(previousGameForGeneration(session),null);
  assert.equal(session.clearGameLogBeforeNext,false);
  assert.deepEqual(session.usedPortraits,[]);
});
