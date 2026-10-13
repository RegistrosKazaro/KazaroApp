// flexxusClient.js — Hablar con la API de Flexxus: login, renovación del token
// y reintentos. No sabe nada de remitos ni de depósitos; sólo mueve HTTP.
//
// Lo que aprendimos leyendo la documentación (OpenAPI 3.0.1, v5.0.0):
//   POST /auth/login          { username, password, deviceinfo }
//                             -> { token, expireIn, refreshToken, refreshExpireIn }
//   POST /auth/refresh_token  renueva sin volver a mandar la contraseña
//   Todo lo demás viaja con  Authorization: Bearer <token>
//
// El `expireIn` que devuelve esa instancia venía en 0, así que NO se puede
// confiar en él para saber cuándo vence. La estrategia es al revés: se usa el
// token hasta que la API conteste 401, y recién ahí se renueva y se reintenta
// la llamada una vez. Es más robusto que adivinar un vencimiento.
//
// `fetchImpl` y `esperar` se pueden inyectar: así los tests corren contra un
// servidor falso y sin esperas reales.

const AGENTE = {
  model: "KazaroApp",
  platform: "node",
  uuid: "kazaro-app-server",
  version: "1.0",
  manufacturer: "Kazaro",
};

/** Errores de red o del servidor que conviene reintentar. */
export function esErrorPasajero({ status = null, codigo = null } = {}) {
  if (status != null) return status === 408 || status === 429 || status >= 500;
  const red = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN",
                       "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]);
  return red.has(String(codigo || "").toUpperCase());
}

