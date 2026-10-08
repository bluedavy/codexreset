import {readFile} from 'node:fs/promises';
const [site,file]=process.argv.slice(2);
if(!site||!file||!process.env.ADMIN_RESET_SECRET)throw Error('Usage: ADMIN_RESET_SECRET=... npm run manual-reset -- https://reset.wowtools.ai verified-event.json');
const event=JSON.parse(await readFile(file,'utf8'));
const response=await fetch(new URL('/api/admin/reset',site),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.ADMIN_RESET_SECRET},body:JSON.stringify(event)});
console.log(response.status,await response.text());if(!response.ok)process.exitCode=1;
