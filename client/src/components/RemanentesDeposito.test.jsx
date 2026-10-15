// Remanentes: lo que volvió abierto, usado o roto y no entró al stock general.
//
// Lo importante acá es que tenga salida: si sirve se pasa al stock, si no se
// descarta. Sin eso el número sólo crece y en unos meses no representa nada.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../api/client", () => ({ api: { get: vi.fn(), put: vi.fn() } }));

import { api } from "../api/client";
import RemanentesDeposito from "./RemanentesDeposito";

const FILAS = [
  { productoId: "40", nombre: "DETERGENTE KAZARO X 5 LTS", codigo: "100000032",
    remanente: 3, stock: 120, precio: 5000 },
  { productoId: "50", nombre: "JARRA MEDIDORA 1 LTS", codigo: "01481",
    remanente: 1, stock: 4991, precio: 800 },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: { rows: FILAS, unidades: 4, monto: 15800 } });
  api.put.mockResolvedValue({ data: { ok: true, cantidad: 3, remanenteNuevo: 0, stockNuevo: 123 } });
});

// Los controles se despliegan en una fila aparte, a todo el ancho, y hay una
// sola abierta por vez: por eso se buscan en la pantalla y no dentro de la fila.
const abrirRevision = async (user, nombre = "DETERGENTE KAZARO X 5 LTS") => {
  render(<RemanentesDeposito />);
  const fila = (await screen.findByText(nombre)).closest("tr");
  await user.click(within(fila).getByRole("button", { name: "Revisar" }));
  return fila;
};

describe("Remanentes del depósito", () => {
  it("lista lo que quedó esperando revisión, con su plata", async () => {
    render(<RemanentesDeposito />);
    const fila = (await screen.findByText("DETERGENTE KAZARO X 5 LTS")).closest("tr");
    expect(within(fila).getByText("3")).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith("/deposito/remanentes");
    expect(screen.getByText("unidades en remanentes")).toBeTruthy();
  });

  it("aclara que mover un remanente no cambia el consumo del servicio", async () => {
    render(<RemanentesDeposito />);
    await screen.findByText("DETERGENTE KAZARO X 5 LTS");
    expect(screen.getByText(/El consumo del servicio no cambia/)).toBeTruthy();
  });

  it("al revisar propone mover todo, que es lo más común", async () => {
    const user = userEvent.setup({ delay: null });
    const fila = await abrirRevision(user);
    expect(screen.getByLabelText(/Cuántas unidades de DETERGENTE/).value).toBe("3");
  });

  it("pasarlo al stock lo manda con la cantidad", async () => {
    const user = userEvent.setup({ delay: null });
    const fila = await abrirRevision(user);
    await user.click(screen.getByRole("button", { name: "Al stock" }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const [url, body] = api.put.mock.calls[0];
    expect(url).toBe("/deposito/remanentes/40");
    expect(body).toMatchObject({ accion: "al_stock", cantidad: 3 });
  });

  it("se puede pasar sólo una parte", async () => {
    const user = userEvent.setup({ delay: null });
    const fila = await abrirRevision(user);
    const campo = screen.getByLabelText(/Cuántas unidades de DETERGENTE/);
    await user.clear(campo);
    await user.type(campo, "2");
    await user.click(screen.getByRole("button", { name: "Al stock" }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0][1].cantidad).toBe(2);
  });

  it("descartar manda el motivo", async () => {
    const user = userEvent.setup({ delay: null });
    const fila = await abrirRevision(user);
    await user.type(screen.getByLabelText(/Motivo para DETERGENTE/), "vencido");
    await user.click(screen.getByRole("button", { name: "Descartar" }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0][1]).toMatchObject({ accion: "descartar", motivo: "vencido" });
  });

  it("si el servidor rechaza, lo dice y no borra la pantalla", async () => {
    const user = userEvent.setup({ delay: null });
    api.put.mockRejectedValueOnce({ response: { data: { error: "Poné por qué se descarta." } } });
    const fila = await abrirRevision(user);
    await user.click(screen.getByRole("button", { name: "Descartar" }));

    expect(await screen.findByText("Poné por qué se descarta.")).toBeTruthy();
    expect(screen.getByText("DETERGENTE KAZARO X 5 LTS")).toBeTruthy();
  });

  it("después de mover, recarga la lista", async () => {
    const user = userEvent.setup({ delay: null });
    const fila = await abrirRevision(user);
    const antes = api.get.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Al stock" }));
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(antes));
  });

  it("sin remanentes lo dice y no muestra los contadores", async () => {
    api.get.mockResolvedValue({ data: { rows: [], unidades: 0, monto: 0 } });
    render(<RemanentesDeposito />);
    expect(await screen.findByText("No hay nada en remanentes.")).toBeTruthy();
    expect(screen.queryByText("unidades en remanentes")).toBeNull();
  });

  it("se puede cancelar sin tocar nada", async () => {
    const user = userEvent.setup({ delay: null });
    const fila = await abrirRevision(user);
    await user.click(within(fila).getByRole("button", { name: "Cancelar" }));
    expect(within(fila).getByRole("button", { name: "Revisar" })).toBeTruthy();
    expect(api.put).not.toHaveBeenCalled();
  });
});
