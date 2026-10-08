'use client';

import { AdvancedMarker } from '@vis.gl/react-google-maps';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { pedidosApi } from '../api/services';
import Dialogo from '../components/Dialogo';
import EstadoBadge from '../components/EstadoBadge';
import { Mapa } from '../components/maps';
import { useAuth } from '../context/AuthContext';
import { fechaCorta, fechaHora, hoyISO, soles } from '../utils/format';

const EDITABLE = ['pendiente', 'ruteado', 'incidencia'];

const ACCIONES_HISTORIAL = {
  creado: 'Registró el pedido',
  editado: 'Editó',
  estado: 'Cambió el estado',
  reprogramado: 'Reprogramó',
  ruteado: 'Agregó a una ruta',
  quitado_de_ruta: 'Quitó de la ruta',
  observacion_almacen: 'Observación de almacén',
};

function describir(h) {
  const d = h.detalle ?? {};
  switch (h.accion) {
    case 'editado':
      return Object.entries(d).map(([campo, [a, b]]) => `${campo}: ${a ?? '—'} → ${b ?? '—'}`).join(' · ');
    case 'estado':
      return `${d.de} → ${d.a}${d.motivo ? ` (${d.motivo})` : ''}${d.origen ? ` · ${d.origen}` : ''}`;
    case 'reprogramado':
      return `${fechaCorta(d.de)} → ${fechaCorta(d.a)}${d.motivo ? ` (${d.motivo})` : ''}${d.quitado_de_ruta ? ' · salió de su ruta' : ''}`;
    case 'ruteado':
    case 'quitado_de_ruta':
      return `Ruta #${d.ruta_id}${d.motivo ? ` (${d.motivo})` : ''}`;
    case 'observacion_almacen':
      return d.a ?? '(borrada)';
    default:
      return '';
  }
}

