'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { mensajeError } from '../api/client';
import { rutasApi } from '../api/services';
import { useAuth } from '../context/AuthContext';
import { ROLES } from '../utils/format';

const REFRESCO_MS = 5000;

const hora = (iso) =>
  new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' });
const dia = (iso) =>
  new Date(iso).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', timeZone: 'America/Lima' });

/** Chat de una ruta entre logística y el conductor/auxiliar (la app móvil usa la misma API). */
export default function ChatRuta({ rutaId, alto = 360 }) {
  const { usuario } = useAuth();
  const [mensajes, setMensajes] = useState([]);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const ultimo = useRef(0);
  const lista = useRef(null);

  const agregar = useCallback((nuevos) => {
    if (!nuevos.length) return;
    ultimo.current = nuevos[nuevos.length - 1].id;
    setMensajes((m) => [...m, ...nuevos.filter((n) => !m.some((x) => x.id === n.id))]);
  }, []);

  // Carga inicial y luego solo los mensajes nuevos cada pocos segundos
  useEffect(() => {
    ultimo.current = 0;
    setMensajes([]);
    let activo = true;
    const traer = () => rutasApi.mensajes(rutaId, ultimo.current)
      .then((r) => activo && agregar(r))
      .catch(() => {});
    traer();
    const t = setInterval(traer, REFRESCO_MS);
    return () => { activo = false; clearInterval(t); };
  }, [rutaId, agregar]);

  useEffect(() => {
    lista.current?.scrollTo({ top: lista.current.scrollHeight });
  }, [mensajes.length]);

  async function enviar(e) {
    e.preventDefault();
    if (!texto.trim()) return;
    setEnviando(true);
    setError('');
    try {
      agregar([await rutasApi.enviarMensaje(rutaId, texto.trim())]);
      setTexto('');
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  }

  let diaAnterior = '';
  return (
    <div className="chat">
      <div className="chat-mensajes" ref={lista} style={{ height: alto }}>
        {!mensajes.length && <p className="chat-vacio">Sin mensajes. Escribe al conductor o al auxiliar de esta ruta.</p>}
        {mensajes.map((m) => {
          const d = dia(m.creado_en);
          const separador = d !== diaAnterior ? <div className="chat-dia" key={`d${m.id}`}>{d}</div> : null;
          diaAnterior = d;
          const mio = m.usuario_id === usuario.id;
          return [
            separador,
            <div key={m.id} className={`chat-burbuja ${mio ? 'mia' : ''}`}>
              {!mio && <strong>{m.usuario_nombre ?? 'Usuario'} <small>{ROLES[m.usuario_rol] ?? ''}</small></strong>}
              <p>{m.texto}</p>
              <time>{hora(m.creado_en)}</time>
            </div>,
          ];
        })}
      </div>
      <form className="chat-enviar" onSubmit={enviar}>
        <input placeholder="Escribe un mensaje…" maxLength={2000} value={texto} onChange={(e) => setTexto(e.target.value)} />
        <button disabled={enviando || !texto.trim()}>Enviar</button>
      </form>
      {error && <small className="error">{error}</small>}
    </div>
  );
}
