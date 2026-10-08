'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { pedidosApi, usuariosApi } from '../api/services';
import EstadoBadge from '../components/EstadoBadge';
import { useAuth } from '../context/AuthContext';
import { useCatalogos } from '../context/CatalogosContext';
import { ESTADOS, fechaCorta, soles } from '../utils/format';

const FILTROS = { desde: '', hasta: '', estado: '', plataforma: '', tipo_pedido: '', vendedor_id: '', buscar: '' };

export default function Pedidos() {
  const { usuario } = useAuth();
  const { catalogos } = useCatalogos();
  const puedeCrear = ['admin', 'planificador', 'vendedor'].includes(usuario.rol);
  const [pedidos, setPedidos] = useState([]);
  const [vendedores, setVendedores] = useState([]);
  const [filtros, setFiltros] = useState(FILTROS);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (['admin', 'planificador'].includes(usuario.rol)) {
      usuariosApi.listar({ rol: 'vendedor,admin,planificador' }).then(setVendedores).catch(() => {});
    }
  }, [usuario.rol]);

  useEffect(() => {
    const params = Object.fromEntries(Object.entries(filtros).filter(([, v]) => v));
    setCargando(true);
    const t = setTimeout(() => {
      pedidosApi.listar(params)
        .then((r) => { setPedidos(r); setError(''); })
        .catch((e) => setError(mensajeError(e)))
        .finally(() => setCargando(false));
    }, filtros.buscar ? 300 : 0);
    return () => clearTimeout(t);
  }, [filtros]);

  const f = (campo) => ({ value: filtros[campo], onChange: (e) => setFiltros({ ...filtros, [campo]: e.target.value }) });
  const total = pedidos.filter((p) => p.estado !== 'cancelado').reduce((s, p) => s + p.total_pedido, 0);

  return (
    <>
      <div className="encabezado">
        <h2>{usuario.rol === 'vendedor' ? 'Mis ventas' : 'Pedidos'}</h2>
        {puedeCrear && <Link className="btn" href="/pedidos/nuevo">+ Nuevo pedido</Link>}
      </div>

      <section className="tarjeta">
        <div className="filtros">
          <input placeholder="Buscar cliente, # pedido, Bsale, teléfono o código…" {...f('buscar')} />
          <label>Entrega desde<input type="date" {...f('desde')} /></label>
          <label>hasta<input type="date" {...f('hasta')} /></label>
          <select {...f('estado')}>
            <option value="">Todos los estados</option>
            {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select {...f('plataforma')}>
            <option value="">Todas las plataformas</option>
            {catalogos?.plataformas.map((p) => <option key={p}>{p}</option>)}
          </select>
          <select {...f('tipo_pedido')}>
            <option value="">Todos los tipos</option>
            {catalogos?.tiposPedido.map((p) => <option key={p}>{p}</option>)}
          </select>
          {vendedores.length > 0 && (
            <select {...f('vendedor_id')}>
              <option value="">Todos los vendedores</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          )}
          {Object.values(filtros).some(Boolean) && <button className="btn-sec" onClick={() => setFiltros(FILTROS)}>Limpiar</button>}
        </div>
        {error && <p className="error">{error}</p>}
        <p className="resumen-lista">
          {cargando ? 'Cargando…' : `${pedidos.length} pedido(s) · ${soles(total)}`}
          {pedidos.length === 1000 && ' (se muestran los 1000 más recientes; usa los filtros)'}
        </p>
        <div className="tabla-scroll">
          <table className="tabla-pedidos">
            <thead>
              <tr>
                <th>Código</th><th>Entrega</th><th>Plataforma / Tipo</th><th>Cliente</th><th>Distrito</th>
                <th>Productos</th><th>Total</th><th>Cobrar</th><th>Vendedor</th><th>Estado</th><th>Ruta</th>
              </tr>
            </thead>
            <tbody>
              {pedidos.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/pedidos/${p.id}`}><strong>{p.id}</strong></Link><small>{p.documento_bsale}</small></td>
                  <td>{fechaCorta(p.fecha_entrega)}</td>
                  <td>{p.plataforma}<small>{p.tipo_pedido}{p.agencia ? ` · ${p.agencia}` : ''}</small></td>
                  <td>{p.cliente_nombre}<small>{p.cliente_telefono}</small></td>
                  <td>{p.distrito}{p.lat == null && <small className="error">sin ubicación</small>}</td>
                  <td className="productos">{p.productos}</td>
                  <td>{soles(p.total_pedido)}</td>
                  <td>{p.cobrar}<small>{p.medio_pago}</small></td>
                  <td>{p.vendedor_nombre}</td>
                  <td><EstadoBadge estado={p.estado} /></td>
                  <td>{p.repartidor_nombre ? <>{p.repartidor_nombre}<small>parada {p.ruta_orden}</small></> : '—'}</td>
                </tr>
              ))}
              {!cargando && !pedidos.length && <tr><td colSpan={11}>No hay pedidos con estos filtros</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
