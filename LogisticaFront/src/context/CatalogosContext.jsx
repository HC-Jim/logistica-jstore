'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { catalogosApi } from '../api/services';

const CatalogosContext = createContext(null);
const orden = new Intl.Collator('es').compare; // "Áncash" junto a "Amazonas", no al final
/** Para comparar nombres: sin tildes, en minúsculas y sin prefijos como "Provincia de". */
const normal = (t) => (t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/^(provincia constitucional del?|provincia de|departamento de|region|municipalidad (metropolitana )?de)\s+/, '').trim();

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
    const porDistrito = new Map(); // nombre normalizado → [ubigeos]
    for (const u of porCodigo.values()) {
      const k = normal(u.distrito);
      if (!porDistrito.has(k)) porDistrito.set(k, []);
      porDistrito.get(k).push(u);
    }
    /** Ubigeo según el distrito y la provincia que indica Google; con nombres repetidos se prefiere la misma provincia y luego Lima o Callao. */
    const buscar = ({ distrito, provincia, departamento } = {}) => {
      const lista = porDistrito.get(normal(distrito)) ?? [];
      if (lista.length <= 1) return lista[0]?.codigo ?? null;
      const prov = normal(provincia);
      const dep = normal(departamento);
      const puntaje = (u) => (normal(u.provincia) === prov ? 4 : 0) + (normal(u.departamento) === dep ? 2 : 0)
        + (['lima', 'callao'].includes(normal(u.provincia)) ? 1 : 0);
      return [...lista].sort((a, b) => puntaje(b) - puntaje(a))[0].codigo;
    };
    return {
      porCodigo,
      buscar,
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
