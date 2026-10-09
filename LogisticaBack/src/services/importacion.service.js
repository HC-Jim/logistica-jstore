import {
  AGENCIAS, COBRAR, ENVIAR_A, MEDIOS_PAGO, PAGO_AGENCIA, PLATAFORMAS_VENTA, TIPOS_VENTA,
} from '../config/catalogos.js';
import { query } from '../config/db.js';
import { coordenadasDeUrl } from './ubicacion.service.js';

/*
 * Carga masiva de ventas desde un CSV: una fila por producto. Las filas con el mismo
 * "grupo" (o, si no hay, el mismo # de pedido) forman un solo pedido; los datos del
 * pedido se toman de su primera fila.
 */

export const MAX_FILAS = 1000;

/** Sin tildes, minúsculas y sin espacios extra: para comparar textos escritos a mano. */
export const normalizar = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Nombres de columna aceptados → campo
const ALIAS = {
  grupo: 'grupo', pedido: 'grupo',
  plataforma: 'plataforma',
  numero_pedido: 'numero_pedido', n_pedido: 'numero_pedido', nro_pedido: 'numero_pedido', '#_pedido': 'numero_pedido',
  documento_bsale: 'documento_bsale', doc_bsale: 'documento_bsale', bsale: 'documento_bsale',
  tipo: 'tipo_pedido', tipo_pedido: 'tipo_pedido',
  fecha: 'fecha_entrega', fecha_entrega: 'fecha_entrega', entrega: 'fecha_entrega',
  cliente: 'cliente_nombre', cliente_nombre: 'cliente_nombre',
  telefono: 'cliente_telefono', contacto: 'cliente_telefono', n_contacto: 'cliente_telefono', cliente_telefono: 'cliente_telefono', celular: 'cliente_telefono',
  agencia: 'agencia', enviar_a: 'enviar_a', pago_agencia: 'pago_agencia', pago_de_agencia: 'pago_agencia',
  departamento: 'departamento', provincia: 'provincia', distrito: 'distrito',
  direccion: 'direccion', detalle_domicilio: 'detalle_domicilio', detalle: 'detalle_domicilio',
  referencia: 'referencia', cod_postal: 'cod_postal', codigo_postal: 'cod_postal',
  ubicacion: 'ubicacion', coordenadas: 'ubicacion', link: 'ubicacion', link_ubicacion: 'ubicacion',
  sku: 'sku', cantidad: 'cantidad',
  precio: 'precio', precio_unitario: 'precio',
  precio_envio: 'precio_envio', envio: 'precio_envio',
  total: 'total_pedido', total_pedido: 'total_pedido',
  cobrar: 'cobrar', medio_pago: 'medio_pago', medio_de_pago: 'medio_pago',
  nota: 'nota', vendedor: 'vendedor', vendedor_email: 'vendedor',
};

export const COLUMNAS_PLANTILLA = [
  'grupo', 'plataforma', 'numero_pedido', 'documento_bsale', 'tipo', 'fecha_entrega', 'cliente', 'telefono',
  'agencia', 'enviar_a', 'pago_agencia', 'departamento', 'provincia', 'distrito', 'direccion', 'detalle_domicilio',
  'referencia', 'cod_postal', 'ubicacion', 'sku', 'cantidad', 'precio', 'precio_envio', 'total', 'cobrar', 'medio_pago',
  'nota', 'vendedor',
];

// Abreviaturas y nombres de uso común de distritos de Lima → nombre oficial
const ALIAS_DISTRITO = {
  surco: 'santiago de surco', sjl: 'san juan de lurigancho', sjm: 'san juan de miraflores', smp: 'san martin de porres',
  vmt: 'villa maria del triunfo', ves: 'villa el salvador', cercado: 'lima', 'cercado de lima': 'lima', 'lima cercado': 'lima',
  'la victoria': 'la victoria', magdalena: 'magdalena del mar', pueblo: 'pueblo libre', chorrillos: 'chorrillos',
};

