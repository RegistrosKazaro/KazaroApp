import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({ api: { get: vi.fn() } }));
import { api } from "../api/client";
import Informes from "./Informes";

const RESPUESTA = {
  ok: true,
  periodo: { desde: "2026-09-01", hasta: "2026-09-15" },
  modo: "insumos",
  kpis: { monto: 300, unidades: 30, pedidos: 3, servicios: 2, insumos: 2, promedioPorPedido: 100 },
  evolucion: [
    { mes: "2026-08", monto: 100, unidades: 10, pedidos: 1 },
    { mes: "2026-09", monto: 200, unidades: 20, pedidos: 2 },
  ],
  // El segundo gana por monto, el primero por cantidad: sirve para probar el toggle.
  servicios: [
    { id: "1", nombre: "HOSPITAL OLIVA", monto: 100, unidades: 25, pedidos: 2, insumos: 1 },
    { id: "2", nombre: "SUPER MAMI 7", monto: 200, unidades: 5, pedidos: 1, insumos: 1 },
  ],
  insumos: [
    { id: "10", codigo: "004", nombre: "BOLSA NEGRA", monto: 200, unidades: 20, pedidos: 2, servicios: 2 },
    { id: "11", codigo: "007", nombre: "LAMPAZO", monto: 100, unidades: 10, pedidos: 1, servicios: 1 },
  ],
  tendencia: [
    { semana: "2026-08-31", monto: 100, unidades: 10, pedidos: 1 },
    { semana: "2026-09-07", monto: 120, unidades: 12, pedidos: 1 },
    { semana: "2026-09-14", monto: 80, unidades: 8, pedidos: 1 },
  ],
  supervisores: [{ id: "31", nombre: "Barcena, Nicolas", rol: "supervisor", monto: 300, unidades: 30, pedidos: 3, servicios: 2 }],
  insumosPorServicio: {
    1: [{ id: "10", codigo: "004", nombre: "BOLSA NEGRA", monto: 100, unidades: 25 }],
    2: [{ id: "11", codigo: "007", nombre: "LAMPAZO", monto: 200, unidades: 5 }],
  },
  devoluciones: {
    total: 3, aprobadas: 2, pendientes: 1, rechazadas: 0, unidades: 7, monto: 150,
    topInsumos: [{ id: "10", nombre: "BOLSA NEGRA", cantidad: 2, unidades: 7, monto: 150 }],
    topServicios: [{ nombre: "HOSPITAL OLIVA", cantidad: 2, unidades: 7 }],
  },
  sinRetirar: { pedidos: 4, monto: 5000 },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: RESPUESTA });
});

const abrir = () => render(<MemoryRouter><Informes /></MemoryRouter>);
// Espera a que termine de cargar y devuelve la tarjeta del total.
const esperarCarga = async () => {
  await screen.findByRole("heading", { name: "Servicios que más pidieron" });
  return document.querySelector(".inf-kpi.is-main");
};
const tarjeta = (titulo) => screen.getByRole("heading", { name: titulo }).closest(".inf-card");

describe("Informes", () => {
  it("pide el mes en curso y muestra los totales", async () => {
    abrir();
    const total = await esperarCarga();
    const params = api.get.mock.calls[0][1].params;
    expect(api.get.mock.calls[0][0]).toBe("/reports/panel");
    expect(params.modo).toBe("insumos");
    expect(params.desde).toMatch(/^\d{4}-\d{2}-01$/);
    expect(within(total).getByText("$ 300,00")).toBeInTheDocument();
    expect(within(total).getByText("30 unidades")).toBeInTheDocument();
    const kpis = document.querySelectorAll(".inf-kpi");
    expect(within(kpis[1]).getByText("3")).toBeInTheDocument();   // pedidos
  });

  it("avisa de los pedidos sin marcar como retirados, que no entran", async () => {
    abrir();
    expect(await screen.findByText(/Faltan 4 pedidos por marcar como retirados/)).toBeInTheDocument();
  });

  it("ordena por monto y, al cambiar a cantidad, reordena", async () => {
    const user = userEvent.setup({ delay: null });
    abrir();
    await esperarCarga();
    const nombres = () => within(tarjeta("Servicios que más pidieron")).getAllByText(/HOSPITAL OLIVA|SUPER MAMI 7/).map((n) => n.textContent);
    expect(nombres()[0]).toBe("SUPER MAMI 7");     // 200 > 100 en pesos
    await user.click(screen.getByRole("button", { name: "Por cantidad" }));
    expect(nombres()[0]).toBe("HOSPITAL OLIVA");   // 25 > 5 en unidades
  });

  it("al tocar un servicio muestra qué insumos pidió", async () => {
    const user = userEvent.setup({ delay: null });
    abrir();
    await esperarCarga();
    await user.click(within(tarjeta("Servicios que más pidieron")).getByText("HOSPITAL OLIVA"));
    const detalle = document.querySelector(".inf-detalle");
    expect(within(detalle).getByText("BOLSA NEGRA")).toBeInTheDocument();
    expect(within(detalle).getByText("004")).toBeInTheDocument();
  });

  it("cambiar el período vuelve a pedir los datos", async () => {
    const user = userEvent.setup({ delay: null });
    abrir();
    await esperarCarga();
    await user.click(screen.getByRole("button", { name: "Mes pasado" }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    const p = api.get.mock.calls[1][1].params;
    expect(p.desde < p.hasta).toBe(true);
  });

  it("el botón de uniformes pide el otro modo", async () => {
    const user = userEvent.setup({ delay: null });
    abrir();
    await esperarCarga();
    await user.click(screen.getByRole("button", { name: "Uniformes" }));
    await waitFor(() => expect(api.get.mock.calls[1][1].params.modo).toBe("uniformes"));
  });

  it("muestra las devoluciones con su estado", async () => {
    abrir();
    await esperarCarga();
    const dev = tarjeta("Devoluciones");
    expect(within(dev).getByText("aprobadas")).toBeInTheDocument();
    expect(within(dev).getByText("a aprobar")).toBeInTheDocument();
    const unidades = within(dev).getByText("unidades devueltas").closest(".inf-dev-kpi");
    expect(within(unidades).getByText("7")).toBeInTheDocument();
    expect(within(dev).getByText("Insumos más devueltos")).toBeInTheDocument();
  });

  it("dibuja la tendencia y las barras con eje", async () => {
    abrir();
    await esperarCarga();
    expect(screen.getByRole("img", { name: /Cómo viene/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Los 8 servicios que más pidieron" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Los 8 insumos más pedidos" })).toBeInTheDocument();
  });

  it("el botón de Excel pide el archivo con el período y el modo elegidos", async () => {
    const user = userEvent.setup({ delay: null });
    const blob = new Blob(["x"]);
    api.get.mockImplementation((url) =>
      Promise.resolve({ data: url.includes("excel") ? blob : RESPUESTA }));
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    abrir();
    await esperarCarga();
    await user.click(screen.getByRole("button", { name: "Exportar a Excel" }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const llamada = api.get.mock.calls.find((c) => c[0].includes("excel"));
    expect(llamada[1].responseType).toBe("blob");
    expect(llamada[1].params.modo).toBe("insumos");
    expect(llamada[1].params.desde).toMatch(/^\d{4}-\d{2}-01$/);
    click.mockRestore();
  });

  it("si falla, lo dice", async () => {
    api.get.mockRejectedValue({ response: { data: { error: "Se cayó el servidor" } } });
    abrir();
    expect(await screen.findByText("Se cayó el servidor")).toBeInTheDocument();
  });
});
