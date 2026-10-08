import { HttpError } from './http.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convierte y valida un valor según su especificación.
 * Devuelve null para valores vacíos.
 */
function convertir(nombre, spec, valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  switch (spec.tipo) {
    case 'texto': {
      const v = String(valor).trim();
      if (spec.max && v.length > spec.max) throw new HttpError(400, `${nombre}: máximo ${spec.max} caracteres`);
      return v || null;
    }
    case 'enum':
      if (!spec.lista.includes(valor)) {
        throw new HttpError(400, `${nombre}: valor inválido "${valor}". Opciones: ${spec.lista.join(', ')}`);
      }
      return valor;
    case 'fecha':
      if (!FECHA.test(valor)) throw new HttpError(400, `${nombre}: fecha inválida (YYYY-MM-DD)`);
      return valor;
    case 'monto': {
      const n = Number(valor);
      if (Number.isNaN(n) || n < 0) throw new HttpError(400, `${nombre}: monto inválido`);
      return Math.round(n * 100) / 100;
    }
    case 'entero': {
      const n = Number(valor);
      if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${nombre}: debe ser un entero positivo`);
      return n;
    }
    case 'coord': {
      const n = Number(valor);
      const lim = spec.max ?? 180;
      if (Number.isNaN(n) || Math.abs(n) > lim) throw new HttpError(400, `${nombre}: coordenada inválida`);
      return n;
    }
    case 'ubigeo':
      if (!/^\d{6}$/.test(String(valor))) throw new HttpError(400, `${nombre}: código de distrito inválido`);
      return String(valor);
    default:
      return valor;
  }
}

/**
 * Toma de `body` solo los campos de `especificacion` presentes y los valida.
 * Con `requeridos: true` exige los campos marcados como requeridos.
 */
export function leerCampos(body, especificacion, { requeridos = false } = {}) {
  const datos = {};
  for (const [nombre, spec] of Object.entries(especificacion)) {
    if (!(nombre in (body ?? {}))) continue;
    datos[nombre] = convertir(nombre, spec, body[nombre]);
  }
  if (requeridos) {
    const faltan = Object.entries(especificacion)
      .filter(([n, s]) => s.requerido && (datos[n] === null || datos[n] === undefined))
      .map(([n]) => n);
    if (faltan.length) throw new HttpError(400, `Campos requeridos: ${faltan.join(', ')}`);
  }
  return datos;
}
