# Integración 360 → Insumos: servicios

Cuando en **360** se crea un servicio, o se le cambia el nombre, 360 avisa a la
aplicación de Insumos y el cambio se refleja automáticamente. El servicio se
carga **una sola vez**, en 360, y se elige en qué empresa va: **Kazaro** o
**Pazar**.

- **Base:** `https://insumos.kazaro.com.ar/api/v1/360`
- **Formato:** JSON, codificado en UTF-8
- **Uso:** servidor a servidor (no desde un navegador)

## Qué se puede hacer desde 360

| Acción | Cómo |
|---|---|
| Crear un servicio | `POST /servicios` |
| Cambiarle el nombre | `PUT /servicios/{externoId}` |
| Consultar cómo quedó | `GET /servicios/{externoId}` |
| Probar la conexión | `GET /ping` |

**Nada más.** El supervisor, el presupuesto y los mails de cada servicio se
asignan **únicamente desde el panel de Insumos**. Si 360 manda esos datos, no se
usan (ver [Campos que no se usan](#campos-que-no-se-usan)).

---

## Autenticación

Cada llamada lleva el token en un header. Cualquiera de las dos formas sirve:

```
Authorization: Bearer <token>
```
```
X-API-Key: <token>
```

Para verificar que el token quedó bien configurado, sin crear nada:

```bash
curl -H "Authorization: Bearer <token>" \
  https://insumos.kazaro.com.ar/api/v1/360/ping
```

```json
{ "ok": true, "integracion": "360", "servidor": "2026-09-10T14:00:00.000Z" }
```

---

## `POST /servicios` — crear un servicio

360 lo llama **cada vez que se crea un servicio**.

### Datos que se envían

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `externoId` | texto | **Sí** | Identificador del servicio **en 360**. Tiene que ser único y no cambiar nunca: es lo que relaciona el servicio de 360 con el de Insumos. Hasta 100 caracteres. |
| `empresa` | texto o número | **Sí** | En qué empresa se crea: `"kazaro"` o `"pazar"` (también sirven `1` y `2`). |
| `nombre` | texto | **Sí** | Nombre del servicio. Hasta 200 caracteres. |
| `direccion` | texto | No | Dirección. |
| `ciudad` | texto | No | Ciudad. |

> **La empresa es obligatoria y no tiene valor por defecto.** Si no viene, o no
> es Kazaro ni Pazar, se rechaza. Así un servicio nunca termina en la empresa
> equivocada ni en las dos.

### Ejemplo

```bash
curl -X POST https://insumos.kazaro.com.ar/api/v1/360/servicios \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
        "externoId": "SRV-00123",
        "empresa": "kazaro",
        "nombre": "SUPER MAMI 7 - ALTA GRACIA",
        "direccion": "Av. Libertador 1200",
        "ciudad": "Alta Gracia"
      }'
```

### Respuesta: `201` — se creó

```json
{
  "resultado": "creado",
  "externoId": "SRV-00123",
  "empresa": { "id": 1, "slug": "kazaro", "nombre": "Kazaro" },
  "servicio": {
    "id": 907,
    "nombre": "SUPER MAMI 7 - ALTA GRACIA",
    "direccion": "Av. Libertador 1200",
    "ciudad": "Alta Gracia",
    "activo": true
  },
  "vinculadoEl": "2026-09-10 14:00:00"
}
```

### Otros resultados posibles

| HTTP | `resultado` / `error` | Qué pasó |
|---|---|---|
| `200` | `ya_existia` | Ese `externoId` ya estaba dado de alta. No se crea nada nuevo. **Reintentar es seguro**: si una llamada falla por un corte de red, se puede repetir sin duplicar. |
| `200` | `vinculado` | En esa empresa ya había un servicio con ese nombre, cargado antes de la integración. Se vincula a ése en vez de duplicarlo. |
| `200` | `actualizado` | Ese `externoId` ya existía, pero llegó con **otro nombre**: se tomó como un cambio de nombre (ver abajo). |
| `409` | `ya_creado_en_otra_empresa` | Ese `externoId` ya está dado de alta en la **otra** empresa. Un servicio no se crea en las dos. |

---

## `PUT /servicios/{externoId}` — cambiar el nombre

360 lo llama **cada vez que se le cambia el nombre a un servicio**.

### Datos que se envían

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `nombre` | texto | **Sí** | Nombre nuevo. Hasta 200 caracteres. |
| `empresa` | texto o número | No | Si se envía, se controla que sea la misma empresa en la que está el servicio. |

### Ejemplo

```bash
curl -X PUT https://insumos.kazaro.com.ar/api/v1/360/servicios/SRV-00123 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "nombre": "SUPER MAMI 7 - ALTA GRACIA CENTRO" }'
```

### Respuesta: `200` — se cambió

```json
{
  "resultado": "actualizado",
  "nombreAnterior": "SUPER MAMI 7 - ALTA GRACIA",
  "externoId": "SRV-00123",
  "empresa": { "id": 1, "slug": "kazaro", "nombre": "Kazaro" },
  "servicio": {
    "id": 907,
    "nombre": "SUPER MAMI 7 - ALTA GRACIA CENTRO",
    "direccion": "Av. Libertador 1200",
    "ciudad": "Alta Gracia",
    "activo": true
  },
  "vinculadoEl": "2026-09-10 14:00:00"
}
```

El servicio **conserva su id**: sigue siendo el mismo servicio, con todo lo que
tenía (pedidos, supervisor, presupuesto, mails). Solo cambia el nombre.

### Otros resultados posibles

| HTTP | `resultado` / `error` | Qué pasó |
|---|---|---|
| `200` | `sin_cambios` | El nombre ya era ése. No se tocó nada. |
| `404` | `no_encontrado` | Ese `externoId` todavía no se dio de alta. Hay que crearlo primero con `POST /servicios`. |
| `409` | `nombre_en_uso` | Ya hay **otro** servicio con ese nombre en la misma empresa. No se renombró: en Insumos no puede haber dos servicios con el mismo nombre. |
| `409` | `servicio_compartido` | Dos servicios de 360 quedaron vinculados al mismo servicio de Insumos (porque tenían el mismo nombre). No se renombra, porque le cambiaría el nombre al otro. Lo tiene que separar una persona. |
| `409` | `ya_creado_en_otra_empresa` | Se envió `empresa` y no es la del servicio. Un servicio no se cambia de empresa desde 360. |

> **Alternativa:** si a 360 le resulta más fácil mandar siempre el mismo aviso
> (el del alta) cada vez que se guarda un servicio, también funciona: si llega
> un `POST /servicios` con un `externoId` que ya existe y otro nombre, se toma
> como un cambio de nombre y responde `"resultado": "actualizado"`.

---

## `GET /servicios/{externoId}` — consultar cómo quedó

```bash
curl -H "Authorization: Bearer <token>" \
  https://insumos.kazaro.com.ar/api/v1/360/servicios/SRV-00123
```

Devuelve el servicio (igual que las respuestas de arriba, sin `resultado`), o
`404` si ese servicio de 360 todavía no se dio de alta.

`servicio.activo` viene en `false` si el servicio se dio de baja en Insumos.

---

## Campos que no se usan

Desde 360 **solo se crea y se renombra**. Cualquier otro dato que se mande
(supervisor, presupuesto, mails, teléfono, etc.) **no se guarda**. El pedido no
se rechaza por eso, pero la respuesta lo avisa en `camposIgnorados`, para que
nadie crea que se cargó:

```json
{
  "resultado": "creado",
  "...": "...",
  "camposIgnorados": ["supervisor", "presupuesto", "emails"]
}
```

---

## Advertencias

Las respuestas exitosas pueden traer `advertencias` (una lista de textos). **No
son errores**: la operación se hizo igual. Avisan de algo que conviene que una
persona revise:

- Hay un servicio con **el mismo nombre en la otra empresa**. Puede ser
  legítimo (un cliente que atienden las dos), o puede ser que se eligió mal la
  empresa.
- **Otro servicio de 360** ya estaba vinculado al mismo servicio de Insumos.

---

## Errores

Todos devuelven JSON con `error` (código fijo, para programar contra él) y
`mensaje` (texto explicativo). Los `400` agregan `campo`, con el dato que falló.

| HTTP | `error` | Cuándo |
|---|---|---|
| `400` | `parametro_invalido` | Falta `externoId`, `empresa` o `nombre`, o la empresa no es válida. |
| `401` | `falta_token` | No se envió el header de autenticación. |
| `403` | `token_invalido` | El token no es válido. |
| `404` | `no_encontrado` | El `externoId` no está dado de alta, o la ruta no existe. |
| `409` | `ya_creado_en_otra_empresa` | El servicio está en la otra empresa. |
| `409` | `nombre_en_uso` | El nombre nuevo ya lo usa otro servicio de esa empresa. |
| `409` | `servicio_compartido` | El servicio lo comparten dos servicios de 360. |
| `429` | `demasiadas_consultas` | Más de 60 llamadas por minuto. |
| `500` | `error_interno` | Error del servidor. Se puede reintentar. |
| `503` | `api_no_configurada` | El servidor todavía no tiene el token cargado. |

```json
// 400 — sin empresa
{ "error": "parametro_invalido", "campo": "empresa", "mensaje": "Falta la empresa. Valores válidos: \"kazaro\" (1) o \"pazar\" (2)." }
```

### Qué reintentar

- **`500`, `503`, `429` o corte de red:** reintentar más tarde. Es seguro:
  nada se duplica.
- **`400`, `404` y `409`:** no reintentar igual, porque va a volver a fallar.
  Hay que corregir los datos, o que una persona lo revise.

---

## Lo que esta integración no hace

- **No asigna** supervisor, presupuesto ni mails: eso se hace solo desde el
  panel de Insumos.
- **No da de baja** servicios.
- **No cambia** un servicio de empresa.
- **No actualiza** la dirección ni la ciudad después del alta: solo el nombre.
