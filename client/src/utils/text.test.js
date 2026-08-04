import { describe, it, expect } from "vitest";
import { normalizeText } from "./text";

describe("normalizeText", () => {
  it("pasa a minúsculas y saca acentos", () => {
    expect(normalizeText("CAMIÓN")).toBe("camion");
    expect(normalizeText("José")).toBe("jose");
  });
  it("recorta y colapsa espacios", () => {
    expect(normalizeText("  José   Pérez  ")).toBe("jose perez");
    expect(normalizeText("a\t b")).toBe("a b");
  });
  it("trata null/undefined como cadena vacía", () => {
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(undefined)).toBe("");
  });
  it("sirve para comparar búsquedas con y sin acento", () => {
    expect(normalizeText("Almacén")).toBe(normalizeText("almacen "));
  });
});
