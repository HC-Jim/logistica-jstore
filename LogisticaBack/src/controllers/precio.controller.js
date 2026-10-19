import { TIPOS_CLIENTE } from '../config/catalogos.js';
import { query } from '../config/db.js';
import { PrecioModel } from '../models/precio.model.js';
import { listasActivas, preciosBsaleDeProducto, sincronizarProducto } from '../services/bsale.service.js';
import { leerCampos } from '../utils/campos.js';
import { hoy } from '../utils/fecha.js';
import { HttpError, idParam } from '../utils/http.js';

const MAX_FILAS = 5000;

/** Monto escrito como 49.9, "49,90" o "S/ 49.90"; null si está vacío y undefined si no es un número válido. */
function leerMonto(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : undefined;
  const t = String(v).replace(/s\/\.?/i, '').replace(/\s/g, '');
  if (!t) return null;
  const n = Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
}

/** Fecha AAAA-MM-DD o DD/MM/AAAA (también con guiones); null si no es una fecha real. */
function leerFecha(v) {
  const t = String(v ?? '').trim();
  let a;
  let m;
  let d;
  let x = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (x) [, a, m, d] = x;
  else if ((x = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t))) [, d, m, a] = x;
  else return null;
  const f = new Date(Date.UTC(+a, +m - 1, +d));
  if (f.getUTCFullYear() !== +a || f.getUTCMonth() !== +m - 1 || f.getUTCDate() !== +d) return null;
  return f.toISOString().slice(0, 10);
}

