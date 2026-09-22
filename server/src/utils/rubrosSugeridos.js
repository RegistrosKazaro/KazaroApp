// server/src/utils/rubrosSugeridos.js
//
// Sugerencia de rubro para un insumo que todavía no está clasificado.
//
// Es sólo una ayuda para clasificar rápido: la pantalla la muestra como
// "sugerido" y no cuenta para ningún servicio hasta que alguien la confirma.
// Por eso puede equivocarse sin romper nada. Devuelve el NOMBRE del rubro (o
// null si no sabe); si ese rubro fue renombrado o borrado, simplemente no hay
// sugerencia.
//
// El criterio (el mismo que se muestra en cada rubro):
//   Limpieza      → lo que usa el operario para limpiar: químicos y elementos.
//   Descartables  → lo que se repone para quien usa el lugar y se gasta con el
//                   uso: papeles, jabón de manos, alcohol, aromatizadores,
//                   insecticida, filtros urinales, bolsas de residuo.
//   Dispenser     → equipamiento que queda instalado: dispensers, cestos y
//                   contenedores de residuos.
//   Extras        → lo que sólo usan algunos servicios: discos de máquina,
//                   pileta, control de plagas, espacios verdes, mantenimiento.
//   Uniformes y EPP → ropa, calzado y protección personal.

const REGLAS = [
  // Uniformes y EPP primero: "GUANTE DESCARTABLE" es EPP, no un descartable.
  [/^(AMBO|BOTAS|BOTIN|BUZO|CAMISA|CAMPERA|CHAQUETA|CHOMBA|GORRA|MAMELUCO|PANTALON|PARKA|REMERA|ROMPEVIENTO|SWEATER|ZAPATOS)/, "Uniformes y EPP"],
  [/^(BARBIJO|ANTEOJO|FILTRO SEMASK|DELANTAL|GUANTE (DE NITRILO|ALGOD|COMPOSTABLE|DESCARTABLE))/, "Uniformes y EPP"],

  [/DISPENSER|^CESTO|^CONTENDOR|^CONTENEDOR/, "Dispenser"],

  [/^PAPEL|^ROLLO DE (COCINA|MANO)|^TOALLA|MAXWIPE/, "Descartables"],
  [/^JABON LIQUIDO DE MANOS|^JABON LIQ |POWER HAND|^JABON TOCADOR/, "Descartables"],
  [/^ALCOHOL|^REPUESTO AROMATIZADOR|^INSECTICIDA|^FILTRO URINAL|^REPUESTO INODORO|^BOLSA /, "Descartables"],

  [/^DISCO /, "Extras"],
  [/^DES |^NAFTALINA/, "Extras"],                                            // control de plagas
  [/^ALGUICIDA|^CLARIFICADOR|^PASTILLA SIMPLE|^CLORO EN POLVO/, "Extras"],   // pileta
  [/^ACEITE|MOTOGUADA|^TANZA|^TIJERA DE PODAR|^AZADA|^RASTRILLO/, "Extras"], // espacios verdes
  [/^PASTA ESMERIL|^SLIME|^GARRAFA/, "Extras"],                              // mantenimiento

  [/^(CERA|CLORO|CLORONDINA|DESENG|DESINFECTANTE|DESODORANTE DE AMBIENTE|DETERGENTE|LIMPIA|LIQUIDO|LUSTRA|PERFUMINA|REMOVEDOR|SELLADOR|JABON DE LAVAR|GUANTE LATEX)/, "Limpieza"],
  [/^(ACOPLE|ARMAZON|BALDE|BARRENDERO|BRUJA|CABO|CARRO|CARTEL|CEPILLO|CORDERITO|ESCOBA|ESCOBILL|ESPATULA|ESPONJA|EXTENSIBLE|FIBRA|FRANELA|GATILLO|MANIVELA|MOPA|MOPIN|PALA|PASA CERA|PAÑO|PLUMERO|RASPIN|REJILLA|REPUESTO|SECADOR|SOPAPA|SUJETA|TRAPO|VIRULANA|ZOCALERO)/, "Limpieza"],
];

const CATEGORIA_A_RUBRO = { uniformes: "Uniformes y EPP", epp: "Uniformes y EPP" };

export function sugerirRubro(nombre, categoria = "") {
  const cat = CATEGORIA_A_RUBRO[String(categoria || "").trim().toLowerCase()];
  if (cat) return cat;
  const n = String(nombre || "").trim().toUpperCase();
  if (!n) return null;
  const r = REGLAS.find(([re]) => re.test(n));
  return r ? r[1] : null;
}
