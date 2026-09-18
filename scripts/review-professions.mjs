import {readFile,writeFile} from 'node:fs/promises';
import {reviewProfessionCatalog,catalogReviewMarkdown} from '../catalog-review.mjs';

const file=process.argv[2]||process.env.PROFESSIONS_FILE||new URL('../professions.json',import.meta.url);
let report;
try{
  const raw=JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
  report=reviewProfessionCatalog(raw);
}catch(error){
  report={ready:false,count:0,issues:[{severity:'error',id:null,field:'file',message:error instanceof SyntaxError?'JSON ещё не закончен или повреждён. Дождись завершения записи файла.':error.message}]};
}
const output=catalogReviewMarkdown(report);
if(process.argv[3])await writeFile(process.argv[3],output);
console.log(output);
process.exitCode=report.ready?0:1;
