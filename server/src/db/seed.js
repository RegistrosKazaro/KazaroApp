// server/src/db/seed.js
import Database from "better-sqlite3";
import argon2 from "argon2";
import bcrypt from "bcryptjs";

const DB_PATH = process.env.DB_PATH || "./Kazaro.db";
const db = new Database(DB_PATH);

// Si falta la tabla, salgo (primero debe correr migrate)
const exists = db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name='Empleados'"
).get();
if (!exists) {
  console.log("[seed] Falta 'Empleados'. Corré migrate primero.");
  process.exit(0);
}

// Si ya hay filas, no vuelvo a insertar
const count = db.prepare("SELECT COUNT(*) AS c FROM Empleados").get().c;
if (count > 0) {
  console.log("[seed] Empleados ya tiene filas. No hago nada.");
  process.exit(0);
}

// Credenciales por defecto (podés sobreescribir con ENV en Render)
const user  = process.env.SEED_ADMIN_USER  || "admin";
const pass  = process.env.SEED_ADMIN_PASS  || "123456";
const nombre= process.env.SEED_ADMIN_NAME  || "Administrador";
const email = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
const rol   = process.env.SEED_ADMIN_ROLE  || "administrativo";

// Elegí el hasher según tu backend (por defecto uso ARGON2)
const HASHER = (process.env.SEED_HASHER || "argon2").toLowerCase();
// Nota: tu server/package.json ya tiene "argon2" y "bcryptjs" instalados.

async function makeHash(plain) {
  if (HASHER === "bcrypt") {
    return bcrypt.hashSync(plain, 10);
  }
  // por defecto argon2
  return await argon2.hash(plain);
}

const hash = await makeHash(pass);

db.prepare(`
  INSERT INTO Empleados (Username, PasswordHash, Nombre, Email, Rol)
  VALUES (?, ?, ?, ?, ?)
`).run(user, hash, nombre, email, rol);

console.log(`[seed] Usuario creado: ${user} / ${pass} (rol: ${rol}, hasher: ${HASHER})`);

