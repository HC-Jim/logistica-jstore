import { query, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http.js';

/*
 * Integración con Bsale (https://docs.bsale.dev). El sistema es la fuente de los productos y precios; Bsale recibe:
 *  - Lectura en pasos cortos (cada uno cabe en una llamada a la API de Vercel): listas de precio, variantes
 *    (el SKU de Bsale es el `code` de la variante), stock por sucursal y el detalle de cada lista.
 *    Se guarda una copia en bsale_variantes / bsale_precios para comparar sin consultar Bsale cada vez.
 *  - Envío de precios: cada lista de Bsale toma su precio de una "fuente" del sistema (una plataforma,
 *    el precio normal o el mínimo de las plataformas sin contar Web). Bsale recibe el valor neto (sin IGV).
 *  - Creación de SKU que no existen en Bsale (producto + variante) y actualización de nombres.
 * Cada envío queda en bsale_envios.
 */

const BASE = env.bsale.url;
const IGV = 1.18;
const POR_PAGINA = 50; // máximo que acepta Bsale

export const bsaleActivo = () => Boolean(env.bsale.token);

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
const codigo = (sku) => String(sku ?? '').trim().toUpperCase();

async function llamar(metodo, ruta, { params, cuerpo } = {}) {
  if (!bsaleActivo()) throw new HttpError(503, 'Bsale no está configurado: falta BSALE_ACCESS_TOKEN en el servidor');
  const url = new URL(BASE + ruta);
  for (const [k, v] of Object.entries(params ?? {})) if (v != null) url.searchParams.set(k, v);
  for (let intento = 1; ; intento++) {
    let r;
    try {
      r = await fetch(url, {
        method: metodo,
        headers: { access_token: env.bsale.token, Accept: 'application/json', ...(cuerpo && { 'Content-Type': 'application/json' }) },
        body: cuerpo && JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      if (intento < 3) { await esperar(700 * intento); continue; }
      throw new HttpError(502, `No se pudo conectar con Bsale: ${err.message}`);
    }
    // demasiadas consultas o falla temporal de Bsale: se reintenta
    if ((r.status === 429 || r.status >= 500) && intento < 5) { await esperar(800 * intento); continue; }
    const texto = await r.text();
    if (!r.ok) {
      if (r.status === 401) throw new HttpError(502, 'Bsale rechazó el token de acceso (BSALE_ACCESS_TOKEN)');
      throw new HttpError(502, `Bsale respondió ${r.status}: ${texto.slice(0, 200)}`);
    }
    return texto ? JSON.parse(texto) : null;
  }
}

async function todos(ruta, params = {}) {
  const items = [];
  for (let offset = 0; ; offset += POR_PAGINA) {
    const d = await llamar('GET', ruta, { params: { ...params, limit: POR_PAGINA, offset } });
    items.push(...(d?.items ?? []));
    if (!d?.next || !d.items?.length) break;
  }
  return items;
}

const idDe = (ref) => (ref?.id != null ? Number(ref.id) : null);

/** Fuente sugerida para una lista nueva según su nombre. */
async function fuenteSugerida(nombre) {
  if (/yuju/i.test(nombre)) return { fuente: 'normal', plataforma_id: null };
  if (/plataforma/i.test(nombre)) return { fuente: 'minimo_plataformas', plataforma_id: null };
  if (/web/i.test(nombre)) {
    const { rows: [web] } = await query("SELECT id FROM plataformas_precio WHERE nombre = 'Web'");
    if (web) return { fuente: 'plataforma', plataforma_id: web.id };
  }
  return { fuente: 'ninguna', plataforma_id: null };
}

// ---------------- lectura ----------------

/** Pasos de la lectura completa, en orden. */
export async function pasosLectura() {
  const { rows } = await query('SELECT id, nombre FROM bsale_listas WHERE activa ORDER BY id');
  return ['listas', 'productos', 'stock', ...rows.map((l) => `lista:${l.id}`)];
}

export async function leerPaso(paso) {
  if (paso === 'listas') return leerListas();
  if (paso === 'productos') return leerVariantes();
  if (paso === 'stock') return leerStock();
  const m = /^lista:(\d+)$/.exec(paso);
  if (m) return leerDetalles(Number(m[1]));
  throw new HttpError(400, 'Paso de lectura inválido');
}

async function leerListas() {
  const listas = await todos('/price_lists.json');
  for (const l of listas) {
    const s = await fuenteSugerida(l.name);
    // la fuente solo se propone la primera vez: después la define el usuario
    await query(
      `INSERT INTO bsale_listas (id, nombre, fuente, plataforma_id, activa) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, activa = EXCLUDED.activa, actualizado_en = now()`,
      [l.id, l.name, s.fuente, s.plataforma_id, l.state === 0]
    );
  }
  await query('UPDATE bsale_listas SET activa = false WHERE NOT (id = ANY($1::int[]))', [listas.map((l) => l.id)]);
  return { listas: listas.length, pasos: await pasosLectura() };
}

async function leerVariantes() {
  const [variantes, productos] = await Promise.all([
    todos('/variants.json', { fields: '[id,code,description,state,product]' }),
    todos('/products.json', { fields: '[id,name,state]' }),
  ]);
  const nombres = new Map(productos.map((p) => [p.id, p.name]));
  const filas = variantes.filter((v) => codigo(v.code));
  await withTransaction(async (client) => {
    await client.query('DELETE FROM bsale_variantes WHERE NOT (id = ANY($1::int[]))', [filas.map((v) => v.id)]);
    await client.query(
      `INSERT INTO bsale_variantes (id, producto_bsale_id, codigo, nombre, activa, leido_en)
       SELECT *, now() FROM unnest($1::int[], $2::int[], $3::text[], $4::text[], $5::boolean[])
       ON CONFLICT (id) DO UPDATE SET producto_bsale_id = EXCLUDED.producto_bsale_id, codigo = EXCLUDED.codigo,
         nombre = EXCLUDED.nombre, activa = EXCLUDED.activa, leido_en = now()`,
      [filas.map((v) => v.id), filas.map((v) => idDe(v.product)), filas.map((v) => codigo(v.code)),
        // el nombre es el del producto; la descripción de la variante es un detalle aparte (p. ej. la categoría)
        filas.map((v) => nombres.get(idDe(v.product)) || v.description || null),
        filas.map((v) => v.state === 0)]
    );
  });
  return { variantes: filas.length };
}

async function leerStock() {
  const [stocks, oficinas] = await Promise.all([todos('/stocks.json'), todos('/offices.json')]);
  const nombreOficina = new Map(oficinas.map((o) => [o.id, o.name]));
  const porVariante = new Map();
  for (const s of stocks) {
    const v = idDe(s.variant);
    if (!porVariante.has(v)) porVariante.set(v, { total: 0, sucursales: {} });
    const x = porVariante.get(v);
    const cant = Number(s.quantityAvailable ?? 0);
    x.total += cant;
    if (cant) {
      const of = nombreOficina.get(idDe(s.office)) ?? `Sucursal ${idDe(s.office)}`;
      x.sucursales[of] = (x.sucursales[of] ?? 0) + cant;
    }
  }
  const ids = [...porVariante.keys()];
  await query('UPDATE bsale_variantes SET stock = 0, stock_sucursales = NULL WHERE NOT (id = ANY($1::int[]))', [ids]);
  await query(
    `UPDATE bsale_variantes b SET stock = x.total, stock_sucursales = x.suc
     FROM unnest($1::int[], $2::numeric[], $3::jsonb[]) AS x(id, total, suc) WHERE b.id = x.id`,
    [ids, ids.map((i) => porVariante.get(i).total), ids.map((i) => JSON.stringify(porVariante.get(i).sucursales))]
  );
  return { conStock: [...porVariante.values()].filter((x) => x.total > 0).length };
}

async function guardarDetalles(listaId, detalles) {
  if (!detalles.length) return;
  await query(
    `INSERT INTO bsale_precios (lista_id, variante_id, detalle_id, valor_neto, valor_con_igv, leido_en)
     SELECT $1, *, now() FROM unnest($2::int[], $3::int[], $4::numeric[], $5::numeric[])
     ON CONFLICT (lista_id, variante_id) DO UPDATE SET detalle_id = EXCLUDED.detalle_id, valor_neto = EXCLUDED.valor_neto,
       valor_con_igv = EXCLUDED.valor_con_igv, leido_en = now()`,
    [listaId, detalles.map((d) => idDe(d.variant)), detalles.map((d) => d.id), detalles.map((d) => d.variantValue ?? 0),
      detalles.map((d) => d.variantValueWithTaxes ?? 0)]
  );
}

async function leerDetalles(listaId) {
  const detalles = await todos(`/price_lists/${listaId}/details.json`);
  await query('DELETE FROM bsale_precios WHERE lista_id = $1 AND NOT (detalle_id = ANY($2::int[]))', [listaId, detalles.map((d) => d.id)]);
  await guardarDetalles(listaId, detalles);
  return { lista: listaId, precios: detalles.length };
}

/** Busca en Bsale la variante de un SKU (si no está en la copia local) y la guarda. */
async function asegurarVariante(sku) {
  const { rows: [v] } = await query('SELECT * FROM bsale_variantes WHERE codigo = $1 AND activa', [codigo(sku)]);
  if (v) return v;
  const d = await llamar('GET', '/variants.json', { params: { code: String(sku).trim(), fields: '[id,code,description,state,product]' } });
  const x = (d?.items ?? []).find((i) => codigo(i.code) === codigo(sku) && i.state === 0);
  if (!x) return null;
  const { rows: [nuevo] } = await query(
    `INSERT INTO bsale_variantes (id, producto_bsale_id, codigo, nombre, activa) VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (id) DO UPDATE SET codigo = EXCLUDED.codigo, activa = true, leido_en = now() RETURNING *`,
    [x.id, idDe(x.product), codigo(x.code), x.description || null]
  );
  return nuevo;
}

// ---------------- precios ----------------

/**
 * Precio que debe tener cada producto en cada lista de Bsale (con IGV) y el que tiene hoy según la copia local.
 * Solo filas con diferencia (o sin precio en Bsale). `productoIds` limita a esos productos.
 */
export async function preciosDistintos({ productoIds = null, limite = 5000 } = {}) {
  const { rows } = await query(
    `WITH vig AS (
       SELECT DISTINCT ON (pr.producto_id, pr.plataforma_id) pr.producto_id, pr.plataforma_id, pr.precio, pl.nombre
       FROM precios pr JOIN plataformas_precio pl ON pl.id = pr.plataforma_id
       WHERE pl.activo AND ($1::int[] IS NULL OR pr.producto_id = ANY($1))
       ORDER BY pr.producto_id, pr.plataforma_id, pr.fecha DESC
     ),
     objetivo AS (
       SELECT p.id AS producto_id, p.sku, p.descripcion, l.id AS lista_id, l.nombre AS lista,
              CASE l.fuente
                WHEN 'normal' THEN p.precio_normal
                WHEN 'plataforma' THEN (SELECT v.precio FROM vig v WHERE v.producto_id = p.id AND v.plataforma_id = l.plataforma_id)
                WHEN 'minimo_plataformas' THEN (SELECT MIN(v.precio) FROM vig v WHERE v.producto_id = p.id AND v.nombre <> 'Web')
              END AS precio
       FROM productos p CROSS JOIN bsale_listas l
       WHERE p.activo AND l.activa AND l.fuente <> 'ninguna' AND ($1::int[] IS NULL OR p.id = ANY($1))
     )
     SELECT o.producto_id, o.sku, o.descripcion, o.lista_id, o.lista, o.precio::float AS precio,
            bv.id AS variante_id, bv.nombre AS nombre_bsale, bp.detalle_id, bp.valor_con_igv::float AS precio_bsale, bp.valor_neto::float AS neto_bsale
     FROM objetivo o
     JOIN bsale_variantes bv ON bv.codigo = upper(btrim(o.sku)) AND bv.activa
     LEFT JOIN bsale_precios bp ON bp.lista_id = o.lista_id AND bp.variante_id = bv.id
     WHERE o.precio > 0 AND (bp.valor_con_igv IS NULL OR abs(bp.valor_con_igv - o.precio) >= 0.01)
     ORDER BY o.sku, o.lista_id
     LIMIT $2`,
    [productoIds, limite]
  );
  return rows.filter((r) => !enConflicto(r.descripcion, r.nombre_bsale));
}

async function registrarEnvio({ tipo, productoId, sku, detalle, ok, error, usuario }) {
  await query(
    'INSERT INTO bsale_envios (tipo, producto_id, sku, detalle, ok, error, creado_por) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [tipo, productoId, sku, detalle ? JSON.stringify(detalle) : null, ok, error ?? null, usuario?.id ?? null]
  );
}

/** El detalle de una lista para una variante (si la copia local no lo tiene, se consulta en Bsale). */
async function detalleDe(listaId, varianteId) {
  const d = await llamar('GET', `/price_lists/${listaId}/details.json`, { params: { variantid: varianteId } });
  await guardarDetalles(listaId, d?.items ?? []);
  return d?.items?.[0] ?? null;
}

/**
 * Envía a Bsale los precios distintos. Procesa como máximo `maxCambios` cambios por llamada
 * (la web repite hasta que no quede nada pendiente). Devuelve { enviados, errores, pendientes }.
 */
export async function enviarPrecios({ productoIds = null, usuario, maxCambios = 25 } = {}) {
  const cambios = await preciosDistintos({ productoIds, limite: maxCambios + 1 });
  const lote = cambios.slice(0, maxCambios);
  const porProducto = new Map();
  let enviados = 0;
  let errores = 0;
  for (const c of lote) {
    const r = porProducto.get(c.producto_id) ?? { sku: c.sku, cambios: [], errores: [] };
    porProducto.set(c.producto_id, r);
    try {
      let detalleId = c.detalle_id;
      let relacion = c.neto_bsale > 0 && c.precio_bsale > 0 ? c.precio_bsale / c.neto_bsale : IGV;
      if (!detalleId) {
        const d = await detalleDe(c.lista_id, c.variante_id);
        if (!d) throw new Error(`la lista ${c.lista} no tiene este producto`);
        detalleId = d.id;
        if (d.variantValue > 0 && d.variantValueWithTaxes > 0) relacion = d.variantValueWithTaxes / d.variantValue;
      }
      // con impuestos exactos (18 %) el precio con IGV que calcula Bsale queda igual al del sistema
      const neto = Math.round((c.precio / relacion) * 1e6) / 1e6;
      const resp = await llamar('PUT', `/price_lists/${c.lista_id}/details/${detalleId}.json`, { cuerpo: { id: detalleId, variantValue: neto } });
      await guardarDetalles(c.lista_id, [{ ...resp, id: detalleId, variant: { id: c.variante_id } }]);
      r.cambios.push({ lista: c.lista, antes: c.precio_bsale, ahora: Number(resp?.variantValueWithTaxes ?? c.precio) });
      enviados++;
    } catch (err) {
      r.errores.push(`${c.lista}: ${err.message}`);
      errores++;
    }
  }
  for (const [productoId, r] of porProducto) {
    await registrarEnvio({
      tipo: 'precio', productoId, sku: r.sku, detalle: r.cambios, ok: !r.errores.length, error: r.errores.join(' · ') || null, usuario,
    });
  }
  return { enviados, errores, pendientes: Math.max(cambios.length - lote.length, 0) + errores };
}

/**
 * Después de registrar un precio o crear/cambiar un SKU: envía sus precios a Bsale si el SKU existe allá.
 * Nunca hace fallar la operación principal; devuelve un resumen para mostrarlo en pantalla.
 */
export async function sincronizarProducto(productoId, usuario) {
  if (!bsaleActivo()) return { activo: false };
  try {
    const { rows: [p] } = await query('SELECT id, sku FROM productos WHERE id = $1', [productoId]);
    if (!p) return { activo: true, ok: false, mensaje: 'Producto no encontrado' };
    const v = await asegurarVariante(p.sku);
    if (!v) return { activo: true, ok: false, existe: false, mensaje: 'El SKU no existe en Bsale' };
    const r = await enviarPrecios({ productoIds: [productoId], usuario, maxCambios: 20 });
    return { activo: true, ok: r.errores === 0, existe: true, ...r };
  } catch (err) {
    return { activo: true, ok: false, mensaje: err.message };
  }
}

/** Listas activas de Bsale con su fuente de precio (para mostrarlas junto a las plataformas). */
export async function listasActivas() {
  const { rows } = await query(
    `SELECT l.id, l.nombre, l.fuente, pl.nombre AS plataforma
     FROM bsale_listas l LEFT JOIN plataformas_precio pl ON pl.id = l.plataforma_id WHERE l.activa ORDER BY l.id`
  );
  return rows;
}

/**
 * Precios de un producto en cada lista de Bsale y el que le correspondería según el sistema.
 * Con `actualizar` se consultan en Bsale en ese momento (si no, se usa la última lectura).
 */
export async function preciosBsaleDeProducto(productoId, { actualizar = false } = {}) {
  const { rows: [p] } = await query('SELECT id, sku, descripcion FROM productos WHERE id = $1', [productoId]);
  if (!p) throw new HttpError(404, 'Producto no encontrado');
  const listas = await listasActivas();
  const consultar = actualizar && bsaleActivo();
  const variante = consultar
    ? await asegurarVariante(p.sku)
    : (await query('SELECT * FROM bsale_variantes WHERE codigo = $1 AND activa', [codigo(p.sku)])).rows[0];
  if (variante && consultar) for (const l of listas) await detalleDe(l.id, variante.id);
  const { rows: bp } = variante
    ? await query('SELECT lista_id, valor_con_igv::float AS precio, leido_en FROM bsale_precios WHERE variante_id = $1', [variante.id])
    : { rows: [] };
  const pendientes = variante ? await preciosDistintos({ productoIds: [productoId] }) : [];
  return {
    activo: bsaleActivo(),
    existe: Boolean(variante),
    nombre_bsale: variante?.nombre ?? null,
    stock: variante?.stock != null ? Number(variante.stock) : null,
    stock_sucursales: variante?.stock_sucursales ?? null,
    conflicto: Boolean(variante && enConflicto(p.descripcion, variante.nombre)),
    listas: listas.map((l) => {
      const actual = bp.find((x) => x.lista_id === l.id);
      return {
        ...l,
        precio: actual?.precio ?? null,
        leido_en: actual?.leido_en ?? null,
        // precio del sistema que todavía no está en Bsale (null = coincide o no hay fuente)
        pendiente: pendientes.find((x) => x.lista_id === l.id)?.precio ?? null,
      };
    }),
  };
}

// ---------------- productos ----------------

const normal = (t) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Tipo de producto de Bsale según la categoría del SKU (nueva o anterior); si no coincide, "General" o "Sin Tipo". */
async function tiposBsale() {
  const tipos = await todos('/product_types.json');
  const porNombre = new Map(tipos.filter((t) => t.state === 0 && t.name).map((t) => [normal(t.name), t.id]));
  const defecto = porNombre.get('general') ?? porNombre.get('sin tipo') ?? tipos[0]?.id;
  return (...nombres) => nombres.map((n) => porNombre.get(normal(n))).find(Boolean) ?? defecto;
}

/** Crea en Bsale (producto + variante con el SKU) los productos indicados que aún no existen allá, y les envía los precios. */
export async function crearProductos(productoIds, usuario) {
  const { rows } = await query(
    `SELECT p.id, p.sku, p.descripcion, p.tipo, c.nombre AS categoria, p.categoria_anterior
     FROM productos p LEFT JOIN subcategorias s ON s.id = p.subcategoria_id LEFT JOIN categorias c ON c.id = s.categoria_id
     WHERE p.id = ANY($1::int[]) ORDER BY p.sku`,
    [productoIds]
  );
  const tipoDe = await tiposBsale();
  const resultado = [];
  for (const p of rows) {
    try {
      if (p.tipo === 'Combo') throw new Error('los combos se crean en Bsale como pack (con sus componentes) desde Bsale');
      if (await asegurarVariante(p.sku)) { resultado.push({ sku: p.sku, ok: true, mensaje: 'ya existía en Bsale' }); continue; }
      const servicio = p.tipo === 'Servicio';
      const prod = await llamar('POST', '/products.json', {
        cuerpo: { name: p.descripcion, classification: servicio ? 1 : 0, stockControl: servicio ? 0 : 1, allowDecimal: 0, productTypeId: tipoDe(p.categoria, p.categoria_anterior) },
      });
      const v = await llamar('POST', '/variants.json', {
        cuerpo: { productId: prod.id, description: '', code: p.sku, unit: 'NIU', tributaryCode: '01010101', unlimitedStock: servicio ? 1 : 0, allowNegativeStock: 0 },
      });
      await query(
        `INSERT INTO bsale_variantes (id, producto_bsale_id, codigo, nombre, activa, stock) VALUES ($1, $2, $3, $4, true, 0)
         ON CONFLICT (id) DO NOTHING`,
        [v.id, prod.id, codigo(p.sku), p.descripcion]
      );
      const precios = await enviarPrecios({ productoIds: [p.id], usuario, maxCambios: 20 });
      await registrarEnvio({ tipo: 'crear', productoId: p.id, sku: p.sku, detalle: { producto_bsale: prod.id, variante: v.id, precios: precios.enviados }, ok: true, usuario });
      resultado.push({ sku: p.sku, ok: true, mensaje: `creado con ${precios.enviados} precio(s)` });
    } catch (err) {
      await registrarEnvio({ tipo: 'crear', productoId: p.id, sku: p.sku, ok: false, error: err.message, usuario });
      resultado.push({ sku: p.sku, ok: false, mensaje: err.message });
    }
  }
  return resultado;
}

/** Bsale guarda los nombres sin comillas (17" → 17): no cuentan como diferencia. */
export const SQL_NOMBRE_COMPARABLE = (col) => `lower(btrim(regexp_replace(${col}, '["\\s]+', ' ', 'g')))`;

const palabras = (t) => new Set(normal(t).split(/[^a-z0-9]+/).filter((w) => w.length > 2));
/**
 * El mismo SKU es otro producto en Bsale (p. ej. "Asiento Rockbros" vs "Ecran de Piso"): casi no comparten palabras.
 * Esos SKU no reciben precios ni nombres automáticamente; se revisan a mano.
 */
export function enConflicto(nombreSistema, nombreBsale) {
  const a = palabras(nombreSistema);
  const b = palabras(nombreBsale);
  if (!a.size || !b.size) return false;
  const comunes = [...a].filter((w) => b.has(w)).length;
  return comunes / Math.min(a.size, b.size) < 0.5;
}

/** Actualiza en Bsale el nombre de los productos indicados con el del sistema. */
export async function actualizarNombres(productoIds, usuario) {
  const { rows } = await query(
    `SELECT p.id, p.sku, p.descripcion, bv.producto_bsale_id, bv.nombre AS nombre_bsale
     FROM productos p JOIN bsale_variantes bv ON bv.codigo = upper(btrim(p.sku)) AND bv.activa
     WHERE p.id = ANY($1::int[])`,
    [productoIds]
  );
  const resultado = [];
  for (const p of rows) {
    try {
      if (enConflicto(p.descripcion, p.nombre_bsale)) throw new Error(`en Bsale este SKU es otro producto ("${p.nombre_bsale}"); revísalo allá`);
      await llamar('PUT', `/products/${p.producto_bsale_id}.json`, { cuerpo: { id: p.producto_bsale_id, name: p.descripcion } });
      await query('UPDATE bsale_variantes SET nombre = $2 WHERE producto_bsale_id = $1', [p.producto_bsale_id, p.descripcion]);
      await registrarEnvio({ tipo: 'nombre', productoId: p.id, sku: p.sku, detalle: { antes: p.nombre_bsale, ahora: p.descripcion }, ok: true, usuario });
      resultado.push({ sku: p.sku, ok: true });
    } catch (err) {
      await registrarEnvio({ tipo: 'nombre', productoId: p.id, sku: p.sku, ok: false, error: err.message, usuario });
      resultado.push({ sku: p.sku, ok: false, mensaje: err.message });
    }
  }
  return resultado;
}
