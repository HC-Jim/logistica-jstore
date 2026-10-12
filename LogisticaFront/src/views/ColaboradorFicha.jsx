'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { rrhhApi } from '../api/services';
import UbigeoSelect from '../components/UbigeoSelect';
import { useAuth } from '../context/AuthContext';
import { useCatalogos } from '../context/CatalogosContext';
import { ESTADOS_SOLICITUD, TIPOS_SOLICITUD, diasHasta, fechaCorta, hoyISO, soles } from '../utils/format';
import { nombresRoles, tiene } from '../utils/roles';
import { Chip } from './MiEspacio';

const VACIO = {
  usuario_id: '', nombres: '', apellido_paterno: '', apellido_materno: '', tipo_documento: 'DNI', numero_documento: '',
  pais_emisor: '', nacionalidad: 'Peruana', fecha_nacimiento: '', sexo: '', estado_civil: '', telefono: '', email_personal: '',
  direccion: '', direccion_referencia: '', ubigeo: '', situacion_educativa: '', institucion_educativa: '', carrera: '',
  anio_egreso: '', discapacidad: false, carne_conadis: '', emergencia_nombre: '', emergencia_parentesco: '', emergencia_telefono: '',
  cargo: '', area: '', jefe_id: '', horario_id: '', regimen_laboral: 'Privado general (D. Leg. 728)', categoria_ocupacional: 'Empleado',
  ocupacion: '', situacion_especial: 'Ninguna', jornada: 'Tiempo completo', jornada_atipica: false, horario_nocturno: false,
  sindicalizado: false, fecha_ingreso: '', periodo_prueba_fin: '', tipo_contrato: 'Necesidades del mercado', contrato_fin: '',
  sueldo: '', periodicidad_pago: 'Mensual', tipo_pago: 'Depósito en cuenta', asignacion_familiar: false, banco: '',
  cuenta_sueldo: '', cci: '', banco_cts: '', cuenta_cts: '', regimen_salud: 'EsSalud regular', eps: '', sistema_pension: 'ONP',
  afp: '', comision_afp: '', cuspp: '', pension_fecha_inscripcion: '', sctr: false, sctr_salud: '', sctr_pension: '',
  sctr_vence: '', vida_ley: true, vida_ley_aseguradora: '', examen_medico_vence: '', licencia_numero: '', licencia_categoria: '',
  licencia_vence: '', record_conductor: '', vacaciones_ajuste: '0', fecha_cese: '', motivo_cese: '', activo: true, observaciones: '',
};
const DH_VACIO = {
  id: null, vinculo: 'Hijo(a) menor de edad', tipo_documento: 'DNI', numero_documento: '', nombres: '', apellido_paterno: '',
  apellido_materno: '', fecha_nacimiento: '', sexo: '', documento_vinculo: '', estudia: false, activo: true,
};
const DOC_VACIO = { tipo: 'Contrato', vence: '', archivo: null };

