'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { rutasApi } from '../api/services';
import EstadoBadge from '../components/EstadoBadge';
import { useAuth } from '../context/AuthContext';
import { CATEGORIAS, ESTADOS, ESTADOS_RUTA, fechaCorta, fechaHora, soles, VEHICULOS } from '../utils/format';

const cobra = (p) => p.cobrar && p.cobrar !== 'No Cobrar';
const RECOJOS = ['Recojo S.T', 'Recojo de suministros'];
/** "↩️ RECOGER" / "🏢 ENCARGO" para que el conductor vea de un vistazo qué hacer. */
const marca = (p) => (RECOJOS.includes(p.tipo_pedido) ? '⬆ RECOGER' : p.categoria === 'encargo' ? '🏢 ENCARGO' : p.categoria === 'inversa' ? '↩️ LOG. INVERSA' : '');
const valorProductos = (p) => (p.items ?? []).reduce((s, i) => s + Number(i.subtotal), 0);
const productosTexto = (p) => (p.items ?? []).map((i) => `${i.descripcion} / ${i.cantidad} und`).join('\n');
const mapa = (p) => (p.lat != null ? `https://maps.google.com/?q=${p.lat},${p.lng}` : '');
const direccionCompleta = (p) => [p.direccion, p.detalle_domicilio].filter(Boolean).join(', ');
/** Estado que corresponde mostrar en esta ruta (las paradas atendidas son historial). */
const estadoEnRuta = (p) => (p.estado === 'completada' ? 'entregado' : p.estado === 'incidencia' ? 'incidencia' : p.estado_pedido);

/** Mensaje para WhatsApp con formato (negritas *…*) y links para navegar. */
function textoWhatsApp(ruta) {
  const v = VEHICULOS[ruta.vehiculo_tipo];
  const pedidos = ruta.paradas.filter((p) => p.pedido_id);
  const aCobrar = pedidos.filter(cobra).reduce((s, p) => s + Number(p.total_pedido), 0);
  const lineas = [
    `*RUTA ${ruta.numero} · ${fechaCorta(ruta.fecha)}*`,
    [v && `${v.icono} ${ruta.vehiculo_nombre}`, ruta.repartidor_nombre && `👤 ${ruta.repartidor_nombre}`,
      ruta.asistente_nombre && `🧑‍🔧 ${ruta.asistente_nombre}`].filter(Boolean).join(' · '),
    `Pedidos: ${pedidos.length} · A cobrar: ${soles(aCobrar)}`,
    '',
  ];
  ruta.paradas.forEach((p, i) => {
    if (!p.pedido_id) {
      lineas.push(`*${i + 1}) ⚑ ${p.descripcion}*`);
      if (p.direccion) lineas.push(`📍 ${p.direccion}`);
      if (mapa(p)) lineas.push(`🧭 ${mapa(p)}`);
      lineas.push('');
      return;
    }
    lineas.push(`*${i + 1}) #${p.pedido_id} · ${p.tipo_pedido}*${marca(p) ? ` ${marca(p)}` : ''}${p.estado !== 'pendiente' ? ` (${ESTADOS[estadoEnRuta(p)]?.label})` : ''}`);
    if (p.motivo) lineas.push(`❓ ${p.motivo}${p.pedido_relacionado ? ` · pedido original ${p.pedido_relacionado}` : ''}`);
    lineas.push(`👤 ${p.cliente_nombre}${p.cliente_telefono ? ` · 📞 ${p.cliente_telefono}` : ''}`);
    lineas.push(`📍 ${[direccionCompleta(p), p.distrito].filter(Boolean).join(', ')}`);
    if (p.referencia) lineas.push(`↪ Ref: ${p.referencia}`);
    if (p.agencia) lineas.push(`🏢 Agencia: ${p.agencia}${p.enviar_a ? ` (${p.enviar_a})` : ''}`);
    if (mapa(p)) lineas.push(`🧭 ${mapa(p)}`);
    for (const it of p.items ?? []) lineas.push(`📦 ${it.descripcion} / ${it.cantidad} und`);
    lineas.push(`💵 ${p.cobrar.toUpperCase()}${p.medio_pago ? ` · ${p.medio_pago}` : ''} · Total ${soles(p.total_pedido)}`);
    if (p.nota_pedido) lineas.push(`📝 ${p.nota_pedido}`);
    if (p.documento_bsale) lineas.push(`🧾 ${p.documento_bsale}`);
    lineas.push('');
  });
  return lineas.join('\n').trim();
}

