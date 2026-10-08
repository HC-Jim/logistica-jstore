'use client';

import { useEffect, useRef, useState } from 'react';
import { productosApi } from '../api/services';
import { soles } from '../utils/format';

/** Busca un producto escribiendo su SKU o parte de la descripción. */
export default function ProductoBuscador({ seleccionado, onSeleccionar, disabled }) {
  const [texto, setTexto] = useState('');
  const [opciones, setOpciones] = useState([]);
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const caja = useRef(null);

  useEffect(() => {
    if (!abierto || texto.trim().length < 2) {
      setOpciones([]);
      return;
    }
    const t = setTimeout(() => {
      productosApi.listar({ q: texto.trim(), activos: true, limite: 15 }).then((r) => {
        setOpciones(r);
        setActivo(0);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [texto, abierto]);

  useEffect(() => {
    const cerrar = (e) => { if (!caja.current?.contains(e.target)) setAbierto(false); };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, []);

  function elegir(p) {
    onSeleccionar(p);
    setTexto('');
    setAbierto(false);
  }

  function teclado(e) {
    if (!opciones.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivo((a) => Math.min(a + 1, opciones.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((a) => Math.max(a - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); elegir(opciones[activo]); }
    if (e.key === 'Escape') setAbierto(false);
  }

  return (
    <div className="buscador" ref={caja}>
      <input
        disabled={disabled}
        placeholder={seleccionado ? `${seleccionado.sku} · ${seleccionado.descripcion}` : 'SKU o descripción…'}
        value={texto}
        onFocus={() => setAbierto(true)}
        onChange={(e) => { setTexto(e.target.value); setAbierto(true); }}
        onKeyDown={teclado}
        className={seleccionado && !texto ? 'con-valor' : ''}
      />
      {abierto && opciones.length > 0 && (
        <ul className="opciones">
          {opciones.map((p, i) => (
            <li key={p.id} className={i === activo ? 'activo' : ''}
              onMouseDown={(e) => { e.preventDefault(); elegir(p); }}>
              <strong>{p.sku}</strong> {p.descripcion}
              <span>{soles(p.precio)}</span>
            </li>
          ))}
        </ul>
      )}
      {abierto && texto.trim().length >= 2 && !opciones.length && <ul className="opciones"><li className="vacio">Sin resultados</li></ul>}
    </div>
  );
}
