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

**Límite de uso:** 60 consultas por minuto. Al superarlo se devuelve `429`.

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
programar contra él) y `mensaje` (texto explicativo).

| HTTP | `error` | Cuándo |
|---|---|---|
| `400` | `parametro_invalido` | Formato de fecha incorrecto, rango invertido, `servicioId` no numérico. Incluye el campo `campo`. |
| `401` | `falta_token` | No se envió el header de autenticación. |
| `403` | `token_invalido` | El token no corresponde a ninguna empresa. |
| `405` | `metodo_no_permitido` | Se usó un método distinto de `GET`. |
| `429` | `demasiadas_consultas` | Se superaron las 60 consultas por minuto. |
| `500` | `error_interno` | Error del servidor. |
| `503` | `api_no_configurada` | El servidor no tiene tokens cargados. |

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
