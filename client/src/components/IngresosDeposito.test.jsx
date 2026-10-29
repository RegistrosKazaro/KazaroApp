// Ingreso de mercadería: la pantalla donde el stock sube.
//
// Lo que se vigila acá es el reparto de responsabilidades. El depósito carga lo
// que contó; compras factura. Las cantidades de la factura arrancan iguales a
// las del remito a propósito: si compras tiene que cambiar una, es porque hay
// una diferencia real, y entonces la pantalla tiene que decir cuál y cuánto, no
// un "no se pudo".
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../api/client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { api } from "../api/client";
import IngresosDeposito from "./IngresosDeposito";

const ROWS = [
  { id: 7, proveedor: "QUIMICA DEL SUR", numero: "R-00012345", fecha: "2026-10-28",
    estado: "cargado", lineas: 2, unidades: 60, facturaNumero: null },
];

const DETALLE = {
  id: 7, proveedor: "QUIMICA DEL SUR", numero: "R-00012345", fecha: "2026-10-28",
  estado: "cargado", observaciones: "", items: [
    { id: 101, productoId: 40, nombre: "DETERGENTE KAZARO X 5 LTS", codigo: "100000032", cantidad: 50, precioUnitario: null },
    { id: 102, productoId: 50, nombre: "JARRA MEDIDORA 1 LTS", codigo: "01481", cantidad: 10, precioUnitario: null },
  ],
};

const BUSQUEDA = [
  { id: 40, name: "DETERGENTE KAZARO X 5 LTS", code: "100000032", price: 5000, stock: 120 },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  api.get.mockImplementation((url) => {
    if (url === "/deposito/ingresos") return Promise.resolve({ data: { rows: ROWS } });
    if (url === "/deposito/productos") return Promise.resolve({ data: BUSQUEDA });
    return Promise.resolve({ data: DETALLE });
  });
  api.post.mockResolvedValue({ data: { ok: true, lineas: 2, unidades: 60 } });
});

/** Abre el panel de factura del único remito de la lista. */
const abrirFactura = async (user) => {
  render(<IngresosDeposito />);
  const fila = (await screen.findByText("QUIMICA DEL SUR")).closest("tr");
  await user.click(within(fila).getByRole("button", { name: "Conciliar" }));
  const titulo = await screen.findByText("Conciliar con la factura del proveedor");
  return titulo.closest(".deposito-items-panel");
};

