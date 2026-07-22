# API de pedidos — documentación para integración

API de **sólo lectura** para consultar los pedidos de insumos: qué se pidió, en
qué fecha y hora, para qué servicio, y el detalle de cada insumo con su
cantidad, precio unitario y subtotal.

- **Base:** `https://insumos.kazaro.com.ar/api/v1`
- **Formato:** JSON, codificado en UTF-8
- **Métodos:** sólo `GET`. Cualquier otro método devuelve `405`.

---

## Autenticación

Cada consulta lleva un token en un header. Cualquiera de las dos formas sirve:

```
Authorization: Bearer <token>
```
```
X-API-Key: <token>
```

El token identifica a la empresa: **sólo devuelve datos de la empresa a la que
pertenece**. No hace falta (ni se puede) indicar la empresa por parámetro.

Para verificar que el token quedó bien configurado, sin traer datos:

```bash
curl -H "Authorization: Bearer <token>" \
  https://insumos.kazaro.com.ar/api/v1/ping
```

```json
{ "ok": true, "empresaId": 1, "servidor": "2026-07-22T11:54:39.728Z" }
```

### Consumo desde el servidor, no desde el navegador

La API está pensada para uso **servidor a servidor**. Las consultas sin header
`Origin` (backend, `curl`, un job) se aceptan sin restricción.

Las consultas **con** header `Origin` —o sea, desde JavaScript en un navegador—
pasan por la validación de CORS del sistema y, si el dominio no está en la lista
blanca, reciben `403` con `{"error":"Not allowed by CORS"}`. El preflight
`OPTIONS` también devuelve `403`.

Más allá de CORS, el token no debe usarse desde un navegador: viajaría en el
código de la página y quedaría expuesto a cualquiera que abra las herramientas
de desarrollo.

---

## Límite de consultas

**60 consultas por minuto, por token.** El límite es por token, no por IP ni por
servidor: cada consumidor tiene su propio presupuesto y no compite con el resto
aunque compartan la misma instancia o salgan por la misma IP.

Toda respuesta incluye los headers estándar para autorregularse:

```
RateLimit-Policy: 60;w=60
RateLimit-Limit: 60
RateLimit-Remaining: 56
RateLimit-Reset: 59
```

- `RateLimit-Remaining` — consultas que quedan en la ventana actual
- `RateLimit-Reset` — segundos hasta que se reinicia el contador

Al superar el límite se devuelve `429`, que además trae `Retry-After` con los
segundos a esperar:

```
HTTP/1.1 429 Too Many Requests
RateLimit-Remaining: 0
RateLimit-Reset: 32
Retry-After: 32
```

```json
{
  "error": "demasiadas_consultas",
  "mensaje": "Máximo 60 consultas por minuto por token. Reintentá en unos segundos."
}
```

**Para dimensionar:** con `limit=500` (el máximo), 60 consultas por minuto son
hasta 30.000 pedidos por minuto. Para una carga inicial grande alcanza de sobra
sin espaciar las llamadas; de todos modos, lo más robusto es leer
`RateLimit-Remaining` y frenar cuando se acerque a cero.

---

## `GET /pedidos`

Devuelve los pedidos con su detalle de insumos.

### Parámetros

| Parámetro | Tipo | Descripción |
|---|---|---|
| `desde` | `aaaa-mm-dd` | Fecha inicial, **inclusive**. Opcional. |
| `hasta` | `aaaa-mm-dd` | Fecha final, **inclusive**. Opcional. |
| `servicioId` | número | Filtra por servicio. Opcional. |
| `page` | número | Página, arranca en 1. Por defecto 1. |
| `limit` | número | Resultados por página. Por defecto 100, máximo 500. |

> **Sobre las fechas:** `desde` y `hasta` se interpretan como **días
> argentinos** y ambos extremos se incluyen. Un pedido hecho el 10/03 a las
> 23:30 hora argentina entra en `desde=2026-03-10&hasta=2026-03-10`, aunque en
> UTC ese instante ya sea del día 11.

### Ejemplo

```bash
curl -H "Authorization: Bearer <token>" \
  "https://insumos.kazaro.com.ar/api/v1/pedidos?servicioId=904&desde=2026-06-01&hasta=2026-06-30"
```

### Respuesta

```json
{
  "empresaId": 2,
  "filtros": { "desde": "2026-06-01", "hasta": "2026-06-30", "servicioId": 904 },
  "paginado": { "page": 1, "limit": 100, "total": 8, "paginas": 1 },
  "pedidos": [
    {
      "pedidoId": 75,
      "numero": "0000075",
      "fechaHora": "2026-06-02T13:06:45.000Z",
      "fechaHoraArgentina": "02/06/2026, 10:06",
      "dia": "2026-06-02",
      "servicio": { "id": 904, "nombre": "Camino de las sierras" },
      "solicitante": "Juan Pérez",
      "rol": "supervisor",
      "estado": "cerrado",
      "nota": null,
      "total": 41917.19,
      "items": [
        {
          "codigo": "100000218",
          "insumo": "ACEITE 10W30",
          "cantidad": 7,
          "precioUnitario": 5988.17,
          "subtotal": 41917.19
        }
      ]
    }
  ]
}
```

### Campos

