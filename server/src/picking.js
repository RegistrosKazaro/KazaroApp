// Preparación de pedidos con pistola lectora.
//
// El jefe de depósito asigna pedidos a un preparador; el preparador abre uno,
// escanea cada insumo que va separando y la cantidad se va sumando sola. Lo que
// no tiene código de barras lo carga a mano.
//
// Decisiones que explican la forma de esto:
//
// - Los preparadores NO son usuarios. Hoy todo el depósito entra con una sola
//   cuenta compartida ("Deposito"), y dar de alta cuentas y contraseñas para
//   gente que comparte una tablet es fricción pura. Son nombres en una tabla y
//   la persona elige el suyo al entrar. La trazabilidad queda mejor que hoy,
//   que es no saber nada.
//
// - No hay estado nuevo. El picking pasa dentro de "preparing", que ya existe.
//   Un pedido con preparacion_terminada_at cargado es uno que el preparador ya
//   terminó y espera que el jefe lo cierre. Si todo esto se rompe, el depósito
//   sigue trabajando como siempre.
//
// - El stock no se toca acá. Se sigue descontando al cerrar el pedido.

/** Lo que puede salir mal al escanear. La pantalla los traduce a un cartel. */
export const MOTIVOS = {
  SIN_CODIGO: "sin_codigo",       // vino vacío
  NO_EXISTE: "no_existe",         // ningún insumo tiene ese código
  NO_ESTA_EN_PEDIDO: "no_esta",   // existe, pero no se pidió en este pedido
  YA_COMPLETO: "ya_completo",     // la línea ya está en la cantidad pedida
};

export function ensureTablas(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS preparadores (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre     TEXT    NOT NULL,
        empresa_id INTEGER NOT NULL,
        activo     INTEGER NOT NULL DEFAULT 1,
        creado_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_prep_nombre
        ON preparadores(empresa_id, nombre);
    `);

    const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name.toLowerCase());

    const ped = cols("Pedidos");
    if (!ped.includes("preparador_id")) {
      db.exec(`ALTER TABLE Pedidos ADD COLUMN preparador_id INTEGER`);
    }
    if (!ped.includes("preparacion_asignada_at")) {
      db.exec(`ALTER TABLE Pedidos ADD COLUMN preparacion_asignada_at TEXT`);
    }
    if (!ped.includes("preparacion_terminada_at")) {
      db.exec(`ALTER TABLE Pedidos ADD COLUMN preparacion_terminada_at TEXT`);
    }

    const items = cols("PedidoItems");
    if (!items.includes("cantidad_preparada")) {
      db.exec(`ALTER TABLE PedidoItems ADD COLUMN cantidad_preparada INTEGER NOT NULL DEFAULT 0`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ped_preparador ON Pedidos(preparador_id);`);
    return true;
  } catch (e) {
    console.error("[picking] no se pudieron crear las tablas:", e?.message || e);
    return false;
  }
}

/* ========================= Preparadores ========================= */

export function listarPreparadores(db, empresaId, { incluirInactivos = false } = {}) {
  return db.prepare(
    `SELECT id, nombre, activo FROM preparadores
      WHERE empresa_id = ? ${incluirInactivos ? "" : "AND activo = 1"}
      ORDER BY nombre COLLATE NOCASE`
  ).all(Number(empresaId));
}

export function crearPreparador(db, { nombre, empresaId }) {
  const limpio = String(nombre ?? "").trim();
  if (!limpio) return { ok: false, error: "Poné un nombre." };

  // Si ya existía pero estaba desactivado, se reactiva en vez de chocar contra
  // el único: dar de baja y de alta a la misma persona es normal.
  const previo = db.prepare(
    `SELECT id, activo FROM preparadores WHERE empresa_id = ? AND nombre = ? COLLATE NOCASE`
  ).get(Number(empresaId), limpio);
  if (previo) {
    if (!previo.activo) db.prepare(`UPDATE preparadores SET activo = 1 WHERE id = ?`).run(previo.id);
    return { ok: true, id: previo.id, reactivado: !previo.activo };
  }

  const info = db.prepare(
    `INSERT INTO preparadores (nombre, empresa_id) VALUES (?, ?)`
  ).run(limpio, Number(empresaId));
  return { ok: true, id: Number(info.lastInsertRowid) };
}

