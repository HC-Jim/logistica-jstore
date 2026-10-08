'use client';

import { AdvancedMarker, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { catalogosApi } from '../api/services';
import { hayMapsKey, Mapa, SinMapsKey } from './maps';

const redondear = ({ lat, lng }) => ({ lat: +Number(lat).toFixed(7), lng: +Number(lng).toFixed(7) });

/**
 * Ubicación exacta de entrega. Se puede:
 * - pegar el link de Google Maps que envía el cliente (incluye maps.app.goo.gl),
 * - buscar la dirección escrita,
 * - hacer clic en el mapa o arrastrar el marcador.
 */
export default function MapaSelector({ valor, onChange, direccion, link, onLink, disabled }) {
  const punto = valor?.lat != null && valor?.lng != null ? { lat: valor.lat, lng: valor.lng } : null;
  const [estado, setEstado] = useState('');

  async function usarLink() {
    if (!link) return;
    setEstado('Leyendo enlace…');
    try {
      const r = await catalogosApi.resolverUbicacion(link);
      onChange(redondear(r));
      setEstado('Ubicación tomada del enlace ✔');
    } catch (err) {
      setEstado(mensajeError(err));
    }
  }

  return (
    <div className="mapa-selector">
      <div className="fila">
        <input className="crece" placeholder="Link de ubicación (Google Maps / WhatsApp)" value={link ?? ''}
          disabled={disabled} onChange={(e) => onLink(e.target.value)} />
        <button type="button" className="btn-sec" onClick={usarLink} disabled={disabled || !link}>Usar link</button>
        {hayMapsKey && <BuscarDireccion direccion={direccion} disabled={disabled} onEncontrado={(p) => { onChange(p); setEstado('Ubicación tomada de la dirección; verifica el punto ✔'); }} onError={setEstado} />}
        {punto && !disabled && (
          <button type="button" className="btn-link-oscuro" onClick={() => { onChange({ lat: null, lng: null }); setEstado(''); }}>
            Quitar punto
          </button>
        )}
      </div>
      {estado && <small className="ayuda">{estado}</small>}

      {hayMapsKey ? (
        <Mapa alto={340} defaultCenter={punto ?? undefined} defaultZoom={punto ? 16 : 11}
          onClick={(e) => !disabled && e.detail.latLng && onChange(redondear(e.detail.latLng))}>
          {punto && (
            <AdvancedMarker position={punto} draggable={!disabled}
              onDragEnd={(e) => onChange(redondear({ lat: e.latLng.lat(), lng: e.latLng.lng() }))} />
          )}
          <Centrar punto={punto} />
        </Mapa>
      ) : (
        <SinMapsKey />
      )}
      <small className="ayuda">
        {punto ? `Punto: ${punto.lat}, ${punto.lng}${disabled ? '' : ' — arrastra el marcador para ajustar'}` : 'Sin ubicación: el pedido no se podrá agregar a una ruta.'}
      </small>
    </div>
  );
}

/** Centra el mapa cuando el punto cambia desde fuera (link o búsqueda). */
function Centrar({ punto }) {
  const map = useMap();
  const clave = punto ? `${punto.lat},${punto.lng}` : '';
  useEffect(() => {
    if (!map || !punto) return;
    if (!map.getBounds()?.contains(punto)) {
      map.setCenter(punto);
      map.setZoom(16);
    }
  }, [map, clave]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function BuscarDireccion({ direccion, onEncontrado, onError, disabled }) {
  const geocoding = useMapsLibrary('geocoding');
  async function buscar() {
    try {
      const { results } = await new geocoding.Geocoder().geocode({ address: direccion, region: 'pe' });
      const loc = results[0].geometry.location;
      onEncontrado(redondear({ lat: loc.lat(), lng: loc.lng() }));
    } catch {
      onError('No se encontró la dirección; marca el punto en el mapa.');
    }
  }
  return (
    <button type="button" className="btn-sec" onClick={buscar} disabled={disabled || !direccion || !geocoding}>
      Buscar dirección
    </button>
  );
}
