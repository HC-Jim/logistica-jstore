'use client';

import { useState } from 'react';
import PreciosCargaMasiva from './PreciosCargaMasiva';
import PreciosConsultar from './PreciosConsultar';

/** Registrar precios: uno por uno (buscando el SKU) o de forma masiva con la plantilla de Excel. */
export default function PreciosRegistrar() {
  const [modo, setModo] = useState('individual');
  return (
    <>
      <div className="encabezado"><h2>Registrar precios</h2></div>
      <div className="pestanas">
        <button className={modo === 'individual' ? 'activo' : ''} onClick={() => setModo('individual')}>Individual</button>
        <button className={modo === 'masivo' ? 'activo' : ''} onClick={() => setModo('masivo')}>Masivo (plantilla Excel)</button>
      </div>
      {modo === 'individual' ? <PreciosConsultar modoRegistro /> : <PreciosCargaMasiva />}
    </>
  );
}
