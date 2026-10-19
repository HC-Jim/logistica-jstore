'use client';

import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { useEffect, useRef, useState } from 'react';
import { leerCoordenadas, ZONA_LIMA } from './MapaSelector';
import { hayMapsKey } from './maps';

/**
 * Campo de dirección con sugerencias de Google mientras se escribe (Places API New).
 * Al elegir una sugerencia devuelve la dirección, el punto exacto y el distrito/provincia que indica Google.
 * Si se escriben coordenadas, ofrece usarlas directamente.
 * Las búsquedas usan un token de sesión: Google cobra la sesión (escritura + elección), no cada tecla.
 */
export default function BuscadorDireccion({ value, onChange, onElegir, disabled, placeholder, autoFocus, maxLength = 255 }) {
  const places = useMapsLibrary('places');
  const [sugerencias, setSugerencias] = useState([]);
  const [abierto, setAbierto] = useState(false);
  const [activa, setActiva] = useState(-1);
  const [aviso, setAviso] = useState('');
  const token = useRef(null);
  const escrito = useRef(false); // solo se busca cuando la persona escribe, no cuando el valor llega desde fuera
  const caja = useRef(null);

  const coords = leerCoordenadas(value);

  useEffect(() => {
    if (!hayMapsKey || !places || !escrito.current || coords) { setSugerencias([]); return undefined; }
    const texto = (value ?? '').trim();
    if (texto.length < 3) { setSugerencias([]); return undefined; }
    let vigente = true;
    const t = setTimeout(async () => {
      try {
        token.current ??= new places.AutocompleteSessionToken();
        const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: texto, sessionToken: token.current, includedRegionCodes: ['pe'], locationBias: ZONA_LIMA, language: 'es', region: 'pe',
        });
        if (!vigente) return;
        setSugerencias(suggestions.filter((s) => s.placePrediction).slice(0, 6));
        setActiva(-1);
        setAviso('');
      } catch (err) {
        if (!vigente) return;
        setSugerencias([]);
        setAviso(/not (been )?(enabled|activated)|PERMISSION|REQUEST_DENIED|ApiNotActivated/i.test(String(err?.message ?? err))
          ? 'Las sugerencias de Google no están activas: habilita "Places API (New)" en la clave de Maps.'
          : 'No se pudieron traer sugerencias; escribe la dirección y marca el punto en el mapa.');
      }
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [places, value]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const place = s.placePrediction.toPlace();
      await place.fetchFields({ fields: ['formattedAddress', 'location', 'addressComponents'] });
      token.current = null; // la sesión termina al pedir el detalle del lugar
      const comp = (tipo) => place.addressComponents?.find((c) => c.types.includes(tipo))?.longText ?? null;
      // dirección sin el país ni el código postal, como se escribe en Perú
      const direccion = (place.formattedAddress ?? s.placePrediction.text.text)
        .replace(/,?\s*Per[uú]\s*$/i, '').replace(/\s\d{5}(?=,|$)/, '').trim();
      onElegir?.({
        direccion,
        lat: +place.location.lat().toFixed(7),
        lng: +place.location.lng().toFixed(7),
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
            <li key={s.placePrediction.placeId} className={i === activa ? 'activa' : ''} role="option" aria-selected={i === activa}
              onMouseEnter={() => setActiva(i)} onMouseDown={(e) => { e.preventDefault(); elegir(s); }}>
              <span className="pin">📍</span>
              <span><strong>{s.placePrediction.mainText?.text ?? s.placePrediction.text.text}</strong> <small>{s.placePrediction.secondaryText?.text ?? ''}</small></span>
            </li>
          ))}
          {!coords && <li className="pie">con tecnología de Google</li>}
        </ul>
      )}
      {aviso && <small className="ayuda">{aviso}</small>}
    </div>
  );
}
