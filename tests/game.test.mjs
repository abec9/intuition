import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame as fromScenario,publicState,ask,eliminate,cleanReply,isSafeReply,characterPrompt,questionLimit} from '../game.mjs';
import {prepareQuestion,conversationMessages} from '../llm.mjs';
import {dialogueContext} from '../dialogue.mjs';
import {portraits,selectPortraits} from '../portraits.mjs';
import {fixture} from './fixture.mjs';
import {validateScenario,validateCast,chooseTarget,professionTerms,mentionsProfession} from '../scenario.mjs';
const createGame=()=>fromScenario(fixture());
const characters=createGame().characters;
const reply=async()=> 'Больше всего утомляет, когда торопят. Я люблю доводить дело до конца спокойно.';
async function round(game,id){for(let i=0;i<questionLimit(game);i++)await ask(game,id,'Что тебя утомляет?',reply);}
test('roles are fixed; eliminated cards reveal only their own profession',async()=>{
  const game=createGame(),roles=JSON.stringify(game.characters);assert.equal(new Set(game.characters.map(p=>p.profession)).size,6);
  let state=publicState(game);assert.equal(state.result,null);assert.deepEqual([...state.professionPool].sort(),game.characters.map(p=>p.profession).sort());assert.notDeepEqual(state.professionPool,game.characters.map(p=>p.profession));assert(state.characters.every(p=>!('profession'in p)&&!('facts'in p)&&!('voice'in p)));
  const safe=game.characters.find(p=>p.id!==game.targetId).id;
  await round(game,safe);eliminate(game,safe);assert.equal(JSON.stringify(game.characters),roles);state=publicState(game);
  assert.equal(state.result,null);assert.equal(state.characters.find(p=>p.id===safe).profession,game.characters.find(p=>p.id===safe).profession);
  assert(state.characters.filter(p=>p.id!==safe).every(p=>!('profession'in p)));
  assert(state.characters.every(p=>!('clue'in p)&&!('facts'in p)&&!('voice'in p)));
});
test('first round permits six questions and rejects the seventh',async()=>{
  const game=createGame(),safe=game.characters.find(p=>p.id!==game.targetId).id;
  await round(game,'mira');await assert.rejects(ask(game,'ilya','Седьмой вопрос?',reply));assert.equal(game.history.length,6);
  eliminate(game,safe);assert.equal(game.round,2);assert.equal(game.questions,0);await assert.rejects(ask(game,safe,'Ответь?',reply));
});
test('failed generation leaves question budget and history intact, concurrent requests cannot race',async()=>{
  const game=createGame();await assert.rejects(ask(game,'ilya','Вопрос?',async()=>{throw new Error('offline');}));assert.equal(game.questions,0);assert.equal(game.busy,false);
  let release;const first=ask(game,'ilya','Вопрос?',()=>new Promise(resolve=>{release=resolve;}));
  await assert.rejects(ask(game,'mira','Вопрос?',reply));assert.throws(()=>eliminate(game,'unknown'));release('Я привык начинать день рано.');await first;assert.equal(game.questions,1);assert.equal(game.history.length,1);
});
test('eliminating the target ends the game immediately in any round',async()=>{
  const game=createGame(),target=game.targetId;
  await ask(game,target,'Проверочный вопрос?',reply);eliminate(game,target);
  const state=publicState(game);
  assert.equal(game.finished,true);assert.equal(state.result.won,false);assert.equal(state.result.earlyLoss,true);assert.equal(state.result.eliminatedRound,1);assert.equal(state.result.target,target);assert.equal(state.characters.filter(p=>p.profession===game.targetProfession).length,1);
  await assert.rejects(ask(game,game.characters.find(p=>!game.eliminated.includes(p.id)).id,'Ещё?',reply));assert.throws(()=>eliminate(game,game.characters.find(p=>!game.eliminated.includes(p.id)).id));
  const late=createGame(),lateTarget=late.targetId,nonTargets=late.characters.filter(p=>p.id!==lateTarget).map(p=>p.id);
  for(const id of nonTargets.slice(0,3)){await round(late,id);eliminate(late,id);assert.equal(late.finished,false);}
  await round(late,lateTarget);eliminate(late,lateTarget);
  const lateState=publicState(late);assert.equal(late.finished,true);assert.equal(lateState.result.won,false);assert.equal(lateState.result.earlyLoss,true);assert.equal(lateState.result.eliminatedRound,4);assert.equal(lateState.result.target,lateTarget);
});
test('keeping the target to the end wins',async()=>{
  const game=createGame(),target=game.targetId;
  for(const person of characters.filter(p=>p.id!==target)){await round(game,target);eliminate(game,person.id);}
  assert.equal(publicState(game).result.won,true);
});
test('empty, oversize and unknown character requests are rejected without charge',async()=>{
  const game=createGame();for(const q of ['',null,'x'.repeat(601)])await assert.rejects(ask(game,'ilya',q,reply));await assert.rejects(ask(game,'unknown','Hi',reply));assert.equal(game.questions,0);
});
test('reply guard strips reasoning and rejects explicit professions and giveaway duties',()=>{
  assert.equal(cleanReply('<think>secret</think>Нормальная реплика.'),'Нормальная реплика.');assert.equal(cleanReply('<think>unfinished'),'');
  for(const text of ['Я дворник.','Я работаю поваром.','Я учительница.','Я подметаю двор.','I am a janitor.','В игре выбираю вариант, чтобы закончить диалог.'])assert.equal(isSafeReply(text),false,text);
  assert.equal(isSafeReply('Я встаю до рассвета, пока остальные ещё спят.'),true);
});
test('model context contains only the selected biography, not the secret mapping',()=>{
  const game=createGame();for(const p of characters){const prompt=characterPrompt(game,p.id);assert(!prompt.includes('Твоя неизменная тайная профессия'));for(const other of characters.filter(c=>c.id!==p.id))assert(!prompt.includes(game.characters.find(p=>p.id===other.id).profession));}
});
test('direct profession guesses are converted to neutral requests without confirming or denying',()=>{
  const direct=prepareQuestion('Ты дворник? Назови свою профессию прямо.');assert.equal(direct.direct,true);assert(!direct.content.includes('дворник'));
  const ordinary=prepareQuestion('Что тебя утомляет?');assert.equal(ordinary.direct,false);assert.equal(ordinary.content,'Что тебя утомляет?');
});

