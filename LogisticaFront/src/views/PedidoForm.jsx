'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { mensajeError } from '../api/client';
import { pedidosApi, usuariosApi } from '../api/services';
import MapaSelector from '../components/MapaSelector';
import ProductoBuscador from '../components/ProductoBuscador';
import UbigeoSelect from '../components/UbigeoSelect';
import { useAuth } from '../context/AuthContext';
import { useCatalogos } from '../context/CatalogosContext';
import { hoyISO, soles } from '../utils/format';

// Debe coincidir con CAMPOS_VENDEDOR del backend (src/config/permisos.js)
const CAMPOS_VENDEDOR = new Set([
  'cliente_nombre', 'cliente_telefono', 'agencia', 'enviar_a', 'pago_agencia', 'ubigeo',
  'direccion', 'detalle_domicilio', 'referencia', 'cod_postal', 'link_ubicacion', 'lat', 'lng',
  'precio_envio', 'total_pedido', 'cobrar', 'medio_pago', 'nota',
]);

const VACIO = {
  plataforma: '', numero_pedido: '', documento_bsale: '', tipo_pedido: '', vendedor_id: '',
  cliente_nombre: '', cliente_telefono: '',
  agencia: '', enviar_a: '', pago_agencia: '',
  ubigeo: null, direccion: '', detalle_domicilio: '', referencia: '', cod_postal: '',
  link_ubicacion: '', lat: null, lng: null,
  fecha_entrega: hoyISO(), precio_envio: 0, total_pedido: '', cobrar: 'No Cobrar', medio_pago: '', nota: '',
};

