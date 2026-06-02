// client/src/context/empresa-context.js  ← ARCHIVO NUEVO
import { createContext } from "react";

export const EmpresaContext = createContext({
  empresa: null,
  setEmpresa: () => {},
});