// Carga el catálogo y el historial de precios desde los JSON de scripts/excel_a_json.py.
// Uso:   node scripts/importar-catalogo.js ../datos/importar            (base del .env)
//        node --env-file=.env.produccion scripts/importar-catalogo.js ../datos/importar
// Todo va en una transacción: si algo falla, no se guarda nada.
// - Productos: se crean o actualizan por SKU (el SKU nunca cambia).
// - Clasificación: si la categoría/subcategoría antigua tiene el mismo nombre en la matriz nueva, se asigna;
//   si no, queda para "Reclasificar" (se guarda la clasificación anterior).
// - Combos: se reemplazan los componentes de los combos del archivo.
// - Precios: se agregan al historial (si ya hay precio ese día en esa plataforma, se actualiza).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const carpeta = process.argv[2];
if (!carpeta) {
  console.error('Uso: node scripts/importar-catalogo.js <carpeta con productos.json, combos.json, precios.json>');
  process.exit(1);
}
const leer = async (nombre) => JSON.parse(await readFile(path.join(carpeta, nombre), 'utf8'));
const [productos, combos, precios] = await Promise.all([leer('productos.json'), leer('combos.json'), leer('precios.json')]);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL });
const client = await pool.connect();
const normal = (t) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const MARCAS_PROPIAS = ['evox', 'vibra+', 'importado', 'greenwon'];
const informe = [];

