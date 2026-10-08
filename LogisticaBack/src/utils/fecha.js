import { env } from '../config/env.js';

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria del negocio. */
export const hoy = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: env.timezone }).format(new Date());
