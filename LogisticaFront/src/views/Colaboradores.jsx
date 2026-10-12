'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { rrhhApi } from '../api/services';
import { useAuth } from '../context/AuthContext';
import { useCatalogos } from '../context/CatalogosContext';
import { diasHasta, fechaCorta, soles } from '../utils/format';
import { tiene } from '../utils/roles';

/** Lista del personal con alertas de vencimiento. El jefe de área ve solo a su equipo (sin sueldos). */
export default function Colaboradores() {
  const { usuario } = useAuth();
  const esRrhh = tiene(usuario, 'admin', 'rrhh');
  const areas = useCatalogos().catalogos?.areas ?? [];
  const [filtros, setFiltros] = useState({ q: '', area: '', estado: 'activos' });
  const [lista, setLista] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      const params = Object.fromEntries(Object.entries(filtros).filter(([, v]) => v));
      rrhhApi.colaboradores(params).then(setLista).catch((e) => setError(mensajeError(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [filtros]);

  return (
    <>
      <div className="encabezado">
        <h2>{esRrhh ? 'Colaboradores' : 'Mi equipo'}</h2>
        {esRrhh && <Link href="/rrhh/colaboradores/nuevo" className="btn">+ Nuevo colaborador</Link>}
      </div>
      <div className="tarjeta fila filtros">
        <input className="crece" placeholder="Buscar por nombre, documento o cargo…" value={filtros.q} onChange={(e) => setFiltros({ ...filtros, q: e.target.value })} />
        <select value={filtros.area} onChange={(e) => setFiltros({ ...filtros, area: e.target.value })}>
          <option value="">Todas las áreas</option>
          {areas.map((a) => <option key={a}>{a}</option>)}
        </select>
        <select value={filtros.estado} onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}>
          <option value="activos">Activos</option><option value="cesados">Cesados</option><option value="todos">Todos</option>
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      <section className="tarjeta tabla-scroll">
        <table>
          <thead>
            <tr>
              <th>Colaborador</th><th>Cargo</th><th>Área</th><th>Jefe</th><th>Ingreso</th><th>Contrato</th>
              {esRrhh && <th className="num">Sueldo</th>}<th>Usuario</th><th>Alertas</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((c) => (
              <tr key={c.id} className={c.activo ? '' : 'inactivo'}>
                <td><Link href={`/rrhh/colaboradores/${c.id}`}><strong>{c.nombre_completo}</strong></Link>{esRrhh && <><br /><small>{c.tipo_documento} {c.numero_documento}</small></>}</td>
                <td>{c.cargo}</td><td>{c.area}</td><td>{c.jefe_nombre ?? '—'}</td>
                <td>{fechaCorta(c.fecha_ingreso)}</td>
                <td>{c.tipo_contrato}{c.contrato_fin && <><br /><small>hasta {fechaCorta(c.contrato_fin)}</small></>}</td>
                {esRrhh && <td className="num">{soles(c.sueldo)}</td>}
                <td>{c.usuario_email ?? <small>Sin usuario</small>}</td>
                <td>
                  {!c.activo && <small>Cesado {fechaCorta(c.fecha_cese)}</small>}
                  {c.alertas?.map((a) => {
                    const d = diasHasta(a.vence);
                    return <div key={a.concepto} className={d < 0 ? 'error' : 'pendiente-texto'}><small>⚠ {a.concepto}: {d < 0 ? `venció hace ${-d} d` : `vence en ${d} d`}</small></div>;
                  })}
                </td>
              </tr>
            ))}
            {!lista.length && <tr><td colSpan={9}>No hay colaboradores con esos filtros.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
