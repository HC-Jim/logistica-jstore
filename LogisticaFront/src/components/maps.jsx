'use client';

import { AdvancedMarker, Map, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { useEffect } from 'react';

export const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || 'DEMO_MAP_ID';
export const LIMA = { lat: -12.046374, lng: -77.042793 };
export const hayMapsKey = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);

export function SinMapsKey() {
  return (
    <div className="aviso">
      Configura <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> para ver el mapa.
    </div>
  );
}

/** Mapa base con estilos y valores por defecto del proyecto. */
export function Mapa({ children, alto = 420, ...props }) {
  if (!hayMapsKey) return <SinMapsKey />;
  return (
    <div className="mapa" style={{ height: alto }}>
      <Map mapId={MAP_ID} defaultCenter={LIMA} defaultZoom={12} gestureHandling="greedy" {...props}>
        {children}
      </Map>
    </div>
  );
}

/** Marcador circular con número o texto. */
export function MarcadorNumero({ position, texto, color = '#2b6cb0', title, onClick }) {
  return (
    <AdvancedMarker position={position} title={title} onClick={onClick}>
      <div className="marcador" style={{ background: color }}>{texto}</div>
    </AdvancedMarker>
  );
}

/** Ajusta el zoom del mapa para que se vean todos los puntos. */
export function AjustarVista({ puntos, clave: claveExterna }) {
  const map = useMap();
  // con `clave` solo se reajusta cuando ella cambia (p. ej. al elegir otra ruta), no en cada actualización
  const clave = claveExterna ?? JSON.stringify(puntos);
  useEffect(() => {
    if (!map || !puntos.length || !window.google) return;
    if (puntos.length === 1) {
      map.setCenter(puntos[0]);
      map.setZoom(15);
      return;
    }
    const bounds = new window.google.maps.LatLngBounds();
    puntos.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, clave]);
  return null;
}

/** Mantiene el mapa centrado en un punto que se mueve (p. ej. el conductor). */
export function Seguir({ punto }) {
  const map = useMap();
  const clave = punto ? `${punto.lat},${punto.lng}` : '';
  useEffect(() => {
    if (map && punto) map.panTo(punto);
  }, [map, clave]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Dibuja una polilínea codificada (formato de Google Routes API). */
export function Polilinea({ codificada, color = '#2b6cb0' }) {
  const map = useMap();
  const geometry = useMapsLibrary('geometry');
  useEffect(() => {
    if (!map || !geometry || !codificada) return;
    const linea = new window.google.maps.Polyline({
      path: geometry.encoding.decodePath(codificada),
      map,
      strokeColor: color,
      strokeOpacity: 0.85,
      strokeWeight: 5,
    });
    return () => linea.setMap(null);
  }, [map, geometry, codificada, color]);
  return null;
}

/** Línea a partir de una lista de puntos (p. ej. el recorrido GPS real del repartidor). */
export function LineaPuntos({ puntos, color = '#805ad5' }) {
  const map = useMap();
  const clave = puntos.length ? `${puntos.length}-${puntos[puntos.length - 1].lat}` : '';
  useEffect(() => {
    if (!map || puntos.length < 2) return;
    const linea = new window.google.maps.Polyline({
      path: puntos.map((p) => ({ lat: p.lat, lng: p.lng })),
      map,
      strokeColor: color,
      strokeOpacity: 0,
      icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, scale: 3 }, offset: '0', repeat: '12px' }],
    });
    return () => linea.setMap(null);
  }, [map, clave, color]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
