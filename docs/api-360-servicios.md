# Integración 360 → Insumos: alta de servicios

Cuando en **360** se crea un servicio nuevo, 360 avisa a la aplicación de
Insumos y el servicio se da de alta automáticamente en la empresa elegida
(**Kazaro** o **Pazar**). El servicio se carga una sola vez, en 360.

- **Base:** `https://insumos.kazaro.com.ar/api/v1/360`
- **Formato:** JSON, codificado en UTF-8
- **Uso:** servidor a servidor (no desde un navegador)

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

## `POST /servicios` — dar de alta un servicio

360 lo llama **cada vez que se crea un servicio**.

### Cuerpo

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `externoId` | texto | **Sí** | Identificador del servicio **en 360**. Único y estable: siempre el mismo para el mismo servicio. Hasta 100 caracteres. |
| `empresa` | texto o número | **Sí** | En qué empresa se crea: `"kazaro"` o `"pazar"` (también sirven `1` y `2`). |
| `nombre` | texto | **Sí** | Nombre del servicio. Hasta 200 caracteres. |
| `direccion` | texto | No | Dirección. |
| `ciudad` | texto | No | Ciudad. |

> **La empresa es obligatoria y no tiene valor por defecto.** Si no viene, o no
> es Kazaro ni Pazar, el alta se rechaza. Así un servicio nunca termina creado
> en la empresa equivocada ni en las dos.

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

### Respuestas

**`201` — se creó el servicio**

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

**`200` con `"resultado": "ya_existia"`**: ese `externoId` ya se había dado de
alta antes. No se crea nada nuevo y se devuelve el servicio existente.
**Reintentar es seguro**: si una llamada falla por un corte de red, se puede
repetir sin riesgo de duplicar.

**`200` con `"resultado": "vinculado"`**: en esa empresa ya existía un servicio
con el mismo nombre, cargado antes de la integración. En vez de duplicarlo, se
vincula el `externoId` a ese servicio.

**`409` — `ya_creado_en_otra_empresa`**: ese `externoId` ya se dio de alta en
la **otra** empresa. No se crea en las dos. Si la empresa estaba mal elegida,
hay que corregirlo a mano.

```json
{
  "error": "ya_creado_en_otra_empresa",
  "mensaje": "Ese servicio de 360 ya se creó en Kazaro. No se crea en las dos: si la empresa estaba mal, hay que corregirlo a mano.",
  "externoId": "SRV-00123",
  "empresa": { "id": 1, "slug": "kazaro", "nombre": "Kazaro" },
  "servicio": { "id": 907, "nombre": "SUPER MAMI 7 - ALTA GRACIA", "direccion": "Av. Libertador 1200", "ciudad": "Alta Gracia", "activo": true },
  "vinculadoEl": "2026-09-10 14:00:00"
}
```

### Advertencias

Las respuestas exitosas pueden traer un campo `advertencias` (lista de textos).
**No son errores**: el alta se hizo igual. Avisan de algo que conviene que una
persona revise:

- Hay un servicio con **el mismo nombre en la otra empresa**. Puede ser
  legítimo (un cliente que atienden las dos), o puede ser que se eligió mal la
  empresa.
- **Otro servicio de 360** ya estaba vinculado al mismo servicio de Insumos,
  porque tienen el mismo nombre. Si en 360 son dos servicios distintos, hay que
  diferenciarlos por nombre.

```json
{
  "resultado": "creado",
  "...": "...",
  "advertencias": ["Ya existe un servicio con el mismo nombre en Kazaro (id 907)."]
}
```

---

## `GET /servicios/{externoId}` — consultar cómo quedó un alta

```bash
curl -H "Authorization: Bearer <token>" \
  https://insumos.kazaro.com.ar/api/v1/360/servicios/SRV-00123
```

Devuelve lo mismo que el alta (sin `resultado`), o `404` si ese servicio de 360
todavía no se dio de alta.

`servicio.activo` viene en `false` si el servicio se dio de baja después en
Insumos.

---

## Errores

Todos devuelven JSON con `error` (código estable, para programar contra él) y
`mensaje` (texto explicativo). Los `400` agregan `campo`, con el dato que falló.

| HTTP | `error` | Cuándo |
|---|---|---|
| `400` | `parametro_invalido` | Falta `externoId`, `empresa` o `nombre`, o la empresa no es válida. |
| `401` | `falta_token` | No se envió el header de autenticación. |
| `403` | `token_invalido` | El token no es válido. |
| `404` | `no_encontrado` | Consulta de un `externoId` que no existe, o ruta inexistente. |
| `409` | `ya_creado_en_otra_empresa` | El servicio ya se creó en la otra empresa. |
| `429` | `demasiadas_consultas` | Más de 60 llamadas por minuto. |
| `500` | `error_interno` | Error del servidor. Se puede reintentar. |
| `503` | `api_no_configurada` | El servidor todavía no tiene el token cargado. |

```json
// 400 — sin empresa
{ "error": "parametro_invalido", "campo": "empresa", "mensaje": "Falta la empresa. Valores válidos: \"kazaro\" (1) o \"pazar\" (2)." }
```

### Qué reintentar

- **`500`, `503`, `429` o corte de red:** reintentar más tarde. Es seguro,
  porque el alta no se duplica.
- **`400` y `409`:** no reintentar igual, porque va a volver a fallar. Hay que
  corregir los datos.

---

## Qué NO hace esta integración (por ahora)

- **No actualiza** servicios: si en 360 se cambia el nombre, no se refleja acá.
- **No da de baja** servicios.
- **No asigna** supervisor, presupuesto ni mails del servicio: eso se sigue
  configurando en Insumos, igual que con un servicio cargado a mano.
