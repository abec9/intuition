// Naming rules for fictional Russian-language characters, not gender inference about users.
const maleVowel=new Set(['илья','никита','кузьма','фома','лука','савва','данила']);
const femaleConsonant=new Set(['любовь','нинель','рашель','эсфирь','руфь','жизель','адель']);
const ambiguous=new Set(['саша','женя','валя','шура','слава']);
export function nameMatchesPortrait(name,slot){
  if(typeof name!=='string')return false;
  const parts=name.trim().toLowerCase().replace(/ё/g,'е').split(/\s+/),first=parts[0];
  if(ambiguous.has(first)||!first)return false;
  const gender=maleVowel.has(first)?'мужчина':femaleConsonant.has(first)?'женщина':/[ая]$/.test(first)?'женщина':/[бвгджзйклмнпрстфхцчшщь]$/.test(first)?'мужчина':null;
  if(gender!==slot.gender)return false;
  return !parts.slice(1).some(p=>slot.gender==='женщина'?/(?:ович|евич|ич)$/.test(p):/(?:овна|евна|ична)$/.test(p));
}
export function alignCast(raw,roster){
  if(!Array.isArray(raw?.characters)||raw.characters.length!==roster.length)throw new Error('Нужны все шесть персонажей.');
  const byId=new Map(raw.characters.map(p=>[p.portraitId,p]));
  if(byId.size!==roster.length||roster.some(p=>!byId.has(p.id)))throw new Error('Каждый персонаж должен иметь точный portraitId выбранного портрета.');
  return {...raw,characters:roster.map(p=>byId.get(p.id))};
}
