import { HttpError } from '../utils/http.js';

// Códigos de error de PostgreSQL más comunes → respuesta HTTP.
const PG_ERRORS = {
  '23505': [409, 'El registro ya existe'],
  '23503': [409, 'Referencia inválida o el registro está en uso'],
  '23001': [409, 'No se puede eliminar: tiene registros relacionados (p. ej. pedidos)'],
  '23514': [400, 'Valor fuera de rango'],
  '22P02': [400, 'Formato de dato inválido'],
  '22007': [400, 'Fecha inválida'],
  '22008': [400, 'Fecha inválida'],
};

export function notFound(req, _res, next) {
  next(new HttpError(404, `Ruta no encontrada: ${req.method} ${req.originalUrl}`));
}

export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  if (PG_ERRORS[err.code]) {
    const [status, message] = PG_ERRORS[err.code];
    return res.status(status).json({ error: message });
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
}
