import { query } from '../config/db.js';
import { ESTADOS_SOURCING, ESTADOS_VERIFICACION, SEGMENTOS_MARCA, TIPOS_PRODUCTO } from '../config/catalogos.js';
import { CatalogoProductosModel, ProductoModel } from '../models/producto.model.js';
import { actualizarFichas, bsaleActivo, categoriaNueva, crearProductos, renombrarCategoria } from '../services/bsale.service.js';
import { leerCampos } from '../utils/campos.js';
import { HttpError, idParam } from '../utils/http.js';

/** Ficha del SKU: solo valores de las listas del sistema. */
const CAMPOS = {
  sku: { tipo: 'texto', max: 60 },                           // vacío al crear = se genera
  descripcion: { tipo: 'texto', max: 255, requerido: true }, // Nombre Almacén
  precio: { tipo: 'monto' },                                 // precio Web
  subcategoria_id: { tipo: 'entero' },
  tipo: { tipo: 'enum', lista: TIPOS_PRODUCTO },
  marca_id: { tipo: 'entero' },
  modelo: { tipo: 'texto', max: 80 },
  estado_sourcing: { tipo: 'enum', lista: ESTADOS_SOURCING },
  garantia_meses: { tipo: 'monto' },                         // 0 = sin garantía (se valida entero abajo)
  peso_kg: { tipo: 'monto' },
  largo_cm: { tipo: 'monto' },
  ancho_cm: { tipo: 'monto' },
  alto_cm: { tipo: 'monto' },
  talla: { tipo: 'texto', max: 20 },
  estado_verificacion: { tipo: 'enum', lista: ESTADOS_VERIFICACION },
  precio_normal: { tipo: 'monto' },
  link_info: { tipo: 'texto', max: 1000 },
};

const CAMPOS_CSV = {
  sku: { tipo: 'texto', max: 60, requerido: true },
  descripcion: { tipo: 'texto', max: 255, requerido: true },
  precio: { tipo: 'monto' },
};

const MAX_IMPORTAR = 10000;