export class FlexxusError extends Error {
  constructor(mensaje, { status = null, cuerpo = null, pasajero = false } = {}) {
    super(mensaje);
    this.name = "FlexxusError";
    this.status = status;
    this.cuerpo = cuerpo;
    this.pasajero = pasajero;
  }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export function crearClienteFlexxus({
  baseUrl,
  usuario,
  password,
  fetchImpl = globalThis.fetch,
  esperar = dormir,
  esperas = [1000, 4000, 10000],
  timeoutMs = 30000,
  deviceinfo = AGENTE,
  log = console,
} = {}) {
  if (!baseUrl) throw new Error("Falta FLEXXUS_API_URL.");
  if (!usuario || !password) throw new Error("Faltan FLEXXUS_USER y/o FLEXXUS_PASS.");

  const raiz = String(baseUrl).replace(/\/+$/, "");
  let token = null;
  let refreshToken = null;
  let loginEnCurso = null;        // evita que diez llamadas en paralelo se logueen diez veces

  const url = (ruta) => `${raiz}${ruta.startsWith("/") ? ruta : `/${ruta}`}`;

  async function pedir(ruta, { metodo = "GET", cuerpo = null, conToken = true } = {}) {
    const cabeceras = { "Content-Type": "application/json" };
    if (conToken && token) cabeceras.Authorization = `Bearer ${token}`;

    const corte = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
    let resp;
    try {
      resp = await fetchImpl(url(ruta), {
        method: metodo,
        headers: cabeceras,
        body: cuerpo == null ? undefined : JSON.stringify(cuerpo),
        signal: corte,
      });
    } catch (e) {
      const codigo = e?.cause?.code || e?.code || e?.name;
      throw new FlexxusError(`No se pudo conectar con Flexxus: ${e?.message || e}`, {
        pasajero: esErrorPasajero({ codigo }) || e?.name === "TimeoutError",
      });
    }

    const texto = await resp.text().catch(() => "");
    let datos = null;
    if (texto) { try { datos = JSON.parse(texto); } catch { datos = texto; } }

    if (!resp.ok) {
      throw new FlexxusError(
        `Flexxus respondió ${resp.status}${datos?.message ? `: ${datos.message}` : ""}`,
        { status: resp.status, cuerpo: datos, pasajero: esErrorPasajero({ status: resp.status }) }
      );
    }
    return datos;
  }

  async function login() {
    const datos = await pedir("/auth/login", {
      metodo: "POST",
      conToken: false,
      cuerpo: { username: usuario, password, deviceinfo },
    });
    if (!datos?.token) throw new FlexxusError("El login no devolvió token.", { cuerpo: datos });
    token = datos.token;
    refreshToken = datos.refreshToken || null;
    log?.log?.("[flexxus] sesión iniciada");
    return datos;
  }

  /** Renueva con el refreshToken; si no se puede, vuelve a loguearse. */
  async function renovar() {
    if (refreshToken) {
      try {
        const datos = await pedir("/auth/refresh_token", {
          metodo: "POST", conToken: false, cuerpo: { refreshToken },
        });
        if (datos?.token) {
          token = datos.token;
          if (datos.refreshToken) refreshToken = datos.refreshToken;
          log?.log?.("[flexxus] token renovado");
          return datos;
        }
      } catch (e) {
        log?.warn?.("[flexxus] no se pudo renovar, vuelvo a loguearme:", e?.message || e);
      }
    }
    return login();
  }

  /** Una sola sesión aunque varias llamadas lleguen juntas. */
  async function asegurarSesion(renovando = false) {
    if (token && !renovando) return;
    if (!loginEnCurso) {
      loginEnCurso = (renovando ? renovar() : login()).finally(() => { loginEnCurso = null; });
    }
    await loginEnCurso;
  }

  /**
   * Llama a la API. Se encarga del login, de renovar ante un 401 (una sola vez)
   * y de reintentar los fallos pasajeros con esperas crecientes.
   */
  async function llamar(ruta, { metodo = "GET", cuerpo = null } = {}) {
    await asegurarSesion();

    let renovado = false;
    let ultimo;
    for (let intento = 0; intento <= esperas.length; intento += 1) {
      try {
        return await pedir(ruta, { metodo, cuerpo });
      } catch (e) {
        ultimo = e;

        // Token vencido: se renueva y se reintenta en el acto, sin gastar un intento.
        if (e.status === 401 && !renovado) {
          renovado = true;
          await asegurarSesion(true);
          intento -= 1;
          continue;
        }
        if (!e.pasajero || intento >= esperas.length) throw e;
        log?.warn?.(`[flexxus] ${metodo} ${ruta} falló (${e.message}); reintento en ${esperas[intento] / 1000}s`);
        await esperar(esperas[intento]);
      }
    }
    throw ultimo;
  }

  return {
    llamar,
    login,
    renovar,
    get autenticado() { return Boolean(token); },

    // --- Lecturas que ya sabemos que vamos a necesitar ---
    depositos: (params = {}) => llamar(`/depositos${consulta(params)}`),
    articulos: (params = {}) => llamar(`/articulos${consulta(params)}`),
    stockPorDeposito: (params = {}) => llamar(`/stockdeposito/realpordeposito${consulta(params)}`),
    codigosBarra: (codigoArticulo) =>
      llamar(`/articulos/${encodeURIComponent(codigoArticulo)}/codigosbarra`),

    // --- Escrituras: los movimientos entre depósitos ---
    remitoDeSalida: (cuerpo) =>
      llamar("/stock/transferenciasentredepositos/remitodesalida", { metodo: "POST", cuerpo }),
    remitoDeEntrada: (cuerpo) =>
      llamar("/stock/transferenciasentredepositos/remitodeentrada", { metodo: "POST", cuerpo }),
  };
}

function consulta(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Lee la configuración del .env. Devuelve null si no está completa. */
export function configDesdeEnv(env = process.env) {
  const baseUrl = env.FLEXXUS_API_URL;
  const usuario = env.FLEXXUS_USER;
  const password = env.FLEXXUS_PASS;
  if (!baseUrl || !usuario || !password) return null;
  return { baseUrl, usuario, password };
}
