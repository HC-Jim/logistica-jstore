# Módulo RRHH — puntos a validar con el contador

Este documento resume qué datos guarda la ficha del colaborador y qué reglas aplica el sistema, para que
un contador o especialista laboral las confirme antes de usar el módulo en producción. Las listas de
valores están en `LogisticaBack/src/config/catalogos.js` y se pueden ajustar sin tocar el resto del código.

## 1. Ficha del colaborador (alineada al T-Registro de SUNAT)

| Sección | Datos |
|---|---|
| Identificación | Tipo de documento (DNI, CE, pasaporte, PTP), número, país emisor (documentos extranjeros), apellido paterno, apellido materno, nombres, nacionalidad, fecha de nacimiento, sexo, estado civil |
| Contacto y domicilio | Teléfono, correo, domicilio, referencia, ubigeo (departamento, provincia, distrito) |
| Situación educativa | Nivel (Tabla 9) y, con estudios superiores completos, institución, carrera y año de egreso |
| Otros indicadores | Discapacidad (carné CONADIS), sindicalizado |
| Contacto de emergencia | Nombre, parentesco, teléfono |
| Datos laborales | Cargo, área, jefe inmediato, horario, **régimen laboral**, **categoría ocupacional** (empleado, obrero, ejecutivo), ocupación, **situación especial** (dirección, confianza, ninguna), jornada (completa o parcial menor a 4 h), jornada atípica o acumulativa, horario nocturno |
| Contrato | Fecha de ingreso, tipo de contrato (Tabla 12), fin de contrato, **fin del periodo de prueba** |
| Remuneración | Remuneración básica, periodicidad (mensual, quincenal, semanal, diaria), tipo de pago, asignación familiar |
| Cuentas | Banco y cuenta de sueldo, CCI, **banco y cuenta CTS** |
| Seguridad social | Régimen de salud (EsSalud regular, EsSalud + EPS, EsSalud agrario, SIS microempresa), EPS, sistema de pensiones (ONP, AFP, sin régimen), AFP, **tipo de comisión AFP (flujo o mixta)**, CUSPP, fecha de inscripción, **Seguro Vida Ley** y aseguradora, **SCTR salud y pensión** y vencimiento de la póliza, vencimiento del examen médico ocupacional |
| Conductores | Número y categoría de licencia, vencimiento, récord (papeletas, accidentes) |
| Derechohabientes | Cónyuge, concubino(a), hijos y gestante: documento, nombres, nacimiento, documento que acredita el vínculo, si estudia, situación (activo o de baja) |
| Cese | Fecha y motivo de baja (Tabla 17) |
| Documentos | Contrato, adendas, DNI, licencia, antecedentes, examen médico, SCTR, CV y certificados, con fecha de vencimiento |

El reporte **T-Registro** (Reportes de RRHH) lista estos datos por trabajador y marca los que faltan. Muestra
los valores con su nombre, no con los códigos de las tablas paramétricas de SUNAT.

## 2. Reglas que aplica el sistema (confirmar)

1. **Vacaciones**: 30 días por año en el régimen general y agrario; 15 en MYPE (micro y pequeña) y en
   modalidad formativa; 0 con jornada menor a 4 horas. Se devengan por mes completo de servicio (30/12 o 15/12
   por mes). **No** se revisa el récord vacacional (días efectivamente trabajados) ni las vacaciones vencidas
   o la indemnización vacacional.
2. **Periodo de prueba**: si no se indica, 3 meses desde el ingreso; 6 si es de confianza; 12 si es de dirección.
   No se calcula para convenios de prácticas ni locadores.
3. **Contratos sujetos a modalidad** (todos menos plazo indeterminado, tiempo parcial e intermitente) exigen
   fecha de fin y avisan 30 días antes del vencimiento.
4. **Microempresa**: al crear la ficha, el régimen de salud por defecto es SIS microempresa.
5. **Asignación familiar**: 10 % de la RMV (S/ 1 130 → S/ 113). El sistema avisa si se marca sin un hijo
   registrado menor de 18 años (o hasta 24 si estudia, o mayor con discapacidad).
6. **Costo de planilla en el dashboard**: remuneración básica + asignación familiar; EsSalud estimado al 9 %.
   No incluye EPS, SCTR, Vida Ley, gratificaciones ni CTS.
7. **Asistencia**: pasada la tolerancia, la tardanza se cuenta desde la hora de entrada. Horas extra =
   trabajado − (salida − entrada − refrigerio); en descanso o feriado todo es extra. El refrigerio se descuenta
   solo si se trabajaron más de 6 horas. No hay autorización previa de horas extra.
8. **Días no remunerados** (reporte *Datos para planilla*): faltas + permisos sin goce + licencias sin goce.
   El descuento en soles lo calcula el contador.
9. **Feriados** 2026–2027 precargados; se pueden agregar o quitar.
10. **Locación de servicios**: queda fuera del reporte T-Registro (no es planilla).

## 3. Pendiente (segunda etapa)

- Cálculo de planilla: boletas, aportes (AFP con prima y comisión, ONP 13 %), quinta categoría, EsSalud,
  gratificaciones (julio y diciembre, con bonificación extraordinaria), CTS (mayo y noviembre), liquidación.
- Archivos con códigos de SUNAT para el T-Registro (carga masiva) y el PLAME; archivo de pagos al banco.
- Historial de contratos y de cambios de sueldo (hoy se guarda el contrato vigente y las adendas como documento).
- Actualización de datos personales por el propio colaborador desde *Mi espacio*.

## Fuentes consultadas

- SUNAT / MTPE: índice de información de la Planilla Electrónica y estructuras del T-Registro (RM 121-2011-TR y modificatorias).
- SUNAT: ejemplos de carga masiva al T-Registro (categoría ocupacional, situación especial, tipo de pago, periodicidad).
- Normas citadas: D. Leg. 728 (periodo de prueba), D. Leg. 713 (vacaciones), TUO Ley MYPE (D.S. 013-2013-PRODUCE),
  D. Leg. 688 y D.U. 044-2019 (Vida Ley desde el primer día), Ley 26790 y D.S. 009-97-SA (SCTR).
