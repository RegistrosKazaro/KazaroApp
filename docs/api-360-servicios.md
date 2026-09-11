# API 360 → Insumos: servicios

**Base:** `https://insumos.kazaro.com.ar/api/v1/360`

**Header en todas las llamadas:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

---

## 1. Probar la conexión

```bash
curl -H "Authorization: Bearer <token>" \
  https://insumos.kazaro.com.ar/api/v1/360/ping
```

Respuesta: `{ "ok": true, "integracion": "360", ... }`

---

## 2. Crear un servicio

**Cuándo:** al crear un servicio en 360.

`POST /servicios`

| Campo | Obligatorio | Valor |
|---|---|---|
| `externoId` | Sí | Id del servicio en 360 (fijo, no cambia nunca) |
| `empresa` | Sí | `"kazaro"` o `"pazar"` |
| `nombre` | Sí | Nombre del servicio |
| `supervisor.legajo` | **Sí en Kazaro** | Legajo del supervisor |
| `supervisor.nombre` | No | Nombre del supervisor |
| `supervisor.dni` | No | DNI del supervisor (si viene, se controla) |
| `direccion` | No | |
| `ciudad` | No | |

```bash
curl -X POST https://insumos.kazaro.com.ar/api/v1/360/servicios \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"externoId":"SRV-00123","empresa":"kazaro","nombre":"SUPER MAMI 7 - ALTA GRACIA","supervisor":{"legajo":"1234","nombre":"ALVAREZ MARIA EUGENIA","dni":"30111222"}}'
```

- **Kazaro:** sin un legajo válido de un supervisor activo, **no se crea el servicio**.
- **Pazar:** el supervisor no hace falta (si se manda, responde `no_aplica`).

---

## 3. Cambiar el nombre

**Cuándo:** al renombrar un servicio en 360.

`PUT /servicios/{externoId}`

| Campo | Obligatorio | Valor |
|---|---|---|
| `nombre` | Sí | Nombre nuevo |

```bash
curl -X PUT https://insumos.kazaro.com.ar/api/v1/360/servicios/SRV-00123 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"SUPER MAMI 7 - ALTA GRACIA CENTRO"}'
```

---

## 4. Cambiar el supervisor

**Cuándo:** al cambiar el supervisor de un servicio en 360.

`PUT /servicios/{externoId}/supervisor`

| Campo | Obligatorio | Valor |
|---|---|---|
| `legajo` | Sí | Legajo del nuevo supervisor |
| `nombre` | No | |
| `dni` | No | Si viene, se controla |

```bash
curl -X PUT https://insumos.kazaro.com.ar/api/v1/360/servicios/SRV-00123/supervisor \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"legajo":"5678"}'
```

Cada servicio tiene **un** supervisor: el nuevo reemplaza al anterior.

---

## 5. Consultar un servicio

`GET /servicios/{externoId}` — incluye `supervisorActual`.

---

## Respuestas

| HTTP | Código | Acción |
|---|---|---|
| `201` | `creado` | OK |
| `200` | `ya_existia` / `vinculado` / `actualizado` / `sin_cambios` / `asignado` / `ya_asignado` / `no_aplica` | OK |
| `400` | `parametro_invalido` | Corregir el dato indicado en `campo` |
| `401` / `403` | `falta_token` / `token_invalido` | Revisar el token |
| `404` | `no_encontrado` | Crear primero el servicio |
| `409` | `ya_creado_en_otra_empresa` / `nombre_en_uso` / `servicio_compartido` | No reintentar; lo revisa Kazaro |
| `422` | `supervisor_no_encontrado` / `no_es_supervisor` / `supervisor_inactivo` / `supervisor_dni_no_coincide` / `supervisor_ambiguo` | No reintentar; lo revisa Kazaro |
| `429` / `500` / `503` | | Reintentar más tarde |

Reintentar es seguro: nunca duplica.

**Presupuesto y mails no se toman** (vuelven listados en `camposIgnorados`).
