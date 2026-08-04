# Sincronización de stock con Flexxus (andamiaje)

Estado: **preparado, sin conectar**. No hay ninguna ruta ni cron enganchado.
Nada se ejecuta ni escribe automáticamente. Esto queda listo para enchufar
cuando Flexxus entregue el endpoint y las credenciales.

## Idea

Flexxus expone una **API de solo consulta**. Traemos, por producto:
`código`, `nombre`, `stock` y `subdepósito` (= categoría en la app). Con eso
**alimentamos nuestro stock**. Aplica **solo a Kazaro** (empresa_id 1).

## Matcheo por código

Se compara por **código normalizado**: los numéricos pierden los ceros a la
izquierda, así `004` (Flexxus) matchea con `4` (app). Ver `normalizeCode`.
El usuario va a **corregir a mano** los códigos de la app para que coincidan;
la normalización es una red de seguridad extra.

Antes de activar en producción: correr un dry-run y revisar `colisionesApp`
(dos productos distintos que caen en el mismo código normalizado) y
`soloEnApp` / `soloEnFlexxus`.

## Archivos

- `server/src/integrations/flexxusCore.js` — lógica pura (sin DB/red):
  `normalizeCode()` y `buildSyncReport(appRows, flexxusRows)`. Testeada en
  `server/test/flexxus.test.js`.
- `server/src/integrations/flexxus.js` — parte con base/red:
  - `fetchProductsFromFlexxus()` — **STUB**: acá va la llamada real a la API.
  - `previewStockSync()` — dry-run: devuelve el reporte sin tocar nada.
  - `runFlexxusSync({ dryRun })` — trae + compara + (si `dryRun=false`) aplica.
  - `applyStockSync()` — pisa `Productos.Stock` con el de Flexxus (solo Kazaro)
    y loguea en `flexxus_sync_log`.

## Para conectar (cuando esté la API)

1. Cargar en el `.env` del server: `FLEXXUS_API_URL` y `FLEXXUS_TOKEN`.
2. Completar `fetchProductsFromFlexxus()` con la llamada real y mapear la
   respuesta a `{ code, name, stock, subdeposito }`.
3. Probar con dry-run: `runFlexxusSync({ dryRun: true })` y revisar el reporte.
4. Recién cuando el reporte se vea bien, correr con `dryRun: false`.
5. Elegir el disparador: un botón "Sincronizar ahora" en el panel admin, un
   cron, o ambos (todavía sin definir).

## Decisiones abiertas (definir con el usuario)

1. **¿Quién manda el stock?** El esqueleto asume "Flexxus manda" (pisa
   `Productos.Stock`). Falta decidir cómo convive con el descuento local al
   retirar pedidos (hoy el stock se descuenta al retirar).
2. **¿El stock viene por producto o por subdepósito?** Hoy se asume un número
   por producto → `Productos.Stock`. Si fuera por subdepósito, mapear a
   `warehouses` / `warehouse_stock`.
3. **Subdepósito → Categoría:** el reporte muestra `subdeposito` vs
   `categoriaId`, pero todavía NO reescribe categorías (TODO).
