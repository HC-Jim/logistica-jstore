// Un usuario puede tener varios perfiles (p. ej. Comercial y Almacén cuando apoya en despacho).
// `rol` es el perfil principal (el primero); `roles`, todos.

export const rolesDe = (u) => (u?.roles?.length ? u.roles : u?.rol ? [u.rol] : []);

/** ¿Tiene alguno de estos perfiles? */
export const tiene = (u, ...roles) => rolesDe(u).some((r) => roles.includes(r));

const LOGISTICA = ['admin', 'planificador'];

/** Comercial sin perfil de logística: solo ve y edita sus propias ventas (algunos campos). */
export const soloComercial = (u) => tiene(u, 'vendedor') && !tiene(u, ...LOGISTICA);

/** Almacén sin otro perfil que registre ventas: solo edita encargos logísticos. */
export const soloAlmacen = (u) => tiene(u, 'almacen') && !tiene(u, ...LOGISTICA, 'vendedor');

/** Conductor o auxiliar sin perfil de logística: solo ve sus propias rutas. */
export const soloEquipoRuta = (u) => tiene(u, 'repartidor', 'auxiliar') && !tiene(u, ...LOGISTICA, 'almacen');
