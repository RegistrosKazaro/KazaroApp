// server/src/db.js
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { env } from "./utils/env.js";

// ---------------- Localización de la DB ----------------
function resolveDbPath() {
  const candidates = [];
  if (env.DB_PATH) {
    candidates.push(path.isAbsolute(env.DB_PATH) ? env.DB_PATH : path.resolve(process.cwd(), env.DB_PATH));
  }
  candidates.push(
    path.resolve(process.cwd(), "Kazaro.db"),
    path.resolve(process.cwd(), "../Kazaro.db"),
    path.resolve(process.cwd(), "../../Kazaro.db")
  );
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p; } catch {}
  }
  return candidates[0];
}

const dbPath = resolveDbPath();
export const DB_RESOLVED_PATH = dbPath;

if (!fs.existsSync(dbPath)) {
  console.error("[DB] No se encontró la base en:", dbPath);
  console.error("[DB] Configurá env.DB_PATH con la ruta a tu Kazaro.db");
  throw new Error(`No existe el archivo de base de datos en: ${dbPath}`);
}

export const db = new Database(dbPath, { fileMustExist: true });
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

// ---------------- Helpers base ----------------
function norm(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}
function tableInfo(table) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all(); }
  catch { return []; }
}
function allTables() {
  return db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map(r => r.name);
}
function tableExists(name) {
  const lower = String(name).toLowerCase();
  return allTables().some(t => t.toLowerCase() === lower);
}
function hasRows(table) {
  try { return !!db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get(); }
  catch { return false; }
}
function pickCol(info, candidates) {
  const names = info.map(c => c.name);
  for (const candRaw of candidates) {
    const cand = norm(candRaw);
    const hit = names.find(n => norm(n) === cand);
    if (hit) return hit;
  }
  return null;
}
function fkList(table) {
  try { return db.prepare(`PRAGMA foreign_key_list(${table})`).all(); }
  catch { return []; }
}

// ---------------- Empleados / Roles ----------------
const empInfo = tableInfo("Empleados");
const empleadoIdCol =
  (empInfo.find(c => c.pk === 1)?.name) ||
  pickCol(empInfo, ["EmpleadosID","EmpleadoID","EmpleadoId","IdEmpleado","empleado_id","user_id","id"]) ||
  "EmpleadoID";

const reInfo = tableInfo("Roles_Empleados");
const reEmpleadoIdCol =
  pickCol(reInfo, ["EmpleadoID","EmpleadoId","IdEmpleado","empleado_id","user_id","id_empleado"]) ||
  "EmpleadoID";
const reRolIdCol =
  pickCol(reInfo, ["RolID","IdRol","rol_id","id_rol","id"]) ||
  "RolID";

const rolesInfo = tableInfo("Roles");
const rolesIdCol =
  pickCol(rolesInfo, ["RolID","IdRol","rol_id","id_rol","id"]) ||
  "RolID";
const rolesNameCol =
  pickCol(rolesInfo, ["Rol","Nombre","name","Descripcion","descripcion"]) ||
  "Rol";

export function getUserForLogin(userOrEmailInput) {
  if (!tableExists("Empleados")) return null;
  const eInfo = tableInfo("Empleados");

  const idCol =
    (eInfo.find(c => c.pk === 1)?.name) ||
    pickCol(eInfo, ["EmpleadosID","EmpleadoID","IdEmpleado","empleado_id","user_id","id","ID"]) ||
    "EmpleadoID";

  const userCol  = pickCol(eInfo, ["username","user","usuario","Usuario"]);
  const emailCol = pickCol(eInfo, ["email","Email","correo","Correo"]);

  const hashCol   = pickCol(eInfo, ["password_hash","hash","pass_hash"]);
  const plainCol  = pickCol(eInfo, ["password","contrasena","contraseña","clave","pass"]);
  const activeCol = pickCol(eInfo, ["is_active","activo","Activo","enabled","estado"]);

  if (!userCol && !emailCol) return null;

  const whereParts = [];
  const params = [];
  if (userCol)  { whereParts.push(`LOWER(TRIM(${userCol})) = LOWER(TRIM(?))`);  params.push(userOrEmailInput); }
  if (emailCol) { whereParts.push(`LOWER(TRIM(${emailCol})) = LOWER(TRIM(?))`); params.push(userOrEmailInput); }

  const sql = `
    SELECT
      ${idCol} AS id,
      COALESCE(${userCol || "NULL"}, ${emailCol || "NULL"}) AS username,
      ${hashCol   ? hashCol   : "NULL"} AS password_hash,
      ${plainCol  ? plainCol  : "NULL"} AS password_plain,
      ${activeCol ? activeCol : "1"}    AS is_active
    FROM Empleados
    WHERE ${whereParts.join(" OR ")}
    LIMIT 1
  `;
  return db.prepare(sql).get(...params);
}

