// server/src/routes/admin.js
import { Router } from "express";
import XLSX from "xlsx";
import multer from "multer";

import {
  db,
  discoverCatalogSchema,
  adminListCategoriesForSelect,
  adminGetProductById,
  listServiceBudgets,
  setBudgetForService,
  ensureSupervisorPivotExclusive,
  assignServiceToSupervisorExclusive,
  reassignServiceToSupervisor,
  unassignService,
  getServiceNameById,
  getEmployeeDisplayName,
  ensureServiceProductsPivot, // para Servicio ⇄ Productos
} from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sendMail } from "../utils/mailer.js";

const router = Router();
const mustBeAdmin = [requireAuth, requireRole(["admin", "Admin"])];

// Upload Excel en memoria
const upload = multer({ storage: multer.memoryStorage() });



function prodSchemaOrThrow() {
  const sch = discoverCatalogSchema();
  if (!sch?.ok) throw new Error(sch?.reason || "No hay esquema de productos");
  return sch;
}

// ✅ Quote seguro para identificadores SQL (SQLite)
function qid(x) {
  return `"${String(x).replace(/"/g, '""')}"`;
}

/* =========================
   Productos (catálogo admin)
   ========================= */

router.get("/products/_schema", mustBeAdmin, (_req, res) => {
  try {
    const sch = prodSchemaOrThrow();
    res.json({
      ok: true,
      table: sch.tables.products,
      categoriesTable: sch.tables.categories || null,
      cols: sch.cols,
    });
  } catch (e) {
    res
      .status(500)
      .json({ error: e?.message || "No se pudo detectar el esquema" });
  }
});

router.get("/product-categories", mustBeAdmin, (_req, res) => {
  try {
    res.json(adminListCategoriesForSelect());
  } catch {
    res.status(500).json({ error: "No se pudieron cargar las categorías" });
  }
});

/**
 * GET /admin/products?q=...
 */
router.get("/products", mustBeAdmin, (req, res) => {
  try {
    const sch = prodSchemaOrThrow();
    const { products } = sch.tables;
    const {
      prodId,
      prodName,
      prodPrice,
      prodStock,
      prodCode,
      prodCat,
      prodCatName,
    } = sch.cols;

    const T = qid(products);
    const C_ID = qid(prodId);
    const C_NAME = qid(prodName);
    const C_PRICE = prodPrice ? qid(prodPrice) : null;
    const C_STOCK = prodStock ? qid(prodStock) : null;
    const C_CODE = prodCode ? qid(prodCode) : null;
    const C_CAT = prodCat ? qid(prodCat) : null;
    const C_CATNAME = !prodCat && prodCatName ? qid(prodCatName) : null;

    const q = String(req.query.q ?? "").trim();
    const like = `%${q}%`;

    const where = q
      ? `WHERE ${C_NAME} LIKE @like
             ${C_CODE ? `OR IFNULL(${C_CODE},'') LIKE @like` : ""}
             OR CAST(${C_ID} AS TEXT) LIKE @like`
      : "";

    const sql = `
      SELECT ${C_ID} AS id,
             ${C_NAME} AS name
             ${C_CAT ? `, ${C_CAT} AS categoryId` : ""}
             ${C_CATNAME ? `, ${C_CATNAME} AS categoryName` : ""}
             ${C_CODE  ? `, ${C_CODE}  AS code`  : ""}
             ${C_PRICE ? `, ${C_PRICE} AS price` : ""}
             ${C_STOCK ? `, ${C_STOCK} AS stock` : ""}
      FROM ${T}
      ${where}
      ORDER BY ${C_NAME} COLLATE NOCASE
      LIMIT 500
    `;

    res.json(db.prepare(sql).all({ like }));
  } catch (e) {
    console.error("GET /admin/products error:", e);
    res.status(500).json({ error: "Error al listar productos" });
  }
});

/* =========================
   Export / Import Excel
   ========================= */

/**
 * GET /admin/products/export
 * Descarga Excel con productos
 */
