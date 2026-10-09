// Pantalla del mapeo servicio -> depósito de Flexxus.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../api/client", () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

import { api } from "../api/client";
import FlexxusDepositos from "./FlexxusDepositos";

const MAPEO = {
  ok: true,
  rows: [
    { servicioId: 412, servicio: "MIN. EDUC - ZONA SANTA MARIA", zona: "SANTA MARIA",
      grupo: "MINISTERIO DE EDUCACION", pedidos: 9, codigo: "722",
      deposito: "MIN. EDUC - ZONA SANTA MARIA", origen: "confirmado", motivo: null, estado: "mapeado" },
    { servicioId: 485, servicio: "UEPC - Sede Administrativa", zona: "CBA", grupo: "PRIVADOS",
      pedidos: 5, codigo: null, deposito: null, origen: "confirmado",
      motivo: "No existe en Flexxus.", estado: "sin_deposito" },
    { servicioId: 53, servicio: "CLUB ATLETICO BELGRANO - PREDIO SOCIAL Y FAMILIAR", zona: "CBA",
      grupo: "CLUBES", pedidos: 6, codigo: null, deposito: null, origen: null,
      motivo: null, estado: "sin_mapear" },
  ],
  resumen: { total: 2, conDeposito: 1, sinDeposito: 1, confirmados: 2, sinMapear: 1 },
  compartidos: [],
};

const COLA = { ok: true, rows: [], resumen: { pendiente: 0, enviando: 0, enviado: 0, error: 0, sin_mapeo: 0, total: 0 } };

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((url) => {
    if (url === "/admin/flexxus/outbox") return Promise.resolve({ data: COLA });
    return Promise.resolve({ data: MAPEO });
  });
  api.put.mockResolvedValue({ data: { ok: true, servicioId: 53, codigoDeposito: "652", reencolados: 0 } });
  api.post.mockResolvedValue({ data: { ok: true, asignados: 34, sinDeposito: 1, respetados: 0, errores: [] } });
});

const pintar = async () => {
  render(<FlexxusDepositos />);
  // "Mapeado" es único; el nombre del servicio puede repetirse en la cola.
  return await screen.findByText("Mapeado");
};

