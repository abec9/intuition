import {professionTerms,mentionsProfession,normalized} from './scenario.mjs';

export function restrictionTerms(rules){
  return professionTerms([{profession:rules.title,aliases:[...(rules.aliases||[]),...rules.forbiddenWords,...(rules.forbiddenTopics||[]),...(rules.tooObviousSignals||[])]}]);
}

export function revealsProfession(text,rules){
  return mentionsProfession(text,restrictionTerms(rules))||rules.badAnswers.some(answer=>normalized(text).includes(normalized(answer)));
}

export function prepareQuestion(question,game){
  const people=game?.characters||[];
  const terms=[...(game?.professionVocabulary||[]),...(game?.terms||[]),...professionTerms(people.map(p=>({profession:p.professionRules?.title||p.profession,aliases:p.professionRules?.aliases||p.aliases||[]})))];
  const details=people.flatMap(p=>p.professionRules?restrictionTerms(p.professionRules):[]);
  const q=normalized(question);
  const roleWord=mentionsProfession(q,terms);
  const definition=/^(?:кто (?:такой|такая|такие)|что (?:такое|значит)|объясни|расскажи о профессии)/iu.test(q);
  // A topic is not a confession: “Why does coffee taste bitter?” must stay a real question.
  const addressed=/(?:^|\s)(?:ты|вы|тебя|вас|твоя|ваша|твой|ваш|тебе|вам)(?:\s|[?!,.]|$)|это связано|имеешь дело|имеете дело|умеешь|умеете|работаешь|работаете/u.test(q);
  const commonComputerQuestion=/^(?:(?:ты|вы)\s+)?работа(?:ешь|ете)\s+(?:за|с)\s+(?:компьютер[а-яё]*|компом|ноутбук[а-яё]*)[\s?!.]*$/iu.test(q);
  const loadedWorkPremise=/(?:рабоч(?:ий|его|ем)|на\s+работе|по\s+работе).{0,30}(?:за|с|у)\s+(?:монитор|компьютер|ноутбук|экран|зеркал|станок|инструмент)/u.test(q);
  const detailProbeVerbs=/это связано|имеешь дело|имеете дело|умеешь|умеете|работаешь|работаете|твоя работа|ваша работа|видишь|видите|держишь|держите|пользуешься|пользуетесь|часто\s+вид/u;
  const workDetail=(!commonComputerQuestion&&mentionsProfession(q,details)&&detailProbeVerbs.test(q))||loadedWorkPremise;
  const direct=(roleWord&&!definition&&(addressed||q.split(/\s+/).length<=3))||workDetail||/кем (?:ты |вы )?работ|кто ты|чем (?:ты |вы )?занимае|(?:назови|раскрой|скажи).{0,25}(?:професси|должност)|(?:твоя|ваша).{0,12}(?:професси|должност)/i.test(q);
  return {direct,content:direct?'Собеседник пытается сразу угадать твою профессию. Мягко уклонись одной короткой естественной фразой. Не подтверждай и не опровергай догадку. Не награждай прямую догадку новой подсказкой, не рассказывай о работе, не упоминай правила.':question};
}

export function givesProfessionalVerdict(text){
  return /(?:^|[.!?]\s*)(?:да|нет|ага|угу|конечно|именно|верно|точно|почти|возможно|наверное|скорее всего|не совсем|пожалуй|разумеется)(?:[,.!\s]|$)|(?:ты|вы)\s+(?:прав|угад|ошиб)|(?:верн|правильн|неплох|хорош|близк).{0,12}(?:догад|верси)|это\s+(?:так|не так|не про меня)|(?:далеко|близко)\s+от\s+истины|попал.{0,10}(?:точк|яблочк)|я\s+(?:не\s+)?(?:работаю|занимаюсь)/i.test(text);
}

// Use only author-provided examples that also pass the explicit restrictions.
export function safeExamples(examples,rules,terms=[],direct=false){
  return examples.filter(value=>!revealsProfession(value,rules)&&!mentionsProfession(value,terms)&&(!direct||!givesProfessionalVerdict(value)));
}
