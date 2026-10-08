import { catalogos } from '../config/catalogos.js';
import { env } from '../config/env.js';
import { query } from '../config/db.js';
import { EstadisticaModel } from '../models/estadistica.model.js';
import { resolverLink } from '../services/ubicacion.service.js';
import { requerir } from '../utils/http.js';
import { hoy } from '../utils/fecha.js';

let ubigeosCache = null;

export const CatalogoController = {
  /** Listas de opciones del formulario + datos del depósito. */
  catalogos(_req, res) {
    res.json({ ...catalogos, deposito: env.deposito });
  },

  /** Distritos del Perú como [codigo, departamento, provincia, distrito]. Casi nunca cambia. */
  async ubigeos(_req, res) {
    if (!ubigeosCache) {
      const { rows } = await query(
        'SELECT codigo, departamento, provincia, distrito FROM ubigeos ORDER BY departamento, provincia, distrito'
      );
      ubigeosCache = rows.map((r) => [r.codigo, r.departamento, r.provincia, r.distrito]);
    }
    res.set('Cache-Control', 'public, max-age=86400');
    res.json(ubigeosCache);
  },

  /** { url } de Google Maps (también enlaces cortos) → { lat, lng } */
  async resolverUbicacion(req, res) {
    requerir(req.body, ['url']);
    res.json(await resolverLink(req.body.url));
  },

  async estadisticas(req, res) {
    const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 366);
    const fin = hoy();
    const inicio = new Date(`${fin}T12:00:00Z`);
    inicio.setUTCDate(inicio.getUTCDate() - (dias - 1));
    res.json(await EstadisticaModel.dashboard({
      desde: inicio.toISOString().slice(0, 10),
      hasta: fin,
      hoy: fin,
    }));
  },
};
