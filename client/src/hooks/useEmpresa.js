// client/src/hooks/useEmpresa.js  ← ARCHIVO NUEVO
import { useContext } from "react";
import { EmpresaContext } from "../context/empresa-context";

export function useEmpresa() {
  return useContext(EmpresaContext);
}