import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { env } from "./utils/env.js";

/* =====================  Resolución de ruta de DB  ===================== */
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
  // si no existe ninguno, devolvemos el primero para que se cree
  return candidates[0];
}

const dbPath = resolveDbPath();
export const DB_RESOLVED_PATH = dbPath;

export const db = new Database(dbPath, { fileMustExist: fs.existsSync(dbPath) });
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

/* =====================  Helpers base e introspección  ===================== */
function norm(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function tinfo(table) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all(); }
  catch { return []; }
}
function allTables() {
  try {
    return db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map(r => r.name);
  } catch { return []; }
}
function tableExists(name) {
  const lower = String(name).toLowerCase();
  return allTables().some(t => t.toLowerCase() === lower);
}
function hasRows(table) {
  try { return !!db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get(); }
  catch { return false; }
}
function fkList(table) {
  try { return db.prepare(`PRAGMA foreign_key_list(${table})`).all(); }
  catch { return []; }
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
export function pick(info, regex, fallback = null) {
  const hit = info.find(c => regex.test(String(c.name)));
  return hit ? hit.name : fallback;
}

/* =====================  Empleados / Roles  ===================== */
const empInfo = tinfo("Empleados");
const empleadoIdCol =
  (empInfo.find(c => c.pk === 1)?.name) ||
  pickCol(empInfo, ["EmpleadosID","EmpleadoID","EmpleadoId","IdEmpleado","empleado_id","user_id","id","ID"]) ||
  "EmpleadosID";

const reInfo = tinfo("Roles_Empleados");
const reEmpleadoIdCol =
  pickCol(reInfo, ["EmpleadoID","EmpleadoId","IdEmpleado","empleado_id","user_id","id_empleado"]) || "EmpleadoID";
const reRolIdCol =
  pickCol(reInfo, ["RolID","IdRol","rol_id","id_rol","id"]) || "RolID";

const rolesInfo = tinfo("Roles");
const rolesIdCol   = pickCol(rolesInfo, ["RolID","IdRol","rol_id","id_rol","id"]) || "RolID";
const rolesNameCol = pickCol(rolesInfo, ["Rol","Nombre","name","Descripcion","descripcion"]) || "Nombre";

export function getUserForLogin(userOrEmailInput) {
  if (!tableExists("Empleados")) return null;
  const eInfo = tinfo("Empleados");

  const idCol =
    (eInfo.find(c => c.pk === 1)?.name) ||
    pickCol(eInfo, ["EmpleadosID","EmpleadoID","IdEmpleado","empleado_id","user_id","id","ID"]) ||
    "EmpleadosID";

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

/* =====================  Catálogo (descubrimiento dinámico)  ===================== */
const NAME_CANDIDATES  = ["Nombre","NombreProducto","Nombre_Producto","Descripcion","Detalle","Producto","Titulo","title","name","descripcion"];
const CODE_CANDIDATES  = ["Codigo","CodigoProducto","Codigo_Producto","SKU","sku","codigo","code","Code"];
const PRICE_CANDIDATES = ["Precio","precio","Price","Costo","costo","importe","Valor","valor"];
const STOCK_CANDIDATES = ["Stock","Existencia","Cantidad","Disponibilidad","stock","existencia","cantidad"];
const CAT_CANDIDATES   = [
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
  "Grupo","Tipo","Clasificacion","categoria_nombre","nombre_categoria","Nombre"
];
const CATTABLE_HINTS = ["categor","rubro","famil","servi","secci","grup","tipo","clasif"];

function scoreProductTable(tbl) {
  const info = tinfo(tbl);
  if (!info.length || !hasRows(tbl)) return { score: 0 };
  const hasName  = !!pickCol(info, NAME_CANDIDATES) || info.some(c => /TEXT/i.test(String(c.type)));
  const hasPrice = !!pickCol(info, PRICE_CANDIDATES);
  const hasCode  = !!pickCol(info, CODE_CANDIDATES);
  const maybeCat = !!pickCol(info, CAT_CANDIDATES) || !!pickCol(info, CATNAME_CANDIDATES);
  const blacklist = ["Empleados","Roles","Roles_Empleados","Pedidos","PedidoItems","Usuarios","Logs","supervisor_services","service_products","Ordenes","OrdenesDetalles","remitos","remito_items","email_log","Stock","sequences","service_emails"];
  if (blacklist.includes(tbl)) return { score: 0 };
  let score = 0;
  if (hasName)  score += 4;
  if (hasPrice) score += 2;
  if (hasCode)  score += 1;
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
    const info = tinfo(fk.table);
    const catId   = fk.to || (info.find(c => c.pk === 1)?.name) ||
                    pickCol(info, ["CategoriaID","IdCategoria","id","ID"]);
    const catName = pickCol(info, CATNAME_CANDIDATES);
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
    const info = tinfo(t);
    if (!info.length || !hasRows(t)) continue;
    const black = ["Empleados","Roles","Roles_Empleados","Pedidos","PedidoItems","Usuarios","Logs","supervisor_services","service_products","Ordenes","OrdenesDetalles","remitos","remito_items","email_log","Stock","sequences","service_emails"];
    if (black.includes(t)) continue;

    const catId   = pickCol(info, ["CategoriaID","IdCategoria","categoria_id","RubroID","FamiliaID","ServicioID","SeccionID","GrupoID","TipoID","ClasificacionID","id","ID"]);
    const catName = pickCol(info, CATNAME_CANDIDATES);
    if (!catId || !catName) continue;

    let joinOK = false;
    try { joinOK = !!db.prepare(`SELECT 1 FROM ${products} p JOIN ${t} c ON p.${prodCatCol} = c.${catId} LIMIT 1`).get(); } catch {}
    let score = CATTABLE_HINTS.some(h => t.toLowerCase().includes(h)) ? 3 : 0;
    if (joinOK) score += 10;
    if (!best || score > best.score) best = { score, table: t, catId, catName };
  }
  return (best && best.score >= 10) ? best : null;
}

export function discoverCatalogSchema() {
  const chosen = chooseProductTable();
  if (!chosen) return { ok: false, reason: "No se encontró ninguna tabla que parezca catálogo de productos." };

  const products = chosen.table;
  const pinfo = chosen.info;

  let prodId = (pinfo.find(c => c.pk === 1)?.name)
            || pickCol(pinfo, ["ProductoID","IdProducto","producto_id","ArticuloID","ItemID","id","ID"])
            || "rowid";

  let prodName = pickCol(pinfo, NAME_CANDIDATES);
  if (!prodName) {
    const anyText = pinfo.find(c => /TEXT/i.test(String(c.type)));
    prodName = anyText ? anyText.name : pinfo[0].name;
  }
  const prodCat   = pickCol(pinfo, CAT_CANDIDATES);
  const prodCatName = pickCol(pinfo, CATNAME_CANDIDATES);
  const prodCode  = pickCol(pinfo, CODE_CANDIDATES);
  const prodPrice = pickCol(pinfo, PRICE_CANDIDATES);
  const prodStock = pickCol(pinfo, STOCK_CANDIDATES);

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

/* =====================  Visibilidad por Rol (NUEVO)  ===================== */
// Relación muchos-a-muchos: Producto × Rol ('administrativo' | 'supervisor')
export function ensureVisibilitySchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ProductRoleVisibility (
      product_id INTEGER NOT NULL,
      role       TEXT    NOT NULL CHECK (LOWER(role) IN ('administrativo','supervisor')),
      PRIMARY KEY (product_id, role)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_prv_role ON ProductRoleVisibility(role);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_prv_product ON ProductRoleVisibility(product_id);`);
}

export function assignVisibility(productId, roleName) {
  const role = String(roleName || "").toLowerCase();
  if (!["administrativo","supervisor"].includes(role)) {
    throw new Error(`Rol inválido: ${roleName}`);
  }
  return db.prepare(`
    INSERT OR IGNORE INTO ProductRoleVisibility (product_id, role)
    VALUES (?, ?)
  `).run(productId, role);
}

export function revokeVisibility(productId, roleName) {
  const role = String(roleName || "").toLowerCase();
  return db.prepare(`
    DELETE FROM ProductRoleVisibility
    WHERE product_id = ? AND LOWER(role) = ?
  `).run(productId, role);
}

/* ========= APIs auxiliares para catálogo ========= */
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

/** ⬇️⬇️  ACTUALIZADA: ahora acepta { q, serviceId, role, roles } y filtra por ProductRoleVisibility  */
export function listProductsByCategory(categoryId, { q = "", serviceId = null, role = null, roles = null } = {}) {
  ensureVisibilitySchema();

  const sch = discoverCatalogSchema();
  if (!sch.ok) throw new Error(sch.reason);
  const { products } = sch.tables;
  const { prodId, prodName, prodCat, prodCatName, prodCode, prodPrice, prodStock } = sch.cols;

  const hasCode  = !!prodCode;
  const hasPrice = !!prodPrice;
  const hasStock = !!prodStock;

  // Detectar pivote service_products (lo conservamos)
  let pivot = null;
  try {
    const spTbl = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='service_products' LIMIT 1
    `).get();
    if (spTbl) {
      const pcols = db.prepare(`PRAGMA table_info('service_products')`).all();
      const names = new Set(pcols.map(c => String(c.name).toLowerCase()));
      if (names.has("servicioid") && names.has("productoid")) pivot = { srv: "ServicioID",  prod: "ProductoID" };
      else if (names.has("servicio_id") && names.has("producto_id")) pivot = { srv: "servicio_id", prod: "producto_id" };
      else if (names.has("service_id") && names.has("product_id"))    pivot = { srv: "service_id",  prod: "product_id"  };
    }
  } catch { /* noop */ }

  const cols = [
    `p.${prodId}   AS id`,
    `p.${prodName} AS name`,
    prodCat ? `p.${prodCat}  AS categoryId` : (prodCatName ? `p.${prodCatName} AS categoryId` : `'__all__' AS categoryId`),
    hasCode  ? `p.${prodCode}  AS code`  : `' ' AS code`,
    hasPrice ? `p.${prodPrice} AS price` : `NULL AS price`,
    hasStock ? `p.${prodStock} AS stock` : `NULL AS stock`,
  ].join(", ");

  // ====== Filtro por ROL ======
  const normRoles = []
    .concat(roles ?? [])
    .concat(role ?? [])
    .map(r => String(r).trim().toLowerCase())
    .filter(Boolean);

  const joinPRV = normRoles.length
    ? `JOIN ProductRoleVisibility prv
         ON CAST(prv.product_id AS TEXT) = CAST(p.${prodId} AS TEXT)`
    : ``;

  const where = [];
  const params = [];

  if (prodCat && categoryId !== "__all__") { where.push(`p.${prodCat} = ?`); params.push(categoryId); }
  else if (!prodCat && prodCatName && categoryId !== "__all__") { where.push(`p.${prodCatName} = ?`); params.push(categoryId); }

  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    if (hasCode) { where.push(`(p.${prodName} LIKE ? OR p.${prodCode} LIKE ?)`); params.push(like, like); }
    else { where.push(`p.${prodName} LIKE ?`); params.push(like); }
  }

  if (serviceId && pivot) {
    where.push(`
      EXISTS (
        SELECT 1 FROM service_products sp
        WHERE CAST(sp.${pivot.srv}  AS TEXT) = CAST(? AS TEXT)
          AND CAST(sp.${pivot.prod} AS TEXT) = CAST(p.${prodId} AS TEXT)
      )
    `);
    params.push(String(serviceId));
  }

  if (normRoles.length) {
    const placeholders = normRoles.map(() => '?').join(',');
    where.push(`LOWER(prv.role) IN (${placeholders})`);
    params.push(...normRoles);
  }

  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const sql = `
    SELECT ${cols}
    FROM ${products} p
    ${joinPRV}
    ${whereSQL}
    ORDER BY p.${prodName} COLLATE NOCASE
  `;
  return db.prepare(sql).all(...params);
}

