// server/src/db_multiempresa_patch.js
import { db } from "./db.js";

function tinfo(table) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all(); }
  catch { return []; }
}

function pickCol(info, candidates) {
  const names = info.map(c => c.name);
  for (const cand of candidates) {
    const hit = names.find(n => n.toLowerCase() === cand.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

export function getUserForLoginWithEmpresa(userOrEmailInput, empresaId) {
  try {
    const eInfo = tinfo("Empleados");
    if (!eInfo.length) return null;

    const idCol =
      eInfo.find((c) => c.pk === 1)?.name ||
      pickCol(eInfo, ["EmpleadosID","EmpleadoID","IdEmpleado","empleado_id","id"]) ||
      "EmpleadosID";

    const userCol  = pickCol(eInfo, ["username","user","usuario","Usuario"]);
    const emailCol = pickCol(eInfo, ["email","Email","correo","Correo"]);
    const hashCol  = pickCol(eInfo, ["password_hash","hash","pass_hash","PasswordHash"]);
    const plainCol = pickCol(eInfo, ["password_plain","password","contrasena","contraseña","clave","pass","Password"]);
    const activeCol= pickCol(eInfo, ["is_active","activo","Activo","enabled","estado"]);

    if (!userCol && !emailCol) return null;

    const hasEmpresaCol = eInfo.some((c) => c.name === "empresa_id");

    const whereParts = [];
    const params = [];
    if (userCol)  { whereParts.push(`LOWER(TRIM(${userCol}))  = LOWER(TRIM(?))`); params.push(userOrEmailInput); }
    if (emailCol) { whereParts.push(`LOWER(TRIM(${emailCol})) = LOWER(TRIM(?))`); params.push(userOrEmailInput); }

    // Se siguen aceptando filas con empresa_id NULL para no dejar afuera a nadie
    // que hoy pueda entrar, pero el ORDER BY de abajo prioriza la coincidencia
    // exacta de empresa: con el mismo username en Kazaro y Pazar, gana el de la
    // empresa elegida y la fila NULL sólo se usa si no hay match exacto.
    const empresaFilter = hasEmpresaCol ? `AND (empresa_id = ? OR empresa_id IS NULL)` : "";
    if (hasEmpresaCol) params.push(empresaId);

    // Desempate, en orden: 1) la empresa elegida antes que una fila con empresa_id
    // NULL, 2) match por username antes que por email, 3) el id más bajo, para que
    // el resultado sea siempre determinista.
    const orderParts  = [];
    const orderParams = [];
    if (hasEmpresaCol) {
      orderParts.push(`CASE WHEN empresa_id = ? THEN 0 ELSE 1 END`);
      orderParams.push(empresaId);
    }
    if (userCol) {
      orderParts.push(`CASE WHEN LOWER(TRIM(${userCol})) = LOWER(TRIM(?)) THEN 0 ELSE 1 END`);
      orderParams.push(userOrEmailInput);
    }
    orderParts.push(idCol);

    const sql = `
      SELECT
        ${idCol} AS id,
        TRIM(COALESCE(${userCol || "NULL"}, ${emailCol || "NULL"})) AS username,
        TRIM(${emailCol || "''"}) AS email,
        ${hashCol  ? `TRIM(${hashCol})`  : "NULL"} AS password_hash,
        ${plainCol ? `TRIM(${plainCol})` : "NULL"} AS password_plain,
        ${activeCol ? activeCol : "1"}             AS is_active
        ${hasEmpresaCol ? ", empresa_id" : ""}
      FROM Empleados
      WHERE (${whereParts.join(" OR ")})
      ${empresaFilter}
      ORDER BY ${orderParts.join(", ")}
      LIMIT 1
    `;
    return db.prepare(sql).get(...params, ...orderParams);
  } catch {
    return null;
  }
}

export function getEmpresaIdForUser(userId) {
  try {
    const eInfo = tinfo("Empleados");
    const hasCol = eInfo.some((c) => c.name === "empresa_id");
    if (!hasCol) return null;
    const row = db.prepare("SELECT empresa_id FROM Empleados WHERE EmpleadosID = ? LIMIT 1").get(userId);
    return row?.empresa_id ?? null;
  } catch {
    return null;
  }
}