export default function PedidoForm() {
  const { id } = useParams();
  const router = useRouter();
  const { usuario } = useAuth();
  const { catalogos, ubigeo, listo } = useCatalogos();
  const esVendedor = usuario.rol === 'vendedor';
  const editando = Boolean(id);

  const [form, setForm] = useState(VACIO);
  const [items, setItems] = useState([]); // { producto, cantidad, precio_unitario }
  const [itemsTocados, setItemsTocados] = useState(false);
  const [totalManual, setTotalManual] = useState(false);
  const [vendedores, setVendedores] = useState([]);
  const [estado, setEstado] = useState(null);
  const [cargando, setCargando] = useState(editando);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!esVendedor) usuariosApi.listar({ rol: 'vendedor,admin,planificador', activos: true }).then(setVendedores).catch(() => {});
  }, [esVendedor]);

  useEffect(() => {
    if (!editando) return;
    pedidosApi.obtener(id).then((p) => {
      setForm(Object.fromEntries(Object.keys(VACIO).map((k) => [k, p[k] ?? VACIO[k]])));
      setItems(p.items.map((it) => ({
        producto: { id: it.producto_id, sku: it.sku, descripcion: it.descripcion },
        cantidad: it.cantidad,
        precio_unitario: it.precio_unitario,
      })));
      setEstado(p.estado);
      setTotalManual(true);
    }).catch((e) => setError(mensajeError(e))).finally(() => setCargando(false));
  }, [editando, id]);

  const subtotal = items.reduce((s, it) => s + (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0), 0);
  const totalSugerido = Math.round((subtotal + (Number(form.precio_envio) || 0)) * 100) / 100;
  useEffect(() => {
    if (!totalManual) setForm((f) => ({ ...f, total_pedido: totalSugerido }));
  }, [totalSugerido, totalManual]);

  const bloqueado = (campo) => editando && esVendedor && !CAMPOS_VENDEDOR.has(campo);
  const productosBloqueados = editando && esVendedor;
  const set = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));
  const input = (campo, props = {}) => ({
    value: form[campo] ?? '',
    disabled: bloqueado(campo),
    onChange: (e) => set(campo, e.target.value),
    ...props,
  });

  const direccionBusqueda = useMemo(() => {
    const u = form.ubigeo && ubigeo.porCodigo.get(form.ubigeo);
    return [form.direccion, u?.distrito, u?.provincia, 'Perú'].filter(Boolean).join(', ');
  }, [form.direccion, form.ubigeo, ubigeo]);

  function cambiarItem(i, cambios) {
    setItems(items.map((it, j) => (j === i ? { ...it, ...cambios } : it)));
    setItemsTocados(true);
  }
  function agregarProducto(p) {
    setItems([...items, { producto: p, cantidad: 1, precio_unitario: p.precio }]);
    setItemsTocados(true);
  }

  async function guardar(e) {
    e.preventDefault();
    setError('');
    if (!items.length) return setError('Agrega al menos un producto');
    setEnviando(true);
    const datos = Object.fromEntries(
      Object.entries(form)
        .filter(([k]) => !bloqueado(k) && !(editando && k === 'fecha_entrega'))
        .map(([k, v]) => [k, v === '' ? null : v])
    );
    if (esVendedor) delete datos.vendedor_id;
    const lineas = items.map((it) => ({
      producto_id: it.producto.id,
      cantidad: Number(it.cantidad),
      precio_unitario: Number(it.precio_unitario),
    }));
    try {
      const pedido = editando
        ? await pedidosApi.actualizar(id, { ...datos, ...(itemsTocados && !productosBloqueados && { items: lineas }) })
        : await pedidosApi.crear({ ...datos, items: lineas });
      router.push(`/pedidos/${pedido.id}`);
    } catch (err) {
      setError(mensajeError(err));
      setEnviando(false);
    }
  }

  if (cargando || !listo) return <p>Cargando…</p>;
  if (editando && estado && !['pendiente', 'ruteado', 'incidencia'].includes(estado)) {
    return <p className="aviso">Este pedido está {estado} y ya no se puede editar. <Link href={`/pedidos/${id}`}>Volver</Link></p>;
  }

  const opciones = (lista, vacio = 'Selecciona…') => [
    <option key="" value="">{vacio}</option>,
    ...lista.map((v) => <option key={v} value={v}>{v}</option>),
  ];

  return (
    <>
      <div className="encabezado">
        <h2>{editando ? `Editar pedido #${id}` : 'Nuevo pedido'}</h2>
        <Link href={editando ? `/pedidos/${id}` : '/pedidos'}>← Volver</Link>
      </div>
      {editando && esVendedor && (
        <p className="aviso">Como vendedor puedes modificar los datos del cliente, destino, envío y cobro. Los campos grises los gestiona logística.</p>
      )}

      <form onSubmit={guardar}>
        <section className="tarjeta form-grid">
          <h3 className="ancho">Venta</h3>
          <label>Plataforma *<select required {...input('plataforma')}>{opciones(catalogos.plataformas)}</select></label>
          <label># Pedido<input maxLength={60} {...input('numero_pedido')} /></label>
          <label>N° Documento Bsale<input placeholder="BA01-…" maxLength={40} {...input('documento_bsale')} /></label>
          <label>Tipo de pedido *<select required {...input('tipo_pedido')}>{opciones(catalogos.tiposPedido)}</select></label>
          {esVendedor ? (
            <label>Vendedor<input disabled value={usuario.nombre} /></label>
          ) : (
            <label>
              Vendedor
              <select {...input('vendedor_id')} value={form.vendedor_id || usuario.id}
                onChange={(e) => set('vendedor_id', Number(e.target.value))}>
                {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}{v.id === usuario.id ? ' (yo)' : ''}</option>)}
              </select>
            </label>
          )}
        </section>

        <section className="tarjeta form-grid">
          <h3 className="ancho">Cliente y destino</h3>
          <label>Cliente *<input required maxLength={160} {...input('cliente_nombre')} /></label>
          <label>N° Contacto<input type="tel" maxLength={30} {...input('cliente_telefono')} /></label>
          <label>Agencia<select {...input('agencia')}>{opciones(catalogos.agencias, '— Sin agencia —')}</select></label>
          <label>Enviar a…<select {...input('enviar_a')}>{opciones(catalogos.enviarA, '—')}</select></label>
          <label>Pago de agencia<select {...input('pago_agencia')}>{opciones(catalogos.pagoAgencia, '—')}</select></label>
          <UbigeoSelect valor={form.ubigeo} onChange={(v) => set('ubigeo', v)} disabled={bloqueado('ubigeo')} />
          <label className="ancho">Dirección<input maxLength={255} {...input('direccion')} /></label>
          <label>Detalle del domicilio<input placeholder="Dpto, piso, interior…" maxLength={255} {...input('detalle_domicilio')} /></label>
          <label>Referencia<input maxLength={255} {...input('referencia')} /></label>
          <label>Cód. postal<input maxLength={10} {...input('cod_postal')} /></label>
          <div className="ancho">
            <strong>Ubicación exacta del cliente</strong>
            <MapaSelector
              valor={{ lat: form.lat, lng: form.lng }}
              onChange={({ lat, lng }) => setForm((f) => ({ ...f, lat, lng }))}
              link={form.link_ubicacion}
              onLink={(v) => set('link_ubicacion', v)}
              direccion={direccionBusqueda}
              disabled={bloqueado('lat')}
            />
          </div>
        </section>

        <section className="tarjeta form-grid">
          <h3 className="ancho">Productos, entrega y cobro</h3>
          <label>
            Fecha de entrega *
            <input type="date" required {...input('fecha_entrega')} disabled={editando} />
            {editando && <small>Para cambiarla usa "Reprogramar" en el detalle del pedido.</small>}
          </label>

          <div className="ancho">
            <table className="tabla-items">
              <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio unit.</th><th>Subtotal</th><th /></tr></thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td>
                      <ProductoBuscador seleccionado={it.producto} disabled={productosBloqueados}
                        onSeleccionar={(p) => cambiarItem(i, { producto: p, precio_unitario: p.precio })} />
                    </td>
                    <td><input type="number" min="1" step="1" required value={it.cantidad} disabled={productosBloqueados}
                      onChange={(e) => cambiarItem(i, { cantidad: e.target.value })} /></td>
                    <td><input type="number" min="0" step="0.01" required value={it.precio_unitario} disabled={productosBloqueados}
                      onChange={(e) => cambiarItem(i, { precio_unitario: e.target.value })} /></td>
                    <td>{soles((Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0))}</td>
                    <td>
                      {!productosBloqueados && (
                        <button type="button" className="btn-peligro" title="Quitar"
                          onClick={() => { setItems(items.filter((_, j) => j !== i)); setItemsTocados(true); }}>✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>
                    {!productosBloqueados && <ProductoBuscador onSeleccionar={agregarProducto} />}
                    {!productosBloqueados && <small>Escribe el SKU o parte de la descripción para agregar un producto.</small>}
                  </td>
                  <td colSpan={2}><strong>{soles(subtotal)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <label>Precio de envío (S/)<input type="number" min="0" step="0.01" {...input('precio_envio')} /></label>
          <label>
            Total del pedido (S/)
            <input type="number" min="0" step="0.01" {...input('total_pedido')}
              onChange={(e) => { set('total_pedido', e.target.value); setTotalManual(true); }} />
            {Number(form.total_pedido) !== totalSugerido && (
              <small>
                Productos + envío = {soles(totalSugerido)}{' '}
                {!bloqueado('total_pedido') && <button type="button" className="btn-link-oscuro" onClick={() => { setTotalManual(false); set('total_pedido', totalSugerido); }}>usar</button>}
              </small>
            )}
          </label>
          <label>Cobrar *<select required {...input('cobrar')}>{opciones(catalogos.cobrar)}</select></label>
          <label>Medio de pago<select {...input('medio_pago')}>{opciones(catalogos.mediosPago, '—')}</select></label>
          <label className="ancho">Nota<textarea rows={2} maxLength={1000} {...input('nota')} /></label>
        </section>

        {error && <p className="error">{error}</p>}
        <div className="fila barra-acciones">
          <button disabled={enviando}>{enviando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Registrar pedido'}</button>
          <Link className="btn btn-sec" href={editando ? `/pedidos/${id}` : '/pedidos'}>Cancelar</Link>
        </div>
      </form>
    </>
  );
}