export function debugCatalogSchema() {
  const sch = discoverCatalogSchema();
  if (!sch.ok) return sch;
  const sample = db.prepare(`SELECT * FROM ${sch.tables.products} LIMIT 3`).all();
  return { ...sch, sample };
}

/* =====================  **NUEVO**: asegurar columna 'stock'  ===================== */
/* Se llama al iniciar el server. No toca datos existentes. */
export function ensureStockColumn() {
  try {
    const sch = discoverCatalogSchema();
    if (!sch.ok) return;
    const products = sch.tables.products;
    const info = tinfo(products);
    const hasStock = info.some(c => String(c.name).toLowerCase() === "stock");

    if (!hasStock) {
      db.prepare(`ALTER TABLE ${products} ADD COLUMN Stock INTEGER NOT NULL DEFAULT 0`).run();
      // normalizamos posibles NULL en filas existentes
      db.prepare(`UPDATE ${products} SET Stock = 0 WHERE Stock IS NULL`).run();
      console.log(`[db] Columna 'Stock' agregada en tabla ${products}`);
    }
  } catch (e) {
    console.error("[db] ensureStockColumn error:", e?.message || e);
  }
}

/* Helper opcional para saber tabla/columna */
export function productsMeta() {
  const sch = discoverCatalogSchema();
  if (!sch.ok) return { table: null, hasStock: false };
  const products = sch.tables.products;
  const info = tinfo(products);
  const hasStock = info.some(c => String(c.name).toLowerCase() === "stock");
  return { table: products, hasStock };
}

