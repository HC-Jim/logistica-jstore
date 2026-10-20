import { env } from '../config/env.js';

/*
 * Planificación de rutas: hora estimada de llegada (ETA) por parada, franjas horarias de entrega
 * y reparto automático de pedidos entre las rutas del día.
 *
 * Google Routes API optimiza el orden de las paradas pero no conoce franjas horarias. Por eso:
 *  - El orden y el reparto se calculan aquí con tiempos aproximados (distancia en línea recta × factor de calles
 *    ÷ velocidad promedio en Lima según la movilidad). Es gratis y suficiente para decidir.
 *  - Luego Google traza la ruta en ese orden y sus tiempos reales dan las ETA que se guardan.
 */

const FACTOR_CALLES = 1.35; // las calles no van en línea recta
const KMH = { auto: 18, moto: 22, furgoneta: 16, bicicleta: 13, a_pie: 4.5, transporte_publico: 13, otro: 16 };
export const MAX_PARADAS = 25; // límite de Google Routes API por ruta
const PENALIDAD_TARDE = 50; // cada segundo de retraso fuera de la franja pesa como 50 s de recorrido
const PENALIDAD_CARGA = 240; // en el reparto, cada parada que ya tiene la ruta suma 4 min (reparte la carga)
const PESO_FIN = 2; // en el reparto pesa también la hora en que termina la ruta más larga: así se usan todos los conductores

export const minutosServicio = () => env.planificacion.minutosParada;

/** Segundos de viaje aproximados entre dos puntos según la movilidad. */
export function segundosEntre(a, b, tipo = 'auto') {
  const [alat, alng, blat, blng] = [Number(a.lat), Number(a.lng), Number(b.lat), Number(b.lng)]; // de la base llegan como texto
  const k = 111320 * Math.cos(((alat + blat) / 2) * Math.PI / 180);
  const m = Math.hypot((blng - alng) * k, (blat - alat) * 111320) * FACTOR_CALLES;
  return m / (((KMH[tipo] ?? 16) * 1000) / 3600);
}

/** Momento (ms) de una hora "HH:MM[:SS]" de un día "AAAA-MM-DD" en Lima (UTC-5, sin horario de verano). */
export function enLima(fecha, hhmm) {
  if (!fecha || !hhmm) return null;
  return Date.parse(`${String(fecha).slice(0, 10)}T${String(hhmm).slice(0, 5)}:00-05:00`);
}

/** Hora de salida de la ruta: la indicada (o la de configuración); si es hoy y ya pasó, ahora. */
export function inicioRuta(ruta) {
  const programada = enLima(ruta.fecha, ruta.hora_salida ?? env.planificacion.horaSalida);
  return Math.max(programada, ruta.fecha === hoyLima() ? Date.now() : 0);
}

export const hoyLima = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);

/** Franja de una parada en ms ({ desde, hasta }; null si no tiene). */
const franja = (p, fecha) => ({ desde: enLima(fecha, p.franja_desde), hasta: enLima(fecha, p.franja_hasta) });

/**
 * Recorre las paradas en orden con los segundos de cada tramo y devuelve la llegada a cada una.
 * Si se llega antes de la franja, se espera a que empiece. `tramos[i]` = segundos hasta la parada i;
 * `tramos[n]` = de la última parada al almacén.
 */
export function horario(paradas, tramos, { inicio, fecha, servicioMin = minutosServicio() }) {
  let t = inicio;
  let tarde = 0;
  const llegadas = paradas.map((p, i) => {
    t += (tramos[i] ?? 0) * 1000;
    const f = franja(p, fecha);
    if (f.desde && t < f.desde) t = f.desde; // espera a que abra la franja
    const eta = t;
    const retraso = f.hasta && eta > f.hasta ? eta - f.hasta : 0;
    tarde += retraso;
    t += servicioMin * 60_000;
    return { id: p.id, eta, fuera_de_franja: retraso > 0, retraso_min: Math.round(retraso / 60_000) };
  });
  const regreso = t + (tramos[paradas.length] ?? 0) * 1000;
  return { llegadas, regreso, tardeMs: tarde };
}

/** Tramos aproximados (segundos) almacén → paradas → almacén. */
function tramosAprox(paradas, tipo) {
  const puntos = [env.deposito, ...paradas, env.deposito];
  return puntos.slice(1).map((p, i) => segundosEntre(puntos[i], p, tipo));
}

/** Costo de un orden: duración total + retrasos penalizados. */
function costo(orden, { inicio, fecha, tipo }) {
  const h = horario(orden, tramosAprox(orden, tipo), { inicio, fecha });
  return (h.regreso - inicio) / 1000 + (h.tardeMs / 1000) * PENALIDAD_TARDE;
}

/**
 * Ordena las paradas respetando sus franjas: arma un orden inicial por cierre de franja y cercanía,
 * y lo mejora moviendo paradas e invirtiendo tramos (2-opt) mientras baje el costo.
 */
