import { mkdir, writeFile } from 'node:fs/promises';
import { put } from '@vercel/blob';
import { HttpError } from '../utils/http.js';

export const TIPOS_FOTO = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Carpeta para las fotos en desarrollo (en Vercel se usa Vercel Blob). */
export const CARPETA_LOCAL = new URL('../../uploads/', import.meta.url);

/**
 * Guarda la foto de una entrega y devuelve su URL.
 * Producción: Vercel Blob (variable BLOB_READ_WRITE_TOKEN, se crea al conectar un Blob store al proyecto).
 * Desarrollo: carpeta LogisticaBack/uploads, servida en /api/uploads.
 */
export async function guardarFoto(buffer, tipo, nombre) {
  const ext = TIPOS_FOTO[tipo];
  if (!ext) throw new HttpError(415, 'La foto debe ser JPG, PNG o WEBP');
  if (!buffer?.length) throw new HttpError(400, 'No llegó la foto');

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    // el sufijo aleatorio hace que la URL no se pueda adivinar
    const blob = await put(`entregas/${nombre}.${ext}`, buffer, { access: 'public', contentType: tipo, addRandomSuffix: true });
    return blob.url;
  }
  if (process.env.VERCEL) {
    throw new HttpError(500, 'Falta configurar el almacenamiento de fotos (Vercel Blob) en el servidor');
  }
  await mkdir(CARPETA_LOCAL, { recursive: true });
  const archivo = `${nombre}-${Date.now()}.${ext}`;
  await writeFile(new URL(archivo, CARPETA_LOCAL), buffer);
  return `/api/uploads/${archivo}`;
}
