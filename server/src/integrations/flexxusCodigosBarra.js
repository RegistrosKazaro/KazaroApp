// Traer de Flexxus los códigos de barra de los insumos.
//
// Sin código de barras la pistola no sirve: escanea, escribe el número y no
// matchea con nada. Cargar 429 insumos a mano con la pistola es media jornada,
// así que primero se mira si Flexxus ya los tiene.
//
// El cruce es por CÓDIGO de artículo, con la misma regla que ya usa el resto
// de la integración: "004" y "4" son el mismo (ver normalizeCode).
//
// Dos reglas que no se negocian:
//
//   1. NUNCA se pisa un código de barras ya cargado. Si alguien lo escaneó a
//      mano, ese dato vale más que el de Flexxus: lo sacó del envase real.
//   2. Un código de barras no puede quedar en dos insumos. La base lo impide
//      con un índice único, pero se detecta ANTES para poder mostrarlo en vez
//      de que explote a mitad de camino.
//
// Siempre se arma el plan primero y se aplica después, como el sync de stock.
import { normalizeCode } from "./flexxusCore.js";

/** Qué le pasó a cada insumo. El orden es el de la pantalla. */
export const RESULTADOS = {
  SE_CARGA: "se_carga",         // tiene código en Flexxus y acá está vacío
  YA_TENIA: "ya_tenia",         // ya tenía uno cargado: no se toca
  SIN_CODIGO: "sin_codigo",     // el insumo no tiene código interno, no hay por dónde cruzar
  NO_ESTA: "no_esta",           // su código no aparece en Flexxus
  FLEXXUS_VACIO: "flexxus_vacio", // está en Flexxus pero sin código de barras cargado
  REPETIDO: "repetido",         // ese código de barras ya lo tiene otro insumo
};

/** Lo que Flexxus devuelve puede venir de varias formas. Saca la lista. */
export function leerCodigos(respuesta) {
  const crudo = Array.isArray(respuesta) ? respuesta
    : Array.isArray(respuesta?.data) ? respuesta.data
    : Array.isArray(respuesta?.codigosbarra) ? respuesta.codigosbarra
    : Array.isArray(respuesta?.items) ? respuesta.items
    : [];

  const vistos = new Set();
  const salida = [];
  for (const x of crudo) {
    const v = String(
      typeof x === "string" || typeof x === "number" ? x
        : x?.codigobarra ?? x?.codigoBarra ?? x?.codigo ?? x?.ean ?? ""
    ).trim();
    // Sólo dígitos y letras: algunos ERPs guardan basura en ese campo.
    if (!v || v.length < 4 || !/^[A-Za-z0-9._-]+$/.test(v)) continue;
    if (vistos.has(v)) continue;
    vistos.add(v);
    salida.push(v);
  }
  return salida;
}

/**
 * Decide qué se va a escribir. NO toca nada: es el diagnóstico.
 *
 * @param insumos  [{ productId, code, nombre, codigoBarra }] los de la app
 * @param deFlexxus Map<codigoNormalizado, string[]>  códigos de barra por artículo
 * @returns {{ filas, resumen }}
 */
export function planificar(insumos = [], deFlexxus = new Map()) {
  // Lo que ya está en uso en la app, para no chocar contra el índice único.
  const enUso = new Map();
  for (const i of insumos) {
    const b = String(i.codigoBarra ?? "").trim();
    if (b) enUso.set(b, i);
  }

  const filas = [];
  // Dentro de la misma corrida, dos insumos no pueden llevarse el mismo código.
  const asignados = new Set();

  for (const i of insumos) {
    const base = {
      productId: i.productId, codigo: i.code ?? null, nombre: i.nombre,
      codigoBarraActual: String(i.codigoBarra ?? "").trim() || null,
      codigoBarraNuevo: null, otros: [], duenio: null,
    };

    if (base.codigoBarraActual) { filas.push({ ...base, resultado: RESULTADOS.YA_TENIA }); continue; }

    const k = normalizeCode(i.code);
    if (!k) { filas.push({ ...base, resultado: RESULTADOS.SIN_CODIGO }); continue; }

    const codigos = deFlexxus.get(k);
    if (codigos === undefined) { filas.push({ ...base, resultado: RESULTADOS.NO_ESTA }); continue; }
    if (!codigos.length) { filas.push({ ...base, resultado: RESULTADOS.FLEXXUS_VACIO }); continue; }

    // Se toma el primero que no esté ocupado. Un artículo puede tener varios
    // (el del envase y el de la caja); los demás quedan informados.
    const libre = codigos.find((c) => !enUso.has(c) && !asignados.has(c));
    if (!libre) {
      const duenio = enUso.get(codigos[0]) || null;
      filas.push({
        ...base, resultado: RESULTADOS.REPETIDO, codigoBarraNuevo: codigos[0],
        duenio: duenio ? { productId: duenio.productId, nombre: duenio.nombre } : null,
        otros: codigos.slice(1),
      });
      continue;
    }

    asignados.add(libre);
    filas.push({
      ...base, resultado: RESULTADOS.SE_CARGA, codigoBarraNuevo: libre,
      otros: codigos.filter((c) => c !== libre),
    });
  }

  const contar = (r) => filas.filter((f) => f.resultado === r).length;
  return {
    filas,
    resumen: {
      total: filas.length,
      seCargan: contar(RESULTADOS.SE_CARGA),
      yaTenian: contar(RESULTADOS.YA_TENIA),
      sinCodigo: contar(RESULTADOS.SIN_CODIGO),
      noEstan: contar(RESULTADOS.NO_ESTA),
      flexxusVacio: contar(RESULTADOS.FLEXXUS_VACIO),
      repetidos: contar(RESULTADOS.REPETIDO),
    },
  };
}