const claveColumna = (c) => ALIAS[normalizar(c).replace(/[°º.]/g, '').replace(/[\s/-]+/g, '_')];

/** Valor de la lista oficial que corresponde a lo escrito (sin importar tildes ni mayúsculas). */
function deLista(valor, lista, campo, errores) {
  if (!valor) return null;
  const encontrado = lista.find((x) => normalizar(x) === normalizar(valor));
  if (!encontrado) errores.push(`${campo}: "${valor}" no está permitido. Opciones: ${lista.join(', ')}`);
  return encontrado ?? null;
}

/** "36", "36.50", "S/ 1,234.50", "36,50" → número. */
function monto(valor, campo, errores) {
  if (valor == null || String(valor).trim() === '') return null;
  let t = String(valor).replace(/[^\d.,-]/g, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/,/g, '');
  else if (t.includes(',')) t = t.replace(',', '.');
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) { errores.push(`${campo}: "${valor}" no es un monto válido`); return null; }
  return Math.round(n * 100) / 100;
}

/** "2026-10-08", "08/10/2026", "8/10/26" → "2026-10-08". */
function fecha(valor, errores) {
  const t = String(valor ?? '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let [a, mes, d] = m ? [m[1], m[2], m[3]] : [];
  if (!m && (m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/))) [d, mes, a] = [m[1], m[2], m[3].length === 2 ? `20${m[3]}` : m[3]];
  const iso = a && `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const valida = iso && !Number.isNaN(Date.parse(iso)) && new Date(iso).toISOString().slice(0, 10) === iso;
  if (!valida) { errores.push(`fecha_entrega: "${t}" no es una fecha válida (usa AAAA-MM-DD o DD/MM/AAAA)`); return null; }
  return iso;
}

/** Coordenadas "-12.04, -77.03" o link de Google Maps con coordenadas. */
function ubicacion(valor, avisos) {
  const t = String(valor ?? '').trim();
  if (!t) return {};
  const m = t.match(/^\(?\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*\)?$/);
  let c = m ? { lat: Number(m[1]), lng: Number(m[2]) } : /^https?:\/\//i.test(t) ? coordenadasDeUrl(t) : null;
  if (c && c.lat < -60 && c.lng > -20) c = { lat: c.lng, lng: c.lat }; // pegadas al revés
  if (!c) {
    avisos.push('No se pudo leer la ubicación: se guarda el link y el punto se marca después en el pedido');
    return { link_ubicacion: t.slice(0, 1000) };
  }
  return { lat: c.lat, lng: c.lng, ...(m ? {} : { link_ubicacion: t.slice(0, 1000) }) };
}

/**
 * Revisa las filas del CSV y arma los pedidos. No guarda nada.
 * Devuelve { pedidos: [{ filas, body, avisos }], errores: [{ fila, mensaje }], advertencias: [texto] }.
 * `fila` es el número de fila en el archivo (la 1 es la cabecera).
 */
export async function analizarFilas(filasCrudas, usuario) {
  const errores = [];
  if (!Array.isArray(filasCrudas) || !filasCrudas.length) return { pedidos: [], errores: [{ fila: null, mensaje: 'El archivo no tiene filas' }] };
  if (filasCrudas.length > MAX_FILAS) {
    return { pedidos: [], errores: [{ fila: null, mensaje: `Máximo ${MAX_FILAS} filas por archivo (hay ${filasCrudas.length})` }] };
  }

  // columnas reconocidas
  const columnas = [...new Set(filasCrudas.flatMap((f) => Object.keys(f ?? {})))];
  const desconocidas = columnas.filter((c) => c.trim() && !claveColumna(c));
  const advertencias = desconocidas.length ? [`Columnas no reconocidas (se ignoran): ${desconocidas.join(', ')}`] : [];
  const filas = filasCrudas.map((f) => {
    const o = {};
    for (const [k, v] of Object.entries(f)) { const c = claveColumna(k); if (c && v != null && String(v).trim() !== '') o[c] = String(v).trim(); }
    return o;
  });
  for (const req of ['plataforma', 'tipo_pedido', 'cliente_nombre', 'sku', 'cantidad']) {
    if (!filas.some((f) => f[req])) errores.push({ fila: 1, mensaje: `Falta la columna obligatoria "${req === 'tipo_pedido' ? 'tipo' : req === 'cliente_nombre' ? 'cliente' : req}"` });
  }
  if (errores.length) return { pedidos: [], errores, advertencias };

  // catálogos de la base
  const [{ rows: productos }, { rows: ubigeos }, { rows: vendedores }] = await Promise.all([
    query('SELECT id, sku, precio, activo FROM productos'),
    query('SELECT codigo, departamento, provincia, distrito FROM ubigeos'),
    query("SELECT id, email FROM usuarios WHERE activo AND NOT pendiente AND rol IN ('vendedor', 'admin', 'planificador')"),
  ]);
  const porSku = new Map(productos.map((p) => [normalizar(p.sku), p]));
  const porUbigeo = new Map(ubigeos.map((u) => [`${normalizar(u.departamento)}|${normalizar(u.provincia)}|${normalizar(u.distrito)}`, u.codigo]));
  /** Distrito por nombre exacto, abreviatura o, si es único, por coincidencia parcial ("Surco" → "Santiago de Surco"). */
  const buscarDistrito = (dep, prov, dist) => {
    const pre = `${normalizar(dep)}|${normalizar(prov)}|`;
    const d = normalizar(dist);
    const exacto = porUbigeo.get(pre + (ALIAS_DISTRITO[d] ?? d));
    if (exacto) return { codigo: exacto };
    const parecidos = [...porUbigeo.entries()].filter(([k]) => k.startsWith(pre) && k.slice(pre.length).includes(d));
    return parecidos.length === 1 ? { codigo: parecidos[0][1] } : { opciones: parecidos.map(([k]) => k.slice(pre.length)) };
  };
  const porEmail = new Map(vendedores.map((v) => [normalizar(v.email), v.id]));

  // agrupar líneas en pedidos
  const grupos = new Map();
  filas.forEach((f, i) => {
    const clave = f.grupo || f.numero_pedido || `fila-${i}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push({ f, n: i + 2 });
  });

  const pedidos = [];
  for (const lineas of grupos.values()) {
    const { f: c, n: filaInicial } = lineas[0];
    const err = [];
    const avisos = [];

    // ubigeo por nombres; si solo se escribe el distrito se busca en Lima y Callao
    let ubigeo = null;
    if (c.distrito) {
      const dep = c.departamento ?? (c.provincia && normalizar(c.provincia) === 'callao' ? 'Callao' : 'Lima');
      const prov = c.provincia ?? (normalizar(dep) === 'callao' ? 'Callao' : 'Lima');
      const r = buscarDistrito(dep, prov, c.distrito);
      ubigeo = r.codigo ?? null;
      if (!ubigeo) {
        err.push(`Distrito "${c.distrito}" no encontrado en ${prov} (${dep})` +
          (r.opciones?.length ? `. ¿Quisiste decir: ${r.opciones.slice(0, 4).join(', ')}?` : '. Revisa departamento, provincia y distrito'));
      }
    }

    // vendedor: el vendedor siempre registra a su nombre; logística puede indicarlo por correo
    let vendedorId = usuario.id;
    if (c.vendedor && usuario.rol !== 'vendedor') {
      vendedorId = porEmail.get(normalizar(c.vendedor));
      if (!vendedorId) err.push(`Vendedor "${c.vendedor}" no existe o está inactivo`);
    }

    const items = [];
    for (const { f, n } of lineas) {
      const p = f.sku && porSku.get(normalizar(f.sku));
      if (!f.sku) err.push(`Fila ${n}: falta el SKU`);
      else if (!p) err.push(`Fila ${n}: SKU "${f.sku}" no está en el catálogo de productos`);
      else if (!p.activo) err.push(`Fila ${n}: el producto ${f.sku} está inactivo`);
      const cantidad = Number(f.cantidad);
      if (!Number.isInteger(cantidad) || cantidad <= 0 || cantidad > 9999) err.push(`Fila ${n}: cantidad "${f.cantidad ?? ''}" inválida (entero de 1 a 9999)`);
      const precio = monto(f.precio, `Fila ${n} precio`, err);
      if (p && Number.isInteger(cantidad)) items.push({ producto_id: p.id, cantidad, ...(precio != null ? { precio_unitario: precio } : {}) });
    }

    const body = {
      categoria: 'venta',
      plataforma: deLista(c.plataforma, PLATAFORMAS_VENTA, 'plataforma', err),
      numero_pedido: c.numero_pedido ?? null,
      documento_bsale: c.documento_bsale ?? null,
      tipo_pedido: deLista(c.tipo_pedido, TIPOS_VENTA, 'tipo', err),
      fecha_entrega: c.fecha_entrega ? fecha(c.fecha_entrega, err) : undefined,
      cliente_nombre: c.cliente_nombre ?? null,
      cliente_telefono: c.cliente_telefono ?? null,
      agencia: deLista(c.agencia, AGENCIAS, 'agencia', err),
      enviar_a: deLista(c.enviar_a, ENVIAR_A, 'enviar_a', err),
      pago_agencia: deLista(c.pago_agencia, PAGO_AGENCIA, 'pago_agencia', err),
      ubigeo,
      direccion: c.direccion ?? null,
      detalle_domicilio: c.detalle_domicilio ?? null,
      referencia: c.referencia ?? null,
      cod_postal: c.cod_postal ?? null,
      ...ubicacion(c.ubicacion, avisos),
      precio_envio: monto(c.precio_envio, 'precio_envio', err),
      total_pedido: monto(c.total_pedido, 'total', err),
      cobrar: c.cobrar ? deLista(c.cobrar, COBRAR, 'cobrar', err) : 'No Cobrar',
      medio_pago: deLista(c.medio_pago, MEDIOS_PAGO, 'medio_pago', err),
      nota: c.nota ?? null,
      vendedor_id: vendedorId,
      items,
    };
    if (!c.cliente_nombre) err.push('Falta el cliente');
    if (!c.fecha_entrega) err.push('Falta la fecha de entrega');
    const digitos = (c.cliente_telefono ?? '').replace(/\D/g, '');
    if (c.cliente_telefono && (!/^\+?[\d\s-]+$/.test(c.cliente_telefono) || digitos.length < 6 || digitos.length > 15)) {
      err.push(`Teléfono "${c.cliente_telefono}" inválido (solo números, de 6 a 15 dígitos)`);
    }
    if (body.tipo_pedido && /agencia/i.test(body.tipo_pedido) && !body.agencia) err.push(`El tipo "${body.tipo_pedido}" requiere la columna agencia`);
    if (!body.agencia && (body.enviar_a || body.pago_agencia)) err.push('"enviar_a" y "pago_agencia" solo aplican cuando hay agencia');
    if (body.lat == null && !body.link_ubicacion) avisos.push('Sin ubicación: no se podrá rutear hasta marcar el punto');
    for (const e of err) errores.push({ fila: filaInicial, mensaje: e });
    // los campos vacíos no se envían: así se aplican los valores por defecto (p. ej. envío = 0)
    for (const k of Object.keys(body)) if (body[k] == null) delete body[k];
    pedidos.push({ fila: filaInicial, filas: lineas.map((l) => l.n), body, avisos, cliente: c.cliente_nombre, lineas: items.length });
  }
  return { pedidos, errores, advertencias };
}
