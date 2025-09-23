// server/src/db/seed.js
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

const DB_PATH = process.env.DB_PATH || "./Kazaro.db";
const db = new Database(DB_PATH);

// ¿existe la tabla Empleados?
const exists = db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name='Empleados'"
).get();

if (!exists) {
  console.log("[seed] Falta 'Empleados'. Corré migrate primero.");
  process.exit(0);
}

// ¿está vacía?
const count = db.prepare("SELECT COUNT(*) AS c FROM Empleados").get().c;
if (count > 0) {
  console.log("[seed] Empleados ya tiene filas. No hago nada.");
  process.exit(0);
}

// Credenciales por defecto (podés sobreescribir con ENV)
const user = process.env.SEED_ADMIN_USER || "admin";
const pass = process.env.SEED_ADMIN_PASS || "123456";
const nombre = process.env.SEED_ADMIN_NAME || "Administrador";
const email = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
const rol = process.env.SEED_ADMIN_ROLE || "administrativo";

// Hash bcrypt
const hash = bcrypt.hashSync(pass, 10);

db.prepare(`
  INSERT INTO Empleados (Username, PasswordHash, Nombre, Email, Rol)
  VALUES (?, ?, ?, ?, ?)
`).run(user, hash, nombre, email, rol);

console.log(`[seed] Usuario creado: ${user} / ${pass} (rol: ${rol})`);
