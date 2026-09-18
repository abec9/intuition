import {randomInt} from 'node:crypto';
const groups=[
 [['мужчина',43],['женщина',32],['мужчина',28],['женщина',52],['мужчина',61],['женщина',26]],
 [['женщина',38],['мужчина',34],['женщина',65],['мужчина',49],['женщина',24],['мужчина',56]],
 [['мужчина',22],['женщина',46],['мужчина',68],['женщина',30],['мужчина',40],['женщина',58]],
 [['женщина',27],['мужчина',60],['женщина',42],['мужчина',33],['женщина',70],['мужчина',47]],
 [['мужчина',36],['женщина',55],['мужчина',26],['женщина',44],['мужчина',72],['женщина',31]],
 [['женщина',23],['мужчина',52],['женщина',63],['мужчина',29],['женщина',48],['мужчина',66]]
];
const originalIds=['ilya','mira','mark','vera','lev','nika'];
export const portraits=groups.flatMap((group,sheet)=>group.map(([gender,age],i)=>({id:sheet===0?originalIds[i]:`person-${sheet*6+i+1}`,gender,age,portrait:{sheet:sheet===0?'/portraits.png':`/portraits-${sheet+1}.png`,x:(i%3)*50,y:Math.floor(i/3)*100}})));
export function selectPortraits(usedIds=[],lastIds=[]){
  let candidates=portraits.filter(p=>!usedIds.includes(p.id));
  if(candidates.length<6)candidates=portraits.filter(p=>!lastIds.includes(p.id));
  const shuffled=[...candidates];for(let i=shuffled.length-1;i>0;i--){const j=randomInt(i+1);[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
  return shuffled.slice(0,6);
}
export function resolveRoster(scenario){return scenario?.characters?.map(p=>portraits.find(x=>x.id===p.id))||portraits.slice(0,6);}
