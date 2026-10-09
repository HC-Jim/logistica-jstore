'use client';

import Link from 'next/link';
import Papa from 'papaparse';
import { useRef, useState } from 'react';
import { mensajeError } from '../api/client';
import { pedidosApi } from '../api/services';
import { useAuth } from '../context/AuthContext';
import { useCatalogos } from '../context/CatalogosContext';
import { descargarCsv } from '../utils/csv';
import { fechaCorta } from '../utils/format';

const EJEMPLO = [
  { grupo: 'P1', plataforma: 'Mercado Libre', numero_pedido: '2000123', documento_bsale: 'BA01-300', tipo: 'Delivery', fecha_entrega: '15/10/2026', cliente: 'Ana Torres', telefono: '987654321', distrito: 'Miraflores', direccion: 'Av. Larco 123', referencia: 'Frente al parque', ubicacion: '-12.1219, -77.0297', sku: 'SKU-1', cantidad: '2', cobrar: 'Cobrar Total', medio_pago: 'Efectivo' },
  { grupo: 'P1', sku: 'SKU-2', cantidad: '1', precio: '15.50' },
  { grupo: 'P2', plataforma: 'Web', tipo: 'Agencia', fecha_entrega: '15/10/2026', cliente: 'Luis Rojas', telefono: '912345678', agencia: 'Shalom', enviar_a: 'Sede de Agencia', pago_agencia: 'Pago destino', departamento: 'Arequipa', provincia: 'Arequipa', distrito: 'Cayma', direccion: 'Calle Real 45', sku: 'SKU-1', cantidad: '1' },
];

