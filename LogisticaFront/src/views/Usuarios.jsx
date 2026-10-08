'use client';

import { useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { usuariosApi } from '../api/services';
import { ROLES } from '../utils/format';

const VACIO = { id: null, nombre: '', email: '', telefono: '', rol: 'vendedor', password: '' };

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [form, setForm] = useState(VACIO);
  const [error, setError] = useState('');

  const cargar = () => usuariosApi.listar().then(setUsuarios).catch((e) => setError(mensajeError(e)));
  useEffect(() => { cargar(); }, []);

  async function guardar(e) {
    e.preventDefault();
    setError('');
    try {
      const { id, ...body } = form;
      if (!body.password) delete body.password;
      if (id) await usuariosApi.actualizar(id, body);
      else await usuariosApi.crear(body);
      setForm(VACIO);
      cargar();
    } catch (err) {
      setError(mensajeError(err));
    }
  }

  async function alternar(u) {
    try {
      await usuariosApi.actualizar(u.id, { activo: !u.activo });
      cargar();
    } catch (err) {
      alert(mensajeError(err));
    }
  }

  const campo = (nombre, props = {}) => ({ value: form[nombre] ?? '', onChange: (e) => setForm({ ...form, [nombre]: e.target.value }), ...props });

  return (
    <>
      <h2>Usuarios</h2>
      <form className="tarjeta form-grid" onSubmit={guardar}>
        <h3 className="ancho">{form.id ? `Editar ${form.nombre}` : 'Nuevo usuario'}</h3>
        <label>Nombre *<input required {...campo('nombre')} /></label>
        <label>Correo *<input type="email" required {...campo('email')} /></label>
        <label>Teléfono<input {...campo('telefono')} /></label>
        <label>Rol *
          <select {...campo('rol')}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label>{form.id ? 'Nueva contraseña (opcional)' : 'Contraseña *'}
          <input type="password" minLength={6} required={!form.id} autoComplete="new-password" {...campo('password')} />
        </label>
        {error && <p className="error ancho">{error}</p>}
        <div className="fila ancho">
          <button>{form.id ? 'Actualizar' : 'Crear usuario'}</button>
          {form.id && <button type="button" className="btn-sec" onClick={() => setForm(VACIO)}>Cancelar</button>}
        </div>
        <small className="ancho">Los repartidores y asistentes usan este mismo correo y contraseña en la app móvil.</small>
      </form>

      <section className="tarjeta">
        <table>
          <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Teléfono</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} className={u.activo ? '' : 'inactivo'}>
                <td>{u.nombre}</td><td>{u.email}</td><td>{ROLES[u.rol]}</td><td>{u.telefono}</td>
                <td>{u.activo ? 'Activo' : 'Inactivo'}</td>
                <td className="acciones">
                  <button className="btn-sec" onClick={() => setForm({ ...VACIO, ...u, telefono: u.telefono ?? '', password: '' })}>Editar</button>
                  <button className={u.activo ? 'btn-peligro' : 'btn-sec'} onClick={() => alternar(u)}>{u.activo ? 'Desactivar' : 'Activar'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
