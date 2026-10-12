'use client';

import { useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { preciosApi } from '../api/services';
import ProductoBuscador from '../components/ProductoBuscador';
import { useAuth } from '../context/AuthContext';
import { useCatalogos } from '../context/CatalogosContext';
import { soles } from '../utils/format';
import { tiene } from '../utils/roles';

const GRUPOS = { propias: 'Marcas propias (Evox, Vibra+, Importado, Greenwon…)', otras: 'Resto de marcas' };
const rango = (t) => (t.hasta == null ? `${t.desde} a + und` : `${t.desde} a ${t.hasta} und`);

/** Descuentos mayoristas por tipo de cliente y cantidad, y calculadora del precio final. */
export default function PreciosDescuentos() {
  const { usuario } = useAuth();
  const catalogos = useCatalogos().catalogos ?? {};
  const tipos = catalogos.tiposCliente ?? ['Común / Final', 'Empresa', 'Mayorista'];
  const puedeEditar = tiene(usuario, 'admin', 'catalogo');
  const [tramos, setTramos] = useState([]);
  const [editando, setEditando] = useState(null); // { grupo, filas }
  const [calc, setCalc] = useState({ producto: null, tipo: 'Común / Final', cantidad: 2 });
  const [error, setError] = useState('');

  const cargar = () => preciosApi.descuentos().then(setTramos).catch((e) => setError(mensajeError(e)));
  useEffect(() => { cargar(); }, []);

  async function guardar() {
    setError('');
    try {
      setTramos(await preciosApi.guardarDescuentos(editando.grupo, editando.filas.map((f) => ({
        tipo_cliente: f.tipo_cliente, desde: Number(f.desde), hasta: f.hasta === '' || f.hasta == null ? null : Number(f.hasta), porcentaje: Number(f.porcentaje),
      }))));
      setEditando(null);
    } catch (err) {
      setError(mensajeError(err));
    }
  }

  // calculadora
  const grupoCalc = calc.producto ? (calc.producto.marca_propia ? 'propias' : 'otras') : null;
  const tramoCalc = grupoCalc && tramos.find((t) => t.grupo === grupoCalc && t.tipo_cliente === calc.tipo
    && Number(calc.cantidad) >= t.desde && (t.hasta == null || Number(calc.cantidad) <= t.hasta));
  const precioBase = calc.producto ? Number(calc.producto.precios?.Web?.precio ?? calc.producto.precio_web_ficha ?? 0) : 0;
  const porcentaje = tramoCalc ? Number(tramoCalc.porcentaje) : 0;
  const unitario = precioBase * (1 - porcentaje / 100);

  async function elegirProducto(p) {
    try {
      const [v] = await preciosApi.vigentes({ producto_id: p.id, todos: 1 });
      setCalc((c) => ({ ...c, producto: v }));
    } catch (err) {
      setError(mensajeError(err));
    }
  }

  return (
    <>
      <h2>Descuentos mayoristas</h2>
      {error && <p className="error">{error}</p>}

      <section className="tarjeta">
        <h3>Calculadora</h3>
        <div className="fila filtros">
          <div className="crece"><ProductoBuscador onSeleccionar={elegirProducto} /></div>
          <select value={calc.tipo} onChange={(e) => setCalc({ ...calc, tipo: e.target.value })}>{tipos.map((t) => <option key={t}>{t}</option>)}</select>
          <label>Cantidad <input type="number" min="1" step="1" value={calc.cantidad} onChange={(e) => setCalc({ ...calc, cantidad: e.target.value })} style={{ width: 80 }} /></label>
        </div>
        {calc.producto && (
          <div className="resumen-reporte">
            <div><strong>{calc.producto.sku}</strong><small>{calc.producto.descripcion}</small></div>
            <div><strong>{calc.producto.marca ?? '—'}</strong><small>{grupoCalc === 'propias' ? 'marca propia' : 'otra marca'}</small></div>
            <div><strong>{soles(precioBase)}</strong><small>precio Web vigente</small></div>
            <div><strong>{porcentaje} %</strong><small>{tramoCalc ? `${calc.tipo} · ${rango(tramoCalc)}` : 'sin descuento para esa cantidad'}</small></div>
            <div><strong>{soles(unitario)}</strong><small>precio unitario final</small></div>
            <div><strong>{soles(unitario * Number(calc.cantidad || 0))}</strong><small>total ({calc.cantidad} und)</small></div>
          </div>
        )}
      </section>

      {Object.entries(GRUPOS).map(([grupo, titulo]) => {
        const delGrupo = tramos.filter((t) => t.grupo === grupo);
        const enEdicion = editando?.grupo === grupo;
        return (
          <section key={grupo} className="tarjeta">
            <div className="fila espacio">
              <h3>{titulo}</h3>
              {puedeEditar && !enEdicion && <button className="btn-sec" onClick={() => setEditando({ grupo, filas: delGrupo.map((t) => ({ ...t, hasta: t.hasta ?? '' })) })}>Editar tramos</button>}
            </div>
            {!enEdicion ? (
              <table>
                <thead><tr><th>Tipo de cliente</th><th>Descuento según cantidad</th></tr></thead>
                <tbody>
                  {tipos.map((tipo) => (
                    <tr key={tipo}>
                      <td><strong>{tipo}</strong></td>
                      <td className="tramos">
                        {delGrupo.filter((t) => t.tipo_cliente === tipo).sort((a, b) => a.desde - b.desde).map((t) => (
                          <span key={t.id} className="tramo"><small>{rango(t)}</small><strong>{Number(t.porcentaje)} %</strong></span>
                        ))}
                        {!delGrupo.some((t) => t.tipo_cliente === tipo) && <small>Sin descuento</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <>
                <table>
                  <thead><tr><th>Tipo de cliente</th><th>Desde (und)</th><th>Hasta (und, vacío = en adelante)</th><th>Descuento %</th><th /></tr></thead>
                  <tbody>
                    {editando.filas.map((f, i) => {
                      const cambiar = (campo, valor) => setEditando({ ...editando, filas: editando.filas.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)) });
                      return (
                        <tr key={i}>
                          <td><select value={f.tipo_cliente} onChange={(e) => cambiar('tipo_cliente', e.target.value)}>{tipos.map((t) => <option key={t}>{t}</option>)}</select></td>
                          <td><input type="number" min="1" value={f.desde} onChange={(e) => cambiar('desde', e.target.value)} style={{ width: 80 }} /></td>
                          <td><input type="number" min="1" value={f.hasta} onChange={(e) => cambiar('hasta', e.target.value)} style={{ width: 80 }} /></td>
                          <td><input type="number" min="0" max="100" step="0.1" value={f.porcentaje} onChange={(e) => cambiar('porcentaje', e.target.value)} style={{ width: 80 }} /></td>
                          <td><button className="btn-mini btn-peligro" onClick={() => setEditando({ ...editando, filas: editando.filas.filter((_, j) => j !== i) })}>✕</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="fila">
                  <button className="btn-sec" onClick={() => setEditando({ ...editando, filas: [...editando.filas, { tipo_cliente: tipos[0], desde: '', hasta: '', porcentaje: '' }] })}>+ Tramo</button>
                  <button onClick={guardar}>Guardar</button>
                  <button className="btn-sec" onClick={() => { setEditando(null); cargar(); }}>Cancelar</button>
                </div>
              </>
            )}
          </section>
        );
      })}
    </>
  );
}