/** Carga masiva de ventas desde un CSV: revisar, corregir y registrar. */
export default function PedidoImportar() {
  const { usuario } = useAuth();
  const catalogos = useCatalogos().catalogos ?? {}; // vacío mientras cargan
  const archivo = useRef(null);
  const [nombre, setNombre] = useState('');
  const [filas, setFilas] = useState(null);
  const [revision, setRevision] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState('');

  async function plantilla() {
    const { columnas } = await pedidosApi.plantilla();
    descargarCsv('plantilla-pedidos.csv', columnas.map((c) => ({ titulo: c, valor: (f) => f[c] ?? '' })), EJEMPLO);
  }

  function leer(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setNombre(f.name);
    setRevision(null);
    setResultado(null);
    setError('');
    // Excel guarda "CSV" en Windows-1252; si las tildes llegan rotas, se vuelve a leer con esa codificación
    const parsear = (encoding) => Papa.parse(f, {
      header: true, skipEmptyLines: 'greedy', encoding, transformHeader: (h) => h.trim(),
      complete: ({ data }) => {
        if (encoding === 'UTF-8' && JSON.stringify(data).includes('�')) return parsear('windows-1252');
        setFilas(data);
        revisar(data);
      },
      error: (err) => setError(err.message),
    });
    parsear('UTF-8');
  }

  async function revisar(datos) {
    setTrabajando(true);
    try {
      setRevision(await pedidosApi.importar(datos, false));
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setTrabajando(false);
    }
  }

  async function confirmar() {
    setTrabajando(true);
    try {
      const r = await pedidosApi.importar(filas, true);
      if (r.confirmado) setResultado(r);
      else setRevision(r);
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setTrabajando(false);
    }
  }

  const errores = revision?.errores ?? [];
  return (
    <>
      <div className="encabezado">
        <h2>Importar pedidos (CSV)</h2>
        <div className="fila">
          <Link className="btn-sec" href="/pedidos">← Pedidos</Link>
        </div>
      </div>

      <section className="tarjeta">
        <h3>1. Prepara el archivo</h3>
        <p>
          Una <strong>fila por producto</strong>. Las filas con el mismo <code>grupo</code> (o el mismo <code>numero_pedido</code>) forman un solo
          pedido; sus datos se toman de la primera fila. Guarda desde Excel como <em>CSV (delimitado por comas o punto y coma)</em>.
        </p>
        <ul className="ayuda-import">
          <li>Obligatorios: <code>plataforma</code>, <code>tipo</code>, <code>fecha_entrega</code> (DD/MM/AAAA), <code>cliente</code>, <code>sku</code>, <code>cantidad</code>.</li>
          <li><code>precio</code> es opcional: si se deja vacío se usa el del catálogo. <code>total</code> vacío = productos + envío.</li>
          <li>Distrito: basta el nombre si es de Lima o Callao (Surco, SJL, SMP…). Para provincias, llena también departamento y provincia.</li>
          <li><code>ubicacion</code>: coordenadas (<code>-12.12, -77.03</code>) o link de Google Maps.</li>
          {usuario.rol !== 'vendedor' && <li><code>vendedor</code>: correo del vendedor (vacío = tú).</li>}
          <li>Solo se aceptan valores de las listas del sistema (sin importar mayúsculas ni tildes):
            <details>
              <summary>ver listas permitidas</summary>
              <p><strong>plataforma:</strong> {catalogos.plataformas?.join(', ')}</p>
              <p><strong>tipo:</strong> {(catalogos.tiposPorCategoria?.venta ?? []).join(', ')}</p>
              <p><strong>agencia:</strong> {catalogos.agencias?.join(', ')}</p>
              <p><strong>enviar_a:</strong> {catalogos.enviarA?.join(', ')} · <strong>pago_agencia:</strong> {catalogos.pagoAgencia?.join(', ')}</p>
              <p><strong>cobrar:</strong> {catalogos.cobrar?.join(', ')}</p>
              <p><strong>medio_pago:</strong> {catalogos.mediosPago?.join(', ')}</p>
            </details>
          </li>
        </ul>
        <button className="btn-sec" onClick={plantilla}>⬇ Descargar plantilla con ejemplo</button>
      </section>

      <section className="tarjeta">
        <h3>2. Sube el archivo</h3>
        <input ref={archivo} type="file" accept=".csv,text/csv" hidden onChange={leer} />
        <div className="fila">
          <button onClick={() => archivo.current.click()} disabled={trabajando}>Elegir CSV…</button>
          {nombre && <span>{nombre} · {filas?.length ?? 0} fila(s)</span>}
          {trabajando && <span>Revisando…</span>}
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      {resultado ? (
        <section className="tarjeta">
          <h3>✔ Se registraron {resultado.creados.length} pedido(s)</h3>
          <p>Códigos: {resultado.creados.map((id) => <Link key={id} href={`/pedidos/${id}`}>#{id} </Link>)}</p>
          <Link className="btn" href="/pedidos">Ver pedidos</Link>
        </section>
      ) : revision && (
        <section className="tarjeta">
          <h3>3. Revisión</h3>
          {revision.advertencias?.map((a) => <p key={a} className="aviso">{a}</p>)}
          {errores.length > 0 ? (
            <>
              <p className="error">Hay {errores.length} problema(s). Corrige el archivo y súbelo de nuevo: no se registra nada hasta que todo esté correcto.</p>
              <table>
                <thead><tr><th>Fila</th><th>Problema</th></tr></thead>
                <tbody>{errores.map((e, i) => <tr key={i}><td>{e.fila ?? '—'}</td><td>{e.mensaje}</td></tr>)}</tbody>
              </table>
            </>
          ) : (
            <p className="ok">Todo correcto: {revision.pedidos.length} pedido(s) listos para registrar.</p>
          )}
          <table>
            <thead><tr><th>Filas</th><th>Cliente</th><th>Plataforma / tipo</th><th>Entrega</th><th>Productos</th><th>Ubicación</th><th>Avisos</th></tr></thead>
            <tbody>
              {revision.pedidos.map((p) => (
                <tr key={p.fila} className={errores.some((e) => e.fila === p.fila) ? 'con-error' : ''}>
                  <td>{p.filas.join(', ')}</td>
                  <td>{p.cliente}</td>
                  <td>{p.plataforma ?? '—'}<small>{p.tipo}</small></td>
                  <td>{fechaCorta(p.fecha_entrega)}</td>
                  <td>{p.lineas}</td>
                  <td>{p.ubicado ? '✔' : <span className="error">sin punto</span>}</td>
                  <td><small>{p.avisos.join(' · ')}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!errores.length && revision.pedidos.length > 0 && (
            <button onClick={confirmar} disabled={trabajando}>{trabajando ? 'Registrando…' : `Registrar ${revision.pedidos.length} pedido(s)`}</button>
          )}
        </section>
      )}
    </>
  );
}