/* =====================  Pedidos: asegurar esquema  ===================== */
function ensureOrdersSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS Pedidos (
      PedidoID   INTEGER PRIMARY KEY AUTOINCREMENT,
      EmpleadoID INTEGER NOT NULL,
      Rol        TEXT,
      Nota       TEXT,
      Total      REAL,
      Fecha      TEXT DEFAULT (datetime('now')),
      ServicioID INTEGER NULL
    );
    CREATE TABLE IF NOT EXISTS PedidoItems (
      PedidoItemID INTEGER PRIMARY KEY AUTOINCREMENT,
      PedidoID     INTEGER NOT NULL,
      ProductoID   INTEGER NOT NULL,
      Nombre       TEXT,
      Precio       REAL,
      Cantidad     INTEGER NOT NULL,
      Subtotal     REAL,
      Codigo       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pedidos_servicio ON Pedidos(ServicioID);
  `);
}
ensureOrdersSchema();
ensureVisibilitySchema(); // ⬅️ importante: crear/asegurar pivote de visibilidad al iniciar

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

/* =====================  NUEVO: createOrder con validación de stock ===================== */
export function createOrder({ empleadoId, rol, nota, items, servicioId = null }) {
  const tx = db.transaction(() => {
    let total = 0;

    // Descubrir esquema de productos (incluye columna de stock si existe)
    const sch = discoverCatalogSchema();
    if (!sch.ok) throw new Error(sch.reason);
    const { products } = sch.tables;
    const { prodId, prodName, prodPrice, prodCode, prodStock } = sch.cols;
    const hasStock = !!prodStock;

    // Cabecera
    const insPedido = db.prepare(`
      INSERT INTO Pedidos (EmpleadoID, Rol, Nota, ServicioID, Total)
      VALUES (?, ?, ?, ?, 0)
    `);
    const pedidoId = insPedido.run(empleadoId, String(rol || ""), String(nota || ""), servicioId).lastInsertRowid;

    // Detalle
    const insItem = db.prepare(`
      INSERT INTO PedidoItems (PedidoID, ProductoID, Nombre, Precio, Cantidad, Subtotal, Codigo)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const it of items || []) {
      const pid = Number(it.productId);
      const qty = Math.max(1, Number(it.qty || 1));

      // Datos del producto
      const row = db.prepare(`
        SELECT
          ${prodName} AS name,
          ${prodPrice ? prodPrice : "NULL"} AS price,
          ${prodCode ? prodCode : "''"} AS code
          ${hasStock ? `, COALESCE(${prodStock},0) AS stock` : ""}
        FROM ${products}
        WHERE ${prodId} = ?
        LIMIT 1
      `).get(pid);

      if (!row) {
        const err = new Error(`Producto ${pid} no encontrado`);
        err.code = "PRODUCT_NOT_FOUND";
        throw err;
      }

      const price = row.price != null ? Number(row.price) : 0;

      if (hasStock) {
        // Descuento atómico solo si hay stock suficiente
        const upd = db.prepare(`
          UPDATE ${products}
          SET ${prodStock} = ${prodStock} - ?
          WHERE ${prodId} = ? AND COALESCE(${prodStock},0) >= ?
        `).run(qty, pid, qty);

        if (upd.changes !== 1) {
          const available = db.prepare(`
            SELECT COALESCE(${prodStock},0) AS stock FROM ${products} WHERE ${prodId} = ? LIMIT 1
          `).get(pid)?.stock ?? 0;

          const err = new Error(
            available <= 0
              ? `Sin stock: ${row.name}`
              : `Stock insuficiente: ${row.name} (máx ${available})`
          );
          err.code = "OUT_OF_STOCK";
          err.extra = { productId: pid, name: row.name, available };
          throw err;
        }
      }

      const sub = price * qty;
      total += sub;
      insItem.run(pedidoId, pid, row.name, price, qty, sub, row.code || "");
    }

    db.prepare(`UPDATE Pedidos SET Total = ? WHERE PedidoID = ?`).run(total, pedidoId);
    return { pedidoId, total };
  });

  return tx();
}