router.get("/products/export", mustBeAdmin, (_req, res) => {
  try {
    const sch = prodSchemaOrThrow();
    const { products, categories } = sch.tables;
    const {
      prodId,
      prodName,
      prodPrice,
      prodStock,
      prodCode,
      prodCat,      // categoryId en productos (si existe)
      prodCatName,  // categoryName guardado en productos (si existe)
    } = sch.cols;

    // Si hay tabla categorías y prodCat, hacemos LEFT JOIN para traer el nombre real
    let sql = `
      SELECT p.${prodId} AS id,
             p.${prodName} AS name
             ${prodCode  ? `, p.${prodCode}  AS code`  : `, NULL AS code`}
             ${prodPrice ? `, p.${prodPrice} AS price` : `, NULL AS price`}
             ${prodStock ? `, p.${prodStock} AS stock` : `, NULL AS stock`}
             ${prodCat   ? `, p.${prodCat}   AS categoryId` : `, NULL AS categoryId`}
    `;

    if (prodCat && categories) {
      // Intentamos detectar columnas de la tabla de categorías
      const catInfo = db.prepare(`PRAGMA table_info('${categories}')`).all();
      const catCols = catInfo.map((c) => String(c.name));

      const catIdCol =
        catCols.find((c) => /(^id$|categoriaid$|categoryid$)/i.test(c)) || catCols[0];
      const catNameCol =
        catCols.find((c) => /(name|nombre)/i.test(c)) || catCols[1] || catCols[0];

      sql += `, c.${catNameCol} AS categoryName
              FROM ${products} p
              LEFT JOIN ${categories} c
                ON CAST(c.${catIdCol} AS TEXT) = CAST(p.${prodCat} AS TEXT)
              ORDER BY p.${prodName} COLLATE NOCASE
              LIMIT 5000`;
    } else if (prodCatName) {
      // Si no hay tabla categorías pero el producto ya tiene texto de categoría
      sql += `, p.${prodCatName} AS categoryName
              FROM ${products} p
              ORDER BY p.${prodName} COLLATE NOCASE
              LIMIT 5000`;
    } else {
      // No tenemos forma de sacar el nombre
      sql += `, NULL AS categoryName
              FROM ${products} p
              ORDER BY p.${prodName} COLLATE NOCASE
              LIMIT 5000`;
    }

    const rows = db.prepare(sql).all();

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code ?? "",
        price: r.price ?? "",
        stock: r.stock ?? "",
        categoryName: r.categoryName ?? "",  // ✅ HUMANO
        categoryId: r.categoryId ?? "",      // (opcional, lo dejo por compatibilidad)
      }))
    );
    XLSX.utils.book_append_sheet(wb, ws, "Productos");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="productos.xlsx"`);
    return res.send(buf);
  } catch (e) {
    console.error("GET /admin/products/export error:", e);
    return res.status(500).json({ error: "No se pudo exportar el Excel" });
  }
});


/**
 * POST /admin/products/import
 * mode=merge (default) | mode=sync (borra lo que no esté en el excel; requiere columna id)
 *
 * FormData: file=<xlsx>
 */
router.post("/products/import", mustBeAdmin, upload.single("file"), (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: "Archivo requerido (field: file)" });
    }

    const mode = String(req.query.mode || req.body?.mode || "merge").toLowerCase();
    const allowDelete = mode === "sync";

    const sch = prodSchemaOrThrow();
    function getOrCreateCategoryIdByName(sch, name) {
  const { categories } = sch.tables;
  if (!categories) return null;

  const nm = String(name || "").trim();
  if (!nm) return null;

  const info = db.prepare(`PRAGMA table_info('${categories}')`).all();
  const cols = info.map((c) => String(c.name));

  const idCol =
    cols.find((c) => /(^id$|categoriaid$|categoryid$)/i.test(c)) || cols[0];
  const nameCol =
    cols.find((c) => /(name|nombre)/i.test(c)) || cols[1] || cols[0];

  // Buscar categoría existente
  const found = db
    .prepare(
      `SELECT ${idCol} AS id
       FROM ${categories}
       WHERE lower(trim(${nameCol})) = lower(trim(?))
       LIMIT 1`
    )
    .get(nm);

  if (found?.id != null) return String(found.id);

  // Crear si no existe
  const ins = db
    .prepare(`INSERT INTO ${categories} (${nameCol}) VALUES (?)`)
    .run(nm);

  return String(ins.lastInsertRowid);
}

    
    const { products } = sch.tables;
    const {
      prodId,
      prodName,
      prodPrice,
      prodStock,
      prodCode,
      prodCat,
      prodCatName,
    } = sch.cols;

    if (!prodName) {
      return res.status(500).json({ error: "No se detectó columna name en productos" });
    }
    if (!prodId) {
      return res.status(500).json({ error: "No se detectó columna ID en productos" });
    }

    const T = qid(products);
    const C_ID = qid(prodId);
    const C_NAME = qid(prodName);
    const C_PRICE = prodPrice ? qid(prodPrice) : null;
    const C_STOCK = prodStock ? qid(prodStock) : null;
    const C_CODE = prodCode ? qid(prodCode) : null;
    const C_CAT = prodCat ? qid(prodCat) : null;
    const C_CATNAME = !prodCat && prodCatName ? qid(prodCatName) : null;

    // Leer Excel
    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = wb.SheetNames?.[0];
    if (!sheetName) return res.status(400).json({ error: "El Excel está vacío" });

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "El Excel está vacío" });
    }

    const pick = (r, keys) => {
      for (const k of keys) if (r[k] !== undefined) return r[k];
      return "";
    };

    let updated = 0;
    let inserted = 0;
    let deleted = 0;
    let skipped = 0;
    const errors = [];

    // Para SYNC: ids que vienen en el Excel (y también los ids nuevos insertados)
    const excelIds = new Set();

    const tx = db.transaction(() => {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];

        const idRaw = pick(r, ["id", "ID", "Id"]);
        const codeRaw = pick(r, ["code", "CODE", "Codigo", "codigo", "CÓDIGO", "Código"]);
        const nameRaw = pick(r, ["name", "NAME", "Nombre", "nombre"]);
        const priceRaw = pick(r, ["price", "PRICE", "Precio", "precio"]);
        const stockRaw = pick(r, ["stock", "STOCK", "Stock", "stock_actual"]);
        const catIdRaw = pick(r, ["categoryId", "CategoryId", "categoriaId", "catId"]);
        const catNameRaw = pick(r, ["categoryName", "CategoryName", "Categoria", "categoria"]);

        const idStr = String(idRaw).trim();
        const codeStr = String(codeRaw).trim();
        const nameStr = String(nameRaw).trim();

        if (idStr) excelIds.add(idStr);

        const hasId = idStr !== "";
        const hasCode = codeStr !== "";

        const sets = [];
        const vals = [];

        if (nameStr) {
          sets.push(`${C_NAME} = ?`);
          vals.push(nameStr);
        }

        if (C_PRICE && String(priceRaw).trim() !== "") {
          const n = Number(String(priceRaw).replace(",", "."));
          if (!Number.isFinite(n) || n < 0) {
            errors.push({ row: i + 2, error: "Precio inválido" });
          } else {
            sets.push(`${C_PRICE} = ?`);
            vals.push(n);
          }
        }

        if (C_STOCK && String(stockRaw).trim() !== "") {
          const n = Number(String(stockRaw).replace(",", "."));
          if (!Number.isFinite(n) || n < 0) {
            errors.push({ row: i + 2, error: "Stock inválido" });
          } else {
            sets.push(`${C_STOCK} = ?`);
            vals.push(Math.trunc(n));
          }
        }

        if (C_CODE && codeStr !== "") {
          sets.push(`${C_CODE} = ?`);
          vals.push(codeStr);
        }

        // ✅ categoría: preferimos categoryName (humano) y lo traducimos a id si hay tabla categorías
const catNameStr = String(catNameRaw).trim();
const catIdStr = String(catIdRaw).trim();

if (C_CAT) {
  // Si DB soporta categoryId en productos:
  let finalCatId = null;

  if (catNameStr) {
    finalCatId = getOrCreateCategoryIdByName(sch, catNameStr); // devuelve id como string
    if (!finalCatId) {
      errors.push({ row: i + 2, error: "No se pudo resolver categoryName a categoryId" });
    }
  } else if (catIdStr) {
    finalCatId = catIdStr;
  }

  if (finalCatId !== null && String(finalCatId).trim() !== "") {
    sets.push(`${C_CAT} = ?`);
    vals.push(String(finalCatId).trim());
  }
} else if (C_CATNAME) {
  // Si productos guarda el nombre directamente:
  if (catNameStr) {
    sets.push(`${C_CATNAME} = ?`);
    vals.push(catNameStr);
  }
}


        if (sets.length === 0) {
          skipped++;
          continue;
        }

        const setSql = sets.join(", ");

        // 1) UPDATE por id (preferido)
        if (hasId) {
          const info = db
            .prepare(
              `UPDATE ${T}
               SET ${setSql}
               WHERE CAST(${C_ID} AS TEXT) = CAST(? AS TEXT)`
            )
            .run(...vals, idStr);

          if (info.changes) {
            updated += info.changes;
            continue;
          }
        } else if (C_CODE && hasCode) {
          // 2) UPDATE por code si no hay id
          const info = db
            .prepare(
              `UPDATE ${T}
               SET ${setSql}
               WHERE CAST(${C_CODE} AS TEXT) = CAST(? AS TEXT)`
            )
            .run(...vals, codeStr);

          if (info.changes) {
            updated += info.changes;
            continue;
          }
        } else {
          skipped++;
          continue;
        }

        // 3) INSERT si no actualizó
        if (!nameStr) {
          skipped++;
          errors.push({ row: i + 2, error: "No existe y falta name para crear" });
          continue;
        }

        const cols = [C_NAME];
        const ivals = [nameStr];
        // =======================
// CATEGORÍA POR NOMBRE
// =======================
const catNameStr2 = String(catNameRaw).trim();
const catIdStr2 = String(catIdRaw).trim();

if (C_CAT) {
  let finalCatId = null;

  // Preferimos categoryName (humano)
  if (catNameStr2) {
    finalCatId = getOrCreateCategoryIdByName(sch, catNameStr2);
  } 
  // Fallback a categoryId si viene
  else if (catIdStr2) {
    finalCatId = catIdStr2;
  }

  if (finalCatId !== null && String(finalCatId).trim() !== "") {
    cols.push(C_CAT);
    ivals.push(String(finalCatId).trim());
  }
} 
// Si la tabla productos guarda nombre directo
else if (C_CATNAME && catNameStr2) {
  cols.push(C_CATNAME);
  ivals.push(catNameStr2);
}

        if (C_CODE && codeStr !== "") {
          cols.push(C_CODE);
          ivals.push(codeStr);
        }

        if (C_PRICE && String(priceRaw).trim() !== "") {
          const n = Number(String(priceRaw).replace(",", "."));
          if (Number.isFinite(n) && n >= 0) {
            cols.push(C_PRICE);
            ivals.push(n);
          }
        }

        if (C_STOCK && String(stockRaw).trim() !== "") {
          const n = Number(String(stockRaw).replace(",", "."));
          if (Number.isFinite(n) && n >= 0) {
            cols.push(C_STOCK);
            ivals.push(Math.trunc(n));
          }
        }

        const placeholders = cols.map(() => "?").join(", ");
        const ins = db
          .prepare(`INSERT INTO ${T} (${cols.join(", ")}) VALUES (${placeholders})`)
          .run(...ivals);

        if (ins.changes) {
          inserted += ins.changes;

          // ✅ CLAVE: si estamos en SYNC, el nuevo id insertado debe contarse como “presente en el Excel”
          // para que el paso de DELETE no lo borre.
          if (allowDelete) {
            excelIds.add(String(ins.lastInsertRowid));
          }
        } else {
          skipped++;
        }
      }

      // 4) DELETE en modo sync (solo si excel tiene ids)
      if (allowDelete) {
        if (excelIds.size === 0) {
          errors.push({
            row: 1,
            error: "SYNC requiere columna id en el Excel (para borrar con seguridad)",
          });
        } else {
          const all = db.prepare(`SELECT ${C_ID} AS id FROM ${T}`).all();
          const del = db.prepare(
            `DELETE FROM ${T}
             WHERE CAST(${C_ID} AS TEXT) = CAST(? AS TEXT)`
          );

          for (const r of all) {
            const id = String(r.id);
            if (!excelIds.has(id)) {
              const info = del.run(id);
              deleted += info.changes || 0;
            }
          }
        }
      }
    });

    tx();

    return res.json({
      ok: true,
      mode,
      totalRows: rows.length,
      updated,
      inserted,
      deleted,
      skipped,
      errors: errors.slice(0, 50),
    });
  } catch (e) {
    console.error("POST /admin/products/import error:", e);
    return res.status(500).json({ error: e?.message || "No se pudo importar el Excel" });
  }
});


/* =========================
   CRUD Productos
   ========================= */

router.get("/products/:id", mustBeAdmin, (req, res) => {
  const id = req.params.id;
  try {
    const row = adminGetProductById(id);
    if (!row) return res.status(404).json({ error: "Producto no encontrado" });
    res.json(row);
  } catch {
    res.status(500).json({ error: "Error al obtener el producto" });
  }
});

router.post("/products", mustBeAdmin, (req, res) => {
  try {
    const sch = prodSchemaOrThrow();
    const { products } = sch.tables;
    const { prodName, prodPrice, prodStock, prodCode, prodCat, prodCatName } =
      sch.cols;

    const T = qid(products);
    const C_NAME = qid(prodName);
    const C_PRICE = prodPrice ? qid(prodPrice) : null;
    const C_STOCK = prodStock ? qid(prodStock) : null;
    const C_CODE = prodCode ? qid(prodCode) : null;
    const C_CAT = prodCat ? qid(prodCat) : null;
    const C_CATNAME = !prodCat && prodCatName ? qid(prodCatName) : null;

    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "name es requerido" });

    const cols = [C_NAME];
    const vals = [name];

    if (C_PRICE && req.body?.price !== undefined) {
      const v =
        req.body.price === "" || req.body.price === null
          ? null
          : Number(req.body.price);
      cols.push(C_PRICE);
      vals.push(v);
    }
    if (C_STOCK && req.body?.stock !== undefined) {
      const v =
        req.body.stock === "" || req.body.stock === null
          ? null
          : Number(req.body.stock);
      cols.push(C_STOCK);
      vals.push(v);
    }
    if (C_CODE && req.body?.code !== undefined) {
      const v =
        req.body.code === "" || req.body.code === null
          ? null
          : String(req.body.code);
      cols.push(C_CODE);
      vals.push(v);
    }

    if (C_CAT) {
      const catId =
        req.body?.catId !== undefined ? req.body.catId : req.body?.categoryId;
      if (catId !== undefined) {
        cols.push(C_CAT);
        vals.push(catId === "" || catId === null ? null : catId);
      }
    } else if (C_CATNAME && req.body?.categoryName !== undefined) {
      cols.push(C_CATNAME);
      vals.push(String(req.body.categoryName ?? "").trim() || null);
    }

    const placeholders = cols.map(() => "?").join(", ");
    const info = db
      .prepare(`INSERT INTO ${T} (${cols.join(", ")}) VALUES (${placeholders})`)
      .run(...vals);

    res.status(201).json({ ok: true, id: info.lastInsertRowid });
  } catch {
    res.status(500).json({ error: "No se pudo crear el producto" });
  }
});

router.put("/products/:id", mustBeAdmin, (req, res) => {
  try {
    const sch = prodSchemaOrThrow();
    const { products } = sch.tables;
    const {
      prodId,
      prodName,
      prodPrice,
      prodStock,
      prodCode,
      prodCat,
      prodCatName,
    } = sch.cols;

    const T = qid(products);
    const C_ID = qid(prodId);
    const C_NAME = qid(prodName);
    const C_PRICE = prodPrice ? qid(prodPrice) : null;
    const C_STOCK = prodStock ? qid(prodStock) : null;
    const C_CODE = prodCode ? qid(prodCode) : null;
    const C_CAT = prodCat ? qid(prodCat) : null;
    const C_CATNAME = !prodCat && prodCatName ? qid(prodCatName) : null;

    const id = req.params.id;

    const sets = [];
    const vals = [];

    if (req.body?.name !== undefined) {
      sets.push(`${C_NAME} = ?`);
      vals.push(String(req.body.name ?? ""));
    }

    if (C_PRICE && req.body?.price !== undefined) {
      let v = req.body.price;
      if (v === "") v = 0;
      v = v === null ? null : Number(v);
      sets.push(`${C_PRICE} = ?`);
      vals.push(v);
    }

    if (C_STOCK && req.body?.stock !== undefined) {
      let v = req.body.stock;
      if (v === "") v = 0;
      v = v === null ? null : Number(v);
      sets.push(`${C_STOCK} = ?`);
      vals.push(v);
    }

    if (C_CODE && req.body?.code !== undefined) {
      const v = req.body.code === null ? null : String(req.body.code ?? "");
      sets.push(`${C_CODE} = ?`);
      vals.push(v);
    }

    if (C_CAT && (req.body?.catId !== undefined || req.body?.categoryId !== undefined)) {
      const v = req.body.catId !== undefined ? req.body.catId : req.body.categoryId;
      sets.push(`${C_CAT} = ?`);
      vals.push(v === "" || v === null ? null : v);
    } else if (!C_CAT && C_CATNAME && req.body?.categoryName !== undefined) {
      sets.push(`${C_CATNAME} = ?`);
      vals.push(String(req.body.categoryName ?? "").trim() || null);
    }

    if (!sets.length) return res.status(400).json({ error: "Nada para actualizar" });

    const info = db
      .prepare(
        `UPDATE ${T} SET ${sets.join(", ")} WHERE CAST(${C_ID} AS TEXT) = CAST(? AS TEXT)`
      )
      .run(...vals, id);

    if (!info.changes) return res.status(404).json({ error: "Producto no encontrado" });

    const updated = db
      .prepare(
        `
        SELECT ${C_ID} AS id,
               ${C_NAME} AS name
               ${C_CODE ? `, ${C_CODE} AS code` : ""}
               ${C_PRICE ? `, ${C_PRICE} AS price` : ""}
               ${C_STOCK ? `, ${C_STOCK} AS stock` : ""}
        FROM ${T}
        WHERE CAST(${C_ID} AS TEXT) = CAST(? AS TEXT)
        LIMIT 1
      `
      )
      .get(id);

    res.json({ ok: true, product: updated });
  } catch (e) {
    res.status(500).json({ error: "No se pudo actualizar" });
  }
});

router.delete("/products/:id", mustBeAdmin, (req, res) => {
  try {
    const sch = prodSchemaOrThrow();
    const { products } = sch.tables;
    const { prodId } = sch.cols;

    const T = qid(products);
    const C_ID = qid(prodId);

    const id = req.params.id;

    const info = db
      .prepare(`DELETE FROM ${T} WHERE CAST(${C_ID} AS TEXT) = CAST(? AS TEXT)`)
      .run(id);

    if (!info.changes) return res.status(404).json({ error: "Producto no encontrado" });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "No se pudo eliminar" });
  }
});

router.patch("/products/:id/stock", mustBeAdmin, (req, res) => {
  try {
    const sch = prodSchemaOrThrow();
    const { products } = sch.tables;
    const { prodId, prodStock } = sch.cols;

    if (!prodStock)
      return res
        .status(400)
        .json({ error: "La tabla de productos no tiene columna de stock" });

    const T = qid(products);
    const C_ID = qid(prodId);
    const C_STOCK = qid(prodStock);

    const id = req.params.id;
    const delta = Number(req.body?.delta ?? NaN);
    if (!Number.isFinite(delta))
      return res.status(400).json({ error: "delta inválido" });

    const r = db
      .prepare(
        `UPDATE ${T} SET ${C_STOCK} = COALESCE(${C_STOCK},0) + ? WHERE CAST(${C_ID} AS TEXT) = CAST(? AS TEXT)`
      )
      .run(delta, id);

    if (!r.changes) return res.status(404).json({ error: "Producto no encontrado" });

    const row = db
      .prepare(
        `SELECT ${C_ID} AS id, ${C_STOCK} AS stock FROM ${T} WHERE CAST(${C_ID} AS TEXT) = CAST(? AS TEXT) LIMIT 1`
      )
      .get(id);

    res.json({ ok: true, product: row });
  } catch {
    res.status(500).json({ error: "No se pudo actualizar el stock" });
  }
});

/* =========================
   IncomingStock (ingresos futuros)
   ========================= */
function tableCols(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
}

function pickCol(cols, candidates) {
  const set = new Set(cols.map(c => String(c).toLowerCase()));
  for (const cand of candidates) {
    if (set.has(String(cand).toLowerCase())) return cand;
  }
  return null;
}

// Helpers reutilizables
function listIncomingForProduct(productId) {
  return db
    .prepare(
      `
    SELECT id, product_id, qty, eta
    FROM IncomingStock
    WHERE CAST(product_id AS TEXT) = CAST(? AS TEXT)
    ORDER BY datetime(eta)
  `
    )
    .all(productId);
}

function createIncomingForProduct(productId, qty, eta) {
  const info = db
    .prepare(
      `
    INSERT INTO IncomingStock (product_id, qty, eta)
    VALUES (?, ?, ?)
  `
    )
    .run(productId, Math.round(qty), eta);

  return db
    .prepare(
      `
    SELECT id, product_id, qty, eta
    FROM IncomingStock
    WHERE id = ?
  `
    )
    .get(info.lastInsertRowid);
}

function deleteIncomingById(id) {
  const info = db.prepare(`DELETE FROM IncomingStock WHERE id = ?`).run(id);
  return info.changes > 0;
}

// Suma al stock del producto y borra el registro de IncomingStock
function confirmIncomingById(id) {
  const row = db
    .prepare(
      `
    SELECT id, product_id, qty, eta
    FROM IncomingStock
    WHERE id = ?
  `
    )
    .get(id);
  if (!row) return null;

  const sch = prodSchemaOrThrow();
  const { products } = sch.tables;
  const { prodId, prodStock } = sch.cols;
  if (!prodStock) throw new Error("La tabla de productos no tiene columna de stock");

  const T = qid(products);
  const C_ID = qid(prodId);
  const C_STOCK = qid(prodStock);

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE ${T}
       SET ${C_STOCK} = COALESCE(${C_STOCK},0) + ?
       WHERE CAST(${C_ID} AS TEXT) = CAST(? AS TEXT)`
    ).run(row.qty, row.product_id);

    db.prepare(`DELETE FROM IncomingStock WHERE id = ?`).run(id);
  });

  tx();

  const updated = db
    .prepare(
      `
    SELECT ${C_ID} AS id, ${C_STOCK} AS stock
    FROM ${T}
    WHERE CAST(${C_ID} AS TEXT) = CAST(? AS TEXT)
    LIMIT 1
  `
    )
    .get(row.product_id);

  return { incoming: row, product: updated };
}