| Campo | Descripción |
|---|---|
| `pedidoId` | Identificador numérico, único y estable. |
| `numero` | El mismo id con ceros a la izquierda, como aparece en el remito. |
| `fechaHora` | ISO-8601 **en UTC**. Este es el campo a usar para ordenar o comparar. |
| `fechaHoraArgentina` | Lo mismo, ya formateado en hora argentina, para mostrar. |
| `dia` | Día argentino en `aaaa-mm-dd`. Sirve para agrupar por jornada. |
| `servicio` | Objeto `{ id, nombre }`, o `null` — ver la nota de abajo. |
| `solicitante` | Nombre de quien hizo el pedido. |
| `rol` | Rol con el que se hizo: `supervisor` o `administrativo`. |
| `estado` | `cerrado` o `abierto`. |
| `total` | Total del pedido. Coincide con la suma de los `subtotal`. |
| `items[]` | Insumos del pedido. |

### Dos aclaraciones importantes sobre los datos

**1. `servicio` puede venir en `null`.** Los pedidos hechos con rol
`administrativo` no se asocian a un servicio: son compras generales, no pedidos
de un servicio puntual. Es así por diseño del sistema, no es un dato faltante.
Si sólo te interesan los pedidos de servicios, filtrá por `servicioId` o
descartá los que tengan `servicio: null`.

**2. `codigo` puede venir en `null`.** No todos los insumos tienen cargado su
código. Si vas a cruzar contra otro sistema por código, contemplá ese caso y
usá `insumo` (el nombre) como alternativa.

---

## `GET /servicios`

Lista los servicios de la empresa, para saber qué `servicioId` usar.

```bash
curl -H "Authorization: Bearer <token>" \
  https://insumos.kazaro.com.ar/api/v1/servicios
```

```json
{
  "empresaId": 2,
  "servicios": [
    {
      "id": 904,
      "nombre": "Camino de las sierras",
      "cantidadPedidos": 8,
      "ultimoPedido": "2026-06-02T13:06:45.000Z"
    }
  ]
}
```

---

## Errores

Todos los errores devuelven JSON con `error` (código estable, apto para
programar contra él) y `mensaje` (texto explicativo). Los `400` agregan `campo`
con el parámetro que falló.

| HTTP | `error` | Cuándo |
|---|---|---|
| `400` | `parametro_invalido` | Formato de fecha incorrecto, rango invertido, `servicioId` no numérico. |
| `401` | `falta_token` | No se envió el header de autenticación. |
| `403` | `token_invalido` | El token no corresponde a ninguna empresa. |
| `403` | `Not allowed by CORS` | Consulta desde un navegador con un `Origin` no autorizado. |
| `405` | `metodo_no_permitido` | Se usó un método distinto de `GET`. |
| `429` | `demasiadas_consultas` | Se superó el límite de consultas del token. |
| `500` | `error_interno` | Error del servidor. |
| `503` | `api_no_configurada` | El servidor no tiene tokens cargados. |

### Cuerpos reales

Estos son los JSON exactos que devuelve el servidor, tomados de respuestas
reales:

```json
// 400 — GET /pedidos?desde=02-06-2026
{ "error": "parametro_invalido", "campo": "desde", "mensaje": "Formato esperado aaaa-mm-dd." }

// 400 — GET /pedidos?desde=2026-06-10&hasta=2026-06-01
{ "error": "parametro_invalido", "campo": "hasta", "mensaje": "'hasta' no puede ser anterior a 'desde'." }

// 400 — GET /pedidos?servicioId=abc
{ "error": "parametro_invalido", "campo": "servicioId", "mensaje": "Debe ser un número." }

// 401 — sin header de autenticación
{ "error": "falta_token", "mensaje": "Enviá el token en el header Authorization: Bearer <token> o X-API-Key." }

// 403 — token que no existe
{ "error": "token_invalido", "mensaje": "El token no es válido." }

// 403 — desde un navegador con Origin no autorizado
{ "error": "Not allowed by CORS" }

// 405 — POST /pedidos
{ "error": "metodo_no_permitido", "mensaje": "Esta API es de sólo lectura." }

// 429 — límite superado
{ "error": "demasiadas_consultas", "mensaje": "Máximo 60 consultas por minuto por token. Reintentá en unos segundos." }
```

> Ojo con el `403` de CORS: es el único que **no** sigue el formato
> `{ error, mensaje }`, porque lo genera el middleware de CORS antes de llegar a
> la API. Sólo aparece en consultas desde navegador; en server-to-server no se
> da nunca.

Un rango sin resultados **no es un error**: devuelve `200` con `pedidos: []` y
`total: 0`.

---

## Recorrer todas las páginas

```javascript
async function traerTodos({ token, desde, hasta, servicioId }) {
  const base = "https://insumos.kazaro.com.ar/api/v1/pedidos";
  const pedidos = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams({ page, limit: 500 });
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    if (servicioId) params.set("servicioId", servicioId);

    const r = await fetch(`${base}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error(`${r.status}: ${(await r.json()).mensaje}`);

    const data = await r.json();
    pedidos.push(...data.pedidos);
    if (page >= data.paginado.paginas) break;
    page++;
  }

  return pedidos;
}
```

---

## Configuración del servidor (uso interno)

Los tokens se definen en el `.env` del servidor, separados por coma, con el
formato `token:empresa_id`:

```
PEDIDOS_API_TOKENS=<token_kazaro>:1,<token_pazar>:2
```

Kazaro es la empresa `1` y Pazar la `2`. Si la variable está vacía o no existe,
la API responde `503` a todas las consultas.

Para generar un token nuevo:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Los tokens no caducan. Para revocar uno, sacalo del `.env` y reiniciá el
servicio (`pm2 restart kazaro-server --update-env`).
