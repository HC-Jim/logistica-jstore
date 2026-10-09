'use client';

import { useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { vehiculosApi } from '../api/services';
import { VEHICULOS } from '../utils/format';

const VACIO = { id: null, nombre: '', tipo: 'auto', placa: '' };

export default function Vehiculos() {
  const [vehiculos, setVehiculos] = useState([]);
  const [form, setForm] = useState(VACIO);
  const [error, setError] = useState('');

  const cargar = () => vehiculosApi.listar().then(setVehiculos).catch((e) => setError(mensajeError(e)));
  useEffect(() => { cargar(); }, []);

  async function guardar(e) {
    e.preventDefault();
    setError('');
    try {
      const { id, ...body } = form;
      if (id) await vehiculosApi.actualizar(id, body);
      else await vehiculosApi.crear(body);
      setForm(VACIO);
      cargar();
    } catch (err) {
      setError(mensajeError(err));
    }
  }

  async function alternar(v) {
    try {
      await vehiculosApi.actualizar(v.id, { nombre: v.nombre, tipo: v.tipo, placa: v.placa, activo: !v.activo });
      cargar();
    } catch (err) {
      alert(mensajeError(err));
    }
  }

  return (
    <>
      <h2>Vehículos</h2>
      <form className="tarjeta form-grid" onSubmit={guardar}>
        <h3 className="ancho">{form.id ? `Editar ${form.nombre}` : 'Agregar vehículo'}</h3>
        <label>Nombre *<input required maxLength={60} placeholder="Ej. Auto 3" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></label>
        <label>Tipo *
          <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
            {Object.entries(VEHICULOS).map(([k, v]) => <option key={k} value={k}>{v.icono} {v.label}</option>)}
          </select>
        </label>
        <label>Placa<input maxLength={15} value={form.placa ?? ''} onChange={(e) => setForm({ ...form, placa: e.target.value.toUpperCase() })} /></label>
        {error && <p className="error ancho">{error}</p>}
        <div className="fila ancho">
          <button>{form.id ? 'Guardar' : 'Agregar'}</button>
          {form.id && <button type="button" className="btn-sec" onClick={() => setForm(VACIO)}>Cancelar</button>}
        </div>
        <small className="ancho">Un vehículo eventual (p. ej. un auto prestado) se agrega aquí y se desactiva cuando ya no se usa; sus rutas pasadas quedan en el historial.</small>
      </form>

      <section className="tarjeta">
        <table>
          <thead><tr><th>Vehículo</th><th>Tipo</th><th>Placa</th><th>Rutas realizadas</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {vehiculos.map((v) => (
              <tr key={v.id} className={v.activo ? '' : 'inactivo'}>
                <td><strong>{VEHICULOS[v.tipo]?.icono} {v.nombre}</strong></td>
                <td>{VEHICULOS[v.tipo]?.label}</td>
                <td>{v.placa || '—'}</td>
                <td>{v.rutas}</td>
                <td>{v.activo ? 'Activo' : 'Inactivo'}</td>
                <td className="acciones">
                  <button className="btn-sec" onClick={() => setForm({ ...VACIO, ...v, placa: v.placa ?? '' })}>Editar</button>
                  <button className={v.activo ? 'btn-peligro' : 'btn-sec'} onClick={() => alternar(v)}>{v.activo ? 'Desactivar' : 'Activar'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
