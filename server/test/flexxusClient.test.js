// Cliente HTTP de Flexxus. Corre contra un servidor falso: sin red, sin esperas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crearClienteFlexxus, esErrorPasajero, FlexxusError, configDesdeEnv }
  from "../src/integrations/flexxusClient.js";

const CALLADO = { log() {}, warn() {} };

/** Servidor falso: se le dice qué contestar a cada ruta y anota lo que recibió. */
function servidorFalso(rutas) {
  const pedidos = [];
  const fetchImpl = async (url, opciones = {}) => {
    const ruta = new URL(url).pathname;
    pedidos.push({
      ruta,
      metodo: opciones.method || "GET",
      autorizacion: opciones.headers?.Authorization || null,
      cuerpo: opciones.body ? JSON.parse(opciones.body) : null,
      query: new URL(url).search,
    });
    const manejar = rutas[ruta];
    if (!manejar) return respuesta(404, { message: "no existe" });
    return manejar(pedidos.filter((p) => p.ruta === ruta).length, pedidos.at(-1));
  };
  return { fetchImpl, pedidos };
}

const respuesta = (status, cuerpo) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (cuerpo == null ? "" : JSON.stringify(cuerpo)),
});

const LOGIN_OK = () => respuesta(200, { token: "T1", expireIn: 0, refreshToken: "R1" });

const cliente = (fetchImpl, extra = {}) => crearClienteFlexxus({
  baseUrl: "https://flexxus.ejemplo/v5",
  usuario: "api.kazaro",
  password: "secreta",
  fetchImpl,
  esperar: async () => {},
  log: CALLADO,
  ...extra,
});

test("sin configuración no se puede crear el cliente", () => {
  assert.throws(() => crearClienteFlexxus({}), /Falta FLEXXUS_API_URL/);
  assert.throws(() => crearClienteFlexxus({ baseUrl: "x" }), /FLEXXUS_USER/);
});

test("se loguea antes de la primera llamada y manda el deviceinfo", async () => {
  const { fetchImpl, pedidos } = servidorFalso({
    "/v5/auth/login": LOGIN_OK,
    "/v5/depositos": () => respuesta(200, { count: 2, data: [] }),
  });
  const c = cliente(fetchImpl);
  await c.depositos();
  assert.deepEqual(pedidos.map((p) => p.ruta), ["/v5/auth/login", "/v5/depositos"]);
  assert.equal(pedidos[0].cuerpo.username, "api.kazaro");
  assert.ok(pedidos[0].cuerpo.deviceinfo.model, "el login exige deviceinfo");
  assert.equal(pedidos[1].autorizacion, "Bearer T1");
});

test("no se loguea dos veces aunque lleguen varias llamadas juntas", async () => {
  const { fetchImpl, pedidos } = servidorFalso({
    "/v5/auth/login": LOGIN_OK,
    "/v5/depositos": () => respuesta(200, {}),
    "/v5/articulos": () => respuesta(200, {}),
  });
  const c = cliente(fetchImpl);
  await Promise.all([c.depositos(), c.articulos(), c.depositos()]);
  assert.equal(pedidos.filter((p) => p.ruta === "/v5/auth/login").length, 1);
});

test("ante un 401 renueva el token y reintenta la llamada", async () => {
  const { fetchImpl, pedidos } = servidorFalso({
    "/v5/auth/login": LOGIN_OK,
    "/v5/auth/refresh_token": () => respuesta(200, { token: "T2" }),
    "/v5/depositos": (n) => (n === 1 ? respuesta(401, { message: "token vencido" })
                                     : respuesta(200, { ok: true })),
  });
  const c = cliente(fetchImpl);
  const r = await c.depositos();
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(pedidos.map((p) => p.ruta),
    ["/v5/auth/login", "/v5/depositos", "/v5/auth/refresh_token", "/v5/depositos"]);
  assert.equal(pedidos.at(-1).autorizacion, "Bearer T2", "la segunda vez va con el token nuevo");
});