export function getUserByUsername(username) {
  const u = getUserForLogin(username);
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    password_hash: u.password_hash,
    is_active: u.is_active
  };
}

export function getUserRoles(userId) {
  if (!tableExists("Roles_Empleados") || !tableExists("Roles")) return [];
  return db.prepare(`
    SELECT r.${rolesNameCol} AS role
    FROM Roles_Empleados re
    JOIN Roles r ON r.${rolesIdCol} = re.${reRolIdCol}
    WHERE re.${reEmpleadoIdCol} = ?
  `).all(userId).map(r => r.role);
}

// ---------------- Catálogo (descubrimiento dinámico) ----------------
const NAME_CANDIDATES = [
  "Nombre","NombreProducto","Nombre_Producto","Descripcion","Detalle","Producto",
  "Titulo","title","name","descripcion"
];
const CODE_CANDIDATES = ["Codigo","CodigoProducto","Codigo_Producto","SKU","sku","codigo","code","Code"];
const PRICE_CANDIDATES = ["Precio","precio","Price","Costo","costo","importe","Valor","valor"];
const STOCK_CANDIDATES = ["Stock","Existencia","Cantidad","Disponibilidad","stock","existencia","cantidad"];
const CAT_CANDIDATES = [
  "CategoriaID","IdCategoria","categoria_id","RubroID","FamiliaID",
  "CategoriaProductoID","IdCategoriaProducto","categoria_producto_id",
  "ServicioID","IdServicio","servicio_id",
  "SeccionID","IdSeccion","seccion_id",
  "GrupoID","IdGrupo","grupo_id",
  "TipoID","IdTipo","tipo_id",
  "ClasificacionID","IdClasificacion","clasificacion_id",
  "CategoryID"
];
const CATNAME_CANDIDATES = [
  "Categoria","CategoriaNombre","NombreCategoria","Rubro","Familia","Servicio","Seccion",
  "Grupo","Tipo","Clasificacion",
  "categoria_nombre","nombre_categoria"
];
const CATTABLE_NAME_HINTS = ["categor","rubro","famil","servi","secci","grup","tipo","clasif"];