export default function PedidoDetalle() {
  const { id } = useParams();
  const { usuario } = useAuth();
  const [pedido, setPedido] = useState(null);
  const [error, setError] = useState('');
  const [dialogo, setDialogo] = useState(null);

  useEffect(() => {
    pedidosApi.obtener(id).then(setPedido).catch((e) => setError(mensajeError(e)));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!pedido) return <p>Cargando…</p>;

  const rol = usuario.rol;
  const logistica = ['admin', 'planificador'].includes(rol);
  const editable = EDITABLE.includes(pedido.estado);
  const puedeEditar = editable && (logistica || (rol === 'vendedor' && pedido.vendedor_id === usuario.id));
  const ubicacion = pedido.lat != null ? { lat: pedido.lat, lng: pedido.lng } : null;

  const abrir = (config) => setDialogo(config);
  const reprogramar = () => abrir({
    titulo: 'Reprogramar entrega',
    campos: [
      { nombre: 'fecha', etiqueta: 'Nueva fecha', tipo: 'date', requerido: true, valor: hoyISO() },
      { nombre: 'motivo', etiqueta: 'Motivo', tipo: 'textarea' },
    ],
    textoBoton: 'Reprogramar',
    onAceptar: async (v) => setPedido(await pedidosApi.reprogramar(id, v.fecha, v.motivo)),
  });
  const estado = (nuevo, titulo, peligro) => abrir({
    titulo,
    campos: nuevo === 'entregado' || nuevo === 'pendiente' ? [] : [{ nombre: 'motivo', etiqueta: 'Motivo', tipo: 'textarea', requerido: true }],
    textoBoton: 'Confirmar',
    peligro,
    onAceptar: async (v) => setPedido(await pedidosApi.cambiarEstado(id, nuevo, v.motivo)),
  });
  const observar = () => abrir({
    titulo: 'Observaciones de almacén',
    campos: [{ nombre: 'texto', etiqueta: 'Observación', tipo: 'textarea', valor: pedido.observaciones_almacen ?? '' }],
    textoBoton: 'Guardar',
    onAceptar: async (v) => setPedido(await pedidosApi.observaciones(id, v.texto)),
  });

  return (
    <>
      <div className="encabezado">
        <h2>Pedido {pedido.id} <EstadoBadge estado={pedido.estado} /></h2>
        <div className="fila">
          {puedeEditar && <Link className="btn" href={`/pedidos/${id}/editar`}>Editar</Link>}
          {editable && (logistica || puedeEditar) && <button className="btn-sec" onClick={reprogramar}>Reprogramar</button>}
          {logistica && ['pendiente', 'ruteado', 'incidencia'].includes(pedido.estado) && (
            <button className="btn-sec" onClick={() => estado('entregado', '¿Marcar como entregado?')}>Marcar entregado</button>
          )}
          {logistica && pedido.estado === 'ruteado' && (
            <button className="btn-sec" onClick={() => estado('incidencia', 'Registrar incidencia')}>Incidencia</button>
          )}
          {logistica && ['incidencia', 'cancelado'].includes(pedido.estado) && (
            <button className="btn-sec" onClick={() => estado('pendiente', '¿Volver a "sin rutear"?')}>Volver a pendiente</button>
          )}
          {logistica && editable && (
            <button className="btn-peligro" onClick={() => estado('cancelado', 'Cancelar pedido', true)}>Cancelar</button>
          )}
          {['admin', 'planificador', 'almacen'].includes(rol) && <button className="btn-sec" onClick={observar}>Obs. almacén</button>}
          <Link href="/pedidos">← Volver</Link>
        </div>
      </div>

      {pedido.observaciones_almacen && <p className="aviso"><strong>Almacén:</strong> {pedido.observaciones_almacen}</p>}

      <div className="grid-2">
        <section className="tarjeta datos">
          <h3>Venta</h3>
          <dl>
            <dt>Marca temporal</dt><dd>{fechaHora(pedido.creado_en)}</dd>
            <dt>Plataforma</dt><dd>{pedido.plataforma}</dd>
            <dt># Pedido</dt><dd>{pedido.numero_pedido || '—'}</dd>
            <dt>Doc. Bsale</dt><dd>{pedido.documento_bsale || '—'}</dd>
            <dt>Tipo</dt><dd>{pedido.tipo_pedido}</dd>
            <dt>Vendedor</dt><dd>{pedido.vendedor_nombre}</dd>
            <dt>Entrega</dt><dd><strong>{fechaCorta(pedido.fecha_entrega)}</strong></dd>
            <dt>Ruta</dt><dd>{pedido.ruta_id ? <>{pedido.repartidor_nombre} · parada {pedido.ruta_orden}</> : 'Sin ruta'}</dd>
          </dl>
          <h3>Cobro</h3>
          <dl>
            <dt>Envío</dt><dd>{soles(pedido.precio_envio)}</dd>
            <dt>Total</dt><dd><strong>{soles(pedido.total_pedido)}</strong></dd>
            <dt>Cobrar</dt><dd>{pedido.cobrar}</dd>
            <dt>Medio de pago</dt><dd>{pedido.medio_pago || '—'}</dd>
            <dt>Nota</dt><dd>{pedido.nota || '—'}</dd>
          </dl>
        </section>

        <section className="tarjeta datos">
          <h3>Cliente y destino</h3>
          <dl>
            <dt>Cliente</dt><dd>{pedido.cliente_nombre}</dd>
            <dt>Contacto</dt><dd>{pedido.cliente_telefono ? <a href={`tel:${pedido.cliente_telefono}`}>{pedido.cliente_telefono}</a> : '—'}</dd>
            {pedido.agencia && <><dt>Agencia</dt><dd>{pedido.agencia} · {pedido.enviar_a || '—'} · {pedido.pago_agencia || '—'}</dd></>}
            <dt>Ubicación</dt><dd>{[pedido.distrito, pedido.provincia, pedido.departamento].filter(Boolean).join(', ') || '—'}</dd>
            <dt>Dirección</dt><dd>{pedido.direccion || '—'}{pedido.detalle_domicilio && ` · ${pedido.detalle_domicilio}`}</dd>
            <dt>Referencia</dt><dd>{pedido.referencia || '—'}</dd>
            <dt>Cód. postal</dt><dd>{pedido.cod_postal || '—'}</dd>
            {pedido.link_ubicacion && <><dt>Link</dt><dd><a href={pedido.link_ubicacion} target="_blank" rel="noreferrer">Abrir enlace</a></dd></>}
          </dl>
          {ubicacion ? (
            <Mapa alto={220} defaultCenter={ubicacion} defaultZoom={16}><AdvancedMarker position={ubicacion} /></Mapa>
          ) : (
            <p className="error">Sin punto en el mapa: no se puede rutear.</p>
          )}
        </section>
      </div>

      <section className="tarjeta">
        <h3>Productos</h3>
        <table>
          <thead><tr><th>SKU</th><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th></tr></thead>
          <tbody>
            {pedido.items.map((it) => (
              <tr key={it.id}><td>{it.sku}</td><td>{it.descripcion}</td><td>{it.cantidad}</td><td>{soles(it.precio_unitario)}</td><td>{soles(it.subtotal)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="tarjeta">
        <h3>Historial</h3>
        <ul className="historial">
          {pedido.historial.map((h) => (
            <li key={h.id}>
              <small>{fechaHora(h.creado_en)} · {h.usuario ?? 'Sistema'}</small>
              <strong>{ACCIONES_HISTORIAL[h.accion] ?? h.accion}</strong> {describir(h)}
            </li>
          ))}
        </ul>
      </section>

      {dialogo && <Dialogo {...dialogo} onCerrar={() => setDialogo(null)} />}
    </>
  );
}
