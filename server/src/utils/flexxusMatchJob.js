// server/src/utils/flexxusMatchJob.js
// Job que recalcula el matcheo de códigos Kazaro↔Pazar cada 3hs, lun-vie 8 a 20hs (hora Arg.)

import { recomputeFlexxusMatch } from "../db.js";

const TARGET_HOURS = [8, 11, 14, 17, 20];

function nowArgentina() {
  return new Date(Date.now() - 3 * 60 * 60 * 1000);
}

function shouldRunNow(d) {
  const day = d.getUTCDay(); // 1=lunes ... 5=viernes (offset ya aplicado en nowArgentina)
  const hour = d.getUTCHours();
  return day >= 1 && day <= 5 && TARGET_HOURS.includes(hour);
}

function tick(lastRunSlot) {
  const d = nowArgentina();
  if (!shouldRunNow(d)) return lastRunSlot;

  const slot = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`;
  if (lastRunSlot.value === slot) return lastRunSlot;
  lastRunSlot.value = slot;

  try {
    const result = recomputeFlexxusMatch("cron");
    console.log(`[flexxusMatchJob] Matcheo actualizado: ${result.total} códigos`);
  } catch (e) {
    console.error("[flexxusMatchJob] Error:", e?.message || e);
  }
  return lastRunSlot;
}

export function startFlexxusMatchJob() {
  console.log("[flexxusMatchJob] Iniciado — lun-vie 8/11/14/17/20hs (hora Arg.)");
  const lastRunSlot = { value: null };
  tick(lastRunSlot);
  setInterval(() => tick(lastRunSlot), 15 * 60 * 1000); // chequea cada 15 min
}