router.get("/products/:id/incoming", mustBeAdmin, (req, res) => {
  try {
    const pid = String(req.params.id || "").trim();
    if (!pid) return res.status(400).json({ error: "id de producto requerido" });

    const rows = listIncomingForProduct(pid);
    res.json(rows);
  } catch (e) {
    console.error("GET /admin/products/:id/incoming error:", e);
    res.status(500).json({ error: "No se pudieron leer los ingresos futuros" });
  }
});

router.post("/products/:id/incoming", mustBeAdmin, (req, res) => {
  try {
    const pid = String(req.params.id || "").trim();
    if (!pid) return res.status(400).json({ error: "id de producto requerido" });

    const rawQty = req.body?.qty ?? req.body?.cantidad;
    const qty = Number(rawQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: "Cantidad inválida" });
    }

    let eta = String(req.body?.eta || "").trim();
    if (!eta) return res.status(400).json({ error: "Fecha (eta) requerida" });

    if (/^\d{4}-\d{2}-\d{2}$/.test(eta)) {
      eta = eta + " 00:00:00";
    }

    const row = createIncomingForProduct(pid, qty, eta);
    res.status(201).json(row);
  } catch (e) {
    console.error("POST /admin/products/:id/incoming error:", e);
    res.status(500).json({ error: "No se pudo crear el ingreso futuro" });
  }
});
router.get("/products/:id/roles", mustBeAdmin, (req, res) => {
  try {
    const id = String(req.params.id);

    const rows = db.prepare(`
      SELECT role
      FROM ProductRoleVisibility
      WHERE CAST(product_id AS TEXT) = CAST(? AS TEXT)
    `).all(id);

    res.json(rows.map(r => r.role));
  } catch (e) {
    console.error("GET /admin/products/:id/roles", e);
    res.status(500).json({ error: "No se pudieron cargar los roles" });
  }
});
router.put("/products/:id/roles", mustBeAdmin, (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "id de producto requerido" });

    // roles visibles para el producto (NO confundir con roles de usuario)
    const rolesRaw = req.body?.roles ?? req.body?.visibleRoles ?? [];
    const roles = Array.isArray(rolesRaw)
      ? rolesRaw.map((r) => String(r).toLowerCase().trim()).filter(Boolean)
      : [];

    // Debe matchear el CHECK de ProductRoleVisibility en db.js
    const allowed = new Set(["administrativo", "supervisor", "admin"]);
    const clean = roles.filter((r) => allowed.has(r));

    if (!clean.length) {
      return res.status(400).json({
        error: "roles requerido (array) con valores: administrativo | supervisor | admin",
      });
    }

    const tx = db.transaction(() => {
      db.prepare(`
        DELETE FROM ProductRoleVisibility
        WHERE CAST(product_id AS TEXT) = CAST(? AS TEXT)
      `).run(id);

      const ins = db.prepare(`
        INSERT INTO ProductRoleVisibility (product_id, role)
        VALUES (?, ?)
      `);

      for (const role of clean) {
        ins.run(id, role);
      }
    });

    tx();

    res.json({ ok: true });
  } catch (e) {
    console.error("PUT /admin/products/:id/roles", e);
    res.status(500).json({ error: "No se pudieron actualizar los roles" });
  }
});



