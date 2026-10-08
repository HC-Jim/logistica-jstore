import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { env } from '../config/env.js';

// Las migraciones usan la conexión directa (sin pooler) si existe.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED || env.databaseUrl });

const leer = (archivo) => readFile(new URL(archivo, import.meta.url), 'utf8');

try {
  await pool.query(await leer('./schema.sql'));
  console.log('Esquema aplicado.');

  // Ubigeos: solo la primera vez
  const { rows: [{ count }] } = await pool.query('SELECT COUNT(*)::int AS count FROM ubigeos');
  if (count === 0) {
    const filas = JSON.parse(await leer('./ubigeo.json')); // [codigo, departamento, provincia, distrito]
    await pool.query(
      `INSERT INTO ubigeos (codigo, departamento, provincia, distrito)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])`,
      [0, 1, 2, 3].map((i) => filas.map((f) => f[i]))
    );
    console.log(`Ubigeos cargados: ${filas.length}`);
  }

  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NOMBRE = 'Administrador' } = process.env;
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const { rowCount } = await pool.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol)
       VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (email) DO NOTHING`,
      [ADMIN_NOMBRE, ADMIN_EMAIL.toLowerCase(), hash]
    );
    if (rowCount) console.log(`Administrador creado: ${ADMIN_EMAIL}`);
  }
} catch (err) {
  console.error('Error en la migración:', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
