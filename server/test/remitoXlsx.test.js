// El remito de un pedido también se baja como Excel (18/11/2026), con los
// mismos datos y los mismos permisos que el PDF.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";

const tmp = path.join(os.tmpdir(), `kz_remxls_${Date.now()}.db`);
const origen = path.resolve(import.meta.dirname, "../Kazaro.db");
let db = null, handler = null;

before(async () => {
  if (!fs.existsSync(origen)) return;
  fs.copyFileSync(origen, tmp);
  process.env.DB_PATH = tmp;
  ({ db } = await import("../src/db.js"));
  const orders = (await import("../src/routes/orders.js")).default;
  handler = orders.stack.find((l) => l.route?.path === "/xlsx/:id" && l.route.methods.get)?.route.stack.at(-1).handle;
});

after(() => {
  for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + ext); } catch {} }
});

async function pedir(id, empresaId) {
  const res = {
    statusCode: 200, headers: {}, body: null,
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    send(b) { this.body = b; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  await handler({ params: { id: String(id) }, query: {}, user: { id: 1, empresaId } }, res);
  return res;
}

test("el Excel trae los mismos insumos y el mismo total que el pedido", async () => {
  if (!handler) return;
  const p = db.prepare(`SELECT PedidoID id, empresa_id e, Total t FROM Pedidos p
    WHERE EXISTS (SELECT 1 FROM PedidoItems i WHERE i.PedidoID = p.PedidoID) ORDER BY PedidoID DESC LIMIT 1`).get();
  const res = await pedir(p.id, p.e ?? 1);

  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /spreadsheetml/);
  const filas = XLSX.utils.sheet_to_json(XLSX.read(res.body).Sheets.Remito, { header: 1 });
  assert.match(String(filas[0][0]), /Remito N°/);
  const encabezado = filas.findIndex((f) => f[0] === "Código");
  const totalFila = filas.find((f) => f[3] === "Total");
  const items = filas.slice(encabezado + 1, filas.indexOf(totalFila));
  assert.ok(items.length > 0);
  const suma = items.reduce((a, f) => a + Number(f[4]), 0);
  assert.ok(Math.abs(Number(totalFila[4]) - Number(p.t)) < 0.01, "el total es el del pedido");
  assert.ok(Math.abs(suma - Number(p.t)) < 0.01, "los subtotales suman el total");
});

test("una empresa no puede bajar el Excel de un pedido de otra", async () => {
  if (!handler) return;
  const p = db.prepare(`SELECT PedidoID id, empresa_id e FROM Pedidos WHERE empresa_id IS NOT NULL ORDER BY PedidoID DESC LIMIT 1`).get();
  const res = await pedir(p.id, Number(p.e) === 1 ? 2 : 1);
  assert.equal(res.statusCode, 404);
});
