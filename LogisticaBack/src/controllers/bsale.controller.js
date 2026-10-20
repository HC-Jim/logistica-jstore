import { query } from '../config/db.js';
import {
  actualizarFichas, actualizarNombres, bsaleActivo, crearCategorias, crearProductos, enConflicto, enviarPrecios, estadoCatalogo, marcasBsale, leerPaso, pasosLectura, preciosDistintos, SQL_NOMBRE_COMPARABLE,
} from '../services/bsale.service.js';
import { leerCampos } from '../utils/campos.js';
import { HttpError } from '../utils/http.js';

const FUENTES = ['ninguna', 'plataforma', 'normal', 'minimo_plataformas'];

const idsDe = (body, max = 100) => {
  const ids = body?.producto_ids;
  if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'Indica los productos (producto_ids)');
  if (ids.length > max) throw new HttpError(400, `Máximo ${max} productos por envío`);
  return ids.map((x) => {
    const n = Number(x);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'producto_ids inválido');
    return n;
  });
};

export const BsaleController = {
  /** Configuración, listas con su fuente de precio y fecha de la última lectura. */
  async estado(_req, res) {
    const [listas, lectura, envios] = await Promise.all([
      query(`SELECT l.*, pl.nombre AS plataforma,
                    (SELECT COUNT(*) FROM bsale_precios bp WHERE bp.lista_id = l.id)::int AS precios,
                    (SELECT MAX(leido_en) FROM bsale_precios bp WHERE bp.lista_id = l.id) AS leido_en
             FROM bsale_listas l LEFT JOIN plataformas_precio pl ON pl.id = l.plataforma_id ORDER BY l.activa DESC, l.id`),
      query('SELECT MAX(leido_en) AS productos, COUNT(*)::int AS variantes FROM bsale_variantes'),
      query(`SELECT COUNT(*) FILTER (WHERE NOT ok AND creado_en > now() - interval '7 days')::int AS errores_7d FROM bsale_envios`),
    ]);
    res.json({ activo: bsaleActivo(), listas: listas.rows, lectura: lectura.rows[0], ...envios.rows[0], pasos: await pasosLectura() });
  },

  /** { listas: [{ id, fuente, plataforma_id }] } */
  async guardarListas(req, res) {
    const listas = req.body?.listas;
    if (!Array.isArray(listas)) throw new HttpError(400, 'listas debe ser una lista');
    for (const l of listas) {
      const d = leerCampos(l, {
        id: { tipo: 'entero', requerido: true }, fuente: { tipo: 'enum', lista: FUENTES, requerido: true }, plataforma_id: { tipo: 'entero' },
      }, { requeridos: true });
      if (d.fuente === 'plataforma' && !d.plataforma_id) throw new HttpError(400, 'Elige la plataforma de la que toma el precio');
      const { rowCount } = await query(
        'UPDATE bsale_listas SET fuente = $2, plataforma_id = $3, actualizado_en = now() WHERE id = $1',
        [d.id, d.fuente, d.fuente === 'plataforma' ? d.plataforma_id : null]
      );
      if (!rowCount) throw new HttpError(404, `La lista ${d.id} no existe; lee Bsale primero`);
    }
    return BsaleController.estado(req, res);
  },

  /** Un paso de la lectura: listas | productos | stock | lista:<id> */
  async leer(req, res) {
    res.json({ paso: req.params.paso, ...(await leerPaso(req.params.paso)) });
  },

  /** Diferencias entre el sistema y la copia de Bsale. */
  async diferencias(_req, res) {
    const [precios, soloSistema, soloBsale, nombres, resumen] = await Promise.all([
      preciosDistintos(),
      query(`SELECT p.id, p.sku, p.descripcion, p.tipo, c.nombre AS categoria, p.precio::float AS precio
             FROM productos p LEFT JOIN subcategorias s ON s.id = p.subcategoria_id LEFT JOIN categorias c ON c.id = s.categoria_id
             WHERE p.activo AND NOT EXISTS (SELECT 1 FROM bsale_variantes bv WHERE bv.codigo = upper(btrim(p.sku)) AND bv.activa)
             ORDER BY p.sku`),
      query(`SELECT bv.id, bv.codigo, bv.nombre, bv.stock::float AS stock FROM bsale_variantes bv
             WHERE bv.activa AND NOT EXISTS (SELECT 1 FROM productos p WHERE upper(btrim(p.sku)) = bv.codigo) ORDER BY bv.codigo`),
      query(`SELECT p.id, p.sku, p.descripcion, bv.nombre AS nombre_bsale
             FROM productos p JOIN bsale_variantes bv ON bv.codigo = upper(btrim(p.sku)) AND bv.activa
             WHERE ${SQL_NOMBRE_COMPARABLE('btrim(p.descripcion)')} <> ${SQL_NOMBRE_COMPARABLE("btrim(COALESCE(bv.nombre, ''))")}
             ORDER BY p.sku`),
      query(`SELECT COUNT(*) FILTER (WHERE bv.activa)::int AS en_bsale,
                    COUNT(*) FILTER (WHERE bv.activa AND bv.stock > 0)::int AS con_stock,
                    COUNT(*) FILTER (WHERE bv.activa AND EXISTS (SELECT 1 FROM productos p WHERE upper(btrim(p.sku)) = bv.codigo))::int AS en_ambos
             FROM bsale_variantes bv`),
    ]);
    // mismo SKU pero otro producto en Bsale: no se tocan automáticamente
    const conflictos = nombres.rows.filter((n) => enConflicto(n.descripcion, n.nombre_bsale));
    const distintos = nombres.rows.filter((n) => !enConflicto(n.descripcion, n.nombre_bsale));
    res.json({
      resumen: {
        ...resumen.rows[0], solo_sistema: soloSistema.rows.length, solo_bsale: soloBsale.rows.length,
        nombres_distintos: distintos.length, conflictos: conflictos.length, precios_distintos: precios.length,
        productos_con_precio_distinto: new Set(precios.map((p) => p.producto_id)).size,
      },
      precios, soloSistema: soloSistema.rows, soloBsale: soloBsale.rows, nombres: distintos, conflictos,
    });
  },

  /** { producto_ids? } Sin productos envía todos los precios distintos (de a poco: repetir mientras haya pendientes). */
  async enviarPrecios(req, res) {
    const productoIds = req.body?.producto_ids ? idsDe(req.body, 500) : null;
    res.json(await enviarPrecios({ productoIds, usuario: req.user }));
  },

  /** { producto_ids } (máx. 10 por llamada: cada uno son varias consultas a Bsale) */
  async crear(req, res) {
    res.json(await crearProductos(idsDe(req.body, 10), req.user));
  },

  async nombres(req, res) {
    res.json(await actualizarNombres(idsDe(req.body, 40), req.user));
  },

  /**
   * Productos del sistema vs Bsale: categorías (tipos de producto), marcas, SKU que faltan de cada lado
   * y observaciones de los SKU que están en ambos.
   */
  async productos(_req, res) {
    const sinTildes = (t) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/["\s]+/g, ' ').trim();
    const [cats, tipos, marcas, inferidas, soloSistema, soloBsale, ambos] = await Promise.all([
      query(`SELECT c.id, c.codigo, c.nombre, c.activo,
                    (SELECT COUNT(*) FROM productos p JOIN subcategorias s ON s.id = p.subcategoria_id WHERE s.categoria_id = c.id AND p.activo)::int AS skus
             FROM categorias c ORDER BY c.codigo`),
      query(`SELECT t.id, t.nombre, t.activo, (SELECT COUNT(*) FROM bsale_variantes bv WHERE bv.tipo_bsale_id = t.id AND bv.activa)::int AS productos
             FROM bsale_tipos t ORDER BY t.nombre`),
      query(`SELECT m.id, m.nombre, m.propia, m.activo, (SELECT COUNT(*) FROM productos p WHERE p.marca_id = m.id AND p.activo)::int AS skus
             FROM marcas m ORDER BY m.nombre`),
      marcasBsale(),
      query(`SELECT p.id, p.sku, p.descripcion, p.tipo, c.nombre AS categoria, m.nombre AS marca, p.precio::float AS precio,
                    (SELECT COUNT(*) FROM combo_componentes cc WHERE cc.combo_id = p.id)::int AS componentes
             FROM productos p LEFT JOIN subcategorias s ON s.id = p.subcategoria_id LEFT JOIN categorias c ON c.id = s.categoria_id
             LEFT JOIN marcas m ON m.id = p.marca_id
             WHERE p.activo AND NOT EXISTS (SELECT 1 FROM bsale_variantes bv WHERE bv.codigo = upper(btrim(p.sku)) AND bv.activa)
             ORDER BY p.sku`),
      query(`SELECT bv.id, bv.codigo, bv.nombre, bv.stock::float AS stock, bv.clasificacion, t.nombre AS tipo
             FROM bsale_variantes bv LEFT JOIN bsale_tipos t ON t.id = bv.tipo_bsale_id
             WHERE bv.activa AND NOT EXISTS (SELECT 1 FROM productos p WHERE upper(btrim(p.sku)) = bv.codigo) ORDER BY bv.codigo`),
      query(`SELECT p.id, p.sku, p.descripcion, p.activo, p.tipo, c.nombre AS categoria, p.marca_id, m.nombre AS marca,
                    bv.nombre AS nombre_bsale, t.nombre AS tipo_bsale, bv.marca_bsale_id, bv.clasificacion, bv.stock::float AS stock
             FROM productos p JOIN bsale_variantes bv ON bv.codigo = upper(btrim(p.sku)) AND bv.activa
             LEFT JOIN bsale_tipos t ON t.id = bv.tipo_bsale_id
             LEFT JOIN subcategorias s ON s.id = p.subcategoria_id LEFT JOIN categorias c ON c.id = s.categoria_id
             LEFT JOIN marcas m ON m.id = p.marca_id ORDER BY p.sku`),
    ]);

    // categorías ↔ tipos de producto (por nombre)
    const tipoPorNombre = new Map(tipos.rows.map((t) => [sinTildes(t.nombre), t]));
    const nombresCat = new Set(cats.rows.map((c) => sinTildes(c.nombre)));
    const categorias = cats.rows.map((c) => ({ ...c, bsale: tipoPorNombre.get(sinTildes(c.nombre)) ?? null }));
    const tiposSoloBsale = tipos.rows.filter((t) => t.nombre && !nombresCat.has(sinTildes(t.nombre)));

    // marcas: nombre deducido de cada número de marca de Bsale
    const nombreMarcaBsale = new Map(inferidas.filter((m) => m.nombre).map((m) => [m.bsale_id, m.nombre]));
    const marcasConBsale = new Set(inferidas.filter((m) => m.marca_id).map((m) => m.marca_id));
    const listaMarcas = marcas.rows.map((m) => ({ ...m, bsale_id: inferidas.find((x) => x.marca_id === m.id)?.bsale_id ?? null }));

    // observaciones de los SKU que están en ambos lados
    const observaciones = [];
    for (const p of ambos.rows) {
      const obs = [];
      const conflicto = enConflicto(p.descripcion, p.nombre_bsale);
      if (conflicto) obs.push(`Otro producto en Bsale: “${p.nombre_bsale}”`);
      else if (sinTildes(p.descripcion) !== sinTildes(p.nombre_bsale)) obs.push(`Nombre en Bsale: “${p.nombre_bsale}”`);
      if (!p.categoria) obs.push('Sin categoría nueva en el sistema');
      else if (sinTildes(p.categoria) !== sinTildes(p.tipo_bsale)) obs.push(`Categoría en Bsale: ${p.tipo_bsale ?? '—'}`);
      const marcaB = nombreMarcaBsale.get(p.marca_bsale_id);
      if (p.marca && !p.marca_bsale_id) obs.push('Sin marca en Bsale');
      else if (p.marca && marcaB && marcaB !== p.marca) obs.push(`Marca en Bsale: ${marcaB}`);
      if (p.tipo === 'Combo' && p.clasificacion !== 3) obs.push('Es combo en el sistema pero no es pack en Bsale');
      if (p.clasificacion === 3 && p.tipo !== 'Combo') obs.push('Es pack en Bsale pero no combo en el sistema');
      if (!p.activo) obs.push(`Inactivo en el sistema y activo en Bsale${p.stock > 0 ? ` (stock ${p.stock})` : ''}`);
      if (obs.length) observaciones.push({ ...p, observaciones: obs, conflicto, marca_bsale: marcaB ?? null });
    }

    res.json({
      resumen: {
        categorias_en_ambos: categorias.filter((c) => c.bsale).length,
        categorias_faltan: categorias.filter((c) => !c.bsale && c.activo).length,
        tipos_solo_bsale: tiposSoloBsale.length,
        marcas_en_bsale: listaMarcas.filter((m) => m.bsale_id).length,
        marcas_pendientes: listaMarcas.filter((m) => !m.bsale_id && m.activo && m.skus > 0).length,
        marcas_bsale_sin_nombre: inferidas.filter((m) => !m.nombre).length,
        skus_en_ambos: ambos.rows.length,
        skus_faltan: soloSistema.rows.length,
        skus_solo_bsale: soloBsale.rows.length,
        observaciones: observaciones.length,
        conflictos: observaciones.filter((o) => o.conflicto).length,
      },
      categorias, tiposSoloBsale,
      marcas: listaMarcas, marcasBsale: inferidas, marcasConBsale: [...marcasConBsale],
      soloSistema: soloSistema.rows, soloBsale: soloBsale.rows, observaciones,
    });
  },

  /** { categoria_ids } crea en Bsale los tipos de producto que faltan */
  async crearCategorias(req, res) {
    const ids = req.body?.categoria_ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some((x) => !Number.isInteger(Number(x)))) {
      throw new HttpError(400, 'Indica las categorías (categoria_ids, máximo 50)');
    }
    res.json(await crearCategorias(ids.map(Number), req.user));
  },

  /** { producto_ids } corrige en Bsale nombre, tipo (categoría) y marca con los datos del sistema */
  async fichas(req, res) {
    res.json(await actualizarFichas(idsDe(req.body, 40), req.user));
  },

  /** Marcas y categorías del sistema que ya existen en Bsale (para las pantallas de Marcas y Categorías). */
  async estadoCatalogo(_req, res) {
    res.json({ activo: bsaleActivo(), ...(await estadoCatalogo()) });
  },

  async envios(req, res) {
    const { rows } = await query(
      `SELECT e.*, u.nombre AS usuario FROM bsale_envios e LEFT JOIN usuarios u ON u.id = e.creado_por
       WHERE ($1::boolean IS NOT TRUE OR NOT e.ok) ORDER BY e.creado_en DESC LIMIT 300`,
      [req.query.errores === '1' ? true : null]
    );
    res.json(rows);
  },
};