router.delete("/incoming/:incomingId", mustBeAdmin, (req, res) => {
  try {
    const id = Number(req.params.incomingId);
    if (!id) return res.status(400).json({ error: "id inválido" });

    const ok = deleteIncomingById(id);
    if (!ok) return res.status(404).json({ error: "Ingreso no encontrado" });

    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /admin/incoming/:incomingId error:", e);
    res.status(500).json({ error: "No se pudo borrar el ingreso" });
  }
});

router.post("/incoming/:incomingId/confirm", mustBeAdmin, (req, res) => {
  try {
    const id = Number(req.params.incomingId);
    if (!id) return res.status(400).json({ error: "id inválido" });

    const result = confirmIncomingById(id);
    if (!result) return res.status(404).json({ error: "Ingreso no encontrado" });

    res.json({ ok: true, incoming: result.incoming, product: result.product });
  } catch (e) {
    console.error("POST /admin/incoming/:incomingId/confirm error:", e);
    res.status(500).json({ error: "No se pudo confirmar el ingreso" });
  }
});

/**
 * Alias compatibles con el front:
 * - GET  /admin/incoming-stock?productId=123
 * - GET  /admin/incoming-stock/123
 * - POST /admin/incoming-stock   body: { productId, qty, eta }
 */
router.get("/incoming-stock", mustBeAdmin, (req, res) => {
  try {
    const pid = String(req.query.productId || "").trim();
    if (!pid) return res.status(400).json({ error: "productId requerido" });
    const rows = listIncomingForProduct(pid);
    res.json(rows);
  } catch (e) {
    console.error("GET /admin/incoming-stock error:", e);
    res.status(500).json({ error: "No se pudieron leer los ingresos futuros" });
  }
});

