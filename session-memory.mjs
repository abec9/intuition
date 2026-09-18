export const GAME_LOG_CLEAR_INTERVAL=3;

export function previousGameForGeneration(session){
  if(session.clearGameLogBeforeNext){
    session.clearGameLogBeforeNext=false;
    session.usedPortraits=[];
    return null;
  }
  return session.game||null;
}

export function rememberGeneratedGame(session,roster){
  session.gamesCreated=(session.gamesCreated||0)+1;
  const old=session.usedPortraits||[];
  session.usedPortraits=[...(old.length>=36?[]:old),...roster.map(p=>p.id)];
  if(session.gamesCreated%GAME_LOG_CLEAR_INTERVAL===0){
    session.clearGameLogBeforeNext=true;
    session.usedPortraits=[];
  }
}
