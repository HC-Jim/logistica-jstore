"""
Convierte el Excel "SKUs y Precios" a JSON para scripts/importar-catalogo.js.

Uso:  python scripts/excel_a_json.py "../datos/SKUs y Precios.xlsx" ../datos/importar
Necesita:  pip install openpyxl

Genera productos.json, combos.json, precios.json y un resumen con lo que no se pudo leer.
"""
import datetime
import json
import os
import re
import sys
import unicodedata

import openpyxl

ERRORES_FORMULA = {'#N/A', '#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#NUM!', '#NULL!', '-', ''}


def limpio(v):
    """Texto sin espacios extra; None si está vacío o es un error de fórmula."""
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    t = str(v).strip()
    return None if t in ERRORES_FORMULA else t


def numero(v):
    t = limpio(v)
    if t is None:
        return None
    t = t.replace('S/', '').replace(',', '').strip()
    try:
        n = float(t)
    except ValueError:
        return None
    return n if n >= 0 else None


def garantia(v):
    """6, '6 meses', 'Sin Garantía' → meses (0 = sin garantía)."""
    t = limpio(v)
    if t is None:
        return None
    if 'sin' in t.lower():
        return 0
    m = re.match(r'^(\d+)', t)
    return int(m.group(1)) if m else None


def clave(t):
    return ''.join(c for c in unicodedata.normalize('NFD', t.lower()) if c.isalnum())


MARCAS = {}  # escritura unificada: "Vibra +" → "Vibra+"


def marca(v):
    t = limpio(v)
    if t is None or t == 'None':
        return None
    return MARCAS.setdefault(clave(t), t if '+' not in t else t.replace(' ', ''))


def main(ruta, salida):
    wb = openpyxl.load_workbook(ruta, read_only=True, data_only=True)
    filas = lambda hoja: [f for f in wb[hoja].iter_rows(values_only=True) if any(c not in (None, '') for c in f)]
    os.makedirs(salida, exist_ok=True)
    avisos = []

    # ---------- GENERADOR_SKU ----------
    g = filas('GENERADOR_SKU')
    cab = list(g[0])
    col = {nombre: i for i, nombre in enumerate(cab) if nombre}
    productos, vistos = [], {}
    for n, f in enumerate(g[1:], start=2):
        sku = limpio(f[col['SKU']])
        nombre = limpio(f[col['Nombre Almacén']])
        if not sku or not nombre:
            if any(c not in (None, '') for c in f[:10]):
                avisos.append(f'GENERADOR fila {n}: sin SKU o sin nombre, se omite')
            continue
        if sku in vistos:
            avisos.append(f'GENERADOR fila {n}: SKU {sku} repetido ("{nombre}"); ya está en la fila {vistos[sku]} — asígnale un SKU nuevo')
            continue
        vistos[sku] = n
        tipo = limpio(f[col['Tipo']]) or 'Ítem único'
        eliminado = sku.lower().startswith('elimanado') or sku.lower().startswith('eliminado')
        productos.append({
            'sku': sku,
            'descripcion': nombre[:255],
            'tipo': tipo,
            'categoria_anterior': limpio(f[col['Categoría']]),
            'subcategoria_anterior': limpio(f[col['Subcategoría']]),
            'cod_categoria': (limpio(f[col['Cód. Categoría']]) or '').zfill(2) or None,
            'cod_subcategoria': (limpio(f[col['Cód. Subcategoría']]) or '').zfill(2) or None,
            'asignacion': int(limpio(f[col['Asignación']])) if (limpio(f[col['Asignación']]) or '').isdigit() else None,
            'marca': marca(f[col['Marca']]),
            'modelo': limpio(f[col['Modelo']]),
            'estado_sourcing': limpio(f[col['Estado de Sourcing']]),
            'garantia_meses': garantia(f[col['Garantía']]),
            'peso_kg': numero(f[col['Peso Físico (kg)']]),
            'largo_cm': numero(f[col['Largo Físico (cm)']]),
            'ancho_cm': numero(f[col['Ancho Físico (cm)']]),
            'alto_cm': numero(f[col['Alto Físico (cm)']]),
            'talla': limpio(f[col['Talla']]),
            'estado_verificacion': limpio(f[col['Estado de Verificación Física']]),
            'precio_normal': numero(f[col['Precio Normal']]),
            'precio': numero(f[col['Web']]),
            'link_info': (limpio(f[col['Link para Información']]) or '')[:1000] or None,
            'activo': not eliminado,  # los descontinuados se pueden seguir vendiendo hasta agotar stock
        })

    # ---------- COMBOS ----------
    c = filas('COMBOS')
    cc = {nombre: i for i, nombre in enumerate(c[0]) if nombre}
    combos = []
    for n, f in enumerate(c[1:], start=2):
        combo, comp = limpio(f[cc['SKU_COMBO']]), limpio(f[cc['SKU_COMPONENTE']])
        if not combo or not comp:
            continue
        cant = numero(f[cc['CANTIDAD']])
        combos.append({'fila': n, 'combo': combo, 'componente': comp, 'cantidad': int(cant) if cant else 1,
                       'precio': numero(f[cc['Precio']]), 'precio_normal': numero(f[cc['Precio Normal']])})

    # ---------- FORMATO_PRECIOS ----------
    p = filas('FORMATO_PRECIOS')
    cp = {nombre: i for i, nombre in enumerate(p[0]) if nombre}
    precios, sin_fecha, sin_plataforma = [], 0, 0
    for f in p[1:]:
        sku, plataforma = limpio(f[cp['SKU']]), limpio(f[cp['Plataforma']])
        fecha, precio = f[cp['Fecha']], numero(f[cp['Precio']])
        if not sku or precio is None:
            continue
        if not plataforma:
            sin_plataforma += 1
            continue
        if not isinstance(fecha, (datetime.datetime, datetime.date)):
            sin_fecha += 1
            continue
        precios.append({'sku': sku, 'plataforma': plataforma, 'fecha': fecha.strftime('%Y-%m-%d'),
                        'precio': precio, 'precio_normal': numero(f[cp['Precio Normal']])})
    if sin_fecha:
        avisos.append(f'FORMATO_PRECIOS: {sin_fecha} filas sin fecha válida, se omiten')
    if sin_plataforma:
        avisos.append(f'FORMATO_PRECIOS: {sin_plataforma} filas sin plataforma ("-"), se omiten')

    for nombre, datos in [('productos', productos), ('combos', combos), ('precios', precios)]:
        with open(os.path.join(salida, f'{nombre}.json'), 'w', encoding='utf8') as fh:
            json.dump(datos, fh, ensure_ascii=False)
    with open(os.path.join(salida, 'avisos.txt'), 'w', encoding='utf8') as fh:
        fh.write('\n'.join(avisos))
    print(f'productos {len(productos)} · combos (líneas) {len(combos)} · precios {len(precios)} · avisos {len(avisos)}')
    for a in avisos:
        print('  -', a)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
