// Genera el SQL para cambiar la contraseña (y opcionalmente el correo) de un usuario.
// Uso:   node scripts/restablecer-clave.js <correo-actual> <nueva-clave> [nuevo-correo]
// Luego pega el resultado en Neon → SQL Editor (rama production).
import bcrypt from 'bcryptjs';

const [correo, clave, nuevoCorreo] = process.argv.slice(2);
if (!correo || !clave) {
  console.error('Uso: node scripts/restablecer-clave.js <correo-actual> <nueva-clave> [nuevo-correo]');
  process.exit(1);
}
if (clave.length < 6) {
  console.error('La contraseña debe tener al menos 6 caracteres');
  process.exit(1);
}

const hash = await bcrypt.hash(clave, 10);
const sqlTexto = (t) => `'${t.trim().toLowerCase().replace(/'/g, "''")}'`;
const cambios = [`password_hash = '${hash}'`, `clave_visible = '${clave.replace(/'/g, "''")}'`, 'activo = true'];
if (nuevoCorreo) cambios.push(`email = ${sqlTexto(nuevoCorreo)}`);

console.log('\nCopia y ejecuta esto en Neon → SQL Editor (rama production):\n');
console.log(`UPDATE usuarios SET ${cambios.join(', ')} WHERE email = ${sqlTexto(correo)} RETURNING id, email, rol;\n`);
