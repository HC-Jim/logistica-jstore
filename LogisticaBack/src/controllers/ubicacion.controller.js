import { TIPOS_UBICACION } from '../config/catalogos.js';
import { UbicacionModel } from '../models/ubicacion.model.js';
import { leerCampos } from '../utils/campos.js';
import { HttpError, idParam } from '../utils/http.js';

const CAMPOS = {
  nombre: { tipo: 'texto', max: 120, requerido: true },
  tipo: { tipo: 'enum', lista: TIPOS_UBICACION, requerido: true },
  direccion: { tipo: 'texto', max: 255 },
  ubigeo: { tipo: 'ubigeo' },
  referencia: { tipo: 'texto', max: 255 },
  contacto: { tipo: 'texto', max: 120 },
  telefono: { tipo: 'texto', max: 30 },
  lat: { tipo: 'coord', max: 90, requerido: true },
  lng: { tipo: 'coord', max: 180, requerido: true },
};

export const UbicacionController = {
  async listar(req, res) {
    res.json(await UbicacionModel.listar({ soloActivas: req.query.activas === 'true' }));
  },

  async crear(req, res) {
    res.status(201).json(await UbicacionModel.crear(leerCampos(req.body, CAMPOS, { requeridos: true })));
  },

  async actualizar(req, res) {
    const datos = leerCampos(req.body, CAMPOS, { requeridos: true });
    const u = await UbicacionModel.actualizar(
      idParam(req.params.id), datos, typeof req.body.activo === 'boolean' ? req.body.activo : undefined
    );
    if (!u) throw new HttpError(404, 'Ubicación no encontrada');
    res.json(u);
  },
};
