'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { rutasApi } from '../api/services';
import EstadoBadge from '../components/EstadoBadge';
import { ESTADOS_RUTA, fechaCorta, hoyISO, VEHICULOS } from '../utils/format';

/** Rutas del día con el avance de despacho (pedidos entregados al conductor por almacén). */
export default function Despacho() {
  const [fecha, setFecha] = useState(hoyISO());
  const [rutas, setRutas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setCargando(true);
    rutasApi.listar(fecha)
      .then((r) => { setRutas(r); setError(''); })
      .catch((e) => setError(mensajeError(e)))
      .finally(() => setCargando(false));
  }, [fecha]);

  return (
    <>
      <div className="encabezado">
        <h2>Despacho del {fechaCorta(fecha)}</h2>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </div>
      <p>Revisa cada hoja de ruta y marca los pedidos que entregas al conductor. Así no sale ningún vehículo con pedidos faltantes.</p>
      {error && <p className="error">{error}</p>}

      <div className="grid-rutas">
        {rutas.map((r) => {
          const falta = Number(r.pedidos) - Number(r.despachados);
          const v = VEHICULOS[r.vehiculo_tipo];
          return (
            <section key={r.id} className={`tarjeta ruta-slot ${falta ? 'despacho-falta' : 'despacho-ok'}`}>
              <div className="fila espacio">
                <h3>Ruta {r.numero}</h3>
                <EstadoBadge estado={r.estado} mapa={ESTADOS_RUTA} />
              </div>
              <p className="ruta-equipo">
                {v ? `${v.icono} ${r.vehiculo_nombre}` : 'Sin vehículo'}<br />
                👤 {r.repartidor_nombre ?? 'Sin conductor'}{r.asistente_nombre && ` · ${r.asistente_nombre}`}
              </p>
              <div className="barra-avance" title="Despachados al conductor">
                <span style={{ width: `${r.pedidos ? (r.despachados / r.pedidos) * 100 : 0}%` }} />
              </div>
              <strong>{r.despachados}/{r.pedidos} despachados</strong>
              {falta > 0
                ? <small className="error">Faltan {falta} por entregar al conductor</small>
                : r.pedidos > 0 && <small>✔ Todo entregado al conductor</small>}
              <Link className="btn" href={`/despacho/${r.id}`}>Abrir hoja de ruta</Link>
            </section>
          );
        })}
      </div>
      {!cargando && !rutas.length && <p className="aviso">No hay rutas abiertas para esta fecha.</p>}
    </>
  );
}
