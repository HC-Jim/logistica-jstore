'use client';

import Link from 'next/link';
import { useState } from 'react';
import { mensajeError } from '../api/client';
import { authApi } from '../api/services';

const PERFILES = [
  ['vendedor', 'Vendedor', 'Registro pedidos y gestiono mis ventas'],
  ['planificador', 'Planificador / Logística', 'Armo las rutas y gestiono los pedidos'],
  ['almacen', 'Almacén', 'Preparo los pedidos y registro observaciones'],
  ['repartidor', 'Conductor', 'Manejo el vehículo y entrego los pedidos (app móvil)'],
  ['auxiliar', 'Auxiliar logístico', 'Acompaño al conductor en la ruta (app móvil)'],
];

export default function Registro() {
  const [form, setForm] = useState({ nombre: '', email: '', telefono: '', rol: 'vendedor', password: '', confirmar: '' });
  const [verClave, setVerClave] = useState(false);
  const [error, setError] = useState('');
  const [listo, setListo] = useState('');
  const [enviando, setEnviando] = useState(false);

  const campo = (nombre) => ({ value: form[nombre], onChange: (e) => setForm({ ...form, [nombre]: e.target.value }) });

  async function enviar(e) {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirmar) return setError('Las contraseñas no coinciden');
    setEnviando(true);
    try {
      const { confirmar: _c, ...body } = form;
      const r = await authApi.registro(body);
      setListo(r.mensaje);
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  }

  if (listo) {
    return (
      <div className="login">
        <div className="tarjeta">
          <h1 className="logo">Logística<span>JStore</span></h1>
          <p className="aviso">✔ {listo}</p>
          <p>Te avisarán cuando tu cuenta esté activa. Después ingresa con <strong>{form.email}</strong>.</p>
          <Link className="btn" href="/login">Ir al inicio de sesión</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <form className="tarjeta registro" onSubmit={enviar}>
        <h1 className="logo">Logística<span>JStore</span></h1>
        <h3>Crear cuenta</h3>
        <label>Nombre completo<input required maxLength={120} autoFocus {...campo('nombre')} /></label>
        <label>Correo<input type="email" required maxLength={160} {...campo('email')} /></label>
        <label>Teléfono<input type="tel" maxLength={30} {...campo('telefono')} /></label>

        <fieldset className="perfiles">
          <legend>Perfil</legend>
          {PERFILES.map(([valor, nombre, desc]) => (
            <label key={valor} className={`perfil ${form.rol === valor ? 'elegido' : ''}`}>
              <input type="radio" name="rol" value={valor} checked={form.rol === valor}
                onChange={() => setForm({ ...form, rol: valor })} />
              <span><strong>{nombre}</strong><small>{desc}</small></span>
            </label>
          ))}
        </fieldset>

        <label>
          Contraseña (mínimo 6 caracteres)
          <div className="fila sin-envolver">
            <input className="crece" type={verClave ? 'text' : 'password'} required minLength={6} autoComplete="new-password" {...campo('password')} />
            <button type="button" className="btn-sec" onClick={() => setVerClave(!verClave)}>{verClave ? '🙈' : '👁'}</button>
          </div>
        </label>
        <label>Repite la contraseña
          <input type={verClave ? 'text' : 'password'} required minLength={6} autoComplete="new-password" {...campo('confirmar')} />
        </label>

        {error && <p className="error">{error}</p>}
        <button disabled={enviando}>{enviando ? 'Enviando…' : 'Crear cuenta'}</button>
        <small>Un administrador debe aprobar tu cuenta antes de que puedas ingresar.</small>
        <p className="centrado-texto">¿Ya tienes cuenta? <Link href="/login">Inicia sesión</Link></p>
      </form>
    </div>
  );
}
