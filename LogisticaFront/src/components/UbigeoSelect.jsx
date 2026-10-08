'use client';

import { useEffect, useState } from 'react';
import { useCatalogos } from '../context/CatalogosContext';

/** Departamento → Provincia → Distrito. `valor` y `onChange` usan el código de distrito (ubigeo). */
export default function UbigeoSelect({ valor, onChange, disabled }) {
  const { ubigeo } = useCatalogos();
  const actual = valor ? ubigeo.porCodigo.get(valor) : null;
  const [dep, setDep] = useState(actual?.departamento ?? 'Lima');
  const [prov, setProv] = useState(actual?.provincia ?? 'Lima');

  // Sincroniza cuando llega el valor (edición) o terminan de cargar los ubigeos
  useEffect(() => {
    if (actual) {
      setDep(actual.departamento);
      setProv(actual.provincia);
    }
  }, [actual?.codigo]); // eslint-disable-line react-hooks/exhaustive-deps

  const provincias = ubigeo.provinciasDe(dep);
  const distritos = ubigeo.distritosDe(dep, prov);

  return (
    <>
      <label>
        Departamento
        <select value={dep} disabled={disabled}
          onChange={(e) => { setDep(e.target.value); setProv(''); onChange(null); }}>
          {ubigeo.departamentos.map((d) => <option key={d}>{d}</option>)}
        </select>
      </label>
      <label>
        Provincia
        <select value={prov} disabled={disabled}
          onChange={(e) => { setProv(e.target.value); onChange(null); }}>
          <option value="">Selecciona…</option>
          {provincias.map((p) => <option key={p}>{p}</option>)}
        </select>
      </label>
      <label>
        Distrito
        <select value={valor ?? ''} disabled={disabled || !prov} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Selecciona…</option>
          {distritos.map((d) => <option key={d.codigo} value={d.codigo}>{d.distrito}</option>)}
        </select>
      </label>
    </>
  );
}
