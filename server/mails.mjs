// server/mails.mjs
import { db } from './src/db.js';
const [accion, valor] = process.argv.slice(2);

const get = () => (db.prepare("SELECT value FROM EmpresaMailConfig WHERE empresa_id=2 AND key='MAIL_TO'").get()?.value || '').split(',').map(s=>s.trim()).filter(Boolean);
const set = l => db.prepare("INSERT INTO EmpresaMailConfig (empresa_id,key,value) VALUES (2,'MAIL_TO',?) ON CONFLICT(empresa_id,key) DO UPDATE SET value=excluded.value").run(l.join(','));

let l = get();
if (accion === 'add') { if(!l.includes(valor)) l.push(valor); set(l); }
else if (accion === 'remove') { l = l.filter(m=>m!==valor); set(l); }
else if (accion === 'set') { l = valor.split(',').map(s=>s.trim()).filter(Boolean); set(l); }

console.log('Pazar MAIL_TO:'); get().forEach((m,i)=>console.log(`  ${i+1}. ${m}`));
db.close();