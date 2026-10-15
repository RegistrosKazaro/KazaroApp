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
    { productoId: "40", nombre: "DETERGENTE KAZARO X 5 LTS", codigo: "100000032", entregado: 3, devuelto: 0, disponible: 3, retornable: false, preguntaEstado: 1 },
    // Herramienta: otra pregunta, misma mecánica.
    { productoId: "50", nombre: "JARRA MEDIDORA 1 LTS", codigo: "01481", entregado: 2, devuelto: 0, disponible: 2, retornable: false, preguntaEstado: 2 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((url) => {
    if (url === "/deposito/devoluciones") return Promise.resolve({ data: { rows: [] } });
    if (url.includes("/deposito/devoluciones/remito/")) return Promise.resolve({ data: REMITO });
    return Promise.resolve({ data: {} });
  });
  api.post.mockResolvedValue({ data: { ok: true, remito: "0001186", unidadesDescontadas: 200, unidadesRetornables: 2,
    devueltos: [
      { productoId: "10", nombre: "BOLSA NEGRA 80*100", cantidad: 200, retornable: false },
      { productoId: "20", nombre: "TACHO 120 LTS C/RUEDAS", cantidad: 2, retornable: true },
    ] } });
});

const buscar = async (user, numero = "0001186") => {
  render(<DevolucionesDeposito />);
  await user.type(screen.getByLabelText("Número de remito"), numero);
  await user.click(screen.getByRole("button", { name: "Buscar remito" }));
  return await screen.findByText(/Remito #0001186/);
};

describe("Devoluciones del depósito", () => {
  it("busca por número de remito y muestra lo entregado", async () => {
    const user = userEvent.setup({ delay: null });
    await buscar(user);
    // El número va tal cual lo tipean, con ceros y todo: el servidor lo limpia.
    expect(api.get).toHaveBeenCalledWith("/deposito/devoluciones/remito/0001186");
    expect(screen.getByText(/HOSPITAL EVA PERON/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Cantidad que vuelve de BOLSA NEGRA/)).toBeInTheDocument();
    // Lo que ya se devolvió entero no se ofrece de nuevo.
    expect(screen.queryByLabelText(/Cantidad que vuelve de PAPEL HIGIENICO/)).not.toBeInTheDocument();
  });

  it("marca los insumos que van y vuelven", async () => {
    const user = userEvent.setup({ delay: null });
    await buscar(user);
    const fila = screen.getByText("TACHO 120 LTS C/RUEDAS").closest("tr");
    expect(within(fila).getByText("va y vuelve")).toBeInTheDocument();
  });

  it("no deja cargar más de lo que se entregó", async () => {
    const user = userEvent.setup({ delay: null });
    await buscar(user);
    const campo = screen.getByLabelText(/Cantidad que vuelve de BOLSA NEGRA/);
    await user.type(campo, "900");
    expect(campo).toHaveValue("500");
  });

  it("antes de confirmar dice qué va a pasar", async () => {
    const user = userEvent.setup({ delay: null });
    await buscar(user);
    await user.type(screen.getByLabelText(/Cantidad que vuelve de BOLSA NEGRA/), "200");
    await user.type(screen.getByLabelText(/Cantidad que vuelve de TACHO/), "2");
    // El resumen arma el texto con varios pedazos: se mira el párrafo entero.
    const resumen = document.querySelector(".dev-efecto").textContent;
    expect(resumen).toMatch(/Vuelven 202 unidades al stock/);
    expect(resumen).toMatch(/se le descuentan 200 al consumo del servicio/);
    expect(resumen).toMatch(/2 de los que van y vuelven: el consumo no cambia/);
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
    expect(await screen.findByText(/Devolución registrada — remito #0001186/)).toBeInTheDocument();
    const hecho = document.querySelector(".dev-hecho").textContent;
    expect(hecho).toMatch(/200 BOLSA NEGRA 80\*100 — volvió al stock y se le descuenta al servicio/);
    expect(hecho).toMatch(/2 TACHO 120 LTS C\/RUEDAS — volvió al stock y sigue contando como usado/);
  });

  it("si el remito no se retiró, muestra el aviso del servidor", async () => {
    const user = userEvent.setup({ delay: null });
    api.get.mockImplementation((url) => {
      if (url === "/deposito/devoluciones") return Promise.resolve({ data: { rows: [] } });
      return Promise.reject({ response: { data: { error: "El remito #0001186 todavía no se retiró, así que no hay nada para devolver." } } });
    });
    render(<DevolucionesDeposito />);
    await user.type(screen.getByLabelText("Número de remito"), "1186");
    await user.click(screen.getByRole("button", { name: "Buscar remito" }));
    expect(await screen.findByText(/todavía no se retiró/)).toBeInTheDocument();
  });

  it("sin cantidades no deja registrar", async () => {
    const user = userEvent.setup({ delay: null });
    await buscar(user);
    expect(screen.getByRole("button", { name: "Registrar devolución" })).toBeDisabled();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe("¿Cuánto queda? (líquidos)", () => {
  it("sólo pregunta en los insumos marcados, y recién al cargar una cantidad", async () => {
    const user = userEvent.setup({ delay: null });
    await buscar(user);
    // Antes de poner cantidad no hay pregunta.
    expect(screen.queryByLabelText(/Cuánto queda de DETERGENTE/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/Cantidad que vuelve de DETERGENTE/), "2");
    expect(screen.getByLabelText(/Cuánto queda de DETERGENTE/)).toBeInTheDocument();

    // A la bolsa, que no está marcada, no se le pregunta nunca.
    await user.type(screen.getByLabelText(/Cantidad que vuelve de BOLSA NEGRA/), "100");
    expect(screen.queryByLabelText(/Cuánto queda de BOLSA NEGRA/)).not.toBeInTheDocument();
  });

  /** Marca una de las tres opciones por su etiqueta, no por posición. */
  const marcar = async (user, etiqueta) =>
    user.click(within(screen.getByLabelText(/Cuánto queda de DETERGENTE/))
      .getByRole("radio", { name: etiqueta }));

  it("arranca en 'sin abrir', que es lo más frecuente", async () => {
    const user = userEvent.setup({ delay: null });
    await buscar(user);
    await user.type(screen.getByLabelText(/Cantidad que vuelve de DETERGENTE/), "2");
    const grupo = screen.getByLabelText(/Cuánto queda de DETERGENTE/);
    const opciones = within(grupo).getAllByRole("radio");
    expect(opciones).toHaveLength(3);
    expect(within(grupo).getByRole("radio", { name: "Sin abrir" })).toBeChecked();
    expect(within(grupo).getByRole("radio", { name: "Usado" })).not.toBeChecked();
  });

  // El caso que trababa los líquidos: un bidón de 5 litros al que le falta uno
  // está abierto, pero prácticamente entero. No se le puede cobrar entero.
  it("'más de ¾ lleno' se descuenta igual que si estuviera sin abrir", async () => {
    const user = userEvent.setup({ delay: null });
    await buscar(user);
    await user.type(screen.getByLabelText(/Cantidad que vuelve de DETERGENTE/), "2");
    await marcar(user, "Más de ¾ lleno");

    expect(document.querySelector(".dev-efecto").textContent)
      .toMatch(/se le descuentan 2 al consumo/);

    await user.click(screen.getByRole("button", { name: "Registrar devolución" }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = api.post.mock.calls[0];
    expect(body.items.find((i) => i.productoId === "40").estado).toBe("casi_lleno");
  });

  it("marcar 'usado' cambia lo que dice que va a pasar", async () => {
    const user = userEvent.setup({ delay: null });
    await buscar(user);
    await user.type(screen.getByLabelText(/Cantidad que vuelve de DETERGENTE/), "2");
    expect(document.querySelector(".dev-efecto").textContent)
      .toMatch(/se le descuentan 2 al consumo/);

    await marcar(user, "Usado");
    const resumen = document.querySelector(".dev-efecto").textContent;
    expect(resumen).toMatch(/2 se le cobran igual/);
    expect(resumen).toMatch(/2 a remanentes/);
    expect(resumen).not.toMatch(/se le descuentan 2 al consumo/);
  });

  it("'más de ¾' va a remanentes aunque se le descuente la plata", async () => {
    // Está abierto: físicamente es un remanente. Que se le devuelva la plata
    // al servicio es otra cosa.
    const user = userEvent.setup({ delay: null });
    await buscar(user);
    await user.type(screen.getByLabelText(/Cantidad que vuelve de DETERGENTE/), "2");
    await marcar(user, "Más de ¾ lleno");
    const resumen = document.querySelector(".dev-efecto").textContent;
    expect(resumen).toMatch(/2 a remanentes/);
    expect(resumen).toMatch(/se le descuentan 2 al consumo/);
  });

  it("manda el estado de cada línea, y sólo de las que corresponde", async () => {
    const user = userEvent.setup({ delay: null });
    await buscar(user);
    await user.type(screen.getByLabelText(/Cantidad que vuelve de DETERGENTE/), "2");
    await marcar(user, "Usado");
    await user.type(screen.getByLabelText(/Cantidad que vuelve de BOLSA NEGRA/), "100");
    await user.click(screen.getByRole("button", { name: "Registrar devolución" }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = api.post.mock.calls[0];
    const detergente = body.items.find((i) => i.productoId === "40");
    const bolsa = body.items.find((i) => i.productoId === "10");
    expect(detergente.estado).toBe("usado");
    expect(bolsa.estado).toBeUndefined();
  });

  it("si se deja en 'sin abrir', lo manda explícito", async () => {
    const user = userEvent.setup({ delay: null });
    await buscar(user);
    await user.type(screen.getByLabelText(/Cantidad que vuelve de DETERGENTE/), "3");
    await user.click(screen.getByRole("button", { name: "Registrar devolución" }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = api.post.mock.calls[0];
    expect(body.items.find((i) => i.productoId === "40").estado).toBe("sin_abrir");
  });

  it("a una herramienta se le pregunta el estado, no cuánto queda", async () => {
    const user = userEvent.setup({ delay: null });
    await buscar(user);
    await user.type(screen.getByLabelText(/Cantidad que vuelve de JARRA/), "2");

    const grupo = screen.getByLabelText(/En qué estado volvió JARRA/);
    const opciones = within(grupo).getAllByRole("radio");
    expect(opciones).toHaveLength(2);
    expect(within(grupo).getByRole("radio", { name: "En buen estado" })).toBeChecked();
    // Y no le ofrece las de los líquidos.
    expect(within(grupo).queryByRole("radio", { name: "Más de ¾ lleno" })).toBeNull();
  });

  it("la herramienta en buen estado se descuenta entera y va al stock", async () => {
    const user = userEvent.setup({ delay: null });
    await buscar(user);
    await user.type(screen.getByLabelText(/Cantidad que vuelve de JARRA/), "2");

    const resumen = document.querySelector(".dev-efecto").textContent;
    expect(resumen).toMatch(/se le descuentan 2 al consumo/);
    expect(resumen).not.toMatch(/remanentes/);

    await user.click(screen.getByRole("button", { name: "Registrar devolución" }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = api.post.mock.calls[0];
    expect(body.items.find((i) => i.productoId === "50").estado).toBe("buen_estado");
  });

  it("la herramienta rota se le cobra y va a remanentes", async () => {
    const user = userEvent.setup({ delay: null });
    await buscar(user);
    await user.type(screen.getByLabelText(/Cantidad que vuelve de JARRA/), "2");
    await user.click(within(screen.getByLabelText(/En qué estado volvió JARRA/))
      .getByRole("radio", { name: "Roto o inservible" }));

    const resumen = document.querySelector(".dev-efecto").textContent;
    expect(resumen).toMatch(/2 se le cobran igual/);
    expect(resumen).toMatch(/2 a remanentes/);

    await user.click(screen.getByRole("button", { name: "Registrar devolución" }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = api.post.mock.calls[0];
    expect(body.items.find((i) => i.productoId === "50").estado).toBe("roto");
  });

  it("al 'va y vuelve' no se le pregunta: ya se sabe que se usó", async () => {
    const user = userEvent.setup({ delay: null });
    await buscar(user);
    await user.type(screen.getByLabelText(/Cantidad que vuelve de TACHO/), "2");
    expect(screen.queryByLabelText(/Cuánto queda de TACHO/)).not.toBeInTheDocument();
  });
});
