// Preparación de pedidos con pistola lectora.
//
// El jefe de depósito asigna pedidos a un preparador; el preparador abre uno,
// escanea cada insumo que va separando y la cantidad se va sumando sola. Lo que
// no tiene código de barras lo carga a mano.
//
// Decisiones que explican la forma de esto:
//
// - Cada preparador es un usuario con rol Picking. Entra con lo suyo y la app
//   ya sabe quién es: no elige nada de una lista, y nadie puede figurar como
//   otro. Ese rol da permiso SOLO para preparar: no para borrar pedidos, tocar
//   stock ni cargar devoluciones, que es lo que puede el rol Depósito.
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

/** El rol que habilita a preparar, y sólo a eso. */
export const ROL_PICKING = "Picking";

export function ensureTablas(db) {
  try {
    db.prepare(`INSERT INTO Roles (Nombre) SELECT ?
                 WHERE NOT EXISTS (SELECT 1 FROM Roles WHERE Nombre = ? COLLATE NOCASE)`)
      .run(ROL_PICKING, ROL_PICKING);

    // La tabla preparadores duró un día: los preparadores pasaron a ser
    // usuarios con rol Picking. Se borra sólo si nadie llegó a cargar nada.
    try {
      const quedo = db.prepare(`SELECT COUNT(*) n FROM preparadores`).get();
      if (quedo && Number(quedo.n) === 0) db.exec(`DROP TABLE preparadores`);
    } catch { /* no existe: mejor */ }

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

const NOMBRE_SQL = `TRIM(COALESCE(e.Nombre,'') || ' ' || COALESCE(e.Apellido,''))`;

/**
 * Los que pueden preparar: empleados activos con rol Picking.
 * Se dan de alta y de baja desde el ABM de empleados, como cualquier usuario.
 */
export function listarPreparadores(db, empresaId) {
  return db.prepare(
    `SELECT e.EmpleadosID AS id,
            NULLIF(${NOMBRE_SQL}, '') AS nombre,
            e.username AS username
       FROM Empleados e
       JOIN Roles_Empleados re ON re.EmpleadoID = e.EmpleadosID
       JOIN Roles r ON r.RolID = re.RolID
      WHERE e.empresa_id = ? AND COALESCE(e.is_active, 1) = 1
        AND r.Nombre = ? COLLATE NOCASE
      ORDER BY nombre COLLATE NOCASE`
  ).all(Number(empresaId), ROL_PICKING)
   .map((p) => ({ ...p, nombre: p.nombre || p.username }));
}

/** ¿Este usuario puede preparar? Lo usa el guardia de las rutas. */
export function esPreparador(db, { empleadoId, empresaId }) {
  return !!db.prepare(
    `SELECT 1 FROM Empleados e
       JOIN Roles_Empleados re ON re.EmpleadoID = e.EmpleadosID
       JOIN Roles r ON r.RolID = re.RolID
      WHERE e.EmpleadosID = ? AND e.empresa_id = ?
        AND COALESCE(e.is_active, 1) = 1 AND r.Nombre = ? COLLATE NOCASE`
  ).get(Number(empleadoId), Number(empresaId), ROL_PICKING);
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
    const otro = listarPreparadores(db, empresaId).find((p) => p.id === Number(pedido.preparador_id));
    return { ok: false, error: `Ese pedido ya lo está preparando ${otro?.nombre || "otra persona"}. Desasignalo primero.` };
  }

  const prep = listarPreparadores(db, empresaId).find((p) => p.id === Number(preparadorId));
  if (!prep) return { ok: false, error: "Esa persona no tiene permiso para preparar pedidos." };

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
            NULLIF(${NOMBRE_SQL}, '') AS preparador,
            e.username              AS preparadorUsuario,
            p.preparacion_asignada_at  AS asignadaAt,
            p.preparacion_terminada_at AS terminadaAt,
            COUNT(pi.PedidoItemID)                      AS lineas,
            COALESCE(SUM(pi.Cantidad), 0)               AS unidadesPedidas,
            COALESCE(SUM(pi.cantidad_preparada), 0)     AS unidadesPreparadas,
            SUM(CASE WHEN COALESCE(pi.cantidad_preparada,0) >= pi.Cantidad THEN 1 ELSE 0 END) AS lineasCompletas
       FROM Pedidos p
       JOIN Empleados e ON e.EmpleadosID = p.preparador_id
       LEFT JOIN PedidoItems pi ON pi.PedidoID = p.PedidoID
      WHERE p.empresa_id = @empresaId AND p.deleted_at IS NULL
        AND p.preparador_id IS NOT NULL
        AND (@preparadorId = 0 OR p.preparador_id = @preparadorId)
      GROUP BY p.PedidoID
      ORDER BY p.preparacion_asignada_at`
  ).all({ empresaId: Number(empresaId), preparadorId: Number(preparadorId) || 0 })
   .map((p) => ({ ...p, preparador: p.preparador || p.preparadorUsuario }));
}

/**
 * Desde cuándo tiene sentido preparar un pedido.
 *
 * Antes del 01/08/2026 los pedidos se contabilizaban al crearse, así que
 * quedaron "abiertos" para siempre aunque ya se habían entregado: son 352 en
 * producción, el más viejo de octubre de 2025, y ninguno se va a preparar
 * nunca. Mezclados con los de verdad hacían ilegible la lista de asignar.
 *
 * El corte lo puso el usuario el 16/10/2026. Entre el 01/08 y el 01/09 no
 * quedó ningún pendiente, así que no esconde nada real.
 */
export const DESDE_PARA_PREPARAR = "2026-09-01";

/**
 * Los pedidos que el jefe puede repartir: los de la solapa Pendientes que
 * todavía no tienen dueño. Con el nombre del servicio, que es como los
 * reconoce.
 */
export function pendientesParaAsignar(db, empresaId, { desde = DESDE_PARA_PREPARAR } = {}) {
  return db.prepare(
    `SELECT p.PedidoID AS id, p.Fecha AS fecha, p.ServicioID AS servicioId,
            COUNT(pi.PedidoItemID) AS lineas,
            COALESCE(SUM(pi.Cantidad), 0) AS unidades
       FROM Pedidos p
       LEFT JOIN PedidoItems pi ON pi.PedidoID = p.PedidoID
      WHERE p.empresa_id = ? AND p.deleted_at IS NULL
        AND p.preparador_id IS NULL
        AND LOWER(COALESCE(p.Status, '')) = 'open'
        AND substr(p.Fecha, 1, 10) >= ?
      GROUP BY p.PedidoID
      ORDER BY p.PedidoID DESC
      LIMIT 200`
  ).all(Number(empresaId), String(desde));
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
 * A qué insumo corresponde lo que acaba de escribir la pistola.
 *
 * Se busca por dos caminos, en este orden:
 *
 *   1. `codigo_barra`, el EAN del envase cuando el fabricante lo trae.
 *   2. `Code`, el código interno del artículo. Las etiquetas que se imprimen
 *      acá llevan ese código, así que la pistola escribe el mismo número que
 *      ya está cargado y no hay nada que dar de alta.
 *
 * El código de barras gana porque es el asignado a propósito. El código
 * interno se compara también sin los ceros de adelante ("004" = "4"), igual
 * que el resto de la integración; verificado el 16/10/2026 en producción: los
 * 405 insumos activos tienen código y ninguno choca al normalizar, así que
 * nunca hay dos candidatos.
 */
export function buscarPorEscaneo(db, codigo, empresaId) {
  const limpio = String(codigo ?? "").trim();
  if (!limpio) return null;
  const empresa = Number(empresaId);

  const porBarra = db.prepare(
    `SELECT ProductID AS id, ProductName AS nombre FROM Productos
      WHERE codigo_barra = ? AND empresa_id = ? LIMIT 1`
  ).get(limpio, empresa);
  if (porBarra) return porBarra;

  const porCodigo = db.prepare(
    `SELECT ProductID AS id, ProductName AS nombre FROM Productos
      WHERE TRIM(Code) = ? AND empresa_id = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`
  ).get(limpio, empresa);
  if (porCodigo) return porCodigo;

  // Sin los ceros de adelante, y sólo si es un número: para texto, el código
  // tiene que coincidir tal cual.
  if (!/^\d+$/.test(limpio)) return null;
  const sinCeros = limpio.replace(/^0+/, "") || "0";
  return db.prepare(
    `SELECT ProductID AS id, ProductName AS nombre FROM Productos
      WHERE empresa_id = ? AND COALESCE(is_active, 1) = 1
        AND Code GLOB '[0-9]*' AND CAST(TRIM(Code) AS INTEGER) = CAST(? AS INTEGER)
        AND TRIM(Code) <> ''
      LIMIT 1`
  ).get(empresa, sinCeros) || null;
}

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

  const insumo = buscarPorEscaneo(db, codigo, empresaId);

  if (!insumo) {
    return { ok: false, motivo: MOTIVOS.NO_EXISTE,
             error: `El código ${codigo} no es de ningún insumo. Fijate que la etiqueta sea la correcta, o cargale el código de barras al insumo desde su ficha.` };
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
