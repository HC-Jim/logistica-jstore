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
-- (la lista de perfiles permitidos se define más abajo, junto a "varios perfiles por usuario")

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
-- Un vehículo físico no puede estar en dos rutas el mismo día: lo valida la API (validarVehiculo),
-- porque "A pie" y "Transporte público" sí pueden repetirse.
DROP INDEX IF EXISTS uq_rutas_fecha_vehiculo;

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

-- ============================================================
-- Logística inversa, encargos, ubicaciones frecuentes e historial de rutas
-- ============================================================

-- Puntos recurrentes: almacén de Falabella, otros almacenes, proveedores, agencias…
CREATE TABLE IF NOT EXISTS ubicaciones (
  id         SERIAL PRIMARY KEY,
  nombre     VARCHAR(120) NOT NULL,
  tipo       VARCHAR(20)  NOT NULL DEFAULT 'otro'
             CHECK (tipo IN ('almacen_propio', 'almacen_externo', 'proveedor', 'agencia', 'cliente', 'otro')),
  direccion  VARCHAR(255),
  ubigeo     CHAR(6) REFERENCES ubigeos(codigo),
  referencia VARCHAR(255),
  contacto   VARCHAR(120),
  telefono   VARCHAR(30),
  lat        NUMERIC(10, 7) NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng        NUMERIC(10, 7) NOT NULL CHECK (lng BETWEEN -180 AND 180),
  activo     BOOLEAN      NOT NULL DEFAULT true,
  creado_en  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Categoría del registro: venta, logística inversa o encargo logístico
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS categoria VARCHAR(10) NOT NULL DEFAULT 'venta';
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_categoria_check;
ALTER TABLE pedidos ADD CONSTRAINT pedidos_categoria_check CHECK (categoria IN ('venta', 'inversa', 'encargo'));
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS motivo VARCHAR(40);                 -- logística inversa
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pedido_relacionado VARCHAR(60);     -- pedido original (código o # pedido)
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE SET NULL;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS origen_ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE SET NULL;
UPDATE pedidos SET categoria = 'inversa' WHERE plataforma = 'Log. Inversa' AND categoria = 'venta';
CREATE INDEX IF NOT EXISTS idx_pedidos_categoria ON pedidos(categoria, fecha_entrega);

-- Auditoría de rutas: quién cambió qué (equipo, paradas, despacho, entregas, cierre)
CREATE TABLE IF NOT EXISTS ruta_historial (
  id         BIGSERIAL PRIMARY KEY,
  ruta_id    INTEGER     NOT NULL REFERENCES rutas(id) ON DELETE CASCADE,
  usuario_id INTEGER     REFERENCES usuarios(id) ON DELETE SET NULL,
  accion     VARCHAR(40) NOT NULL,
  detalle    JSONB,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ruta_historial ON ruta_historial(ruta_id, id);

-- ============================================================
-- Notificaciones (bandeja en web y app) y dispositivos para push (FCM)
-- ============================================================
CREATE TABLE IF NOT EXISTS notificaciones (
  id         BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo       VARCHAR(30)  NOT NULL,
  titulo     VARCHAR(120) NOT NULL,
  cuerpo     VARCHAR(500),
  url        VARCHAR(255),           -- a dónde lleva en la web (p. ej. /rutas/12)
  datos      JSONB,                  -- ruta_id, pedido_id, fecha… (la app los usa para abrir la pantalla)
  leida      BOOLEAN      NOT NULL DEFAULT false,
  creado_en  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario ON notificaciones(usuario_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_notificaciones_no_leidas ON notificaciones(usuario_id) WHERE NOT leida;

CREATE TABLE IF NOT EXISTS dispositivos (
  id         SERIAL PRIMARY KEY,
  usuario_id INTEGER      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token      TEXT         NOT NULL UNIQUE,   -- token de Firebase Cloud Messaging
  plataforma VARCHAR(10)  NOT NULL DEFAULT 'android',
  creado_en  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  usado_en   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dispositivos_usuario ON dispositivos(usuario_id);

-- ============================================================
-- Seguimiento en vivo: foto de entrega, paradas canceladas en ruta y camino restante
-- ============================================================
ALTER TABLE ruta_paradas ADD COLUMN IF NOT EXISTS foto_url TEXT;
ALTER TABLE ruta_paradas DROP CONSTRAINT IF EXISTS ruta_paradas_estado_check;
ALTER TABLE ruta_paradas ADD CONSTRAINT ruta_paradas_estado_check
  CHECK (estado IN ('pendiente', 'completada', 'incidencia', 'cancelada'));

ALTER TABLE rutas ADD COLUMN IF NOT EXISTS finalizada_en      TIMESTAMPTZ;
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS restante_polyline  TEXT;        -- conductor → pendientes → almacén
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS restante_tramo     TEXT;        -- conductor → próximo destino
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS restante_distancia INTEGER;
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS restante_duracion  INTEGER;
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS restante_destino   JSONB;
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS restante_clave     TEXT;        -- paradas pendientes usadas en el cálculo
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS restante_en        TIMESTAMPTZ;

-- Último ingreso de cada cuenta (reporte de usuarios)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_acceso TIMESTAMPTZ;

-- Movilidad sin vehículo propio: a pie o en transporte público (bus, tren eléctrico)
ALTER TABLE vehiculos DROP CONSTRAINT IF EXISTS vehiculos_tipo_check;
ALTER TABLE vehiculos ADD CONSTRAINT vehiculos_tipo_check
  CHECK (tipo IN ('auto', 'moto', 'bicicleta', 'furgoneta', 'a_pie', 'transporte_publico', 'otro'));
INSERT INTO vehiculos (nombre, tipo)
SELECT v.nombre, v.tipo FROM (VALUES ('A pie', 'a_pie'), ('Transporte público', 'transporte_publico')) AS v(nombre, tipo)
WHERE NOT EXISTS (SELECT 1 FROM vehiculos x WHERE x.tipo = v.tipo);

-- Varios perfiles por usuario (rol = perfil principal = roles[1]), Administrador de Catálogo y perfiles de RRHH
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('admin', 'vendedor', 'planificador', 'almacen', 'repartidor', 'auxiliar', 'catalogo', 'rrhh', 'jefe', 'colaborador'));
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS roles TEXT[];
-- Mantiene rol y roles en sincronía aunque se cree o edite un usuario solo con "rol"
CREATE OR REPLACE FUNCTION usuarios_sincronizar_roles() RETURNS trigger AS $$
BEGIN
  IF NEW.roles IS NULL OR cardinality(NEW.roles) = 0 THEN
    NEW.roles := ARRAY[NEW.rol];
  ELSIF TG_OP = 'UPDATE' AND NEW.rol IS DISTINCT FROM OLD.rol AND NEW.roles = OLD.roles THEN
    NEW.roles := ARRAY[NEW.rol]; -- solo cambiaron el perfil principal: pasa a ser el único
  ELSE
    NEW.rol := NEW.roles[1];
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS usuarios_roles ON usuarios;
CREATE TRIGGER usuarios_roles BEFORE INSERT OR UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION usuarios_sincronizar_roles();
UPDATE usuarios SET roles = ARRAY[rol] WHERE roles IS NULL OR cardinality(roles) = 0;
ALTER TABLE usuarios ALTER COLUMN roles SET NOT NULL;
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_roles_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_roles_check CHECK (
  cardinality(roles) > 0 AND rol = roles[1]
  AND roles <@ ARRAY['admin', 'vendedor', 'planificador', 'almacen', 'repartidor', 'auxiliar', 'catalogo', 'rrhh', 'jefe', 'colaborador']::text[]
);
CREATE INDEX IF NOT EXISTS idx_usuarios_roles ON usuarios USING gin (roles);

-- ============================================================
-- Módulo Productos: matriz de categorías, marcas, ficha del SKU y combos
-- ============================================================
CREATE TABLE IF NOT EXISTS categorias (
  id      SERIAL PRIMARY KEY,
  codigo  VARCHAR(2)   NOT NULL UNIQUE CHECK (codigo ~ '^[0-9]{2}$'),
  nombre  VARCHAR(120) NOT NULL,
  activo  BOOLEAN      NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS subcategorias (
  id            SERIAL PRIMARY KEY,
  categoria_id  INTEGER      NOT NULL REFERENCES categorias(id) ON DELETE RESTRICT,
  codigo        VARCHAR(2)   NOT NULL CHECK (codigo ~ '^[0-9]{2}$'),
  nombre        VARCHAR(120) NOT NULL,
  activo        BOOLEAN      NOT NULL DEFAULT true,
  UNIQUE (categoria_id, codigo)
);

-- Marcas: propias (descuento mayorista propio) y segmento del portafolio (Core, Growth, Traffic, Profit, Volume)
CREATE TABLE IF NOT EXISTS marcas (
  id        SERIAL PRIMARY KEY,
  nombre    VARCHAR(60) NOT NULL UNIQUE,
  propia    BOOLEAN     NOT NULL DEFAULT false,
  segmento  VARCHAR(10) CHECK (segmento IN ('Core', 'Growth', 'Traffic', 'Profit', 'Volume')),
  activo    BOOLEAN     NOT NULL DEFAULT true
);
INSERT INTO marcas (nombre, propia, segmento) VALUES
  ('Evox', true, 'Core'), ('Vibra+', true, 'Growth'), ('Festify', false, 'Growth'), ('Nacional', false, 'Traffic'),
  ('Importado', true, 'Profit'), ('Herracom', false, 'Volume'), ('Greenwon', true, NULL)
ON CONFLICT (nombre) DO NOTHING;

-- Ficha completa del SKU (columnas del GENERADOR_SKU). "descripcion" es el Nombre Almacén y "precio" el precio Web.
ALTER TABLE productos ADD COLUMN IF NOT EXISTS subcategoria_id     INTEGER REFERENCES subcategorias(id) ON DELETE RESTRICT;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS tipo                VARCHAR(12) NOT NULL DEFAULT 'Ítem único';
ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_tipo_check;
ALTER TABLE productos ADD CONSTRAINT productos_tipo_check CHECK (tipo IN ('Ítem único', 'Variante', 'Combo', 'Servicio'));
ALTER TABLE productos ADD COLUMN IF NOT EXISTS asignacion          SMALLINT CHECK (asignacion BETWEEN 1 AND 999);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS marca_id            INTEGER REFERENCES marcas(id) ON DELETE SET NULL;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS modelo              VARCHAR(80);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS estado_sourcing     VARCHAR(30);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS garantia_meses      SMALLINT CHECK (garantia_meses >= 0);   -- 0 = sin garantía
ALTER TABLE productos ADD COLUMN IF NOT EXISTS peso_kg             NUMERIC(8, 3) CHECK (peso_kg >= 0);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS largo_cm            NUMERIC(8, 2) CHECK (largo_cm >= 0);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS ancho_cm            NUMERIC(8, 2) CHECK (ancho_cm >= 0);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS alto_cm             NUMERIC(8, 2) CHECK (alto_cm >= 0);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS talla               VARCHAR(20);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS estado_verificacion VARCHAR(30);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_normal       NUMERIC(10, 2) CHECK (precio_normal >= 0);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS link_info           TEXT;
CREATE INDEX IF NOT EXISTS idx_productos_subcategoria ON productos(subcategoria_id);

-- Componentes de cada combo (el combo también es un producto del catálogo)
CREATE TABLE IF NOT EXISTS combo_componentes (
  combo_id       INTEGER        NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  componente_id  INTEGER        NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  cantidad       INTEGER        NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio         NUMERIC(10, 2) CHECK (precio >= 0),   -- parte del precio del combo que corresponde a este componente
  PRIMARY KEY (combo_id, componente_id),
  CHECK (combo_id <> componente_id)
);

-- Valores reales del GENERADOR_SKU (los primeros por defecto no tenían respaldo en los datos)
ALTER TABLE productos ALTER COLUMN estado_sourcing TYPE VARCHAR(30);
ALTER TABLE productos ALTER COLUMN estado_sourcing DROP NOT NULL;
ALTER TABLE productos ALTER COLUMN estado_sourcing DROP DEFAULT;
ALTER TABLE productos ALTER COLUMN estado_verificacion DROP NOT NULL;
ALTER TABLE productos ALTER COLUMN estado_verificacion DROP DEFAULT;
UPDATE productos SET estado_sourcing = NULL WHERE estado_sourcing = 'Línea Regular';
UPDATE productos SET estado_verificacion = NULL WHERE estado_verificacion = 'Pendiente';
ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_sourcing_check;
ALTER TABLE productos ADD CONSTRAINT productos_sourcing_check
  CHECK (estado_sourcing IN ('En Evaluación', 'Comprado / En Tránsito', 'Línea Regular (Resurtible)', 'Descontinuado'));
ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_verificacion_check;
ALTER TABLE productos ADD CONSTRAINT productos_verificacion_check
  CHECK (estado_verificacion IN ('Pendiente de Arribo', 'Recibido - Por Medir', 'Medido y Verificado', 'Inactivo'));
-- Clasificación antigua (codificación anterior), para reclasificar en la matriz nueva
ALTER TABLE productos ADD COLUMN IF NOT EXISTS categoria_anterior    VARCHAR(120);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS subcategoria_anterior VARCHAR(120);

-- ============================================================
-- Módulo Precios: plataformas, historial de precios y descuentos mayoristas
-- ============================================================
CREATE TABLE IF NOT EXISTS plataformas_precio (
  id      SERIAL PRIMARY KEY,
  nombre  VARCHAR(30) NOT NULL UNIQUE,
  orden   SMALLINT    NOT NULL DEFAULT 0,
  activo  BOOLEAN     NOT NULL DEFAULT true
);
INSERT INTO plataformas_precio (nombre, orden, activo) VALUES
  ('Web', 1, true), ('Coolbox', 2, true), ('Diners', 3, true), ('Yape', 4, true), ('Falabella', 5, true),
  ('Juntoz', 6, true), ('Mercado L.', 7, true), ('Rappi', 8, true), ('Intercorp', 9, true), ('Ripley', 10, true),
  ('Shopstar', 11, true), ('Claro', 12, true), ('Efe', 99, false)
ON CONFLICT (nombre) DO NOTHING;

-- Cada cambio de precio de un SKU en una plataforma (el vigente es el de fecha más reciente)
CREATE TABLE IF NOT EXISTS precios (
  id             BIGSERIAL PRIMARY KEY,
  producto_id    INTEGER        NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  plataforma_id  INTEGER        NOT NULL REFERENCES plataformas_precio(id) ON DELETE RESTRICT,
  fecha          DATE           NOT NULL,
  precio         NUMERIC(10, 2) NOT NULL CHECK (precio >= 0),
  precio_normal  NUMERIC(10, 2) CHECK (precio_normal >= 0),
  creado_por     INTEGER        REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en      TIMESTAMPTZ    NOT NULL DEFAULT now(),
  UNIQUE (producto_id, plataforma_id, fecha)
);
CREATE INDEX IF NOT EXISTS idx_precios_vigente ON precios(producto_id, plataforma_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_precios_fecha ON precios(fecha);

-- Descuento mayorista por grupo de marca (propias / otras), tipo de cliente y cantidad
CREATE TABLE IF NOT EXISTS descuentos_mayoristas (
  id            SERIAL PRIMARY KEY,
  grupo         VARCHAR(10)  NOT NULL CHECK (grupo IN ('propias', 'otras')),
  tipo_cliente  VARCHAR(20)  NOT NULL CHECK (tipo_cliente IN ('Común / Final', 'Empresa', 'Mayorista')),
  desde         INTEGER      NOT NULL CHECK (desde >= 1),
  hasta         INTEGER      CHECK (hasta IS NULL OR hasta >= desde),   -- NULL = en adelante
  porcentaje    NUMERIC(5, 2) NOT NULL CHECK (porcentaje BETWEEN 0 AND 100),
  UNIQUE (grupo, tipo_cliente, desde)
);
-- Tabla DESCUENTOS del Excel (solo la primera vez). "12 a 24" empieza en 12: 7 a 11 queda en el tramo anterior.
INSERT INTO descuentos_mayoristas (grupo, tipo_cliente, desde, hasta, porcentaje)
SELECT * FROM (VALUES
  ('propias', 'Común / Final', 2, 3, 5.0), ('propias', 'Común / Final', 4, 6, 7.5), ('propias', 'Común / Final', 7, NULL, 10.0),
  ('propias', 'Empresa', 2, 3, 7.0), ('propias', 'Empresa', 4, 6, 10.0), ('propias', 'Empresa', 7, 11, 13.0),
  ('propias', 'Empresa', 12, 24, 14.5), ('propias', 'Empresa', 25, NULL, 16.0),
  ('propias', 'Mayorista', 2, 3, 9.0), ('propias', 'Mayorista', 4, 6, 12.0), ('propias', 'Mayorista', 7, 11, 15.0),
  ('propias', 'Mayorista', 12, 24, 18.0), ('propias', 'Mayorista', 25, NULL, 20.0),
  ('otras', 'Común / Final', 2, 3, 3.0), ('otras', 'Común / Final', 4, 9, 3.5), ('otras', 'Común / Final', 10, NULL, 4.0),
  ('otras', 'Empresa', 2, 3, 4.0), ('otras', 'Empresa', 4, 9, 4.5), ('otras', 'Empresa', 10, NULL, 5.0),
  ('otras', 'Mayorista', 2, 3, 5.0), ('otras', 'Mayorista', 4, 9, 5.5), ('otras', 'Mayorista', 10, NULL, 6.0)
) AS v(grupo, tipo_cliente, desde, hasta, porcentaje)
WHERE NOT EXISTS (SELECT 1 FROM descuentos_mayoristas);

-- ============================================================
-- Módulo Recursos Humanos: fichas, documentos, horarios, asistencia, vacaciones y permisos
-- (las listas de valores se validan en src/config/catalogos.js)
-- ============================================================

-- Horarios de trabajo. dias: 1 = lunes … 7 = domingo
CREATE TABLE IF NOT EXISTS rrhh_horarios (
  id              SERIAL PRIMARY KEY,
  nombre          VARCHAR(60) NOT NULL UNIQUE,
  hora_entrada    TIME        NOT NULL,
  hora_salida     TIME        NOT NULL,
  tolerancia_min  SMALLINT    NOT NULL DEFAULT 5 CHECK (tolerancia_min BETWEEN 0 AND 120),
  refrigerio_min  SMALLINT    NOT NULL DEFAULT 60 CHECK (refrigerio_min BETWEEN 0 AND 240),
  dias            SMALLINT[]  NOT NULL DEFAULT '{1,2,3,4,5,6}' CHECK (dias <@ '{1,2,3,4,5,6,7}'::smallint[] AND cardinality(dias) > 0),
  activo          BOOLEAN     NOT NULL DEFAULT true,
  CHECK (hora_salida > hora_entrada)
);
INSERT INTO rrhh_horarios (nombre, hora_entrada, hora_salida, tolerancia_min, refrigerio_min, dias)
SELECT * FROM (VALUES
  ('Oficina L-V', '09:00'::time, '18:00'::time, 5, 60, '{1,2,3,4,5}'::smallint[]),
  ('Almacén L-S', '08:00'::time, '17:00'::time, 5, 60, '{1,2,3,4,5,6}'::smallint[]),
  ('Reparto L-S', '08:00'::time, '17:00'::time, 10, 60, '{1,2,3,4,5,6}'::smallint[])
) AS v(nombre, hora_entrada, hora_salida, tolerancia_min, refrigerio_min, dias)
WHERE NOT EXISTS (SELECT 1 FROM rrhh_horarios);

-- Feriados nacionales (no cuentan como falta). Se agregan más desde la web.
CREATE TABLE IF NOT EXISTS rrhh_feriados (
  fecha   DATE        PRIMARY KEY,
  nombre  VARCHAR(80) NOT NULL
);
INSERT INTO rrhh_feriados (fecha, nombre) VALUES
  ('2026-01-01', 'Año Nuevo'), ('2026-04-02', 'Jueves Santo'), ('2026-04-03', 'Viernes Santo'),
  ('2026-05-01', 'Día del Trabajo'), ('2026-06-07', 'Batalla de Arica y Día de la Bandera'),
  ('2026-06-29', 'San Pedro y San Pablo'), ('2026-07-23', 'Día de la Fuerza Aérea del Perú'),
  ('2026-07-28', 'Fiestas Patrias'), ('2026-07-29', 'Fiestas Patrias'), ('2026-08-06', 'Batalla de Junín'),
  ('2026-08-30', 'Santa Rosa de Lima'), ('2026-10-08', 'Combate de Angamos'), ('2026-11-01', 'Todos los Santos'),
  ('2026-12-08', 'Inmaculada Concepción'), ('2026-12-09', 'Batalla de Ayacucho'), ('2026-12-25', 'Navidad'),
  ('2027-01-01', 'Año Nuevo'), ('2027-03-25', 'Jueves Santo'), ('2027-03-26', 'Viernes Santo'),
  ('2027-05-01', 'Día del Trabajo'), ('2027-06-07', 'Batalla de Arica y Día de la Bandera'),
  ('2027-06-29', 'San Pedro y San Pablo'), ('2027-07-23', 'Día de la Fuerza Aérea del Perú'),
  ('2027-07-28', 'Fiestas Patrias'), ('2027-07-29', 'Fiestas Patrias'), ('2027-08-06', 'Batalla de Junín'),
  ('2027-08-30', 'Santa Rosa de Lima'), ('2027-10-08', 'Combate de Angamos'), ('2027-11-01', 'Todos los Santos'),
  ('2027-12-08', 'Inmaculada Concepción'), ('2027-12-09', 'Batalla de Ayacucho'), ('2027-12-25', 'Navidad')
ON CONFLICT (fecha) DO NOTHING;

-- Ficha del colaborador. Se vincula (opcionalmente) con su usuario del sistema.
CREATE TABLE IF NOT EXISTS colaboradores (
  id                       SERIAL PRIMARY KEY,
  usuario_id               INTEGER      UNIQUE REFERENCES usuarios(id) ON DELETE SET NULL,
  -- datos personales
  nombres                  VARCHAR(80)  NOT NULL,
  apellidos                VARCHAR(80)  NOT NULL,
  tipo_documento           VARCHAR(10)  NOT NULL DEFAULT 'DNI',
  numero_documento         VARCHAR(15)  NOT NULL,
  fecha_nacimiento         DATE,
  sexo                     CHAR(1)      CHECK (sexo IN ('M', 'F')),
  estado_civil             VARCHAR(15),
  telefono                 VARCHAR(30),
  email_personal           VARCHAR(160),
  direccion                VARCHAR(255),
  ubigeo                   CHAR(6)      REFERENCES ubigeos(codigo),
  emergencia_nombre        VARCHAR(120),
  emergencia_parentesco    VARCHAR(40),
  emergencia_telefono      VARCHAR(30),
  hijos                    SMALLINT     NOT NULL DEFAULT 0 CHECK (hijos >= 0),
  banco                    VARCHAR(30),
  cuenta_sueldo            VARCHAR(30),
  cci                      VARCHAR(25),
  -- datos laborales
  cargo                    VARCHAR(80)  NOT NULL,
  area                     VARCHAR(40)  NOT NULL,
  jefe_id                  INTEGER      REFERENCES colaboradores(id) ON DELETE SET NULL,
  horario_id               INTEGER      REFERENCES rrhh_horarios(id) ON DELETE SET NULL,
  fecha_ingreso            DATE         NOT NULL,
  tipo_contrato            VARCHAR(30)  NOT NULL,
  contrato_fin             DATE,
  sueldo                   NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (sueldo >= 0),
  asignacion_familiar      BOOLEAN      NOT NULL DEFAULT false,
  sistema_pension          VARCHAR(15)  NOT NULL DEFAULT 'ONP',
  afp                      VARCHAR(20),
  cuspp                    VARCHAR(15),
  essalud                  BOOLEAN      NOT NULL DEFAULT true,
  examen_medico_vence      DATE,
  -- conductores
  licencia_numero          VARCHAR(15),
  licencia_categoria       VARCHAR(10),
  licencia_vence           DATE,
  sctr_vence               DATE,
  record_conductor         TEXT,
  -- vacaciones: días a sumar o restar al saldo calculado (p. ej. días gozados antes de usar el sistema)
  vacaciones_ajuste        NUMERIC(5, 1) NOT NULL DEFAULT 0,
  -- cese
  fecha_cese               DATE,
  motivo_cese              VARCHAR(120),
  activo                   BOOLEAN      NOT NULL DEFAULT true,
  observaciones            TEXT,
  creado_en                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  actualizado_en           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (tipo_documento, numero_documento),
  CHECK (jefe_id IS DISTINCT FROM id),
  CHECK (contrato_fin IS NULL OR contrato_fin >= fecha_ingreso),
  CHECK (fecha_cese IS NULL OR fecha_cese >= fecha_ingreso)
);
CREATE INDEX IF NOT EXISTS idx_colaboradores_jefe ON colaboradores(jefe_id);
CREATE INDEX IF NOT EXISTS idx_colaboradores_area ON colaboradores(area) WHERE activo;

-- Documentos del colaborador (contrato, DNI, licencia, certificados…). El archivo se guarda en la base
-- para que solo se pueda descargar con sesión y permiso (no hay enlaces públicos).
CREATE TABLE IF NOT EXISTS rrhh_documentos (
  id              SERIAL PRIMARY KEY,
  colaborador_id  INTEGER      NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  solicitud_id    INTEGER,     -- certificado de un descanso médico o licencia (FK abajo)
  tipo            VARCHAR(30)  NOT NULL,
  nombre          VARCHAR(160) NOT NULL,
  vence           DATE,
  mime            VARCHAR(60)  NOT NULL,
  tamano          INTEGER      NOT NULL,
  contenido       BYTEA        NOT NULL,
  subido_por      INTEGER      REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rrhh_documentos_colaborador ON rrhh_documentos(colaborador_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_documentos_vence ON rrhh_documentos(vence) WHERE vence IS NOT NULL;

-- Marcaciones de asistencia: web, celular (con GPS), reloj biométrico (importado) o registro manual de RRHH.
-- Conductores y auxiliares además marcan solos con el GPS del app de reparto (tabla posiciones).
CREATE TABLE IF NOT EXISTS rrhh_marcaciones (
  id              BIGSERIAL PRIMARY KEY,
  colaborador_id  INTEGER      NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  tipo            VARCHAR(10)  NOT NULL CHECK (tipo IN ('entrada', 'salida', 'marca')),
  marcado_en      TIMESTAMPTZ  NOT NULL,
  origen          VARCHAR(12)  NOT NULL CHECK (origen IN ('web', 'app', 'biometrico', 'manual')),
  lat             NUMERIC(10, 7) CHECK (lat BETWEEN -90 AND 90),
  lng             NUMERIC(10, 7) CHECK (lng BETWEEN -180 AND 180),
  precision_m     REAL,
  distancia_m     INTEGER,     -- al almacén principal, para revisar marcaciones lejanas
  nota            VARCHAR(255),
  registrado_por  INTEGER      REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (colaborador_id, marcado_en)
);
CREATE INDEX IF NOT EXISTS idx_rrhh_marcaciones ON rrhh_marcaciones(colaborador_id, marcado_en);
CREATE INDEX IF NOT EXISTS idx_rrhh_marcaciones_fecha ON rrhh_marcaciones(marcado_en);

-- Vacaciones, permisos, descansos médicos y licencias (con o sin goce). Las aprueba el jefe o RRHH.
CREATE TABLE IF NOT EXISTS rrhh_solicitudes (
  id              SERIAL PRIMARY KEY,
  colaborador_id  INTEGER      NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  tipo            VARCHAR(20)  NOT NULL CHECK (tipo IN ('vacaciones', 'permiso', 'descanso_medico', 'licencia')),
  con_goce        BOOLEAN      NOT NULL DEFAULT true,
  desde           DATE         NOT NULL,
  hasta           DATE         NOT NULL,
  dias            SMALLINT     GENERATED ALWAYS AS ((hasta - desde) + 1) STORED,
  motivo          VARCHAR(500),
  estado          VARCHAR(12)  NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente', 'aprobada', 'rechazada', 'anulada')),
  respuesta       VARCHAR(500),
  resuelto_por    INTEGER      REFERENCES usuarios(id) ON DELETE SET NULL,
  resuelto_en     TIMESTAMPTZ,
  creado_por      INTEGER      REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (hasta >= desde),
  CHECK (tipo <> 'vacaciones' OR con_goce)
);
CREATE INDEX IF NOT EXISTS idx_rrhh_solicitudes_colaborador ON rrhh_solicitudes(colaborador_id, desde);
CREATE INDEX IF NOT EXISTS idx_rrhh_solicitudes_fechas ON rrhh_solicitudes(desde, hasta) WHERE estado IN ('pendiente', 'aprobada');
ALTER TABLE rrhh_documentos DROP CONSTRAINT IF EXISTS rrhh_documentos_solicitud_fk;
ALTER TABLE rrhh_documentos ADD CONSTRAINT rrhh_documentos_solicitud_fk
  FOREIGN KEY (solicitud_id) REFERENCES rrhh_solicitudes(id) ON DELETE SET NULL;