/** CSV con ";" (Excel en español) y BOM para que se vean las tildes. */
function descargarExcel(ruta) {
  const cab = ['Orden', 'Código', 'Tipo de Pedido', 'Cliente', 'N° Contacto', 'Dirección', 'Referencia', 'Distrito', 'Departamento',
    'Productos / Cantidad o ACCIÓN', 'Valor', 'Precio de Envío', 'Total de Pedido', 'Cobrar', 'Medio de Pago', 'Vendedor', 'Nota',
    'Estado', 'N° Documento Bsale', 'Despachado', 'Ubicación'];
  const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const filas = ruta.paradas.map((p, i) => (p.pedido_id ? [
    i + 1, p.pedido_id, p.tipo_pedido, p.cliente_nombre, p.cliente_telefono, direccionCompleta(p), p.referencia, p.distrito,
    p.departamento, productosTexto(p).replace(/\n/g, ' | '), valorProductos(p).toFixed(2), Number(p.precio_envio).toFixed(2),
    Number(p.total_pedido).toFixed(2), p.cobrar, p.medio_pago, p.vendedor_nombre, p.nota_pedido, ESTADOS[estadoEnRuta(p)]?.label,
    p.documento_bsale, p.despachado_en ? 'Sí' : 'No', mapa(p),
  ] : [i + 1, '', 'ACCIÓN', '', '', p.direccion, '', '', '', p.descripcion, '', '', '', '', '', '', '', p.estado, '', '', mapa(p)]));
  const csv = '﻿' + [cab, ...filas].map((f) => f.map(celda).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `ruta-${ruta.numero}-${ruta.fecha}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function HojaRuta() {
  const { id } = useParams();
  const { usuario } = useAuth();
  const [ruta, setRuta] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(() => rutasApi.obtener(id).then(setRuta).catch((e) => setError(mensajeError(e))), [id]);
  useEffect(() => { cargar(); }, [cargar]);

  async function despachar(paradaIds, despachado) {
    setGuardando(true);
    setError('');
    try {
      setRuta(await rutasApi.despachar(id, paradaIds, despachado));
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setGuardando(false);
    }
  }

  async function copiar() {
    await navigator.clipboard.writeText(textoWhatsApp(ruta));
    setAviso('Texto copiado: pégalo en el chat de WhatsApp del conductor.');
  }

  if (error && !ruta) return <p className="error">{error}</p>;
  if (!ruta) return <p>Cargando…</p>;

  const pedidos = ruta.paradas.filter((p) => p.pedido_id);
  const porDespachar = pedidos.filter((p) => p.estado === 'pendiente' && !p.despachado_en);
  const aCobrar = pedidos.filter(cobra).reduce((s, p) => s + Number(p.total_pedido), 0);
  const v = VEHICULOS[ruta.vehiculo_tipo];
  const editable = ruta.estado !== 'finalizada';
  const puedePlanificar = ['admin', 'planificador'].includes(usuario.rol);

  return (
    <div className="hoja-ruta">
      <div className="encabezado">
        <h2>Hoja de Ruta {ruta.numero} · {fechaCorta(ruta.fecha)} <EstadoBadge estado={ruta.estado} mapa={ESTADOS_RUTA} /></h2>
        <div className="fila no-imprimir">
          <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(textoWhatsApp(ruta))}`} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>
          <button className="btn-sec" onClick={copiar}>Copiar texto</button>
          <button className="btn-sec" onClick={() => window.print()}>Imprimir / PDF</button>
          <button className="btn-sec" onClick={() => descargarExcel(ruta)}>Descargar Excel</button>
          {puedePlanificar && <Link href={`/rutas/${ruta.id}`}>Editar ruta</Link>}
          <Link href="/despacho">← Despacho</Link>
        </div>
      </div>
      {aviso && <p className="aviso no-imprimir">{aviso}</p>}
      {error && <p className="error">{error}</p>}

      <section className="tarjeta resumen-hoja">
        <div><small>Vehículo</small><strong>{v ? `${v.icono} ${ruta.vehiculo_nombre}` : '—'}{ruta.vehiculo_placa ? ` (${ruta.vehiculo_placa})` : ''}</strong></div>
        <div><small>Conductor</small><strong>{ruta.repartidor_nombre ?? '—'}</strong></div>
        <div><small>Auxiliar logístico</small><strong>{ruta.asistente_nombre ?? '—'}</strong></div>
        <div><small>Pedidos</small><strong>{pedidos.length}</strong></div>
        <div><small>A cobrar</small><strong>{soles(aCobrar)}</strong></div>
        <div className={porDespachar.length ? 'falta' : 'completo'}>
          <small>Despachados al conductor</small>
          <strong>{ruta.despachados}/{pedidos.length}</strong>
        </div>
      </section>

      {editable && porDespachar.length > 0 && (
        <p className="alerta no-imprimir">
          📦 Faltan <strong>{porDespachar.length}</strong> pedido(s) por entregar al conductor.{' '}
          <button className="btn-mini" disabled={guardando} onClick={() => despachar(porDespachar.map((p) => p.id), true)}>
            Marcar todos como despachados
          </button>
        </p>
      )}
      {editable && pedidos.length > 0 && porDespachar.length === 0 && (
        <p className="aviso no-imprimir">✔ Todos los pedidos de la ruta fueron entregados al conductor.</p>
      )}

      <div className="tabla-scroll">
        <table className="tabla-hoja">
          <thead>
            <tr>
              <th className="col-check">Desp.</th><th>#</th><th>Código</th><th>Tipo de Pedido</th><th>Cliente</th><th>N° Contacto</th>
              <th>Dirección</th><th>Distrito</th><th>Productos / Cantidad o ACCIÓN</th><th>Valor</th><th>Envío</th><th>Total</th>
              <th>Cobrar</th><th>Medio de Pago</th><th>Vendedor</th><th>Nota</th><th>Estado</th><th>N° Doc. Bsale</th>
            </tr>
          </thead>
          <tbody>
            {ruta.paradas.map((p, i) => (p.pedido_id ? (
              <tr key={p.id} className={p.despachado_en ? 'despachado' : ''}>
                <td className="col-check">
                  <input type="checkbox" checked={Boolean(p.despachado_en)}
                    disabled={!editable || guardando || p.estado !== 'pendiente'}
                    title={p.despachado_en ? `Despachado por ${p.despachado_por_nombre ?? '—'} · ${fechaHora(p.despachado_en)}` : 'Marcar como entregado al conductor'}
                    onChange={(e) => despachar([p.id], e.target.checked)} />
                </td>
                <td>{i + 1}</td>
                <td><Link href={`/pedidos/${p.pedido_id}`}><strong>{p.pedido_id}</strong></Link></td>
                <td>{p.tipo_pedido}{marca(p) && <small className="marca-tipo" style={{ color: CATEGORIAS[p.categoria]?.color }}>{marca(p)}</small>}
                  {p.motivo && <small>{p.motivo}</small>}{p.agencia && <small>{p.agencia}</small>}</td>
                <td>{p.cliente_nombre}</td>
                <td>{p.cliente_telefono}</td>
                <td>{direccionCompleta(p)}{p.referencia && <small>Ref: {p.referencia}</small>}
                  {mapa(p) && <a className="no-imprimir" href={mapa(p)} target="_blank" rel="noreferrer"><small>Ver mapa</small></a>}</td>
                <td>{p.distrito}<small>{p.departamento}</small></td>
                <td className="productos">{productosTexto(p)}</td>
                <td className="num">{valorProductos(p).toFixed(2)}</td>
                <td className="num">{Number(p.precio_envio).toFixed(2)}</td>
                <td className="num"><strong>{Number(p.total_pedido).toFixed(2)}</strong></td>
                <td className={cobra(p) ? 'cobrar' : ''}>{p.cobrar}</td>
                <td>{p.medio_pago}</td>
                <td>{p.vendedor_nombre}</td>
                <td>{p.nota_pedido}</td>
                <td><EstadoBadge estado={estadoEnRuta(p)} mapa={ESTADOS} /></td>
                <td>{p.documento_bsale}</td>
              </tr>
            ) : (
              <tr key={p.id} className="fila-accion">
                <td className="col-check" /><td>{i + 1}</td><td colSpan={4}><strong>⚑ ACCIÓN</strong></td>
                <td>{p.direccion}</td><td /><td className="productos"><strong>{p.descripcion}</strong></td>
                <td colSpan={9} />
              </tr>
            )))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={9}><strong>Totales</strong></td>
              <td className="num">{pedidos.reduce((s, p) => s + valorProductos(p), 0).toFixed(2)}</td>
              <td className="num">{pedidos.reduce((s, p) => s + Number(p.precio_envio), 0).toFixed(2)}</td>
              <td className="num"><strong>{pedidos.reduce((s, p) => s + Number(p.total_pedido), 0).toFixed(2)}</strong></td>
              <td colSpan={6}>A cobrar: <strong>{soles(aCobrar)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
      {!ruta.paradas.length && <p>La ruta todavía no tiene paradas.</p>}
    </div>
  );
}
