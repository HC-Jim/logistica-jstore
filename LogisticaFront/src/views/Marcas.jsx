'use client';

import { useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { productosApi } from '../api/services';
import { useAuth } from '../context/AuthContext';
import { useCatalogos } from '../context/CatalogosContext';
import { tiene } from '../utils/roles';

const VACIO = { id: null, nombre: '', propia: false, segmento: '' };

/** Marcas: propias (descuento mayorista propio) y segmento del portafolio. */
export default function Marcas() {
  const { usuario } = useAuth();
  const catalogos = useCatalogos().catalogos ?? {};
  const puedeEditar = tiene(usuario, 'admin', 'catalogo');
  const [marcas, setMarcas] = useState([]);
  const [form, setForm] = useState(VACIO);
  const [error, setError] = useState('');

  const cargar = () => productosApi.marcas().then(setMarcas).catch((e) => setError(mensajeError(e)));
  useEffect(() => { cargar(); }, []);

  async function guardar(e) {
    e.preventDefault();
    setError('');
    try {
      const { id, ...body } = form;
      await productosApi.guardarMarca(id, { ...body, segmento: body.segmento || null });
      setForm(VACIO);
      cargar();
    } catch (err) {
      setError(mensajeError(err));
    }
  }

  const alternar = async (m) => {
    try { await productosApi.guardarMarca(m.id, { activo: !m.activo }); cargar(); } catch (err) { setError(mensajeError(err)); }
  };

  return (
    <>
      <h2>Marcas</h2>
      <p><small>Las <strong>marcas propias</strong> (las que importamos) usan la tabla de descuentos mayoristas propia; el resto, la de otras marcas.</small></p>
      {error && <p className="error">{error}</p>}
      {puedeEditar && (
        <form className="tarjeta fila" onSubmit={guardar}>
          <strong>{form.id ? `Editar ${form.nombre}` : 'Nueva marca'}</strong>
          <input required className="crece" maxLength={60} placeholder="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          <select value={form.segmento ?? ''} onChange={(e) => setForm({ ...form, segmento: e.target.value })}>
            <option value="">Sin segmento</option>
            {(catalogos.segmentosMarca ?? []).map((s) => <option key={s}>{s}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={form.propia} onChange={(e) => setForm({ ...form, propia: e.target.checked })} /> Marca propia</label>
          <button>{form.id ? 'Guardar' : 'Agregar'}</button>
          {form.id && <button type="button" className="btn-sec" onClick={() => setForm(VACIO)}>Cancelar</button>}
        </form>
      )}
      <section className="tarjeta">
        <table>
          <thead><tr><th>Marca</th><th>Tipo</th><th>Segmento</th><th>Productos</th><th>Estado</th>{puedeEditar && <th />}</tr></thead>
          <tbody>
            {marcas.map((m) => (
              <tr key={m.id} className={m.activo ? '' : 'inactivo'}>
                <td><strong>{m.nombre}</strong></td>
                <td>{m.propia ? 'Propia' : 'Otra marca'}</td>
                <td>{m.segmento ?? '—'}</td>
                <td>{m.productos}</td>
                <td>{m.activo ? 'Activa' : 'Inactiva'}</td>
                {puedeEditar && (
                  <td className="acciones">
                    <button className="btn-sec" onClick={() => setForm({ id: m.id, nombre: m.nombre, propia: m.propia, segmento: m.segmento ?? '' })}>Editar</button>
                    <button className="btn-sec" onClick={() => alternar(m)}>{m.activo ? 'Desactivar' : 'Activar'}</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
