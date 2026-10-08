// Genera el SQL con una cuenta por defecto para cada perfil (contraseña visible para el admin).
// Uso:   node scripts/crear-cuentas-perfil.js <dominio>      p. ej.  jotastore.pe
// Crea usuarios-por-defecto.sql: pégalo en Neon → SQL Editor (rama production) y pulsa Run.
// Si un correo ya existe, no se modifica (ON CONFLICT DO NOTHING).
import { writeFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';

const dominio = (process.argv[2] || '').replace(/^@/, '').trim().toLowerCase();
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dominio)) {
  console.error('Uso: node scripts/crear-cuentas-perfil.js <dominio>   (p. ej. jotastore.pe)');
  process.exit(1);
}

// [nombre, usuario del correo, rol]  ('repartidor' = Conductor)
const CUENTAS = [
  ['Vendedor Prueba', 'vendedor', 'vendedor'],
  ['Planificador Prueba', 'planificador', 'planificador'],
  ['Almacén Prueba', 'almacen', 'almacen'],
  ['Conductor Prueba', 'conductor', 'repartidor'],
  ['Auxiliar Logístico Prueba', 'auxiliar', 'auxiliar'],
];

const LETRAS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
const clave = () => Array.from({ length: 10 }, () => LETRAS[randomInt(LETRAS.length)]).join('');

const filas = [];
const resumen = [];
for (const [nombre, usuario, rol] of CUENTAS) {
  const email = `${usuario}@${dominio}`;
  const password = clave();
  filas.push(`  ('${nombre}', '${email}', '${await bcrypt.hash(password, 10)}', '${password}', '${rol}')`);
  resumen.push(`--   ${rol.padEnd(12)} ${email.padEnd(30)} ${password}`);
}

const sql = `-- Usuarios por defecto (${new Date().toLocaleString('es-PE')})
-- Ejecutar en Neon → rama production → SQL Editor → Run.
-- Las contraseñas también se ven en la web: Usuarios → columna "Contraseña".
--
--   PERFIL       CORREO                         CONTRASEÑA
${resumen.join('\n')}

INSERT INTO usuarios (nombre, email, password_hash, clave_visible, rol) VALUES
${filas.join(',\n')}
ON CONFLICT (email) DO NOTHING
RETURNING id, nombre, email, rol, clave_visible;
`;
writeFileSync('usuarios-por-defecto.sql', sql);
console.log(sql);
console.log('Guardado en LogisticaBack/usuarios-por-defecto.sql (no se sube a GitHub).');
