// server/src/db/migrate.js
import Database from "better-sqlite3";

const DB_PATH = process.env.DB_PATH || "./Kazaro.db";
const db = new Database(DB_PATH);

// ⚠️ Ajustá columnas si en tu proyecto real se llaman distinto.
db.exec(`
  CREATE TABLE IF NOT EXISTS Empleados (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Username TEXT UNIQUE NOT NULL,
    PasswordHash TEXT NOT NULL,
    Nombre TEXT,
    Email TEXT,
    Rol TEXT DEFAULT 'administrativo'
  );
`);

console.log("[migrate] Empleados OK");
