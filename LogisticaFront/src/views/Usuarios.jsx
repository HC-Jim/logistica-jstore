'use client';

import { useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { usuariosApi } from '../api/services';
import { ROLES } from '../utils/format';

const VACIO = { id: null, nombre: '', email: '', telefono: '', rol: 'vendedor', password: '' };

const DESCRIPCION_ROL = {
  admin: 'Acceso total, incluida la gestión de usuarios.',
  vendedor: 'Registra pedidos y solo ve y edita sus propias ventas.',
  planificador: 'Gestiona todos los pedidos, arma las rutas y ve el monitoreo.',
  almacen: 'Ve pedidos y monitoreo; escribe observaciones de almacén.',
  repartidor: 'Conductor o asistente: usa la app móvil para su ruta.',
};

/** Contraseña legible (sin 0/O, 1/l/I) de 10 caracteres. */
function generarClave() {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(10));
  return [...bytes].map((n) => letras[n % letras.length]).join('');
}

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [form, setForm] = useState(VACIO);
  const [verClave, setVerClave] = useState(false);
  const [credenciales, setCredenciales] = useState(null); // se muestran una sola vez tras guardar
  const [copiado, setCopiado] = useState(false);
  const [filtroRol, setFiltroRol] = useState('');
  const [error, setError] = useState('');

  const cargar = () => usuariosApi.listar().then(setUsuarios).catch((e) => setError(mensajeError(e)));
  useEffect(() => { cargar(); }, []);

  async function guardar(e) {
    e.preventDefault();
    setError('');
    try {
      const { id, ...body } = form;
      if (!body.password) delete body.password;
      const u = id ? await usuariosApi.actualizar(id, body) : await usuariosApi.crear(body);
      if (body.password) setCredenciales({ nombre: u.nombre, email: u.email, rol: u.rol, password: body.password });
      setCopiado(false);
      setForm(VACIO);
      setVerClave(false);
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

  function nuevaClave() {
    setForm({ ...form, password: generarClave() });
    setVerClave(true);
  }

  async function copiar() {
    const c = credenciales;
    const app = c.rol === 'repartidor' ? 'App móvil de repartidores' : window.location.origin;
    await navigator.clipboard.writeText(`Hola ${c.nombre}, tu acceso a Logística JStore:\n${app}\nCorreo: ${c.email}\nContraseña: ${c.password}`);
    setCopiado(true);
  }

  const campo = (nombre, props = {}) => ({ value: form[nombre] ?? '', onChange: (e) => setForm({ ...form, [nombre]: e.target.value }), ...props });
  const pendientes = usuarios.filter((u) => u.pendiente);
  const visibles = usuarios.filter((u) => !u.pendiente && (!filtroRol || u.rol === filtroRol));

  async function decidir(u, aprobar) {
    if (!aprobar && !confirm(`¿Rechazar y eliminar la solicitud de ${u.nombre}?`)) return;
    try {
      if (aprobar) await usuariosApi.aprobar(u.id);
      else await usuariosApi.rechazar(u.id);
      cargar();
    } catch (err) {
      alert(mensajeError(err));
    }
  }

  return (
    <>
      <h2>Usuarios</h2>

      {pendientes.length > 0 && (
        <section className="tarjeta pendientes">
          <h3>🕓 Solicitudes de cuenta pendientes ({pendientes.length})</h3>
          <p>Estas personas se registraron desde “Crear cuenta”. Revisa el perfil que pidieron antes de aprobar.</p>
          <table>
            <thead><tr><th>Nombre</th><th>Correo</th><th>Perfil solicitado</th><th>Teléfono</th><th>Fecha</th><th /></tr></thead>
            <tbody>
              {pendientes.map((u) => (
                <tr key={u.id}>
                  <td>{u.nombre}</td><td>{u.email}</td>
                  <td>
                    <select value={u.rol} onChange={async (e) => { await usuariosApi.actualizar(u.id, { rol: e.target.value }); cargar(); }}>
                      {Object.entries(ROLES).filter(([k]) => k !== 'admin').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td>{u.telefono}</td>
                  <td>{new Date(u.creado_en).toLocaleDateString('es-PE')}</td>
                  <td className="acciones">
                    <button onClick={() => decidir(u, true)}>Aprobar</button>
                    <button className="btn-peligro" onClick={() => decidir(u, false)}>Rechazar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {credenciales && (
        <section className="tarjeta credenciales">
          <h3>✔ Credenciales de {credenciales.nombre}</h3>
          <p>Entrégaselas ahora: por seguridad la contraseña se guarda cifrada y <strong>no se podrá volver a ver</strong>. Si la pierde, genera una nueva aquí.</p>
          <dl>
            <dt>Correo</dt><dd><code>{credenciales.email}</code></dd>
            <dt>Contraseña</dt><dd><code>{credenciales.password}</code></dd>
            <dt>Perfil</dt><dd>{ROLES[credenciales.rol]}</dd>
          </dl>
          <div className="fila">
            <button onClick={copiar}>{copiado ? 'Copiado ✔' : 'Copiar mensaje para enviar'}</button>
            <button className="btn-sec" onClick={() => setCredenciales(null)}>Cerrar</button>
          </div>
        </section>
      )}

      <form className="tarjeta form-grid" onSubmit={guardar}>
        <h3 className="ancho">{form.id ? `Editar a ${form.nombre}` : 'Registrar usuario'}</h3>
        <label>Nombre *<input required maxLength={120} {...campo('nombre')} /></label>
        <label>Correo *<input type="email" required maxLength={160} {...campo('email')} /></label>
        <label>Teléfono<input maxLength={30} {...campo('telefono')} /></label>
        <label>Perfil *
          <select {...campo('rol')}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <small>{DESCRIPCION_ROL[form.rol]}</small>
        </label>
        <label>
          {form.id ? 'Nueva contraseña (déjala vacía para no cambiarla)' : 'Contraseña *'}
          <div className="fila sin-envolver">
            <input className="crece" type={verClave ? 'text' : 'password'} minLength={6} required={!form.id}
              autoComplete="new-password" {...campo('password')} />
            <button type="button" className="btn-sec" title={verClave ? 'Ocultar' : 'Mostrar'} onClick={() => setVerClave(!verClave)}>
              {verClave ? '🙈' : '👁'}
            </button>
            <button type="button" className="btn-sec" onClick={nuevaClave}>Generar</button>
          </div>
        </label>
        {error && <p className="error ancho">{error}</p>}
        <div className="fila ancho">
          <button>{form.id ? 'Guardar cambios' : 'Crear usuario'}</button>
          {form.id && <button type="button" className="btn-sec" onClick={() => { setForm(VACIO); setVerClave(false); }}>Cancelar</button>}
        </div>
      </form>

      <section className="tarjeta">
        <div className="fila espacio">
          <h3>{visibles.length} usuario(s)</h3>
          <select value={filtroRol} onChange={(e) => setFiltroRol(e.target.value)}>
            <option value="">Todos los perfiles</option>
            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <table>
          <thead><tr><th>Nombre</th><th>Correo</th><th>Perfil</th><th>Teléfono</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {visibles.map((u) => (
              <tr key={u.id} className={u.activo ? '' : 'inactivo'}>
                <td>{u.nombre}</td><td>{u.email}</td><td>{ROLES[u.rol]}</td><td>{u.telefono}</td>
                <td>{u.activo ? 'Activo' : 'Inactivo'}</td>
                <td className="acciones">
                  <button className="btn-sec" onClick={() => { setForm({ ...VACIO, ...u, telefono: u.telefono ?? '', password: '' }); setVerClave(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Editar</button>
                  <button className="btn-sec" onClick={() => { setForm({ ...VACIO, ...u, telefono: u.telefono ?? '', password: generarClave() }); setVerClave(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Nueva contraseña</button>
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
