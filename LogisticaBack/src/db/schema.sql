-- Esquema idempotente: se ejecuta en cada despliegue (npm run migrate).
-- Las listas de valores (plataforma, agencia, etc.) se validan en src/config/catalogos.js.

CREATE TABLE IF NOT EXISTS usuarios (
  id            SERIAL PRIMARY KEY,
  nombre        VARCHAR(120) NOT NULL,
  email         VARCHAR(160) NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  rol           VARCHAR(20)  NOT NULL
                CHECK (rol IN ('admin', 'vendedor', 'planificador', 'almacen', 'repartidor', 'auxiliar')),
  telefono      VARCHAR(30),
  activo        BOOLEAN      NOT NULL DEFAULT true,
  creado_en     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Cuentas creadas desde la página pública "Crear cuenta": esperan aprobación del admin
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS pendiente BOOLEAN NOT NULL DEFAULT false;

-- Contraseña visible para el administrador (solo las que crea o restablece el admin;
-- las elegidas por el propio usuario en "Crear cuenta" no se guardan en claro)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS clave_visible TEXT;

-- Perfil "auxiliar" (auxiliar logístico); 'repartidor' es el conductor
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('admin', 'vendedor', 'planificador', 'almacen', 'repartidor', 'auxiliar'));

-- Departamentos / provincias / distritos del Perú (se cargan desde db/ubigeo.json)
CREATE TABLE IF NOT EXISTS ubigeos (
  codigo       CHAR(6)     PRIMARY KEY,
  departamento VARCHAR(60) NOT NULL,
  provincia    VARCHAR(80) NOT NULL,
  distrito     VARCHAR(80) NOT NULL
);