/** Ficha del colaborador: datos personales y laborales, documentos, vacaciones y ausencias. */
export default function ColaboradorFicha() {
  const { id } = useParams();
  const nuevo = !id;
  const router = useRouter();
  const { usuario } = useAuth();
  const esRrhh = tiene(usuario, 'admin', 'rrhh');
  const cat = useCatalogos().catalogos ?? {};
  const [form, setForm] = useState(VACIO);
  const [original, setOriginal] = useState(null);
  const [opciones, setOpciones] = useState({ horarios: [], jefes: [], usuarios: [] });
  const [solicitudes, setSolicitudes] = useState([]);
  const [doc, setDoc] = useState(DOC_VACIO);
  const [ausencia, setAusencia] = useState(null);
  const [dh, setDh] = useState(null); // derechohabiente que se está editando
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = () => rrhhApi.colaborador(id).then((c) => {
    setOriginal(c);
    setForm(Object.fromEntries(Object.entries(VACIO).map(([k, v]) => [k, c[k] == null ? v : typeof v === 'boolean' ? c[k] : String(c[k])])));
  }).catch((e) => setError(mensajeError(e)));

  useEffect(() => {
    if (esRrhh) rrhhApi.opciones().then(setOpciones).catch(() => {});
  }, [esRrhh]);
  useEffect(() => {
    if (nuevo) return;
    cargar();
    rrhhApi.solicitudes({ colaborador_id: id }).then(setSolicitudes).catch(() => {});
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const input = (k, props = {}) => ({ value: form[k] ?? '', onChange: (e) => set(k, e.target.value), disabled: !esRrhh, ...props });

  async function guardar(e) {
    e.preventDefault();
    setError('');
    setAviso('');
    setGuardando(true);
    try {
      const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]));
      const c = nuevo ? await rrhhApi.crear(body) : await rrhhApi.actualizar(id, body);
      if (nuevo) router.replace(`/rrhh/colaboradores/${c.id}`);
      else { setAviso('Ficha guardada'); cargar(); }
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function subirDocumento(e) {
    e.preventDefault();
    if (!doc.archivo) return;
    try {
      await rrhhApi.subirDocumento(id, doc.archivo, { tipo: doc.tipo, nombre: doc.archivo.name, vence: doc.vence || undefined });
      setDoc(DOC_VACIO);
      e.target.reset();
      cargar();
    } catch (err) {
      alert(mensajeError(err));
    }
  }

  async function guardarDh(e) {
    e.preventDefault();
    try {
      const { id: dhId, nombre_completo: _n, edad: _e, colaborador_id: _c, creado_en: _f, ...body } = dh;
      const datos = Object.fromEntries(Object.entries(body).map(([k, x]) => [k, x === '' ? null : x]));
      await rrhhApi.guardarDerechohabiente(id, dhId, datos);
      setDh(null);
      cargar();
    } catch (err) {
      alert(mensajeError(err));
    }
  }

  async function eliminarDh(d) {
    if (!confirm(`¿Eliminar a ${d.nombre_completo}? Si ya no es derechohabiente, mejor edítalo y dalo de baja.`)) return;
    try {
      await rrhhApi.eliminarDerechohabiente(d.id);
      cargar();
    } catch (err) {
      alert(mensajeError(err));
    }
  }

  async function eliminarDocumento(d) {
    if (!confirm(`¿Eliminar ${d.nombre}?`)) return;
    try {
      await rrhhApi.eliminarDocumento(d.id);
      cargar();
    } catch (err) {
      alert(mensajeError(err));
    }
  }

  async function registrarAusencia(e) {
    e.preventDefault();
    try {
      await rrhhApi.crearSolicitud({ ...ausencia, colaborador_id: Number(id), aprobar: true });
      setAusencia(null);
      rrhhApi.solicitudes({ colaborador_id: id }).then(setSolicitudes);
      cargar();
    } catch (err) {
      alert(mensajeError(err));
    }
  }

  if (!nuevo && !original) return error ? <p className="error">{error}</p> : <p>Cargando…</p>;

  const v = original?.vacaciones;
  const lista = (k) => cat[k] ?? [];
  const check = (k, texto) => (
    <label className="check"><input type="checkbox" disabled={!esRrhh} checked={Boolean(form[k])} onChange={(e) => set(k, e.target.checked)} /> {texto}</label>
  );
  const edad = form.fecha_nacimiento ? Math.floor((new Date(`${hoyISO()}T12:00:00Z`) - new Date(`${form.fecha_nacimiento}T12:00:00Z`)) / (365.25 * 86400000)) : null;
  const tieneHijoQueSustenta = (original?.derechohabientes ?? []).some((d) => d.activo && d.vinculo.startsWith('Hijo')
    && (d.edad == null || d.edad < 18 || (d.estudia && d.edad < 24) || d.vinculo.includes('discapacidad')));
  const usuarioLibre = opciones.usuarios.filter((u) => !u.colaborador_id || String(u.colaborador_id) === id);
  const conductor = form.area === 'Logística' || form.licencia_categoria || /conductor|chofer|repartidor/i.test(form.cargo);

  return (
    <>
      <div className="encabezado">
        <h2>{nuevo ? 'Nuevo colaborador' : original.nombre_completo}</h2>
        <div className="fila">
          {!nuevo && <Link className="btn btn-sec" href={`/rrhh/asistencia?colaborador_id=${id}`}>🕘 Asistencia</Link>}
          <Link href="/rrhh/colaboradores">← Volver</Link>
        </div>
      </div>
      {!nuevo && original.alertas?.length > 0 && (
        <div className="alerta">
          {original.alertas.map((a) => {
            const d = diasHasta(a.vence);
            return <div key={a.concepto}>⚠ {a.concepto}: {d < 0 ? `venció el ${fechaCorta(a.vence)}` : `vence el ${fechaCorta(a.vence)} (en ${d} días)`}</div>;
          })}
        </div>
      )}
      {aviso && <p className="aviso">{aviso}</p>}

      <form className="tarjeta form-grid" onSubmit={guardar}>
        <h3 className="ficha-seccion">Datos personales</h3>
        <label>Nombres *<input required maxLength={80} {...input('nombres')} /></label>
        <label>Apellido paterno *<input required maxLength={60} {...input('apellido_paterno')} /></label>
        <label>Apellido materno<input maxLength={60} {...input('apellido_materno')} /></label>
        {esRrhh && (
          <>
            <label>Documento *
              <div className="fila sin-envolver">
                <select {...input('tipo_documento')} style={{ width: 110 }}>{lista('tiposDocumentoIdentidad').map((t) => <option key={t}>{t}</option>)}</select>
                <input required maxLength={15} {...input('numero_documento')} />
              </div>
            </label>
            {form.tipo_documento !== 'DNI' && <label>País emisor *<input required maxLength={40} {...input('pais_emisor')} /></label>}
            <label>Nacionalidad<input maxLength={40} {...input('nacionalidad')} /></label>
            <label>Fecha de nacimiento<input type="date" max={hoyISO()} {...input('fecha_nacimiento')} />{edad != null && <small>{edad} años{edad < 18 ? ' — menor de edad: requiere autorización del MTPE' : ''}</small>}</label>
            <label>Sexo
              <select {...input('sexo')}><option value="">—</option><option value="F">Femenino</option><option value="M">Masculino</option></select>
            </label>
            <label>Estado civil
              <select {...input('estado_civil')}><option value="">—</option>{lista('estadosCiviles').map((e) => <option key={e}>{e}</option>)}</select>
            </label>
          </>
        )}
        <label>Teléfono<input maxLength={30} {...input('telefono')} /></label>
        {esRrhh && (
          <>
            <label>Correo personal<input type="email" maxLength={160} {...input('email_personal')} /></label>
            <UbigeoSelect valor={form.ubigeo || null} onChange={(v) => set('ubigeo', v ?? '')} />
            <label className="ancho">Domicilio (vía, número, interior, urbanización)<input maxLength={255} {...input('direccion')} /></label>
            <label className="ancho">Referencia del domicilio<input maxLength={255} {...input('direccion_referencia')} /></label>
            <label>Situación educativa
              <select {...input('situacion_educativa')}><option value="">—</option>{lista('situacionesEducativas').map((e) => <option key={e}>{e}</option>)}</select>
            </label>
            {lista('educacionConEstudios').includes(form.situacion_educativa) && (
              <>
                <label>Institución *<input required maxLength={120} {...input('institucion_educativa')} /></label>
                <label>Carrera<input maxLength={120} {...input('carrera')} /></label>
                <label>Año de egreso<input type="number" min={1950} max={2100} {...input('anio_egreso')} /></label>
              </>
            )}
            {check('discapacidad', 'Persona con discapacidad')}
            {form.discapacidad && <label>Carné CONADIS<input maxLength={20} {...input('carne_conadis')} /></label>}

            <h3 className="ficha-seccion">Contacto de emergencia</h3>
            <label>Nombre<input maxLength={120} {...input('emergencia_nombre')} /></label>
            <label>Parentesco<input maxLength={40} {...input('emergencia_parentesco')} /></label>
            <label>Teléfono<input maxLength={30} {...input('emergencia_telefono')} /></label>
          </>
        )}

        <h3 className="ficha-seccion">Datos laborales</h3>
        <label>Cargo *<input required maxLength={80} {...input('cargo')} /></label>
        <label>Área *
          <select required {...input('area')}><option value="">Elige…</option>{lista('areas').map((a) => <option key={a}>{a}</option>)}</select>
        </label>
        {esRrhh ? (
          <>
            <label>Jefe inmediato (aprueba sus vacaciones y permisos)
              <select {...input('jefe_id')}>
                <option value="">Sin jefe (aprueba RRHH)</option>
                {opciones.jefes.filter((j) => String(j.id) !== id).map((j) => <option key={j.id} value={j.id}>{j.nombre} — {j.cargo}</option>)}
              </select>
            </label>
            <label>Horario
              <select {...input('horario_id')}>
                <option value="">Sin horario</option>
                {opciones.horarios.filter((h) => h.activo || String(h.id) === form.horario_id).map((h) => <option key={h.id} value={h.id}>{h.nombre} ({h.hora_entrada}–{h.hora_salida})</option>)}
              </select>
            </label>
            <label>Usuario del sistema
              <select {...input('usuario_id')}>
                <option value="">Sin usuario</option>
                {usuarioLibre.map((u) => <option key={u.id} value={u.id}>{u.nombre} ({u.email}) · {nombresRoles(u)}</option>)}
              </select>
              <small>Con usuario puede marcar y pedir vacaciones en <em>Mi espacio</em>. Si es conductor o auxiliar, su asistencia sale del GPS del app.</small>
            </label>
            <label>Régimen laboral
              <select {...input('regimen_laboral')}>{lista('regimenesLaborales').map((t) => <option key={t}>{t}</option>)}</select>
              <small>Define vacaciones (30 o 15 días), CTS y gratificaciones.</small>
            </label>
            <label>Categoría ocupacional
              <select {...input('categoria_ocupacional')}>{lista('categoriasOcupacionales').map((t) => <option key={t}>{t}</option>)}</select>
            </label>
            <label>Ocupación (T-Registro)<input maxLength={120} placeholder="Ej. Conductor de vehículo de reparto" {...input('ocupacion')} /></label>
            <label>Situación especial
              <select {...input('situacion_especial')}>{lista('situacionesEspeciales').map((t) => <option key={t}>{t}</option>)}</select>
            </label>
            <label>Jornada
              <select {...input('jornada')}>{lista('jornadas').map((t) => <option key={t}>{t}</option>)}</select>
            </label>
            {check('jornada_atipica', 'Jornada atípica o acumulativa')}
            {check('horario_nocturno', 'Horario nocturno')}
            {check('sindicalizado', 'Sindicalizado')}
          </>
        ) : (
          <>
            <label>Jefe<input disabled value={original?.jefe_nombre ?? '—'} /></label>
            <label>Horario<input disabled value={original?.horario_nombre ?? '—'} /></label>
          </>
        )}
        <label>Fecha de ingreso *<input type="date" required {...input('fecha_ingreso')} /></label>
        <label>Tipo de contrato *
          <select required {...input('tipo_contrato')}>{lista('tiposContrato').map((t) => <option key={t}>{t}</option>)}</select>
        </label>
        {form.tipo_contrato !== 'Plazo indeterminado' && (
          <label>Fin de contrato{!lista('contratosSinFin').includes(form.tipo_contrato) && ' *'}
            <input type="date" min={form.fecha_ingreso} required={!lista('contratosSinFin').includes(form.tipo_contrato)} {...input('contrato_fin')} />
          </label>
        )}
        <label>Fin del periodo de prueba<input type="date" min={form.fecha_ingreso} {...input('periodo_prueba_fin')} />
          {nuevo && <small>Si lo dejas vacío: 3 meses (6 si es de confianza, 12 si es de dirección).</small>}
        </label>
        <label>Examen médico ocupacional vence<input type="date" {...input('examen_medico_vence')} /></label>

        {esRrhh && (
          <>
            <h3 className="ficha-seccion">Remuneración y cuentas</h3>
            <label>Remuneración básica (S/)<input type="number" min={0} step="0.01" {...input('sueldo')} />
              {form.sueldo !== '' && Number(form.sueldo) < (cat.rmv ?? 0) && form.jornada === 'Tiempo completo' && <small className="error">Menor que la RMV (S/ {cat.rmv})</small>}
            </label>
            <label>Periodicidad
              <select {...input('periodicidad_pago')}>{lista('periodicidadesPago').map((t) => <option key={t}>{t}</option>)}</select>
            </label>
            <label>Tipo de pago
              <select {...input('tipo_pago')}>{lista('tiposPago').map((t) => <option key={t}>{t}</option>)}</select>
            </label>
            {check('asignacion_familiar', 'Asignación familiar (10 % de la RMV)')}
            {form.asignacion_familiar && !nuevo && !tieneHijoQueSustenta && <small className="pendiente-texto">⚠ Registra al hijo que la sustenta en Derechohabientes.</small>}
            <label>Banco (sueldo)<select {...input('banco')}><option value="">—</option>{lista('bancos').map((t) => <option key={t}>{t}</option>)}</select></label>
            <label>Cuenta de sueldo<input maxLength={30} {...input('cuenta_sueldo')} /></label>
            <label>CCI (20 dígitos)<input maxLength={25} {...input('cci')} /></label>
            <label>Banco CTS (lo elige el trabajador)
              <select {...input('banco_cts')}><option value="">—</option>{[...lista('bancos'), 'Caja municipal', 'Financiera'].map((t) => <option key={t}>{t}</option>)}</select>
            </label>
            <label>Cuenta CTS<input maxLength={30} {...input('cuenta_cts')} /></label>

            <h3 className="ficha-seccion">Seguridad social</h3>
            <label>Régimen de salud
              <select {...input('regimen_salud')}>{lista('regimenesSalud').map((t) => <option key={t}>{t}</option>)}</select>
            </label>
            {form.regimen_salud === 'EsSalud + EPS' && <label>EPS<input maxLength={40} placeholder="Pacífico, Rímac, Mapfre, Sanitas…" {...input('eps')} /></label>}
            <label>Sistema de pensiones
              <select {...input('sistema_pension')}>{lista('sistemasPension').map((t) => <option key={t}>{t}</option>)}</select>
            </label>
            {form.sistema_pension === 'AFP' && (
              <>
                <label>AFP *<select required {...input('afp')}><option value="">Elige…</option>{lista('afps').map((t) => <option key={t}>{t}</option>)}</select></label>
                <label>Comisión *<select required {...input('comision_afp')}><option value="">Elige…</option>{lista('comisionesAfp').map((t) => <option key={t} value={t}>{t === 'Flujo' ? 'Sobre el flujo (sueldo)' : 'Mixta (sobre el saldo)'}</option>)}</select></label>
                <label>CUSPP (12 caracteres)<input maxLength={12} {...input('cuspp')} /></label>
              </>
            )}
            {form.sistema_pension !== 'Sin sistema' && <label>Fecha de inscripción al sistema<input type="date" {...input('pension_fecha_inscripcion')} /></label>}
            {check('vida_ley', 'Seguro Vida Ley (obligatorio desde el primer día)')}
            {form.vida_ley && <label>Aseguradora Vida Ley<input maxLength={60} {...input('vida_ley_aseguradora')} /></label>}
            {check('sctr', 'SCTR (actividad de riesgo)')}
            {form.sctr && (
              <>
                <label>SCTR salud *<select required {...input('sctr_salud')}><option value="">Elige…</option>{lista('sctrSalud').map((t) => <option key={t}>{t}</option>)}</select></label>
                <label>SCTR pensión *<select required {...input('sctr_pension')}><option value="">Elige…</option>{lista('sctrPension').map((t) => <option key={t}>{t}</option>)}</select></label>
                <label>Póliza SCTR vence<input type="date" {...input('sctr_vence')} /></label>
              </>
            )}
          </>
        )}

        {(conductor || form.licencia_numero) && (
          <>
            <h3 className="ficha-seccion">Conductor</h3>
            <label>Licencia de conducir<input maxLength={15} {...input('licencia_numero')} /></label>
            <label>Categoría
              <select {...input('licencia_categoria')}><option value="">—</option>{lista('categoriasLicencia').map((t) => <option key={t}>{t}</option>)}</select>
            </label>
            <label>Licencia vence<input type="date" {...input('licencia_vence')} /></label>
            {esRrhh && <label className="ancho">Récord del conductor (papeletas, accidentes)<textarea rows={2} maxLength={2000} {...input('record_conductor')} /></label>}
          </>
        )}

        {esRrhh && (
          <>
            <h3 className="ficha-seccion">Vacaciones y cese</h3>
            <label>Ajuste de vacaciones (días)
              <input type="number" step="0.5" {...input('vacaciones_ajuste')} />
              <small>Negativo para descontar días gozados antes de usar el sistema; positivo para sumar.</small>
            </label>
            <label>Fecha de cese<input type="date" min={form.fecha_ingreso} {...input('fecha_cese')} /></label>
            {form.fecha_cese && (
              <label>Motivo de cese *
                <select required {...input('motivo_cese')}><option value="">Elige…</option>{lista('motivosCese').map((t) => <option key={t}>{t}</option>)}</select>
              </label>
            )}
            {!nuevo && !original.activo && (
              <div className="ancho"><button type="button" className="btn-sec" onClick={() => setForm({ ...form, fecha_cese: '', motivo_cese: '', activo: true })}>Reactivar colaborador</button></div>
            )}
            <label className="ancho">Observaciones<textarea rows={2} maxLength={2000} {...input('observaciones')} /></label>
          </>
        )}

        {error && <p className="error ancho">{error}</p>}
        {esRrhh && (
          <div className="fila ancho barra-acciones">
            <button disabled={guardando}>{guardando ? 'Guardando…' : nuevo ? 'Crear ficha' : 'Guardar cambios'}</button>
            {form.sueldo && <small>Costo mensual aprox.: {soles(Number(form.sueldo) + (form.asignacion_familiar ? (cat.rmv ?? 0) * 0.1 : 0))} + EsSalud 9 %</small>}
          </div>
        )}
      </form>

      {!nuevo && v && (
        <section className="tarjeta">
          <h3>🏖️ Vacaciones</h3>
          <div className="kpis kpis-compactos">
            <div className="kpi"><small>Saldo</small><strong>{v.saldo} días</strong></div>
            <div className="kpi"><small>Ganados ({v.anios_completos} años × {v.dias_anio} días)</small><strong>{v.ganados}</strong></div>
            <div className="kpi"><small>Proporcional en curso</small><strong>{v.en_curso}</strong></div>
            <div className="kpi"><small>Gozados</small><strong>{v.gozados}</strong></div>
            <div className="kpi"><small>Programados</small><strong>{v.programados}</strong></div>
            <div className="kpi"><small>Por aprobar</small><strong>{v.pendientes}</strong></div>
          </div>
        </section>
      )}

      {!nuevo && esRrhh && (
        <section className="tarjeta">
          <div className="fila espacio">
            <h3>👪 Derechohabientes</h3>
            {!dh && <button className="btn-sec" onClick={() => setDh(DH_VACIO)}>+ Agregar</button>}
          </div>
          <small>Cónyuge, concubino(a) e hijos: se declaran en el T-Registro para EsSalud y sustentan la asignación familiar (hijos menores de 18, o hasta 24 si estudian).</small>
          {dh && (
            <form className="form-grid nueva-ruta" onSubmit={guardarDh}>
              <label>Vínculo *<select required value={dh.vinculo} onChange={(e) => setDh({ ...dh, vinculo: e.target.value })}>{lista('vinculosDerechohabiente').map((t) => <option key={t}>{t}</option>)}</select></label>
              <label>Nombres *<input required maxLength={80} value={dh.nombres} onChange={(e) => setDh({ ...dh, nombres: e.target.value })} /></label>
              <label>Apellido paterno *<input required maxLength={60} value={dh.apellido_paterno} onChange={(e) => setDh({ ...dh, apellido_paterno: e.target.value })} /></label>
              <label>Apellido materno<input maxLength={60} value={dh.apellido_materno ?? ''} onChange={(e) => setDh({ ...dh, apellido_materno: e.target.value })} /></label>
              <label>Documento
                <div className="fila sin-envolver">
                  <select style={{ width: 110 }} value={dh.tipo_documento} onChange={(e) => setDh({ ...dh, tipo_documento: e.target.value })}>{lista('tiposDocumentoIdentidad').map((t) => <option key={t}>{t}</option>)}</select>
                  <input maxLength={15} value={dh.numero_documento ?? ''} onChange={(e) => setDh({ ...dh, numero_documento: e.target.value })} />
                </div>
              </label>
              <label>Fecha de nacimiento<input type="date" value={dh.fecha_nacimiento ?? ''} onChange={(e) => setDh({ ...dh, fecha_nacimiento: e.target.value })} /></label>
              <label>Sexo<select value={dh.sexo ?? ''} onChange={(e) => setDh({ ...dh, sexo: e.target.value })}><option value="">—</option><option value="F">Femenino</option><option value="M">Masculino</option></select></label>
              <label>Documento que acredita el vínculo<input maxLength={60} placeholder="Partida de nacimiento, acta de matrimonio…" value={dh.documento_vinculo ?? ''} onChange={(e) => setDh({ ...dh, documento_vinculo: e.target.value })} /></label>
              {dh.vinculo.startsWith('Hijo') && <label className="check"><input type="checkbox" checked={dh.estudia} onChange={(e) => setDh({ ...dh, estudia: e.target.checked })} /> Cursa estudios superiores</label>}
              {dh.id && <label className="check"><input type="checkbox" checked={!dh.activo} onChange={(e) => setDh({ ...dh, activo: !e.target.checked })} /> Dar de baja</label>}
              <div className="fila ancho"><button>Guardar</button><button type="button" className="btn-sec" onClick={() => setDh(null)}>Cancelar</button></div>
            </form>
          )}
          <table>
            <thead><tr><th>Vínculo</th><th>Nombre</th><th>Documento</th><th>Nacimiento</th><th>Acredita</th><th /></tr></thead>
            <tbody>
              {original.derechohabientes?.map((d) => (
                <tr key={d.id} className={d.activo ? '' : 'inactivo'}>
                  <td>{d.vinculo}{d.estudia && <small> · estudia</small>}</td><td>{d.nombre_completo}</td>
                  <td>{d.numero_documento ? `${d.tipo_documento} ${d.numero_documento}` : '—'}</td>
                  <td>{d.fecha_nacimiento ? `${fechaCorta(d.fecha_nacimiento)} (${d.edad} años)` : '—'}</td>
                  <td>{d.documento_vinculo}</td>
                  <td className="acciones">
                    <button className="btn-sec btn-mini" onClick={() => setDh(Object.fromEntries(Object.entries({ ...DH_VACIO, ...d }).map(([k, x]) => [k, x ?? ''])))}>Editar</button>
                    <button className="btn-peligro btn-mini" onClick={() => eliminarDh(d)}>Eliminar</button>
                  </td>
                </tr>
              ))}
              {!original.derechohabientes?.length && <tr><td colSpan={6}>Sin derechohabientes registrados.</td></tr>}
            </tbody>
          </table>
        </section>
      )}

      {!nuevo && esRrhh && (
        <section className="tarjeta">
          <h3>📁 Documentos</h3>
          <form className="fila filtros" onSubmit={subirDocumento}>
            <select value={doc.tipo} onChange={(e) => setDoc({ ...doc, tipo: e.target.value })}>
              {(cat.tiposDocumentoRrhh ?? []).map((t) => <option key={t}>{t}</option>)}
            </select>
            <label>Vence (opcional)<input type="date" value={doc.vence} onChange={(e) => setDoc({ ...doc, vence: e.target.value })} /></label>
            <input type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setDoc({ ...doc, archivo: e.target.files[0] ?? null })} />
            <button>Subir</button>
            <small>PDF, JPG o PNG de hasta 4 MB. Solo RRHH puede verlos.</small>
          </form>
          <table>
            <thead><tr><th>Tipo</th><th>Archivo</th><th>Vence</th><th>Subido</th><th /></tr></thead>
            <tbody>
              {original.documentos_lista?.map((d) => {
                const dias = d.vence ? diasHasta(d.vence) : null;
                return (
                  <tr key={d.id}>
                    <td>{d.tipo}</td>
                    <td><button className="btn-link-oscuro" onClick={() => rrhhApi.verDocumento(d.id).catch((e) => alert(mensajeError(e)))}>{d.nombre}</button> <small>({Math.ceil(d.tamano / 1024)} KB)</small></td>
                    <td className={dias != null && dias < 0 ? 'error' : ''}>{d.vence ? fechaCorta(d.vence) : '—'}</td>
                    <td><small>{fechaCorta(d.creado_en.slice(0, 10))} · {d.subido_por}</small></td>
                    <td className="acciones"><button className="btn-peligro btn-mini" onClick={() => eliminarDocumento(d)}>Eliminar</button></td>
                  </tr>
                );
              })}
              {!original.documentos_lista?.length && <tr><td colSpan={5}>Sin documentos. Sube el contrato, DNI, licencia, antecedentes…</td></tr>}
            </tbody>
          </table>
        </section>
      )}

      {!nuevo && (
        <section className="tarjeta">
          <div className="fila espacio">
            <h3>Vacaciones, permisos y licencias</h3>
            {esRrhh && original.activo && !ausencia && (
              <button className="btn-sec" onClick={() => setAusencia({ tipo: 'descanso_medico', desde: hoyISO(), hasta: hoyISO(), con_goce: true, motivo: '' })}>+ Registrar ausencia</button>
            )}
          </div>
          {ausencia && (
            <form className="fila filtros nueva-ruta" onSubmit={registrarAusencia}>
              <select value={ausencia.tipo} onChange={(e) => setAusencia({ ...ausencia, tipo: e.target.value, con_goce: true })}>
                {Object.entries(TIPOS_SOLICITUD).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
              </select>
              <label>Desde<input type="date" required value={ausencia.desde} onChange={(e) => setAusencia({ ...ausencia, desde: e.target.value })} /></label>
              <label>Hasta<input type="date" required min={ausencia.desde} value={ausencia.hasta} onChange={(e) => setAusencia({ ...ausencia, hasta: e.target.value })} /></label>
              {['permiso', 'licencia'].includes(ausencia.tipo) && (
                <select value={ausencia.con_goce ? '1' : '0'} onChange={(e) => setAusencia({ ...ausencia, con_goce: e.target.value === '1' })}>
                  <option value="1">Con goce</option><option value="0">Sin goce</option>
                </select>
              )}
              <input className="crece" placeholder="Motivo" maxLength={500} value={ausencia.motivo} onChange={(e) => setAusencia({ ...ausencia, motivo: e.target.value })} />
              <button>Registrar (aprobada)</button>
              <button type="button" className="btn-sec" onClick={() => setAusencia(null)}>Cancelar</button>
            </form>
          )}
          <table>
            <thead><tr><th>Tipo</th><th>Desde</th><th>Hasta</th><th className="num">Días</th><th>Motivo</th><th>Estado</th><th>Atendió</th></tr></thead>
            <tbody>
              {solicitudes.map((s) => (
                <tr key={s.id}>
                  <td>{TIPOS_SOLICITUD[s.tipo].icono} {TIPOS_SOLICITUD[s.tipo].label}{!s.con_goce && <small> (sin goce)</small>}</td>
                  <td>{fechaCorta(s.desde)}</td><td>{fechaCorta(s.hasta)}</td><td className="num">{s.dias}</td>
                  <td>{s.motivo}</td><td><Chip estado={s.estado} mapa={ESTADOS_SOLICITUD} /></td>
                  <td><small>{s.resuelto_por_nombre}</small></td>
                </tr>
              ))}
              {!solicitudes.length && <tr><td colSpan={7}>Sin registros.</td></tr>}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