function scoreProductTable(tbl) {
  const info = tableInfo(tbl);
  if (!info.length || !hasRows(tbl)) return { score: 0 };
  const hasName = !!pickCol(info, NAME_CANDIDATES) || info.some(c => c.type?.toUpperCase().includes("TEXT"));
  const hasPrice = !!pickCol(info, PRICE_CANDIDATES);
  const hasCode = !!pickCol(info, CODE_CANDIDATES);
  const maybeCat = pickCol(info, CAT_CANDIDATES) || pickCol(info, CATNAME_CANDIDATES);
  const badHints = ["Empleados","Roles","Roles_Empleados","Pedidos","PedidoItems","Usuarios","Logs"];
  if (badHints.includes(tbl)) return { score: 0 };
  let score = 0;
  if (hasName) score += 4;
  if (hasPrice) score += 2;
  if (hasCode) score += 1;
  if (maybeCat) score += 2;
  return { score, info };
}
function chooseProductTable() {
  const candidates = allTables();
  let best = null, bestName = null;
  for (const t of candidates) {
    const s = scoreProductTable(t);
    if (s.score > 0 && (!best || s.score > best.score)) { best = s; bestName = t; }
  }
  if (!best) return null;
  return { table: bestName, info: best.info };
}
function findCategoryTableFor(productsTable, prodCatCol) {
  const fks = fkList(productsTable);
  const fk = fks.find(f => String(f.from).toLowerCase() === String(prodCatCol).toLowerCase());
  if (fk) {
    const info = tableInfo(fk.table);
    const catId   = fk.to || (info.find(c => c.pk === 1)?.name) ||
                    pickCol(info, ["CategoriaID","IdCategoria","id","ID"]);
    const catName = pickCol(info, [
      "Categoria","CategoriaNombre","NombreCategoria","Rubro","Familia","Servicio","Seccion",
      "Grupo","Tipo","Clasificacion","Descripcion","Nombre","name","descripcion","Titulo","title"
    ]);
    if (catId && catName) return { table: fk.table, catId, catName, info };
  }
  return null;
}
function chooseCategoryTable(products, prodCatCol) {
  if (!prodCatCol) return null;
  const tables = allTables();
  let best = null;
  for (const t of tables) {
    if (t === products) continue;
    if (["Empleados","Roles","Roles_Empleados","Pedidos","PedidoItems","Usuarios","Logs"].includes(t)) continue;
    if (!hasRows(t)) continue;
    const info = tableInfo(t);
    if (!info.length) continue;
    const catId = pickCol(info, [
      "CategoriaID","IdCategoria","categoria_id",
      "RubroID","FamiliaID","ServicioID","SeccionID",
      "GrupoID","TipoID","ClasificacionID","id","ID"
    ]);
    const catName = pickCol(info, [
      "Nombre","NombreCategoria","Categoria","Rubro","Familia","Servicio","Seccion",
      "Grupo","Tipo","Clasificacion","Descripcion","Detalle","name","descripcion","titulo"
    ]);
    if (!catId || !catName) continue;
    let joinOK = false;
    try {
      const row = db.prepare(`
        SELECT 1
        FROM ${products} p
        JOIN ${t} c ON p.${prodCatCol} = c.${catId}
        LIMIT 1
      `).get();
      joinOK = !!row;
    } catch {}
    let score = CATTABLE_NAME_HINTS.some(h => t.toLowerCase().includes(h)) ? 3 : 0;
    if (joinOK) score += 10;
    if (!best || score > best.score) best = { score, table: t, catId, catName };
  }
  return (best && best.score >= 10) ? best : null;
}
export function discoverCatalogSchema() {
  const chosen = chooseProductTable();
  if (!chosen) {
    return { ok: false, reason: "No se encontró ninguna tabla que parezca catálogo de productos." };
  }
  const products = chosen.table;
  const pinfo = chosen.info;

  let prodId = (pinfo.find(c => c.pk === 1)?.name)
            || pickCol(pinfo, ["ProductoID","IdProducto","producto_id","ArticuloID","ItemID","id","ID"])
            || "rowid";

  let prodName = pickCol(pinfo, NAME_CANDIDATES);
  if (!prodName) {
    const anyText = pinfo.find(c => String(c.type || "").toUpperCase().includes("TEXT"));
    prodName = anyText ? anyText.name : pinfo[0].name;
  }
  const prodCat  = pickCol(pinfo, CAT_CANDIDATES);
  const prodCatName = pickCol(pinfo, CATNAME_CANDIDATES);
  const prodCode = pickCol(pinfo, CODE_CANDIDATES);
  const prodPrice= pickCol(pinfo, PRICE_CANDIDATES);
  const prodStock= pickCol(pinfo, STOCK_CANDIDATES);

  let cat = null;
  if (prodCat) cat = findCategoryTableFor(products, prodCat) || chooseCategoryTable(products, prodCat);

  return {
    ok: true,
    tables: { categories: cat ? cat.table : null, products },
    cols: {
      prodId, prodName, prodCat, prodCatName, prodCode, prodPrice, prodStock,
      catId: cat?.catId || null,
      catName: cat?.catName || null
    }
  };
}
export function listCategories() {
  const sch = discoverCatalogSchema();
  if (!sch.ok) throw new Error(sch.reason);
  const { products, categories } = sch.tables;
  const { prodCat, prodCatName, catId, catName } = sch.cols;

  if (categories && prodCat && catId && catName) {
    return db.prepare(`
      SELECT c.${catId} AS id, c.${catName} AS name, COUNT(p.${prodCat}) AS count
      FROM ${categories} c
      LEFT JOIN ${products} p ON p.${prodCat} = c.${catId}
      GROUP BY c.${catId}, c.${catName}
      ORDER BY c.${catName} COLLATE NOCASE
    `).all();
  }
  if (!categories && prodCatName) {
    return db.prepare(`
      SELECT ${prodCatName} AS id, ${prodCatName} AS name, COUNT(*) AS count
      FROM ${products}
      GROUP BY ${prodCatName}
      ORDER BY ${prodCatName} COLLATE NOCASE
    `).all();
  }
  if (prodCat) {
    return db.prepare(`
      SELECT ${prodCat} AS id, 'Categoría ' || ${prodCat} AS name, COUNT(*) AS count
      FROM ${products}
      GROUP BY ${prodCat}
      ORDER BY ${prodCat}
    `).all();
  }
  const total = db.prepare(`SELECT COUNT(*) AS c FROM ${products}`).get()?.c ?? 0;
  return [{ id: "__all__", name: "Todos", count: total }];
}
export function listProductsByCategory(categoryId, { q = "" } = {}) {
  const sch = discoverCatalogSchema();
  if (!sch.ok) throw new Error(sch.reason);
  const { products } = sch.tables;
  const { prodId, prodName, prodCat, prodCatName, prodCode, prodPrice, prodStock } = sch.cols;

  const hasCode  = !!prodCode;
  const hasPrice = !!prodPrice;
  const hasStock = !!prodStock;

  const cols = [
    `${prodId}   AS id`,
    `${prodName} AS name`,
    prodCat ? `${prodCat}  AS categoryId` : (prodCatName ? `${prodCatName} AS categoryId` : `'__all__' AS categoryId`),
    hasCode  ? `${prodCode}  AS code`  : `' ' AS code`,
    hasPrice ? `${prodPrice} AS price` : `NULL AS price`,
    hasStock ? `${prodStock} AS stock` : `NULL AS stock`,
  ].join(", ");

  const like = `%${q.trim()}%`;
  let whereCat = "1=1";
  const params = [];
  if (prodCat && categoryId !== "__all__") { whereCat = `${prodCat} = ?`; params.push(categoryId); }
  else if (!prodCat && prodCatName && categoryId !== "__all__") { whereCat = `${prodCatName} = ?`; params.push(categoryId); }

  let whereSearch = `${prodName} LIKE ?`;
  params.push(like);
  if (hasCode) { whereSearch = `(${prodName} LIKE ? OR ${prodCode} LIKE ?)`; params.push(like); }

  const sql = `
    SELECT ${cols}
    FROM ${products}
    WHERE ${whereCat} AND ${whereSearch}
    ORDER BY ${prodName} COLLATE NOCASE
  `;
  return db.prepare(sql).all(...params);
}
export function debugCatalogSchema() {
  const sch = discoverCatalogSchema();
  if (!sch.ok) return sch;
  const sample = db.prepare(`SELECT * FROM ${sch.tables.products} LIMIT 3`).all();
  return { ...sch, sample };
}

