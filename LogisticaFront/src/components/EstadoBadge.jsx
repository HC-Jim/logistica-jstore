import { ESTADOS } from '../utils/format';

/** Etiqueta de color. `mapa` permite usarla con estados de ruta o de parada. */
export default function EstadoBadge({ estado, mapa = ESTADOS }) {
  const e = mapa[estado] ?? { label: estado || '—', color: '#666' };
  return (
    <span className="badge" style={{ background: `${e.color}1a`, color: e.color }}>
      {e.label}
    </span>
  );
}