/* =====================  Servicios / Pivote  ===================== */

/**
 * Crea la pivote si no existe (sin UNIQUE todavía).
 * Dejamos PK compuesta para no duplicar (EmpleadoID, ServicioID).
 */
export function ensureSupervisorPivot() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS supervisor_services (
      EmpleadoID  INTEGER NOT NULL,
      ServicioID  INTEGER NOT NULL,
      PRIMARY KEY (EmpleadoID, ServicioID)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_supserv_emp ON supervisor_services(EmpleadoID);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_supserv_srv ON supervisor_services(ServicioID);`);
}

/**
 * Deduplica servicios con >1 supervisor (conserva la fila MÁS RECIENTE)
 * y crea UNIQUE(ServicioID) para garantizar exclusividad a futuro.
 */
export function ensureSupervisorPivotExclusive() {
  ensureSupervisorPivot();

  const tx = db.transaction(() => {
    // Detectar servicios duplicados
    const dups = db.prepare(`
      SELECT ServicioID, COUNT(*) AS c
      FROM supervisor_services
      GROUP BY ServicioID
      HAVING c > 1
    `).all();

    // Para cada servicio, conservar rowid más nuevo y borrar el resto
    const selRows = db.prepare(`
      SELECT rowid AS rid
      FROM supervisor_services
      WHERE CAST(ServicioID AS TEXT) = CAST(? AS TEXT)
      ORDER BY rid DESC
    `);
    const delOld = db.prepare(`DELETE FROM supervisor_services WHERE rowid = ?`);

    for (const d of dups) {
      const rows = selRows.all(d.ServicioID); // rid DESC => primero es el más reciente
      for (let i = 1; i < rows.length; i++) {
        delOld.run(rows[i].rid);
      }
    }

    // Crear índice único: un Servicio solo puede estar una vez en la pivote
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_supervisor_services_service
      ON supervisor_services (ServicioID);

      -- Opcional: evitar repetir el mismo par por descuido
      CREATE UNIQUE INDEX IF NOT EXISTS ux_supervisor_services_pair
      ON supervisor_services (EmpleadoID, ServicioID);
    `);
  });

  tx();
}

