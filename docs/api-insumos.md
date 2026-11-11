# API de insumos — documentación para integración

API de **sólo lectura** para consultar toda la información que el sistema tiene
de cada insumo: datos básicos, categoría y rubro, precio, stock, consumo,
compras, devoluciones, en qué servicios está asignado y el historial de cambios.

- **Base:** `https://insumos.kazaro.com.ar/api/v1`
- **Formato:** JSON, codificado en UTF-8
- **Métodos:** sólo `GET`. Cualquier otro método devuelve `405`.

Es la misma API que la de pedidos (`/pedidos`, `/servicios`): mismo token, mismo
límite de consultas.

---

## Sobre el stock

La API devuelve el stock tal como está hoy en el sistema. Al arrancar se cargó
un stock alto para que ningún pedido se frenara, y en algunos insumos ese
número sigue ahí. Esos vienen con `stock.dudoso: true` (10.000 unidades o más):
el número existe en el sistema pero no es mercadería contada.

---

## Autenticación

Cada consulta lleva un token en un header. Cualquiera de las dos formas sirve:

```
Authorization: Bearer <token>
```
```
X-API-Key: <token>
```

El token identifica a la empresa: **sólo devuelve insumos de la empresa a la que
pertenece**. No hace falta (ni se puede) indicar la empresa por parámetro.

Para verificar el token sin traer datos:

```bash
curl -H "Authorization: Bearer <token>" \
  https://insumos.kazaro.com.ar/api/v1/ping
```

```json
{ "ok": true, "empresaId": 1, "servidor": "2026-11-11T11:54:39.728Z" }
```

**La API es para usar desde un servidor, no desde un navegador.** El token
viajaría en el código de la página y quedaría a la vista de cualquiera.

---

## Límite de consultas

**60 consultas por minuto, por token.** Toda respuesta trae los headers
`RateLimit-Remaining` (consultas que quedan) y `RateLimit-Reset` (segundos hasta
que se reinicia). Al pasarse se devuelve `429` con `Retry-After`.

