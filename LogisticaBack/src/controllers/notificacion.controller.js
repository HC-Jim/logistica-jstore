import { query } from '../config/db.js';
import { pushConfigurado } from '../services/notificaciones.service.js';
import { leerCampos } from '../utils/campos.js';
import { HttpError } from '../utils/http.js';

export const NotificacionController = {
  /** Últimos avisos del usuario y cuántos no ha leído. */
  async listar(req, res) {
    const limite = Math.min(Number(req.query.limite) || 50, 200);
    const [{ rows }, { rows: [c] }] = await Promise.all([
      query(
        `SELECT id, tipo, titulo, cuerpo, url, datos, leida, creado_en FROM notificaciones
         WHERE usuario_id = $1 ORDER BY id DESC LIMIT $2`,
        [req.user.id, limite]
      ),
      query('SELECT COUNT(*)::int AS no_leidas FROM notificaciones WHERE usuario_id = $1 AND NOT leida', [req.user.id]),
    ]);
    res.json({ no_leidas: c.no_leidas, notificaciones: rows });
  },

  async contador(req, res) {
    const { rows: [c] } = await query(
      'SELECT COUNT(*)::int AS no_leidas FROM notificaciones WHERE usuario_id = $1 AND NOT leida',
      [req.user.id]
    );
    res.json(c);
  },

  /** { ids: [..] } o { todas: true } */
  async marcarLeidas(req, res) {
    if (req.body?.todas === true) {
      await query('UPDATE notificaciones SET leida = true WHERE usuario_id = $1 AND NOT leida', [req.user.id]);
    } else {
      const ids = (req.body?.ids ?? []).map(Number).filter(Number.isInteger);
      if (!ids.length) throw new HttpError(400, 'Indica las notificaciones (ids) o todas: true');
      await query('UPDATE notificaciones SET leida = true WHERE usuario_id = $1 AND id = ANY($2::bigint[])', [req.user.id, ids]);
    }
    res.status(204).end();
  },

  /** La app registra su token de FCM al iniciar sesión. */
  async registrarDispositivo(req, res) {
    const { token, plataforma } = leerCampos(
      req.body,
      { token: { tipo: 'texto', max: 4096, requerido: true }, plataforma: { tipo: 'enum', lista: ['android', 'ios', 'web'] } },
      { requeridos: true }
    );
    // si el token ya existía (otro usuario en el mismo celular), pasa al usuario actual
    await query(
      `INSERT INTO dispositivos (usuario_id, token, plataforma) VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET usuario_id = EXCLUDED.usuario_id, plataforma = EXCLUDED.plataforma, usado_en = now()`,
      [req.user.id, token, plataforma ?? 'android']
    );
    res.json({ push: pushConfigurado });
  },

  /** Al cerrar sesión el celular deja de recibir avisos de ese usuario. */
  async quitarDispositivo(req, res) {
    const { token } = leerCampos(req.body, { token: { tipo: 'texto', max: 4096, requerido: true } }, { requeridos: true });
    await query('DELETE FROM dispositivos WHERE token = $1 AND usuario_id = $2', [token, req.user.id]);
    res.status(204).end();
  },
};