/**
 * Baja lógica: los pedidos que esa persona preparó siguen diciendo quién fue.
 */
export function desactivarPreparador(db, { id, empresaId }) {
  const info = db.prepare(
    `UPDATE preparadores SET activo = 0 WHERE id = ? AND empresa_id = ?`
  ).run(Number(id), Number(empresaId));
  return { ok: info.changes > 0 };
}

/* ========================= Asignación ========================= */

const pedidoDe = (db, pedidoId, empresaId) => db.prepare(
  `SELECT PedidoID, Status, empresa_id, preparador_id, preparacion_terminada_at
     FROM Pedidos WHERE PedidoID = ? AND empresa_id = ? AND deleted_at IS NULL`
).get(Number(pedidoId), Number(empresaId));

/**
 * El jefe le pasa un pedido a un preparador. Lo deja en "preparing".
 * Un pedido ya asignado no se le pasa a otro sin desasignarlo antes: si no,
 * dos personas podrían estar juntando el mismo pedido sin saberlo.
 */
export function asignar(db, { pedidoId, preparadorId, empresaId, ahora }) {
  const pedido = pedidoDe(db, pedidoId, empresaId);
  if (!pedido) return { ok: false, error: "Pedido no encontrado" };
  if (String(pedido.Status) === "closed" || String(pedido.Status) === "retirado") {
    return { ok: false, error: "Ese pedido ya está cerrado." };
  }
  if (pedido.preparador_id && Number(pedido.preparador_id) !== Number(preparadorId)) {
    const otro = db.prepare(`SELECT nombre FROM preparadores WHERE id = ?`).get(pedido.preparador_id);
    return { ok: false, error: `Ese pedido ya lo está preparando ${otro?.nombre || "otra persona"}. Desasignalo primero.` };
  }

  const prep = db.prepare(
    `SELECT id, nombre FROM preparadores WHERE id = ? AND empresa_id = ? AND activo = 1`
  ).get(Number(preparadorId), Number(empresaId));
  if (!prep) return { ok: false, error: "Ese preparador no existe o está dado de baja." };

  db.prepare(
    `UPDATE Pedidos
        SET preparador_id = ?, preparacion_asignada_at = ?, preparacion_terminada_at = NULL,
            Status = 'preparing', cerrado = 0, closedat = NULL
      WHERE PedidoID = ?`
  ).run(prep.id, ahora, Number(pedidoId));

  return { ok: true, preparador: prep.nombre };
}

/** Lo que se separó queda: si se reasigna, el que sigue no arranca de cero. */
export function desasignar(db, { pedidoId, empresaId }) {
  const pedido = pedidoDe(db, pedidoId, empresaId);
  if (!pedido) return { ok: false, error: "Pedido no encontrado" };

  db.prepare(
    `UPDATE Pedidos SET preparador_id = NULL, preparacion_asignada_at = NULL,
            preparacion_terminada_at = NULL
      WHERE PedidoID = ?`
  ).run(Number(pedidoId));
  return { ok: true };
}

/**
 * Los pedidos asignados. Sin preparadorId devuelve todos los asignados, que es
 * lo que mira el jefe; con preparadorId, sólo los de esa persona.
 */
