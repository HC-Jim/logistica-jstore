'use client';

import { useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { mensajeError } from '../api/client';
import { estadisticasApi } from '../api/services';
import { ESTADOS, fechaCorta, soles } from '../utils/format';

function Barras({ datos, clave = 'pedidos', nombre = 'Pedidos', color = '#2b6cb0', alto = 260 }) {
  return (
    <ResponsiveContainer width="100%" height={alto}>
      <BarChart data={datos} layout="vertical" margin={{ left: 10, right: 20 }}>
        <XAxis type="number" fontSize={12} allowDecimals={false} />
        <YAxis type="category" dataKey="nombre" width={130} fontSize={12} />
        <Tooltip formatter={(v) => (clave === 'ventas' ? soles(v) : v)} />
        <Bar dataKey={clave} name={nombre} fill={color} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function Dashboard() {
  const [dias, setDias] = useState(30);
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    estadisticasApi.dashboard(dias).then(setD).catch((e) => setError(mensajeError(e)));
  }, [dias]);

  if (error) return <p className="error">{error}</p>;
  if (!d) return <p>Cargando estadísticas…</p>;

  const { resumen: r, hoy } = d;
  const efectividad = r.entregados + r.incidencias ? Math.round((r.entregados / (r.entregados + r.incidencias)) * 100) : null;
  const estados = d.porEstado.map((e) => ({ name: ESTADOS[e.estado]?.label ?? e.estado, value: e.cantidad, color: ESTADOS[e.estado]?.color }));
  const porDia = d.porDia.map((x) => ({ ...x, dia: fechaCorta(x.fecha).slice(0, 5) }));

  return (
    <>
      <div className="encabezado">
        <h2>Dashboard</h2>
        <select value={dias} onChange={(e) => setDias(Number(e.target.value))}>
          <option value={7}>Últimos 7 días</option>
          <option value={30}>Últimos 30 días</option>
          <option value={90}>Últimos 90 días</option>
        </select>
      </div>

      <h3>Hoy</h3>
      <div className="kpis">
        <div className={`kpi ${hoy.sin_rutear ? 'kpi-alerta' : ''}`}><small>Sin rutear</small><strong>{hoy.sin_rutear}</strong></div>
        <div className="kpi"><small>Ruteados</small><strong>{hoy.ruteados}</strong></div>
        <div className="kpi"><small>Entregados</small><strong>{hoy.entregados}</strong></div>
        <div className={`kpi ${hoy.incidencias ? 'kpi-alerta' : ''}`}><small>Incidencias</small><strong>{hoy.incidencias}</strong></div>
      </div>

      <h3>Del {fechaCorta(d.desde)} al {fechaCorta(d.hasta)} (por fecha de entrega)</h3>
      <div className="kpis">
        <div className="kpi"><small>Pedidos</small><strong>{r.pedidos}</strong></div>
        <div className="kpi"><small>Ventas (sin cancelados)</small><strong>{soles(r.ventas)}</strong></div>
        <div className="kpi"><small>Ingresos por envío</small><strong>{soles(r.envios)}</strong></div>
        <div className="kpi"><small>Efectividad de entrega</small><strong>{efectividad == null ? '—' : `${efectividad}%`}</strong></div>
        <div className="kpi"><small>Cancelados</small><strong>{r.cancelados}</strong></div>
      </div>

      <div className="grid-2">
        <section className="tarjeta">
          <h3>Pedidos y ventas por día</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={porDia}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="dia" fontSize={12} />
              <YAxis yAxisId="p" fontSize={12} allowDecimals={false} />
              <YAxis yAxisId="v" orientation="right" fontSize={12} />
              <Tooltip formatter={(v, n) => (n === 'Ventas' ? soles(v) : v)} />
              <Legend />
              <Line yAxisId="p" type="monotone" dataKey="pedidos" name="Pedidos" stroke="#2b6cb0" strokeWidth={2} dot={false} />
              <Line yAxisId="v" type="monotone" dataKey="ventas" name="Ventas" stroke="#2f855a" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </section>

        <section className="tarjeta">
          <h3>Pedidos por estado</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={estados} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} label>
                {estados.map((e) => <Cell key={e.name} fill={e.color} />)}
              </Pie>
              <Legend />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </section>

        <section className="tarjeta"><h3>Por plataforma</h3><Barras datos={d.porPlataforma} /></section>
        <section className="tarjeta"><h3>Por tipo de pedido</h3><Barras datos={d.porTipo} color="#6b46c1" /></section>
        <section className="tarjeta"><h3>Ventas por vendedor</h3><Barras datos={d.porVendedor} clave="ventas" nombre="Ventas" color="#2f855a" /></section>
        <section className="tarjeta"><h3>Distritos con más pedidos</h3><Barras datos={d.topDistritos} color="#dd6b20" /></section>
      </div>

      <section className="tarjeta" style={{ marginTop: 18 }}>
        <h3>Productos más vendidos</h3>
        <table>
          <thead><tr><th>SKU</th><th>Producto</th><th>Unidades</th><th>Ventas</th></tr></thead>
          <tbody>
            {d.topProductos.map((p) => (
              <tr key={p.sku}><td>{p.sku}</td><td>{p.descripcion}</td><td>{p.unidades}</td><td>{soles(p.ventas)}</td></tr>
            ))}
            {!d.topProductos.length && <tr><td colSpan={4}>Sin datos</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
