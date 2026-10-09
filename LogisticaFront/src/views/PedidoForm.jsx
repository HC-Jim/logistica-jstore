'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { mensajeError } from '../api/client';
import { pedidosApi, ubicacionesApi, usuariosApi } from '../api/services';
import MapaSelector from '../components/MapaSelector';
import ProductoBuscador from '../components/ProductoBuscador';
import UbigeoSelect from '../components/UbigeoSelect';
import { useAuth } from '../context/AuthContext';
import { useCatalogos } from '../context/CatalogosContext';
import { CATEGORIAS, hoyISO, soles } from '../utils/format';

// Debe coincidir con CAMPOS_VENDEDOR del backend (src/config/permisos.js)
const CAMPOS_VENDEDOR = new Set([
  'cliente_nombre', 'cliente_telefono', 'agencia', 'enviar_a', 'pago_agencia', 'ubigeo',
  'direccion', 'detalle_domicilio', 'referencia', 'cod_postal', 'link_ubicacion', 'lat', 'lng', 'ubicacion_id',
  'precio_envio', 'total_pedido', 'cobrar', 'medio_pago', 'nota',
]);

const VACIO = {
  plataforma: '', numero_pedido: '', documento_bsale: '', tipo_pedido: '', vendedor_id: '',
  cliente_nombre: '', cliente_telefono: '',
  agencia: '', enviar_a: '', pago_agencia: '',
  ubigeo: null, direccion: '', detalle_domicilio: '', referencia: '', cod_postal: '',
  link_ubicacion: '', lat: null, lng: null,
  fecha_entrega: hoyISO(), precio_envio: 0, total_pedido: '', cobrar: 'No Cobrar', medio_pago: '', nota: '',
  motivo: '', pedido_relacionado: '', ubicacion_id: null, origen_ubicacion_id: null,
};

// Campos que no aplican a cada categoría (no se envían)
const NO_APLICA = {
  venta: ['motivo', 'pedido_relacionado', 'origen_ubicacion_id'],
  inversa: ['plataforma', 'origen_ubicacion_id'],
  encargo: ['plataforma', 'numero_pedido', 'documento_bsale', 'agencia', 'enviar_a', 'pago_agencia', 'cod_postal',
    'precio_envio', 'total_pedido', 'cobrar', 'medio_pago', 'motivo', 'pedido_relacionado', 'vendedor_id'],
};