export function pedidosAsignados(db, { empresaId, preparadorId = null }) {
  return db.prepare(
    `SELECT p.PedidoID              AS id,
            p.Status                AS status,
            p.Fecha                 AS fecha,
            p.ServicioID            AS servicioId,
            p.preparador_id         AS preparadorId,
            pr.nombre               AS preparador,
            p.preparacion_asignada_at  AS asignadaAt,
            p.preparacion_terminada_at AS terminadaAt,
            COUNT(pi.PedidoItemID)                      AS lineas,
            COALESCE(SUM(pi.Cantidad), 0)               AS unidadesPedidas,
            COALESCE(SUM(pi.cantidad_preparada), 0)     AS unidadesPreparadas,
            SUM(CASE WHEN COALESCE(pi.cantidad_preparada,0) >= pi.Cantidad THEN 1 ELSE 0 END) AS lineasCompletas
       FROM Pedidos p
       JOIN preparadores pr ON pr.id = p.preparador_id
       LEFT JOIN PedidoItems pi ON pi.PedidoID = p.PedidoID
      WHERE p.empresa_id = @empresaId AND p.deleted_at IS NULL
        AND p.preparador_id IS NOT NULL
        AND (@preparadorId = 0 OR p.preparador_id = @preparadorId)
      GROUP BY p.PedidoID
      ORDER BY p.preparacion_asignada_at`
  ).all({ empresaId: Number(empresaId), preparadorId: Number(preparadorId) || 0 });
}

/* ========================= El picking ========================= */

/**
 * Las líneas del pedido tal como las ve el que prepara.
 * `codigoBarra` en null es el aviso de que ese insumo se carga a mano.
 */
export function lineasDePicking(db, pedidoId) {
  const tieneBarra = db.prepare(`PRAGMA table_info(Productos)`).all()
    .some((c) => c.name.toLowerCase() === "codigo_barra");

  return db.prepare(
    `SELECT pi.ProductoID                      AS productoId,
            pi.Nombre                          AS nombre,
            pi.Codigo                          AS codigo,
            ${tieneBarra ? "pr.codigo_barra" : "NULL"} AS codigoBarra,
            pi.Cantidad                        AS pedida,
            COALESCE(pi.cantidad_preparada, 0) AS preparada
       FROM PedidoItems pi
       LEFT JOIN Productos pr ON pr.ProductID = pi.ProductoID
      WHERE pi.PedidoID = ?
      ORDER BY pi.PedidoItemID`
  ).all(Number(pedidoId));
}

const lineaDe = (db, pedidoId, productoId) => db.prepare(
  `SELECT pi.ProductoID AS productoId, pi.Nombre AS nombre, pi.Codigo AS codigo,
          pi.Cantidad AS pedida, COALESCE(pi.cantidad_preparada, 0) AS preparada
     FROM PedidoItems pi WHERE pi.PedidoID = ? AND pi.ProductoID = ?`
).get(Number(pedidoId), Number(productoId));

/**
 * Llega un código de barras desde la pistola y suma 1 a esa línea.
 *
 * Nunca pasa de la cantidad pedida: separar de más es un error que se arregla
 * a mano, no algo que el sistema deba aceptar en silencio.
 *
 * @returns {{ ok, motivo?, error?, linea?, insumo? }}
 */
export function escanear(db, { pedidoId, codigoBarra, empresaId }) {
  const codigo = String(codigoBarra ?? "").trim();
  if (!codigo) return { ok: false, motivo: MOTIVOS.SIN_CODIGO, error: "No llegó ningún código." };

  const insumo = db.prepare(
    `SELECT ProductID AS id, ProductName AS nombre FROM Productos
      WHERE codigo_barra = ? AND empresa_id = ? LIMIT 1`
  ).get(codigo, Number(empresaId));

  if (!insumo) {
    return { ok: false, motivo: MOTIVOS.NO_EXISTE,
             error: `El código ${codigo} no es de ningún insumo. Cargalo a mano en la ficha del insumo.` };
  }

  const linea = lineaDe(db, pedidoId, insumo.id);
  if (!linea) {
    return { ok: false, motivo: MOTIVOS.NO_ESTA_EN_PEDIDO, insumo,
             error: `"${insumo.nombre}" no está en este pedido. Fijate si lo agarraste del estante de al lado.` };
  }
  if (Number(linea.preparada) >= Number(linea.pedida)) {
    return { ok: false, motivo: MOTIVOS.YA_COMPLETO, insumo, linea,
             error: `"${insumo.nombre}" ya está completo (${linea.pedida}). Si separaste de más, corregilo a mano.` };
  }

  db.prepare(
    `UPDATE PedidoItems SET cantidad_preparada = COALESCE(cantidad_preparada, 0) + 1
      WHERE PedidoID = ? AND ProductoID = ?`
  ).run(Number(pedidoId), insumo.id);

  return { ok: true, insumo, linea: lineaDe(db, pedidoId, insumo.id) };
}

