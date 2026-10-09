'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { CatalogosProvider } from '../context/CatalogosContext';
import Campana from './Campana';
import { ROLES } from '../utils/format';

// Menú y páginas permitidas por rol (el backend aplica los mismos permisos)
const LINKS = [
  { href: '/', label: 'Dashboard', roles: ['admin', 'planificador'] },
  { href: '/monitoreo', label: 'Monitoreo', roles: ['admin', 'planificador', 'almacen'] },
  { href: '/pedidos', label: 'Pedidos', roles: ['admin', 'planificador', 'almacen', 'vendedor'] },
  { href: '/rutas', label: 'Rutas', roles: ['admin', 'planificador'] },
  { href: '/despacho', label: 'Despacho', roles: ['admin', 'planificador', 'almacen'] },
  { href: '/vehiculos', label: 'Vehículos', roles: ['admin', 'planificador'] },
  { href: '/ubicaciones', label: 'Ubicaciones', roles: ['admin', 'planificador', 'almacen', 'vendedor'] },
  { href: '/productos', label: 'Productos', roles: ['admin', 'planificador', 'almacen', 'vendedor'] },
  { href: '/usuarios', label: 'Usuarios', roles: ['admin'] },
];

/** Página de inicio de cada rol. */
export const INICIO = { admin: '/', planificador: '/', almacen: '/despacho', vendedor: '/pedidos' };

const activo = (pathname, href) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

/** Estructura del panel: protege las rutas por sesión y rol y muestra el menú lateral. */
export default function Layout({ children }) {
  const { usuario, cargando, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const links = LINKS.filter((l) => usuario && l.roles.includes(usuario.rol));
  const actual = LINKS.filter((l) => activo(pathname, l.href)).sort((a, b) => b.href.length - a.href.length)[0];
  const permitido = usuario && (!actual || actual.roles.includes(usuario.rol));

  useEffect(() => {
    if (cargando) return;
    if (!usuario) router.replace('/login');
    else if (!permitido && INICIO[usuario.rol]) router.replace(INICIO[usuario.rol]);
  }, [cargando, usuario, permitido, router]);

  if (!usuario) return <p className="centrado">Cargando…</p>;
  if (['repartidor', 'auxiliar'].includes(usuario.rol)) {
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
            {links.map((l) => (
              <Link key={l.href} href={l.href} className={activo(pathname, l.href) ? 'active' : ''}>{l.label}</Link>
            ))}
          </nav>
          <div className="sidebar-usuario">
            <small>{usuario.nombre}<br />{ROLES[usuario.rol]}</small>
            <button className="btn-link" onClick={logout}>Cerrar sesión</button>
          </div>
        </aside>
        <main className="contenido">{children}</main>
      </div>
    </CatalogosProvider>
  );
}
