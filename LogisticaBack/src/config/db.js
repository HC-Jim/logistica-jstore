import pg from 'pg';
import { env } from './env.js';

// NUMERIC y BIGINT llegan como string por defecto; los convertimos a número.
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
// DATE se mantiene como 'YYYY-MM-DD' para evitar desfases de zona horaria.
pg.types.setTypeParser(1082, (v) => v);

// El SSL se toma de la URL (Neon incluye ?sslmode=require).
// En Vercel cada función serverless abre su propio pool: lo mantenemos pequeño.
export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: process.env.VERCEL ? 3 : 10,
});

export const query = (text, params) => pool.query(text, params);

/** Ejecuta `fn(client)` dentro de una transacción. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
