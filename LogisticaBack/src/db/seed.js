// Datos de ejemplo para DESARROLLO (rama "dev" de Neon). Ejecutar después de `npm run migrate`.
// Crea un usuario por rol con la contraseña SEED_PASSWORD (por defecto "demo1234").
import bcrypt from 'bcryptjs';
import { pool } from '../config/db.js';
import { hoy } from '../utils/fecha.js';

const PASSWORD = process.env.SEED_PASSWORD || 'demo1234';

const USUARIOS = [
  ['Mariana Tantalean', 'mariana@logistica.local', 'vendedor'],
  ['Luz Balbuena', 'luz@logistica.local', 'vendedor'],
  ['Planificación', 'logistica@logistica.local', 'planificador'],
  ['Almacén', 'almacen@logistica.local', 'almacen'],
  ['Alexander', 'alexander@logistica.local', 'repartidor'],
  ['Enrique', 'enrique@logistica.local', 'repartidor'],
  ['Lucalon', 'lucalon@logistica.local', 'repartidor'],
];

const PRODUCTOS = [
  ['EST-4P', 'Estante Pretul de 4 Repisas EST-4P', 63],
  ['SEVX-E2', 'Silla Evox One E2 Base Acero Negro', 269],
  ['CXM-C302', 'Cámara Xiaomi C302', 122],
  ['ECR-100T', 'Ecran con Trípode de 100"', 299],
  ['MET-500', 'Pirómetro Truper METE-500', 149],
  ['CLE-WR1', 'Cojín Lumbar Evox WR1 Negro', 32],
  ['BAL-5T', 'Balanza Digital Truper con Tazón BASE-5T', 56.27],
  ['SEVX-C17', 'Silla Evox Ultimate C17 Negro', 654],
];

// [cliente, telefono, ubigeo, direccion, lat, lng, plataforma, tipo, sku, cantidad]
const PEDIDOS = [
  ['Gilda Vasquez', '996604729', '150136', 'Trinidad María Enríquez 198', -12.0779, -77.0866, 'Mercado Libre', 'Flex', 'EST-4P', 2],
  ['Fritz Cueva', '991468004', '150103', 'Av. Central 309', -12.0262, -76.9192, 'Móvil', 'Delivery', 'SEVX-C17', 1],
  ['Benny Yacila', '989308301', '150108', 'Ca. Ontario 254', -12.1689, -77.0157, 'Mercado Libre', 'Flex', 'ECR-100T', 1],
  ['Raúl Adolfo', '997549334', '150108', 'Ca. Zungaros 434', -12.1755, -77.0202, 'Mercado Libre', 'Flex', 'CXM-C302', 1],
  ['Lys Consuelo', '900229399', '150134', 'Jr. Cuzco 3734', -12.0334, -77.0753, 'Mercado Libre', 'Flex', 'EST-4P', 1],
  ['Miguel Suasnabar', '943597197', '150134', 'Trinidad 250', -12.0410, -77.0790, 'Mercado Libre', 'Flex', 'MET-500', 1],
];

try {
  const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int AS n FROM pedidos');
  if (n > 0) {
    console.log('La base ya tiene pedidos; no se insertó nada.');
  } else {
    const hash = await bcrypt.hash(PASSWORD, 10);
    for (const [nombre, email, rol] of USUARIOS) {
      await pool.query(
        `INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO NOTHING`,
        [nombre, email, hash, rol]
      );
    }
    for (const [sku, descripcion, precio] of PRODUCTOS) {
      await pool.query(
        'INSERT INTO productos (sku, descripcion, precio) VALUES ($1, $2, $3) ON CONFLICT (sku) DO NOTHING',
        [sku, descripcion, precio]
      );
    }
    const { rows: vendedores } = await pool.query(`SELECT id FROM usuarios WHERE rol = 'vendedor' ORDER BY id`);
    for (const [i, [cliente, tel, ubigeo, dir, lat, lng, plataforma, tipo, sku, cant]] of PEDIDOS.entries()) {
      const { rows: [prod] } = await pool.query('SELECT * FROM productos WHERE sku = $1', [sku]);
      const { rows: [{ id }] } = await pool.query(
        `INSERT INTO pedidos (plataforma, tipo_pedido, vendedor_id, cliente_nombre, cliente_telefono, ubigeo,
                              direccion, lat, lng, fecha_entrega, total_pedido, cobrar, medio_pago)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'No Cobrar', 'ML Pago') RETURNING id`,
        [plataforma, tipo, vendedores[i % vendedores.length].id, cliente, tel, ubigeo, dir, lat, lng, hoy(), prod.precio * cant]
      );
      await pool.query(
        `INSERT INTO pedido_items (pedido_id, producto_id, sku, descripcion, cantidad, precio_unitario)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, prod.id, prod.sku, prod.descripcion, cant, prod.precio]
      );
    }
    console.log(`Datos de ejemplo insertados. Usuarios demo con contraseña "${PASSWORD}":`);
    for (const [nombre, email, rol] of USUARIOS) console.log(`  ${rol.padEnd(12)} ${email}  (${nombre})`);
  }
} catch (err) {
  console.error('Error en el seed:', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
