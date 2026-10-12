'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { mensajeError } from '../api/client';
import { productosApi } from '../api/services';
import { fechaHora, soles } from '../utils/format';

const COLORES = ['#2b6cb0', '#2f855a', '#dd6b20', '#6b46c1', '#c53030', '#00838f', '#b7791f', '#718096'];

function Barras({ datos, alto = 280, color = '#2b6cb0' }) {
  return (
    <ResponsiveContainer width="100%" height={alto}>
      <BarChart data={datos} layout="vertical" margin={{ left: 10, right: 20 }}>
        <XAxis type="number" fontSize={12} allowDecimals={false} />
        <YAxis type="category" dataKey="nombre" width={170} fontSize={12} interval={0} />
        <Tooltip />
        <Bar dataKey="cantidad" name="SKU" radius={[0, 4, 4, 0]}>
          {datos.map((d, i) => <Cell key={i} fill={d.propia ? '#2f855a' : color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function Torta({ datos }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={datos} dataKey="cantidad" nameKey="nombre" outerRadius={85} label={(e) => e.cantidad}>
          {datos.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Dashboard del módulo Productos: estado del catálogo y lo más vendido. */
export default function ProductosDashboard() {
  const [dias, setDias] = useState(30);
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { productosApi.dashboard(dias).then(setD).catch((e) => setError(mensajeError(e))); }, [dias]);

  if (error) return <p className="error">{error}</p>;
  if (!d) return <p>Cargando dashboard…</p>;
  const r = d.resumen;
  return (
    <>
      <div className="encabezado">
        <h2>Dashboard de Productos</h2>
        <select value={dias} onChange={(e) => setDias(Number(e.target.value))}>
          {[7, 30, 90, 365].map((n) => <option key={n} value={n}>Últimos {n} días</option>)}
        </select>
      </div>

      <div className="kpis">
        <div className="tarjeta kpi"><small>SKU activos</small><strong>{r.activos}</strong><small>{r.total} en total</small></div>
        <div className="tarjeta kpi"><small>Combos</small><strong>{r.combos}</strong></div>
        <Link href="/productos/reclasificar" className={`tarjeta kpi ${r.sin_categoria ? 'kpi-alerta' : ''}`}><small>Sin categoría nueva</small><strong>{r.sin_categoria}</strong><small>Reclasificar →</small></Link>
        <div className={`tarjeta kpi ${r.sin_precio ? 'kpi-alerta' : ''}`}><small>Sin precio Web</small><strong>{r.sin_precio}</strong></div>
        <div className={`tarjeta kpi ${r.sin_medidas ? 'kpi-alerta' : ''}`}><small>Sin medidas</small><strong>{r.sin_medidas}</strong></div>
        <div className="tarjeta kpi"><small>SKU creados ({dias} días)</small><strong>{r.nuevos}</strong></div>
      </div>

      <div className="grid-graficos">
        <section className="tarjeta"><h3>Por categoría <small>(solo SKU ya clasificados)</small></h3><Barras datos={d.porCategoria} alto={340} /></section>
        <section className="tarjeta"><h3>Por marca <small>(verde = propia)</small></h3><Barras datos={d.porMarca} alto={340} /></section>
        <section className="tarjeta"><h3>Estado de sourcing</h3><Torta datos={d.porSourcing} /><Leyenda datos={d.porSourcing} /></section>
        <section className="tarjeta"><h3>Verificación física</h3><Torta datos={d.porVerificacion} /><Leyenda datos={d.porVerificacion} /></section>
      </div>

      <div className="grid-graficos">
        <section className="tarjeta">
          <h3>Más vendidos (últimos {dias} días)</h3>
          <table>
            <thead><tr><th>SKU</th><th>Producto</th><th className="num">Unid.</th><th className="num">Monto</th></tr></thead>
            <tbody>
              {d.masVendidos.map((p) => <tr key={p.sku}><td>{p.sku}</td><td>{p.nombre}</td><td className="num">{p.unidades}</td><td className="num">{soles(p.monto)}</td></tr>)}
              {!d.masVendidos.length && <tr><td colSpan={4}>Sin ventas en el periodo.</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="tarjeta">
          <h3>SKU recientes</h3>
          <table>
            <tbody>
              {d.recientes.map((p) => (
                <tr key={p.id}><td><Link href={`/productos/${p.id}`}><strong>{p.sku}</strong></Link></td><td>{p.descripcion}<small>{p.tipo}</small></td><td><small>{fechaHora(p.creado_en)}</small></td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

function Leyenda({ datos }) {
  return (
    <div className="fila leyenda">
      {datos.map((x, i) => <span key={x.nombre}><span className="punto" style={{ background: COLORES[i % COLORES.length] }} /> {x.nombre} ({x.cantidad})</span>)}
    </div>
  );
}
