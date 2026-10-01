// Devoluciones del depósito: se busca por remito, se ponen las cantidades que
// volvieron y se registra en el momento.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../api/client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { api } from "../api/client";
import DevolucionesDeposito from "./DevolucionesDeposito";

const REMITO = {
  ok: true,
  pedido: { id: 1186, numero: "0001186", servicio: "HOSPITAL EVA PERON" },
  items: [
    { productoId: "10", nombre: "BOLSA NEGRA 80*100", codigo: "004", entregado: 500, devuelto: 0, disponible: 500, retornable: false },
    { productoId: "20", nombre: "TACHO 120 LTS C/RUEDAS", codigo: "231", entregado: 2, devuelto: 0, disponible: 2, retornable: true },
    { productoId: "30", nombre: "PAPEL HIGIENICO", codigo: "092", entregado: 10, devuelto: 10, disponible: 0, retornable: false },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((url) => {
    if (url === "/deposito/devoluciones") return Promise.resolve({ data: { rows: [] } });
    if (url.includes("/deposito/devoluciones/remito/")) return Promise.resolve({ data: REMITO });
    return Promise.resolve({ data: {} });
  });
  api.post.mockResolvedValue({ data: { ok: true, remito: "0001186", unidadesDescontadas: 200, unidadesRetornables: 2 } });
});

const buscar = async (user, numero = "0001186") => {
  render(<DevolucionesDeposito />);
  await user.type(screen.getByLabelText("Número de remito"), numero);
  await user.click(screen.getByRole("button", { name: "Buscar" }));
  return await screen.findByText(/Remito #0001186/);
};

describe("Devoluciones del depósito", () => {
  it("busca por número de remito y muestra lo entregado", async () => {
    const user = userEvent.setup({ delay: null });
    await buscar(user);
    // El número va tal cual lo tipean, con ceros y todo: el servidor lo limpia.
    expect(api.get).toHaveBeenCalledWith("/deposito/devoluciones/remito/0001186");
    expect(screen.getByText("HOSPITAL EVA PERON")).toBeInTheDocument();
    expect(screen.getByLabelText(/Cantidad que vuelve de BOLSA NEGRA/)).toBeInTheDocument();
    // Lo que ya se devolvió entero no se ofrece de nuevo.
    expect(screen.queryByLabelText(/Cantidad que vuelve de PAPEL HIGIENICO/)).not.toBeInTheDocument();
  });

  it("marca los insumos que van y vuelven", async () => {
    const user = userEvent.setup({ delay: null });
    await buscar(user);
    const fila = screen.getByText("TACHO 120 LTS C/RUEDAS").closest(".dev-fila");
    expect(within(fila).getByText("va y vuelve")).toBeInTheDocument();
  });

  it("no deja cargar más de lo que se entregó", async () => {
    const user = userEvent.setup({ delay: null });
    await buscar(user);
    const campo = screen.getByLabelText(/Cantidad que vuelve de BOLSA NEGRA/);
    await user.type(campo, "900");
    expect(campo).toHaveValue("500");
  });

  it("registra la devolución y cuenta qué se descuenta y qué no", async () => {
    const user = userEvent.setup({ delay: null });
    await buscar(user);
    await user.type(screen.getByLabelText(/Cantidad que vuelve de BOLSA NEGRA/), "200");
    await user.type(screen.getByLabelText(/Cantidad que vuelve de TACHO/), "2");
    await user.click(screen.getByRole("button", { name: "Registrar devolución" }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe("/deposito/devoluciones");
    expect(body.pedidoId).toBe(1186);
    expect(body.items).toEqual(expect.arrayContaining([
      { productoId: "10", cantidad: 200 },
      { productoId: "20", cantidad: 2 },
    ]));
    expect(await screen.findByText(/Se le descuentan 200 al consumo del servicio/)).toBeInTheDocument();
    expect(screen.getByText(/2 son de los que van y vuelven: siguen contando como usadas/)).toBeInTheDocument();
  });

  it("si el remito no se retiró, muestra el aviso del servidor", async () => {
    const user = userEvent.setup({ delay: null });
    api.get.mockImplementation((url) => {
      if (url === "/deposito/devoluciones") return Promise.resolve({ data: { rows: [] } });
      return Promise.reject({ response: { data: { error: "El remito #0001186 todavía no se retiró, así que no hay nada para devolver." } } });
    });
    render(<DevolucionesDeposito />);
    await user.type(screen.getByLabelText("Número de remito"), "1186");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByText(/todavía no se retiró/)).toBeInTheDocument();
  });

  it("sin cantidades no deja registrar", async () => {
    const user = userEvent.setup({ delay: null });
    await buscar(user);
    expect(screen.getByRole("button", { name: "Registrar devolución" })).toBeDisabled();
    expect(api.post).not.toHaveBeenCalled();
  });
});
