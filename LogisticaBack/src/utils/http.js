export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Lanza 400 si falta alguno de los campos requeridos en `body`. */
export function requerir(body, campos) {
  const faltantes = campos.filter(
    (c) => body?.[c] === undefined || body[c] === null || body[c] === ''
  );
  if (faltantes.length) {
    throw new HttpError(400, `Campos requeridos: ${faltantes.join(', ')}`);
  }
}

/** Convierte un parámetro de ruta en entero positivo o lanza 400. */
export function idParam(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'ID inválido');
  return id;
}