/** Listado de asignaciones para panel admin (simple) */
export function listSupervisorAssignments() {
  ensureSupervisorPivot();
  return db.prepare(`
    SELECT rowid AS id, EmpleadoID, ServicioID
    FROM supervisor_services
    ORDER BY ServicioID
  `).all();
}

/**
 * Asigna de forma estricta: error 409 si el servicio ya está tomado por otro.
 * Inserta idempotente si es el mismo par (no duplica).
 */
export function assignServiceToSupervisorExclusive(EmpleadoID, ServicioID) {
  ensureSupervisorPivotExclusive();

  const existing = db.prepare(`
    SELECT EmpleadoID FROM supervisor_services
    WHERE CAST(ServicioID AS TEXT) = CAST(? AS TEXT)
    LIMIT 1
  `).get(ServicioID);

  if (existing && Number(existing.EmpleadoID) !== Number(EmpleadoID)) {
    const err = new Error(`El servicio ${ServicioID} ya está asignado al supervisor ${existing.EmpleadoID}`);
    err.status = 409;
    err.code = "SERVICE_TAKEN";
    throw err;
  }

  db.prepare(`
    INSERT OR IGNORE INTO supervisor_services (EmpleadoID, ServicioID)
    VALUES (?, ?)
  `).run(EmpleadoID, ServicioID);

  return true;
}

