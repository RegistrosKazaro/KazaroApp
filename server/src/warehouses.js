// server/src/warehouses.js
//
// Gestión de depósitos internos (ej: DEPOSITO MENDOZA).
//
// NOTA: Este archivo importa "db" desde db.js. Eso funciona porque
// en el arranque db.js llama a ensureWarehouseSeed() recién al final,
// cuando ya exportó todo. No hay dependencia circular.

import { db } from "./db.js";

/* ============================================================
   Schema (se crea solo al primer require del módulo)
   ============================================================ */

export function ensureWarehouseSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS warehouses (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      name              TEXT NOT NULL UNIQUE,
      linked_service_id TEXT
    );

    CREATE TABLE IF NOT EXISTS warehouse_stock (
      warehouse_id INTEGER NOT NULL,
      product_id   TEXT    NOT NULL,
      qty          INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (warehouse_id, product_id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_wh_stock_prod ON warehouse_stock(product_id);

    CREATE TABLE IF NOT EXISTS warehouse_services (
      warehouse_id INTEGER NOT NULL,
      service_id   TEXT    NOT NULL,
      PRIMARY KEY (warehouse_id, service_id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_wh_services_svc ON warehouse_services(service_id);

    CREATE TABLE IF NOT EXISTS warehouse_movements (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      warehouse_id INTEGER NOT NULL,
      product_id   TEXT    NOT NULL,
      type         TEXT    NOT NULL CHECK (type IN ('IN','OUT')),
      qty          INTEGER NOT NULL,
      service_id   TEXT,
      pedido_id    INTEGER,
      name         TEXT,
      code         TEXT,
      price        REAL,
      subtotal     REAL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_wh_mov_wh       ON warehouse_movements(warehouse_id);
    CREATE INDEX IF NOT EXISTS idx_wh_mov_prod     ON warehouse_movements(product_id);
    CREATE INDEX IF NOT EXISTS idx_wh_mov_date     ON warehouse_movements(created_at);
    CREATE INDEX IF NOT EXISTS idx_wh_mov_svc      ON warehouse_movements(service_id);
  `);
}

// Se crea al cargar el módulo.
ensureWarehouseSchema();

/* ============================================================
   Seed del depósito "DEPOSITO MENDOZA" con sus 5 servicios hijos.
   Idempotente: se puede llamar muchas veces.
   ============================================================ */

const WAREHOUSE_NAME = "DEPOSITO MENDOZA";
const CHILD_SERVICE_NAMES = [
  "CONS DE PROP PARQUE MILENICA LAS HERAS",
  "DROGUERIA MONROE AMERICANA S.A",
  "TADICOR LAS HERAS MENDOZA",
  "TADICOR SAN MARTIN MENDOZA",
  "VIAL TRUCK SA",
];

function _normName(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ");
}

function findServiceIdByName(name) {
  const wanted = _normName(name);
  const rows = db.prepare(`SELECT * FROM Servicios`).all();
  for (const r of rows) {
    const candidates = [
      r.ServicioNombre, r.Nombre, r.Servicio,
      r.Descripcion, r.Detalle, r.Titulo, r.NombreServicio,
    ].filter(v => v != null);
    for (const c of candidates) {
      if (_normName(c) === wanted) {
        const id = r.ServiciosID ?? r.ServicioID ?? r.IdServicio ?? r.id ?? r.ID;
        if (id != null) return String(id);
      }
    }
  }
  return null;
}

export function ensureWarehouseSeed() {
  const linkedServiceId = findServiceIdByName(WAREHOUSE_NAME);
  if (!linkedServiceId) {
    console.warn(
      `[warehouses] No se encontró el servicio "${WAREHOUSE_NAME}". ` +
      `El depósito se creará, pero sin servicio ligado para reposición.`
    );
  }

  const existing = db.prepare(
    `SELECT id, linked_service_id FROM warehouses WHERE name = ? LIMIT 1`
  ).get(WAREHOUSE_NAME);

  let warehouseId;
  if (existing) {
    warehouseId = existing.id;
    if (linkedServiceId && String(existing.linked_service_id ?? "") !== String(linkedServiceId)) {
      db.prepare(`UPDATE warehouses SET linked_service_id = ? WHERE id = ?`)
        .run(String(linkedServiceId), warehouseId);
    }
  } else {
    warehouseId = db.prepare(
      `INSERT INTO warehouses (name, linked_service_id) VALUES (?, ?)`
    ).run(WAREHOUSE_NAME, linkedServiceId ? String(linkedServiceId) : null).lastInsertRowid;
  }

  const insChild = db.prepare(
    `INSERT OR IGNORE INTO warehouse_services (warehouse_id, service_id) VALUES (?, ?)`
  );
  for (const childName of CHILD_SERVICE_NAMES) {
    const sid = findServiceIdByName(childName);
    if (!sid) {
      console.warn(`[warehouses] Servicio hijo "${childName}" no encontrado — omitido.`);
      continue;
    }
    insChild.run(warehouseId, String(sid));
  }

  return warehouseId;
}

/* ============================================================
   Lookups usados por createOrder
   ============================================================ */

export function getWarehouseForChildService(servicioId) {
  if (servicioId == null || servicioId === "") return null;
  const row = db.prepare(`
    SELECT w.id AS id, w.name AS name, w.linked_service_id AS linkedServiceId
    FROM warehouse_services ws
    JOIN warehouses w ON w.id = ws.warehouse_id
    WHERE CAST(ws.service_id AS TEXT) = CAST(? AS TEXT)
    LIMIT 1
  `).get(String(servicioId));
  return row || null;
}

export function getWarehouseForLinkedService(servicioId) {
  if (servicioId == null || servicioId === "") return null;
  const row = db.prepare(`
    SELECT id, name, linked_service_id AS linkedServiceId
    FROM warehouses
    WHERE CAST(linked_service_id AS TEXT) = CAST(? AS TEXT)
    LIMIT 1
  `).get(String(servicioId));
  return row || null;
}

export function getWarehouseStock(warehouseId, productId) {
  const row = db.prepare(`
    SELECT qty FROM warehouse_stock
    WHERE warehouse_id = ? AND CAST(product_id AS TEXT) = CAST(? AS TEXT)
    LIMIT 1
  `).get(Number(warehouseId), String(productId));
  return Number(row?.qty ?? 0);
}

export function getWarehouseStockMap(warehouseId) {
  const rows = db.prepare(`
    SELECT CAST(product_id AS TEXT) AS pid, qty
    FROM warehouse_stock
    WHERE warehouse_id = ?
  `).all(Number(warehouseId));
  const m = new Map();
  for (const r of rows) m.set(r.pid, Number(r.qty || 0));
  return m;
}

/* ============================================================
   Mutaciones (deben correr dentro de una transacción externa)
   ============================================================ */

export function warehouseDecrementStock({
  warehouseId, productId, qty, serviceId, pedidoId,
  name = null, code = null, price = null,
}) {
  const q = Math.max(0, Math.trunc(Number(qty) || 0));
  if (q <= 0) return;

  db.prepare(`
    INSERT OR IGNORE INTO warehouse_stock (warehouse_id, product_id, qty)
    VALUES (?, ?, 0)
  `).run(Number(warehouseId), String(productId));

  const upd = db.prepare(`
    UPDATE warehouse_stock
    SET qty = qty - ?
    WHERE warehouse_id = ?
      AND CAST(product_id AS TEXT) = CAST(? AS TEXT)
      AND qty >= ?
  `).run(q, Number(warehouseId), String(productId), q);

  if (upd.changes !== 1) {
    const current = getWarehouseStock(warehouseId, productId);
    const err = new Error(
      current <= 0
        ? `Sin stock en depósito: ${name || productId}`
        : `Stock insuficiente en depósito: ${name || productId} (máx ${current})`
    );
    err.code = "WAREHOUSE_NO_STOCK";
    throw err;
  }

  const subtotal = price != null ? Number(price) * q : null;
  db.prepare(`
    INSERT INTO warehouse_movements
      (warehouse_id, product_id, type, qty, service_id, pedido_id, name, code, price, subtotal)
    VALUES (?, ?, 'OUT', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Number(warehouseId), String(productId), q,
    serviceId != null ? String(serviceId) : null,
    pedidoId != null ? Number(pedidoId) : null,
    name, code, price, subtotal
  );
}

export function warehouseIncrementStock({
  warehouseId, productId, qty, serviceId, pedidoId,
  name = null, code = null, price = null,
}) {
  const q = Math.max(0, Math.trunc(Number(qty) || 0));
  if (q <= 0) return;

  db.prepare(`
    INSERT INTO warehouse_stock (warehouse_id, product_id, qty)
    VALUES (?, ?, ?)
    ON CONFLICT(warehouse_id, product_id) DO UPDATE SET qty = qty + excluded.qty
  `).run(Number(warehouseId), String(productId), q);

  const subtotal = price != null ? Number(price) * q : null;
  db.prepare(`
    INSERT INTO warehouse_movements
      (warehouse_id, product_id, type, qty, service_id, pedido_id, name, code, price, subtotal)
    VALUES (?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Number(warehouseId), String(productId), q,
    serviceId != null ? String(serviceId) : null,
    pedidoId != null ? Number(pedidoId) : null,
    name, code, price, subtotal
  );
}

/* ============================================================
   Listados para UI / reportes
   ============================================================ */

export function listWarehouses() {
  return db.prepare(`
    SELECT id, name, linked_service_id AS linkedServiceId
    FROM warehouses
    ORDER BY name COLLATE NOCASE
  `).all();
}

export function getWarehouseById(id) {
  return db.prepare(`
    SELECT id, name, linked_service_id AS linkedServiceId
    FROM warehouses WHERE id = ? LIMIT 1
  `).get(Number(id));
}

export function listWarehouseChildServices(warehouseId) {
  return db.prepare(`
    SELECT service_id AS serviceId
    FROM warehouse_services
    WHERE warehouse_id = ?
  `).all(Number(warehouseId)).map(r => String(r.serviceId));
}