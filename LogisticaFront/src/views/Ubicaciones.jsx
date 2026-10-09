'use client';

import { useEffect, useMemo, useState } from 'react';
import { mensajeError } from '../api/client';
import { ubicacionesApi } from '../api/services';
import MapaSelector from '../components/MapaSelector';
import UbigeoSelect from '../components/UbigeoSelect';
import { useAuth } from '../context/AuthContext';
import { useCatalogos } from '../context/CatalogosContext';
import { TIPOS_UBICACION } from '../utils/format';

const VACIO = { id: null, nombre: '', tipo: 'almacen_externo', direccion: '', ubigeo: null, referencia: '', contacto: '', telefono: '', lat: null, lng: null, link: '' };

/** Puntos recurrentes (agencias, almacenes, proveedores, clientes frecuentes…) para marcar pedidos en el mapa. */
export default function Ubicaciones() {
  const { ubigeo } = useCatalogos();
  const { usuario } = useAuth();
  const puedeEditar = ['admin', 'planificador'].includes(usuario.rol); // los demás solo agregan
  const [lista, setLista] = useState([]);
  const [form, setForm] = useState(VACIO);
  const [error, setError] = useState('');

  const cargar = () => ubicacionesApi.listar().then(setLista).catch((e) => setError(mensajeError(e)));
  useEffect(() => { cargar(); }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const direccionBusqueda = useMemo(() => {
    const u = form.ubigeo && ubigeo.porCodigo.get(form.ubigeo);
    return [form.direccion, u?.distrito, u?.provincia, 'Perú'].filter(Boolean).join(', ');
  }, [form.direccion, form.ubigeo, ubigeo]);

  async function guardar(e) {
    e.preventDefault();
    setError('');
    if (form.lat == null) return setError('Marca la ubicación en el mapa o pega su link de Google Maps');
    try {
      const { id, link: _l, ...body } = form;
      const datos = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === '' ? null : v]));
      if (id) await ubicacionesApi.actualizar(id, datos);
      else await ubicacionesApi.crear(datos);
      setForm(VACIO);
      cargar();
    } catch (err) {
      setError(mensajeError(err));
    }
  }

  async function alternar(u) {
    try {
      const { id, activo, distrito: _d, provincia: _p, usos: _u, creado_en: _c, ...datos } = u;
      await ubicacionesApi.actualizar(id, { ...datos, activo: !activo });
      cargar();
    } catch (err) {
      alert(mensajeError(err));
    }
  }

  return (
    <>
      <h2>Ubicaciones frecuentes</h2>
      <p>Guarda una vez los puntos a los que se va seguido (almacén de Falabella, otros almacenes, proveedores, agencias). Luego se eligen en un clic al registrar un encargo o al agregar una acción en una ruta.</p>

      <form className="tarjeta form-grid" onSubmit={guardar}>
        <h3 className="ancho">{form.id ? `Editar: ${form.nombre}` : 'Nueva ubicación'}</h3>
        <label>Nombre *<input required maxLength={120} placeholder="Ej. Almacén Falabella Huachipa" value={form.nombre} onChange={set('nombre')} /></label>
        <label>Tipo *
          <select value={form.tipo} onChange={set('tipo')}>
            {Object.entries(TIPOS_UBICACION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Contacto<input maxLength={120} placeholder="Persona o área que recibe" value={form.contacto} onChange={set('contacto')} /></label>
        <label>Teléfono<input maxLength={30} value={form.telefono} onChange={set('telefono')} /></label>
        <UbigeoSelect valor={form.ubigeo} onChange={(v) => setForm((f) => ({ ...f, ubigeo: v }))} />
        <label className="ancho">Dirección<input maxLength={255} value={form.direccion} onChange={set('direccion')} /></label>
        <label className="ancho">Referencia / indicaciones<input maxLength={255} placeholder="Ej. Puerta 3, horario de recepción 8am–1pm" value={form.referencia} onChange={set('referencia')} /></label>
        <div className="ancho">
          <strong>Ubicación en el mapa *</strong>
          <MapaSelector key={form.id ?? 'nueva'} valor={{ lat: form.lat, lng: form.lng }}
            onChange={({ lat, lng }) => setForm((f) => ({ ...f, lat, lng }))}
            link={form.link} onLink={(v) => setForm((f) => ({ ...f, link: v }))} direccion={direccionBusqueda} />
        </div>
        {error && <p className="error ancho">{error}</p>}
        <div className="fila ancho">
          <button>{form.id ? 'Guardar cambios' : 'Agregar ubicación'}</button>
          {form.id && <button type="button" className="btn-sec" onClick={() => setForm(VACIO)}>Cancelar</button>}
        </div>
      </form>

      <section className="tarjeta">
        <table>
          <thead><tr><th>Nombre</th><th>Tipo</th><th>Dirección</th><th>Contacto</th><th>Usos</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {lista.map((u) => (
              <tr key={u.id} className={u.activo ? '' : 'inactivo'}>
                <td><strong>{u.nombre}</strong></td>
                <td>{TIPOS_UBICACION[u.tipo]}</td>
                <td>{u.direccion}<small>{u.distrito}</small></td>
                <td>{u.contacto}<small>{u.telefono}</small></td>
                <td>{u.usos}</td>
                <td>{u.activo ? 'Activa' : 'Inactiva'}</td>
                <td className="acciones">
                  {puedeEditar && <>
                  <button className="btn-sec" onClick={() => { setForm({ ...VACIO, ...Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v ?? VACIO[k] ?? ''])), link: '' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Editar</button>
                  <button className={u.activo ? 'btn-peligro' : 'btn-sec'} onClick={() => alternar(u)}>{u.activo ? 'Desactivar' : 'Activar'}</button>
                  </>}
                </td>
              </tr>
            ))}
            {!lista.length && <tr><td colSpan={7}>Aún no hay ubicaciones guardadas.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