router.get("/incoming-stock/:productId", mustBeAdmin, (req, res) => {
  try {
    const pid = String(req.params.productId || "").trim();
    if (!pid) return res.status(400).json({ error: "productId requerido" });
    const rows = listIncomingForProduct(pid);
    res.json(rows);
  } catch (e) {
    console.error("GET /admin/incoming-stock/:productId error:", e);
    res.status(500).json({ error: "No se pudieron leer los ingresos futuros" });
  }
});

router.post("/incoming-stock", mustBeAdmin, (req, res) => {
  try {
    const pid = String(req.body?.productId || "").trim();
    if (!pid) return res.status(400).json({ error: "productId requerido" });

    const rawQty = req.body?.qty ?? req.body?.cantidad;
    const qty = Number(rawQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: "Cantidad inválida" });
    }

    let eta = String(req.body?.eta || "").trim();
    if (!eta) return res.status(400).json({ error: "Fecha (eta) requerida" });
    if (/^\d{4}-\d{2}-\d{2}$/.test(eta)) {
      eta = eta + " 00:00:00";
    }

    const row = createIncomingForProduct(pid, qty, eta);
    res.status(201).json(row);
  } catch (e) {
    console.error("POST /admin/incoming-stock error:", e);
    res.status(500).json({ error: "No se pudo crear el ingreso futuro" });
  }
});

/* =========================
   Pedidos (admin)
   ========================= */

router.get("/orders", mustBeAdmin, (_req, res) => {
  try {
    const rows = db
      .prepare(
        `
      SELECT
        PedidoID AS id,
        EmpleadoID AS empleadoId,
        Rol AS rol,
        Total AS total,
        Fecha AS fecha,
        COALESCE(Remito, RemitoNumero, Remito_Numero, Numero_Remito, NroRemito) AS remito
      FROM Pedidos
      ORDER BY PedidoID DESC
      LIMIT 200
    `
      )
      .all();

    const enriched = rows.map((row) => ({
      ...row,
      empleadoNombre: row.empleadoId ? getEmployeeDisplayName(row.empleadoId) : "",
      remitoDisplay: row.remito ? String(row.remito) : "-",
    }));

    res.json(enriched);
  } catch {
    res.status(500).json({ error: "Error al listar pedidos" });
  }
});

router.delete("/orders/:id", mustBeAdmin, (req, res) => {
  try {
    const r = db
      .prepare(`DELETE FROM Pedidos WHERE PedidoID = ?`)
      .run(Number(req.params.id));
    if (!r.changes) return res.status(404).json({ error: "Pedido no encontrado" });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error al eliminar pedido" });
  }
});

router.put("/orders/:id/price", mustBeAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const newPrice = Number(req.body?.newPrice ?? NaN);
    if (!Number.isFinite(newPrice))
      return res.status(400).json({ error: "newPrice inválido" });
    const r = db
      .prepare(`UPDATE Pedidos SET Total = ? WHERE PedidoID = ?`)
      .run(newPrice, id);
    if (!r.changes) return res.status(404).json({ error: "Pedido no encontrado" });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error al actualizar total" });
  }
});

/* =========================
   Supervisores y servicios
   ========================= */

const EMP_ID = "EmpleadosID";
const EMP_NAME_EXPR = `
  TRIM(COALESCE(e.Nombre,'') || ' ' || COALESCE(e.Apellido,'')) ||
  CASE WHEN IFNULL(TRIM(e.username),'') <> '' THEN ' ('||e.username||')' ELSE '' END
`;
const SRV_ID = "ServiciosID";
const SRV_NAME = "ServicioNombre";