/**
 * Carga a mano. Es para los bultos ("separé 12 de una") y para lo que no tiene
 * código de barras. Acepta 0 para corregir a la baja.
 */
export function cargarManual(db, { pedidoId, items = [] }) {
  const errores = [];
  const tocar = db.prepare(
    `UPDATE PedidoItems SET cantidad_preparada = ? WHERE PedidoID = ? AND ProductoID = ?`
  );

  const aplicar = db.transaction((lista) => {
    for (const it of lista) {
      const linea = lineaDe(db, pedidoId, it?.productoId);
      if (!linea) { errores.push(`El insumo ${it?.productoId} no está en el pedido.`); continue; }

      const n = Number(it?.cantidadPreparada);
      if (!Number.isFinite(n) || n < 0) { errores.push(`Cantidad inválida en "${linea.nombre}".`); continue; }
      if (n > Number(linea.pedida)) {
        errores.push(`"${linea.nombre}": se pidieron ${linea.pedida}, no se puede preparar ${n}.`);
        continue;
      }
      tocar.run(Math.trunc(n), Number(pedidoId), Number(it.productoId));
    }
  });

  aplicar(items);
  return { ok: errores.length === 0, errores };
}

/** Cuántas unidades y líneas van, para el contador de arriba de la pantalla. */
export function avance(db, pedidoId) {
  const r = db.prepare(
    `SELECT COUNT(*) AS lineas,
            COALESCE(SUM(Cantidad), 0) AS pedidas,
            COALESCE(SUM(COALESCE(cantidad_preparada,0)), 0) AS preparadas,
            SUM(CASE WHEN COALESCE(cantidad_preparada,0) >= Cantidad THEN 1 ELSE 0 END) AS completas
       FROM PedidoItems WHERE PedidoID = ?`
  ).get(Number(pedidoId));
  return {
    lineas: Number(r?.lineas || 0),
    lineasCompletas: Number(r?.completas || 0),
    unidadesPedidas: Number(r?.pedidas || 0),
    unidadesPreparadas: Number(r?.preparadas || 0),
    completo: Number(r?.lineas || 0) > 0 && Number(r?.completas || 0) === Number(r?.lineas || 0),
  };
}

/**
 * El preparador avisa que terminó. NO cierra el pedido: eso lo hace el jefe,
 * porque cerrar dispara el mail al supervisor y el descuento de stock.
 *
 * Se puede terminar un pedido incompleto (no había stock); por eso no se exige
 * que esté todo. Lo que falte sigue su camino por el circuito de pendientes.
 */
export function terminar(db, { pedidoId, empresaId, ahora }) {
  const pedido = pedidoDe(db, pedidoId, empresaId);
  if (!pedido) return { ok: false, error: "Pedido no encontrado" };
  if (!pedido.preparador_id) return { ok: false, error: "Ese pedido no está asignado a nadie." };

  db.prepare(`UPDATE Pedidos SET preparacion_terminada_at = ? WHERE PedidoID = ?`)
    .run(ahora, Number(pedidoId));
  return { ok: true, avance: avance(db, pedidoId) };
}

/** Por si el jefe lo devuelve: vuelve a quedar en manos del preparador. */
export function reabrir(db, { pedidoId, empresaId }) {
  const pedido = pedidoDe(db, pedidoId, empresaId);
  if (!pedido) return { ok: false, error: "Pedido no encontrado" };
  db.prepare(`UPDATE Pedidos SET preparacion_terminada_at = NULL WHERE PedidoID = ?`)
    .run(Number(pedidoId));
  return { ok: true };
}
