// checkpoint.js
import Database from "better-sqlite3";
const db = new Database("./Kazaro.db"); // si la buena está en server/, cambiá la ruta
try {
  db.pragma("wal_checkpoint(FULL)");
  console.log("WAL checkpoint OK");
} catch (e) {
  console.error("Error:", e.message);
} finally {
  db.close();
}
