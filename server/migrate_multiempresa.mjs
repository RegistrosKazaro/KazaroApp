import { db } from "./src/db.js";
db.pragma("foreign_keys = OFF");

const log = (...a) => console.log("[migrate]", ...a);

function tableExists(name) {
  return !!db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1"
  ).get(name);
}
function colExists(table, col) {
  if (!tableExists(table)) return false;
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .some((c) => String(c.name).toLowerCase() === col.toLowerCase());
}
function addColIfMissing(table, colDef, colName) {
  if (!tableExists(table)) { log(`skip ${table} (no existe)`); return; }
  if (colExists(table, colName)) { log(`ok ${table}.${colName} ya existe`); return; }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
  log(`+ columna ${table}.${colName}`);
}
function setDefaultEmpresa(table) {
  if (!colExists(table, "empresa_id")) return;
  const r = db.prepare(`UPDATE ${table} SET empresa_id = 1 WHERE empresa_id IS NULL`).run();
  if (r.changes) log(`= ${table}: ${r.changes} filas -> empresa_id=1`);
}

const tx = db.transaction(() => {
  // 1) Tabla Empresas
  if (!tableExists("Empresas")) {
    db.exec(`
      CREATE TABLE Empresas (
        EmpresaID INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        nombre TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
      )`);
    log("+ tabla Empresas");
  }
  const upsertEmp = db.prepare(`
    INSERT INTO Empresas (EmpresaID, slug, nombre, is_active) VALUES (?, ?, ?, 1)
    ON CONFLICT(EmpresaID) DO UPDATE SET slug=excluded.slug, nombre=excluded.nombre
  `);
  upsertEmp.run(1, "kazaro", "Kazaro");
  upsertEmp.run(2, "pazar", "Pazar");
  log("= seed Empresas (1=Kazaro, 2=Pazar)");

  // 2) EmpresaMailConfig
  if (!tableExists("EmpresaMailConfig")) {
    db.exec(`
      CREATE TABLE EmpresaMailConfig (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        empresa_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        UNIQUE(empresa_id, key)
      )`);
    log("+ tabla EmpresaMailConfig");
  }

  // 3) Columnas empresa_id
  addColIfMissing("Empleados",  "empresa_id INTEGER REFERENCES Empresas(EmpresaID)", "empresa_id");
  addColIfMissing("Pedidos",    "empresa_id INTEGER REFERENCES Empresas(EmpresaID)", "empresa_id");
  addColIfMissing("Servicios",  "empresa_id INTEGER REFERENCES Empresas(EmpresaID)", "empresa_id");
  addColIfMissing("Ordenes",    "empresa_id INTEGER REFERENCES Empresas(EmpresaID)", "empresa_id");
  addColIfMissing("Productos",  "empresa_id INTEGER REFERENCES Empresas(EmpresaID)", "empresa_id");
  addColIfMissing("Categorias", "empresa_id INTEGER REFERENCES Empresas(EmpresaID)", "empresa_id");

  // 4) Backfill: todo lo existente es de Kazaro
  ["Empleados","Pedidos","Servicios","Ordenes","Productos","Categorias"].forEach(setDefaultEmpresa);

  // 5) Índices únicos POR empresa (reemplazan los globales)
  if (colExists("Productos", "empresa_id")) {
    db.exec(`DROP INDEX IF EXISTS ux_product_code`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_product_code
             ON Productos(Code, empresa_id) WHERE Code IS NOT NULL AND Code != ''`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_productos_empresa ON Productos(empresa_id)`);
    log("= índice ux_product_code (Code, empresa_id)");
  }
  if (colExists("Servicios", "empresa_id")) {
    db.exec(`DROP INDEX IF EXISTS ux_servicios_nombre`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_servicios_nombre
             ON Servicios(ServicioNombre, empresa_id) WHERE ServicioNombre IS NOT NULL AND ServicioNombre != ''`);
    log("= índice ux_servicios_nombre (ServicioNombre, empresa_id)");
  }

  // 6) Categorías de Pazar (solo si no existen aún para empresa 2)
  if (colExists("Categorias", "empresa_id")) {
    const insCat = db.prepare(`
      INSERT INTO Categorias (CategoriaNombre, empresa_id)
      SELECT ?, 2
      WHERE NOT EXISTS (
        SELECT 1 FROM Categorias WHERE lower(trim(CategoriaNombre)) = lower(trim(?)) AND empresa_id = 2
      )
    `);
    for (const nombre of ["Aceites / Grasa","EPP","Insumos maquinarias","Bolsas","Combustibles"]) {
      const r = insCat.run(nombre, nombre);
      if (r.changes) log(`+ categoria Pazar: ${nombre}`);
    }
  }

  // 7) Config de mail de Pazar (idempotente). NO toca el .env de Kazaro.
  for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS"]) {
    db.prepare("DELETE FROM EmpresaMailConfig WHERE empresa_id=2 AND key=?").run(k);
  }
  const setMail = db.prepare(`
    INSERT INTO EmpresaMailConfig (empresa_id, key, value) VALUES (2, ?, ?)
    ON CONFLICT(empresa_id, key) DO UPDATE SET value=excluded.value
  `);
  const pazarMail = {
    MAIL_FROM: "Pazar Pedidos <nicolas.barcena@kazaro.com.ar>",
    MAIL_TO: "nicolas.barcena@kazaro.com.ar,agustin.torresmartinez@pazar.com.ar,Juan.brarda@pazar.com.ar,diego.echevarria@pazar.com.ar",
    MAIL_CC: "",
    MAIL_BCC: "",
  };
  for (const [k, v] of Object.entries(pazarMail)) setMail.run(k, v);
  log("= mail config Pazar (empresa_id=2) — SMTP heredado del .env");
  // 7b) Config hardcodeada de Kazaro -> EmpresaMailConfig (editable). Solo si no existe.
  const setK = db.prepare(`
    INSERT INTO EmpresaMailConfig (empresa_id, key, value) VALUES (1, ?, ?)
    ON CONFLICT(empresa_id, key) DO NOTHING
  `);
  setK.run("MAIL_ALWAYS", "nicolas.barcena@kazaro.com.ar");
  setK.run("MAIL_UNIFORMES_TO", "eugenia.alvarez@kazaro.com.ar,nicolas.barcena@kazaro.com.ar");
  setK.run("DEPOSITO_CC", "gustavo.bacur@kazaro.com.ar");
  log("= config hardcode Kazaro -> EmpresaMailConfig");

  // 8) soft-delete: deleted_at
  addColIfMissing("Pedidos",   "deleted_at TEXT", "deleted_at");
  addColIfMissing("Servicios", "deleted_at TEXT", "deleted_at");

  // 9) Auditoría de acciones
  if (!tableExists("audit_log")) {
    db.exec(`
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        empresa_id INTEGER,
        usuario TEXT,
        accion TEXT NOT NULL,
        entidad TEXT,
        entidad_id TEXT,
        detalle TEXT,
        fecha TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_fecha ON audit_log(fecha)`);
    log("+ tabla audit_log");
  }
  if (!tableExists("password_resets")) {
    db.exec(`
      CREATE TABLE password_resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        empleado_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_preset_token ON password_resets(token_hash)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_preset_emp ON password_resets(empleado_id)`);
    log("+ tabla password_resets");
  }
// 11) 2FA (TOTP) para empleados
  addColIfMissing("Empleados", "totp_secret TEXT", "totp_secret");
  addColIfMissing("Empleados", "totp_enabled INTEGER NOT NULL DEFAULT 0", "totp_enabled");

  // 12) Plantillas de pedidos
  if (!tableExists("order_templates")) {
    db.exec(`
      CREATE TABLE order_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        empresa_id INTEGER,
        empleado_id INTEGER NOT NULL,
        nombre TEXT NOT NULL,
        items_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_otpl_emp ON order_templates(empleado_id, empresa_id)`);
    log("+ tabla order_templates");
  }
  if (!tableExists("notifications")) {
    db.exec(`
      CREATE TABLE notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        empresa_id INTEGER,
        empleado_id INTEGER NOT NULL,
        tipo TEXT,
        titulo TEXT NOT NULL,
        cuerpo TEXT,
        leida INTEGER NOT NULL DEFAULT 0,
        link TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_notif_emp ON notifications(empleado_id, leida)`);
    log("+ tabla notifications");
  }
  if (!tableExists("devoluciones")) {
    db.exec(`
      CREATE TABLE devoluciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pedido_id INTEGER NOT NULL,
        producto_id INTEGER NOT NULL,
        cantidad INTEGER NOT NULL,
        motivo TEXT,
        empresa_id INTEGER,
        solicitante_id INTEGER,
        aprobador_id INTEGER,
        estado TEXT NOT NULL DEFAULT 'pendiente',
        fecha_solicitud TEXT NOT NULL DEFAULT (datetime('now')),
        fecha_resolucion TEXT
      )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_dev_pedido ON devoluciones(pedido_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_dev_estado ON devoluciones(estado, empresa_id)`);
    log("+ tabla devoluciones");
  }
  addColIfMissing("Productos", "image_url TEXT", "image_url");

  // 13) Flexxus: matcheo de códigos de producto de Kazaro contra Flexxus
  // (versión anterior comparaba Kazaro vs Pazar por error; se recrea con el
  // esquema correcto. No había datos manuales cargados todavía, es seguro.)
  if (colExists("FlexxusProductMatch", "pazar_name")) {
    db.exec(`DROP TABLE FlexxusProductMatch`);
    log("~ tabla FlexxusProductMatch (esquema viejo Kazaro/Pazar) eliminada");
  }
  if (!tableExists("FlexxusProductMatch")) {
    db.exec(`
      CREATE TABLE FlexxusProductMatch (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        empresa_id    INTEGER NOT NULL DEFAULT 1,
        code          TEXT NOT NULL,
        product_id    TEXT,
        product_name  TEXT,
        app_stock     REAL,
        estado        TEXT NOT NULL,
        flexxus_sku   TEXT,
        flexxus_name  TEXT,
        flexxus_stock REAL,
        ultima_sync   TEXT,
        updated_at    TEXT NOT NULL,
        UNIQUE(empresa_id, code)
      )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_fpm_estado ON FlexxusProductMatch(estado)`);
    log("+ tabla FlexxusProductMatch (Kazaro vs Flexxus)");
  }
});

tx();
db.close();
log("MIGRACION COMPLETA OK");
