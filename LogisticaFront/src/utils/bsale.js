/** De dónde toma su precio cada lista de Bsale. */
export function textoFuente(l) {
  return {
    plataforma: `Plataforma ${l.plataforma ?? ''}`,
    normal: 'Precio normal',
    minimo_plataformas: 'Más bajo de las plataformas (sin Web)',
    ninguna: 'No se sincroniza',
  }[l.fuente] ?? l.fuente;
}

/** Precio que el sistema enviaría a una lista para un producto de la lista de precios (vigentes). */
export function precioSegunSistema(lista, fila, plataformas) {
  if (lista.fuente === 'plataforma') return fila.precios[lista.plataforma]?.precio != null ? Number(fila.precios[lista.plataforma].precio) : null;
  if (lista.fuente === 'normal') return fila.precio_normal != null ? Number(fila.precio_normal) : null;
  if (lista.fuente === 'minimo_plataformas') {
    const valores = plataformas.filter((p) => p.nombre !== 'Web').map((p) => fila.precios[p.nombre]?.precio).filter((v) => v != null).map(Number);
    return valores.length ? Math.min(...valores) : null;
  }
  return null;
}
