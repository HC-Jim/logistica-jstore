import { ProductoModel } from '../models/producto.model.js';
import { leerCampos } from '../utils/campos.js';
import { HttpError, idParam } from '../utils/http.js';

const CAMPOS = {
  sku: { tipo: 'texto', max: 60, requerido: true },
  descripcion: { tipo: 'texto', max: 255, requerido: true },
  precio: { tipo: 'monto' },
};

const MAX_IMPORTAR = 10000;

export const ProductoController = {
  async listar(req, res) {
    res.json(await ProductoModel.listar({
      q: req.query.q,
      soloActivos: req.query.activos === 'true',
      limite: Math.min(Number(req.query.limite) || 1000, 5000),
    }));
  },

  async crear(req, res) {
    const d = leerCampos(req.body, CAMPOS, { requeridos: true });
    res.status(201).json(await ProductoModel.crear({ ...d, activo: req.body.activo !== false }));
  },

  async actualizar(req, res) {
    const d = leerCampos(req.body, CAMPOS, { requeridos: true });
    const producto = await ProductoModel.actualizar(idParam(req.params.id), { ...d, activo: req.body.activo !== false });
    if (!producto) throw new HttpError(404, 'Producto no encontrado');
    res.json(producto);
  },

  async eliminar(req, res) {
    if (!(await ProductoModel.eliminar(idParam(req.params.id)))) throw new HttpError(404, 'Producto no encontrado');
    res.status(204).end();
  },

  /** Carga masiva desde CSV (el frontend envía las filas ya leídas): { filas: [{ sku, descripcion, precio }] } */
  async importar(req, res) {
    const filas = req.body?.filas;
    if (!Array.isArray(filas) || !filas.length) throw new HttpError(400, 'No hay filas para importar');
    if (filas.length > MAX_IMPORTAR) throw new HttpError(400, `Máximo ${MAX_IMPORTAR} filas por archivo`);

    const errores = [];
    const porSku = new Map(); // si un SKU se repite, gana la última fila
    filas.forEach((f, i) => {
      try {
        const d = leerCampos({ ...f, precio: f.precio ?? 0 }, CAMPOS, { requeridos: true });
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
};
