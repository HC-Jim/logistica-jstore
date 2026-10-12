// Módulos del sistema y sus pantallas. El backend aplica los mismos permisos por rol.

export const MODULOS = [
  {
    clave: 'logistica',
    titulo: 'Logística',
    icono: '🚚',
    descripcion: 'Pedidos, rutas, despacho, monitoreo en vivo de conductores y reportes.',
    links: [
      { href: '/logistica', label: 'Dashboard', roles: ['admin', 'planificador'] },
      { href: '/monitoreo', label: 'Monitoreo', roles: ['admin', 'planificador', 'almacen', 'vendedor'] },
      { href: '/pedidos', label: 'Pedidos', roles: ['admin', 'planificador', 'almacen', 'vendedor'] },
      { href: '/rutas', label: 'Rutas', roles: ['admin', 'planificador'] },
      { href: '/despacho', label: 'Despacho', roles: ['admin', 'planificador', 'almacen'] },
      { href: '/vehiculos', label: 'Vehículos', roles: ['admin', 'planificador'] },
      { href: '/ubicaciones', label: 'Ubicaciones', roles: ['admin', 'planificador', 'almacen', 'vendedor'] },
      { href: '/reportes', label: 'Reportes', roles: ['admin', 'planificador'] },
    ],
  },
  {
    clave: 'productos',
    titulo: 'Productos',
    icono: '📦',
    descripcion: 'Catálogo de SKU, generador de SKU, combos, categorías y marcas.',
    links: [
      { href: '/productos', label: 'Catálogo de SKU', roles: ['admin', 'planificador', 'almacen', 'vendedor', 'catalogo'] },
      { href: '/productos/categorias', label: 'Categorías', roles: ['admin', 'catalogo', 'planificador', 'vendedor', 'almacen'] },
      { href: '/productos/marcas', label: 'Marcas', roles: ['admin', 'catalogo', 'planificador', 'vendedor', 'almacen'] },
    ],
  },
  {
    clave: 'precios',
    titulo: 'Precios',
    icono: '💲',
    descripcion: 'Precios por plataforma e historial, consultor de precios y descuentos mayoristas.',
    proximamente: true,
    links: [],
  },
];

/** Pantallas que no pertenecen a un módulo (administración). */
export const LINKS_GENERALES = [
  { href: '/usuarios', label: 'Usuarios', roles: ['admin'] },
];

export const TODOS_LOS_LINKS = [...MODULOS.flatMap((m) => m.links.map((l) => ({ ...l, modulo: m.clave }))), ...LINKS_GENERALES];

export const activo = (pathname, href) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));

/** Pantalla actual (la coincidencia más específica) y su módulo. */
export function pantallaActual(pathname) {
  return TODOS_LOS_LINKS.filter((l) => activo(pathname, l.href)).sort((a, b) => b.href.length - a.href.length)[0] ?? null;
}

/** Módulos que el usuario puede abrir. `puede(roles)` dice si tiene alguno de esos perfiles. */
export const modulosDe = (puede) => MODULOS
  .map((m) => ({ ...m, links: m.links.filter((l) => puede(l.roles)) }))
  .filter((m) => m.proximamente || m.links.length);
