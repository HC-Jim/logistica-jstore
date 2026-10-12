'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { productosApi } from '../api/services';
import ProductoBuscador from '../components/ProductoBuscador';
import { useAuth } from '../context/AuthContext';
import { useCatalogos } from '../context/CatalogosContext';
import { soles } from '../utils/format';
import { tiene } from '../utils/roles';

const VACIO = {
  categoria_id: '', subcategoria_id: '', tipo: 'Ítem único', sku: '', descripcion: '', marca_id: '', modelo: '',
  estado_sourcing: '', garantia_meses: '', peso_kg: '', largo_cm: '', ancho_cm: '', alto_cm: '', talla: '',
  estado_verificacion: '', precio_normal: '', precio: '', link_info: '', activo: true,
};
const NUMEROS = ['garantia_meses', 'peso_kg', 'largo_cm', 'ancho_cm', 'alto_cm', 'precio_normal', 'precio'];

/** Ficha del SKU: alta con generador de SKU, edición y componentes del combo. */
export default function ProductoFicha() {
  const { id } = useParams();
  const nuevo = !id;
  const router = useRouter();
  const { usuario } = useAuth();
  const catalogos = useCatalogos().catalogos ?? {};
  const puedeEditar = tiene(usuario, 'admin', 'catalogo');
  const [form, setForm] = useState(VACIO);
  const [original, setOriginal] = useState(null);
  const [matriz, setMatriz] = useState([]);
  const [marcas, setMarcas] = useState([]);
  const [propuesta, setPropuesta] = useState(null);
  const [componentes, setComponentes] = useState([]);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    productosApi.matriz().then(setMatriz).catch(() => {});
    productosApi.marcas().then(setMarcas).catch(() => {});
  }, []);

  useEffect(() => {
    if (nuevo) return;
    productosApi.obtener(id).then((p) => {
      setOriginal(p);
      setForm({
        ...VACIO,
        ...Object.fromEntries(Object.keys(VACIO).map((k) => [k, p[k] ?? VACIO[k]])),
        categoria_id: p.categoria_id ?? '', subcategoria_id: p.subcategoria_id ?? '', marca_id: p.marca_id ?? '',
      });
      setComponentes((p.componentes ?? []).map((c) => ({ ...c })));
    }).catch((e) => setError(mensajeError(e)));
  }, [id, nuevo]);

  // SKU que se asignará al crear (categoría + subcategoría + "2" si es combo + asignación)
  useEffect(() => {
    if (!nuevo || !form.subcategoria_id || form.sku) { setPropuesta(null); return; }
    productosApi.proponerSku(form.subcategoria_id, form.tipo).then(setPropuesta).catch((e) => setError(mensajeError(e)));
  }, [nuevo, form.subcategoria_id, form.tipo, form.sku]);

  const subcategorias = matriz.find((c) => String(c.id) === String(form.categoria_id))?.subcategorias ?? [];
  const set = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));
  const input = (campo, props = {}) => ({
    value: form[campo] ?? '', disabled: !puedeEditar, onChange: (e) => set(campo, e.target.value), ...props,
  });
  const volumen = [form.largo_cm, form.ancho_cm, form.alto_cm].every((v) => Number(v) > 0)
    ? (Number(form.largo_cm) * Number(form.ancho_cm) * Number(form.alto_cm)) / 1e6 : null;

  async function guardar(e) {
    e.preventDefault();
    setError('');
    setAviso('');
    setGuardando(true);
    try {
      const { categoria_id: _c, ...resto } = form;
      const body = Object.fromEntries(Object.entries(resto).map(([k, v]) => {
        if (v === '') return [k, null];
        if (NUMEROS.includes(k) || ['subcategoria_id', 'marca_id'].includes(k)) return [k, Number(v)];
        return [k, v];
      }));
      if (nuevo && !body.sku) delete body.sku; // se genera
      const p = nuevo ? await productosApi.crear(body) : await productosApi.actualizar(id, body);
      if (nuevo) {
        router.replace(`/productos/${p.id}`);
        return;
      }
      setOriginal(p);
      setAviso('Cambios guardados ✔');
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function guardarComponentes() {
    setError('');
    try {
      const r = await productosApi.guardarComponentes(id, componentes.map((c) => ({
        componente_id: c.componente_id, cantidad: Number(c.cantidad), precio: c.precio === '' || c.precio == null ? null : Number(c.precio),
      })));
      setComponentes(r);
      setAviso('Componentes del combo guardados ✔');
    } catch (err) {
      setError(mensajeError(err));
    }
  }

  const sumaComponentes = componentes.reduce((s, c) => s + (Number(c.precio) || 0) * (Number(c.cantidad) || 0), 0);

  return (
    <>
      <div className="encabezado">
        <h2>{nuevo ? 'Nuevo SKU' : `${original?.sku ?? ''} · ${original?.descripcion ?? ''}`}</h2>
        <Link href="/productos">← Catálogo</Link>
      </div>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}

      <form className="tarjeta form-grid" onSubmit={guardar}>
        <h3 className="ancho">Clasificación y SKU</h3>
        <label>Categoría *
          <select required value={form.categoria_id} disabled={!puedeEditar}
            onChange={(e) => setForm((f) => ({ ...f, categoria_id: e.target.value, subcategoria_id: '' }))}>
            <option value="">Elige…</option>
            {matriz.filter((c) => c.activo || String(c.id) === String(form.categoria_id)).map((c) => (
              <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
            ))}
          </select>
        </label>
        <label>Subcategoría *
          <select required value={form.subcategoria_id} disabled={!puedeEditar || !form.categoria_id} onChange={(e) => set('subcategoria_id', e.target.value)}>
            <option value="">Elige…</option>
            {subcategorias.filter((s) => s.activo || String(s.id) === String(form.subcategoria_id)).map((s) => (
              <option key={s.id} value={s.id}>{s.codigo} · {s.nombre}</option>
            ))}
          </select>
        </label>
        <label>Tipo *
          <select {...input('tipo')} disabled={!puedeEditar || (!nuevo && original?.tipo === 'Combo' && componentes.length > 0)}>
            {(catalogos.tiposProducto ?? []).map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <div>
          {nuevo ? (
            <>
              <small>SKU que se asignará</small>
              <div className="sku-propuesto">{form.sku || propuesta?.sku || '—'}</div>
              <small>{propuesta ? `Asignación ${String(propuesta.asignacion).padStart(3, '0')} del prefijo ${propuesta.prefijo}` : 'Elige la subcategoría'}</small>
            </>
          ) : (
            <label>SKU<input {...input('sku')} required /></label>
          )}
        </div>
        {nuevo && (
          <details className="ancho">
            <summary><small>¿Es un SKU que ya existe (codificación antigua)? Escríbelo a mano</small></summary>
            <label>SKU manual<input {...input('sku')} placeholder="Vacío = se genera automáticamente" /></label>
          </details>
        )}

        <h3 className="ficha-seccion">Datos del producto</h3>
        <label className="ancho">Nombre Almacén *<input required maxLength={255} {...input('descripcion')} /></label>
        <label>Marca
          <select {...input('marca_id')}>
            <option value="">—</option>
            {marcas.filter((m) => m.activo || String(m.id) === String(form.marca_id)).map((m) => <option key={m.id} value={m.id}>{m.nombre}{m.propia ? ' (propia)' : ''}</option>)}
          </select>
        </label>
        <label>Modelo<input maxLength={80} {...input('modelo')} /></label>
        <label>Estado de Sourcing
          <select {...input('estado_sourcing')}><option value="">—</option>{(catalogos.estadosSourcing ?? []).map((t) => <option key={t}>{t}</option>)}</select>
        </label>
        <label>Garantía (meses)<input type="number" min="0" step="1" placeholder="0 = sin garantía" {...input('garantia_meses')} /></label>
        <label>Talla<input maxLength={20} {...input('talla')} /></label>
        <label className="ancho">Link para información<input type="url" placeholder="https://…" {...input('link_info')} /></label>

        <h3 className="ficha-seccion">Medidas físicas</h3>
        <label>Peso (kg)<input type="number" min="0" step="0.001" {...input('peso_kg')} /></label>
        <label>Largo (cm)<input type="number" min="0" step="0.01" {...input('largo_cm')} /></label>
        <label>Ancho (cm)<input type="number" min="0" step="0.01" {...input('ancho_cm')} /></label>
        <label>Alto (cm)<input type="number" min="0" step="0.01" {...input('alto_cm')} /></label>
        <div><small>Volumen (m³)</small><div><strong>{volumen != null ? volumen.toFixed(4) : '—'}</strong></div></div>
        <label>Estado de Verificación Física
          <select {...input('estado_verificacion')}><option value="">—</option>{(catalogos.estadosVerificacion ?? []).map((t) => <option key={t}>{t}</option>)}</select>
        </label>

        <h3 className="ficha-seccion">Precios</h3>
        <label>Precio Normal (S/)<input type="number" min="0" step="0.01" {...input('precio_normal')} /></label>
        <label>Precio Web (S/)<input type="number" min="0" step="0.01" {...input('precio')} /></label>
        <label className="check"><input type="checkbox" checked={form.activo} disabled={!puedeEditar} onChange={(e) => set('activo', e.target.checked)} /> Activo (se puede vender)</label>

        {puedeEditar && (
          <div className="fila ancho">
            <button disabled={guardando}>{guardando ? 'Guardando…' : nuevo ? `Crear SKU ${form.sku || propuesta?.sku || ''}` : 'Guardar cambios'}</button>
          </div>
        )}
      </form>

      {!nuevo && original?.tipo === 'Combo' && (
        <section className="tarjeta">
          <h3>Componentes del combo</h3>
          <p><small>Cada componente con la cantidad y la parte del precio del combo que le corresponde.</small></p>
          <table className="componentes">
            <thead><tr><th>SKU</th><th>Producto</th><th>Cantidad</th><th>Precio (S/)</th><th>Web del componente</th>{puedeEditar && <th />}</tr></thead>
            <tbody>
              {componentes.map((c, i) => (
                <tr key={c.componente_id}>
                  <td>{c.sku}</td><td>{c.descripcion}</td>
                  <td><input type="number" min="1" step="1" value={c.cantidad} disabled={!puedeEditar}
                    onChange={(e) => setComponentes(componentes.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)))} /></td>
                  <td><input type="number" min="0" step="0.01" value={c.precio ?? ''} disabled={!puedeEditar}
                    onChange={(e) => setComponentes(componentes.map((x, j) => (j === i ? { ...x, precio: e.target.value } : x)))} /></td>
                  <td>{soles(c.precio_web)}</td>
                  {puedeEditar && <td><button type="button" className="btn-mini btn-peligro" onClick={() => setComponentes(componentes.filter((_, j) => j !== i))}>✕</button></td>}
                </tr>
              ))}
              {!componentes.length && <tr><td colSpan={6}>Aún no tiene componentes.</td></tr>}
            </tbody>
          </table>
          <p>Suma de los componentes: <strong>{soles(sumaComponentes)}</strong>{form.precio !== '' && Math.abs(sumaComponentes - Number(form.precio)) > 0.009 && (
            <small className="error"> · no coincide con el precio Web del combo ({soles(Number(form.precio))})</small>
          )}</p>
          {puedeEditar && (
            <div className="fila">
              <div className="crece">
                <ProductoBuscador onSeleccionar={(p) => {
                  if (p.id === original.id || p.tipo === 'Combo' || componentes.some((c) => c.componente_id === p.id)) return;
                  setComponentes([...componentes, { componente_id: p.id, sku: p.sku, descripcion: p.descripcion, cantidad: 1, precio: p.precio, precio_web: p.precio }]);
                }} />
              </div>
              <button type="button" onClick={guardarComponentes}>Guardar componentes</button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
