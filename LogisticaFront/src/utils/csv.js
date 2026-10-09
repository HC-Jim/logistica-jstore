/**
 * Descarga una tabla como CSV para Excel en español: separador ";" y BOM para que se vean las tildes.
 * columnas: [{ titulo, valor(fila) }]
 */
export function descargarCsv(nombreArchivo, columnas, filas) {
  const celda = (v) => {
    const t = v == null ? '' : String(v);
    return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lineas = [columnas.map((c) => c.titulo), ...filas.map((f) => columnas.map((c) => c.valor(f)))];
  const csv = '﻿' + lineas.map((l) => l.map(celda).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(a.href);
}