export function ordenarConFranjas(paradas, { inicio, fecha, tipo = 'auto' }) {
  if (paradas.length < 2) return [...paradas];
  const ctx = { inicio, fecha, tipo };
  // orden inicial: siempre la siguiente más conveniente (llega pronto y no se pasa de su franja)
  const pendientes = [...paradas];
  const orden = [];
  let pos = env.deposito;
  let t = inicio;
  while (pendientes.length) {
    let mejor = 0;
    let mejorValor = Infinity;
    pendientes.forEach((p, i) => {
      const f = franja(p, fecha);
      let llega = t + segundosEntre(pos, p, tipo) * 1000;
      if (f.desde && llega < f.desde) llega = f.desde;
      const urgencia = f.hasta ? Math.max(0, (f.hasta - llega) / 1000) * 0.2 : 4 * 3600; // las que cierran pronto van primero
      const valor = (llega - t) / 1000 + urgencia + (f.hasta && llega > f.hasta ? (llega - f.hasta) / 1000 * PENALIDAD_TARDE : 0);
      if (valor < mejorValor) { mejorValor = valor; mejor = i; }
    });
    const [p] = pendientes.splice(mejor, 1);
    const f = franja(p, fecha);
    t += segundosEntre(pos, p, tipo) * 1000;
    if (f.desde && t < f.desde) t = f.desde;
    t += minutosServicio() * 60_000;
    pos = p;
    orden.push(p);
  }
  // mejora local: mover una parada a otra posición y 2-opt
  let actual = costo(orden, ctx);
  for (let vuelta = 0; vuelta < 30; vuelta++) {
    let mejoro = false;
    for (let i = 0; i < orden.length; i++) {
      for (let j = 0; j < orden.length; j++) {
        if (i === j) continue;
        const prueba = [...orden];
        const [p] = prueba.splice(i, 1);
        prueba.splice(j, 0, p);
        const c = costo(prueba, ctx);
        if (c < actual - 1) { orden.splice(0, orden.length, ...prueba); actual = c; mejoro = true; }
      }
    }
    for (let i = 0; i < orden.length - 1; i++) {
      for (let j = i + 1; j < orden.length; j++) {
        const prueba = [...orden.slice(0, i), ...orden.slice(i, j + 1).reverse(), ...orden.slice(j + 1)];
        const c = costo(prueba, ctx);
        if (c < actual - 1) { orden.splice(0, orden.length, ...prueba); actual = c; mejoro = true; }
      }
    }
    if (!mejoro) break;
  }
  return orden;
}

/**
 * Reparte pedidos entre rutas: cada pedido va a la ruta y posición donde menos alarga el recorrido
 * (respetando franjas, el límite de paradas y repartiendo la carga). Primero los de franja más temprana
 * y los más lejanos del almacén.
 * rutas: [{ id, fecha, hora_salida, tipo, paradas: [{ id, lat, lng, franja_desde, franja_hasta }] }]
 * pedidos: [{ id, lat, lng, franja_desde, franja_hasta }]
 * Devuelve { asignaciones: Map(rutaId → paradas en orden), sinAsignar: [{ id, motivo }] }.
 */
export function repartir(rutas, pedidos) {
  const estado = rutas.map((r) => ({
    ruta: r, paradas: [...r.paradas], ctx: { inicio: inicioRuta(r), fecha: r.fecha, tipo: r.tipo ?? 'auto' },
  }));
  for (const e of estado) e.costo = costo(e.paradas, e.ctx);
  const fecha = rutas[0]?.fecha;
  const orden = [...pedidos].sort((a, b) => {
    const fa = enLima(fecha, a.franja_hasta) ?? Infinity;
    const fb = enLima(fecha, b.franja_hasta) ?? Infinity;
    if (fa !== fb) return fa - fb;
    return segundosEntre(env.deposito, b) - segundosEntre(env.deposito, a);
  });
  const sinAsignar = [];
  // cupo equilibrado: el total de paradas repartido entre las rutas; pasarse cuesta como 3 h de recorrido
  const cupo = Math.ceil((estado.reduce((s, e) => s + e.paradas.length, 0) + pedidos.length) / Math.max(estado.length, 1));
  for (const p of orden) {
    let mejor = null;
    const maxActual = Math.max(...estado.map((e) => e.costo));
    for (const e of estado) {
      if (e.paradas.length >= MAX_PARADAS) continue;
      const maxOtras = Math.max(0, ...estado.filter((x) => x !== e).map((x) => x.costo));
      for (let pos = 0; pos <= e.paradas.length; pos++) {
        const prueba = [...e.paradas.slice(0, pos), p, ...e.paradas.slice(pos)];
        const nuevo = costo(prueba, e.ctx);
        const delta = nuevo - e.costo + e.paradas.length * PENALIDAD_CARGA
          + PESO_FIN * (Math.max(maxOtras, nuevo) - maxActual)
          + (e.paradas.length >= cupo ? 3 * 3600 : 0);
        if (!mejor || delta < mejor.delta) mejor = { e, prueba, delta };
      }
    }
    if (!mejor) { sinAsignar.push({ id: p.id, motivo: `todas las rutas tienen ${MAX_PARADAS} paradas` }); continue; }
    mejor.e.paradas = mejor.prueba;
    mejor.e.costo = costo(mejor.prueba, mejor.e.ctx);
  }
  // cada ruta se reordena al final con todas sus paradas
  const asignaciones = new Map();
  for (const e of estado) {
    const ordenadas = e.paradas.length > 1 ? ordenarConFranjas(e.paradas, e.ctx) : e.paradas;
    const h = horario(ordenadas, tramosAprox(ordenadas, e.ctx.tipo), e.ctx);
    asignaciones.set(e.ruta.id, { paradas: ordenadas, llegadas: h.llegadas, regreso: h.regreso });
  }
  return { asignaciones, sinAsignar };
}

/** Horas estimadas con tiempos aproximados (cuando Google no puede trazar la ruta). */
export function etasAproximadas(paradas, ctx) {
  return horario(paradas, tramosAprox(paradas, ctx.tipo), ctx);
}
