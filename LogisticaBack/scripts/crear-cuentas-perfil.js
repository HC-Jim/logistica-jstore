// Genera una cuenta por cada perfil (vendedor, planificador, almacén, repartidor).
// Uso:   node scripts/crear-cuentas-perfil.js <dominio>      p. ej.  jotastore.pe
// Escribe el SQL (para Neon → SQL Editor) y un archivo local con las credenciales para entregarlas.
import { writeFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';

const dominio = (process.argv[2] || '').replace(/^@/, '').trim().toLowerCase();
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dominio)) {
  console.error('Uso: node scripts/crear-cuentas-perfil.js <dominio>   (p. ej. jotastore.pe)');
  process.exit(1);
}

const CUENTAS = [
  ['Vendedor', 'vendedor', 'vendedor'],
  ['Planificador', 'planificador', 'planificador'],
  ['Almacén', 'almacen', 'almacen'],
  ['Repartidor', 'repartidor', 'repartidor'],
];

const LETRAS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
const clave = () => Array.from({ length: 10 }, () => LETRAS[randomInt(LETRAS.length)]).join('');

const filas = [];
const credenciales = [];
for (const [nombre, usuario, rol] of CUENTAS) {
  const email = `${usuario}@${dominio}`;
  const password = clave();
  filas.push(`  ('${nombre}', '${email}', '${await bcrypt.hash(password, 10)}', '${rol}')`);
  credenciales.push(`${rol.padEnd(13)} ${email.padEnd(32)} ${password}`);
}

const sql = `INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES
${filas.join(',\n')}
ON CONFLICT (email) DO NOTHING
RETURNING id, email, rol;
`;
writeFileSync('credenciales-perfiles.txt', `Cuentas creadas (${new Date().toLocaleString('es-PE')})\n` +
  'Entrega cada una a la persona correspondiente y luego BORRA este archivo.\n' +
  'Puedes cambiar nombres y contraseñas en la web: Usuarios → Editar / Nueva contraseña.\n\n' +
  `${'PERFIL'.padEnd(13)} ${'CORREO'.padEnd(32)} CONTRASEÑA\n${credenciales.join('\n')}\n`);

console.log('\n1) Copia y ejecuta esto en Neon → SQL Editor (rama production):\n');
console.log(sql);
console.log('2) Las contraseñas quedaron en LogisticaBack/credenciales-perfiles.txt (no se sube a GitHub).\n');