router.get("/services", mustBeAdmin, (req, res) => {
  try {
    ensureSupervisorPivotExclusive();
    const q = String(req.query.q ?? "").trim();
    const limit = Math.min(
      Math.max(parseInt(req.query.limit ?? "25", 10) || 25, 1),
      100
    );
    if (!q) return res.json([]);
    const like = `%${q}%`;

    const rows = db
      .prepare(
        `
      SELECT 
        s.${SRV_ID} AS id, 
        s.${SRV_NAME} AS name,
        EXISTS (
          SELECT 1 FROM supervisor_services a
          WHERE CAST(a.ServicioID AS TEXT) = CAST(s.${SRV_ID} AS TEXT)
        ) AS is_assigned,
        (
          SELECT a.EmpleadoID
          FROM supervisor_services a
          WHERE CAST(a.ServicioID AS TEXT) = CAST(s.${SRV_ID} AS TEXT)
          LIMIT 1
        ) AS assigned_to_id,
        (
          SELECT ${EMP_NAME_EXPR}
          FROM supervisor_services a
          JOIN Empleados e ON e.${EMP_ID} = a.EmpleadoID
          WHERE CAST(a.ServicioID AS TEXT) = CAST(s.${SRV_ID} AS TEXT)
          LIMIT 1
        ) AS assigned_to
      FROM Servicios s
      WHERE (s.${SRV_NAME} LIKE @like OR CAST(s.${SRV_ID} AS TEXT) LIKE @like)
      ORDER BY s.${SRV_NAME} COLLATE NOCASE
      LIMIT ${limit}
    `
      )
      .all({ like });

    const normalized = rows.map((r) => ({
      ...r,
      is_assigned: Number(r.is_assigned) === 1 ? 1 : 0,
    }));

    res.json(normalized);
  } catch (e) {
    console.error("GET /admin/services error:", e);
    res.status(500).json({ error: "Error al listar servicios" });
  }
});

router.get("/services-all", mustBeAdmin, (_req, res) => {
  try {
    const rows = db
      .prepare(
        `
        SELECT 
          s.${SRV_ID} AS id,
          s.${SRV_NAME} AS name
        FROM Servicios s
        ORDER BY s.${SRV_NAME} COLLATE NOCASE
      `
      )
      .all();

    return res.json(Array.isArray(rows) ? rows : []);
  } catch (e) {
    console.error("GET /admin/services-all error:", e);
    return res.status(500).json({ error: "Error al listar servicios" });
  }
});

router.get("/services/export", mustBeAdmin, (_req, res) => {
  try {
    const rows = db
      .prepare(
        `
        SELECT
          ${SRV_ID} AS id,
          ${SRV_NAME} AS name
        FROM Servicios
        ORDER BY ${SRV_NAME} COLLATE NOCASE
      `
      )
      .all();

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(
      rows.map((r) => ({
        id: r.id,
        name: r.name ?? "",
      }))
    );
    XLSX.utils.book_append_sheet(wb, ws, "Servicios");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="servicios.xlsx"`);
    return res.send(buf);
  } catch (e) {
    console.error("GET /admin/services/export error:", e);
    return res.status(500).json({ error: "No se pudo exportar el Excel de servicios" });
  }
});

/**
 * POST /admin/services/import
 *
 * Importa el maestro de Servicios en modo FULL:
 * - Requiere columna "id" (o "ServiciosID") en el Excel.
 * - Hace UPSERT por id (update si existe, insert si no).
 * - Borra de la tabla Servicios todo lo que NO esté en el Excel.
 * - Limpia también:
 *    - supervisor_services
 *    - service_products (detectando la columna de servicio dinámicamente)
 *
 * FormData: file=<xlsx>
 */
router.post("/services/import", mustBeAdmin, upload.single("file"), (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: "Archivo requerido (field: file)" });
    }

    // FULL replace, ignoramos mode=...
    const allowDelete = true;

    // --- Leer Excel ---
    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = wb.SheetNames?.[0];
    if (!sheetName) return res.status(400).json({ error: "El Excel está vacío" });

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "El Excel está vacío" });
    }

    const pick = (r, keys) => {
      for (const k of keys) if (r[k] !== undefined) return r[k];
      return "";
    };

    // TABLA/COLUMNAS de servicios
    const T = "Servicios";
    const SRV_ID_COL = "ServiciosID";
    const SRV_NAME_COL = "ServicioNombre";

    let updated = 0;
    let inserted = 0;
    let deleted = 0;
    let skipped = 0;
    const errors = [];

    // ids que vienen en el Excel (para saber qué NO borrar)
    const excelIds = new Set();

    const tx = db.transaction(() => {
      // 1) UPSERT por id
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];

        const idRaw = pick(r, ["id", "ID", "Id", SRV_ID_COL]);
        const nameRaw = pick(r, [
          "name",
          "NAME",
          "Nombre",
          "nombre",
          SRV_NAME_COL,
          "Servicio",
          "servicio",
        ]);

        const idStr = String(idRaw).trim();
        const nameStr = String(nameRaw).trim();

        if (!idStr) {
          skipped++;
          errors.push({ row: i + 2, error: "Falta id" });
          continue;
        }
        excelIds.add(idStr);

        if (!nameStr) {
          skipped++;
          errors.push({ row: i + 2, error: "Falta name" });
          continue;
        }

        // UPDATE
        const u = db
          .prepare(
            `
            UPDATE ${T}
            SET ${SRV_NAME_COL} = ?
            WHERE CAST(${SRV_ID_COL} AS TEXT) = CAST(? AS TEXT)
          `
          )
          .run(nameStr, idStr);

        if (u.changes) {
          updated += u.changes;
          continue;
        }

        // INSERT
        const ins = db
          .prepare(
            `
            INSERT INTO ${T} (${SRV_ID_COL}, ${SRV_NAME_COL})
            VALUES (?, ?)
          `
          )
          .run(idStr, nameStr);

        if (ins.changes) inserted += ins.changes;
        else skipped++;
      }

      // 2) DELETE de servicios que no estén en el Excel
      if (allowDelete) {
        if (excelIds.size === 0) {
          errors.push({
            row: 1,
            error: "El Excel debe tener columna id",
          });
        } else {
          const all = db.prepare(`SELECT ${SRV_ID_COL} AS id FROM ${T}`).all();

          // Aseguramos pivots
          ensureSupervisorPivotExclusive();
          const { srv: SP_SRV_COL } = detectSPCols(); // service_products.* columna servicio

          // Preparamos deletes sólo si las tablas existen
          const hasServiceBudgets = !!db
            .prepare(
              `SELECT name FROM sqlite_master WHERE type='table' AND name='service_budgets' LIMIT 1`
            )
            .get();

          const hasServiceEmails = !!db
            .prepare(
              `SELECT name FROM sqlite_master WHERE type='table' AND name='service_emails' LIMIT 1`
            )
            .get();

          const delAssign = db.prepare(
            `DELETE FROM supervisor_services WHERE CAST(ServicioID AS TEXT) = CAST(? AS TEXT)`
          );
          const delSP = db.prepare(
            `DELETE FROM service_products WHERE CAST(${SP_SRV_COL} AS TEXT) = CAST(? AS TEXT)`
          );
          const delSrv = db.prepare(
            `DELETE FROM ${T} WHERE CAST(${SRV_ID_COL} AS TEXT) = CAST(? AS TEXT)`
          );

          const delBud = hasServiceBudgets
            ? db.prepare(
                `DELETE FROM service_budgets WHERE CAST(service_id AS TEXT) = CAST(? AS TEXT)`
              )
            : null;

          const delEmails = hasServiceEmails
            ? db.prepare(
                `DELETE FROM service_emails WHERE CAST(service_id AS TEXT) = CAST(? AS TEXT)`
              )
            : null;

          for (const r of all) {
            const id = String(r.id);
            if (!excelIds.has(id)) {
              // limpiamos pivots y tablas opcionales
              delAssign.run(id);
              delSP.run(id);
              if (delBud) delBud.run(id);
              if (delEmails) delEmails.run(id);

              const info = delSrv.run(id);
              deleted += info.changes || 0;
            }
          }
        }
      }
    });

    tx();

    return res.json({
      ok: true,
      mode: "full",
      totalRows: rows.length,
      updated,
      inserted,
      deleted,
      skipped,
      errors: errors.slice(0, 50),
    });
  } catch (e) {
    console.error("POST /admin/services/import error:", e);
    return res
      .status(500)
      .json({ error: e?.message || "No se pudo importar el Excel de servicios" });
  }
});


/**
 * DELETE /admin/services/:id
 * Elimina un servicio + limpia pivots
 */
router.delete("/services/:id", mustBeAdmin, (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "id requerido" });

    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM supervisor_services WHERE CAST(ServicioID AS TEXT) = CAST(? AS TEXT)`).run(id);
      db.prepare(`DELETE FROM service_products WHERE CAST(ServicioID AS TEXT) = CAST(? AS TEXT)`).run(id);

      const r = db
        .prepare(`DELETE FROM Servicios WHERE CAST(${SRV_ID} AS TEXT) = CAST(? AS TEXT)`)
        .run(id);

      return r.changes || 0;
    });

    const changes = tx();
    if (!changes) return res.status(404).json({ error: "Servicio no encontrado" });

    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /admin/services/:id error:", e);
    return res.status(500).json({ error: "No se pudo eliminar el servicio" });
  }
});

