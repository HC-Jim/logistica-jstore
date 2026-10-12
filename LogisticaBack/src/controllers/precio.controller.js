import { TIPOS_CLIENTE } from '../config/catalogos.js';
import { PrecioModel } from '../models/precio.model.js';
import { leerCampos } from '../utils/campos.js';
import { hoy } from '../utils/fecha.js';
import { HttpError, idParam } from '../utils/http.js';

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
    res.status(201).json(vigente);
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