/**
 * Escribe sólo las filas `se_carga`. Todo o nada: si una falla, no queda la
 * carga a medias sin que nadie sepa dónde se cortó.
 */
export function aplicar(db, plan, { empresaId = 1 } = {}) {
  const aEscribir = (plan?.filas ?? []).filter((f) => f.resultado === RESULTADOS.SE_CARGA);
  if (!aEscribir.length) return { ok: true, escritos: 0, errores: [] };

  const upd = db.prepare(
    `UPDATE Productos SET codigo_barra = ?
      WHERE ProductID = ? AND empresa_id = ?
        AND COALESCE(TRIM(codigo_barra), '') = ''`
  );

  const errores = [];
  let escritos = 0;
  db.transaction(() => {
    for (const f of aEscribir) {
      try {
        // La condición del WHERE es la segunda defensa: si alguien cargó ese
        // insumo a mano entre el plan y el apretar el botón, no se le pisa.
        const r = upd.run(f.codigoBarraNuevo, f.productId, Number(empresaId));
        if (r.changes) escritos += 1;
        else errores.push(`${f.nombre}: ya tenía código, no se tocó`);
      } catch (e) {
        errores.push(`${f.nombre}: ${e?.message || e}`);
      }
    }
  })();

  return { ok: errores.length === 0, escritos, errores };
}

/** Los insumos de la app que entran al cruce. */
export function insumosDeLaApp(db, empresaId = 1) {
  return db.prepare(
    `SELECT ProductID AS productId, Code AS code, ProductName AS nombre,
            codigo_barra AS codigoBarra
       FROM Productos
      WHERE empresa_id = ? AND COALESCE(is_active, 1) = 1
      ORDER BY ProductName COLLATE NOCASE`
  ).all(Number(empresaId));
}

/**
 * Le pide a Flexxus los códigos de barra, de a un artículo por vez.
 *
 * Es una llamada por insumo porque la API no tiene un endpoint que los traiga
 * todos juntos. Con ~429 insumos son ~429 llamadas: va en serie y con una
 * pausa chica para no castigar al ERP, y un artículo que falle no voltea la
 * corrida entera.
 *
 * @returns {{ porCodigo: Map, fallados: Array }}
 */
export async function traerDeFlexxus(cliente, insumos, {
  pausaMs = 120, esperar = (ms) => new Promise((r) => setTimeout(r, ms)), log,
} = {}) {
  const porCodigo = new Map();
  const fallados = [];

  // Un código normalizado puede repetirse entre insumos: se pide una sola vez.
  const codigos = [...new Set(insumos.map((i) => normalizeCode(i.code)).filter(Boolean))];

  for (const k of codigos) {
    try {
      porCodigo.set(k, leerCodigos(await cliente.codigosBarra(k)));
    } catch (e) {
      // 404 = el artículo no está en Flexxus. No es un fallo: es información.
      if (Number(e?.status) === 404) continue;
      fallados.push({ codigo: k, error: e?.message || String(e) });
      log?.warn?.(`[flexxus] códigos de barra de ${k}: ${e?.message || e}`);
    }
    if (pausaMs > 0) await esperar(pausaMs);
  }

  return { porCodigo, fallados };
}