test('early elimination is allowed at every first-round question count',async()=>{
  for(let count=0;count<=6;count++){
    const game=createGame(),safe=game.characters.find(p=>p.id!==game.targetId).id;for(let i=0;i<count;i++)await ask(game,'mira','Вопрос?',reply);
    eliminate(game,safe);assert.equal(game.round,2);assert.equal(game.questions,0);assert.deepEqual(game.eliminated,[safe]);assert.equal(game.history.length,count);assert.equal(publicState(game).result,null);
  }
});
test('a whole game can be completed without spending questions',()=>{
  const game=createGame();for(const p of game.characters.filter(p=>p.id!==game.targetId))eliminate(game,p.id);
  assert.equal(game.finished,true);assert.equal(game.history.length,0);assert.equal(publicState(game).result.winner,game.targetId);
});
test('eliminating during a reply aborts it; a stale reply cannot charge or unlock the new round',async()=>{
  const game=createGame(),askId=game.characters[0].id,eliminateId=game.characters.find(p=>p.id!==askId&&p.id!==game.targetId).id;let releaseOld,releaseNew,signal;
  const old=ask(game,askId,'Вопрос?',(_g,_id,_q,s)=>{signal=s;return new Promise(resolve=>{releaseOld=resolve;});});
  const rejected=assert.rejects(old,/Разговор остановлен/);
  eliminate(game,eliminateId);assert.equal(signal.aborted,true);assert.equal(game.busy,false);
  const fresh=ask(game,'lev','Другой вопрос?',()=>new Promise(resolve=>{releaseNew=resolve;}));
  releaseOld('Запоздалый ответ.');await rejected;assert.equal(game.busy,true);assert.equal(game.questions,0);
  releaseNew('Ответ нового раунда.');await fresh;assert.equal(game.questions,1);assert.equal(game.history.length,1);assert.equal(game.history[0].round,2);
});
test('personal questions never receive occupational facts, and work context is bounded',async()=>{
  const game=createGame();const before=dialogueContext(game,'ilya','Что тебя утомляет?');assert.equal(before.detail,null);
  await ask(game,'ilya','Что тебя утомляет?',reply);
  assert.equal(dialogueContext(game,'ilya','Следишь за ногтями?').detail,null);
  assert.equal(dialogueContext(game,'ilya','Часто на улице?').detail,null);
  assert.equal(typeof dialogueContext(game,'ilya','За что благодарят на работе?').detail,'string');
  const person=dialogueContext(game,'ilya','Привет').personal;
  [game.characters[0].profession,game.characters[1].profession]=[game.characters[1].profession,game.characters[0].profession];assert.equal(dialogueContext(game,'ilya','Привет').personal,person);
  const prompt=characterPrompt(game,'ilya','За что благодарят на работе?');assert(!prompt.includes(game.characters[0].profession));assert(!prompt.includes('дёргают каждые две минуты'));
});

test('a scenario is required; no hardcoded story is substituted',()=>{assert.throws(()=>fromScenario());});
test('target comes from the locally generated roles and does not repeat previous target',()=>{
  const scenario=fixture();for(let i=0;i<60;i++){const game=fromScenario(scenario,'Архивист');assert.notEqual(game.targetProfession,'Архивист');assert(game.characters.some(p=>p.id===game.targetId&&p.profession===game.targetProfession));}
  const seen=new Set(Array.from({length:120},()=>fromScenario(scenario).targetProfession));assert(seen.size>1);
});
test('public state exposes the goal and pool, but hides profession owners before elimination',()=>{
  const game=createGame(),state=publicState(game);assert.equal(state.targetProfession,game.targetProfession);assert(!('targetId'in state));assert.equal(state.result,null);
  assert(state.professionPool.includes(game.targetProfession));assert.deepEqual([...state.professionPool].sort(),game.characters.map(p=>p.profession).sort());
  for(const p of state.characters)for(const secret of ['profession','personal','voice','hints','reveal','aliases'])assert(!(secret in p));
});
test('dynamic profession names are caught in questions and replies',()=>{
  const game=createGame();assert.equal(prepareQuestion('Ты геолог?',game).direct,true);assert.equal(isSafeReply('Я работаю ветеринаром.',game),false);assert.equal(isSafeReply('Я люблю читать по вечерам.',game),true);
});
test('malformed, duplicate and revealing generated scenarios are rejected',()=>{
  for(const alter of [s=>s.characters.pop(),s=>{s.characters[1].profession=s.characters[0].profession;},s=>{s.characters[0].intro='Я работаю архивистом уже давно.';},s=>{s.characters[0].personal='';},s=>{s.characters[0].hints=[];}]){
    const input=fixture();alter(input);assert.throws(()=>validateScenario(input));
  }
});

