import { query, withTransaction } from '../config/db.js';
import { HttpError } from '../utils/http.js';

// Ficha del producto con su categoría, subcategoría y marca
const SELECT_PRODUCTO = `
  SELECT p.*, s.codigo AS cod_subcategoria, s.nombre AS subcategoria, c.id AS categoria_id, c.codigo AS cod_categoria,
         c.nombre AS categoria, m.nombre AS marca, m.propia AS marca_propia, m.segmento AS marca_segmento,
         CASE WHEN p.largo_cm > 0 AND p.ancho_cm > 0 AND p.alto_cm > 0
              THEN ROUND(p.largo_cm * p.ancho_cm * p.alto_cm / 1000000, 4) END AS volumen_m3,
         bv.id AS bsale_variante_id, bv.nombre AS bsale_nombre, bt.nombre AS bsale_tipo, bv.clasificacion AS bsale_clasificacion
  FROM productos p
  LEFT JOIN bsale_variantes bv ON bv.codigo = upper(btrim(p.sku)) AND bv.activa
  LEFT JOIN bsale_tipos bt ON bt.id = bv.tipo_bsale_id
  LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
  LEFT JOIN categorias c    ON c.id = s.categoria_id
  LEFT JOIN marcas m        ON m.id = p.marca_id`;

// Campos de la ficha que se guardan tal cual
export const CAMPOS_FICHA = [
  'sku', 'descripcion', 'precio', 'subcategoria_id', 'tipo', 'asignacion', 'marca_id', 'modelo', 'estado_sourcing',
  'garantia_meses', 'peso_kg', 'largo_cm', 'ancho_cm', 'alto_cm', 'talla', 'estado_verificacion', 'precio_normal',
  'link_info', 'activo',
];

/** Prefijo del SKU: categoría (2) + subcategoría (2) y, si es combo, un "2". */
async function prefijoSku(db, subcategoriaId, tipo) {
  const { rows: [s] } = await db.query(
    `SELECT c.codigo AS cat, s.codigo AS sub FROM subcategorias s JOIN categorias c ON c.id = s.categoria_id WHERE s.id = $1`,
    [subcategoriaId]
  );
  if (!s) throw new HttpError(400, 'La subcategoría no existe');
  return `${s.cat}${s.sub}${tipo === 'Combo' ? '2' : ''}`;
}

/**
 * Siguiente asignación libre para un prefijo. Mira todos los SKU que ya empiezan así (también los
 * de la codificación antigua) para no repetir nunca un SKU.
 */
async function siguienteAsignacion(db, prefijo) {
  const { rows: [{ n }] } = await db.query(
    `SELECT COALESCE(MAX(substring(sku FROM length($1) + 1)::int), 0) + 1 AS n
     FROM productos WHERE sku ~ ('^' || $1 || '[0-9]{3}$')`,
    [prefijo]
  );
  if (n > 999) throw new HttpError(409, `La subcategoría ya usa las 999 asignaciones del prefijo ${prefijo}`);
  return n;
}

