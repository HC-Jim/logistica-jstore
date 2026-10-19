'use client';

import { AdvancedMarker, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { useEffect, useState } from 'react';
import BuscadorDireccion from './BuscadorDireccion';
import { hayMapsKey, LIMA, Mapa } from './maps';

const redondear = (lat, lng) => ({ lat: +Number(lat).toFixed(7), lng: +Number(lng).toFixed(7) });

/**
 * Ventana para ubicar el punto de entrega, como en Shipday:
 * buscar la dirección (con sugerencias) o hacer clic / arrastrar el marcador en el mapa.
 * Al mover el punto muestra la dirección más cercana según Google.
 */
export default function UbicacionModal({ punto: inicial, direccion: direccionInicial, onCerrar, onConfirmar }) {
  const [punto, setPunto] = useState(inicial?.lat != null ? { lat: inicial.lat, lng: inicial.lng } : null);
  const [texto, setTexto] = useState(direccionInicial ?? '');
  const [elegido, setElegido] = useState(null); // datos de la sugerencia elegida (distrito, provincia…)
  const [cercana, setCercana] = useState('');
  const geocoding = useMapsLibrary('geocoding');

  // dirección aproximada del punto (al hacer clic o arrastrar)
  useEffect(() => {
    if (!hayMapsKey || !geocoding || !punto) { setCercana(''); return undefined; }
    let vigente = true;
    new geocoding.Geocoder().geocode({ location: punto, language: 'es' })
      .then(({ results }) => { if (vigente) setCercana(results[0]?.formatted_address?.replace(/,?\s*Per[uú]\s*$/i, '') ?? ''); })
      .catch(() => { if (vigente) setCercana(''); });
    return () => { vigente = false; };
  }, [geocoding, punto?.lat, punto?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onCerrar();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onCerrar]);

  function marcar(lat, lng) {
    setPunto(redondear(lat, lng));
    setElegido(null); // el punto ya no es el de la sugerencia
  }

  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="modal modal-mapa tarjeta">
        <div className="fila espacio"><h3>Ubicar punto de entrega</h3><button type="button" className="btn-link-oscuro" onClick={onCerrar}>✕</button></div>
        <BuscadorDireccion autoFocus value={texto} onChange={setTexto}
          onElegir={(r) => { if (r.direccion) setTexto(r.direccion); setPunto({ lat: r.lat, lng: r.lng }); setElegido(r.soloPunto ? null : r); }} />
        <Mapa alto={420} defaultCenter={punto ?? LIMA} defaultZoom={punto ? 17 : 11}
          onClick={(e) => e.detail.latLng && marcar(e.detail.latLng.lat, e.detail.latLng.lng)}>
          {punto && <AdvancedMarker position={punto} draggable onDragEnd={(e) => marcar(e.latLng.lat(), e.latLng.lng())} />}
          <Enfocar punto={punto} />
        </Mapa>
        <small className="ayuda">
          {punto
            ? <>Punto: {punto.lat}, {punto.lng}{cercana && <> · cerca de <strong>{cercana}</strong></>} — arrastra el marcador o haz clic en el mapa para ajustarlo.</>
            : 'Busca la dirección arriba o haz clic en el mapa para marcar el punto.'}
        </small>
        <div className="fila">
          <button type="button" disabled={!punto}
            onClick={() => onConfirmar({ ...punto, direccion: texto.trim() || cercana || '', datos: elegido })}>
            Usar esta ubicación
          </button>
          <button type="button" className="btn-sec" onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

/** Lleva el mapa al punto cuando llega desde la búsqueda. */
function Enfocar({ punto }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !punto) return;
    if (!map.getBounds()?.contains(punto) || map.getZoom() < 15) { map.setCenter(punto); map.setZoom(17); }
  }, [map, punto?.lat, punto?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
