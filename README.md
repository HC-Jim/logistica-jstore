# Logística JStore

Sistema de despachos que reemplaza el flujo **Google Sheets + AppSheet + Shipday**:
registro de pedidos con ubicación exacta del cliente, planificación de rutas por repartidor,
monitoreo en vivo (ruta, posición del conductor y entregas) y estadísticas.
Los conductores y asistentes usan una app Flutter aparte que consume esta misma API.

| Capa | Tecnología | Carpeta | Despliegue |
|------|------------|---------|------------|
| Modelo + Controlador (API REST) | Node.js 24, Express 5, `pg` | `LogisticaBack/` | Vercel (función serverless) |
| Vista web | Next.js 16 + React 19, Recharts, `@vis.gl/react-google-maps` | `LogisticaFront/` | Vercel |
| App de repartidores | Flutter (otro proyecto) | — | [docs/API-app-repartidor.md](docs/API-app-repartidor.md) |
| Base de datos | PostgreSQL | `LogisticaBack/src/db/schema.sql` | Neon |

## Flujo

```
Vendedor registra pedido ──► pendiente ("sin rutear")
  (formulario web: datos, productos por SKU, ubicación en el mapa / link de Google Maps)
        │
Planificador arma rutas por fecha ──► ruteado  (repartidor + asistente, orden, Optimizar con Google)
        │
App Flutter: conductor marca cada parada ──► entregado  /  incidencia ──► se reprograma ──► pendiente
        │                                  envía GPS cada ~30 s
Monitoreo web: ruta, posición del conductor y estado de cada parada (pestañas por ruta, refresco 15 s)

En cualquier momento antes de entregar: cancelado (con motivo) o reprogramado (sale de su ruta).
Todo cambio queda en el historial del pedido (quién, cuándo, qué cambió).
```

## Rutas

- Cada día se muestran **Ruta 1, 2 y 3** (`RUTAS_POR_DEFECTO` en `LogisticaBack/src/config/catalogos.js`);
  con **+ Agregar ruta** se abren más según la demanda.
- Cada ruta tiene **vehículo** (catálogo en *Vehículos*: autos, bicicleta, eventuales), **conductor** y
  **auxiliar logístico**. Un vehículo no puede estar en dos rutas el mismo día.
- **Historial de rutas**: todas las rutas realizadas con sus pedidos, entregas e incidencias. Si un pedido
  tuvo incidencia y se reprogramó, la parada queda registrada en la ruta original.
- **Cierre del día**: una ruta solo se finaliza sin pedidos pendientes; el Dashboard alerta sobre pedidos de
  días anteriores que no quedaron entregados ni cancelados.
- **Chat por ruta** entre logística y el conductor/auxiliar (misma API para la app móvil).
- **Despacho / Hoja de ruta**: la tabla que antes se enviaba por WhatsApp se genera sola por ruta, con botones
  para enviarla por WhatsApp (con link de Google Maps por parada), copiar, imprimir/PDF y descargar Excel.
  Almacén marca con un check cada pedido entregado al conductor (queda quién y a qué hora).

## Roles

| Rol | Puede |
|-----|-------|
| **Vendedor** | Registrar pedidos (a su nombre), ver **solo sus ventas** y editar en ellas solo: cliente, contacto, agencia, enviar a, pago de agencia, departamento/provincia/distrito, dirección, detalle, referencia, cód. postal, ubicación, precio de envío, total, cobrar, medio de pago y nota. Reprogramar sus pedidos. |
| **Planificador** | Todo lo de pedidos (incluye productos, plataforma, Bsale…), cambiar estados, cancelar, reprogramar, rutas, monitoreo, productos, estadísticas. |
| **Almacén** | Ver pedidos y monitoreo, escribir *Observaciones de almacén*. |
| **Repartidor** | Solo la app móvil: su ruta, marcar entregas/incidencias, enviar GPS. |
| **Admin** | Todo + usuarios. |

Los permisos se definen en `LogisticaBack/src/config/permisos.js` y las listas de opciones
(plataformas, tipos de pedido, agencias, medios de pago…) en `LogisticaBack/src/config/catalogos.js`.