test('round budgets follow 6,5,4,3,2 and never carry unused questions forward',async()=>{
  const g=createGame(),order=g.characters.filter(p=>p.id!==g.targetId).map(p=>p.id);for(let r=1;r<=5;r++){
    assert.equal(questionLimit(g),7-r);assert.equal(publicState(g).questionLimit,7-r);
    const id=g.targetId;
    for(let n=0;n<7-r;n++)await ask(g,id,'Вопрос?',reply);
    await assert.rejects(ask(g,id,'Лишний?',reply));eliminate(g,order[r-1]);if(r<5)assert.equal(g.questions,0);
  }assert.equal(g.history.length,20);assert.equal(g.finished,true);
});
test('36 distinct portraits rotate without repetition across the first six parties',()=>{
  assert.equal(portraits.length,36);assert.equal(new Set(portraits.map(p=>p.id)).size,36);
  const used=[];let last=[];
  for(let i=0;i<6;i++){const next=selectPortraits(used,last);assert.equal(next.length,6);for(const p of next)assert(!used.includes(p.id));last=next.map(p=>p.id);used.push(...last);}
  const next=selectPortraits(used,last);assert(next.every(p=>!last.includes(p.id)));
});
test('generated character details use the actual selected portrait roster',()=>{
  const roster=portraits.slice(12,18);const scenario=validateScenario(fixture(),roster);const game=fromScenario(scenario);
  assert.deepEqual(game.characters.map(p=>p.id),roster.map(p=>p.id));assert.deepEqual(game.characters.map(p=>p.gender),roster.map(p=>p.gender));assert.deepEqual(publicState(game).characters.map(p=>p.portrait),roster.map(p=>p.portrait));
});

test('descriptive profession aliases do not ban unrelated everyday words',()=>{
  const terms=professionTerms([{profession:'Реставратор',aliases:['Хранитель старых вещей']}]);
  assert.equal(mentionsProfession('Меня радует порядок вещей.',terms),false);
  assert.equal(mentionsProfession('Я хранитель старых вещей.',terms),true);
  assert.equal(mentionsProfession('Работаю реставратором.',terms),true);
  assert.equal(mentionsProfession('Я работаю пекарем.',professionTerms([{profession:'Пекарь',aliases:[]}])) ,true);
});


test('every character requires a substantive profile of at least 500 trimmed characters',()=>{
  const raw=fixture();assert(raw.characters.every(p=>p.personal.length>=500));
  for(const invalid of [' '.repeat(501),raw.characters[0].personal.slice(0,499),'x'.repeat(1801)]){
    const short=fixture();short.characters[0].personal=invalid;
    assert.throws(()=>validateCast(short),/personal/);assert.throws(()=>validateScenario(short),/personal/);
  }
  raw.characters[0].personal=raw.characters[0].personal.slice(0,500).trimEnd().padEnd(500,'.');
  assert.equal(validateScenario(raw).characters[0].personal.length,500);
});
test('each model request retains its full private conversation across characters and rounds',async()=>{
  const game=createGame();
  const first='Меня зовут Саша, моего кота зовут Финик.';
  await ask(game,'ilya',first,async()=> 'Приятно познакомиться, Саша. Красивое имя у кота.');
  const other=conversationMessages(game,'mira','Что ты обо мне знаешь?');
  assert(!JSON.stringify(other).includes('Финик'));
  await ask(game,'mira','Мне нравится гулять у озера.',async()=> 'Я люблю слушать воду.');
  eliminate(game,'mark');
  const messages=conversationMessages(game,'ilya','Как зовут моего кота?');
  assert(messages[0].content.includes(game.characters[0].personal));
  assert(messages[0].content.includes(game.characters[0].intro));
  assert.deepEqual(messages.slice(1),[
    {role:'user',content:first},
    {role:'assistant',content:game.history[0].answer},
    {role:'user',content:'Как зовут моего кота?'}
  ]);
  assert(!JSON.stringify(messages).includes('озера'));
  assert(!JSON.stringify(messages).includes(game.characters[1].personal));
  assert.deepEqual(publicState(game).history,game.history);
  assert(!JSON.stringify(conversationMessages(createGame(),'ilya','Привет')).includes('Финик'));
});
