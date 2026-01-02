import 'dotenv/config';           // Carga automáticamente .env
import Database from "better-sqlite3";
import argon2 from "argon2";
import path from "path";
import fs from "fs";

const dbPath = path.resolve(process.cwd(), process.env.DB_PATH || "../Kazaro.db");
if (!fs.existsSync(dbPath)) {
  console.error("No se encontró DB:", dbPath);
  process.exit(1);
}
const db = new Database(dbPath);

const [,, userArg, passArg] = process.argv;
if (!userArg || !passArg) {
  console.log("Uso: node test-verify.mjs <usuario> <password>");
  process.exit(1);
}

const row = db.prepare(`
  SELECT username, password_hash
  FROM Empleados
  WHERE lower(trim(username)) = lower(trim(?))
`).get(userArg);

if (!row) {
  console.log("No existe ese usuario");
  process.exit(1);
}

const ok = await argon2.verify(String(row.password_hash || "").trim(), passArg).catch(() => false);
console.log({ user: row.username, ok });