try {
  const { rows: [{ rama }] } = await client.query("SELECT current_setting('neon.branch_id', true) AS rama");
  console.log(`Base: rama ${rama ?? '(no Neon)'}`);
  await client.query('BEGIN');

  // --- marcas ---
  const nombresMarca = [...new Set(productos.map((p) => p.marca).filter(Boolean))];
  await client.query(
    `INSERT INTO marcas (nombre, propia) SELECT n, lower(n) = ANY($2::text[]) FROM unnest($1::text[]) AS n
     ON CONFLICT (nombre) DO NOTHING`,
    [nombresMarca, MARCAS_PROPIAS]
  );
  const { rows: marcas } = await client.query('SELECT id, nombre FROM marcas');
  const marcaId = new Map(marcas.map((m) => [normal(m.nombre), m.id]));

  // --- matriz nueva: categoría + subcategoría por nombre ---
  const { rows: subs } = await client.query(
    'SELECT s.id, c.nombre AS cat, s.nombre AS sub FROM subcategorias s JOIN categorias c ON c.id = s.categoria_id'
  );
  const subId = new Map(subs.map((s) => [`${normal(s.cat)}|${normal(s.sub)}`, s.id]));

  // --- productos (upsert por SKU) ---
  const cols = ['sku', 'descripcion', 'tipo', 'subcategoria_id', 'asignacion', 'marca_id', 'modelo', 'estado_sourcing',
    'garantia_meses', 'peso_kg', 'largo_cm', 'ancho_cm', 'alto_cm', 'talla', 'estado_verificacion', 'precio_normal',
    'precio', 'link_info', 'activo', 'categoria_anterior', 'subcategoria_anterior'];
  const tipos = ['text', 'text', 'text', 'int', 'int', 'int', 'text', 'text', 'int', 'numeric', 'numeric', 'numeric', 'numeric',
    'text', 'text', 'numeric', 'numeric', 'text', 'bool', 'text', 'text'];
  let clasificados = 0;
  const filas = productos.map((p) => {
    const sid = subId.get(`${normal(p.categoria_anterior)}|${normal(p.subcategoria_anterior)}`) ?? null;
    if (sid) clasificados++;
    return {
      ...p,
      subcategoria_id: sid,
      // la asignación solo tiene sentido si el SKU sigue la regla nueva (prefijo = códigos de la matriz)
      asignacion: sid ? p.asignacion : null,
      marca_id: p.marca ? marcaId.get(normal(p.marca)) ?? null : null,
      precio: p.precio ?? 0,
    };
  });
  const { rows: upserts } = await client.query(
    `INSERT INTO productos (${cols.join(', ')})
     SELECT * FROM unnest(${cols.map((c, i) => `$${i + 1}::${tipos[i]}[]`).join(', ')})
     ON CONFLICT (sku) DO UPDATE SET ${cols.filter((c) => c !== 'sku').map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, actualizado_en = now()
     RETURNING (xmax = 0) AS nuevo`,
    cols.map((c) => filas.map((f) => f[c] ?? null))
  );
  const nuevos = upserts.filter((r) => r.nuevo).length;
  informe.push(`Productos: ${upserts.length} (${nuevos} nuevos, ${upserts.length - nuevos} actualizados); ${clasificados} ya ubicados en la matriz nueva, ${upserts.length - clasificados} para reclasificar`);

  const { rows: todos } = await client.query('SELECT id, sku FROM productos');
  const idDe = new Map(todos.map((p) => [p.sku, p.id]));

  // --- combos ---
  const porCombo = new Map();
  let lineasSinProducto = 0;
  for (const l of combos) {
    const combo = idDe.get(l.combo), comp = idDe.get(l.componente);
    if (!combo || !comp || combo === comp) { lineasSinProducto++; informe.push(`  combo ${l.combo}: componente ${l.componente} no existe en el GENERADOR (fila ${l.fila} de COMBOS)`); continue; }
    if (!porCombo.has(combo)) porCombo.set(combo, new Map());
    porCombo.get(combo).set(comp, l); // si un componente se repite, gana la última línea
  }
  const comboIds = [...porCombo.keys()];
  await client.query("UPDATE productos SET tipo = 'Combo' WHERE id = ANY($1::int[]) AND tipo <> 'Combo'", [comboIds]);
  await client.query('DELETE FROM combo_componentes WHERE combo_id = ANY($1::int[])', [comboIds]);
  const lineas = [...porCombo.entries()].flatMap(([combo, m]) => [...m.entries()].map(([comp, l]) => ({ ...l, combo, comp })));
  await client.query(
    `INSERT INTO combo_componentes (combo_id, componente_id, cantidad, precio)
     SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::numeric[])`,
    [lineas.map((l) => l.combo), lineas.map((l) => l.comp), lineas.map((l) => l.cantidad), lineas.map((l) => l.precio)]
  );
  informe.push(`Combos: ${comboIds.length} combos con ${lineas.length} componentes${lineasSinProducto ? ` (${lineasSinProducto} líneas omitidas)` : ''}`);

  // --- precios ---
  const { rows: plataformas } = await client.query('SELECT id, nombre FROM plataformas_precio');
  const plataformaId = new Map(plataformas.map((p) => [normal(p.nombre), p.id]));
  const unicos = new Map();
  const sinSku = new Set(), sinPlataforma = new Set();
  for (const p of precios) {
    const pid = idDe.get(p.sku), plat = plataformaId.get(normal(p.plataforma));
    if (!pid) { sinSku.add(p.sku); continue; }
    if (!plat) { sinPlataforma.add(p.plataforma); continue; }
    unicos.set(`${pid}|${plat}|${p.fecha}`, { pid, plat, ...p }); // mismo día y plataforma: gana la última fila
  }
  const lista = [...unicos.values()];
  for (let i = 0; i < lista.length; i += 5000) {
    const lote = lista.slice(i, i + 5000);
    await client.query(
      `INSERT INTO precios (producto_id, plataforma_id, fecha, precio, precio_normal)
       SELECT * FROM unnest($1::int[], $2::int[], $3::date[], $4::numeric[], $5::numeric[])
       ON CONFLICT (producto_id, plataforma_id, fecha) DO UPDATE SET precio = EXCLUDED.precio, precio_normal = EXCLUDED.precio_normal`,
      [lote.map((x) => x.pid), lote.map((x) => x.plat), lote.map((x) => x.fecha), lote.map((x) => x.precio), lote.map((x) => x.precio_normal)]
    );
  }
  informe.push(`Precios: ${lista.length} registros de historial (${precios.length - lista.length} omitidos o repetidos en el mismo día)`);
  if (sinSku.size) informe.push(`  SKU del historial que no están en el GENERADOR (${sinSku.size}): ${[...sinSku].slice(0, 30).join(', ')}`);
  if (sinPlataforma.size) informe.push(`  Plataformas desconocidas: ${[...sinPlataforma].join(', ')}`);

  await client.query('COMMIT');
  console.log('✔ Importación completa');
} catch (err) {
  await client.query('ROLLBACK');
  console.error('✘ Error, no se guardó nada:', err.message);
  process.exitCode = 1;
} finally {
  for (const linea of informe) console.log(linea);
  client.release();
  await pool.end();
}
