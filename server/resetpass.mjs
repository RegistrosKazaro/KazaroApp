import argon2 from 'argon2';
import { db } from './src/db.js';
const hash = await argon2.hash('Pazar.123!');
db.prepare('UPDATE Empleados SET password_hash = ?, password_plain = NULL WHERE username = ?').run(hash, 'admin.pazar');
console.log('OK');
db.close();