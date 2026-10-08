'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { usuario, login } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (usuario) router.replace('/');
  }, [usuario, router]);

  async function enviar(e) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      await login(form.email, form.password);
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login">
      <form className="tarjeta" onSubmit={enviar}>
        <h1 className="logo">Logística<span>JStore</span></h1>
        <label>
          Correo
          <input type="email" required autoFocus value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label>
          Contraseña
          <input type="password" required value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={enviando}>{enviando ? 'Ingresando…' : 'Ingresar'}</button>
        <p className="centrado-texto">¿No tienes cuenta? <Link href="/registro">Crear cuenta</Link></p>
      </form>
    </div>
  );
}
