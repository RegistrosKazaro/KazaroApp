// La planilla de movimientos entre depósitos.
//
// Lo importante: que se lea como la de Flexxus (origen, destino, remito) y que
// no mienta sobre el número de comprobante mientras no esté enganchado.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../api/client", () => ({ api: { get: vi.fn() } }));

import { api } from "../api/client";
import MovimientosDeposito from "./MovimientosDeposito";

const CENTRAL = { codigo: "001", nombre: "DEPOSITO CENTRAL" };

const FILAS = [
  { clave: "d1444", tipo: "salida", comprobante: "MD", pedidoId: 1444,
    referencia: "OP-0001444", fecha: "2026-10-15 13:02:28",
    origen: CENTRAL, destino: { codigo: "626", nombre: "DEPOSITO 626" },
    servicio: "MANTENIMIENTO DE PARQUE CHATEAU", lineas: 1, unidades: 200,
    numeroMovimiento: null, estadoEnvio: null, sinDeposito: false,
    responsable: "German Gonzalez" },
  { clave: "v1437", tipo: "entrada", comprobante: "MD", pedidoId: 1437,
    referencia: "OP-0001437", fecha: "2026-10-14 09:10:00",
    origen: { codigo: "343", nombre: "DEPOSITO 343" }, destino: CENTRAL,
    servicio: "DYASA S.A", lineas: 2, unidades: 50,
    numeroMovimiento: "0001-00037813", estadoEnvio: "enviado", sinDeposito: false,
    responsable: "Encargado Deposito" },
  { clave: "d1441", tipo: "salida", comprobante: "MD", pedidoId: 1441,
    referencia: "OP-0001441", fecha: "2026-10-14 18:27:00",
    origen: CENTRAL, destino: { codigo: null, nombre: null },
    servicio: null, lineas: 5, unidades: 83,
    numeroMovimiento: null, estadoEnvio: null, sinDeposito: true, responsable: null },
];

const DETALLE = {
  ok: true, clave: "d1444", pedidoId: 1444, tipo: "salida", referencia: "OP-0001444",
  unidades: 200,
  items: [{ codigo: "004", nombre: "BOLSA NEGRA 80*100", cantidad: 200, precio: 80, subtotal: 16000 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((url) => {
    if (url === "/deposito/movimientos/depositos") {
      return Promise.resolve({ data: { depositos: [
        { codigo: "626", nombre: "DEPOSITO 626", movimientos: 12 },
        { codigo: "343", nombre: "DEPOSITO 343", movimientos: 4 },
      ]}});
    }
    if (url.startsWith("/deposito/movimientos/")) return Promise.resolve({ data: DETALLE });
    return Promise.resolve({ data: { rows: FILAS, total: 3, unidades: 333 } });
  });
});

const filaDe = async (referencia) =>
  (await screen.findByText(referencia)).closest("tr");

describe("Movimientos entre depósitos", () => {
  it("muestra la salida con su origen, destino y remito", async () => {
    render(<MovimientosDeposito />);
    const fila = await filaDe("OP-0001444");
    expect(within(fila).getByText(/001 · DEPOSITO CENTRAL/)).toBeTruthy();
    expect(within(fila).getByText(/626 · DEPOSITO 626/)).toBeTruthy();
    expect(within(fila).getByText("200")).toBeTruthy();
    expect(within(fila).getByText("German Gonzalez")).toBeTruthy();
  });

  it("la entrada va al revés: del servicio al central", async () => {
    render(<MovimientosDeposito />);
    const fila = await filaDe("OP-0001437");
    const celdas = within(fila).getAllByRole("cell");
    expect(celdas[3].textContent).toMatch(/343/);
    expect(celdas[4].textContent).toMatch(/DEPOSITO CENTRAL/);
  });

  it("si todavía no se informó a Flexxus, lo dice en vez de inventar un número", async () => {
    render(<MovimientosDeposito />);
    const fila = await filaDe("OP-0001444");
    expect(within(fila).getByText("sin informar")).toBeTruthy();
  });

  it("y cuando sí se informó, muestra el número de comprobante", async () => {
    render(<MovimientosDeposito />);
    const fila = await filaDe("OP-0001437");
    expect(within(fila).getByText("0001-00037813")).toBeTruthy();
  });

  it("marca el servicio que no tiene depósito mapeado", async () => {
    render(<MovimientosDeposito />);
    const fila = await filaDe("OP-0001441");
    expect(within(fila).getByText("sin depósito")).toBeTruthy();
  });

  it("al abrir una fila trae su detalle", async () => {
    const user = userEvent.setup({ delay: null });
    render(<MovimientosDeposito />);
    await user.click(await filaDe("OP-0001444"));

    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/deposito/movimientos/d1444"));
    expect(await screen.findByText("BOLSA NEGRA 80*100")).toBeTruthy();
    expect(screen.getByText(/Detalle del movimiento OP-0001444/)).toBeTruthy();
  });

  it("volver a tocarla la cierra", async () => {
    const user = userEvent.setup({ delay: null });
    render(<MovimientosDeposito />);
    await user.click(await filaDe("OP-0001444"));
    await screen.findByText("BOLSA NEGRA 80*100");

    await user.click(await filaDe("OP-0001444"));
    await waitFor(() => expect(screen.queryByText("BOLSA NEGRA 80*100")).toBeNull());
  });

  it("filtrar por tipo vuelve a pedir sólo ese tipo", async () => {
    const user = userEvent.setup({ delay: null });
    render(<MovimientosDeposito />);
    await screen.findByText("OP-0001444");

    await user.selectOptions(screen.getByLabelText("Tipo"), "salida");
    await waitFor(() => {
      const ultima = api.get.mock.calls.filter(([u]) => u === "/deposito/movimientos").at(-1);
      expect(ultima[1].params.tipo).toBe("salida");
    });
  });

  it("el filtro de depósito se arma con los que tienen movimientos", async () => {
    render(<MovimientosDeposito />);
    const select = await screen.findByLabelText("Depósito");
    expect(within(select).getByText(/626 · DEPOSITO 626 \(12\)/)).toBeTruthy();
  });

  it("arranca con el último mes, no con todo el histórico", async () => {
    render(<MovimientosDeposito />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const primera = api.get.mock.calls.find(([u]) => u === "/deposito/movimientos");
    expect(primera[1].params.desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(primera[1].params.hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("sin movimientos lo dice", async () => {
    api.get.mockImplementation((url) =>
      url === "/deposito/movimientos/depositos"
        ? Promise.resolve({ data: { depositos: [] } })
        : Promise.resolve({ data: { rows: [], total: 0, unidades: 0 } }));
    render(<MovimientosDeposito />);
    expect(await screen.findByText("No hay movimientos en ese rango.")).toBeTruthy();
  });
});