## Estructura

```
LogisticaBack/
├── api/index.js                 # entrada serverless para Vercel
├── vercel.json
└── src/
    ├── config/  env, db, catalogos (listas), permisos (roles)
    ├── db/      schema.sql, migrate.js, seed.js, ubigeo.json (1893 distritos)
    ├── models/  pedido, ruta, producto, usuario, estadistica (SQL)
    ├── controllers/  validan la petición y aplican permisos
    ├── services/     rutas (Google Routes API), ubicacion (links de Google Maps)
    ├── middlewares/  JWT, roles, errores
    └── routes/index.js

LogisticaFront/src/
├── app/         rutas de Next.js: login, (panel)/pedidos, rutas, monitoreo, productos, usuarios
├── views/       pantallas
├── components/  Layout, mapas, selector de ubicación, ubigeo, buscador de productos
├── context/     sesión y catálogos
└── api/         cliente HTTP
```

### Tablas

`usuarios`, `ubigeos`, `productos` (SKU), `pedidos`, `pedido_items` (uno o más productos, con SKU, cantidad,
precio y subtotal), `pedido_historial`, `rutas`, `ruta_paradas` (pedido o acción libre), `posiciones` (GPS).
El **Código** del pedido es su `id`. Para continuar la numeración de la hoja actual (p. ej. desde 27200):

```sql
ALTER SEQUENCE pedidos_id_seq RESTART WITH 27200;
```

## Google Maps

En Google Cloud habilita y crea dos claves:

1. **Navegador** (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`): *Maps JavaScript API* + *Geocoding API*.
   Restríngela por *HTTP referrers* a `http://localhost:3000/*` y al dominio del frontend en Vercel.
2. **Servidor** (`GOOGLE_MAPS_SERVER_KEY`): *Routes API*. Se usa para trazar y **optimizar** rutas (máx. 25 paradas).

Sin claves la app funciona, pero sin mapas ni trazado (la ubicación se puede cargar con el link de Google Maps).

## Productos (CSV)

En *Productos → Importar CSV*. Columnas: `sku`, `descripcion`, `precio` (acepta también "código", "producto",
"nombre"). Separador `,` o `;`. Los SKU existentes se actualizan y los nuevos se crean. Desde Excel:
*Guardar como → CSV UTF-8* (si se guarda como CSV normal también se detecta).

## Desarrollo local

Requisitos: Node 24. La base de datos es **Neon**: crea una rama `dev` (*Branches → Create branch*) para no
tocar los datos de producción.

```bash
# Backend (http://localhost:4000)
cd LogisticaBack
cp .env.example .env      # URLs de la rama dev de Neon, JWT_SECRET, ADMIN_*, claves de Google
npm install
npm run migrate           # tablas, ubigeos y usuario admin
npm run seed              # (opcional, solo dev) usuarios demo por rol, productos y pedidos
npm run dev

# Frontend (http://localhost:3000)
cd LogisticaFront
cp .env.example .env.local
npm install
npm run dev
```

## Despliegue: Vercel + Neon

Dos proyectos de Vercel desde el mismo repositorio de GitHub.

**Backend** — Root Directory `LogisticaBack`, preset *Other*.
1. *Storage → Create Database → Neon*: agrega `DATABASE_URL` y `DATABASE_URL_UNPOOLED`.
2. Variables: `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `APP_TIMEZONE=America/Lima`,
   `GOOGLE_MAPS_SERVER_KEY`, `DEPOSITO_NOMBRE`, `DEPOSITO_LAT`, `DEPOSITO_LNG`.
3. Deploy: `vercel-build` ejecuta las migraciones. Verifica `/api/health`.

**Frontend** — Root Directory `LogisticaFront`, preset *Next.js*.
1. Variables: `API_URL=https://<backend>.vercel.app`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAP_ID`.
2. Deploy (si cambias variables, vuelve a desplegar).

La app Flutter apunta a `https://<backend>.vercel.app/api`.

## Créditos

Datos de ubigeo del Perú: paquete [`peru-ubigeo`](https://github.com/Komarcalabs/ubigeoperu) (licencia MIT).