describe("Ingreso de mercadería", () => {
  it("lista los remitos y marca los que esperan factura", async () => {
    render(<IngresosDeposito />);
    const fila = (await screen.findByText("QUIMICA DEL SUR")).closest("tr");

    expect(within(fila).getByText("R-00012345")).toBeTruthy();
    expect(within(fila).getByText("sin factura")).toBeTruthy();
    // La fecha es texto YYYY-MM-DD y se muestra tal cual: pasarla por Date la
    // corría un día por zona horaria.
    expect(within(fila).getByText("2026-10-28")).toBeTruthy();
  });

  it("arranca en los remitos sin facturar, que es el trabajo pendiente", async () => {
    render(<IngresosDeposito />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(
      "/deposito/ingresos", { params: { estado: "cargado" } }
    ));
  });

  it("al facturar, las cantidades arrancan iguales a las del remito", async () => {
    const user = userEvent.setup();
    const panel = await abrirFactura(user);

    // Si arrancaran vacías, compras tendría que recopiar el remito a mano y
    // cualquier dedazo pasaría por "diferencia con la factura".
    // Por fila hay dos campos: cantidad y precio.
    const campos = within(panel).getAllByRole("spinbutton");
    expect(campos[0].value).toBe("50");
    expect(campos[2].value).toBe("10");
  });

  it("asociar la factura manda lo que el servidor espera y avisa cuánto entró", async () => {
    const user = userEvent.setup();
    const panel = await abrirFactura(user);

    await user.type(screen.getByPlaceholderText("A-0001-00001234"), "A-0001-00009999");
    await user.click(within(panel).getByRole("button", { name: /Asociar factura/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe("/deposito/ingresos/7/factura");
    expect(body.numeroFactura).toBe("A-0001-00009999");
    expect(body.lineas).toEqual([
      { itemId: 101, cantidad: 50, precioUnitario: null },
      { itemId: 102, cantidad: 10, precioUnitario: null },
    ]);
    expect(await screen.findByText(/entraron 60 unidades/)).toBeTruthy();
  });

  it("el precio unitario que se escribe llega como número", async () => {
    const user = userEvent.setup();
    const panel = await abrirFactura(user);

    await user.type(screen.getByPlaceholderText("A-0001-00001234"), "A-1");
    const campos = within(panel).getAllByRole("spinbutton");
    await user.type(campos[1], "3450.5");   // precio de la primera línea
    await user.click(within(panel).getByRole("button", { name: /Asociar factura/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0][1].lineas[0].precioUnitario).toBe(3450.5);
  });

  it("no asocia sin número de factura", async () => {
    const user = userEvent.setup();
    const panel = await abrirFactura(user);

    expect(within(panel).getByRole("button", { name: /Asociar factura/ }).disabled).toBe(true);
  });

  it("pide confirmación antes de tocar el stock", async () => {
    const user = userEvent.setup();
    window.confirm.mockReturnValue(false);
    const panel = await abrirFactura(user);

    await user.type(screen.getByPlaceholderText("A-0001-00001234"), "A-1");
    await user.click(within(panel).getByRole("button", { name: /Asociar factura/ }));

    expect(window.confirm).toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("si el servidor rechaza por diferencia, dice en qué línea y cuánto", async () => {
    api.post.mockRejectedValue({
      response: { data: {
        error: "La factura no coincide con el remito en 1 línea(s)",
        diferencias: [{ itemId: 101, remito: 50, factura: 48 }],
      } },
    });
    const user = userEvent.setup();
    const panel = await abrirFactura(user);

    await user.type(screen.getByPlaceholderText("A-0001-00001234"), "A-1");
    await user.click(within(panel).getByRole("button", { name: /Asociar factura/ }));

    // Con el nombre del insumo, no con el id de la línea: el que lo lee está
    // mirando una factura de papel.
    expect(await screen.findByText(
      /DETERGENTE KAZARO X 5 LTS: el remito dice 50, la factura 48/
    )).toBeTruthy();
  });

  it("cargar un remito: busca el insumo, lo agrega y lo manda sin tocar el stock", async () => {
    const user = userEvent.setup();
    render(<IngresosDeposito />);
    await user.click(await screen.findByRole("button", { name: "Cargar remito" }));
    const panel = (await screen.findByText("Cargar un remito que ya controlaste"))
      .closest(".deposito-items-panel");

    await user.type(within(panel).getByLabelText("Proveedor"), "QUIMICA DEL SUR");
    await user.type(within(panel).getByLabelText("N° de remito"), "R-999");

    await user.type(within(panel).getByPlaceholderText(/Agregar insumo/), "deterg");
    await user.click(await screen.findByText("DETERGENTE KAZARO X 5 LTS"));

    const cantidad = within(panel).getByRole("spinbutton");
    await user.clear(cantidad);
    await user.type(cantidad, "50");
    await user.click(within(panel).getByRole("button", { name: "Cargar remito" }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0]).toEqual(["/deposito/ingresos", expect.objectContaining({
      proveedor: "QUIMICA DEL SUR", numero: "R-999",
      items: [{ productoId: 40, cantidad: 50 }],
    })]);
    expect(await screen.findByText(/El stock sube cuando se asocie la factura/)).toBeTruthy();
  });

  it("no deja cargar un remito sin insumos", async () => {
    const user = userEvent.setup();
    render(<IngresosDeposito />);
    await user.click(await screen.findByRole("button", { name: "Cargar remito" }));
    const panel = (await screen.findByText("Cargar un remito que ya controlaste"))
      .closest(".deposito-items-panel");

    await user.type(within(panel).getByLabelText("Proveedor"), "ALGUIEN");
    await user.type(within(panel).getByLabelText("N° de remito"), "R-1");

    expect(within(panel).getByRole("button", { name: "Cargar remito" }).disabled).toBe(true);
  });

  it("un remito ya facturado se ve, no se vuelve a facturar", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/deposito/ingresos") return Promise.resolve({ data: { rows: [
        { ...ROWS[0], estado: "facturado", facturaNumero: "A-0001-00009999" },
      ] } });
      return Promise.resolve({ data: { ...DETALLE, estado: "facturado",
        factura_numero: "A-0001-00009999",
        items: [{ ...DETALLE.items[0], precioUnitario: 3450.5 }] } });
    });
    const user = userEvent.setup();
    render(<IngresosDeposito />);
    const fila = (await screen.findByText("QUIMICA DEL SUR")).closest("tr");
    expect(within(fila).getByText("A-0001-00009999")).toBeTruthy();

    await user.click(within(fila).getByRole("button", { name: "Ver" }));

    expect(await screen.findByText(/el stock ya subió/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Asociar factura/ })).toBeNull();
  });
});
