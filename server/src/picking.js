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
  CERRADO: "cerrado",             // el pedido ya se terminó o ya se cerró
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
    // Cuándo se escaneó por primera vez cada línea. El operario carga la
    // cantidad de un toque ("Completar") recién después de escanear: el
    // escaneo prueba que agarró el insumo correcto del estante.
    if (!items.includes("escaneado_at")) {
      db.exec(`ALTER TABLE PedidoItems ADD COLUMN escaneado_at TEXT`);
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

/**
 * ¿Lo que hay que preparar es el pedido entero o lo que quedó pendiente?
 *
 * Cuando el depósito despacha incompleto, el pedido se CIERRA con lo que
 * había y lo que falta sigue su camino como "pendiente" sobre ese mismo
 * pedido. Son dos cosas distintas aunque vivan en la misma fila: el pedido
 * está cerrado y el pendiente sigue abierto.
 *
 * Preparar un pendiente es preparar `cantidad_pendiente`, no `Cantidad`, y
 * NO se le toca el estado al pedido: ya se despachó.
 */
export function esPendiente(pedido) {
  return String(pedido?.pendiente_status ?? "").toLowerCase() === "open"
    && String(pedido?.Status ?? "").toLowerCase() !== "open";
}

/**
 * Lo que hay que juntar de cada línea.
 *
 * Pedido: lo pedido. Pendiente: lo que quedó pendiente. Al terminar un
 * pendiente, terminar() le resta lo preparado a cantidad_pendiente (es lo que
 * sigue faltando); para que la pantalla lo siga mostrando contra lo que había
 * que juntar, una vez terminado se le vuelve a sumar.
 */
const OBJETIVO = ({ pend, terminada }, a = "pi.") => {
  if (!pend) return `${a}Cantidad`;
  return terminada
    ? `(COALESCE(${a}cantidad_pendiente, 0) + COALESCE(${a}cantidad_preparada, 0))`
    : `COALESCE(${a}cantidad_pendiente, 0)`;
};

const modoDe = (db, pedidoId) => {
  const p = db.prepare(
    `SELECT Status, pendiente_status, preparacion_terminada_at FROM Pedidos WHERE PedidoID = ?`
  ).get(Number(pedidoId));
  return { pend: esPendiente(p), terminada: !!p?.preparacion_terminada_at };
};

const pedidoDe = (db, pedidoId, empresaId) => db.prepare(
  `SELECT PedidoID, Status, pendiente_status, empresa_id, preparador_id, preparacion_terminada_at
     FROM Pedidos WHERE PedidoID = ? AND empresa_id = ? AND deleted_at IS NULL`
).get(Number(pedidoId), Number(empresaId));

/**
 * ¿Se puede seguir preparando este pedido? Si no, el por qué, para el cartel.
 *
 * Escanear o cargar después de "Terminé" no cambia el pendiente que ya se
 * armó, así que lo que se sumara después no le llegaba a nadie. Y con el
 * pedido ya cerrado por el jefe es peor: terminar de nuevo le recalculaba el
 * pendiente a un pedido que ya salió.
 */
function bloqueoDePicking(pedido) {
  if (!pedido) return "Pedido no encontrado";
  if (pedido.preparacion_terminada_at) {
    return "Este pedido ya está terminado. Si hay que corregir algo, el jefe te lo tiene que devolver.";
  }
  const st = String(pedido.Status ?? "").toLowerCase();
  if (!esPendiente(pedido) && st !== "open" && st !== "preparing") {
    return "Este pedido ya se cerró: no se puede seguir preparando.";
  }
  return null;
}

const ahoraSql = () => new Date().toISOString().slice(0, 19).replace("T", " ");

/**
 * El jefe le pasa un pedido a un preparador. Lo deja en "preparing".
 * Un pedido ya asignado no se le pasa a otro sin desasignarlo antes: si no,
 * dos personas podrían estar juntando el mismo pedido sin saberlo.
 */
export function asignar(db, { pedidoId, preparadorId, empresaId, ahora }) {
  const pedido = pedidoDe(db, pedidoId, empresaId);
  if (!pedido) return { ok: false, error: "Pedido no encontrado" };
  // Un pedido cerrado sólo se puede tomar si lo que quedó pendiente sigue
  // abierto: eso es lo que hay que preparar cuando entra stock.
  const pend = esPendiente(pedido);
  if (!pend && (String(pedido.Status) === "closed" || String(pedido.Status) === "retirado")) {
    return { ok: false, error: "Ese pedido ya está cerrado." };
  }
  // Asignarlo lo pasa a "preparing": desde "Por confirmar" se saltearía la
  // revisión del depósito, que es la que decide qué se manda.
  if (!pend && String(pedido.Status).toLowerCase() === "revision_deposito") {
    return { ok: false, error: "Ese pedido todavía está por confirmar: primero confirmalo." };
  }
  if (pedido.preparador_id && Number(pedido.preparador_id) !== Number(preparadorId)) {
    const otro = listarPreparadores(db, empresaId).find((p) => p.id === Number(pedido.preparador_id));
    return { ok: false, error: `Ese pedido ya lo está preparando ${otro?.nombre || "otra persona"}. Desasignalo primero.` };
  }

  const prep = listarPreparadores(db, empresaId).find((p) => p.id === Number(preparadorId));
  if (!prep) return { ok: false, error: "Esa persona no tiene permiso para preparar pedidos." };

  db.transaction(() => {
    if (pend) {
      // Al pendiente NO se le toca el estado del pedido: ya se despachó. Y se
      // arranca de cero, porque lo preparado antes ya salió del depósito.
      db.prepare(
        `UPDATE Pedidos SET preparador_id = ?, preparacion_asignada_at = ?,
                            preparacion_terminada_at = NULL
          WHERE PedidoID = ?`
      ).run(prep.id, ahora, Number(pedidoId));
      db.prepare(`UPDATE PedidoItems SET cantidad_preparada = 0, escaneado_at = NULL WHERE PedidoID = ?`)
        .run(Number(pedidoId));
    } else {
      db.prepare(
        `UPDATE Pedidos
            SET preparador_id = ?, preparacion_asignada_at = ?, preparacion_terminada_at = NULL,
                Status = 'preparing', cerrado = 0, closedat = NULL
          WHERE PedidoID = ?`
      ).run(prep.id, ahora, Number(pedidoId));
    }
  })();

  return { ok: true, preparador: prep.nombre, pendiente: pend };
}

/**
 * Al despachar (cerrar el pedido, o entregar un pendiente), el picking de esa
 * entrega terminó y el pedido se libera. Si quedó algo pendiente, vuelve a la
 * lista para asignar: se prepara cuando entre stock, por quien toque ese día.
 *
 * Antes quedaba atado al preparador, marcado "terminado": no aparecía para
 * repartir y no se le podía dar a otro sin desasignarlo primero.
 *
 * Devuelve quién lo había preparado (o null), para dejarlo en la auditoría.
 */
export function liberarAlDespachar(db, pedidoId) {
  const p = db.prepare(`SELECT preparador_id FROM Pedidos WHERE PedidoID = ?`).get(Number(pedidoId));
  if (!p?.preparador_id) return null;
  db.prepare(
    `UPDATE Pedidos SET preparador_id = NULL, preparacion_asignada_at = NULL,
            preparacion_terminada_at = NULL
      WHERE PedidoID = ?`
  ).run(Number(pedidoId));
  return Number(p.preparador_id);
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
  // Lo mismo que esPendiente() y OBJETIVO(), pero pedido por pedido en SQL,
  // para que la lista cuente igual que la pantalla del pedido abierto.
  const pend = `(LOWER(COALESCE(p.pendiente_status,'')) = 'open' AND LOWER(COALESCE(p.Status,'')) <> 'open')`;
  const obj = `(CASE WHEN ${pend}
                     THEN COALESCE(pi.cantidad_pendiente,0)
                          + CASE WHEN p.preparacion_terminada_at IS NOT NULL
                                 THEN COALESCE(pi.cantidad_preparada,0) ELSE 0 END
                     ELSE pi.Cantidad END)`;
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
            CASE WHEN ${pend} THEN 1 ELSE 0 END AS esPendiente,
            COALESCE(SUM(CASE WHEN ${obj} > 0 THEN 1 ELSE 0 END), 0) AS lineas,
            COALESCE(SUM(CASE WHEN ${obj} > 0 THEN ${obj} ELSE 0 END), 0) AS unidadesPedidas,
            COALESCE(SUM(CASE WHEN ${obj} > 0 THEN COALESCE(pi.cantidad_preparada,0) ELSE 0 END), 0) AS unidadesPreparadas,
            COALESCE(SUM(CASE WHEN ${obj} > 0 AND COALESCE(pi.cantidad_preparada,0) >= ${obj} THEN 1 ELSE 0 END), 0) AS lineasCompletas
       FROM Pedidos p
       JOIN Empleados e ON e.EmpleadosID = p.preparador_id
       LEFT JOIN PedidoItems pi ON pi.PedidoID = p.PedidoID
      WHERE p.empresa_id = @empresaId AND p.deleted_at IS NULL
        AND p.preparador_id IS NOT NULL
        AND (@preparadorId = 0 OR p.preparador_id = @preparadorId)
        -- Sólo lo que sigue en curso. Cerrado por el jefe ya no es trabajo de
        -- nadie: sin esto, la lista del preparador crecía para siempre.
        AND (LOWER(COALESCE(p.Status,'')) IN ('open','preparing') OR ${pend})
      GROUP BY p.PedidoID
      ORDER BY p.preparacion_asignada_at`
  ).all({ empresaId: Number(empresaId), preparadorId: Number(preparadorId) || 0 })
   .map((p) => ({ ...p, esPendiente: !!p.esPendiente, preparador: p.preparador || p.preparadorUsuario }));
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
  // "open" y "preparing" son el pedido entero. "preparing" sin preparador es
  // el que el depósito pasó a En preparación desde el panel, o uno que se
  // desasignó: antes no aparecía acá y no había forma de dárselo a nadie.
  const entero = `LOWER(COALESCE(p.Status,'')) IN ('open','preparing')`;
  return db.prepare(
    `SELECT p.PedidoID AS id, p.Fecha AS fecha, p.ServicioID AS servicioId,
            CASE WHEN ${entero} THEN 0 ELSE 1 END AS esPendiente,
            CASE WHEN LOWER(COALESCE(p.Status,'')) = 'preparing' THEN 1 ELSE 0 END AS enPreparacion,
            SUM(CASE WHEN ${entero}
                     THEN 1
                     ELSE (CASE WHEN COALESCE(pi.cantidad_pendiente,0) > 0 THEN 1 ELSE 0 END) END) AS lineas,
            COALESCE(SUM(CASE WHEN ${entero}
                              THEN pi.Cantidad ELSE COALESCE(pi.cantidad_pendiente,0) END), 0) AS unidades
       FROM Pedidos p
       LEFT JOIN PedidoItems pi ON pi.PedidoID = p.PedidoID
      WHERE p.empresa_id = ? AND p.deleted_at IS NULL
        AND p.preparador_id IS NULL
        AND substr(p.Fecha, 1, 10) >= ?
        AND (
          ${entero}
          -- Y lo que quedó pendiente de un despacho incompleto: el pedido está
          -- cerrado, pero eso todavía hay que juntarlo cuando entra stock.
          OR (LOWER(COALESCE(p.pendiente_status, '')) = 'open'
              AND (SELECT COALESCE(SUM(x.cantidad_pendiente),0)
                     FROM PedidoItems x WHERE x.PedidoID = p.PedidoID) > 0)
        )
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
  const modo = modoDe(db, pedidoId);
  const tieneBarra = db.prepare(`PRAGMA table_info(Productos)`).all()
    .some((c) => c.name.toLowerCase() === "codigo_barra");

  return db.prepare(
    `SELECT pi.ProductoID                      AS productoId,
            pi.Nombre                          AS nombre,
            COALESCE(NULLIF(TRIM(pi.Codigo), ''), pr.Code) AS codigo,
            ${tieneBarra ? "pr.codigo_barra" : "NULL"} AS codigoBarra,
            ${OBJETIVO(modo)}                  AS pedida,
            COALESCE(pi.cantidad_preparada, 0) AS preparada,
            pi.escaneado_at                    AS escaneadoAt
       FROM PedidoItems pi
       LEFT JOIN Productos pr ON pr.ProductID = pi.ProductoID
      WHERE pi.PedidoID = ? AND ${OBJETIVO(modo)} > 0
      ORDER BY pi.PedidoItemID`
  ).all(Number(pedidoId));
}

const lineaDe = (db, pedidoId, productoId) => db.prepare(
  `SELECT pi.ProductoID AS productoId, pi.Nombre AS nombre, pi.Codigo AS codigo,
          ${OBJETIVO(modoDe(db, pedidoId))} AS pedida,
          COALESCE(pi.cantidad_preparada, 0) AS preparada,
          pi.escaneado_at AS escaneadoAt
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
      WHERE codigo_barra = ? AND empresa_id = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`
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
export function escanear(db, { pedidoId, codigoBarra, empresaId, ahora = ahoraSql() }) {
  const codigo = String(codigoBarra ?? "").trim();
  if (!codigo) return { ok: false, motivo: MOTIVOS.SIN_CODIGO, error: "No llegó ningún código." };

  const bloqueo = bloqueoDePicking(pedidoDe(db, pedidoId, empresaId));
  if (bloqueo) return { ok: false, motivo: MOTIVOS.CERRADO, error: bloqueo };

  const insumo = buscarPorEscaneo(db, codigo, empresaId);

  if (!insumo) {
    return { ok: false, motivo: MOTIVOS.NO_EXISTE,
             error: `El código ${codigo} no es de ningún insumo. Fijate que la etiqueta sea la correcta.` };
  }

  const linea = lineaDe(db, pedidoId, insumo.id);
  // En un pendiente, una línea que ya se entregó entera tiene objetivo 0: no
  // es parte de lo que hay que juntar, aunque esté en el pedido.
  if (!linea || Number(linea.pedida) <= 0) {
    const donde = linea ? "en lo que queda pendiente de este pedido" : "en este pedido";
    return { ok: false, motivo: MOTIVOS.NO_ESTA_EN_PEDIDO, insumo,
             error: `"${insumo.nombre}" no está ${donde}. Fijate si lo agarraste del estante de al lado.` };
  }
  if (Number(linea.preparada) >= Number(linea.pedida)) {
    return { ok: false, motivo: MOTIVOS.YA_COMPLETO, insumo, linea,
             error: `"${insumo.nombre}" ya está completo (${linea.pedida}). Si separaste de más, corregí la cantidad.` };
  }

  db.prepare(
    `UPDATE PedidoItems SET cantidad_preparada = COALESCE(cantidad_preparada, 0) + 1,
                            escaneado_at = COALESCE(escaneado_at, ?)
      WHERE PedidoID = ? AND ProductoID = ?`
  ).run(ahora, Number(pedidoId), insumo.id);

  return { ok: true, insumo, linea: lineaDe(db, pedidoId, insumo.id) };
}

/**
 * Carga a mano: la cantidad de una vez ("Completar", o "separé 12") y la
 * corrección a la baja, que acepta 0.
 *
 * Con `exigirEscaneo` (el operario), SUBIR la cantidad de un insumo pide
 * haberlo escaneado antes: el escaneo es la prueba de que agarró el correcto
 * del estante, y si se pudiera tipear todo, nadie escanearía. Bajarla no lo
 * pide: para descontar no hace falta verificar nada. El jefe no tiene la
 * traba, para cuando una etiqueta está rota.
 */
export function cargarManual(db, { pedidoId, empresaId, items = [], exigirEscaneo = false }) {
  const bloqueo = bloqueoDePicking(pedidoDe(db, pedidoId, empresaId));
  if (bloqueo) return { ok: false, errores: [bloqueo] };

  const errores = [];
  const tocar = db.prepare(
    `UPDATE PedidoItems SET cantidad_preparada = ? WHERE PedidoID = ? AND ProductoID = ?`
  );

  const aplicar = db.transaction((lista) => {
    for (const it of lista) {
      const linea = lineaDe(db, pedidoId, it?.productoId);
      if (!linea || Number(linea.pedida) <= 0) {
        errores.push(`El insumo ${it?.productoId} no está en el pedido.`);
        continue;
      }

      const n = Number(it?.cantidadPreparada);
      if (!Number.isFinite(n) || n < 0) { errores.push(`Cantidad inválida en "${linea.nombre}".`); continue; }
      if (n > Number(linea.pedida)) {
        errores.push(`"${linea.nombre}": se pidieron ${linea.pedida}, no se puede preparar ${n}.`);
        continue;
      }
      if (exigirEscaneo && n > Number(linea.preparada) && !linea.escaneadoAt) {
        errores.push(`Escaneá "${linea.nombre}" antes de cargar la cantidad.`);
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
  const o = OBJETIVO(modoDe(db, pedidoId), "");
  const r = db.prepare(
    `SELECT COUNT(*) AS lineas,
            COALESCE(SUM(${o}), 0) AS pedidas,
            COALESCE(SUM(COALESCE(cantidad_preparada,0)), 0) AS preparadas,
            SUM(CASE WHEN COALESCE(cantidad_preparada,0) >= ${o} THEN 1 ELSE 0 END) AS completas
       FROM PedidoItems WHERE PedidoID = ? AND ${o} > 0`
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

  // Un segundo "Terminé" (doble toque, o reintento porque se cortó la señal)
  // no hace nada: en un pendiente volvía a restar lo preparado y se perdían
  // unidades. Contesta ok, porque para el que apretó, está terminado.
  if (pedido.preparacion_terminada_at) {
    const r = avance(db, pedidoId);
    return { ok: true, yaEstaba: true, avance: r, pendiente: Math.max(0, r.unidadesPedidas - r.unidadesPreparadas) };
  }
  const bloqueo = bloqueoDePicking(pedido);
  if (bloqueo) return { ok: false, error: bloqueo };

  // Lo que no se preparó pasa a PENDIENTE, que es el circuito que ya existía.
  //
  // Sin esto, preparar 3 de 10 y cerrar le cobraba al servicio las 10: el
  // cierre mira cantidad_pendiente para armar el pendiente, y la foto del
  // despacho calcula Cantidad - cantidad_pendiente, así que informaba que
  // salieron 10 —al servicio, a los informes y al movimiento de Flexxus—.
  //
  // Lo preparado manda sobre lo que el depósito hubiera cargado a mano antes:
  // es lo que de verdad se juntó. Si se preparó todo, el pendiente queda en 0.
  // Preparando un PENDIENTE, lo que sigue faltando es lo que ya estaba
  // pendiente menos lo que se acaba de juntar. Preparando el pedido original,
  // es lo pedido menos lo preparado.
  const pend = esPendiente(pedido);
  // Se mide ANTES de descontar: despues de restar, lo pendiente ya cambio y
  // el resumen diria otra cosa.
  const resumen = avance(db, pedidoId);
  const tx = db.transaction(() => {
    db.prepare(
      pend
        ? `UPDATE PedidoItems
              SET cantidad_pendiente = MAX(0, COALESCE(cantidad_pendiente,0) - COALESCE(cantidad_preparada, 0))
            WHERE PedidoID = ?`
        : `UPDATE PedidoItems
              SET cantidad_pendiente = MAX(0, Cantidad - COALESCE(cantidad_preparada, 0))
            WHERE PedidoID = ?`
    ).run(Number(pedidoId));
    db.prepare(`UPDATE Pedidos SET preparacion_terminada_at = ? WHERE PedidoID = ?`)
      .run(ahora, Number(pedidoId));
  });
  tx();

  return {
    ok: true,
    avance: resumen,
    pendiente: Math.max(0, resumen.unidadesPedidas - resumen.unidadesPreparadas),
  };
}

/**
 * Por si el jefe lo devuelve: vuelve a quedar en manos del preparador.
 *
 * En un pendiente, terminar() le restó lo preparado a cantidad_pendiente. Si
 * no se deshace acá, al volver a terminar se resta de nuevo y el pendiente se
 * achica dos veces. En un pedido entero no hace falta: terminar() lo recalcula
 * desde lo pedido.
 */
export function reabrir(db, { pedidoId, empresaId }) {
  const pedido = pedidoDe(db, pedidoId, empresaId);
  if (!pedido) return { ok: false, error: "Pedido no encontrado" };
  if (!pedido.preparacion_terminada_at) return { ok: true };   // no estaba terminado: nada que deshacer

  const st = String(pedido.Status ?? "").toLowerCase();
  const pend = esPendiente(pedido);
  if (!pend && st !== "open" && st !== "preparing") {
    return { ok: false, error: "Ese pedido ya se cerró: no se puede devolver al preparador." };
  }

  db.transaction(() => {
    if (pend) {
      db.prepare(
        `UPDATE PedidoItems SET cantidad_pendiente = COALESCE(cantidad_pendiente,0) + COALESCE(cantidad_preparada,0)
          WHERE PedidoID = ?`
      ).run(Number(pedidoId));
    }
    db.prepare(`UPDATE Pedidos SET preparacion_terminada_at = NULL WHERE PedidoID = ?`)
      .run(Number(pedidoId));
  })();
  return { ok: true };
}
