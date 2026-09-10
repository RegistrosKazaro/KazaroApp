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

## 4. Consultar un servicio

`GET /servicios/{externoId}`

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
| `429` / `500` / `503` | | Reintentar más tarde |

Reintentar es seguro: nunca duplica.

**Solo se crea y se renombra.** Supervisor, presupuesto y mails no se toman
(vuelven listados en `camposIgnorados`).
