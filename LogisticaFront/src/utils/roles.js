// Igual que en la API: un usuario puede tener varios perfiles; `rol` es el principal.
import { ROLES } from './format';

export const rolesDe = (u) => (u?.roles?.length ? u.roles : u?.rol ? [u.rol] : []);

/** ¿Tiene alguno de estos perfiles? */
export const tiene = (u, ...roles) => rolesDe(u).some((r) => roles.includes(r));

/** Comercial sin perfil de logística: solo sus propias ventas. */
export const soloComercial = (u) => tiene(u, 'vendedor') && !tiene(u, 'admin', 'planificador');

/** Conductor o auxiliar sin perfil web: usa la app móvil. */
export const soloApp = (u) => rolesDe(u).every((r) => ['repartidor', 'auxiliar'].includes(r));

/** "Comercial · Almacén" */
export const nombresRoles = (u) => rolesDe(u).map((r) => ROLES[r] ?? r).join(' · ');
