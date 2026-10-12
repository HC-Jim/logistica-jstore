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

  // Matriz de categorías: agrega las que falten (no pisa cambios hechos desde la web)
  const matriz = JSON.parse(await leer('./matriz_categorias.json'));
  for (const c of matriz) {
    const { rows: [cat] } = await pool.query(
      `INSERT INTO categorias (codigo, nombre) VALUES ($1, $2)
       ON CONFLICT (codigo) DO UPDATE SET codigo = EXCLUDED.codigo RETURNING id`,
      [c.codigo, c.nombre]
    );
    await pool.query(
      `INSERT INTO subcategorias (categoria_id, codigo, nombre)
       SELECT $1, * FROM unnest($2::text[], $3::text[]) ON CONFLICT (categoria_id, codigo) DO NOTHING`,
      [cat.id, c.subcategorias.map((s) => s.codigo), c.subcategorias.map((s) => s.nombre)]
    );
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