/**
 * Reasigna explícitamente un servicio a otro supervisor
 * (borra el dueño actual y asigna el nuevo).
 */
export function reassignServiceToSupervisor(EmpleadoID, ServicioID) {
  ensureSupervisorPivotExclusive();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM supervisor_services WHERE CAST(ServicioID AS TEXT) = CAST(? AS TEXT)`).run(ServicioID);
    db.prepare(`INSERT INTO supervisor_services (EmpleadoID, ServicioID) VALUES (?, ?)`).run(EmpleadoID, ServicioID);
  });
  tx();
  return true;
}

/** Quita asignación por rowid o por par */
export function unassignService({ id, EmpleadoID, ServicioID }) {
  ensureSupervisorPivotExclusive();
  if (id != null) {
    const r = db.prepare(`DELETE FROM supervisor_services WHERE rowid = ?`).run(Number(id));
    return r.changes > 0;
  }
  if (EmpleadoID != null && ServicioID != null) {
    const r = db.prepare(`DELETE FROM supervisor_services WHERE EmpleadoID = ? AND ServicioID = ?`)
      .run(Number(EmpleadoID), Number(ServicioID));
    return r.changes > 0;
  }
  return false;
}

// Resolver tabla/columnas de Servicios (basado en tu BD real)
function resolveServicesTable() {
  const table = "Servicios";
  const info = tinfo(table);
  const idCol = pickCol(info, ["ServiciosID","ServicioID","IdServicio","ID","Id","id"]) || (info.find(c => c.pk === 1)?.name) || "ServiciosID";
  const nameCol = pickCol(info, ["ServicioNombre","Nombre","Servicio","Descripcion","Detalle","Titulo","NombreServicio"]) || "ServicioNombre";
  const nameExpr = `COALESCE(NULLIF(TRIM(s.${nameCol}), ''), CAST(s.${idCol} AS TEXT))`;
  return { table, idCol, nameExpr, nameCol };
}

// Lista { id, name } de servicios asignados al usuario
export function listServicesByUser(userId) {
  ensureSupervisorPivotExclusive();
  const spec = resolveServicesTable();
  const rows = db.prepare(`
    SELECT s.${spec.idCol} AS sid,
           ${spec.nameExpr} AS sname
    FROM supervisor_services a
    JOIN ${spec.table} s
      ON CAST(s.${spec.idCol} AS TEXT) = CAST(a.ServicioID AS TEXT)
    WHERE CAST(a.EmpleadoID AS TEXT) = CAST(? AS TEXT)
    ORDER BY sname COLLATE NOCASE
  `).all(userId);
  return rows.map(r => ({ id: Number(r.sid), name: String(r.sname) }));
}

export function getAssignedServices(userId) {
  return listServicesByUser(userId);
}

/* === nombre de servicio por ID para asunto del mail === */
export function getServiceNameById(servicioId) {
  const spec = resolveServicesTable();
  if (!spec) return null;
  const row = db.prepare(`
    SELECT ${spec.nameExpr} AS name
    FROM ${spec.table} s
    WHERE CAST(s.${spec.idCol} AS TEXT) = CAST(? AS TEXT)
    LIMIT 1
  `).get(servicioId);
  return row?.name || null;
}

// ✅ activar exclusividad al cargar el módulo
ensureSupervisorPivotExclusive();

/* =====================  PRESUPUESTOS POR SERVICIO (NUEVO) ===================== */
/* Tabla simple: un presupuesto (monto base) por ServicioID */
export function ensureServiceBudgetTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS service_budget (
      ServicioID INTEGER PRIMARY KEY,
      Presupuesto REAL NOT NULL
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_srvbudget_serv ON service_budget(ServicioID);`);
}

