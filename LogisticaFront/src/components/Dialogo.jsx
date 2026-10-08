'use client';

import { useState } from 'react';

/**
 * Ventana modal simple con un formulario.
 * `campos`: [{ nombre, etiqueta, tipo: 'text'|'date'|'textarea', requerido, valor }]
 */
export default function Dialogo({ titulo, campos, textoBoton = 'Aceptar', peligro, onAceptar, onCerrar }) {
  const [valores, setValores] = useState(Object.fromEntries(campos.map((c) => [c.nombre, c.valor ?? ''])));
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      await onAceptar(valores);
      onCerrar();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <form className="modal tarjeta" onSubmit={enviar}>
        <h3>{titulo}</h3>
        {campos.map((c) => (
          <label key={c.nombre}>
            {c.etiqueta}
            {c.tipo === 'textarea' ? (
              <textarea rows={3} required={c.requerido} value={valores[c.nombre]}
                onChange={(e) => setValores({ ...valores, [c.nombre]: e.target.value })} />
            ) : (
              <input type={c.tipo ?? 'text'} required={c.requerido} value={valores[c.nombre]}
                onChange={(e) => setValores({ ...valores, [c.nombre]: e.target.value })} />
            )}
          </label>
        ))}
        {error && <p className="error">{error}</p>}
        <div className="fila">
          <button className={peligro ? 'btn-peligro-solido' : ''} disabled={enviando}>{textoBoton}</button>
          <button type="button" className="btn-sec" onClick={onCerrar}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}