function leerFicha(body, { creando }) {
  const d = leerCampos(body, CAMPOS, { requeridos: creando });
  if (d.garantia_meses != null && !Number.isInteger(d.garantia_meses)) throw new HttpError(400, 'Garantía: meses enteros (0 = sin garantía)');
  if (d.link_info && !/^https?:\/\//i.test(d.link_info)) throw new HttpError(400, 'El link para información debe empezar con http:// o https://');
  if ('activo' in (body ?? {})) d.activo = body.activo !== false;
  return d;
}

const booleano = (v) => (typeof v === 'boolean' ? v : undefined);

export const ProductoController = {
  async listar(req, res) {
    const f = leerCampos(req.query, {
      categoria_id: { tipo: 'entero' }, subcategoria_id: { tipo: 'entero' }, marca_id: { tipo: 'entero' },
      tipo: { tipo: 'enum', lista: TIPOS_PRODUCTO }, estado_sourcing: { tipo: 'enum', lista: ESTADOS_SOURCING },
    });
    res.json(await ProductoModel.listar({
      q: req.query.q,
      soloActivos: req.query.activos === 'true',
      categoriaId: f.categoria_id, subcategoriaId: f.subcategoria_id, marcaId: f.marca_id,
      tipo: f.tipo, estadoSourcing: f.estado_sourcing, sinClasificar: req.query.sin_clasificar === '1',
      limite: Math.min(Number(req.query.limite) || 1000, 5000),
    }));
  },

  async obtener(req, res) {
    const p = await ProductoModel.obtener(idParam(req.params.id));
    if (!p) throw new HttpError(404, 'Producto no encontrado');
    res.json(p);
  },

  /** SKU que se generaría para una subcategoría y tipo. ?subcategoria_id=&tipo= */
  async proponerSku(req, res) {
    const f = leerCampos(req.query, {
      subcategoria_id: { tipo: 'entero', requerido: true }, tipo: { tipo: 'enum', lista: TIPOS_PRODUCTO },
    }, { requeridos: true });
    res.json(await ProductoModel.proponerSku(f.subcategoria_id, f.tipo ?? 'Ítem único'));
  },

  async crear(req, res) {
    const d = leerFicha(req.body, { creando: true });
    const producto = await ProductoModel.crear({ tipo: 'Ítem único', ...d });
    // el SKU nuevo también se crea en Bsale (los combos se arman allá como pack)
    let bsale = { activo: bsaleActivo() };
    if (bsale.activo && producto.tipo !== 'Combo') {
      const [r] = await crearProductos([producto.id], req.user).catch((err) => [{ ok: false, mensaje: err.message }]);
      bsale = { ...bsale, ...r };
    }
    res.status(201).json({ ...producto, bsale });
  },

  async actualizar(req, res) {
    const d = leerFicha(req.body, { creando: false });
    if ('sku' in d && !d.sku) throw new HttpError(400, 'El SKU no puede quedar vacío');
    const id = idParam(req.params.id);
    const antes = bsaleActivo() ? await ProductoModel.obtener(id) : null;
    const producto = await ProductoModel.actualizar(id, d);
    if (!producto) throw new HttpError(404, 'Producto no encontrado');
    // si cambió el nombre, la categoría o la marca y el SKU existe en Bsale, se actualiza allá también
    let bsale = null;
    const cambio = antes && ['descripcion', 'subcategoria_id', 'marca_id'].some((k) => String(antes[k] ?? '') !== String(producto[k] ?? ''));
    if (cambio && producto.bsale_variante_id) {
      const [r] = await actualizarFichas([id], req.user).catch((err) => [{ ok: false, mensaje: err.message }]);
      bsale = r ? { ...r, mensaje: r.ok ? 'nombre, categoría y marca actualizados en Bsale' : r.mensaje } : null;
    }
    res.json(bsale ? { ...producto, bsale } : producto);
  },

  async eliminar(req, res) {
    if (!(await ProductoModel.eliminar(idParam(req.params.id)))) throw new HttpError(404, 'Producto no encontrado');
    res.status(204).end();
  },

  /** Componentes del combo: { componentes: [{ componente_id, cantidad, precio }] } */
  async guardarComponentes(req, res) {
    const lista = req.body?.componentes;
    if (!Array.isArray(lista)) throw new HttpError(400, 'componentes debe ser una lista');
    const componentes = lista.map((c) => leerCampos(c, {
      componente_id: { tipo: 'entero', requerido: true }, cantidad: { tipo: 'entero', requerido: true }, precio: { tipo: 'monto' },
    }, { requeridos: true }));
    const id = idParam(req.params.id);
    const resultado = await ProductoModel.guardarComponentes(id, componentes);
    // el combo con sus componentes se crea en Bsale como pack (si aún no existe allá)
    if (bsaleActivo() && componentes.length) {
      const [r] = await crearProductos([id], req.user).catch((err) => [{ ok: false, mensaje: err.message }]);
      return res.json(Array.isArray(resultado) ? { componentes: resultado, bsale: r } : { ...resultado, bsale: r });
    }
    return res.json(resultado);
  },

  /** Carga masiva simple desde CSV: { filas: [{ sku, descripcion, precio }] } */
  async importar(req, res) {
    const filas = req.body?.filas;
    if (!Array.isArray(filas) || !filas.length) throw new HttpError(400, 'No hay filas para importar');
    if (filas.length > MAX_IMPORTAR) throw new HttpError(400, `Máximo ${MAX_IMPORTAR} filas por archivo`);

    const errores = [];
    const porSku = new Map(); // si un SKU se repite, gana la última fila
    filas.forEach((f, i) => {
      try {
        const d = leerCampos({ ...f, precio: f.precio ?? 0 }, CAMPOS_CSV, { requeridos: true });
        porSku.set(d.sku, { ...d, precio: d.precio ?? 0 });
      } catch (err) {
        errores.push({ fila: i + 2, error: err.message }); // +2: encabezado y base 1
      }
    });
    if (errores.length) {
      throw new HttpError(400, `El archivo tiene ${errores.length} fila(s) con errores; no se importó nada`, errores.slice(0, 50));
    }
    res.json(await ProductoModel.importar([...porSku.values()]));
  },

  async gruposAnteriores(_req, res) {
    res.json(await ProductoModel.gruposAnteriores());
  },

  /** { categoria_anterior, subcategoria_anterior, subcategoria_id } */
  async reclasificar(req, res) {
    const d = leerCampos(req.body, {
      categoria_anterior: { tipo: 'texto', max: 120 }, subcategoria_anterior: { tipo: 'texto', max: 120 },
      subcategoria_id: { tipo: 'entero', requerido: true },
    }, { requeridos: true });
    const actualizados = await ProductoModel.reclasificar({
      categoriaAnterior: d.categoria_anterior, subcategoriaAnterior: d.subcategoria_anterior, subcategoriaId: d.subcategoria_id,
    });
    res.json({ actualizados });
  },

  // --- matriz de categorías y marcas ---

  async matriz(_req, res) {
    res.json(await CatalogoProductosModel.matriz());
  },

  async guardarCategoria(req, res) {
    const id = req.params.id ? idParam(req.params.id) : null;
    const d = leerCampos(req.body, {
      codigo: { tipo: 'texto', max: 2, requerido: !id }, nombre: { tipo: 'texto', max: 120, requerido: !id },
    }, { requeridos: !id });
    if (d.codigo && !/^\d{2}$/.test(d.codigo)) throw new HttpError(400, 'El código de categoría son 2 dígitos (ej. 10)');
    const antes = id && d.nombre ? (await query('SELECT nombre FROM categorias WHERE id = $1', [id])).rows[0] : null;
    const categoria = await CatalogoProductosModel.guardarCategoria({ id, ...d, activo: booleano(req.body.activo) });
    // una categoría nueva también se crea en Bsale como tipo de producto; si se renombra, se renombra allá
    if (!id && categoria?.id) return res.json({ ...categoria, bsale: await categoriaNueva(categoria.id, req.user) });
    if (antes) return res.json({ ...categoria, bsale: await renombrarCategoria(antes.nombre, d.nombre, req.user) });
    return res.json(categoria);
  },

  async guardarSubcategoria(req, res) {
    const id = req.params.id ? idParam(req.params.id) : null;
    const d = leerCampos(req.body, {
      categoria_id: { tipo: 'entero', requerido: !id }, codigo: { tipo: 'texto', max: 2, requerido: !id },
      nombre: { tipo: 'texto', max: 120, requerido: !id },
    }, { requeridos: !id });
    if (d.codigo && !/^\d{2}$/.test(d.codigo)) throw new HttpError(400, 'El código de subcategoría son 2 dígitos (ej. 03)');
    res.json(await CatalogoProductosModel.guardarSubcategoria({ id, ...d, activo: booleano(req.body.activo) }));
  },

  async marcas(_req, res) {
    res.json(await CatalogoProductosModel.marcas());
  },

  async guardarMarca(req, res) {
    const id = req.params.id ? idParam(req.params.id) : null;
    const d = leerCampos(req.body, {
      nombre: { tipo: 'texto', max: 60, requerido: !id }, segmento: { tipo: 'enum', lista: SEGMENTOS_MARCA },
    }, { requeridos: !id });
    const marca = await CatalogoProductosModel.guardarMarca({
      id, ...d, propia: booleano(req.body.propia), activo: booleano(req.body.activo),
    });
    // la API de Bsale no permite crear marcas: se avisa para crearla allá a mano
    if (!id && bsaleActivo()) return res.json({ ...marca, bsale: { activo: true, ok: false, mensaje: 'Crea esta marca también en Bsale (la API de Bsale no permite crear marcas)' } });
    return res.json(marca);
  },
};
