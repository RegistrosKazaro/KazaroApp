// CORS: quién puede llamar a la API desde un navegador.
//
// Este test apuntaba a src/app.js, que no lo usa nadie: el servidor real es
// src/index.js y arma el CORS con createCorsMiddleware. Probar app.js daba
// tranquilidad falsa, porque ese archivo tiene su propia lista de orígenes
// pegada a mano que no es la que corre. Ahora se prueba el middleware vivo.
process.env.APP_BASE_URL = "http://localhost:4000";
process.env.CORS_ALLOWED_ORIGINS = "https://allowed.test";

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

const { createCorsMiddleware, getAllowedOrigins } = await import("../src/utils/corsConfig.js");

/** Un servidor mínimo con el mismo CORS que usa index.js. */
const startServer = () =>
  new Promise((resolve) => {
    const app = express();
    app.use(createCorsMiddleware());
    app.get("/_health", (_req, res) => res.json({ ok: true }));
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });

const stopServer = (server) => new Promise((resolve) => server.close(resolve));

/** Llama a /_health con el Origin que se le diga y devuelve la respuesta. */
async function pedir(origin) {
  const { server, baseUrl } = await startServer();
  try {
    return await fetch(`${baseUrl}/_health`, origin ? { headers: { Origin: origin } } : undefined);
  } finally {
    await stopServer(server);
  }
}

test("la lista sale de APP_BASE_URL mas CORS_ALLOWED_ORIGINS", () => {
  const origins = getAllowedOrigins();
  assert.ok(origins.includes("http://localhost:4000"), "falta el origen propio");
  assert.ok(origins.includes("https://allowed.test"), "falta el origen configurado");
});

test("un origen de la lista pasa y puede mandar la cookie", async () => {
  const res = await pedir("https://allowed.test");

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://allowed.test");
  // Sin credentials el navegador no manda la cookie de sesión y nadie entra.
  assert.equal(res.headers.get("access-control-allow-credentials"), "true");
});

test("un origen que no esta en la lista se corta con 403", async () => {
  const res = await pedir("https://blocked.test");

  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "Not allowed by CORS" });
});

test("sin Origin pasa pero sin credentials", async () => {
  // Son llamadas que no vienen de un navegador (curl, server a server).
  const res = await pedir(null);

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-credentials"), null);
});

test("el nombre del archivo descargado queda visible para el front", async () => {
  // Sin exponer Content-Disposition, el front tiene que inventar el nombre
  // de cada Excel que se baja.
  const res = await pedir("https://allowed.test");

  assert.match(res.headers.get("access-control-expose-headers") || "", /Content-Disposition/i);
});