router.post("/services-create", mustBeAdmin, (req, res) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "El nombre es obligatorio" });

    const exists = db
      .prepare(
        `
        SELECT 1
        FROM Servicios
        WHERE lower(trim(${SRV_NAME})) = lower(trim(?))
        LIMIT 1
      `
      )
      .get(name);

    if (exists) {
      return res.status(409).json({ error: "Ya existe un servicio con ese nombre" });
    }

    const info = db.prepare(`INSERT INTO Servicios (${SRV_NAME}) VALUES (?)`).run(name);
    const id = Number(info.lastInsertRowid);

    return res.status(201).json({ ok: true, service: { id, name } });
  } catch (e) {
    console.error("POST /admin/services-create error:", e);
    return res.status(500).json({ error: "No se pudo crear el servicio" });
  }
});

router.get("/supervisors", mustBeAdmin, (_req, res) => {
  try {
    const rows = db
      .prepare(
        `
      SELECT e.${EMP_ID} AS id, ${EMP_NAME_EXPR} AS username
      FROM Empleados e
      WHERE EXISTS (
        SELECT 1
        FROM Roles_Empleados re
        JOIN Roles r ON r.RolID = re.RolID
        WHERE re.EmpleadoID = e.${EMP_ID} AND lower(r.Nombre) = 'supervisor'
      )
      ORDER BY username COLLATE NOCASE
    `
      )
      .all();
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Error al listar supervisores" });
  }
});

router.get("/assignments", mustBeAdmin, (req, res) => {
  try {
    ensureSupervisorPivotExclusive();
    const EmpleadoID = req.query.EmpleadoID ? Number(req.query.EmpleadoID) : null;
    const base = `
      SELECT a.rowid AS id, a.EmpleadoID, a.ServicioID,
             (${EMP_NAME_EXPR}) AS supervisor_username,
             s.${SRV_NAME} AS service_name
      FROM supervisor_services a
      LEFT JOIN Empleados e ON e.${EMP_ID} = a.EmpleadoID
      LEFT JOIN Servicios s ON s.${SRV_ID} = a.ServicioID
    `;
    const rows = EmpleadoID
      ? db
          .prepare(base + ` WHERE a.EmpleadoID = ? ORDER BY s.${SRV_NAME} COLLATE NOCASE`)
          .all(EmpleadoID)
      : db
          .prepare(
            base +
              ` ORDER BY supervisor_username COLLATE NOCASE, s.${SRV_NAME} COLLATE NOCASE`
          )
          .all();
    res.json(rows);
  } catch (e) {
    console.error("GET /admin/assignments error:", e);
    res.status(500).json({ error: "Error al listar asignaciones" });
  }
});

router.post("/assignments", mustBeAdmin, (req, res) => {
  try {
    const EmpleadoID = Number(req.body?.EmpleadoID);
    const ServicioID = Number(req.body?.ServicioID);
    if (!Number.isFinite(EmpleadoID) || !Number.isFinite(ServicioID)) {
      return res.status(400).json({ error: "EmpleadoID y ServicioID son requeridos" });
    }

    assignServiceToSupervisorExclusive(EmpleadoID, ServicioID);

    const assigned = db
      .prepare(
        `
      SELECT a.rowid AS id, a.EmpleadoID, a.ServicioID,
             (${EMP_NAME_EXPR}) AS supervisor_username,
             s.${SRV_NAME}      AS service_name
      FROM supervisor_services a
      LEFT JOIN Empleados e ON e.${EMP_ID} = a.EmpleadoID
      LEFT JOIN Servicios s ON s.${SRV_ID} = a.ServicioID
      WHERE CAST(a.ServicioID AS TEXT) = CAST(? AS TEXT)
      LIMIT 1
    `
      )
      .get(ServicioID);

    return res.status(201).json({
      ok: true,
      assignment: assigned || { EmpleadoID, ServicioID },
    });
  } catch (e) {
    if (e?.status === 409 || e?.code === "SERVICE_TAKEN") {
      return res.status(409).json({ error: e.message });
    }
    const isUnique = /UNIQUE constraint failed: supervisor_services\.ServicioID/i.test(
      String(e?.message || "")
    );
    if (isUnique) {
      return res.status(409).json({ error: "El servicio ya está asignado a otro supervisor" });
    }
    console.error("POST /admin/assignments error:", e);
    res.status(500).json({ error: "Error al crear asignación" });
  }
});

