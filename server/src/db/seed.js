// server/src/db/seed.js
// Seed idempotente para garantizar un usuario admin y su rol en cada deploy.

import Database from "better-sqlite3";
import argon2 from "argon2";
import bcrypt from "bcryptjs";

const DB_PATH = process.env.DB_PATH || "./Kazaro.db";
const db = new Database(DB_PATH);

// ---------- helpers ----------
function tableExists(name) {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
  return !!row;
}

function colNamesOf(table) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  // mapa { lowerCaseName -> realName }
  const map = {};
  rows.forEach((r) => (map[String(r.name).toLowerCase()] = r.name));
  return map;
}

async function makeHash(plain, hasher) {
  if ((hasher || "").toLowerCase() === "bcrypt") {
    return bcrypt.hashSync(plain, 10);
  }
  // default argon2
  return await argon2.hash(plain);
}

function upsertRole(roleName) {
  if (!tableExists("Roles")) return null;

  const get = db.prepare("SELECT id FROM Roles WHERE nombre = ?");
  const row = get.get(roleName);
  if (row?.id) return row.id;

  const ins = db.prepare("INSERT INTO Roles (nombre) VALUES (?)");
  const info = ins.run(roleName);
  return info.lastInsertRowid;
}

function ensureRoleEmpleado(empleadoId, roleId) {
  if (!tableExists("Roles_Empleados")) return;
  const get = db.prepare(
    "SELECT 1 FROM Roles_Empleados WHERE EmpleadoID=? AND RolID=?"
  );
  const row = get.get(empleadoId, roleId);
  if (row) return;
  db.prepare(
    "INSERT INTO Roles_Empleados (EmpleadoID, RolID) VALUES (?, ?)"
  ).run(empleadoId, roleId);
}

// ---------- validaciones básicas ----------
if (!tableExists("Empleados")) {
  console.log("[seed] Falta la tabla 'Empleados'. Corré migrate primero.");
  process.exit(0);
}

const cols = colNamesOf("Empleados");

// resolvemos nombres reales según tu DB
const USERNAME = cols["username"] || cols["Username"] || "username";
const PASSHASH =
  cols["password_hash"] || cols["PasswordHash"] || "password_hash";
const NOMBRE = cols["nombre"] || cols["Nombre"] || "Nombre";
const EMAIL = cols["email"] || cols["Email"] || "Email";
const IS_ACTIVE = cols["is_active"] || cols["Is_Active"] || "is_active";
const PASS_PLAIN =
  cols["password_plain"] || cols["Password_Plain"] || "password_plain";
const ID = cols["empleadosid"] || cols["EmpleadosID"] || "EmpleadosID";

// ---------- variables del admin ----------
const SEED_HASHER = (process.env.SEED_HASHER || "argon2").toLowerCase();
const ADMIN_USER = process.env.SEED_ADMIN_USER || "admin";
const ADMIN_PASS = process.env.SEED_ADMIN_PASS || "123456";
const ADMIN_NAME = process.env.SEED_ADMIN_NAME || "Administrador";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
const ADMIN_ROLE = process.env.SEED_ADMIN_ROLE || "admin";

// ---------- generamos hash ----------
const hashed = await makeHash(ADMIN_PASS, SEED_HASHER);

// ---------- upsert Empleados (por username) ----------
const getByUser = db.prepare(
  `SELECT ${ID} AS id FROM Empleados WHERE ${USERNAME} = ?`
);
const row = getByUser.get(ADMIN_USER);

if (row?.id) {
  // update
  const stmt = db.prepare(
    `UPDATE Empleados
     SET ${PASSHASH} = ?, ${NOMBRE} = ?, ${EMAIL} = ?, ${IS_ACTIVE} = 1, ${PASS_PLAIN} = ?
     WHERE ${ID} = ?`
  );
  stmt.run(hashed, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASS, row.id);
  console.log(
    `[seed] Admin actualizado: ${ADMIN_USER} (id=${row.id}, hasher=${SEED_HASHER})`
  );

  // rol (si existen tablas de roles)
  const roleId = upsertRole(ADMIN_ROLE);
  if (roleId) ensureRoleEmpleado(row.id, roleId);
} else {
  // insert
  const stmt = db.prepare(
    `INSERT INTO Empleados (${USERNAME}, ${PASSHASH}, ${NOMBRE}, ${EMAIL}, ${IS_ACTIVE}, ${PASS_PLAIN})
     VALUES (?, ?, ?, ?, 1, ?)`
  );
  const info = stmt.run(ADMIN_USER, hashed, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASS);
  const newId = info.lastInsertRowid;
  console.log(
    `[seed] Admin creado: ${ADMIN_USER} (id=${newId}, hasher=${SEED_HASHER})`
  );

  // rol (si existen tablas de roles)
  const roleId = upsertRole(ADMIN_ROLE);
  if (roleId) ensureRoleEmpleado(newId, roleId);
}

console.log("[seed] OK");
