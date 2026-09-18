import {prepareQuestion} from './profession-rules.mjs';

export function dialogueContext(game,id,question=''){
  const person=game.characters.find(p=>p.id===id);
  const history=game.history.filter(h=>h.characterId===id);
  const aboutWork=/работ|утомл|уста[её]|устав|раздраж|спасибо|благодар|результат|ошиб|горди|трудн|обычный день|день прош[её]л/i;
  const relevant=aboutWork.test(question);
  const previous=history.filter(h=>aboutWork.test(h.question)).length;
  const hints=person.professionRules?.softHints||person.hints;
  const used=game.dialogueMemory?.[id]?.offeredHints||[];
  const detail=relevant&&history.length>0&&!prepareQuestion(question,game).direct?(person.professionRules?hints.find(h=>!used.includes(h))||null:person.hints[previous%person.hints.length]):null;
  return {personal:person.personal,detail};
}

export function rememberDialogue(game,id,question,context){
  game.dialogueMemory??={};
  const memory=game.dialogueMemory[id]??={offeredHints:[],directGuesses:0,tone:'нейтральный'};
  if(context.detail&&!memory.offeredHints.includes(context.detail))memory.offeredHints.push(context.detail);
  if(prepareQuestion(question,game).direct)memory.directGuesses++;
  if(/дурак|тупой|заткнись|идиот/i.test(question))memory.tone='резкий';
  else if(/спасибо|пожалуйста|приятно|рад знакомству/i.test(question))memory.tone='доброжелательный';
}