export function getBudgetByServiceId(servicioId) {
  ensureServiceBudgetTable();
  try {
    const row = db.prepare(`
      SELECT Presupuesto AS budget
      FROM service_budget
      WHERE CAST(ServicioID AS TEXT) = CAST(? AS TEXT)
      LIMIT 1
    `).get(servicioId);
    return row?.budget ?? null;
  } catch {
    return null;
  }
}

export function setBudgetForService(servicioId, presupuesto) {
  ensureServiceBudgetTable();
  db.prepare(`
    INSERT INTO service_budget(ServicioID, Presupuesto)
    VALUES(CAST(? AS TEXT), ?)
    ON CONFLICT(ServicioID) DO UPDATE SET Presupuesto = excluded.Presupuesto
  `).run(servicioId, Number(presupuesto));
  return getBudgetByServiceId(servicioId);
}

export function listServiceBudgets() {
  ensureServiceBudgetTable();
  const spec = resolveServicesTable();
  try {
    return db.prepare(`
      SELECT s.${spec.idCol} AS id,
             ${spec.nameExpr} AS name,
             b.Presupuesto AS budget
      FROM ${spec.table} s
      LEFT JOIN service_budget b
        ON CAST(b.ServicioID AS TEXT) = CAST(s.${spec.idCol} AS TEXT)
      ORDER BY name COLLATE NOCASE
    `).all();
  } catch {
    return [];
  }
}

