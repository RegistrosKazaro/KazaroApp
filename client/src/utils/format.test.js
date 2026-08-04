import { describe, it, expect } from "vitest";
import { formatMoney, formatNumber } from "./format";

// Normaliza espacios (Intl usa espacios no separables entre $ y el número).
const norm = (s) => String(s).replace(/\s+/g, " ").trim();

describe("formatMoney", () => {
  it("formatea ARS con 2 decimales", () => {
    expect(norm(formatMoney(1234.5))).toBe("$ 1.234,50");
  });
  it("redondea a 2 decimales", () => {
    expect(norm(formatMoney(1234.567))).toBe("$ 1.234,57");
  });
  it("trata null/undefined/'' como 0", () => {
    expect(norm(formatMoney(null))).toBe("$ 0,00");
    expect(norm(formatMoney(undefined))).toBe("$ 0,00");
    expect(norm(formatMoney(""))).toBe("$ 0,00");
  });
  it("maneja negativos", () => {
    expect(norm(formatMoney(-250.4))).toBe("-$ 250,40");
  });
});

describe("formatNumber", () => {
  it("agrega separador de miles", () => {
    expect(formatNumber(1000)).toBe("1.000");
    expect(formatNumber(1234567)).toBe("1.234.567");
  });
  it("trata null/''/0 como 0", () => {
    expect(formatNumber(null)).toBe("0");
    expect(formatNumber("")).toBe("0");
    expect(formatNumber(0)).toBe("0");
  });
});