// ---------------- Pedidos (asegurar esquema) ----------------
function ensureOrdersSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS Pedidos (
      PedidoID   INTEGER PRIMARY KEY AUTOINCREMENT,
      EmpleadoID INTEGER NOT NULL,
      Rol        TEXT,
      Nota       TEXT,
      Total      REAL,
      Fecha      TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS PedidoItems (
      PedidoItemID INTEGER PRIMARY KEY AUTOINCREMENT,
      PedidoID     INTEGER NOT NULL,
      ProductoID   INTEGER NOT NULL,
      Nombre       TEXT,
      Precio       REAL,
      Cantidad     INTEGER NOT NULL,
      Subtotal     REAL
    );
  `);
  try {
    const info = tableInfo("Pedidos");
    const hasServicio =
      info.some(c => String(c.name).toLowerCase() === "servicioid") ||
      info.some(c => String(c.name).toLowerCase() === "servicio_id");
    if (!hasServicio) db.exec(`ALTER TABLE Pedidos ADD COLUMN ServicioID INTEGER NULL;`);
  } catch {}
  try {
    const info2 = tableInfo("Pedidos");
    const hasServicio2 =
      info2.some(c => String(c.name).toLowerCase() === "servicioid") ||
      info2.some(c => String(c.name).toLowerCase() === "servicio_id");
    if (hasServicio2) db.exec(`CREATE INDEX IF NOT EXISTS idx_pedidos_servicio ON Pedidos(ServicioID);`);
  } catch {}
  try {
    const pi = tableInfo("PedidoItems");
    const hasCodigo = pi.some(c => norm(c.name) === "codigo");
    if (!hasCodigo) db.exec(`ALTER TABLE PedidoItems ADD COLUMN Codigo TEXT;`);
  } catch {}
}
ensureOrdersSchema();

export function getProductForOrder(productId) {
  const sch = discoverCatalogSchema();
  if (!sch.ok) throw new Error(sch.reason);
  const { products } = sch.tables;
  const { prodId, prodName, prodPrice, prodCode } = sch.cols;

  const cols = [
    `${prodId}   AS id`,
    `${prodName} AS name`,
    prodPrice ? `${prodPrice} AS price` : `NULL AS price`,
    prodCode  ? `${prodCode}  AS code`  : `' ' AS code`
  ].join(", ");

  return db.prepare(`SELECT ${cols} FROM ${products} WHERE ${prodId} = ? LIMIT 1`).get(productId);
}
export function createOrder({ empleadoId, rol, nota, items, servicioId = null }) {
  const tx = db.transaction(() => {
    let total = 0;

    const info = tableInfo("Pedidos");
    const haveServicio =
      info.some(c => String(c.name).toLowerCase() === "servicioid") ||
      info.some(c => String(c.name).toLowerCase() === "servicio_id");

    let pedidoId;
    if (haveServicio) {
      const insPedido = db.prepare(`
        INSERT INTO Pedidos (EmpleadoID, Rol, Nota, ServicioID, Total)
        VALUES (?, ?, ?, ?, 0)
      `);
      pedidoId = insPedido.run(empleadoId, String(rol || ""), String(nota || ""), servicioId).lastInsertRowid;
    } else {
      const insPedido = db.prepare(`
        INSERT INTO Pedidos (EmpleadoID, Rol, Nota, Total)
        VALUES (?, ?, ?, 0)
      `);
      pedidoId = insPedido.run(empleadoId, String(rol || ""), String(nota || "")).lastInsertRowid;
    }

    const pi = tableInfo("PedidoItems");
    const hasCodigo = pi.some(c => norm(c.name) === "codigo");

    const insItem = hasCodigo
      ? db.prepare(`
          INSERT INTO PedidoItems (PedidoID, ProductoID, Nombre, Precio, Cantidad, Subtotal, Codigo)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
      : db.prepare(`
          INSERT INTO PedidoItems (PedidoID, ProductoID, Nombre, Precio, Cantidad, Subtotal)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

    for (const it of items || []) {
      const row = getProductForOrder(Number(it.productId));
      if (!row) continue;
      const price = row.price != null ? Number(row.price) : 0;
      const qty   = Math.max(1, Number(it.qty || 1));
      const sub   = price * qty;
      total += sub;

      if (hasCodigo) {
        insItem.run(pedidoId, Number(it.productId), row.name, price, qty, sub, row.code ?? "");
      } else {
        insItem.run(pedidoId, Number(it.productId), row.name, price, qty, sub);
      }
    }

    db.prepare(`UPDATE Pedidos SET Total = ? WHERE PedidoID = ?`).run(total, pedidoId);
    return { pedidoId, total };
  });

  return tx();
}

// ---------------- Servicios / Asignaciones (PIVOT) ----------------
function resolveServicesTable() {
  let table = null;
  if (tableExists("Servicios")) table = "Servicios";
  else if (tableExists("Servicos")) table = "Servicos";
  else return null;

  const info = tableInfo(table);
  const idCol =
    pickCol(info, ["ServiciosID","ServicioID","IdServicio","ID","Id","id"]) ||
    (info.find(c => c.pk === 1)?.name) ||
    "ServiciosID";

  const nameCandidates = ["ServicioNombre","Nombre","Servicio","Descripcion","Detalle","Titulo"];
  const nameExpr = `
    COALESCE(
      ${nameCandidates.map(n => `NULLIF(TRIM(s.${n}), '')`).join(", ")},
      CAST(s.${idCol} AS TEXT)
    )
  `;
  return { table, idCol, nameExpr };
}

// Asegura tabla pivot (id autoincremental para poder borrar por id)
export function ensureSupervisorPivot() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS supervisor_services (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      EmpleadoID  INTEGER NOT NULL,
      ServicioID  INTEGER NOT NULL,
      UNIQUE(EmpleadoID, ServicioID),
      FOREIGN KEY (EmpleadoID) REFERENCES Empleados(${empleadoIdCol}) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_supserv_emp ON supervisor_services(EmpleadoID);
    CREATE INDEX IF NOT EXISTS idx_supserv_srv ON supervisor_services(ServicioID);
  `);
}

