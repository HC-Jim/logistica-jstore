import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http.js';

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) throw new HttpError(401, 'Token requerido');
  try {
    req.user = jwt.verify(header.slice(7), env.jwtSecret);
  } catch {
    throw new HttpError(401, 'Token inválido o expirado');
  }
  next();
}

export const requireRol = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user?.rol)) throw new HttpError(403, 'No tienes permisos');
  next();
};
