'use client';

import Link from 'next/link';
import { modulosDe } from '../components/modulos';
import { useAuth } from '../context/AuthContext';

/** Menú principal: los módulos a los que el usuario tiene acceso. */
export default function MenuPrincipal() {
  const { usuario } = useAuth();
  const modulos = modulosDe(usuario.rol);
  return (
    <>
      <div className="encabezado"><h2>Hola, {usuario.nombre.split(' ')[0]}</h2></div>
      <p>Elige un módulo:</p>
      <div className="modulos">
        {modulos.map((m) => (m.proximamente ? (
          <div key={m.clave} className="tarjeta modulo deshabilitado">
            <span className="modulo-icono">{m.icono}</span>
            <h3>{m.titulo}</h3>
            <p>{m.descripcion}</p>
            <small className="etiqueta">Próximamente</small>
          </div>
        ) : (
          <Link key={m.clave} href={m.links[0].href} className="tarjeta modulo">
            <span className="modulo-icono">{m.icono}</span>
            <h3>{m.titulo}</h3>
            <p>{m.descripcion}</p>
            <small>{m.links.map((l) => l.label).join(' · ')}</small>
          </Link>
        )))}
      </div>
    </>
  );
}
