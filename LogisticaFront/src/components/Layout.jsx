'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { CatalogosProvider } from '../context/CatalogosContext';
import Campana from './Campana';
import { activo, LINKS_GENERALES, MODULOS, pantallaActual } from './modulos';
import { nombresRoles, soloApp, tiene } from '../utils/roles';

/** Estructura del panel: protege las rutas por sesión y rol y muestra el menú lateral. */
export default function Layout({ children }) {
  const { usuario, cargando, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  // el menú lateral muestra las pantallas del módulo en el que se está
  const actual = pantallaActual(pathname);
  const modulo = MODULOS.find((m) => m.clave === actual?.modulo);
  const permitido = usuario && (pathname === '/' || !actual || tiene(usuario, ...actual.roles));
  const links = (modulo ? modulo.links : []).filter((l) => usuario && tiene(usuario, ...l.roles));
  const generales = LINKS_GENERALES.filter((l) => usuario && tiene(usuario, ...l.roles));

  useEffect(() => {
    if (cargando) return;
    if (!usuario) router.replace('/login');
    else if (!permitido) router.replace('/');
  }, [cargando, usuario, permitido, router]);

  if (!usuario) return <p className="centrado">Cargando…</p>;
  if (soloApp(usuario)) {
    return (
      <div className="login">
        <div className="tarjeta">
          <h1 className="logo">Logística<span>JStore</span></h1>
          <p>Hola {usuario.nombre}. Conductores y auxiliares usan la <strong>app móvil</strong> para ver sus rutas y registrar entregas.</p>
          <button onClick={logout}>Cerrar sesión</button>
        </div>
      </div>
    );
  }
  if (!permitido) return <p className="centrado">Redirigiendo…</p>;

  return (
    <CatalogosProvider>
      <div className="layout">
        <aside className="sidebar">
          <h1 className="logo">Logística<span>JStore</span></h1>
          <Campana />
          <nav>
            <Link href="/" className={pathname === '/' ? 'active' : 'menu-principal'}>{pathname === '/' ? '☰ Menú principal' : '← Menú principal'}</Link>
            {modulo && <p className="nav-modulo">{modulo.icono} {modulo.titulo}</p>}
            {links.map((l) => (
              <Link key={l.href} href={l.href} className={actual?.href === l.href ? 'active' : ''}>{l.label}</Link>
            ))}
            {generales.length > 0 && <p className="nav-modulo">⚙️ Administración</p>}
            {generales.map((l) => (
              <Link key={l.href} href={l.href} className={activo(pathname, l.href) ? 'active' : ''}>{l.label}</Link>
            ))}
          </nav>
          <div className="sidebar-usuario">
            <small>{usuario.nombre}<br />{nombresRoles(usuario)}</small>
            <button className="btn-link" onClick={logout}>Cerrar sesión</button>
          </div>
        </aside>
        <main className="contenido">{children}</main>
      </div>
    </CatalogosProvider>
  );
}
