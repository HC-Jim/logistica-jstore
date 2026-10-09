import { readFileSync, existsSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';

// --- Credenciales de Firebase (solo para enviar push a la app; los datos viven en Neon) ---
// En Vercel: variable FIREBASE_SERVICE_ACCOUNT con el JSON de la cuenta de servicio (o en base64).
// En local: archivo LogisticaBack/firebase-service-account.json.
function cargarCuenta() {
  try {
    const crudo = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (crudo) {
      const texto = crudo.trim().startsWith('{') ? crudo : Buffer.from(crudo, 'base64').toString('utf8');
      return JSON.parse(texto);
    }
    const archivo = new URL('../../firebase-service-account.json', import.meta.url);
    if (existsSync(archivo)) return JSON.parse(readFileSync(archivo, 'utf8'));
  } catch (err) {
    console.error('Cuenta de servicio de Firebase inválida:', err.message);
  }
  return null;
}
const cuenta = cargarCuenta();
export const pushConfigurado = Boolean(cuenta);

let tokenAcceso = null; // { valor, vence }

/** Token OAuth2 para la API HTTP v1 de FCM (se renueva cada ~55 min). */
async function obtenerTokenAcceso() {
  if (tokenAcceso && tokenAcceso.vence > Date.now() + 60_000) return tokenAcceso.valor;
  const ahora = Math.floor(Date.now() / 1000);
  const afirmacion = jwt.sign(
    {
      iss: cuenta.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: ahora,
      exp: ahora + 3600,
    },
    cuenta.private_key,
    { algorithm: 'RS256' }
  );
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: afirmacion }),
  });
  const datos = await res.json();
  if (!res.ok) throw new Error(`OAuth Firebase: ${datos.error_description ?? res.status}`);
  tokenAcceso = { valor: datos.access_token, vence: Date.now() + datos.expires_in * 1000 };
  return tokenAcceso.valor;
}

/** Envía el aviso a todos los celulares de esos usuarios. Elimina los tokens que ya no existen. */
async function enviarPush(usuarioIds, aviso) {
  if (!cuenta || !usuarioIds.length) return;
  const { rows: dispositivos } = await query('SELECT id, token FROM dispositivos WHERE usuario_id = ANY($1::int[])', [usuarioIds]);
  if (!dispositivos.length) return;

  const acceso = await obtenerTokenAcceso();
  // FCM exige que "data" tenga solo textos
  const data = Object.fromEntries(
    Object.entries({ tipo: aviso.tipo, url: aviso.url, ...(aviso.datos ?? {}) })
      .filter(([, v]) => v != null)
      .map(([k, v]) => [k, String(v)])
  );
  await Promise.all(dispositivos.map(async (d) => {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${cuenta.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${acceso}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: d.token,
          notification: { title: aviso.titulo, body: aviso.cuerpo ?? '' },
          data,
          android: { priority: 'high', notification: { channel_id: 'avisos', sound: 'default' } },
          apns: { payload: { aps: { sound: 'default' } } },
        },
      }),
    });
    if (res.status === 404 || res.status === 400) {
      const e = await res.json().catch(() => ({}));
      const codigo = e.error?.details?.[0]?.errorCode ?? e.error?.status;
      // el celular desinstaló la app o renovó su token
      if (['UNREGISTERED', 'INVALID_ARGUMENT', 'NOT_FOUND'].includes(codigo)) {
        await query('DELETE FROM dispositivos WHERE id = $1', [d.id]);
      }
    } else if (!res.ok) {
      console.error('FCM:', res.status, await res.text().catch(() => ''));
    }
  }));
}

/**
 * Crea un aviso para cada usuario (bandeja de la web y la app) y lo envía como push.
 * Nunca hace fallar la operación principal: los errores solo se registran.
 * aviso = { tipo, titulo, cuerpo, url, datos }
 */
export async function notificar(usuarioIds, aviso, { excepto } = {}) {
  const destinos = [...new Set(usuarioIds.filter((id) => id && id !== excepto))];
  if (!destinos.length) return;
  try {
    await query(
      `INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, url, datos)
       SELECT unnest($1::int[]), $2, $3, $4, $5, $6`,
      [destinos, aviso.tipo, aviso.titulo.slice(0, 120), aviso.cuerpo?.slice(0, 500) ?? null, aviso.url ?? null,
        aviso.datos ? JSON.stringify(aviso.datos) : null]
    );
    // En Vercel la función termina al responder: se espera el envío, con un tope de tiempo
    await Promise.race([enviarPush(destinos, aviso), new Promise((r) => setTimeout(r, 4000))]);
  } catch (err) {
    console.error('No se pudo notificar:', err.message);
  }
}

/** Usuarios activos con alguno de esos roles (p. ej. logística para avisos de incidencias). */
export async function usuariosConRol(roles) {
  const { rows } = await query('SELECT id FROM usuarios WHERE activo AND rol = ANY($1::text[])', [roles]);
  return rows.map((r) => r.id);
}
