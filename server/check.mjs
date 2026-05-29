import { db } from './src/db.js';
const u = db.prepare("SELECT EmpleadosID, username, empresa_id FROM Empleados WHERE username LIKE '%pazar%' OR username LIKE '%admin%'").all();
console.log(JSON.stringify(u, null, 2));
db.close();