test("si el refresh falla, vuelve a loguearse con usuario y contraseña", async () => {
  const { fetchImpl, pedidos } = servidorFalso({
    "/v5/auth/login": (n) => respuesta(200, { token: `T${n}`, refreshToken: "R1" }),
    "/v5/auth/refresh_token": () => respuesta(400, { message: "refresh vencido" }),
    "/v5/depositos": (n) => (n === 1 ? respuesta(401, {}) : respuesta(200, { ok: true })),
  });
  const c = cliente(fetchImpl);
  assert.deepEqual(await c.depositos(), { ok: true });
  assert.equal(pedidos.filter((p) => p.ruta === "/v5/auth/login").length, 2);
  assert.equal(pedidos.at(-1).autorizacion, "Bearer T2");
});

test("un 401 que insiste no entra en bucle", async () => {
  const { fetchImpl, pedidos } = servidorFalso({
    "/v5/auth/login": LOGIN_OK,
    "/v5/auth/refresh_token": () => respuesta(200, { token: "T2" }),
    "/v5/depositos": () => respuesta(401, { message: "sin permiso" }),
  });
  await assert.rejects(() => cliente(fetchImpl).depositos(), /401/);
  // login + llamada + refresh + llamada, y corta.
  assert.equal(pedidos.filter((p) => p.ruta === "/v5/depositos").length, 2);
});

test("reintenta los 5xx y termina saliendo", async () => {
  const { fetchImpl, pedidos } = servidorFalso({
    "/v5/auth/login": LOGIN_OK,
    "/v5/depositos": (n) => (n < 3 ? respuesta(503, { message: "caido" }) : respuesta(200, { ok: true })),
  });
  assert.deepEqual(await cliente(fetchImpl).depositos(), { ok: true });
  assert.equal(pedidos.filter((p) => p.ruta === "/v5/depositos").length, 3);
});

test("un 400 NO se reintenta: el pedido está mal y va a seguir mal", async () => {
  const { fetchImpl, pedidos } = servidorFalso({
    "/v5/auth/login": LOGIN_OK,
    "/v5/stock/transferenciasentredepositos/remitodesalida": () =>
      respuesta(400, { message: "codigodeposito inexistente" }),
  });
  await assert.rejects(() => cliente(fetchImpl).remitoDeSalida({}), /codigodeposito inexistente/);
  assert.equal(pedidos.filter((p) => p.metodo === "POST" && p.ruta.includes("remitodesalida")).length, 1);
});

test("si nunca se recupera, tira el error y no insiste de más", async () => {
  const { fetchImpl, pedidos } = servidorFalso({
    "/v5/auth/login": LOGIN_OK,
    "/v5/depositos": () => respuesta(500, { message: "roto" }),
  });
  await assert.rejects(() => cliente(fetchImpl).depositos(), /500/);
  assert.equal(pedidos.filter((p) => p.ruta === "/v5/depositos").length, 4);  // 1 + 3 reintentos
});

test("un corte de red se reintenta", async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    if (n === 1) return respuesta(200, { token: "T1" });
    if (n === 2) { const e = new Error("socket hang up"); e.code = "ECONNRESET"; throw e; }
    return respuesta(200, { ok: true });
  };
  assert.deepEqual(await cliente(fetchImpl).depositos(), { ok: true });
  assert.equal(n, 3);
});

