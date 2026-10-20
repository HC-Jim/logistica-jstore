'use client';

import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { useEffect, useRef, useState } from 'react';
import { leerCoordenadas, ZONA_LIMA } from './MapaSelector';
import { hayMapsKey } from './maps';

// Si Places API (New) no está habilitada en la clave, se deja de intentar (hasta recargar) y se usa Geocoding
let placesNoDisponible = false;

const limpiar = (dir) => (dir ?? '').replace(/,?\s*Per[uú]\s*$/i, '').replace(/\s\d{5}(?=,|$)/, '').trim();
const separar = (texto) => {
  const i = texto.indexOf(',');
  return i < 0 ? [texto, ''] : [texto.slice(0, i), texto.slice(i + 1).trim()];
};

/**
 * Campo de dirección con sugerencias de Google mientras se escribe, como en Shipday.
 * - Usa Places API (New) (autocompletado con token de sesión: Google cobra la sesión, no cada tecla).
 * - Si esa API no está habilitada en la clave, sugiere con Geocoding (menos preciso para textos incompletos).
 * Al elegir devuelve la dirección, el punto exacto y el distrito/provincia que indica Google.
 * Si se escriben coordenadas, ofrece usarlas directamente.
 */
export default function BuscadorDireccion({ value, onChange, onElegir, disabled, placeholder, autoFocus, maxLength = 255 }) {
  const places = useMapsLibrary('places');
  const geocoding = useMapsLibrary('geocoding');
  const [sugerencias, setSugerencias] = useState([]); // { id, principal, secundario, prediccion?, resultado? }
  const [abierto, setAbierto] = useState(false);
  const [activa, setActiva] = useState(-1);
  const [aviso, setAviso] = useState('');
  const token = useRef(null);
  const escrito = useRef(false); // solo se busca cuando la persona escribe, no cuando el valor llega desde fuera
  const caja = useRef(null);

  const coords = leerCoordenadas(value);

  async function conPlaces(texto) {
    token.current ??= new places.AutocompleteSessionToken();
    const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: texto, sessionToken: token.current, includedRegionCodes: ['pe'], locationBias: ZONA_LIMA, language: 'es', region: 'pe',
    });
    return suggestions.filter((s) => s.placePrediction).slice(0, 6).map((s) => ({
      id: s.placePrediction.placeId,
      principal: s.placePrediction.mainText?.text ?? s.placePrediction.text.text,
      secundario: s.placePrediction.secondaryText?.text ?? '',
      prediccion: s.placePrediction,
    }));
  }

  async function conGeocoding(texto) {
    const { results } = await new geocoding.Geocoder().geocode({
      address: texto, region: 'pe', bounds: ZONA_LIMA, componentRestrictions: { country: 'PE' }, language: 'es',
    });
    return results.slice(0, 6).map((r) => {
      const [principal, secundario] = separar(limpiar(r.formatted_address));
      return { id: r.place_id, principal, secundario, resultado: r };
    });
  }

  useEffect(() => {
    if (!hayMapsKey || !escrito.current || coords) { setSugerencias([]); return undefined; }
    const texto = (value ?? '').trim();
    const usarPlaces = places && !placesNoDisponible;
    if (texto.length < (usarPlaces ? 3 : 4) || (!usarPlaces && !geocoding)) { setSugerencias([]); return undefined; }
    let vigente = true;
    const t = setTimeout(async () => {
      try {
        let lista;
        if (usarPlaces) {
          try {
            lista = await conPlaces(texto);
          } catch (err) {
            const m = String(err?.message ?? err);
            if (!/has not been used|disabled|not (been )?(enabled|activated)|PERMISSION|REQUEST_DENIED|ApiNotActivated|not authorized/i.test(m) || !geocoding) throw err;
            placesNoDisponible = true; // la API no está habilitada: se sigue con Geocoding
            lista = await conGeocoding(texto);
          }
        } else {
          lista = await conGeocoding(texto);
        }
        if (!vigente) return;
        setSugerencias(lista);
        setActiva(-1);
        setAviso(placesNoDisponible
          ? 'Sugerencias básicas (Geocoding). Para sugerencias como en Shipday, habilita “Places API (New)” en Google Cloud.'
          : '');
      } catch (err) {
        if (!vigente) return;
        setSugerencias([]);
        setAviso(err?.code === 'ZERO_RESULTS' || /ZERO_RESULTS/.test(String(err?.message))
          ? 'Sin coincidencias: escribe más de la dirección (calle, número, distrito) o marca el punto en el mapa.'
          : 'No se pudieron traer sugerencias; escribe la dirección y marca el punto en el mapa.');
      }
    }, placesNoDisponible ? 450 : 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [places, geocoding, value]); // eslint-disable-line react-hooks/exhaustive-deps

  // cerrar la lista al hacer clic fuera
  useEffect(() => {
    const fuera = (e) => { if (caja.current && !caja.current.contains(e.target)) setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, []);

  async function elegir(s) {
    setAbierto(false);
    setSugerencias([]);
    escrito.current = false;
    try {
      let direccion;
      let loc;
      let comp;
      if (s.prediccion) {
        const place = s.prediccion.toPlace();
        await place.fetchFields({ fields: ['formattedAddress', 'location', 'addressComponents'] });
        token.current = null; // la sesión termina al pedir el detalle del lugar
        direccion = limpiar(place.formattedAddress ?? s.prediccion.text.text);
        loc = place.location;
        comp = (tipo) => place.addressComponents?.find((c) => c.types.includes(tipo))?.longText ?? null;
      } else {
        const r = s.resultado;
        direccion = limpiar(r.formatted_address);
        loc = r.geometry.location;
        comp = (tipo) => r.address_components?.find((c) => c.types.includes(tipo))?.long_name ?? null;
      }
      onElegir?.({
        direccion,
        lat: +loc.lat().toFixed(7),
        lng: +loc.lng().toFixed(7),
        distrito: comp('locality') ?? comp('administrative_area_level_3') ?? comp('sublocality'),
        provincia: comp('administrative_area_level_2'),
        departamento: comp('administrative_area_level_1'),
        cod_postal: comp('postal_code'),
      });
    } catch {
      token.current = null;
      setAviso('No se pudo obtener la ubicación de esa sugerencia; marca el punto en el mapa.');
    }
  }

  function usarCoordenadas() {
    setAbierto(false);
    escrito.current = false;
    onChange(''); // el campo queda libre para escribir la dirección; las coordenadas van al punto
    onElegir?.({ lat: +coords.lat.toFixed(7), lng: +coords.lng.toFixed(7), soloPunto: true });
  }

  const opciones = coords ? [{ coords: true }] : sugerencias;

  function teclado(e) {
    if (!abierto || !opciones.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiva((i) => (i + 1) % opciones.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiva((i) => (i <= 0 ? opciones.length - 1 : i - 1)); }
    else if (e.key === 'Enter') {
      // con la lista abierta, Enter elige (la marcada o la primera) en vez de enviar el formulario
      e.preventDefault();
      if (coords) usarCoordenadas(); else elegir(opciones[Math.max(activa, 0)]);
    } else if (e.key === 'Escape') { e.preventDefault(); setAbierto(false); }
  }

  return (
    <div className="buscador-direccion" ref={caja}>
      <input
        value={value ?? ''} maxLength={maxLength} disabled={disabled} autoFocus={autoFocus} autoComplete="off"
        placeholder={placeholder ?? (hayMapsKey ? 'Escribe la dirección y elige una sugerencia…' : 'Dirección')}
        onChange={(e) => { escrito.current = true; setAbierto(true); onChange(e.target.value); }}
        onFocus={() => setAbierto(true)} onKeyDown={teclado}
      />
      {abierto && !disabled && opciones.length > 0 && (
        <ul className="sugerencias" role="listbox">
          {coords ? (
            <li className={activa === 0 ? 'activa' : ''} onMouseDown={(e) => { e.preventDefault(); usarCoordenadas(); }}>
              📍 Usar las coordenadas <strong>{coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}</strong>
            </li>
          ) : sugerencias.map((s, i) => (
            <li key={s.id} className={i === activa ? 'activa' : ''} role="option" aria-selected={i === activa}
              onMouseEnter={() => setActiva(i)} onMouseDown={(e) => { e.preventDefault(); elegir(s); }}>
              <span className="pin">📍</span>
              <span><strong>{s.principal}</strong> <small>{s.secundario}</small></span>
            </li>
          ))}
          {!coords && <li className="pie">con tecnología de Google</li>}
        </ul>
      )}
      {aviso && <small className="ayuda">{aviso}</small>}
    </div>
  );
}