/* =====================  Extras para órdenes  ===================== */
export function getFullOrder(pedidoId) {
  const cab = db.prepare(`
    SELECT p.PedidoID, p.EmpleadoID, p.Rol, p.Nota, p.Total, p.Fecha, p.ServicioID
    FROM Pedidos p WHERE p.PedidoID = ? LIMIT 1
  `).get(pedidoId);

  if (!cab) return { cab: null, items: [] };

  const items = db.prepare(`
    SELECT 
      i.PedidoItemID AS id,
      i.PedidoID,
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
      SELECT
        TRIM(COALESCE(Nombre,'') || ' ' || COALESCE(Apellido,'')) AS full,
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

/* ======================== ADMIN: Categorías & Productos ======================== */
export function adminListCategoriesForSelect() {
  const sch = discoverCatalogSchema();
  if (!sch.ok) throw new Error(sch.reason);

  const { products, categories } = sch.tables;
  const { prodCatName, catId, catName } = sch.cols;

  if (categories && catId && catName) {
    return db.prepare(`
      SELECT ${catId} AS id, ${catName} AS name
      FROM ${categories}
      ORDER BY ${catName} COLLATE NOCASE
    `).all();
  }

  if (prodCatName) {
    return db.prepare(`
      SELECT TRIM(${prodCatName}) AS name, TRIM(${prodCatName}) AS id
      FROM ${products}
      WHERE TRIM(IFNULL(${prodCatName}, '')) <> ''
      GROUP BY TRIM(${prodCatName})
      ORDER BY TRIM(${prodCatName}) COLLATE NOCASE
    `).all();
  }

  return [];
}

export function adminGetProductById(id) {
  const sch = discoverCatalogSchema();
  if (!sch.ok) throw new Error(sch.reason);

  const { products } = sch.tables;
  const { prodId, prodName, prodPrice, prodStock, prodCode, prodCat, prodCatName } = sch.cols;

  const cols = [
    `${prodId} AS id`,
    `${prodName} AS name`,
    prodPrice ? `${prodPrice} AS price` : `NULL AS price`,
    prodStock ? `${prodStock} AS stock` : `NULL AS stock`,
    prodCode  ? `${prodCode} AS code`  : `NULL AS code`,
    prodCat   ? `${prodCat} AS categoryId` : (prodCatName ? `${prodCatName} AS categoryName` : `NULL AS categoryName`),
  ].join(", ");

  return db.prepare(`SELECT ${cols} FROM ${products} WHERE ${prodId} = ? OR rowid = ? LIMIT 1`).get(id, id);
}

export function adminCreateProduct(fields = {}) {
  const sch = discoverCatalogSchema();
  if (!sch.ok) throw new Error(sch.reason);

  const { products } = sch.tables;
  const { prodId, prodName, prodPrice, prodStock, prodCode, prodCat, prodCatName } = sch.cols;

  if (!prodName) throw new Error("No se detectó columna de nombre en productos.");

  const cols = [];
  const vals = [];
  const args = [];

  cols.push(prodName); vals.push("?"); args.push(String(fields.name ?? "").trim());
  if (prodPrice && fields.price != null) { cols.push(prodPrice); vals.push("?"); args.push(Number(fields.price) || 0); }
  if (prodStock && fields.stock != null) { cols.push(prodStock); vals.push("?"); args.push(Math.max(0, parseInt(fields.stock) || 0)); }
  if (prodCode  && fields.code  != null) { cols.push(prodCode);  vals.push("?"); args.push(String(fields.code)); }

  if (prodCat && fields.categoryId != null) {
    cols.push(prodCat); vals.push("?"); args.push(fields.categoryId);
  } else if (!prodCat && prodCatName && fields.categoryName != null) {
    cols.push(prodCatName); vals.push("?"); args.push(String(fields.categoryName).trim());
  }

  const sql = `INSERT INTO ${products} (${cols.join(",")}) VALUES (${vals.join(",")})`;
  const info = db.prepare(sql).run(...args);

  const selCols = [
    `${prodId} AS id`,
    `${prodName} AS name`,
    prodPrice ? `${prodPrice} AS price` : `NULL AS price`,
    prodStock ? `${prodStock} AS stock` : `NULL AS stock`,
    prodCode  ? `${prodCode} AS code`  : `NULL AS code`,
    prodCat   ? `${prodCat} AS categoryId` : (prodCatName ? `${prodCatName} AS categoryName` : `NULL AS categoryName`),
  ].join(", ");

  return db.prepare(`SELECT ${selCols} FROM ${products} WHERE ${prodId} = ?`).get(info.lastInsertRowid);
}

export function adminUpdateProduct(id, fields = {}) {
  const sch = discoverCatalogSchema();
  if (!sch.ok) throw new Error(sch.reason);

  const { products } = sch.tables;
  const { prodId, prodName, prodPrice, prodStock, prodCode, prodCat, prodCatName } = sch.cols;

  const set = [];
  const args = [];

  if (fields.name != null && prodName)  { set.push(`${prodName} = ?`);  args.push(String(fields.name).trim()); }
  if (fields.price != null && prodPrice){ set.push(`${prodPrice} = ?`); args.push(Number(fields.price) || 0); }
  if (fields.stock != null && prodStock){ set.push(`${prodStock} = ?`); args.push(Math.max(0, parseInt(fields.stock) || 0)); }
  if (fields.code  != null && prodCode) { set.push(`${prodCode}  = ?`); args.push(String(fields.code)); }

  if (prodCat && fields.categoryId !== undefined) {
    set.push(`${prodCat} = ?`); args.push(fields.categoryId);
  } else if (!prodCat && prodCatName && fields.categoryName !== undefined) {
    set.push(`${prodCatName} = ?`); args.push(String(fields.categoryName).trim());
  }

  if (!set.length) {
    return db.prepare(`SELECT * FROM ${products} WHERE ${prodId} = ? OR rowid = ?`).get(id, id) || null;
  }

  db.prepare(`UPDATE ${products} SET ${set.join(", ")} WHERE ${prodId} = ? OR rowid = ?`).run(...args, id, id);

  const selCols = [
    `${prodId} AS id`,
    `${prodName} AS name`,
    prodPrice ? `${prodPrice} AS price` : `NULL AS price`,
    prodStock ? `${prodStock} AS stock` : `NULL AS stock`,
    prodCode  ? `${prodCode} AS code`  : `NULL AS code`,
    prodCat   ? `${prodCat} AS categoryId` : (prodCatName ? `${prodCatName} AS categoryName` : `NULL AS categoryName`),
  ].join(", ");

  return db.prepare(`SELECT ${selCols} FROM ${products} WHERE ${prodId} = ? OR rowid = ?`).get(id, id);
}