describe("Depósitos de Flexxus", () => {
  it("muestra cada servicio con su depósito y su estado", async () => {
    await pintar();
    const fila = screen.getByText("MIN. EDUC - ZONA SANTA MARIA").closest(".t-row");
    expect(within(fila).getByText("722")).toBeInTheDocument();
    expect(within(fila).getByText("Mapeado")).toBeInTheDocument();
    expect(within(fila).getByText(/confirmado a mano/)).toBeInTheDocument();
  });

  it("distingue 'no está en Flexxus' de 'sin mapear'", async () => {
    await pintar();
    const uepc = screen.getByText("UEPC - Sede Administrativa").closest(".t-row");
    expect(within(uepc).getByText("No está en Flexxus")).toBeInTheDocument();
    expect(within(uepc).getByText("No existe en Flexxus.")).toBeInTheDocument();

    const belgrano = screen.getByText(/PREDIO SOCIAL Y FAMILIAR/).closest(".t-row");
    expect(within(belgrano).getByText("Sin mapear")).toBeInTheDocument();
  });

  it("arranca mostrando sólo los que piden", async () => {
    await pintar();
    expect(screen.getByLabelText(/Solo los que piden/i, { selector: "input" }) ||
           screen.getByRole("checkbox")).toBeChecked();
    const [, params] = api.get.mock.calls.find((c) => c[0] === "/admin/flexxus/depositos");
    expect(params.params.soloConPedidos).toBe("1");
  });

  it("filtra por estado", async () => {
    const user = userEvent.setup({ delay: null });
    await pintar();
    await user.selectOptions(screen.getByLabelText("Filtrar por estado"), "sin_mapear");
    await waitFor(() => {
      const ultima = api.get.mock.calls.filter((c) => c[0] === "/admin/flexxus/depositos").at(-1);
      expect(ultima[1].params.estado).toBe("sin_mapear");
    });
  });

  it("asigna un depósito a mano", async () => {
    const user = userEvent.setup({ delay: null });
    await pintar();
    const fila = screen.getByText(/PREDIO SOCIAL Y FAMILIAR/).closest(".t-row");
    await user.click(within(fila).getByRole("button", { name: "Editar" }));

    await user.type(screen.getByLabelText(/Código de depósito de CLUB ATLETICO BELGRANO/), "652");
    await user.type(screen.getByLabelText(/Nombre del depósito de CLUB ATLETICO BELGRANO/), "PREDIO SALDAN");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const [url, body] = api.put.mock.calls[0];
    expect(url).toBe("/admin/flexxus/depositos/53");
    expect(body.codigo).toBe("652");
    expect(body.deposito).toBe("PREDIO SALDAN");
  });

  it("sin código no deja guardar", async () => {
    const user = userEvent.setup({ delay: null });
    await pintar();
    const fila = screen.getByText(/PREDIO SOCIAL Y FAMILIAR/).closest(".t-row");
    await user.click(within(fila).getByRole("button", { name: "Editar" }));
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("se puede marcar que un servicio no existe en Flexxus", async () => {
    const user = userEvent.setup({ delay: null });
    await pintar();
    const fila = screen.getByText(/PREDIO SOCIAL Y FAMILIAR/).closest(".t-row");
    await user.click(within(fila).getByRole("button", { name: "Editar" }));
    await user.click(screen.getByRole("button", { name: "No está en Flexxus" }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const [, body] = api.put.mock.calls[0];
    expect(body.codigo).toBe(null);
    expect(body.motivo).toMatch(/No existe en Flexxus/);
  });

  it("avisa cuando se reencolan movimientos que esperaban", async () => {
    const user = userEvent.setup({ delay: null });
    api.put.mockResolvedValue({ data: { ok: true, codigoDeposito: "652", reencolados: 3 } });
    await pintar();
    const fila = screen.getByText(/PREDIO SOCIAL Y FAMILIAR/).closest(".t-row");
    await user.click(within(fila).getByRole("button", { name: "Editar" }));
    await user.type(screen.getByLabelText(/Código de depósito de CLUB ATLETICO BELGRANO/), "652");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText(/Se reencolaron 3 movimiento/)).toBeInTheDocument();
  });

  it("si el servidor rechaza, lo muestra y no se pierde el dato", async () => {
    const user = userEvent.setup({ delay: null });
    api.put.mockRejectedValue({ response: { data: { error: "Servicio no encontrado" } } });
    await pintar();
    const fila = screen.getByText(/PREDIO SOCIAL Y FAMILIAR/).closest(".t-row");
    await user.click(within(fila).getByRole("button", { name: "Editar" }));
    await user.type(screen.getByLabelText(/Código de depósito de CLUB ATLETICO BELGRANO/), "652");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Servicio no encontrado")).toBeInTheDocument();
  });

  it("avisa de los depósitos compartidos por varios servicios", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/admin/flexxus/outbox") return Promise.resolve({ data: COLA });
      return Promise.resolve({ data: { ...MAPEO, compartidos: [{ codigo: "697", cuantos: 3, servicios: "1,2,3" }] } });
    });
    await pintar();
    expect(await screen.findByText(/697 \(3\)/)).toBeInTheDocument();
  });

  it("muestra la cola cuando hay movimientos", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/admin/flexxus/outbox") {
        return Promise.resolve({ data: {
          ok: true,
          rows: [{ id: 1, pedidoId: 1053, servicio: "MIN. EDUC - ZONA SANTA MARIA", tipo: "salida",
                   estado: "pendiente", intentos: 0, ultimoError: null, numeroMovimiento: null }],
          resumen: { pendiente: 1, enviando: 0, enviado: 0, error: 0, sin_mapeo: 0, total: 1 },
        } });
      }
      return Promise.resolve({ data: MAPEO });
    });
    await pintar();
    expect(await screen.findByText("#0001053")).toBeInTheDocument();
    expect(screen.getByText("Entrega")).toBeInTheDocument();
  });

  it("si falla la carga, lo dice", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/admin/flexxus/outbox") return Promise.resolve({ data: COLA });
      return Promise.reject({ response: { data: { error: "No se pudo leer el mapeo de depósitos" } } });
    });
    render(<FlexxusDepositos />);
    expect(await screen.findByText("No se pudo leer el mapeo de depósitos")).toBeInTheDocument();
  });
});