export default function PedidoForm({ categoria: categoriaNueva = 'venta' }) {
  const { id } = useParams();
  const router = useRouter();
  const { usuario } = useAuth();
  const { catalogos, ubigeo, listo } = useCatalogos();
  const esVendedor = usuario.rol === 'vendedor';
  const editando = Boolean(id);

  const [categoria, setCategoria] = useState(categoriaNueva);
  const [form, setForm] = useState(VACIO);
  const [items, setItems] = useState([]); // { producto | null, descripcion, cantidad, precio_unitario }
  const [itemsTocados, setItemsTocados] = useState(false);
  const [totalManual, setTotalManual] = useState(false);
  const [vendedores, setVendedores] = useState([]);
  const [ubicaciones, setUbicaciones] = useState([]);
  const [estado, setEstado] = useState(null);
  const [cargando, setCargando] = useState(editando);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cat = CATEGORIAS[categoria];
  const esEncargo = categoria === 'encargo';
  const permiteLibres = categoria !== 'venta';

  useEffect(() => {
    if (!esVendedor) usuariosApi.listar({ rol: 'vendedor,admin,planificador', activos: true }).then(setVendedores).catch(() => {});
    ubicacionesApi.listar({ activas: true }).then(setUbicaciones).catch(() => {});
  }, [esVendedor]);

  useEffect(() => {
    if (!editando) return;
    pedidosApi.obtener(id).then((p) => {
      setCategoria(p.categoria);
      setForm(Object.fromEntries(Object.keys(VACIO).map((k) => [k, p[k] ?? VACIO[k]])));
      setItems(p.items.map((it) => ({
        producto: it.producto_id ? { id: it.producto_id, sku: it.sku, descripcion: it.descripcion } : null,
        descripcion: it.producto_id ? '' : it.descripcion,
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

  /** Envío por agencia: la sede elegida es el punto donde el conductor deja el paquete. */
  function usarSede(uid) {
    const u = ubicaciones.find((x) => x.id === Number(uid));
    setForm((f) => (u ? { ...f, ubicacion_id: u.id, lat: u.lat, lng: u.lng } : { ...f, ubicacion_id: null }));
  }

  /** Sedes de agencia, primero las de la agencia elegida. */
  const sedes = useMemo(() => {
    const agencia = (form.agencia || '').toLowerCase();
    return ubicaciones
      .filter((u) => u.tipo === 'agencia')
      .sort((a, b) => Number(b.nombre.toLowerCase().includes(agencia)) - Number(a.nombre.toLowerCase().includes(agencia)) || a.nombre.localeCompare(b.nombre, 'es'));
  }, [ubicaciones, form.agencia]);
  const porAgencia = !esEncargo && !!form.agencia;

  /** Elegir una ubicación frecuente completa el destino del encargo. */
  function usarUbicacion(uid) {
    const u = ubicaciones.find((x) => x.id === Number(uid));
    if (!u) return set('ubicacion_id', null);
    setForm((f) => ({
      ...f, ubicacion_id: u.id, cliente_nombre: u.nombre, cliente_telefono: u.telefono ?? '', direccion: u.direccion ?? '',
      referencia: u.referencia ?? '', ubigeo: u.ubigeo, lat: u.lat, lng: u.lng,
    }));
  }

  function cambiarItem(i, cambios) {
    setItems(items.map((it, j) => (j === i ? { ...it, ...cambios } : it)));
    setItemsTocados(true);
  }
  function agregarProducto(p) {
    setItems([...items, { producto: p, descripcion: '', cantidad: 1, precio_unitario: categoria === 'venta' ? p.precio : 0 }]);
    setItemsTocados(true);
  }
  function agregarLibre() {
    setItems([...items, { producto: null, descripcion: '', cantidad: 1, precio_unitario: 0 }]);
    setItemsTocados(true);
  }

  async function guardar(e) {
    e.preventDefault();
    setError('');
    if (!items.length && !esEncargo) return setError('Agrega al menos un producto o pieza');
    setEnviando(true);
    const datos = Object.fromEntries(
      Object.entries(form)
        .filter(([k]) => !bloqueado(k) && !(editando && k === 'fecha_entrega') && !NO_APLICA[categoria].includes(k))
        .map(([k, v]) => [k, v === '' ? null : v])
    );
    if (esVendedor) delete datos.vendedor_id;
    const lineas = items.map((it) => (it.producto
      ? { producto_id: it.producto.id, cantidad: Number(it.cantidad), precio_unitario: Number(it.precio_unitario) }
      : { descripcion: it.descripcion, cantidad: Number(it.cantidad), precio_unitario: Number(it.precio_unitario) || 0 }));
    try {
      const pedido = editando
        ? await pedidosApi.actualizar(id, { ...datos, ...(itemsTocados && !productosBloqueados && { items: lineas }) })
        : await pedidosApi.crear({ ...datos, categoria, items: lineas });
      router.push(`/pedidos/${pedido.id}`);
    } catch (err) {
      setError(mensajeError(err));
      setEnviando(false);
    }
  }

  if (cargando || !listo) return <p>Cargando…</p>;
  if (editando && estado && !['pendiente', 'ruteado', 'incidencia'].includes(estado)) {
    return <p className="aviso">Este registro está {estado} y ya no se puede editar. <Link href={`/pedidos/${id}`}>Volver</Link></p>;
  }

  const opciones = (lista, vacio = 'Selecciona…') => [
    <option key="" value="">{vacio}</option>,
    ...lista.map((v) => <option key={v} value={v}>{v}</option>),
  ];
  const tipos = catalogos.tiposPorCategoria[categoria];

  return (
    <>
      <div className="encabezado">
        <h2>{cat.icono} {editando ? `Editar ${cat.singular} #${id}` : `Nuevo ${cat.singular}`}</h2>
        <Link href={editando ? `/pedidos/${id}` : '/pedidos'}>← Volver</Link>
      </div>
      {editando && esVendedor && (
        <p className="aviso">Como vendedor puedes modificar los datos del cliente, destino, envío y cobro. Los campos grises los gestiona logística.</p>
      )}
      {!editando && categoria === 'inversa' && (
        <p className="aviso">Logística inversa: recojos y entregas de servicio técnico, piezas faltantes y cambios. Puedes agregar piezas que no están en el catálogo.</p>
      )}
      {!editando && esEncargo && (
        <p className="aviso">Encargo logístico: entregas en almacenes externos (p. ej. Falabella), recojo de suministros o traslados entre almacenes. Se planifica en las rutas como un pedido más.</p>
      )}

      <form onSubmit={guardar}>
        <section className="tarjeta form-grid">
          <h3 className="ancho">{esEncargo ? 'Encargo' : categoria === 'inversa' ? 'Logística inversa' : 'Venta'}</h3>
          {categoria === 'venta' && (
            <label>Plataforma *<select required {...input('plataforma')}>{opciones(catalogos.plataformas)}</select></label>
          )}
          {categoria === 'inversa' && <label>Plataforma<input disabled value="Log. Inversa" /></label>}
          <label>{esEncargo ? 'Tipo de encargo *' : 'Tipo de pedido *'}<select required {...input('tipo_pedido')}>{opciones(tipos)}</select></label>
          {categoria === 'inversa' && (
            <>
              <label>Motivo *<select required {...input('motivo')}>{opciones(catalogos.motivosInversa)}</select></label>
              <label>Pedido original<input maxLength={60} placeholder="Código o # de pedido" {...input('pedido_relacionado')} /></label>
            </>
          )}
          {!esEncargo && (
            <>
              <label># Pedido<input maxLength={60} {...input('numero_pedido')} /></label>
              <label>N° Documento Bsale<input placeholder="BA01-…" maxLength={40} {...input('documento_bsale')} /></label>
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
            </>
          )}
          {esEncargo && (
            <>
              <label className="ancho-2">
                Ubicación frecuente (destino)
                <select value={form.ubicacion_id ?? ''} onChange={(e) => usarUbicacion(e.target.value)}>
                  <option value="">— Otra dirección (escribirla abajo) —</option>
                  {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}{u.distrito ? ` · ${u.distrito}` : ''}</option>)}
                </select>
                <small>Las ubicaciones frecuentes se administran en el menú <Link href="/ubicaciones">Ubicaciones</Link>.</small>
              </label>
              {form.tipo_pedido === 'Traslado entre almacenes' && (
                <label>
                  Origen del traslado
                  <select value={form.origen_ubicacion_id ?? ''} onChange={(e) => set('origen_ubicacion_id', e.target.value ? Number(e.target.value) : null)}>
                    <option value="">— Almacén principal —</option>
                    {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select>
                </label>
              )}
            </>
          )}
        </section>

        <section className="tarjeta form-grid">
          <h3 className="ancho">{esEncargo ? 'Destino' : 'Cliente y destino'}</h3>
          <label>{esEncargo ? 'Destino / razón social *' : 'Cliente *'}<input required maxLength={160} {...input('cliente_nombre')} /></label>
          <label>N° Contacto<input type="tel" maxLength={30} {...input('cliente_telefono')} /></label>
          {!esEncargo && (
            <>
              <label>Agencia
                <select {...input('agencia')} onChange={(e) => setForm((f) => ({ ...f, agencia: e.target.value, ...(e.target.value ? {} : { ubicacion_id: null }) }))}>
                  {opciones(catalogos.agencias, '— Sin agencia —')}
                </select>
              </label>
              <label>Enviar a…<select {...input('enviar_a')}>{opciones(catalogos.enviarA, '—')}</select></label>
              <label>Pago de agencia<select {...input('pago_agencia')}>{opciones(catalogos.pagoAgencia, '—')}</select></label>
            </>
          )}
          <UbigeoSelect valor={form.ubigeo} onChange={(v) => set('ubigeo', v)} disabled={bloqueado('ubigeo')} />
          <label className="ancho">Dirección<input maxLength={255} {...input('direccion')} /></label>
          <label>Detalle del domicilio<input placeholder="Dpto, piso, interior…" maxLength={255} {...input('detalle_domicilio')} /></label>
          <label>Referencia<input maxLength={255} {...input('referencia')} /></label>
          {!esEncargo && <label>Cód. postal<input maxLength={10} {...input('cod_postal')} /></label>}
          {porAgencia && (
            <label className="ancho">Sede de la agencia (donde el conductor deja el paquete)
              <select value={form.ubicacion_id ?? ''} disabled={bloqueado('ubicacion_id')} onChange={(e) => usarSede(e.target.value)}>
                <option value="">— Elige la sede —</option>
                {sedes.map((u) => <option key={u.id} value={u.id}>{u.nombre}{u.distrito ? ` · ${u.distrito}` : ''}{u.direccion ? ` · ${u.direccion}` : ''}</option>)}
              </select>
              <small>
                {sedes.length ? 'La dirección de arriba es la del cliente (destino final); en el mapa va la sede de la agencia. ' : 'Aún no hay sedes de agencia registradas. '}
                Las sedes se registran en <Link href="/ubicaciones">Ubicaciones</Link> con tipo "Agencia".
              </small>
            </label>
          )}
          <div className="ancho">
            <strong>{porAgencia ? 'Punto de entrega: sede de la agencia' : `Ubicación exacta ${esEncargo ? 'del destino' : 'del cliente'}`}</strong>
            <MapaSelector
              sinBuscar={porAgencia}
              ayuda={porAgencia ? 'Envío por agencia: marca aquí la sede de la agencia en Lima (o elígela arriba), no la dirección del cliente.' : null}
              key={form.ubicacion_id ?? 'manual'}
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
          <h3 className="ancho">{esEncargo ? 'Mercadería y fecha' : 'Productos, entrega y cobro'}</h3>
          <label>
            Fecha {esEncargo ? '' : 'de entrega'} *
            <input type="date" required {...input('fecha_entrega')} disabled={editando} />
            {editando && <small>Para cambiarla usa "Reprogramar" en el detalle.</small>}
          </label>

          <div className="ancho">
            <table className="tabla-items">
              <thead><tr><th>{permiteLibres ? 'Producto / pieza' : 'Producto'}</th><th>Cantidad</th><th>Precio unit.</th><th>Subtotal</th><th /></tr></thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td>
                      {it.producto ? (
                        <ProductoBuscador seleccionado={it.producto} disabled={productosBloqueados}
                          onSeleccionar={(p) => cambiarItem(i, { producto: p, precio_unitario: categoria === 'venta' ? p.precio : it.precio_unitario })} />
                      ) : (
                        <input required maxLength={255} placeholder="Describe la pieza o producto (fuera del catálogo)" value={it.descripcion}
                          disabled={productosBloqueados} onChange={(e) => cambiarItem(i, { descripcion: e.target.value })} />
                      )}
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
                {!items.length && esEncargo && <tr><td colSpan={5}><small>Opcional: agrega los productos que se llevan o recogen.</small></td></tr>}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>
                    {!productosBloqueados && <ProductoBuscador onSeleccionar={agregarProducto} />}
                    {!productosBloqueados && (
                      <small>
                        Escribe el SKU o parte de la descripción.
                        {permiteLibres && <> ¿No está en el catálogo? <button type="button" className="btn-link-oscuro" onClick={agregarLibre}>Agregar pieza / producto libre</button></>}
                      </small>
                    )}
                  </td>
                  <td colSpan={2}><strong>{soles(subtotal)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {!esEncargo && (
            <>
              <label>Precio de envío (S/)<input type="number" min="0" step="0.01" {...input('precio_envio')} /></label>
              <label>
                Total (S/)
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
            </>
          )}
          <label className="ancho">{esEncargo ? 'Instrucciones / nota' : 'Nota'}<textarea rows={2} maxLength={1000} {...input('nota')} /></label>
        </section>

        {error && <p className="error">{error}</p>}
        <div className="fila barra-acciones">
          <button disabled={enviando}>{enviando ? 'Guardando…' : editando ? 'Guardar cambios' : `Registrar ${cat.singular}`}</button>
          <Link className="btn btn-sec" href={editando ? `/pedidos/${id}` : '/pedidos'}>Cancelar</Link>
        </div>
      </form>
    </>
  );
}
