import { TIPOS_VEHICULO } from '../config/catalogos.js';
import { VehiculoModel } from '../models/vehiculo.model.js';
import { leerCampos } from '../utils/campos.js';
import { HttpError, idParam } from '../utils/http.js';

const CAMPOS = {
  nombre: { tipo: 'texto', max: 60, requerido: true },
  tipo: { tipo: 'enum', lista: TIPOS_VEHICULO, requerido: true },
  placa: { tipo: 'texto', max: 15 },
};

export const VehiculoController = {
  async listar(req, res) {
    res.json(await VehiculoModel.listar({ soloActivos: req.query.activos === 'true' }));
  },

  async crear(req, res) {
    res.status(201).json(await VehiculoModel.crear(leerCampos(req.body, CAMPOS, { requeridos: true })));
  },

  async actualizar(req, res) {
    const d = leerCampos(req.body, CAMPOS, { requeridos: true });
    const vehiculo = await VehiculoModel.actualizar(idParam(req.params.id), {
      ...d,
      activo: typeof req.body.activo === 'boolean' ? req.body.activo : undefined,
    });
    if (!vehiculo) throw new HttpError(404, 'Vehículo no encontrado');
    res.json(vehiculo);
  },
};
