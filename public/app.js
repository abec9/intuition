const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state=null,selected='ilya',busy=false,asking=false,pending=null,confirmAction=null,pollTimer=null;
const suggestionBank=[
  ['Что вы замечаете раньше других?','Что в работе приносит вам удовольствие?','За что вас чаще всего благодарят?','Какая мелочь может испортить вам результат?','Какую привычку с работы вы принесли в обычную жизнь?'],
  ['Как вы понимаете, что дело сделано хорошо?','Что вас раздражает в подходе новичков?','Как поступаете, когда вас торопят?','В какой момент вам нужна помощь других?','Что вы предпочитаете перепроверить лично?'],
  ['Какую ошибку легко не заметить, но трудно исправить?','Когда вы готовы сказать: так оставлять нельзя?','Что важнее в спорной ситуации и почему?','Что вы делаете, если проблема повторяется?','Что отличает хороший результат от просто приемлемого?'],
  ['В чём вы чаще всего не соглашаетесь с другими по работе?','Чем вы не готовы пожертвовать ради скорости?','Как вы понимаете, что нужно остановиться и переделать?','Какое решение требует от вас больше всего внимания?','Что вы проверяете перед тем, как закончить дело?'],
  ['Какое замечание о вашей работе было бы самым неприятным?','Когда внешне хороший результат вас не устраивает?','За какое решение вам приходится отвечать лично?','Как вы объясняете человеку, что результат пока не готов?','Какой профессиональный принцип труднее всего соблюдать?']
];
const api=async(path,data)=>{
  const response=await fetch(path,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json','X-Intuition-Client':'1'}:{},body:data?JSON.stringify(data):undefined});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Не удалось связаться с ведущим.');return result;
};
const setError=message=>{$('error').textContent=message||'';$('error').hidden=!message;};
const requestId=()=>globalThis.crypto?.randomUUID?.()||`req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const selectedPerson=()=>state?.characters.find(p=>p.id===selected);
function hashText(text){let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return hash>>>0;}
function roundSuggestions(){
  if(!state?.id||!selected)return [];
  const base=suggestionBank[Math.min(Math.max(state.round,1),suggestionBank.length)-1]||suggestionBank[0];
  const used=new Set(state.history.filter(h=>h.characterId===selected&&h.round===state.round).map(h=>h.question.trim().toLowerCase()));
  return [...base]
    .map((text,i)=>({text,rank:hashText(`${state.id}:${state.round}:${selected}:${i}:${text}`)}))
    .sort((a,b)=>a.rank-b.rank)
    .map(x=>x.text)
    .filter(text=>!used.has(text.toLowerCase()))
    .slice(0,3);
}
function updateState(next){
  state=next;
  if(!state.characters.some(p=>p.id===selected))selected=state.characters[0]?.id||null;
  render();
  clearTimeout(pollTimer);
  if(state.preparing||(state.busy&&!busy))pollTimer=setTimeout(async()=>{try{updateState(await api('/api/game'));}catch(e){showPreparationError(e.message);}},1500);
}
function select(id){
  if(!state?.characters.some(p=>p.id===id))throw new Error('Неизвестный персонаж.');
  selected=id;setError('');render();
}
function renderPeople(){
  $('people').replaceChildren(...state.characters.map((p,i)=>{
    const excluded=state.eliminated.includes(p.id),active=p.id===selected;
    const b=document.createElement('button');b.type='button';b.className='person-card'+(active?' selected':'')+(excluded?' excluded':'');b.setAttribute('aria-pressed',String(active));
    b.setAttribute('aria-label',`${p.name}, ${p.age}. ${p.trait}${excluded?'. Исключён':''}${p.profession?'. '+p.profession:''}`);
    const count=state.history.filter(h=>h.characterId===p.id).length;
    b.innerHTML=`<div class="portrait" style="--pos:${p.portrait.x}% ${p.portrait.y}%;background-image:url('${escape(p.portrait.sheet)}')"></div><span class="card-number">0${i+1}</span>${active?`<span class="selected-label">${state.finished?'ИСТОРИЯ':excluded?'ИСКЛЮЧЁН':state.questions===state.questionLimit?'ВЫБРАН':'В РАЗГОВОРЕ'}</span>`:''}${count?`<span class="question-badge">${count} ${count===1?'ответ':count<5?'ответа':'ответов'}</span>`:''}<div class="card-info"><h3>${escape(p.name)}</h3><p>${excluded?'Исключён':`${p.age} · ${escape(p.trait.split(',')[0].toLowerCase())}`}</p>${p.profession?`<p class="role">${escape(p.profession)}${p.id===state.result?.target?' ✧':''}</p>`:''}</div>`;
    b.onclick=()=>select(p.id);return b;
  }));
}
function entry(kind,speaker,text){const el=document.createElement('div');el.className='chat-entry '+kind;const label=document.createElement('div');label.className='speaker';label.textContent=speaker;const content=document.createElement('p');content.textContent=text;el.append(label,content);return el;}
function renderChat(){
  const p=selectedPerson(),i=state.characters.indexOf(p),feed=$('chat-feed'),history=state.history.filter(h=>h.characterId===selected);
  $('chat-name').textContent=p.name;$('chat-trait').textContent=p.trait;$('mini-portrait').style.backgroundPosition=`${p.portrait.x}% ${p.portrait.y}%`;$('mini-portrait').style.backgroundImage=`url('${p.portrait.sheet}')`;
  feed.replaceChildren();
  if(!history.length){
    const empty=document.createElement('div');empty.className='empty-chat';empty.innerHTML=`<span class="quote-mark">“</span><blockquote>${escape(p.intro)}</blockquote><p>${state.finished?'В этой игре вы не разговаривали.':state.eliminated.includes(p.id)?`Этот персонаж уже покинул игру. Его профессия: ${escape(p.profession)}.`:'Начни с простого вопроса. Иногда маленькая деталь рассказывает больше, чем целая история.'}</p>`;feed.append(empty);
  }
  for(const h of history){feed.append(entry('user','ТЫ · РАУНД '+h.round,h.question),entry('answer',p.name.toUpperCase(),h.answer));}
  if(pending&&pending.characterId===selected&&busy){feed.append(entry('user','ТЫ',pending.question),entry('thinking',p.name.toUpperCase(),'Обдумывает ответ…'));}
  if(p.profession)feed.append(entry('answer','ПРОФЕССИЯ · '+p.profession.toUpperCase(),state.finished?p.clue:'Эта роль раскрыта после исключения.'));
  feed.scrollTop=feed.scrollHeight;
}
function showPreparationError(message){$('preparation').hidden=false;$('preparation-title').textContent='История пока не готова';$('preparation-text').textContent=message;$('retry-scenario').hidden=false;$('new-button').disabled=false;}
function renderProfessionPool(){
  $('profession-pool').replaceChildren();
  if(!state?.professionPool?.length)return;
  const label=document.createElement('span');label.textContent='Профессии в деле:';
  $('profession-pool').append(label,...state.professionPool.map(title=>{const item=document.createElement('b');item.textContent=title;return item;}));
}
function render(){
  if(!state)return;
  const preparing=state.preparing||busy&&!state.id;
  $('preparation').hidden=!preparing&&!!state.id;
  $('game-layout').hidden=preparing||!state.id;
  $('new-button').disabled=preparing||busy;
  $('retry-scenario').hidden=preparing;
  if(preparing){$('preparation-title').textContent='Собираем новую встречу';$('preparation-text').textContent='Выбираем участников и случайно распределяем скрытые профессии.';}
  if(state.generationError)showPreparationError(state.generationError);
  if(preparing||!state.id){$('result').hidden=true;$('case-title').textContent='Новая история';$('case-label').textContent='ЗА КУЛИСАМИ';$('case-setting').textContent='Шесть незнакомцев, шесть скрытых профессий. Ответы рождаются в разговоре.';$('profession-pool').replaceChildren();return;}
  $('case-title').innerHTML='Кто из них — <em>'+escape(state.targetProfession)+'?</em>';
  $('case-label').textContent=state.title;
  $('case-setting').textContent=state.setting;
  renderProfessionPool();
  renderPeople();renderChat();
  const excluded=state.eliminated.includes(selected),locked=busy||state.busy;
  $('remaining').textContent=String(6-state.eliminated.length).padStart(2,'0');
  $('round').textContent=state.finished?'ДЕЛО ЗАКРЫТО':`РАУНД ${String(state.round).padStart(2,'0')} / 05`;
  $('progress').setAttribute('aria-label',`Задано ${state.questions} из ${state.questionLimit} вопросов`);
  $('progress').replaceChildren(...Array.from({length:state.questionLimit},(_,i)=>{const dot=document.createElement('i');dot.classList.toggle('filled',i<state.questions);return dot;}));
  $('board-title').textContent=state.finished?'Маски сняты':state.questions===state.questionLimit?'Одному придётся уйти':'Круг подозреваемых';
  $('board-hint').textContent=state.finished?'Все профессии раскрыты':state.questions===state.questionLimit?'Выбери, кого исключить':'Выбери, с кем поговорить';
  $('eliminated-count').textContent=state.eliminated.length+' исключено';
  $('composer-area').hidden=state.finished||state.questions===state.questionLimit||excluded;
  $('elimination-box').hidden=state.finished;
  $('elimination-box').classList.toggle('compact',state.questions<state.questionLimit);
  $('elimination-note').textContent=state.questions===state.questionLimit?'Вопросы этого тура закончились. Выбери, кого исключить.':'Можно исключить сейчас или продолжить разговор.';
  $('eliminate-button').textContent=excluded?'Этот персонаж уже исключён':`Исключить: ${selectedPerson().name}`;
  $('eliminate-button').disabled=excluded||(busy&&!asking);
  $('question').disabled=locked||excluded||state.finished||state.questions===state.questionLimit;
  $('send-button').disabled=$('question').disabled||!$('question').value.trim();
  $('new-button').disabled=locked;
  const remaining=state.questionLimit-state.questions;
  $('question-count').textContent=locked?'Ждём ответ…':remaining===1?'Остался 1 вопрос':`Осталось ${remaining} ${remaining>=5?'вопросов':'вопроса'}`;
  $('suggestions').replaceChildren();
  for(const text of roundSuggestions()){const b=document.createElement('button');b.type='button';b.textContent=text;b.disabled=locked;b.onclick=()=>{$('question').value=text;$('send-button').disabled=$('question').disabled||!$('question').value.trim();$('question').focus();};$('suggestions').append(b);}
  $('result').hidden=!state.finished;
  if(state.finished){const target=state.characters.find(p=>p.id===state.result.target),winner=state.characters.find(p=>p.id===state.result.winner),early=state.result.earlyLoss;let body;
    if(early)body=`<p>Искомая профессия: <strong>${escape(state.targetProfession)}</strong>. Ты исключил правильную карточку в раунде ${state.result.eliminatedRound}: это была <strong>${escape(target.name)}</strong>. Игра прервана сразу, чтобы ошибка не тянулась до финала.</p>`;
    else body=`<p>Искомая профессия: <strong>${escape(state.targetProfession)}</strong>. Твой выбор — <strong>${escape(winner.name)}</strong>. ${state.result.won?'И это правильный ответ.':`Правильный ответ — <strong>${escape(target.name)}</strong>. Профессия персонажа ${escape(winner.name)}: ${escape(winner.profession)}.`}</p>`;
    $('result').innerHTML=`<span class="eyebrow">${state.result.won?'ТОЧНОЕ ПОПАДАНИЕ':early?'РАННЕЕ ИСКЛЮЧЕНИЕ':'НЕОЖИДАННАЯ РАЗВЯЗКА'}</span><h2>${state.result.won?'Интуиция тебя не подвела.':early?'Правильная карточка ушла слишком рано.':'За первым впечатлением скрывалось другое.'}</h2>${body}<p>${escape(target.clue)} Выбери любой портрет, чтобы перечитать разговор и узнать его историю.</p><button class="primary" id="play-again">Новая история ↻</button>`;$('play-again').onclick=()=>newGame();}
}
async function submitQuestion(input){
  if(busy||state?.busy||state?.preparing)throw new Error('Дождись ответа.');
  const question=(input??$('question').value).trim();if(!question)return;
  if(!state?.id||state.finished||state.questions>=state.questionLimit||state.eliminated.includes(selected))throw new Error('Сейчас нельзя задавать вопрос этому персонажу.');
  busy=true;asking=true;setError('');
  if(!pending||pending.characterId!==selected||pending.question!==question||pending.gameId!==state.id)pending={gameId:state.id,characterId:selected,question,requestId:requestId()};
  const activeQuestion=pending;
  render();
  try{const next=await api('/api/ask',activeQuestion);if(pending!==activeQuestion)return {cancelled:true};asking=false;$('question').value='';pending=null;busy=false;updateState(next);$('connection').textContent='Локальная модель · на связи';return {questions:state.questions,answer:state.history.at(-1)?.answer};}
  catch(e){if(pending!==activeQuestion)return {cancelled:true};asking=false;busy=false;setError(e.message);try{const latest=await api('/api/game');if(latest.history.some(h=>h.question===question&&h.characterId===pending?.characterId)&&latest.questions!==state.questions){pending=null;$('question').value='';}updateState(latest);}catch{render();}throw e;}
}
function confirm(title,text,action){$('confirm-title').textContent=title;$('confirm-text').textContent=text;confirmAction=action;$('confirm-dialog').showModal();}
async function newGame(){
  if(state?.preparing)return;
  busy=true;setError('');render();
  try{const next=await api('/api/game/new',{});pending=null;asking=false;selected=null;$('question').value='';busy=false;updateState(next);window.scrollTo({top:0,behavior:'smooth'});}
  catch(e){busy=false;render();showPreparationError(e.message);}
}
async function eliminateSelected(){
  const id=selected;pending=null;asking=false;busy=true;setError('');render();
  try{const next=await api('/api/eliminate',{gameId:state.id,characterId:id,requestId:requestId()});busy=false;selected=next.characters.find(p=>!next.eliminated.includes(p.id)).id;updateState(next);if(next.finished)$('result').scrollIntoView({behavior:'smooth',block:'center'});}
  catch(e){busy=false;render();setError(e.message);}
}
$('question-form').onsubmit=e=>{e.preventDefault();submitQuestion().catch(()=>{});};
$('question').oninput=()=>{$('send-button').disabled=!$('question').value.trim()||busy||state?.busy;};
$('question').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('question-form').requestSubmit();}};
$('eliminate-button').onclick=()=>confirm(`Исключить персонажа ${selectedPerson().name}?`,(asking||state.busy?'Текущий ответ остановится без траты вопроса. ':'')+'Вернуть персонажа в эту игру не получится. Если это правильная карточка, игра сразу закончится.',eliminateSelected);
$('new-button').onclick=()=>state?.id?confirm('Создать новую историю?','Выберем новых участников и заново распределим профессии. Текущая история завершится, когда новая будет готова.',newGame):newGame();
$('retry-scenario').onclick=async()=>{try{const latest=await api('/api/game');updateState(latest);if(!latest.preparing)await newGame();}catch(e){showPreparationError(e.message);}};
$('confirm-cancel').onclick=()=>$('confirm-dialog').close();$('confirm-yes').onclick=()=>{$('confirm-dialog').close();confirmAction?.();};
$('rules-button').onclick=()=>$('rules-dialog').showModal();$('rules-close').onclick=$('rules-play').onclick=()=>$('rules-dialog').close();
async function checkConnection(){try{const status=await api('/api/status');$('connection').textContent=status.connected?'Локальная модель · на связи':'Модель не отвечает';$('connection').title=status.model||'Проверь сервер в LM Studio';}catch{$('connection').textContent='Ведущий недоступен';}}
async function init(){try{const next=await api('/api/game');updateState(next);if(!next.id&&!next.preparing&&!next.generationError)await newGame();}catch(e){showPreparationError(e.message);}checkConnection();}
// Optional browser agent access uses the exact same public state and visible actions.
if(document.modelContext?.registerTool){
  try{Promise.resolve(document.modelContext.registerTool({name:'inspect_intuition_game',title:'Посмотреть состояние игры',description:'Read visible characters, question count and conversation history. Hidden roles remain hidden until the finale.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>structuredClone(state)})).catch(()=>{});
  Promise.resolve(document.modelContext.registerTool({name:'ask_intuition_character',title:'Задать вопрос персонажу',description:'Ask one question in the active round and display the model reply. Consumes one question from the current round budget (6, 5, 4, 3, 2). Cannot eliminate characters.',inputSchema:{type:'object',properties:{characterId:{type:'string'},question:{type:'string',minLength:1,maxLength:600}},required:['characterId','question'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async input=>{if(typeof input?.question!=='string'||!input.question.trim()||input.question.length>600)throw new Error('Нужен вопрос от 1 до 600 символов.');if(busy||state?.busy||state?.preparing)throw new Error('Дождись ответа.');select(input.characterId);return await submitQuestion(input.question);}})).catch(()=>{});
  }catch{}
}
init();