export const PrecioController = {
  async plataformas(_req, res) {
    res.json(await PrecioModel.plataformas());
  },

  /** Precio vigente por plataforma. ?q=&categoria_id=&marca_id=&producto_id=&todos=1 */
  async vigentes(req, res) {
    const f = leerCampos(req.query, { categoria_id: { tipo: 'entero' }, marca_id: { tipo: 'entero' }, producto_id: { tipo: 'entero' } });
    res.json(await PrecioModel.vigentes({
      q: req.query.q, categoriaId: f.categoria_id, marcaId: f.marca_id, productoId: f.producto_id,
      soloActivos: req.query.todos !== '1', limite: Math.min(Number(req.query.limite) || 2000, 5000),
    }));
  },

  async historial(req, res) {
    res.json(await PrecioModel.historial(idParam(req.params.id)));
  },

  /** { producto_id, fecha, precio_normal, precios: [{ plataforma_id, precio }] } */
  async registrar(req, res) {
    const d = leerCampos(req.body, {
      producto_id: { tipo: 'entero', requerido: true }, fecha: { tipo: 'fecha' }, precio_normal: { tipo: 'monto' },
    }, { requeridos: true });
    const lista = req.body?.precios;
    if (!Array.isArray(lista) || !lista.length) throw new HttpError(400, 'Indica al menos un precio');
    const precios = lista.map((p) => leerCampos(p, {
      plataforma_id: { tipo: 'entero', requerido: true }, precio: { tipo: 'monto', requerido: true },
    }, { requeridos: true }));
    if (new Set(precios.map((p) => p.plataforma_id)).size !== precios.length) throw new HttpError(400, 'Hay plataformas repetidas');
    const fecha = d.fecha ?? hoy();
    if (fecha > hoy()) throw new HttpError(400, 'La fecha del precio no puede ser futura');
    if (d.precio_normal != null && precios.some((p) => p.precio > d.precio_normal)) {
      throw new HttpError(400, 'Un precio no puede ser mayor que el precio normal');
    }
    await PrecioModel.registrar({ productoId: d.producto_id, fecha, precioNormal: d.precio_normal, precios, usuario: req.user });
    const [vigente] = await PrecioModel.vigentes({ productoId: d.producto_id, soloActivos: false });
    // Bsale se actualiza en el momento; si falla, el precio queda guardado igual y se puede reenviar
    const bsale = await sincronizarProducto(d.producto_id, req.user);
    res.status(201).json({ ...vigente, bsale });
  },

  /** Listas de Bsale activas (para mostrarlas como columnas junto a las plataformas). */
  async listasBsale(_req, res) {
    res.json(await listasActivas());
  },

  /** Precios del producto en cada lista de Bsale. ?actualizar=1 los consulta en Bsale en ese momento. */
  async bsaleDeProducto(req, res) {
    res.json(await preciosBsaleDeProducto(idParam(req.params.id), { actualizar: req.query.actualizar === '1' }));
  },

  /**
   * Carga masiva desde la plantilla. { filas: [{ fila, sku, plataforma, fecha, precio, precio_normal }], confirmar }
   * Sin `confirmar` solo revisa; con `confirmar` registra (si no hay errores). Las filas sin cambio se omiten.
   * La plataforma debe ser una de las definidas, escrita en mayúsculas.
   */
  async importar(req, res) {
    const filas = req.body?.filas;
    const confirmar = req.body?.confirmar === true;
    if (!Array.isArray(filas) || !filas.length) throw new HttpError(400, 'La plantilla no tiene filas');
    if (filas.length > MAX_FILAS) throw new HttpError(400, `Máximo ${MAX_FILAS} filas por carga`);

    const plataformas = (await PrecioModel.plataformas()).filter((x) => x.activo);
    const porNombre = new Map(plataformas.map((x) => [x.nombre.toUpperCase(), x]));
    const nombres = [...porNombre.keys()].join(', ');
    const skus = [...new Set(filas.map((f) => String(f.sku ?? '').trim().toUpperCase()).filter(Boolean))];
    const { rows: prods } = await query(
      'SELECT id, sku, descripcion, precio_normal::float AS precio_normal FROM productos WHERE upper(btrim(sku)) = ANY($1::text[])', [skus]
    );
    const prodPorSku = new Map(prods.map((x) => [x.sku.trim().toUpperCase(), x]));
    const { rows: vig } = await query(
      `SELECT DISTINCT ON (producto_id, plataforma_id) producto_id, plataforma_id, precio::float AS precio
       FROM precios WHERE producto_id = ANY($1::int[]) ORDER BY producto_id, plataforma_id, fecha DESC`,
      [prods.map((x) => x.id)]
    );
    const vigente = new Map(vig.map((v) => [`${v.producto_id}:${v.plataforma_id}`, v.precio]));

    const hoyStr = hoy();
    const errores = [];
    const validas = [];
    const vistos = new Set();
    let sinCambio = 0;
    filas.forEach((f, i) => {
      const fila = Number(f.fila) || i + 2;
      const error = (mensaje) => { errores.push({ fila, sku: f.sku ?? '', mensaje }); };
      const sku = String(f.sku ?? '').trim().toUpperCase();
      if (!sku) return error('Falta el SKU');
      const prod = prodPorSku.get(sku);
      if (!prod) return error(`El SKU ${sku} no existe en el sistema`);
      const nombre = String(f.plataforma ?? '').trim();
      if (!nombre) return error('Falta la plataforma');
      if (!porNombre.has(nombre.toUpperCase())) return error(`Plataforma desconocida "${nombre}". Usa: ${nombres}`);
      if (nombre !== nombre.toUpperCase()) return error(`Escribe la plataforma en mayúsculas: ${nombre.toUpperCase()}`);
      const pl = porNombre.get(nombre);
      const fecha = f.fecha == null || String(f.fecha).trim() === '' ? hoyStr : leerFecha(f.fecha);
      if (!fecha) return error(`Fecha inválida "${f.fecha}" (usa DD/MM/AAAA)`);
      if (fecha > hoyStr) return error('La fecha no puede ser futura');
      const precio = leerMonto(f.precio);
      if (precio == null || precio <= 0) return error(`Precio inválido "${f.precio ?? ''}"`);
      const normal = leerMonto(f.precio_normal);
      if (normal === undefined || (normal != null && normal <= 0)) return error(`Precio normal inválido "${f.precio_normal}"`);
      if (normal != null && precio > normal) return error(`El precio (${precio}) es mayor que el precio normal (${normal})`);
      const clave = `${prod.id}:${pl.id}:${fecha}`;
      if (vistos.has(clave)) return error(`Fila repetida: ${sku} · ${nombre} · ${fecha}`);
      vistos.add(clave);
      const antes = vigente.get(`${prod.id}:${pl.id}`) ?? null;
      const normalIgual = normal == null || (prod.precio_normal != null && Math.abs(prod.precio_normal - normal) < 0.005);
      if (antes != null && Math.abs(antes - precio) < 0.005 && normalIgual) { sinCambio++; return undefined; }
      validas.push({
        fila, producto_id: prod.id, sku: prod.sku, descripcion: prod.descripcion, plataforma_id: pl.id, plataforma: pl.nombre,
        fecha, precio, precio_normal: normal, antes,
      });
      return undefined;
    });

    // un mismo SKU y fecha se guardan juntos: no pueden traer dos precios normales distintos
    const grupos = new Map();
    for (const v of validas) {
      const k = `${v.producto_id}|${v.fecha}`;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(v);
    }
    for (const g of grupos.values()) {
      const normales = new Set(g.map((v) => v.precio_normal).filter((n) => n != null));
      if (normales.size > 1) for (const v of g) errores.push({ fila: v.fila, sku: v.sku, mensaje: `Precios normales distintos para ${v.sku} el ${v.fecha}` });
    }
    errores.sort((a, b) => a.fila - b.fila);

    const resumen = {
      filas: filas.length, cambios: validas.length, sin_cambio: sinCambio, errores: errores.length,
      productos: new Set(validas.map((v) => v.producto_id)).size,
    };
    if (!confirmar || errores.length) {
      return res.json({ resumen, errores: errores.slice(0, 1000), cambios: validas.slice(0, 1000) });
    }
    for (const g of grupos.values()) {
      const normal = g.find((v) => v.precio_normal != null)?.precio_normal ?? null;
      await PrecioModel.registrar({
        productoId: g[0].producto_id, fecha: g[0].fecha, precioNormal: normal,
        precios: g.map((v) => ({ plataforma_id: v.plataforma_id, precio: v.precio })), usuario: req.user,
      });
    }
    return res.json({ resumen, registrados: validas.length, producto_ids: [...new Set(validas.map((v) => v.producto_id))] });
  },


  async eliminar(req, res) {
    if (!(await PrecioModel.eliminar(idParam(req.params.id)))) throw new HttpError(404, 'Precio no encontrado');
    res.status(204).end();
  },

  async descuentos(_req, res) {
    res.json(await PrecioModel.descuentos());
  },

  /** { grupo: 'propias' | 'otras', tramos: [{ tipo_cliente, desde, hasta, porcentaje }] } */
  async guardarDescuentos(req, res) {
    const { grupo } = leerCampos(req.body, { grupo: { tipo: 'enum', lista: ['propias', 'otras'], requerido: true } }, { requeridos: true });
    const lista = req.body?.tramos;
    if (!Array.isArray(lista)) throw new HttpError(400, 'tramos debe ser una lista');
    const tramos = lista.map((t) => {
      const x = leerCampos(t, {
        tipo_cliente: { tipo: 'enum', lista: TIPOS_CLIENTE, requerido: true }, desde: { tipo: 'entero', requerido: true },
        hasta: { tipo: 'entero' }, porcentaje: { tipo: 'monto', requerido: true },
      }, { requeridos: true });
      if (x.hasta != null && x.hasta < x.desde) throw new HttpError(400, `Tramo ${x.desde}–${x.hasta}: "hasta" es menor que "desde"`);
      if (x.porcentaje > 100) throw new HttpError(400, 'El descuento no puede pasar de 100 %');
      return x;
    });
    // los tramos de un mismo tipo de cliente no se pueden cruzar
    for (const tipo of TIPOS_CLIENTE) {
      const t = tramos.filter((x) => x.tipo_cliente === tipo).sort((a, b) => a.desde - b.desde);
      for (let i = 1; i < t.length; i++) {
        if (t[i - 1].hasta == null || t[i - 1].hasta >= t[i].desde) {
          throw new HttpError(400, `${tipo}: los tramos ${t[i - 1].desde}–${t[i - 1].hasta ?? '+'} y ${t[i].desde}–${t[i].hasta ?? '+'} se cruzan`);
        }
      }
    }
    res.json(await PrecioModel.guardarDescuentos(grupo, tramos));
  },
};
