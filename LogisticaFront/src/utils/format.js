export const soles = (n) =>
  new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(n ?? 0);

export const hoyISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());

/** 'YYYY-MM-DD' → 'DD/MM/YY' */
export const fechaCorta = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '');

export const fechaHora = (iso) =>
  iso ? new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Lima' }) : '';

export const ESTADOS = {
  pendiente: { label: 'Sin rutear', color: '#718096' },
  ruteado: { label: 'Ruteado', color: '#2b6cb0' },
  entregado: { label: 'Entregado', color: '#2f855a' },
  incidencia: { label: 'Incidencia', color: '#c05621' },
  cancelado: { label: 'Cancelado', color: '#c53030' },
};

export const ESTADOS_RUTA = {
  planificada: { label: 'Planificada', color: '#718096' },
  en_curso: { label: 'En curso', color: '#2b6cb0' },
  finalizada: { label: 'Finalizada', color: '#2f855a' },
};

export const ESTADOS_PARADA = {
  pendiente: { label: 'Pendiente', color: '#718096' },
  completada: { label: 'Completada', color: '#2f855a' },
  incidencia: { label: 'Incidencia', color: '#c05621' },
};

export const ROLES = {
  admin: 'Administrador',
  vendedor: 'Vendedor',
  planificador: 'Planificador',
  almacen: 'Almacén',
  repartidor: 'Conductor',
  auxiliar: 'Auxiliar logístico',
};

export const km = (m) => (m == null ? '—' : `${(m / 1000).toFixed(1)} km`);

export const duracion = (s) => {
  if (s == null) return '—';
  const h = Math.floor(s / 3600);
  const min = Math.round((s % 3600) / 60);
  return h ? `${h} h ${min} min` : `${min} min`;
};

/** "hace 3 min" */
export const hace = (iso) => {
  if (!iso) return '';
  const seg = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  if (seg < 60) return `hace ${seg} s`;
  if (seg < 3600) return `hace ${Math.round(seg / 60)} min`;
  return `hace ${Math.round(seg / 3600)} h`;
};
