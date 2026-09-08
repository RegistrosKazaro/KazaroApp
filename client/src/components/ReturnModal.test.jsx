import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../api/client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
import { api } from "../api/client";
import ReturnModal from "./ReturnModal";

const items = [
  { productId: 5, name: "Guantes de nitrilo", code: "GN-1", pedido: 8, devuelto: 3, disponible: 5 },
  { productId: 9, name: "Lampazo", code: "LP-2", pedido: 4, devuelto: 0, disponible: 4 },
  { productId: 12, name: "Cera roja", code: "CR-3", pedido: 2, devuelto: 2, disponible: 0 },
];

const pedido = { id: 74, servicioNombre: "HOSPITAL ZONAL DE OLIVA" };

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: { items } });
  api.post.mockResolvedValue({ data: { ok: true, enviadas: 1 } });
});

/** Marca un insumo y le pone una cantidad. */
async function marcar(user, nombre, cantidad) {
  await user.click(screen.getByRole("checkbox", { name: new RegExp(nombre, "i") }));
  fireEvent.change(screen.getByLabelText(`Cantidad a devolver de ${nombre}`), {
    target: { value: String(cantidad) },
  });
}

describe("ReturnModal", () => {
  it("muestra el número de pedido y el nombre completo del servicio", async () => {
    render(<ReturnModal order={pedido} onClose={() => {}} onDone={() => {}} />);
    expect(await screen.findByText(/Pedido #0000074/)).toBeInTheDocument();
    expect(screen.getByText("HOSPITAL ZONAL DE OLIVA")).toBeInTheDocument();
  });

  it("lista sólo los insumos que todavía se pueden devolver", async () => {
    render(<ReturnModal order={pedido} onClose={() => {}} onDone={() => {}} />);
    expect(await screen.findByText("Guantes de nitrilo")).toBeInTheDocument();
    expect(screen.getByText("Lampazo")).toBeInTheDocument();
    // El que ya se devolvió entero queda en el desplegable de "ya devueltos".
    expect(screen.getByText(/Ya devueltos \(1\)/)).toBeInTheDocument();
  });

  it("no deja enviar sin marcar ningún insumo", async () => {
    render(<ReturnModal order={pedido} onClose={() => {}} onDone={() => {}} />);
    await screen.findByText("Guantes de nitrilo");
    expect(screen.getByRole("button", { name: /Enviar devolución/i })).toBeDisabled();
    expect(screen.getByText(/Ningún insumo marcado/i)).toBeInTheDocument();
  });

  it("exige un motivo antes de poder enviar", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ReturnModal order={pedido} onClose={() => {}} onDone={() => {}} />);
    await screen.findByText("Guantes de nitrilo");
    await marcar(user, "Guantes de nitrilo", 2);
    // Con insumo marcado pero sin motivo, sigue bloqueado.
    expect(screen.getByRole("button", { name: /Enviar devolución/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Sobrante" }));
    expect(screen.getByRole("button", { name: /Enviar devolución/i })).toBeEnabled();
  });

  it("clampea la cantidad al máximo devolvible", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ReturnModal order={pedido} onClose={() => {}} onDone={() => {}} />);
    await screen.findByText("Guantes de nitrilo");
    await marcar(user, "Guantes de nitrilo", 99);
    expect(screen.getByLabelText("Cantidad a devolver de Guantes de nitrilo")).toHaveValue(5);
  });

  it("envía varios insumos en una sola devolución", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ReturnModal order={pedido} onClose={() => {}} onDone={() => {}} />);
    await screen.findByText("Guantes de nitrilo");
    await marcar(user, "Guantes de nitrilo", 2);
    await marcar(user, "Lampazo", 3);
    await user.click(screen.getByRole("button", { name: "Sobrante" }));
    expect(screen.getByText(/2 insumos · 5 unidades/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Enviar devolución/i }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/orders/returns", {
        pedidoId: 74,
        items: [
          { productoId: 5, cantidad: 2, motivo: "Sobrante" },
          { productoId: 9, cantidad: 3, motivo: "Sobrante" },
        ],
      })
    );
  });

  it("el botón 'todo' pone el máximo devolvible", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ReturnModal order={pedido} onClose={() => {}} onDone={() => {}} />);
    await screen.findByText("Guantes de nitrilo");
    await user.click(screen.getByRole("checkbox", { name: /Guantes de nitrilo/i }));
    await user.click(screen.getAllByRole("button", { name: "todo" })[0]);
    expect(screen.getByLabelText("Cantidad a devolver de Guantes de nitrilo")).toHaveValue(5);
  });
});
