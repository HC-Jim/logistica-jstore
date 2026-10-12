'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { mensajeError } from '../api/client';
import { preciosApi } from '../api/services';
import { fechaCorta, soles } from '../utils/format';

/** Dashboard del módulo Precios: cobertura por plataforma, descuentos y cambios recientes. */
export default function PreciosDashboard() {
  const [dias, setDias] = useState(30);
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { preciosApi.dashboard(dias).then(setD).catch((e) => setError(mensajeError(e))); }, [dias]);

  if (error) return <p className="error">{error}</p>;
  if (!d) return <p>Cargando dashboard…</p>;
  const a = d.alertas;
  const web = d.cobertura.find((c) => c.nombre === 'Web');
  return (
    <>
      <div className="encabezado">
        <h2>Dashboard de Precios</h2>
        <select value={dias} onChange={(e) => setDias(Number(e.target.value))}>
          {[7, 30, 90, 365].map((n) => <option key={n} value={n}>Últimos {n} días</option>)}
        </select>
      </div>

      <div className="kpis">
        <div className="tarjeta kpi"><small>Cambios de precio ({dias} días)</small><strong>{a.cambios_periodo}</strong></div>
        <div className="tarjeta kpi"><small>Cobertura Web</small><strong>{web?.cobertura ?? 0} %</strong><small>{web?.skus ?? 0} de {a.activos} SKU</small></div>
        <div className="tarjeta kpi"><small>Descuento promedio Web</small><strong>{web?.descuento ?? '—'} %</strong><small>frente al precio normal</small></div>
        <div className={`tarjeta kpi ${a.sin_precio_web ? 'kpi-alerta' : ''}`}><small>SKU activos sin precio Web</small><strong>{a.sin_precio_web}</strong></div>
        <div className={`tarjeta kpi ${a.precio_antiguo ? 'kpi-alerta' : ''}`}><small>Precio Web sin cambios en +180 días</small><strong>{a.precio_antiguo}</strong></div>
      </div>

      <div className="grid-graficos">
        <section className="tarjeta">
          <h3>Cobertura del catálogo por plataforma</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={d.cobertura} layout="vertical" margin={{ left: 10, right: 20 }}>
              <XAxis type="number" domain={[0, 100]} unit=" %" fontSize={12} />
              <YAxis type="category" dataKey="nombre" width={90} fontSize={12} />
              <Tooltip formatter={(v) => `${v} %`} />
              <Bar dataKey="cobertura" name="SKU con precio" fill="#2b6cb0" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
        <section className="tarjeta">
          <h3>Descuento promedio por plataforma</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={d.cobertura} layout="vertical" margin={{ left: 10, right: 20 }}>
              <XAxis type="number" unit=" %" fontSize={12} />
              <YAxis type="category" dataKey="nombre" width={90} fontSize={12} />
              <Tooltip formatter={(v) => `${v} %`} />
              <Bar dataKey="descuento" name="Descuento vs. normal" fill="#dd6b20" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
      </div>

      <section className="tarjeta">
        <h3>Cambios de precio por día</h3>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={d.porDia} margin={{ left: 0, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="dia" tickFormatter={fechaCorta} fontSize={12} />
            <YAxis allowDecimals={false} fontSize={12} />
            <Tooltip labelFormatter={fechaCorta} />
            <Line type="monotone" dataKey="cambios" name="Precios registrados" stroke="#2b6cb0" dot={false} />
            <Line type="monotone" dataKey="skus" name="SKU distintos" stroke="#2f855a" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      <section className="tarjeta">
        <div className="fila espacio"><h3>Últimos cambios</h3><Link href="/precios/reportes">Ver reporte completo →</Link></div>
        <table>
          <thead><tr><th>Fecha</th><th>SKU</th><th>Producto</th><th>Plataforma</th><th className="num">Antes</th><th className="num">Ahora</th></tr></thead>
          <tbody>
            {d.ultimos.map((u, i) => (
              <tr key={i}>
                <td>{fechaCorta(u.fecha)}</td><td>{u.sku}</td><td>{u.descripcion}</td><td>{u.plataforma}</td>
                <td className="num">{u.anterior != null ? soles(u.anterior) : '—'}</td>
                <td className={`num ${u.anterior != null && Number(u.precio) < Number(u.anterior) ? 'baja' : 'sube'}`}>{soles(u.precio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
