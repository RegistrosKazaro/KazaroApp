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
| `direccion` | No | |
| `ciudad` | No | |
| `supervisor` | No | `{ "nombre": "...", "dni": "..." }` (ver paso 4) |

```bash
curl -X POST https://insumos.kazaro.com.ar/api/v1/360/servicios \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"externoId":"SRV-00123","empresa":"kazaro","nombre":"SUPER MAMI 7 - ALTA GRACIA"}'
```

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

## 4. Asignar el supervisor

**Cuándo:** al asignar (o cambiar) el supervisor de un servicio en 360.

`PUT /servicios/{externoId}/supervisor`

| Campo | Obligatorio | Valor |
|---|---|---|
| `nombre` | Sí | Nombre y apellido del supervisor |
| `dni` | No | DNI del supervisor |

```bash
curl -X PUT https://insumos.kazaro.com.ar/api/v1/360/servicios/SRV-00123/supervisor \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"ALVAREZ, MARIA EUGENIA","dni":"30111222"}'
```

- Se busca por nombre (sin importar orden, mayúsculas ni acentos).
- Cada servicio tiene **un** supervisor: si ya tenía otro, se reemplaza.
- **Pazar:** no se asigna (responde `no_aplica`). Allá todos los supervisores ven todos los servicios.

| HTTP | `resultado` | Acción |
|---|---|---|
| `200` | `asignado` / `ya_asignado` / `no_aplica` | OK |
| `422` | `no_encontrado` | No hay un supervisor con ese nombre en Insumos. No reintentar; lo revisa Kazaro |
| `422` | `ambiguo` | El nombre coincide con más de uno. No reintentar; lo revisa Kazaro |

Si el supervisor se manda en el paso 2, el servicio se crea igual aunque el
supervisor no se encuentre: el resultado viene en `asignacionSupervisor`.

---

## 5. Consultar un servicio

`GET /servicios/{externoId}` — incluye `supervisorActual`.

---

## Respuestas

| HTTP | Código | Acción |
|---|---|---|
| `201` | `creado` | OK |
| `200` | `ya_existia` / `vinculado` / `actualizado` / `sin_cambios` | OK |
| `400` | `parametro_invalido` | Corregir el dato indicado en `campo` |
| `401` / `403` | `falta_token` / `token_invalido` | Revisar el token |
| `404` | `no_encontrado` | Crear primero el servicio |
| `409` | `ya_creado_en_otra_empresa` / `nombre_en_uso` / `servicio_compartido` | No reintentar; lo revisa Kazaro |
| `422` | `no_encontrado` / `ambiguo` (supervisor) | No reintentar; lo revisa Kazaro |
| `429` / `500` / `503` | | Reintentar más tarde |

Reintentar es seguro: nunca duplica.

**Presupuesto y mails no se toman** (vuelven listados en `camposIgnorados`).
