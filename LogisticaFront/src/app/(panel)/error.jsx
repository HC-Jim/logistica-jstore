'use client';

import { useEffect } from 'react';

/**
 * Error en una pantalla del panel. Si el sistema se actualizó mientras la pestaña estaba
 * abierta, faltan archivos de la versión anterior: se recarga sola. Si es otro error, se muestra.
 */
export default function ErrorPanel({ error, reset }) {
  const versionNueva = /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i
    .test(`${error?.name} ${error?.message}`);

  useEffect(() => {
    if (versionNueva) window.location.reload();
    else console.error(error);
  }, [error, versionNueva]);

  if (versionNueva) return <p>Se publicó una versión nueva del sistema. Recargando…</p>;
  return (
    <section className="tarjeta">
      <h2>Ocurrió un error en esta pantalla</h2>
      <p>Envía una captura de este mensaje a soporte:</p>
      <pre className="error-detalle">{error?.message ?? String(error)}{error?.digest ? `\n(ref. ${error.digest})` : ''}</pre>
      <div className="fila">
        <button onClick={() => reset()}>Reintentar</button>
        <button className="btn-sec" onClick={() => window.location.reload()}>Recargar página</button>
      </div>
    </section>
  );
}