export const ProductoModel = {
  /** Búsqueda por SKU o descripción, con filtros del catálogo. */
  async listar({ q, soloActivos, categoriaId, subcategoriaId, marcaId, tipo, estadoSourcing, sinClasificar, limite = 1000 } = {}) {
    const cond = [];
    const params = [];
    const agregar = (sql, valor) => { params.push(valor); cond.push(sql.replaceAll('?', `$${params.length}`)); };
    if (q) agregar('(p.sku ILIKE ? OR p.descripcion ILIKE ? OR p.modelo ILIKE ?)', `%${q}%`);
    if (soloActivos) cond.push('p.activo');
    if (categoriaId) agregar('c.id = ?', categoriaId);
    if (subcategoriaId) agregar('p.subcategoria_id = ?', subcategoriaId);
    if (marcaId) agregar('p.marca_id = ?', marcaId);
    if (tipo) agregar('p.tipo = ?', tipo);
    if (estadoSourcing) agregar('p.estado_sourcing = ?', estadoSourcing);
    if (sinClasificar) cond.push('p.subcategoria_id IS NULL');
    params.push(limite);
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const { rows } = await query(`${SELECT_PRODUCTO} ${where} ORDER BY p.descripcion LIMIT $${params.length}`, params);
    return rows;
  },

  async obtener(id) {
    const { rows: [p] } = await query(`${SELECT_PRODUCTO} WHERE p.id = $1`, [id]);
    if (!p) return null;
    if (p.tipo === 'Combo') p.componentes = await this.componentes(id);
    return p;
  },

  /** SKU que se asignaría (sin guardarlo) para mostrarlo en el formulario. */
  async proponerSku(subcategoriaId, tipo) {
    const prefijo = await prefijoSku({ query }, subcategoriaId, tipo);
    const asignacion = await siguienteAsignacion({ query }, prefijo);
    return { prefijo, asignacion, sku: `${prefijo}${String(asignacion).padStart(3, '0')}` };
  },

  /**
   * Crea el producto. Si no se indica SKU, se genera con la regla categoría + subcategoría
   * (+ "2" si es combo) + asignación correlativa, bloqueando el prefijo para no duplicar.
   */
  async crear(datos) {
    return withTransaction(async (client) => {
      const fila = { ...datos };
      if (!fila.sku) {
        if (!fila.subcategoria_id) throw new HttpError(400, 'Elige la subcategoría para generar el SKU');
        const prefijo = await prefijoSku(client, fila.subcategoria_id, fila.tipo);
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sku:${prefijo}`]);
        fila.asignacion = await siguienteAsignacion(client, prefijo);
        fila.sku = `${prefijo}${String(fila.asignacion).padStart(3, '0')}`;
      }
      const cols = CAMPOS_FICHA.filter((c) => fila[c] !== undefined);
      const { rows: [{ id }] } = await client.query(
        `INSERT INTO productos (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        cols.map((c) => fila[c])
      ).catch((err) => {
        if (err.code === '23505') throw new HttpError(409, `Ya existe el SKU ${fila.sku}`);
        throw err;
      });
      return id;
    }).then((id) => this.obtener(id));
  },

  /** Actualiza solo los campos enviados. */
  async actualizar(id, datos) {
    const cols = CAMPOS_FICHA.filter((c) => datos[c] !== undefined);
    if (!cols.length) return this.obtener(id);
    const { rows } = await query(
      `UPDATE productos SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, actualizado_en = now()
       WHERE id = $${cols.length + 1} RETURNING id`,
      [...cols.map((c) => datos[c]), id]
    ).catch((err) => {
      if (err.code === '23505') throw new HttpError(409, `Ya existe el SKU ${datos.sku}`);
      throw err;
    });
    return rows[0] ? this.obtener(id) : null;
  },

  async eliminar(id) {
    const { rowCount } = await query('DELETE FROM productos WHERE id = $1', [id]).catch((err) => {
      if (err.code === '23503') throw new HttpError(409, 'El producto ya se usó en pedidos o combos: desactívalo en vez de eliminarlo');
      throw err;
    });
    return rowCount > 0;
  },

  // --- combos ---

  async componentes(comboId) {
    const { rows } = await query(
      `SELECT cc.componente_id, cc.cantidad, cc.precio, p.sku, p.descripcion, p.precio AS precio_web, p.activo
       FROM combo_componentes cc JOIN productos p ON p.id = cc.componente_id
       WHERE cc.combo_id = $1 ORDER BY p.descripcion`,
      [comboId]
    );
    return rows;
  },

  /** Reemplaza los componentes del combo. [{ componente_id, cantidad, precio }] */
  async guardarComponentes(comboId, componentes) {
    return withTransaction(async (client) => {
      const { rows: [combo] } = await client.query('SELECT tipo FROM productos WHERE id = $1 FOR UPDATE', [comboId]);
      if (!combo) throw new HttpError(404, 'Producto no encontrado');
      if (combo.tipo !== 'Combo') throw new HttpError(400, 'Solo los productos de tipo Combo tienen componentes');
      const ids = componentes.map((c) => c.componente_id);
      if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Hay componentes repetidos');
      if (ids.includes(comboId)) throw new HttpError(400, 'Un combo no puede contenerse a sí mismo');
      const { rows: existen } = await client.query('SELECT id, tipo FROM productos WHERE id = ANY($1::int[])', [ids]);
      if (existen.length !== ids.length) throw new HttpError(400, 'Algún componente no existe');
      if (existen.some((p) => p.tipo === 'Combo')) throw new HttpError(400, 'Un combo no puede tener otro combo como componente');
      await client.query('DELETE FROM combo_componentes WHERE combo_id = $1', [comboId]);
      if (componentes.length) {
        await client.query(
          `INSERT INTO combo_componentes (combo_id, componente_id, cantidad, precio)
           SELECT $1, * FROM unnest($2::int[], $3::int[], $4::numeric[])`,
          [comboId, ids, componentes.map((c) => c.cantidad), componentes.map((c) => c.precio ?? null)]
        );
      }
    }).then(() => this.componentes(comboId));
  },

  /** Grupos por clasificación antigua (codificación anterior) y cuántos faltan ubicar en la matriz nueva. */
  async gruposAnteriores() {
    const { rows } = await query(
      `SELECT categoria_anterior, subcategoria_anterior, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE subcategoria_id IS NULL)::int AS pendientes,
              (array_agg(descripcion ORDER BY sku))[1:3] AS ejemplos,
              MIN(subcategoria_id) FILTER (WHERE subcategoria_id IS NOT NULL) AS subcategoria_id
       FROM productos WHERE categoria_anterior IS NOT NULL OR subcategoria_anterior IS NOT NULL
       GROUP BY 1, 2 ORDER BY pendientes DESC, 1, 2`
    );
    return rows;
  },

  /** Asigna la subcategoría nueva a todos los productos de una clasificación antigua (el SKU no cambia). */
  async reclasificar({ categoriaAnterior, subcategoriaAnterior, subcategoriaId }) {
    const { rowCount } = await query(
      `UPDATE productos SET subcategoria_id = $3, actualizado_en = now()
       WHERE categoria_anterior IS NOT DISTINCT FROM $1 AND subcategoria_anterior IS NOT DISTINCT FROM $2`,
      [categoriaAnterior ?? null, subcategoriaAnterior ?? null, subcategoriaId]
    ).catch((err) => {
      if (err.code === '23503') throw new HttpError(400, 'La subcategoría no existe');
      throw err;
    });
    return rowCount;
  },

  /** Inserta o actualiza por SKU (carga simple por CSV: sku, descripcion, precio). */
  async importar(filas) {
    const { rows } = await query(
      `INSERT INTO productos (sku, descripcion, precio)
       SELECT * FROM unnest($1::text[], $2::text[], $3::numeric[])
       ON CONFLICT (sku) DO UPDATE
         SET descripcion = EXCLUDED.descripcion, precio = EXCLUDED.precio, activo = true, actualizado_en = now()
       RETURNING (xmax = 0) AS insertado`,
      [filas.map((f) => f.sku), filas.map((f) => f.descripcion), filas.map((f) => f.precio)]
    );
    const creados = rows.filter((r) => r.insertado).length;
    return { creados, actualizados: rows.length - creados };
  },
};

// --- matriz de categorías y marcas ---

export const CatalogoProductosModel = {
  async matriz() {
    const { rows } = await query(
      `SELECT c.id, c.codigo, c.nombre, c.activo,
              COALESCE(json_agg(json_build_object('id', s.id, 'codigo', s.codigo, 'nombre', s.nombre, 'activo', s.activo,
                                                  'productos', (SELECT COUNT(*) FROM productos p WHERE p.subcategoria_id = s.id))
                       ORDER BY s.codigo) FILTER (WHERE s.id IS NOT NULL), '[]') AS subcategorias
       FROM categorias c LEFT JOIN subcategorias s ON s.categoria_id = c.id
       GROUP BY c.id ORDER BY c.codigo`
    );
    return rows;
  },

  async guardarCategoria({ id, codigo, nombre, activo }) {
    const sql = id
      ? ['UPDATE categorias SET codigo = COALESCE($1, codigo), nombre = COALESCE($2, nombre), activo = COALESCE($3, activo) WHERE id = $4 RETURNING *', [codigo, nombre, activo, id]]
      : ['INSERT INTO categorias (codigo, nombre) VALUES ($1, $2) RETURNING *', [codigo, nombre]];
    const { rows: [c] } = await query(...sql).catch((err) => {
      if (err.code === '23505') throw new HttpError(409, `Ya existe una categoría con el código ${codigo}`);
      throw err;
    });
    if (!c) throw new HttpError(404, 'Categoría no encontrada');
    return c;
  },

  async guardarSubcategoria({ id, categoria_id: categoriaId, codigo, nombre, activo }) {
    const sql = id
      ? ['UPDATE subcategorias SET codigo = COALESCE($1, codigo), nombre = COALESCE($2, nombre), activo = COALESCE($3, activo) WHERE id = $4 RETURNING *', [codigo, nombre, activo, id]]
      : ['INSERT INTO subcategorias (categoria_id, codigo, nombre) VALUES ($1, $2, $3) RETURNING *', [categoriaId, codigo, nombre]];
    const { rows: [s] } = await query(...sql).catch((err) => {
      if (err.code === '23505') throw new HttpError(409, `Esa categoría ya tiene la subcategoría ${codigo}`);
      if (err.code === '23503') throw new HttpError(400, 'La categoría no existe');
      throw err;
    });
    if (!s) throw new HttpError(404, 'Subcategoría no encontrada');
    return s;
  },

  async marcas() {
    const { rows } = await query(
      `SELECT m.*, (SELECT COUNT(*) FROM productos p WHERE p.marca_id = m.id)::int AS productos FROM marcas m ORDER BY m.nombre`
    );
    return rows;
  },

  async guardarMarca({ id, nombre, propia, segmento, activo }) {
    const sql = id
      ? ['UPDATE marcas SET nombre = COALESCE($1, nombre), propia = COALESCE($2, propia), segmento = $3, activo = COALESCE($4, activo) WHERE id = $5 RETURNING *', [nombre, propia, segmento ?? null, activo, id]]
      : ['INSERT INTO marcas (nombre, propia, segmento) VALUES ($1, COALESCE($2, false), $3) RETURNING *', [nombre, propia, segmento ?? null]];
    const { rows: [m] } = await query(...sql).catch((err) => {
      if (err.code === '23505') throw new HttpError(409, `Ya existe la marca ${nombre}`);
      throw err;
    });
    if (!m) throw new HttpError(404, 'Marca no encontrada');
    return m;
  },
};
