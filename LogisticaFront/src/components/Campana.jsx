'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { notificacionesApi } from '../api/services';
import { fechaHora } from '../utils/format';

const REFRESCO_MS = 30000;
const ICONOS = {
  ruta_asignada: '🗺️', ruta_retirada: '🚫', ruta_modificada: '🔄', mensaje: '💬', incidencia: '⚠️',
  pedido_modificado: '✏️', pedido_retirado: '❌', cuenta_pendiente: '🕓',
};

/** Campana de avisos: contador de no leídos y lista desplegable. */
export default function Campana() {
  const router = useRouter();
  const [abierta, setAbierta] = useState(false);
  const [noLeidas, setNoLeidas] = useState(0);
  const [lista, setLista] = useState([]);
  const caja = useRef(null);

  const contar = useCallback(() => {
    if (document.hidden) return; // no consultar con la pestaña oculta
    notificacionesApi.contador().then((r) => setNoLeidas(r.no_leidas)).catch(() => {});
  }, []);

  useEffect(() => {
    contar();
    const t = setInterval(contar, REFRESCO_MS);
    document.addEventListener('visibilitychange', contar);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', contar); };
  }, [contar]);

  useEffect(() => {
    if (!abierta) return;
    notificacionesApi.listar().then((r) => { setLista(r.notificaciones); setNoLeidas(r.no_leidas); }).catch(() => {});
    const cerrar = (e) => { if (!caja.current?.contains(e.target)) setAbierta(false); };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, [abierta]);

  async function abrir(n) {
    if (!n.leida) {
      await notificacionesApi.leer([n.id]).catch(() => {});
      setNoLeidas((x) => Math.max(0, x - 1));
      setLista((l) => l.map((x) => (x.id === n.id ? { ...x, leida: true } : x)));
    }
    setAbierta(false);
    if (n.url) router.push(n.url);
  }

  async function leerTodas() {
    await notificacionesApi.leerTodas().catch(() => {});
    setNoLeidas(0);
    setLista((l) => l.map((x) => ({ ...x, leida: true })));
  }

  return (
    <div className="campana" ref={caja}>
      <button className="campana-boton" onClick={() => setAbierta(!abierta)} title="Notificaciones">
        🔔 Avisos {noLeidas > 0 && <span className="contador">{noLeidas > 99 ? '99+' : noLeidas}</span>}
      </button>
      {abierta && (
        <div className="campana-panel">
          <div className="fila espacio">
            <strong>Notificaciones</strong>
            {noLeidas > 0 && <button className="btn-link-oscuro" onClick={leerTodas}>Marcar todas como leídas</button>}
          </div>
          <ul>
            {lista.map((n) => (
              <li key={n.id} className={n.leida ? '' : 'no-leida'} onClick={() => abrir(n)}>
                <span className="icono">{ICONOS[n.tipo] ?? '🔔'}</span>
                <span>
                  <strong>{n.titulo}</strong>
                  {n.cuerpo && <small>{n.cuerpo}</small>}
                  <small>{fechaHora(n.creado_en)}</small>
                </span>
              </li>
            ))}
            {!lista.length && <li className="vacio">No tienes notificaciones.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
