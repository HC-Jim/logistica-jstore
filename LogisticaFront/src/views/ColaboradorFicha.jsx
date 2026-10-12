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
  usuario_id: '', nombres: '', apellidos: '', tipo_documento: 'DNI', numero_documento: '', fecha_nacimiento: '', sexo: '',
  estado_civil: '', telefono: '', email_personal: '', direccion: '', ubigeo: '', emergencia_nombre: '', emergencia_parentesco: '',
  emergencia_telefono: '', hijos: '0', banco: '', cuenta_sueldo: '', cci: '', cargo: '', area: '', jefe_id: '', horario_id: '',
  fecha_ingreso: '', tipo_contrato: 'Plazo fijo', contrato_fin: '', sueldo: '', asignacion_familiar: false,
  sistema_pension: 'ONP', afp: '', cuspp: '', essalud: true, examen_medico_vence: '', licencia_numero: '',
  licencia_categoria: '', licencia_vence: '', sctr_vence: '', record_conductor: '', vacaciones_ajuste: '0',
  fecha_cese: '', motivo_cese: '', activo: true, observaciones: '',
};
const ESTADOS_CIVILES = ['Soltero(a)', 'Casado(a)', 'Conviviente', 'Divorciado(a)', 'Viudo(a)'];
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
        <label>Apellidos *<input required maxLength={80} {...input('apellidos')} /></label>
        {esRrhh && (
          <>
            <label>Documento *
              <div className="fila sin-envolver">
                <select {...input('tipo_documento')} style={{ width: 110 }}>{(cat.tiposDocumentoIdentidad ?? []).map((t) => <option key={t}>{t}</option>)}</select>
                <input required maxLength={15} {...input('numero_documento')} />
              </div>
            </label>
            <label>Fecha de nacimiento<input type="date" {...input('fecha_nacimiento')} /></label>
            <label>Sexo
              <select {...input('sexo')}><option value="">—</option><option value="F">Femenino</option><option value="M">Masculino</option></select>
            </label>
            <label>Estado civil
              <select {...input('estado_civil')}><option value="">—</option>{ESTADOS_CIVILES.map((e) => <option key={e}>{e}</option>)}</select>
            </label>
            <label>Hijos<input type="number" min={0} {...input('hijos')} /></label>
          </>
        )}
        <label>Teléfono<input maxLength={30} {...input('telefono')} /></label>
        {esRrhh && (
          <>
            <label>Correo personal<input type="email" maxLength={160} {...input('email_personal')} /></label>
            <UbigeoSelect valor={form.ubigeo || null} onChange={(v) => set('ubigeo', v ?? '')} />
            <label className="ancho">Dirección<input maxLength={255} {...input('direccion')} /></label>

            <h3 className="ficha-seccion">Contacto de emergencia</h3>
            <label>Nombre<input maxLength={120} {...input('emergencia_nombre')} /></label>
            <label>Parentesco<input maxLength={40} {...input('emergencia_parentesco')} /></label>
            <label>Teléfono<input maxLength={30} {...input('emergencia_telefono')} /></label>
          </>
        )}

        <h3 className="ficha-seccion">Datos laborales</h3>
        <label>Cargo *<input required maxLength={80} {...input('cargo')} /></label>
        <label>Área *
          <select required {...input('area')}><option value="">Elige…</option>{(cat.areas ?? []).map((a) => <option key={a}>{a}</option>)}</select>
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
          </>
        ) : (
          <>
            <label>Jefe<input disabled value={original?.jefe_nombre ?? '—'} /></label>
            <label>Horario<input disabled value={original?.horario_nombre ?? '—'} /></label>
          </>
        )}
        <label>Fecha de ingreso *<input type="date" required {...input('fecha_ingreso')} /></label>
        <label>Tipo de contrato *
          <select required {...input('tipo_contrato')}>{(cat.tiposContrato ?? []).map((t) => <option key={t}>{t}</option>)}</select>
        </label>
        {form.tipo_contrato !== 'Plazo indeterminado' && (
          <label>Fin de contrato<input type="date" min={form.fecha_ingreso} {...input('contrato_fin')} /></label>
        )}
        <label>Examen médico ocupacional vence<input type="date" {...input('examen_medico_vence')} /></label>

        {esRrhh && (
          <>
            <h3 className="ficha-seccion">Remuneración, pensiones y cuenta de sueldo</h3>
            <label>Sueldo básico (S/)<input type="number" min={0} step="0.01" {...input('sueldo')} /></label>
            <label className="check"><input type="checkbox" checked={form.asignacion_familiar} onChange={(e) => set('asignacion_familiar', e.target.checked)} /> Asignación familiar (10 % de la RMV)</label>
            <label className="check"><input type="checkbox" checked={form.essalud} onChange={(e) => set('essalud', e.target.checked)} /> Afiliado a EsSalud</label>
            <label>Sistema de pensiones
              <select {...input('sistema_pension')}>{(cat.sistemasPension ?? []).map((t) => <option key={t}>{t}</option>)}</select>
            </label>
            {form.sistema_pension === 'AFP' && (
              <>
                <label>AFP *<select required {...input('afp')}><option value="">Elige…</option>{(cat.afps ?? []).map((t) => <option key={t}>{t}</option>)}</select></label>
                <label>CUSPP<input maxLength={15} {...input('cuspp')} /></label>
              </>
            )}
            <label>Banco<select {...input('banco')}><option value="">—</option>{(cat.bancos ?? []).map((t) => <option key={t}>{t}</option>)}</select></label>
            <label>Cuenta de sueldo<input maxLength={30} {...input('cuenta_sueldo')} /></label>
            <label>CCI<input maxLength={25} {...input('cci')} /></label>
          </>
        )}

        {(conductor || form.licencia_numero) && (
          <>
            <h3 className="ficha-seccion">Conductor</h3>
            <label>Licencia de conducir<input maxLength={15} {...input('licencia_numero')} /></label>
            <label>Categoría
              <select {...input('licencia_categoria')}><option value="">—</option>{(cat.categoriasLicencia ?? []).map((t) => <option key={t}>{t}</option>)}</select>
            </label>
            <label>Licencia vence<input type="date" {...input('licencia_vence')} /></label>
            <label>SCTR vence<input type="date" {...input('sctr_vence')} /></label>
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
            {form.fecha_cese && <label>Motivo de cese<input maxLength={120} {...input('motivo_cese')} placeholder="Renuncia, fin de contrato…" /></label>}
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
            <div className="kpi"><small>Ganados ({v.anios_completos} años)</small><strong>{v.ganados}</strong></div>
            <div className="kpi"><small>Proporcional en curso</small><strong>{v.en_curso}</strong></div>
            <div className="kpi"><small>Gozados</small><strong>{v.gozados}</strong></div>
            <div className="kpi"><small>Programados</small><strong>{v.programados}</strong></div>
            <div className="kpi"><small>Por aprobar</small><strong>{v.pendientes}</strong></div>
          </div>
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