router.post("/assignments/reassign", mustBeAdmin, (req, res) => {
  try {
    const EmpleadoID = Number(req.body?.EmpleadoID);
    const ServicioID = Number(req.body?.ServicioID);
    if (!Number.isFinite(EmpleadoID) || !Number.isFinite(ServicioID)) {
      return res.status(400).json({ error: "EmpleadoID y ServicioID son requeridos" });
    }
    reassignServiceToSupervisor(EmpleadoID, ServicioID);

    const assigned = db
      .prepare(
        `
      SELECT a.rowid AS id, a.EmpleadoID, a.ServicioID,
             (${EMP_NAME_EXPR}) AS supervisor_username,
             s.${SRV_NAME}      AS service_name
      FROM supervisor_services a
      LEFT JOIN Empleados e ON e.${EMP_ID} = a.EmpleadoID
      LEFT JOIN Servicios s ON s.${SRV_ID} = a.ServicioID
      WHERE CAST(a.ServicioID AS TEXT) = CAST(? AS TEXT)
      LIMIT 1
    `
      )
      .get(ServicioID);

    res.json({
      ok: true,
      assignment: assigned || { EmpleadoID, ServicioID },
    });
  } catch (e) {
    console.error("POST /admin/assignments/reassign error:", e);
    res.status(500).json({ error: e?.message || "No se pudo reasignar" });
  }
});

router.delete("/assignments/:id", mustBeAdmin, (req, res) => {
  try {
    const ok = unassignService({ id: Number(req.params.id) });
    if (!ok) return res.status(404).json({ error: "Asignación no encontrada" });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error al eliminar asignación" });
  }
});

/* =========================
   Presupuestos por servicio
   ========================= */

router.get("/service-budgets", mustBeAdmin, (_req, res) => {
  try {
    res.json(listServiceBudgets());
  } catch (e) {
    res.status(500).json({ error: "Error al listar presupuestos" });
  }
});

router.put("/service-budgets/:id", mustBeAdmin, (req, res) => {
  const id = req.params.id;
  const presupuesto = Number(req.body?.presupuesto ?? req.body?.budget ?? NaN);
  const maxPct = Number(req.body?.maxPct ?? req.body?.porcentaje ?? req.body?.pct ?? NaN);

  if (!Number.isFinite(presupuesto) || presupuesto < 0)
    return res.status(400).json({ error: "Presupuesto inválido" });
  if (!Number.isFinite(maxPct) || maxPct <= 0)
    return res.status(400).json({ error: "Porcentaje máximo inválido" });

  try {
    const newVal = setBudgetForService(id, presupuesto, maxPct);
    return res.json({ servicioId: id, ...newVal });
  } catch (e) {
    console.error("[admin] PUT /service-budgets/:id", e);
    return res.status(500).json({ error: "Error interno" });
  }
});

/* =========================
   Emails por servicio
   ========================= */

router.get("/service-emails", mustBeAdmin, (_req, res) => {
  try {
    db.exec(
      `CREATE TABLE IF NOT EXISTS service_emails (service_id TEXT NOT NULL, email TEXT NOT NULL);`
    );
    const rows = db
      .prepare(
        `
      SELECT service_id AS serviceId, email
      FROM service_emails
      ORDER BY CAST(service_id AS TEXT), email
    `
      )
      .all();

    const map = new Map();
    for (const r of rows) {
      const k = String(r.serviceId);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r.email);
    }
    const out = Array.from(map.entries()).map(([serviceId, emails]) => ({
      serviceId,
      serviceName: getServiceNameById(serviceId) || serviceId,
      emails,
    }));
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ error: "Error al listar emails por servicio" });
  }
});

router.put("/service-emails/:serviceId", mustBeAdmin, (req, res) => {
  const serviceId = String(req.params.serviceId || "").trim();
  const raw = String(req.body.emails || "").trim();
  try {
    db.exec(
      `CREATE TABLE IF NOT EXISTS service_emails (service_id TEXT NOT NULL, email TEXT NOT NULL);`
    );
    const list = raw
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const del = db.prepare(
      `DELETE FROM service_emails WHERE CAST(service_id AS TEXT) = CAST(? AS TEXT)`
    );
    del.run(serviceId);

    const ins = db.prepare(`INSERT INTO service_emails (service_id, email) VALUES (?, ?)`);
    for (const e of list) ins.run(serviceId, e);

    return res.json({ ok: true, serviceId, count: list.length });
  } catch (e) {
    return res.status(500).json({ error: "Error al actualizar emails de servicio" });
  }
});

/* ======================================================
   Endpoints usados por el front para Servicio⇄Productos
   ====================================================== */

function detectSPCols() {
  ensureServiceProductsPivot();
  const cols = db
    .prepare(`PRAGMA table_info('service_products')`)
    .all()
    .map((c) => String(c.name).toLowerCase());
  if (cols.includes("servicioid") && cols.includes("productoid"))
    return { srv: "ServicioID", prod: "ProductoID" };
  if (cols.includes("servicio_id") && cols.includes("producto_id"))
    return { srv: "servicio_id", prod: "producto_id" };
  if (cols.includes("service_id") && cols.includes("product_id"))
    return { srv: "service_id", prod: "product_id" };
  return { srv: "ServicioID", prod: "ProductoID" };
}

router.get("/sp/assignments/:serviceId", mustBeAdmin, (req, res) => {
  try {
    const { srv, prod } = detectSPCols();
    const sid = String(req.params.serviceId || "").trim();
    if (!sid) return res.status(400).json({ error: "serviceId requerido" });

    const rows = db
      .prepare(
        `
      SELECT ${prod} AS pid
      FROM service_products
      WHERE CAST(${srv} AS TEXT) = CAST(? AS TEXT)
    `
      )
      .all(sid);

    res.json({
      ok: true,
      serviceId: sid,
      productIds: rows.map((r) => String(r.pid)),
    });
  } catch (e) {
    console.error("GET /admin/sp/assignments error:", e?.message || e);
    res.status(500).json({ error: "No se pudo leer asignaciones" });
  }
});

router.put("/sp/assignments/:serviceId", mustBeAdmin, (req, res) => {
  try {
    const { srv, prod } = detectSPCols();
    const sid = String(req.params.serviceId || "").trim();
    const desired = new Set(
      Array.isArray(req.body?.productIds) ? req.body.productIds.map((x) => String(x)) : []
    );
    if (!sid) return res.status(400).json({ error: "serviceId requerido" });

    const existing = new Set(
      db
        .prepare(
          `
        SELECT ${prod} AS pid
        FROM service_products
        WHERE CAST(${srv} AS TEXT) = CAST(? AS TEXT)
      `
        )
        .all(sid)
        .map((r) => String(r.pid))
    );

    const toAdd = [...desired].filter((id) => !existing.has(id));
    const toDel = [...existing].filter((id) => !desired.has(id));

    const ins = db.prepare(`INSERT INTO service_products (${srv}, ${prod}) VALUES (?, ?)`);
    const del = db.prepare(
      `
      DELETE FROM service_products
      WHERE CAST(${srv} AS TEXT) = CAST(? AS TEXT)
        AND CAST(${prod} AS TEXT) = CAST(? AS TEXT)
    `
    );

    const tx = db.transaction(() => {
      let added = 0,
        removed = 0;
      for (const pid of toAdd) added += ins.run(sid, pid).changes;
      for (const pid of toDel) removed += del.run(sid, pid).changes;
      return { added, removed };
    });

    const { added, removed } = tx();
    res.json({
      ok: true,
      serviceId: sid,
      added,
      removed,
      productIds: [...desired],
    });
  } catch (e) {
    console.error("PUT /admin/sp/assignments error:", e?.message || e);
    res.status(500).json({ error: "No se pudieron actualizar las asignaciones" });
  }
});


export default router;