Para traer todo el catálogo conviene pedir de a 500 (ver
[Recorrer todas las páginas](#recorrer-todas-las-páginas)): son 1 o 2 consultas.

---

## `GET /insumos`

La lista de insumos, con su ficha resumida.

### Parámetros

| Parámetro | Tipo | Descripción |
|---|---|---|
| `q` | texto | Busca en el nombre o el código. No distingue mayúsculas ni acentos: `pano` encuentra `PAÑO`. |
| `codigo` | texto | Código exacto. Los ceros adelante no importan: `4` y `004` son el mismo. |
| `categoriaId` | entero | Filtra por categoría. Los ids están en [`/categorias`](#get-categorias). |
| `rubroId` | entero | Filtra por rubro. Los ids están en [`/categorias`](#get-categorias). |
| `incluirInactivos` | `1` | Trae también los insumos dados de baja. Sin esto, sólo los activos. |
| `page` | entero | Página, desde 1. Por defecto `1`. |
| `limit` | entero | Insumos por página. Máximo `500`, por defecto `100`. |

### Ejemplo

```bash
curl -H "Authorization: Bearer <token>" \
  "https://insumos.kazaro.com.ar/api/v1/insumos?q=desengrasante&limit=50"
```

### Respuesta

> Los valores son de ejemplo, para mostrar la forma. No son los datos reales de ese insumo.

```json
{
  "empresaId": 1,
  "filtros": { "q": "desengrasante", "codigo": null, "categoriaId": null,
               "rubroId": null, "incluirInactivos": false },
  "paginado": { "page": 1, "limit": 50, "total": 6, "paginas": 1 },
  "insumos": [
    {
      "id": 100000025,
      "codigo": "100000025",
      "nombre": "DESENGRASANTE KAZARO X 5 LTS",
      "codigoBarra": null,
      "activo": true,
      "imagen": null,
      "categoria": { "id": 2, "nombre": "Liquidos" },
      "rubros": [ { "id": 1, "nombre": "Limpieza" } ],
      "precio": 2495.4,
      "ultimoPrecioCompra": null,
      "stock": {
        "disponible": 4831,
        "remanente": 0,
        "enCamino": 0,
        "dudoso": false
      },
      "consumo": {
        "ultimos90Dias": 112,
        "promedioMensual": 37,
        "mesesDeCobertura": 129.4,
        "ultimoPedido": "2026-11-03T19:31:07.000Z"
      },
      "devolucion": { "retornable": false, "preguntaAlVolver": "cuanto_queda" },
      "serviciosAsignados": 352,
      "visiblePara": [ "administrativo", "supervisor" ]
    }
  ]
}
```

### Campos

| Campo | Qué es |
|---|---|
| `id` | Identificador interno del insumo. Es el que se usa en `/insumos/{id}`. |
| `codigo` | Código del insumo, tal como está cargado (puede tener ceros adelante). `null` si no tiene. |
| `nombre` | Nombre del insumo. |
| `codigoBarra` | Código de barras. Hoy está vacío para todos: se empieza a cargar con la pistola lectora. |
| `activo` | `false` si fue dado de baja. Sólo aparecen con `incluirInactivos=1`. |
| `imagen` | URL de la foto, si tiene. |
| `categoria` | `{ id, nombre }`. |
| `rubros` | Lista de `{ id, nombre }`. Normalmente uno solo; vacía si no está clasificado. |
| `precio` | Precio de referencia en el sistema: lo que se le imputa al presupuesto del servicio. **No** es el precio de compra. |
| `ultimoPrecioCompra` | Precio unitario de la última factura de proveedor conciliada. `null` si todavía no hubo ninguna. |
| `stock.disponible` | Stock general, tal como está hoy en el sistema. Ver [Sobre el stock](#sobre-el-stock). |
| `stock.remanente` | Lo que volvió de un servicio abierto, usado o roto. Está aparte: no suma al disponible. |
| `stock.enCamino` | Unidades con llegada prevista de hoy en adelante. |
| `stock.dudoso` | `true` si el stock es de 10.000 o más: el número cargado al arrancar, no mercadería real. |
| `consumo.ultimos90Dias` | Unidades pedidas en los últimos 90 días, **neto de devoluciones**. |
| `consumo.promedioMensual` | `ultimos90Dias / 3`, redondeado. |
| `consumo.mesesDeCobertura` | Cuántos meses alcanza el stock al ritmo de consumo. `null` si no hubo consumo (no se puede calcular, no es que sobre). |
| `consumo.ultimoPedido` | Fecha y hora del último pedido que lo incluyó, ISO-8601 en UTC. |
| `devolucion.retornable` | `true` si va y vuelve entero (tachos, contenedores). |
| `devolucion.preguntaAlVolver` | Qué le pregunta el depósito cuando vuelve: `ninguna`, `cuanto_queda` (líquidos, textiles) o `estado` (herramientas). |
| `serviciosAsignados` | En cuántos servicios activos está habilitado para pedir. |
| `visiblePara` | Qué roles lo ven en el catálogo (`supervisor`, `administrativo`, …). |

### Sobre el consumo

Es el mismo número que muestra el panel de stock crítico del sistema. Incluye
los pedidos que el depósito **todavía está preparando**. Por eso puede no
coincidir con sumar a mano las cantidades de `GET /pedidos`, que sólo trae los
pedidos ya retirados.

---

## `GET /insumos/{id}`

La ficha completa de un insumo: todo lo de la lista, más el detalle que en la
lista sería demasiado.

```bash
curl -H "Authorization: Bearer <token>" \
  https://insumos.kazaro.com.ar/api/v1/insumos/100000025
```

Si el insumo no existe —o es de otra empresa— devuelve `404`.

### Respuesta

> Los valores son de ejemplo, para mostrar la forma. No son los datos reales de ese insumo.

```json
{
  "empresaId": 1,
  "insumo": {
    "id": 100000025,
    "codigo": "100000025",
    "nombre": "DESENGRASANTE KAZARO X 5 LTS",
    "...": "(todos los campos de la lista)",

    "stock": {
      "disponible": 4831, "remanente": 0, "enCamino": 0, "dudoso": false,
      "porDeposito": [],
      "enCaminoDetalle": []
    },
    "consumo": {
      "ultimos90Dias": 112, "promedioMensual": 37,
      "mesesDeCobertura": 129.4, "ultimoPedido": "2026-11-03T19:31:07.000Z",
      "porMes": [
        { "mes": "2026-09", "cantidad": 54, "monto": 134751.6, "pedidos": 33 },
        { "mes": "2026-10", "cantidad": 52, "monto": 129760.8, "pedidos": 29 },
        { "mes": "2026-11", "cantidad": 2,  "monto": 4990.8,   "pedidos": 2 }
      ]
    },
    "compras": [
      { "ingresoId": 14, "proveedor": "QUIMICA DEL SUR", "remito": "R-00012345",
        "fecha": "2026-11-05", "estado": "conciliado",
        "factura": "A-0001-00007777", "fechaFactura": "2026-11-06",
        "cantidad": 60, "precioUnitario": 1500 }
    ],
    "devoluciones": [
      { "estado": "aprobada", "tipo": "no_usado", "veces": 3, "cantidad": 5 }
    ],
    "servicios": [
      { "id": 904, "nombre": "ESCUELA N° 12 - RIO CUARTO" }
    ],
    "historial": [
      { "fecha": "2026-10-27T09:38:30.000Z", "tipo": "devolucion", "campo": "stock",
        "anterior": 4835, "nuevo": 4837, "diferencia": 2, "usuario": "Deposito" }
    ]
  }
}
```

### Campos que agrega el detalle

| Campo | Qué es |
|---|---|
| `stock.porDeposito` | Stock en cada depósito secundario: `{ id, nombre, cantidad }`. Vacío si sólo está en el general. |
| `stock.enCaminoDetalle` | Cada llegada prevista: `{ cantidad, llega }`. |
| `consumo.porMes` | Los últimos 12 meses con movimiento: `{ mes, cantidad, monto, pedidos }`. `mes` es `aaaa-mm` en hora argentina. Los meses sin pedidos no aparecen. |
| `compras` | Las últimas 20 entradas de mercadería de ese insumo. `estado` es `conciliado` (la factura del proveedor ya se comparó con el remito y el stock subió) o `sin_conciliar` (el remito llegó pero falta la factura: `factura` y `precioUnitario` en `null`). |
| `devoluciones` | Resumen de devoluciones agrupado por `estado` y `tipo`, con cuántas `veces` y qué `cantidad` total. |
| `servicios` | Todos los servicios activos donde está habilitado: `{ id, nombre }`. Los `id` son los mismos de `GET /servicios` y del filtro `servicioId` de `GET /pedidos`. |
| `historial` | Los últimos 50 cambios: precio, stock, nombre, etc. `diferencia` sólo viene en los campos numéricos. `usuario` es quien hizo el cambio. |

---

## `GET /categorias`

Las categorías y los rubros, para saber qué ids usar en los filtros.

```json
{
  "empresaId": 1,
  "categorias": [
    { "id": 3, "nombre": "Bolsa", "insumosActivos": 10 },
    { "id": 2, "nombre": "Liquidos", "insumosActivos": 53 }
  ],
  "rubros": [
    { "id": 1, "nombre": "Limpieza",
      "criterio": "Lo que usa el operario para limpiar: químicos (...) y elementos (...).",
      "insumosActivos": 140 }
  ]
}
```

**Categoría** y **rubro** son dos clasificaciones distintas. La categoría es la
del catálogo (cómo se agrupa para pedir). El rubro es para qué se usa, y decide
qué insumos le tocan a cada servicio.

---

## Errores

Todos los errores tienen la misma forma:

```json
{ "error": "codigo_del_error", "mensaje": "Explicación en castellano." }
```

| Código HTTP | `error` | Cuándo |
|---|---|---|
| `400` | `parametro_invalido` | Un parámetro tiene mal formato. Trae además `campo` con cuál. |
| `401` | `falta_token` | No se mandó el token. |
| `403` | `token_invalido` | El token no es válido. |
| `404` | `no_encontrado` | El insumo no existe, o es de otra empresa. |
| `405` | `metodo_no_permitido` | Se usó un método que no es `GET`. |
| `429` | `demasiadas_consultas` | Se pasaron las 60 consultas por minuto. |
| `500` | `error_interno` | Falla del servidor. Reintentar más tarde. |
| `503` | `api_no_configurada` | El servidor no tiene tokens cargados. |

Ejemplo de un `400`:

```json
{ "error": "parametro_invalido", "campo": "categoriaId", "mensaje": "Debe ser un número entero." }
```

---

## Recorrer todas las páginas

```python
import requests, time

BASE = "https://insumos.kazaro.com.ar/api/v1"
HEADERS = {"Authorization": "Bearer <token>"}

def todos_los_insumos():
    page = 1
    while True:
        r = requests.get(f"{BASE}/insumos", headers=HEADERS,
                         params={"page": page, "limit": 500}, timeout=30)
        if r.status_code == 429:
            time.sleep(int(r.headers.get("Retry-After", 5)))
            continue
        r.raise_for_status()
        datos = r.json()
        yield from datos["insumos"]
        if page >= datos["paginado"]["paginas"]:
            return
        page += 1

for insumo in todos_los_insumos():
    if not insumo["stock"]["dudoso"]:
        print(insumo["codigo"], insumo["nombre"], insumo["stock"]["disponible"])
```

---

## Configuración del servidor (uso interno)

Usa los mismos tokens que la API de pedidos: la variable `PEDIDOS_API_TOKENS`
del `.env` de producción. Si ya está cargada, no hay que hacer nada más. Ver
`docs/api-pedidos.md`.