// Devuelve lista {id, name} de servicios asignados (sin semanas)
export function listServicesByUser(userId) {
  ensureSupervisorPivot();
  const spec = resolveServicesTable();
  if (!spec) return [];
  const rows = db.prepare(`
    SELECT a.id,
           s.${spec.idCol} AS sid,
           ${spec.nameExpr} AS sname
    FROM supervisor_services a
    JOIN ${spec.table} s
      ON CAST(s.${spec.idCol} AS TEXT) = CAST(a.ServicioID AS TEXT)
    WHERE CAST(a.EmpleadoID AS TEXT) = CAST(? AS TEXT)
    ORDER BY sname COLLATE NOCASE
  `).all(userId);
  return rows.map(r => ({ id: Number(r.sid), name: String(r.sname) }));
}

// Punto único para que el Supervisor vea sus servicios
export function getAssignedServices(userId) {
  // Pivot (fuente de la verdad)
  return listServicesByUser(userId);
}

// ---------------- Extras para orders.js ----------------
export function getFullOrder(pedidoId) {
  const cab = db.prepare(`
    SELECT p.PedidoID, p.EmpleadoID, p.Rol, p.Nota, p.Total, p.Fecha, p.ServicioID
    FROM Pedidos p WHERE p.PedidoID = ? LIMIT 1
  `).get(pedidoId);

  if (!cab) return { cab: null, items: [] };

  const items = db.prepare(`
    SELECT 
      i.PedidoItemID AS id,
      i.ProductoID   AS productId,
      i.Nombre       AS nombre,
      i.Precio       AS precio,
      i.Cantidad     AS cantidad,
      i.Subtotal     AS subtotal,
      COALESCE(i.Codigo, '') AS codigo
    FROM PedidoItems i
    WHERE i.PedidoID = ?
    ORDER BY i.PedidoItemID
  `).all(pedidoId);

  return { cab, items };
}

export function getEmployeeDisplayName(userId) {
  try {
    const row = db.prepare(`
      SELECT TRIM(COALESCE(Nombre,'') || ' ' || COALESCE(Apellido,'')) AS full,
             Email,
             username
      FROM Empleados
      WHERE ${empleadoIdCol} = ?
      LIMIT 1
    `).get(userId);
    const full = (row?.full || "").trim();
    return full || row?.username || row?.Email || `Empleado ${userId}`;
  } catch {
    return `Empleado ${userId}`;
  }
}
