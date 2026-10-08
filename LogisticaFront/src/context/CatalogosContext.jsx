'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { catalogosApi } from '../api/services';

const CatalogosContext = createContext(null);
const orden = new Intl.Collator('es').compare; // "Áncash" junto a "Amazonas", no al final

/** Carga una sola vez las listas del formulario y los ubigeos del Perú. */
export function CatalogosProvider({ children }) {
  const [catalogos, setCatalogos] = useState(null);
  const [ubigeos, setUbigeos] = useState([]);

  useEffect(() => {
    catalogosApi.catalogos().then(setCatalogos).catch(() => {});
    catalogosApi.ubigeos().then(setUbigeos).catch(() => {});
  }, []);

  // Índices para los selectores en cascada
  const ubigeo = useMemo(() => {
    const porCodigo = new Map();
    const departamentos = new Set();
    const provincias = new Map(); // departamento → Set(provincia)
    const distritos = new Map(); // 'dep|prov' → [{ codigo, distrito }]
    for (const [codigo, dep, prov, dist] of ubigeos) {
      porCodigo.set(codigo, { codigo, departamento: dep, provincia: prov, distrito: dist });
      departamentos.add(dep);
      if (!provincias.has(dep)) provincias.set(dep, new Set());
      provincias.get(dep).add(prov);
      const k = `${dep}|${prov}`;
      if (!distritos.has(k)) distritos.set(k, []);
      distritos.get(k).push({ codigo, distrito: dist });
    }
    for (const lista of distritos.values()) lista.sort((a, b) => orden(a.distrito, b.distrito));
    return {
      porCodigo,
      departamentos: [...departamentos].sort(orden),
      provinciasDe: (dep) => [...(provincias.get(dep) ?? [])].sort(orden),
      distritosDe: (dep, prov) => distritos.get(`${dep}|${prov}`) ?? [],
    };
  }, [ubigeos]);

  return (
    <CatalogosContext.Provider value={{ catalogos, ubigeo, listo: Boolean(catalogos && ubigeos.length) }}>
      {children}
    </CatalogosContext.Provider>
  );
}

export const useCatalogos = () => useContext(CatalogosContext);
