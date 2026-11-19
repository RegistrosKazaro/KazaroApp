# API de insumos — PAZAR

Solo lectura (GET). JSON. El token define la empresa: devuelve solo insumos de Pazar.

- **Base:** `https://insumos.kazaro.com.ar/api/v1`
- **Token** (cualquiera de los dos headers):
  ```
  Authorization: Bearer <token>
  X-API-Key: <token>
  ```
- **Límite:** 60 consultas por minuto. Si se pasa → `429` (esperar `Retry-After` segundos).
- Usar desde un servidor, no desde un navegador (el token quedaría a la vista).

---

## Probar el token
```bash
curl -H "Authorization: Bearer <token>" https://insumos.kazaro.com.ar/api/v1/ping
```
```json
{ "ok": true, "empresaId": 2 }
```

---

## `GET /insumos` — lista de insumos activos

| Parámetro | Uso |
|---|---|
| `q` | Busca en nombre o código (sin importar acentos ni mayúsculas) |
| `codigo` | Código exacto (`4` = `004`) |
| `categoriaId` / `rubroId` | Filtros (ids en `/categorias`) |
| `page` | Página, desde 1 |
| `limit` | Por página, máx. 500 (default 100) |

```bash
curl -H "Authorization: Bearer <token>" \
  "https://insumos.kazaro.com.ar/api/v1/insumos?limit=500&page=1"
```

```json
{
  "empresaId": 2,
  "paginado": { "page": 1, "limit": 500, "total": 226, "paginas": 1 },
  "insumos": [
    {
      "id": 100000219,
      "codigo": "100000219",
      "nombre": "ACEITE 10W40",
      "activo": true,
      "categoria": { "id": 11, "nombre": "Aceites / Grasa" },
      "rubros": [],
      "precio": 4339.84,
      "ultimoPrecioCompra": null,
      "stock": { "disponible": 10000, "remanente": 0, "enCamino": 0, "dudoso": true },
      "consumo": { "ultimos90Dias": 0, "promedioMensual": 0, "mesesDeCobertura": null, "ultimoPedido": null },
      "serviciosAsignados": 89
    }
  ]
}
```

Notas:
- Solo vienen insumos **activos**. Si uno se da de baja, deja de venir: darlo de baja de su lado.
- `precio`: precio de referencia del sistema (no es el de compra).
- `stock.dudoso: true`: stock de 10.000 o más = valor de arranque, no mercadería contada (hoy, todo Pazar).
- `consumo`: neto de devoluciones, últimos 90 días.
- Los datos están siempre actualizados: un cambio se ve en la consulta siguiente.

---

## `GET /insumos/{id}` — ficha completa

```bash
curl -H "Authorization: Bearer <token>" \
  https://insumos.kazaro.com.ar/api/v1/insumos/100000219
```

Agrega a la lista:
- `stock.porDeposito`, `stock.enCaminoDetalle`
- `consumo.porMes`: últimos 12 meses (`mes`, `cantidad`, `monto`, `pedidos`)
- `compras`: últimas 20 entradas de mercadería
- `devoluciones`: resumen por estado y tipo
- `servicios`: dónde está habilitado (`id`, `nombre`)
- `historial`: últimos 50 cambios (precio, stock, nombre…)

Si no existe o está dado de baja → `404`.

---

## `GET /categorias` — ids para los filtros

```bash
curl -H "Authorization: Bearer <token>" https://insumos.kazaro.com.ar/api/v1/categorias
```
Devuelve `categorias` y `rubros`, con `id`, `nombre` e `insumosActivos`.

---

## Errores

Formato: `{ "error": "codigo", "mensaje": "..." }`

| HTTP | `error` | Cuándo |
|---|---|---|
| 400 | `parametro_invalido` | Parámetro mal formado (trae `campo`) |
| 401 | `falta_token` | No se mandó el token |
| 403 | `token_invalido` | Token incorrecto |
| 404 | `no_encontrado` | No existe o está dado de baja |
| 405 | `metodo_no_permitido` | Método distinto de GET |
| 429 | `demasiadas_consultas` | Más de 60 por minuto |
| 500 | `error_interno` | Falla del servidor, reintentar |

---

## Traer todo el catálogo (ejemplo Python)

```python
import requests, time

BASE = "https://insumos.kazaro.com.ar/api/v1"
HEADERS = {"Authorization": "Bearer <token>"}

def todos_los_insumos():
    page = 1
    while True:
        r = requests.get(f"{BASE}/insumos", headers=HEADERS,
                         params={"page": page, "limit": 500}, timeout=30)
        if r.status_code == 429:                      # se pasó del límite: esperar
            time.sleep(int(r.headers.get("Retry-After", 5)))
            continue
        r.raise_for_status()
        datos = r.json()
        yield from datos["insumos"]
        if page >= datos["paginado"]["paginas"]:      # última página
            return
        page += 1
```
