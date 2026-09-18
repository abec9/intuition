import http from 'node:http';
import {networkInterfaces} from 'node:os';
import {selectPortraits} from './portraits.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createGame,publicState,ask,eliminate,GameError} from './game.mjs';
import {modelStatus,generateAnswer} from './llm.mjs';
import {prepareCatalogScenario} from './catalog-scenario.mjs';
import {ProfessionCatalogError} from './profession-catalog.mjs';
import {previousGameForGeneration,rememberGeneratedGame} from './session-memory.mjs';
const root = path.resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const bindHost=process.env.HOST||'127.0.0.1';
const publicOrigin=process.env.PUBLIC_ORIGIN?new URL(process.env.PUBLIC_ORIGIN).origin:null;
const allowedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,...(bindHost==='0.0.0.0'?Object.values(networkInterfaces()).flat().filter(x=>x?.family==='IPv4').map(x=>`${x.address}:${port}`):[]),...(publicOrigin?[new URL(publicOrigin).host]:[])]);
const allowedOrigins=new Set([...Array.from(allowedHosts,h=>`http://${h}`),...(publicOrigin?[publicOrigin]:[])]);
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
const sessions=new Map();
function snapshot(s){return {...(s.game?publicState(s.game):{id:null,characters:[],history:[],eliminated:[],finished:false,busy:false}),preparing:!!s.generation,generationError:s.generationError||null};}
function startGeneration(s){
  if(s.generation)return;
  const previous=previousGameForGeneration(s);
  s.generationError=null;
  const roster=selectPortraits(s.usedPortraits||[],previous?.characters.map(p=>p.id)||[]);
  s.generation=prepareCatalogScenario(previous?.characters.map(p=>p.profession)||[],roster)
    .then(scenario=>{s.game=createGame(scenario,previous?.targetProfession);rememberGeneratedGame(s,roster);})
    .catch(error=>{s.generationError=error instanceof GameError||error instanceof ProfessionCatalogError?error.message:'Не удалось собрать историю из справочника. Проверь данные персонажей и профессий.';})
    .finally(()=>{s.generation=null;});
}

function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(JSON.stringify(value));}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>8192)throw new GameError('Слишком длинный запрос.',413);}try{return JSON.parse(text||'{}');}catch{throw new GameError('Некорректный запрос.',400);}}
function session(req,res){
  let sid=req.headers.cookie?.match(/(?:^|;\s*)intuition_session=([a-f0-9-]{36})(?:;|$)/)?.[1];
  if(!sid||!sessions.has(sid)){
    for(const [id,s] of sessions)if(Date.now()-s.lastSeen>86400000&&!s.game?.busy&&!s.generation)sessions.delete(id);
    if(sessions.size>=100)throw new GameError('Слишком много открытых игр.',503);
    sid=randomUUID();sessions.set(sid,{game:null,generation:null,generationError:null,lastSeen:Date.now(),gamesCreated:0,clearGameLogBeforeNext:false});res.setHeader('Set-Cookie',`intuition_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);
  }
  const s=sessions.get(sid);s.lastSeen=Date.now();return s;
}
const server = http.createServer(async (req,res) => {
  try {
    if(!allowedHosts.has(req.headers.host))throw new GameError('Недопустимый адрес.',403);
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if(url.pathname.startsWith('/api/')){
      if(req.method==='GET'&&url.pathname==='/api/status'){
        try{json(res,200,await modelStatus());}catch{json(res,200,{connected:false,model:null});}return;
      }
      if(req.method==='POST'){
        if(!allowedOrigins.has(req.headers.origin)||req.headers['x-intuition-client']!=='1')throw new GameError('Запрос должен идти из игры.',403);
        if(!req.headers['content-type']?.startsWith('application/json'))throw new GameError('Нужен JSON.',400);
      }
      const s=session(req,res);
      if(req.method==='GET'&&url.pathname==='/api/game'){json(res,200,snapshot(s));return;}
      if(req.method==='POST'){
        const input=await body(req);
        if(url.pathname==='/api/game/new'){
          if(s.game?.busy)throw new GameError('Дождись ответа персонажа.');startGeneration(s);json(res,202,snapshot(s));return;
        }
        if(s.generation)throw new GameError('Сначала дождись новой истории.');
        if(!s.game)throw new GameError('Сначала создай новую историю.');
        if(input.gameId!==s.game.id)throw new GameError('Игра была обновлена в другом окне. Обнови страницу.');
        if(typeof input.requestId!=='string'||input.requestId.length>80||!input.requestId)throw new GameError('Нужен идентификатор запроса.',400);
        const fingerprint=JSON.stringify([url.pathname,input.characterId,input.question]);
        const saved=s.game.receipts.get(input.requestId);
        if(saved){if(saved.fingerprint!==fingerprint)throw new GameError('Этот запрос уже использован.');json(res,200,saved.state);return;}
        if(url.pathname==='/api/ask')await ask(s.game,input.characterId,input.question,generateAnswer);
        else if(url.pathname==='/api/eliminate')eliminate(s.game,input.characterId);
        else throw new GameError('Не найдено.',404);
        const state=publicState(s.game);s.game.receipts.set(input.requestId,{fingerprint,state});json(res,200,state);return;
      }
      throw new GameError('Не найдено.',404);
    }
    if(req.method!=='GET'&&req.method!=='HEAD')throw new GameError('Метод не поддерживается.',405);
    const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}).end(data);
  } catch(error) { if(!res.headersSent)json(res,error.status||(error.code==='ENOENT'?404:500),{error:error instanceof GameError?error.message:'Не удалось выполнить запрос. Попробуй ещё раз.'}); }
});
server.listen(port, bindHost, () => {console.log(`Интуиция: http://127.0.0.1:${port}`);if(bindHost==='0.0.0.0')console.log('Для друзей в той же сети: '+[...allowedHosts].filter(h=>!h.startsWith('127.')&&!h.startsWith('localhost')).map(h=>'http://'+h).join(', '));});
