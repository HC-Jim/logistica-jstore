# API para la app del repartidor (Flutter)

Base: `https://<backend>.vercel.app/api` · JSON · autenticación con `Authorization: Bearer <token>`.

Solo pueden usar estos endpoints los usuarios con perfil **Conductor** (`rol: "repartidor"`) o
**Auxiliar logístico** (`rol: "auxiliar"`). Se crean desde la web en *Usuarios*. El auxiliar asignado a una
ruta ve y atiende la misma ruta que el conductor.

## 1. Login

`POST /auth/login`

```json
{ "email": "enrique@empresa.com", "password": "••••••" }
```

Respuesta `200`:

```json
{ "token": "eyJ…", "usuario": { "id": 6, "nombre": "Enrique", "rol": "repartidor", "telefono": null } }
```

El token dura 8 h (`JWT_EXPIRES_IN`). Ante un `401`, vuelve a pedir el login.

## 2. Mis rutas del día

`GET /repartidor/rutas?fecha=YYYY-MM-DD` (sin `fecha` = hoy, hora de Lima)

```json
{
  "deposito": { "nombre": "Almacén principal", "lat": -12.04, "lng": -77.04 },
  "rutas": [{
    "id": 3, "fecha": "2026-10-08", "nombre": "Este",
    "estado": "planificada | en_curso | finalizada",
    "repartidor_id": 6, "repartidor_nombre": "Enrique", "asistente_nombre": null,
    "distancia_metros": 18400, "duracion_segundos": 3100,
    "polyline": "…",              // trazado codificado (Google encoded polyline) o null
    "paradas": [{
      "id": 15,                    // ← id de la PARADA (se usa para marcar entregado)
      "orden": 1,
      "estado": "pendiente | completada | incidencia",
      "pedido_id": 8,              // null si es una acción libre (p. ej. "Recoger en almacén")
      "titulo": "Fritz Cueva",
      "descripcion": null,         // texto de la acción libre
      "lat": -12.0262, "lng": -76.9192,
      "direccion": "Av. Central 309", "detalle_domicilio": null, "referencia": "Esquina del parque…",
      "distrito": "Ate", "provincia": "Lima", "departamento": "Lima",
      "link_ubicacion": "https://maps.app.goo.gl/…",
      "cliente_nombre": "Fritz Cueva", "cliente_telefono": "991468004",
      "tipo_pedido": "Delivery", "agencia": null, "documento_bsale": "FA01-43",
      "cobrar": "Cobrar Total", "total_pedido": 701, "precio_envio": 15, "medio_pago": "Yape",
      "nota_pedido": "Llamar antes",
      "items": [{ "sku": "SEVX-C17", "descripcion": "Silla Evox Ultimate C17 Negro", "cantidad": 1, "subtotal": 654 }],
      "nota": null, "completada_en": null
    }],
    "posicion": { "lat": -12.03, "lng": -76.925, "registrado_en": "…" }
  }]
}
```

Para navegar a una parada, abre Google Maps / Waze con `lat,lng`.

## 3. Iniciar ruta

`POST /repartidor/rutas/:id/iniciar` → pasa la ruta a `en_curso` (también ocurre sola al marcar la primera parada).

## 4. Marcar una parada

`PATCH /repartidor/paradas/:paradaId`

```json
{ "estado": "completada" }
{ "estado": "incidencia", "nota": "Cliente no contestó" }   // la nota es obligatoria
```

- `completada` → el pedido pasa a **entregado**.
- `incidencia` → el pedido pasa a **incidencia** y logística decide si lo reprograma o cancela.
- Al atender la última parada la ruta pasa a `finalizada`.
- Respuesta: la ruta completa actualizada.

## 5. Enviar posición GPS

`POST /repartidor/ubicacion` → `204`

```json
{ "lat": -12.0301, "lng": -76.9255, "precision": 8, "velocidad": 9.2, "rumbo": 135, "ruta_id": 3 }
```

- `velocidad` en m/s, `rumbo` en grados, `precision` en metros (todos opcionales).
- `ruta_id` es opcional: si no se envía se asocia a la ruta en curso de hoy.
- Recomendado: cada **20–30 s** mientras la ruta está en curso (y solo si cambió la posición).
  El panel de monitoreo se actualiza cada 15 s y marca "sin señal" después de 10 min.

## 6. Chat de la ruta

El mismo chat que ve logística en la web (Rutas → Ruta N, y Monitoreo).

`GET /rutas/:rutaId/mensajes?despues=<ultimoId>` → mensajes nuevos (sin `despues`: los últimos 200)

```json
[{ "id": 42, "ruta_id": 3, "texto": "Recibido, salgo a las 9", "creado_en": "…",
   "usuario_id": 6, "usuario_nombre": "Enrique", "usuario_rol": "repartidor" }]
```

`POST /rutas/:rutaId/mensajes` → `201` con el mensaje creado

```json
{ "texto": "Cliente pide que llame antes" }
```

- Solo el conductor y el auxiliar asignados a la ruta (y logística) pueden leer o escribir.
- Recomendado: consultar cada 5–10 s con `despues=<id del último mensaje>` mientras el chat está abierto.

## Datos de la ruta

Cada ruta trae `numero` (Ruta 1, 2, 3…), `vehiculo_nombre`, `vehiculo_tipo` (`auto`, `moto`, `bicicleta`,
`furgoneta`, `otro`) y `vehiculo_placa`. Las paradas con estado `completada` o `incidencia` son historial:
la app solo debe permitir marcar las que están `pendiente`.

## Errores

`{ "error": "mensaje" }` con `400` (datos inválidos), `401` (sin sesión), `403` (no es tu ruta),
`404` (no existe), `409` (estado no permite la acción, p. ej. ruta finalizada).