test("el remito de salida va por POST a la ruta correcta y con el cuerpo tal cual", async () => {
  const { fetchImpl, pedidos } = servidorFalso({
    "/v5/auth/login": LOGIN_OK,
    "/v5/stock/transferenciasentredepositos/remitodesalida": () =>
      respuesta(200, { numerocomprobante: "0001-00037590" }),
  });
  const cuerpo = {
    tipocomprobante: "MD", fechacomprobante: "2026-09-18 19:05:20",
    codigodepositoorigen: "001", codigodepositodestino: "722",
    comentarios: "OP-0001053", codigousuario: "GGONZALEZ",
    productos: [{ codigoarticulo: "004", cantidad: 400 }],
  };
  const r = await cliente(fetchImpl).remitoDeSalida(cuerpo);
  assert.equal(r.numerocomprobante, "0001-00037590");
  const envio = pedidos.at(-1);
  assert.equal(envio.metodo, "POST");
  assert.deepEqual(envio.cuerpo, cuerpo, "el cuerpo viaja sin tocar");
});

test("la devolución usa el endpoint de entrada", async () => {
  const { fetchImpl, pedidos } = servidorFalso({
    "/v5/auth/login": LOGIN_OK,
    "/v5/stock/transferenciasentredepositos/remitodeentrada": () => respuesta(200, {}),
  });
  await cliente(fetchImpl).remitoDeEntrada({ tipocomprobante: "MD" });
  assert.match(pedidos.at(-1).ruta, /remitodeentrada$/);
});

test("los filtros viajan como query, y los vacíos no", async () => {
  const { fetchImpl, pedidos } = servidorFalso({
    "/v5/auth/login": LOGIN_OK,
    "/v5/stockdeposito/realpordeposito": () => respuesta(200, {}),
  });
  await cliente(fetchImpl).stockPorDeposito({ listacodigosdeposito: "001", lote: "", fechamodificacion: null });
  assert.equal(pedidos.at(-1).query, "?listacodigosdeposito=001");
});

test("la barra sobrante de la URL base no duplica barras", async () => {
  const { fetchImpl, pedidos } = servidorFalso({
    "/v5/auth/login": LOGIN_OK,
    "/v5/depositos": () => respuesta(200, {}),
  });
  await cliente(fetchImpl, { baseUrl: "https://flexxus.ejemplo/v5/" }).depositos();
  assert.equal(pedidos.at(-1).ruta, "/v5/depositos");
});

test("un login sin token es un error claro, no un silencio", async () => {
  const { fetchImpl } = servidorFalso({ "/v5/auth/login": () => respuesta(200, { message: "ok" }) });
  await assert.rejects(() => cliente(fetchImpl).depositos(), /no devolvió token/);
});

test("esErrorPasajero separa lo que conviene reintentar de lo que no", () => {
  for (const s of [500, 502, 503, 504, 429, 408]) assert.equal(esErrorPasajero({ status: s }), true, String(s));
  for (const s of [400, 401, 403, 404, 422]) assert.equal(esErrorPasajero({ status: s }), false, String(s));
  assert.equal(esErrorPasajero({ codigo: "ECONNRESET" }), true);
  assert.equal(esErrorPasajero({ codigo: "CUALQUIERA" }), false);
});

test("el error lleva el status y el cuerpo, para poder mostrarlos", async () => {
  const { fetchImpl } = servidorFalso({
    "/v5/auth/login": LOGIN_OK,
    "/v5/depositos": () => respuesta(403, { message: "sin permiso para depositos" }),
  });
  await assert.rejects(() => cliente(fetchImpl).depositos(), (e) => {
    assert.ok(e instanceof FlexxusError);
    assert.equal(e.status, 403);
    assert.equal(e.cuerpo.message, "sin permiso para depositos");
    assert.equal(e.pasajero, false);
    return true;
  });
});

test("configDesdeEnv devuelve null si falta algo", () => {
  assert.equal(configDesdeEnv({}), null);
  assert.equal(configDesdeEnv({ FLEXXUS_API_URL: "x", FLEXXUS_USER: "y" }), null);
  assert.deepEqual(
    configDesdeEnv({ FLEXXUS_API_URL: "x", FLEXXUS_USER: "y", FLEXXUS_PASS: "z" }),
    { baseUrl: "x", usuario: "y", password: "z" },
  );
});
