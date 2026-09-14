# API 360 → Insumos: servicios

**Versión del 14/09/2026** — el supervisor se identifica por **legajo** y es
obligatorio al crear servicios de Kazaro. Incluye el detalle de las respuestas
y las preguntas frecuentes del final. Si tenés una copia anterior, esta la
reemplaza.

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

### Respuesta de un alta exitosa

El código viene en la clave **`resultado`**. HTTP `201` si se creó, `200` en los
demás casos. El resultado del supervisor viene aparte, en
**`asignacionSupervisor.resultado`**.

```json
{
  "resultado": "creado",
  "externoId": "SRV-00123",
  "empresa": { "id": 1, "slug": "kazaro", "nombre": "Kazaro" },
  "servicio": { "id": 907, "nombre": "SUPER MAMI 7 - ALTA GRACIA", "direccion": null, "ciudad": null, "activo": true },
  "vinculadoEl": "2026-09-11 14:00:00",
  "asignacionSupervisor": {
    "resultado": "asignado",
    "supervisor": { "id": 33, "nombre": "Eugenia Alvarez", "legajo": "1234" }
  }
}
```

| `resultado` | HTTP | Qué pasó |
|---|---|---|
| `creado` | `201` | Se creó el servicio. |
| `ya_existia` | `200` | Ese `externoId` ya estaba dado de alta. No se creó nada nuevo (reintento). |
| `vinculado` | `200` | En esa empresa **ya había un servicio con ese mismo nombre**, cargado a mano antes de la integración. En vez de duplicarlo, se vincula el `externoId` a ése: de ahí en adelante es el mismo servicio. |
| `actualizado` | `200` | Ya existía y llegó con otro nombre: se renombró. |

| `asignacionSupervisor.resultado` | Qué pasó |
|---|---|
| `asignado` | Se asignó. Si reemplazó a otro, viene `reemplazoA`. |
| `ya_asignado` | Ya era el supervisor de ese servicio. |
| `no_aplica` | Empresa Pazar: allá todos los supervisores ven todos los servicios. |

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
| `429` | `demasiadas_consultas` | Reintentar más tarde (ver `Retry-After`) |
| `500` | `error_interno` | Reintentar más tarde |
| `503` | `api_no_configurada` | El servidor no tiene el token cargado. Avisar a Kazaro |

Reintentar es seguro: nunca duplica.

**Presupuesto y mails no se toman** (vuelven listados en `camposIgnorados`).

Las respuestas exitosas pueden traer **`advertencias`** (una lista de textos).
No son errores: la operación se hizo igual. Avisan de algo que conviene que una
persona mire, por ejemplo que ya existe un servicio con el mismo nombre en la
otra empresa.

---

## Preguntas frecuentes

**¿Qué empresas acepta `empresa`?** Sólo **`"kazaro"`** y **`"pazar"`** (o `1` y
`2`). Cualquier otro valor devuelve `400` y no crea nada. Si en 360 hay más
empresas, hay que definir con Kazaro cuál corresponde a cada una.

**En Pazar, ¿el supervisor sigue sin aplicar?** Sí. En Pazar todos los
supervisores ven todos los servicios, así que no hay asignación: si se manda un
supervisor, responde `no_aplica` y el alta se hace igual.

**Si al cambiar el supervisor el legajo no está en Insumos, ¿se queda el
anterior?** Sí. Devuelve `422` y **no toca la asignación**: el servicio conserva
el supervisor que tenía. Lo mismo si el legajo es de alguien que no es
supervisor, está dado de baja, o el DNI no coincide.

**¿Cuál es el límite de consultas?** **60 por minuto**, contadas por token. Cada
respuesta trae los headers `RateLimit-Limit`, `RateLimit-Remaining` y
`RateLimit-Reset`. Al pasarse, `429` con `Retry-After` (segundos a esperar).

**¿Cómo es el formato de los errores?** Siempre JSON con `error` (código fijo,
para programar contra él) y `mensaje` (texto explicativo). Los `400` agregan
`campo`, con el dato que falló. Los del supervisor traen además `resultado`.

```json
{ "error": "supervisor_no_encontrado",
  "resultado": "no_encontrado",
  "mensaje": "No hay ningún empleado con el legajo 999999 en Insumos. Hay que cargarle el legajo al supervisor en el panel de usuarios. No se creó el servicio.",
  "supervisor": null }
```