CREATE TABLE IF NOT EXISTS productos (
  id             SERIAL PRIMARY KEY,
  sku            VARCHAR(60)    NOT NULL UNIQUE,
  descripcion    VARCHAR(255)   NOT NULL,
  precio         NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (precio >= 0),
  activo         BOOLEAN        NOT NULL DEFAULT true,
  creado_en      TIMESTAMPTZ    NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pedidos (
  id                    SERIAL PRIMARY KEY,           -- "Código" del pedido
  plataforma            VARCHAR(30)    NOT NULL,
  numero_pedido         VARCHAR(60),                  -- # Pedido de la plataforma
  documento_bsale       VARCHAR(40),
  tipo_pedido           VARCHAR(40)    NOT NULL,
  vendedor_id           INTEGER        NOT NULL REFERENCES usuarios(id),
  cliente_nombre        VARCHAR(160)   NOT NULL,
  cliente_telefono      VARCHAR(30),
  agencia               VARCHAR(30),
  enviar_a              VARCHAR(30),
  pago_agencia          VARCHAR(30),
  ubigeo                CHAR(6)        REFERENCES ubigeos(codigo),
  direccion             VARCHAR(255),
  detalle_domicilio     VARCHAR(255),
  referencia            VARCHAR(255),
  cod_postal            VARCHAR(10),
  link_ubicacion        TEXT,
  lat                   NUMERIC(10, 7) CHECK (lat BETWEEN -90 AND 90),
  lng                   NUMERIC(10, 7) CHECK (lng BETWEEN -180 AND 180),
  fecha_entrega         DATE           NOT NULL,
  precio_envio          NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (precio_envio >= 0),
  total_pedido          NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_pedido >= 0),
  cobrar                VARCHAR(30)    NOT NULL DEFAULT 'No Cobrar',
  medio_pago            VARCHAR(30),
  nota                  TEXT,
  estado                VARCHAR(20)    NOT NULL DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente', 'ruteado', 'entregado', 'incidencia', 'cancelado')),
  observaciones_almacen TEXT,
  creado_por            INTEGER        REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en             TIMESTAMPTZ    NOT NULL DEFAULT now(),   -- "Marca temporal"
  actualizado_en        TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pedido_items (
  id              SERIAL PRIMARY KEY,
  pedido_id       INTEGER        NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id     INTEGER        REFERENCES productos(id) ON DELETE SET NULL,
  sku             VARCHAR(60)    NOT NULL,        -- copia: el catálogo puede cambiar después
  descripcion     VARCHAR(255)   NOT NULL,
  cantidad        INTEGER        NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(10, 2) NOT NULL CHECK (precio_unitario >= 0),
  subtotal        NUMERIC(12, 2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED
);

-- Auditoría: quién cambió qué y cuándo (ediciones, estados, reprogramaciones…)
CREATE TABLE IF NOT EXISTS pedido_historial (
  id         SERIAL PRIMARY KEY,
  pedido_id  INTEGER     NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  usuario_id INTEGER     REFERENCES usuarios(id) ON DELETE SET NULL,
  accion     VARCHAR(40) NOT NULL,
  detalle    JSONB,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rutas (
  id                SERIAL PRIMARY KEY,
  fecha             DATE        NOT NULL,
  nombre            VARCHAR(80),
  repartidor_id     INTEGER     REFERENCES usuarios(id),  -- conductor (puede asignarse después)
  asistente_id      INTEGER     REFERENCES usuarios(id) ON DELETE SET NULL,
  estado            VARCHAR(20) NOT NULL DEFAULT 'planificada'
                    CHECK (estado IN ('planificada', 'en_curso', 'finalizada')),
  distancia_metros  INTEGER,
  duracion_segundos INTEGER,
  polyline          TEXT,        -- trazado de Google Routes API; se borra si cambian las paradas
  creado_por        INTEGER     REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una parada es un pedido o una "acción" libre (p. ej. recoger en almacén, despacho a Falabella)
CREATE TABLE IF NOT EXISTS ruta_paradas (
  id            SERIAL PRIMARY KEY,
  ruta_id       INTEGER      NOT NULL REFERENCES rutas(id) ON DELETE CASCADE,
  orden         INTEGER      NOT NULL,
  pedido_id     INTEGER      REFERENCES pedidos(id) ON DELETE CASCADE,
  descripcion   VARCHAR(255),
  direccion     VARCHAR(255),
  lat           NUMERIC(10, 7),
  lng           NUMERIC(10, 7),
  estado        VARCHAR(20)  NOT NULL DEFAULT 'pendiente'
                CHECK (estado IN ('pendiente', 'completada', 'incidencia')),
  nota          TEXT,
  completada_en TIMESTAMPTZ,
  CHECK (pedido_id IS NOT NULL OR descripcion IS NOT NULL)
);

-- Posiciones GPS que envía la app del repartidor
CREATE TABLE IF NOT EXISTS posiciones (
  id            BIGSERIAL PRIMARY KEY,
  usuario_id    INTEGER        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ruta_id       INTEGER        REFERENCES rutas(id) ON DELETE SET NULL,
  lat           NUMERIC(10, 7) NOT NULL,
  lng           NUMERIC(10, 7) NOT NULL,
  precision_m   REAL,
  velocidad     REAL,
  rumbo         REAL,
  registrado_en TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pedidos_fecha_estado ON pedidos(fecha_entrega, estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_vendedor ON pedidos(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_items_pedido ON pedido_items(pedido_id);
CREATE INDEX IF NOT EXISTS idx_historial_pedido ON pedido_historial(pedido_id);
CREATE INDEX IF NOT EXISTS idx_rutas_fecha ON rutas(fecha);
CREATE INDEX IF NOT EXISTS idx_paradas_ruta ON ruta_paradas(ruta_id, orden);
-- (la unicidad de la parada activa por pedido se define más abajo: uq_paradas_pedido_activa)
CREATE INDEX IF NOT EXISTS idx_posiciones_usuario ON posiciones(usuario_id, registrado_en DESC);

-- ============================================================
-- Rutas numeradas, vehículos, historial y chat
-- ============================================================

CREATE TABLE IF NOT EXISTS vehiculos (
  id        SERIAL PRIMARY KEY,
  nombre    VARCHAR(60) NOT NULL,
  tipo      VARCHAR(20) NOT NULL CHECK (tipo IN ('auto', 'moto', 'bicicleta', 'furgoneta', 'otro')),
  placa     VARCHAR(15),
  activo    BOOLEAN     NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Flota inicial (solo si la tabla está vacía)
INSERT INTO vehiculos (nombre, tipo)
SELECT v.nombre, v.tipo FROM (VALUES ('Auto 1', 'auto'), ('Auto 2', 'auto'), ('Bicicleta 1', 'bicicleta')) AS v(nombre, tipo)
WHERE NOT EXISTS (SELECT 1 FROM vehiculos);

-- Cada ruta del día tiene un número (Ruta 1, Ruta 2…) y un vehículo; el conductor puede asignarse después
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS numero INTEGER;
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS vehiculo_id INTEGER REFERENCES vehiculos(id) ON DELETE SET NULL;
ALTER TABLE rutas ALTER COLUMN repartidor_id DROP NOT NULL;
UPDATE rutas r SET numero = x.n
FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY fecha ORDER BY id) AS n FROM rutas) x
WHERE r.id = x.id AND r.numero IS NULL;
ALTER TABLE rutas ALTER COLUMN numero SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rutas_fecha_numero ON rutas(fecha, numero);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rutas_fecha_vehiculo ON rutas(fecha, vehiculo_id) WHERE vehiculo_id IS NOT NULL;

-- Historial: un pedido puede tener varias paradas (p. ej. incidencia en la Ruta 1 y entrega al día
-- siguiente en la Ruta 2). Solo puede tener UNA parada activa (pendiente) a la vez.
DROP INDEX IF EXISTS uq_paradas_pedido;
CREATE UNIQUE INDEX IF NOT EXISTS uq_paradas_pedido_activa ON ruta_paradas(pedido_id)
  WHERE pedido_id IS NOT NULL AND estado = 'pendiente';
CREATE INDEX IF NOT EXISTS idx_paradas_pedido ON ruta_paradas(pedido_id);

-- Chat de cada ruta (web y app del conductor)
CREATE TABLE IF NOT EXISTS ruta_mensajes (
  id         BIGSERIAL PRIMARY KEY,
  ruta_id    INTEGER     NOT NULL REFERENCES rutas(id) ON DELETE CASCADE,
  usuario_id INTEGER     REFERENCES usuarios(id) ON DELETE SET NULL,
  texto      TEXT        NOT NULL CHECK (length(texto) BETWEEN 1 AND 2000),
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mensajes_ruta ON ruta_mensajes(ruta_id, id);

-- Despacho: almacén marca qué pedidos de la ruta ya entregó al conductor
ALTER TABLE ruta_paradas ADD COLUMN IF NOT EXISTS despachado_en TIMESTAMPTZ;
ALTER TABLE ruta_paradas ADD COLUMN IF NOT EXISTS despachado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
