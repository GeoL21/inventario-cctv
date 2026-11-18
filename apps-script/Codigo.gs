/*****************************************************************
 * INVENTARIO CCTV — Clínica Reina Catalina
 * Versión 4 — servidor de la PWA
 *
 * Qué cambió respecto a la versión 3:
 *   - Lee y escribe cada columna por el NOMBRE de su encabezado, no
 *     por su posición. Se pueden agregar columnas sin romper nada.
 *   - Columnas nuevas al final de INVENTARIO_CCTV: IP, NVR / DVR, Canal.
 *   - Hoja nueva HISTORIAL_CCTV (tabla de Sheets): cada mantenimiento,
 *     revisión o falla es una fila. Al guardar uno se actualiza
 *     "Último mantenimiento" de la cámara.
 *   - Al editar una cámara ya no se reescribe la celda de la foto, así
 *     el chip de Drive no se pierde.
 *   - El panel se actualiza solo cada 15 minutos (menú Inventario CCTV →
 *     Activar panel automático). Guardar desde la app ya no lo rearma.
 *   - PANEL_CONTROL: el script solo escribe en las columnas A a H. Las
 *     columnas J en adelante son para NOTAS y el script nunca las toca.
 *     (Antes hacía panel.clear() y borraba todo lo que se agregaba a mano.)
 *   - Menú "Hojas de vida": PDF de una cámara o de una sede completa.
 *
 * Requisito: activar el servicio avanzado "Google Sheets API"
 * (Editor de Apps Script → Servicios → + → Google Sheets API).
 * Sin él todo funciona, pero la hoja HISTORIAL_CCTV no se crea como
 * tabla y las fotos quedan como enlace corto en vez de chip.
 *****************************************************************/


/***********************
 * AJUSTES
 ***********************/

const URL_PWA = 'https://geol21.github.io/inventario-cctv/';
const URL_LOGO = URL_PWA + 'logo-crc.jpg';

// true  = el enlace viejo muestra el aviso "Esta versión ya no se usa".
const MODO_AVISO = true;

// Datos del formato que salen en el encabezado del PDF.
// Si calidad les asigna código o versión, cámbialos aquí.
const FORMATO_CODIGO = '';
const FORMATO_VERSION = '';

const NOMBRE_HOJA_INVENTARIO = 'INVENTARIO_CCTV';
const NOMBRE_HOJA_CONFIG = 'CONFIGURACION';
const NOMBRE_HOJA_PANEL = 'PANEL_CONTROL';
const NOMBRE_HOJA_HISTORIAL = 'HISTORIAL_CCTV';
const NOMBRE_HOJA_SUBIDAS = 'SUBIDAS_PWA';

const NOMBRE_CARPETA_FOTOS = 'FOTOS_INVENTARIO_CCTV';
const NOMBRE_CARPETA_FOTOS_MTTO = 'FOTOS_MANTENIMIENTO_CCTV';
const NOMBRE_CARPETA_PDF = 'HOJAS_DE_VIDA_CCTV';

const PROPIEDAD_CODIGO = 'CODIGO_ACCESO';
const PROPIEDAD_NOTAS_MIGRADAS = 'PANEL_V4_NOTAS';

// Columnas del panel que escribe el script (A..H). De la J en adelante: notas.
const PANEL_COLUMNAS = 8;
const PANEL_COLUMNA_NOTAS = 10;


/***********************
 * CAMPOS DEL INVENTARIO
 * clave que usa la app  →  encabezado de la hoja
 ***********************/

const CAMPOS = [
  ['id', 'ID Cámara'],
  ['fechaRegistro', 'Fecha de registro'],
  ['sede', 'Sede'],
  ['edificacion', 'Edificación'],
  ['nivel', 'Nivel'],
  ['subzona', 'Subzona'],
  ['dependencia', 'Dependencia'],
  ['tipoUbicacion', 'Tipo de ubicación'],
  ['areaZona', 'Área / Zona'],
  ['referencia', 'Referencia'],
  ['tipoCamara', 'Tipo de cámara'],
  ['marca', 'Marca'],
  ['modelo', 'Modelo'],
  ['serial', 'Serial'],
  ['visionNocturna', 'Visión nocturna'],
  ['audio', 'Audio'],
  ['estado', 'Estado'],
  ['estadoFisico', 'Estado físico'],
  ['estadoCableado', 'Estado de cableado'],
  ['ultimoMantenimiento', 'Último mantenimiento'],
  ['proximoMantenimiento', 'Próximo mantenimiento'],
  ['responsable', 'Responsable'],
  ['observaciones', 'Observaciones'],
  ['fotografia', 'Fotografía'],
  ['registradoPor', 'Registrado por'],
  ['ip', 'IP'],
  ['nvr', 'NVR / DVR'],
  ['canal', 'Canal']
];

const ENCABEZADO = {};
CAMPOS.forEach(function(c) { ENCABEZADO[c[0]] = c[1]; });

// Columnas que se crean solas al final si no existen
const COLUMNAS_NUEVAS = ['IP', 'NVR / DVR', 'Canal'];

// Campos de texto (se guardan tal cual)
const CAMPOS_TEXTO = [
  'sede', 'edificacion', 'nivel', 'subzona', 'dependencia', 'tipoUbicacion',
  'areaZona', 'referencia', 'tipoCamara', 'marca', 'modelo', 'serial',
  'visionNocturna', 'audio', 'estado', 'estadoFisico', 'estadoCableado',
  'responsable', 'observaciones', 'ip', 'nvr', 'canal'
];


/***********************
 * HISTORIAL
 ***********************/

const TIPOS_MTTO = ['Revisión inicial', 'Preventivo', 'Correctivo'];
const ESTADOS_IMAGEN = ['Buena', 'Regular', 'Mala', 'Sin imagen'];

const COLUMNAS_HISTORIAL = [
  { enc: 'Fecha', tipo: 'DATE_TIME' },
  { enc: 'ID Cámara', tipo: 'TEXT' },
  { enc: 'Sede', tipo: 'DROPDOWN', lista: ['Barranquilla', 'Baranoa'] },
  { enc: 'Ubicación', tipo: 'TEXT' },
  { enc: 'Tipo', tipo: 'DROPDOWN', lista: TIPOS_MTTO },
  { enc: 'Actividades', tipo: 'TEXT' },
  { enc: 'Estado de la imagen', tipo: 'DROPDOWN', lista: ESTADOS_IMAGEN },
  { enc: 'Hubo falla', tipo: 'DROPDOWN', lista: ['Sí', 'No'] },
  { enc: 'Falla', tipo: 'TEXT' },
  { enc: 'Repuesto', tipo: 'TEXT' },
  { enc: 'Días fuera de servicio', tipo: 'DOUBLE' },
  { enc: 'Técnico', tipo: 'TEXT' },
  { enc: 'Observaciones', tipo: 'TEXT' },
  { enc: 'Foto de evidencia', tipo: 'TEXT' },
  { enc: 'UUID', tipo: 'TEXT' }
];


/***********************
 * LISTAS BASE DEL PANEL
 * Si en los datos aparece un valor que no está aquí, el panel
 * también lo cuenta (se agrega al final de su tabla).
 ***********************/

const LISTA_SEDES = ['Barranquilla', 'Baranoa'];

const LISTA_EDIFICACIONES = [
  'Barranquilla - Clínica',
  'Baranoa - Clínica',
  'Baranoa - Edificio de Dependencias'
];

const LISTA_ESTADOS = [
  'Operativa',
  'Operativa con novedad',
  'Intermitente',
  'Fuera de servicio',
  'En mantenimiento'
];

const LISTA_TIPOS_CAMARA = ['Domo', 'Bullet', 'Turret', 'Otra'];

const LISTA_TIPOS_UBICACION = [
  'Pasillo', 'Habitación', 'Acceso', 'Escalera', 'Ascensor', 'Parqueadero',
  'Área administrativa', 'Área asistencial', 'Área externa',
  'Cuarto técnico', 'Cocina', 'Lavandería', 'Otro'
];

const LISTA_SUBZONAS = ['A', 'B', 'C', 'No aplica'];


/***********************
 * WEB APP
 ***********************/

function doGet() {
  if (!MODO_AVISO) {
    return HtmlService
      .createHtmlOutputFromFile('index')
      .setTitle('Inventario CCTV - Clínica Reina Catalina')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  const html =
    '<!DOCTYPE html><html><head><base target="_top">' +
    '<style>' +
    'body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#FFF7F6;color:#160D0E;}' +
    '.caja{max-width:480px;margin:40px auto;padding:28px 22px;background:#F7E3E6;' +
    'border-radius:28px;text-align:center;}' +
    'h1{color:#84303F;font-size:22px;margin:0 0 12px;}' +
    'p{font-size:16px;line-height:1.5;}' +
    'a{display:inline-block;margin-top:14px;padding:16px 26px;background:#84303F;' +
    'color:#fff;font-weight:bold;font-size:16px;text-decoration:none;border-radius:28px;}' +
    '</style></head><body><div class="caja">' +
    '<h1>Esta versión ya no se usa</h1>' +
    '<p>El Inventario CCTV ahora es una aplicación que se instala en el ' +
    'celular y funciona sin señal.</p>' +
    '<a href="' + URL_PWA + '">Abrir la nueva aplicación</a>' +
    '</div></body></html>';

  return HtmlService
    .createHtmlOutput(html)
    .setTitle('Inventario CCTV - Clínica Reina Catalina')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


/***********************
 * SERVIDOR DE LA PWA
 *
 * Acciones:
 *   validar        Comprueba el código de acceso.
 *   inventario     Devuelve todas las cámaras y todo el historial.
 *   registrar      Guarda una cámara nueva (datos.uuid evita repetidos).
 *   actualizar     Modifica una cámara existente.
 *   mantenimiento  Guarda un mantenimiento en HISTORIAL_CCTV.
 *   foto           Devuelve la foto de una cámara (tamaño mediano) para
 *                  la hoja de vida y el PDF que arma la app.
 ***********************/

function doPost(e) {
  let peticion;

  try {
    peticion = JSON.parse(e.postData.contents);
  } catch (error) {
    return responderJson_({ ok: false, error: 'Solicitud inválida.' });
  }

  try {
    if (!codigoValido_(peticion.codigo)) {
      return responderJson_({
        ok: false,
        codigo: 'ACCESO',
        error: 'Código de acceso incorrecto.'
      });
    }

    switch (peticion.accion) {

      case 'validar':
        return responderJson_({ ok: true });

      case 'inventario':
        asegurarEstructura_();
        return responderJson_({
          ok: true,
          registros: buscarRegistros(''),
          historial: leerHistorial_(),
          fecha: formatearFecha_(new Date())
        });

      case 'registrar':
        asegurarEstructura_();
        return responderJson_(guardarRegistro(peticion.datos));

      case 'actualizar':
        asegurarEstructura_();
        return responderJson_(actualizarRegistro(peticion.datos));

      case 'mantenimiento':
        asegurarEstructura_();
        return responderJson_(guardarMantenimiento(peticion.datos));

      case 'foto':
        return responderJson_({ ok: true, foto: fotoCamara_(peticion.id) });

      default:
        return responderJson_({ ok: false, error: 'Acción desconocida.' });
    }

  } catch (error) {
    return responderJson_({
      ok: false,
      error: String(error && error.message ? error.message : error)
    });
  }
}

function responderJson_(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

function codigoValido_(codigo) {
  const guardado = PropertiesService
    .getScriptProperties()
    .getProperty(PROPIEDAD_CODIGO);

  if (!guardado) {
    throw new Error(
      'Falta definir el código de acceso: en la hoja de cálculo abre el ' +
      'menú Inventario CCTV → Cambiar código de acceso.'
    );
  }

  return String(codigo || '').trim().toLowerCase() ===
         String(guardado).trim().toLowerCase();
}

function menuCambiarCodigo() {
  const ui = SpreadsheetApp.getUi();

  const respuesta = ui.prompt(
    'Código de acceso de la PWA',
    'Escribe el código que deberán digitar los celulares (mínimo 4 ' +
    'caracteres). Si lo cambias, cada celular pedirá el nuevo.',
    ui.ButtonSet.OK_CANCEL
  );

  if (respuesta.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const codigo = String(respuesta.getResponseText() || '').trim();

  if (codigo.length < 4) {
    ui.alert('El código debe tener al menos 4 caracteres. No se cambió.');
    return;
  }

  PropertiesService
    .getScriptProperties()
    .setProperty(PROPIEDAD_CODIGO, codigo);

  ui.alert('Código de acceso guardado.');
}


/***********************
 * MENÚ EN LA HOJA DE CÁLCULO
 ***********************/

function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Inventario CCTV')
    .addItem('Actualizar panel', 'menuActualizarPanel')
    .addItem('Activar panel automático (cada 15 min)', 'menuActivarPanelAutomatico')
    .addItem('Buscar y eliminar duplicados', 'menuEliminarDuplicados')
    .addSeparator()
    .addItem('Cambiar código de acceso', 'menuCambiarCodigo')
    .addToUi();

  ui.createMenu('Hojas de vida')
    .addItem('Generar hoja de vida de una cámara…', 'menuHojaDeVidaCamara')
    .addSeparator()
    .addItem('Generar hojas de vida de Barranquilla', 'menuHojasBarranquilla')
    .addItem('Generar hojas de vida de Baranoa', 'menuHojasBaranoa')
    .addToUi();
}

function menuActualizarPanel() {
  asegurarEstructura_();
  actualizarPanel_();
  SpreadsheetApp.getUi().alert('Panel actualizado.');
}


/***********************
 * ESTRUCTURA DE LA HOJA
 * Crea lo que falte (columnas nuevas, historial). Se puede llamar
 * siempre: si ya existe, no hace nada.
 ***********************/

function asegurarEstructura_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const inventario = ss.getSheetByName(NOMBRE_HOJA_INVENTARIO);

  if (!inventario) {
    throw new Error('No existe la hoja ' + NOMBRE_HOJA_INVENTARIO + '.');
  }

  // Columnas nuevas al final del inventario
  const encabezados = leerEncabezados_(inventario);

  const faltan = COLUMNAS_NUEVAS.filter(function(nombre) {
    return encabezados.indexOf(nombre) === -1;
  });

  if (faltan.length) {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);

    try {
      const actuales = leerEncabezados_(inventario);
      const siguen = faltan.filter(function(n) { return actuales.indexOf(n) === -1; });

      if (siguen.length) {
        let ultima = 0;
        actuales.forEach(function(t, i) { if (t) ultima = i + 1; });

        if (inventario.getMaxColumns() < ultima + siguen.length) {
          inventario.insertColumnsAfter(
            inventario.getMaxColumns(),
            ultima + siguen.length - inventario.getMaxColumns()
          );
        }

        const rango = inventario.getRange(1, ultima + 1, 1, siguen.length);
        rango.setValues([siguen]);

        // Mismo formato que el encabezado existente
        inventario.getRange(1, 1).copyFormatToRange(
          inventario, ultima + 1, ultima + siguen.length, 1, 1
        );

        // Texto plano: que la IP o el canal no se vuelvan número o fecha
        inventario.getRange(2, ultima + 1, inventario.getMaxRows() - 1, siguen.length)
          .setNumberFormat('@');

        SpreadsheetApp.flush();
      }
    } finally {
      lock.releaseLock();
    }
  }

  // Historial
  if (!ss.getSheetByName(NOMBRE_HOJA_HISTORIAL)) {
    crearHojaHistorial_(ss);
  }

  colorearTablaHistorial_(ss);
}

/** Encabezado de la tabla del historial en vino (una sola vez). */
function colorearTablaHistorial_(ss) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('HISTORIAL_COLOR_V1') || !hayApiSheets_()) return;

  const hoja = ss.getSheetByName(NOMBRE_HOJA_HISTORIAL);
  const tablaId = hoja ? idTablaHistorial_(hoja) : '';
  if (!tablaId) return;

  try {
    SpreadsheetApp.flush();
    Sheets.Spreadsheets.batchUpdate({ requests: [{ updateTable: {
      table: { tableId: tablaId, rowsProperties: {
        headerColorStyle: { rgbColor: { red: 132 / 255, green: 48 / 255, blue: 63 / 255 } },
        firstBandColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
        secondBandColorStyle: { rgbColor: { red: 1, green: 247 / 255, blue: 246 / 255 } }
      } },
      fields: 'rowsProperties'
    } }] }, ss.getId());
    props.setProperty('HISTORIAL_COLOR_V1', '1');
  } catch (e) {
    console.error('Color de la tabla: ' + e);
  }
}

function crearHojaHistorial_(ss) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    if (ss.getSheetByName(NOMBRE_HOJA_HISTORIAL)) {
      return;
    }

    const hoja = ss.insertSheet(NOMBRE_HOJA_HISTORIAL);
    const n = COLUMNAS_HISTORIAL.length;

    hoja.getRange(1, 1, 1, n).setValues([COLUMNAS_HISTORIAL.map(function(c) { return c.enc; })]);
    hoja.setFrozenRows(1);

    // Lo escrito con SpreadsheetApp se aplica antes de crear la tabla
    // con la API (si no, se aplicaría después y chocaría con la tabla)
    SpreadsheetApp.flush();

    let comoTabla = false;

    if (hayApiSheets_()) {
      try {
        Sheets.Spreadsheets.batchUpdate({
          requests: [{
            addTable: {
              table: {
                name: 'Historial',
                range: {
                  sheetId: hoja.getSheetId(),
                  startRowIndex: 0,
                  endRowIndex: 2,
                  startColumnIndex: 0,
                  endColumnIndex: n
                },
                columnProperties: COLUMNAS_HISTORIAL.map(function(c, i) {
                  const p = { columnIndex: i, columnName: c.enc, columnType: c.tipo };
                  if (c.lista) {
                    p.dataValidationRule = {
                      condition: {
                        type: 'ONE_OF_LIST',
                        values: c.lista.map(function(v) { return { userEnteredValue: v }; })
                      }
                    };
                  }
                  return p;
                })
              }
            }
          }]
        }, ss.getId());
        comoTabla = true;
      } catch (e) {
        console.error('No se pudo crear la tabla del historial: ' + e);
      }
    }

    if (!comoTabla) {
      // Sin la API: texto plano, fecha, encabezado con formato y listas
      COLUMNAS_HISTORIAL.forEach(function(c, i) {
        if (c.tipo === 'TEXT') hoja.getRange(2, i + 1, hoja.getMaxRows() - 1, 1).setNumberFormat('@');
      });
      hoja.getRange(2, 1, hoja.getMaxRows() - 1, 1).setNumberFormat('dd/mm/yyyy h:mm am/pm');

      hoja.getRange(1, 1, 1, n)
        .setBackground('#84303F').setFontColor('#FFFFFF').setFontWeight('bold');

      COLUMNAS_HISTORIAL.forEach(function(c, i) {
        if (!c.lista) return;
        hoja.getRange(2, i + 1, hoja.getMaxRows() - 1, 1).setDataValidation(
          SpreadsheetApp.newDataValidation().requireValueInList(c.lista, true)
            .setAllowInvalid(true).build()
        );
      });
    }

    hoja.setColumnWidth(1, 150);
    hoja.setColumnWidth(4, 220);
    hoja.setColumnWidth(6, 240);
    hoja.setColumnWidth(13, 240);
    hoja.setColumnWidth(14, 260);

    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

function hayApiSheets_() {
  return typeof Sheets !== 'undefined' && Sheets && Sheets.Spreadsheets;
}


/***********************
 * LECTURA POR ENCABEZADO
 ***********************/

function leerEncabezados_(hoja) {
  const columnas = Math.max(hoja.getLastColumn(), 1);
  return hoja.getRange(1, 1, 1, columnas).getValues()[0]
    .map(function(t) { return String(t).trim(); });
}

/** { 'Encabezado': índice desde 0 } */
function mapaDe_(encabezados) {
  const mapa = {};
  encabezados.forEach(function(t, i) {
    if (t && !(t in mapa)) mapa[t] = i;
  });
  return mapa;
}

/**
 * Lee el inventario completo.
 * Devuelve { encabezados, mapa, filas: [{ fila: número, valores: [...] }] }
 */
function leerInventario_(hoja) {
  const encabezados = leerEncabezados_(hoja);
  const mapa = mapaDe_(encabezados);
  const ultimaFila = hoja.getLastRow();
  const iId = mapa[ENCABEZADO.id];

  if (iId === undefined) {
    throw new Error('La hoja INVENTARIO_CCTV no tiene la columna "ID Cámara".');
  }

  const filas = [];

  if (ultimaFila >= 2) {
    hoja.getRange(2, 1, ultimaFila - 1, encabezados.length).getValues()
      .forEach(function(valores, i) {
        if (String(valores[iId] || '').trim() !== '') {
          filas.push({ fila: i + 2, valores: valores });
        }
      });
  }

  return { encabezados: encabezados, mapa: mapa, filas: filas };
}

/** Valor de un campo (clave de la app) en una fila leída. */
function valorDe_(inv, valores, clave) {
  const i = inv.mapa[ENCABEZADO[clave]];
  return i === undefined ? '' : valores[i];
}


/***********************
 * MARCAS DE SUBIDA (uuid)
 ***********************/

function hojaSubidas_(ss) {
  let hoja = ss.getSheetByName(NOMBRE_HOJA_SUBIDAS);

  if (!hoja) {
    hoja = ss.insertSheet(NOMBRE_HOJA_SUBIDAS);
    hoja.getRange(1, 1, 1, 3).setValues([['UUID', 'ID Cámara', 'Fecha']]);
    hoja.hideSheet();
  }

  return hoja;
}

function buscarSubida_(ss, uuid) {
  const hoja = hojaSubidas_(ss);
  const ultimaFila = hoja.getLastRow();

  if (ultimaFila < 2) return '';

  const filas = hoja.getRange(2, 1, ultimaFila - 1, 2).getValues();

  for (let i = 0; i < filas.length; i++) {
    if (String(filas[i][0]) === uuid) return String(filas[i][1]);
  }

  return '';
}

function anotarSubida_(ss, uuid, id) {
  hojaSubidas_(ss).appendRow([uuid, id, new Date()]);
}

/**
 * Fecha en que se tomó el dato en el celular. Si no viene o no es
 * creíble (futuro o más de 60 días atrás), se usa la del servidor.
 */
function fechaDeCaptura_(fechaCaptura) {
  const ahora = new Date();
  const fecha = new Date(Number(fechaCaptura));

  if (!fechaCaptura || isNaN(fecha.getTime())) return ahora;

  const diferencia = ahora.getTime() - fecha.getTime();

  if (diferencia < -5 * 60 * 1000 || diferencia > 60 * 24 * 60 * 60 * 1000) {
    return ahora;
  }

  return fecha;
}


/***********************
 * DUPLICADOS
 ***********************/

function menuEliminarDuplicados() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(NOMBRE_HOJA_INVENTARIO);

  if (!hoja) {
    ui.alert('No existe la hoja ' + NOMBRE_HOJA_INVENTARIO + '.');
    return;
  }

  const duplicados = buscarDuplicados_(hoja);

  if (duplicados.length === 0) {
    ui.alert('No se encontraron cámaras duplicadas.');
    return;
  }

  const lista = duplicados.map(function(d) {
    return d.id + ' (fila ' + d.fila + ')';
  }).join('\n');

  const respuesta = ui.alert(
    'Cámaras duplicadas',
    'Se eliminarán estas ' + duplicados.length +
    ' filas repetidas (se conserva el primer registro de cada cámara):\n\n' +
    lista +
    '\n\nAntes se creará una copia de respaldo de la hoja. ¿Continuar?',
    ui.ButtonSet.YES_NO
  );

  if (respuesta !== ui.Button.YES) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  let nombreRespaldo;

  try {
    nombreRespaldo = 'RESPALDO_' + Utilities.formatDate(
      new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss'
    );

    hoja.copyTo(ss).setName(nombreRespaldo);

    duplicados
      .map(function(d) { return d.fila; })
      .sort(function(a, b) { return b - a; })
      .forEach(function(fila) { hoja.deleteRow(fila); });

    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  actualizarPanel_();

  ui.alert(
    'Se eliminaron ' + duplicados.length + ' filas repetidas.\n' +
    'Respaldo creado en la hoja: ' + nombreRespaldo
  );
}

function buscarDuplicados_(hoja) {
  const inv = leerInventario_(hoja);
  const vistos = {};
  const duplicados = [];

  inv.filas.forEach(function(f) {
    const id = String(valorDe_(inv, f.valores, 'id')).trim();
    const huella = huellaFila_(inv, f.valores);

    if (vistos[id] && vistos[id].indexOf(huella) !== -1) {
      duplicados.push({ id: id, fila: f.fila });
      return;
    }

    if (!vistos[id]) vistos[id] = [];
    vistos[id].push(huella);
  });

  return duplicados;
}

/** Todo menos ID, fecha de registro y foto (esos cambian en un doble guardado). */
function huellaFila_(inv, valores) {
  const excluir = [
    inv.mapa[ENCABEZADO.id],
    inv.mapa[ENCABEZADO.fechaRegistro],
    inv.mapa[ENCABEZADO.fotografia]
  ];

  return valores
    .filter(function(v, i) { return excluir.indexOf(i) === -1; })
    .map(function(v) {
      if (v instanceof Date) return v.getTime();
      return String(v === null || v === undefined ? '' : v).trim();
    })
    .join('\u0001');
}


/***********************
 * GENERAR ID (con el bloqueo tomado)
 ***********************/

function generarID_(inv) {
  let mayor = 0;

  inv.filas.forEach(function(f) {
    const m = String(valorDe_(inv, f.valores, 'id')).match(/CAM-(\d+)/);
    if (m) mayor = Math.max(mayor, parseInt(m[1], 10));
  });

  return 'CAM-' + String(mayor + 1).padStart(4, '0');
}


/***********************
 * GUARDAR CÁMARA NUEVA
 ***********************/

function guardarRegistro(datos) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(NOMBRE_HOJA_INVENTARIO);

  datos = datos || {};

  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);
  } catch (e) {
    throw new Error('El sistema está ocupado guardando otra cámara. Intenta de nuevo en unos segundos.');
  }

  const uuid = String(datos.uuid || '').trim();
  let id;

  try {
    if (uuid) {
      const idPrevio = buscarSubida_(ss, uuid);
      if (idPrevio) {
        return { ok: true, id: idPrevio, duplicado: true, mensaje: 'Esta cámara ya había quedado registrada.' };
      }
    }

    const inv = leerInventario_(hoja);
    const fila = new Array(inv.encabezados.length).fill('');

    function poner(clave, valor) {
      const i = inv.mapa[ENCABEZADO[clave]];
      if (i !== undefined) fila[i] = valor;
    }

    CAMPOS_TEXTO.forEach(function(clave) {
      poner(clave, String(datos[clave] === undefined || datos[clave] === null ? '' : datos[clave]).trim());
    });

    poner('fechaRegistro', fechaDeCaptura_(datos.fechaCaptura));
    poner('ultimoMantenimiento', convertirFecha_(datos.ultimoMantenimiento));
    poner('proximoMantenimiento', convertirFecha_(datos.proximoMantenimiento));
    poner('registradoPor', String(datos.registradoPor || '').trim());

    // Doble toque de la app anterior (sin uuid)
    const repetida = uuid ? '' : buscarGuardadoReciente_(inv, fila);

    if (repetida) {
      return { ok: true, id: repetida, duplicado: true, mensaje: 'Esta cámara ya había quedado registrada.' };
    }

    id = generarID_(inv);
    poner('id', id);

    hoja.appendRow(fila);
    const numeroFila = hoja.getLastRow();

    if (datos.fotografia) {
      const archivo = guardarFotografia_(datos.fotografia, id, NOMBRE_CARPETA_FOTOS);
      ponerArchivoEnCelda_(hoja, numeroFila, inv.mapa[ENCABEZADO.fotografia] + 1, archivo, 'Foto');
    }

    if (uuid) anotarSubida_(ss, uuid, id);

    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  marcarPanelPendiente_();

  return { ok: true, id: id, mensaje: 'Cámara registrada correctamente.' };
}

function buscarGuardadoReciente_(inv, filaNueva) {
  if (!inv.filas.length) return '';

  const ultima = inv.filas[inv.filas.length - 1].valores;
  const fecha = valorDe_(inv, ultima, 'fechaRegistro');

  if (!(fecha instanceof Date)) return '';
  if (new Date().getTime() - fecha.getTime() > 10 * 1000) return '';
  if (huellaFila_(inv, ultima) !== huellaFila_(inv, filaNueva)) return '';

  return String(valorDe_(inv, ultima, 'id') || '');
}


/***********************
 * ACTUALIZAR CÁMARA
 * Solo cambia los campos que la app envía. La celda de la foto solo
 * se toca si llega una foto nueva (así el chip no se pierde).
 ***********************/

function actualizarRegistro(datos) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOMBRE_HOJA_INVENTARIO);

  if (!datos || !datos.id) throw new Error('No se recibió el ID de la cámara.');

  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);
  } catch (e) {
    throw new Error('El sistema está ocupado. Intenta de nuevo en unos segundos.');
  }

  try {
    const inv = leerInventario_(hoja);
    const encontrada = buscarFilaPorId_(inv, datos.id);

    if (!encontrada) throw new Error('No se encontró la cámara ' + datos.id);

    const valores = encontrada.valores.slice();
    const cambiadas = {};

    function poner(clave, valor) {
      const i = inv.mapa[ENCABEZADO[clave]];
      if (i === undefined) return;
      valores[i] = valor;
      cambiadas[i] = true;
    }

    // Un campo que la app no envía (por ejemplo, una versión vieja de
    // la app sin IP) se conserva como está.
    CAMPOS_TEXTO.forEach(function(clave) {
      if (datos[clave] === undefined || datos[clave] === null) return;
      poner(clave, String(datos[clave]).trim());
    });

    if (datos.ultimoMantenimiento !== undefined) {
      poner('ultimoMantenimiento', convertirFecha_(datos.ultimoMantenimiento));
    }

    if (datos.proximoMantenimiento !== undefined) {
      poner('proximoMantenimiento', convertirFecha_(datos.proximoMantenimiento));
    }

    // Escribir solo las celdas que cambiaron, en bloques seguidos
    escribirCeldas_(hoja, encontrada.fila, valores, cambiadas);

    if (datos.fotografia) {
      const archivo = guardarFotografia_(datos.fotografia, String(datos.id).trim(), NOMBRE_CARPETA_FOTOS);
      ponerArchivoEnCelda_(hoja, encontrada.fila, inv.mapa[ENCABEZADO.fotografia] + 1, archivo, 'Foto');
    }

    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  marcarPanelPendiente_();

  return { ok: true, mensaje: 'Cámara actualizada correctamente.' };
}

function buscarFilaPorId_(inv, id) {
  const buscado = String(id).trim();

  for (let i = 0; i < inv.filas.length; i++) {
    if (String(valorDe_(inv, inv.filas[i].valores, 'id')).trim() === buscado) {
      return inv.filas[i];
    }
  }

  return null;
}

/** Escribe en la fila solo las columnas marcadas, agrupando las seguidas. */
function escribirCeldas_(hoja, fila, valores, cambiadas) {
  const indices = Object.keys(cambiadas).map(Number).sort(function(a, b) { return a - b; });

  let inicio = null;
  let previo = null;

  function volcar() {
    if (inicio === null) return;
    hoja.getRange(fila, inicio + 1, 1, previo - inicio + 1)
      .setValues([valores.slice(inicio, previo + 1)]);
  }

  indices.forEach(function(i) {
    if (inicio === null) {
      inicio = i;
    } else if (i !== previo + 1) {
      volcar();
      inicio = i;
    }
    previo = i;
  });

  volcar();
}


/***********************
 * BUSCAR REGISTROS (para la app)
 ***********************/

function buscarRegistros(termino) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOMBRE_HOJA_INVENTARIO);
  const inv = leerInventario_(hoja);

  let filas = inv.filas;
  const texto = String(termino || '').trim().toLowerCase();

  if (texto) {
    filas = filas.filter(function(f) {
      return f.valores.some(function(v) { return String(v || '').toLowerCase().includes(texto); });
    });
  }

  return filas.map(function(f) { return registroDe_(inv, f.valores); });
}

function registroDe_(inv, valores) {
  const r = {};

  CAMPOS.forEach(function(c) {
    r[c[0]] = String(valorDe_(inv, valores, c[0]) === null ? '' : valorDe_(inv, valores, c[0]));
  });

  r.fechaRegistro = formatearFecha_(valorDe_(inv, valores, 'fechaRegistro'));
  r.ultimoMantenimiento = formatearFechaInput_(valorDe_(inv, valores, 'ultimoMantenimiento'));
  r.proximoMantenimiento = formatearFechaInput_(valorDe_(inv, valores, 'proximoMantenimiento'));

  return r;
}


/***********************
 * FOTOGRAFÍAS Y ARCHIVOS EN CELDA
 ***********************/

function carpeta_(nombre) {
  const carpetas = DriveApp.getFoldersByName(nombre);
  return carpetas.hasNext() ? carpetas.next() : DriveApp.createFolder(nombre);
}

function guardarFotografia_(base64, nombre, nombreCarpeta) {
  const partes = String(base64).split(',');

  if (partes.length < 2) throw new Error('Formato de fotografía inválido.');

  const blob = Utilities.newBlob(
    Utilities.base64Decode(partes[1]), 'image/jpeg', nombre + '.jpg'
  );

  return carpeta_(nombreCarpeta).createFile(blob);
}

/**
 * Pone un archivo de Drive en una celda como chip inteligente.
 * Si no se puede (sin la API de Sheets), como enlace con texto corto.
 */
function ponerArchivoEnCelda_(hoja, fila, columna, archivo, textoCorto) {
  const url = archivo.getUrl();

  if (hayApiSheets_()) {
    try {
      // La fila recién agregada debe estar escrita antes de usar la API
      SpreadsheetApp.flush();
      Sheets.Spreadsheets.batchUpdate({
        requests: [{
          updateCells: {
            rows: [{ values: [{
              userEnteredValue: { stringValue: '@' },
              chipRuns: [{ startIndex: 0, chip: { richLinkProperties: { uri: url } } }]
            }] }],
            fields: 'userEnteredValue,chipRuns',
            start: { sheetId: hoja.getSheetId(), rowIndex: fila - 1, columnIndex: columna - 1 }
          }
        }]
      }, hoja.getParent().getId());
      return;
    } catch (e) {
      console.error('No se pudo crear el chip: ' + e);
    }
  }

  hoja.getRange(fila, columna).setRichTextValue(
    SpreadsheetApp.newRichTextValue().setText(textoCorto).setLinkUrl(url).build()
  );
}


/***********************
 * HISTORIAL DE MANTENIMIENTO
 ***********************/

function guardarMantenimiento(d) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(NOMBRE_HOJA_HISTORIAL);
  const inventario = ss.getSheetByName(NOMBRE_HOJA_INVENTARIO);

  d = d || {};

  const idCamara = String(d.idCamara || '').trim();
  const uuid = String(d.uuid || '').trim();

  if (!idCamara) throw new Error('No se recibió el ID de la cámara.');
  if (TIPOS_MTTO.indexOf(d.tipo) === -1) throw new Error('Tipo de mantenimiento no válido.');
  if (!String(d.tecnico || '').trim()) throw new Error('Falta el nombre del técnico.');

  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);
  } catch (e) {
    throw new Error('El sistema está ocupado. Intenta de nuevo en unos segundos.');
  }

  let fecha;

  try {
    const historial = leerTablaSimple_(hoja);

    // Reintento de una subida que ya quedó guardada
    if (uuid && historial.filas.some(function(f) {
      return String(f[historial.mapa['UUID']]) === uuid;
    })) {
      return { ok: true, duplicado: true, mensaje: 'Este mantenimiento ya había quedado registrado.' };
    }

    const inv = leerInventario_(inventario);
    const camara = buscarFilaPorId_(inv, idCamara);

    if (!camara) throw new Error('No se encontró la cámara ' + idCamara + '.');

    fecha = fechaDeCaptura_(d.fechaCaptura);

    const ubicacion = [
      valorDe_(inv, camara.valores, 'edificacion'),
      valorDe_(inv, camara.valores, 'nivel'),
      valorDe_(inv, camara.valores, 'areaZona')
    ].filter(function(x) { return String(x).trim(); }).join(' · ');

    const huboFalla = d.huboFalla === true || d.huboFalla === 'Sí';
    const dias = Number(d.diasFuera);

    let archivo = null;

    if (d.foto) {
      const nombre = 'Mant_' + String(valorDe_(inv, camara.valores, 'sede') || 'Sede') + '_' +
        Utilities.formatDate(fecha, Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmm') + '_' + idCamara;
      archivo = guardarFotografia_(d.foto, nombre, NOMBRE_CARPETA_FOTOS_MTTO);
    }

    const valores = {
      'Fecha': fecha,
      'ID Cámara': idCamara,
      'Sede': String(valorDe_(inv, camara.valores, 'sede') || ''),
      'Ubicación': ubicacion,
      'Tipo': d.tipo,
      'Actividades': (Array.isArray(d.actividades) ? d.actividades : [])
        .map(function(a) { return String(a).trim(); }).filter(String).join(', '),
      'Estado de la imagen': ESTADOS_IMAGEN.indexOf(d.estadoImagen) !== -1 ? d.estadoImagen : '',
      'Hubo falla': huboFalla ? 'Sí' : 'No',
      'Falla': huboFalla ? String(d.falla || '').trim() : '',
      'Repuesto': huboFalla ? String(d.repuesto || '').trim() : '',
      'Días fuera de servicio': huboFalla && !isNaN(dias) && String(d.diasFuera).trim() !== '' ? dias : '',
      'Técnico': String(d.tecnico || '').trim(),
      'Observaciones': String(d.observaciones || '').trim(),
      'Foto de evidencia': archivo,
      'UUID': uuid
    };

    agregarFilaHistorial_(hoja, historial, valores);

    // Último mantenimiento de la cámara (solo si es más reciente)
    const iUltimo = inv.mapa[ENCABEZADO.ultimoMantenimiento];

    if (iUltimo !== undefined) {
      const actual = camara.valores[iUltimo];
      const dia = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());

      if (!(actual instanceof Date) || actual.getTime() < dia.getTime()) {
        inventario.getRange(camara.fila, iUltimo + 1).setValue(dia);
      }
    }

    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  marcarPanelPendiente_();

  return { ok: true, mensaje: 'Mantenimiento registrado.', fecha: formatearFecha_(fecha) };
}

/** Lee una hoja con encabezado en la fila 1: { encabezados, mapa, filas } */
function leerTablaSimple_(hoja) {
  const encabezados = leerEncabezados_(hoja);
  const ultimaFila = hoja.getLastRow();
  const filas = ultimaFila < 2 ? [] :
    hoja.getRange(2, 1, ultimaFila - 1, encabezados.length).getValues();

  return { encabezados: encabezados, mapa: mapaDe_(encabezados), filas: filas };
}

/**
 * Agrega una fila al historial dentro de la tabla (con la API de Sheets)
 * o, si no está disponible, al final de la hoja.
 * valores: { encabezado: valor }. Un archivo de Drive va como chip.
 */
function agregarFilaHistorial_(hoja, historial, valores) {
  const encabezados = historial.encabezados;

  // ¿La tabla aún tiene solo su fila vacía inicial?
  const filaVacia = historial.filas.length <= 1 && (historial.filas.length === 0 ||
    historial.filas[0].every(function(v) { return v === '' || v === null; }));

  if (hayApiSheets_()) {
    try {
      const celdas = encabezados.map(function(enc) {
        const v = valores[enc];

        if (v === undefined || v === null || v === '') return {};

        if (v instanceof Date) return { userEnteredValue: { numberValue: serialFecha_(v) } };
        if (typeof v === 'number') return { userEnteredValue: { numberValue: v } };

        if (typeof v === 'object' && v.getUrl) {
          return {
            userEnteredValue: { stringValue: '@' },
            chipRuns: [{ startIndex: 0, chip: { richLinkProperties: { uri: v.getUrl() } } }]
          };
        }

        return { userEnteredValue: { stringValue: String(v) } };
      });

      SpreadsheetApp.flush();

      const ssId = hoja.getParent().getId();
      const fields = 'userEnteredValue,chipRuns';
      let peticion;

      if (filaVacia) {
        peticion = { updateCells: {
          rows: [{ values: celdas }], fields: fields,
          start: { sheetId: hoja.getSheetId(), rowIndex: 1, columnIndex: 0 }
        } };
      } else {
        peticion = { appendCells: { sheetId: hoja.getSheetId(), rows: [{ values: celdas }], fields: fields } };
        const tablaId = idTablaHistorial_(hoja);
        if (tablaId) peticion.appendCells.tableId = tablaId;
      }

      Sheets.Spreadsheets.batchUpdate({ requests: [peticion] }, ssId);
      return;
    } catch (e) {
      console.error('Historial por API falló, se usa appendRow: ' + e);
    }
  }

  // Sin API
  const fila = encabezados.map(function(enc) {
    const v = valores[enc];
    if (v && typeof v === 'object' && v.getUrl) return '';
    return v === undefined || v === null ? '' : v;
  });

  let numeroFila;

  if (filaVacia) {
    numeroFila = 2;
    hoja.getRange(2, 1, 1, fila.length).setValues([fila]);
  } else {
    hoja.appendRow(fila);
    numeroFila = hoja.getLastRow();
  }

  const iFoto = encabezados.indexOf('Foto de evidencia');
  const archivo = valores['Foto de evidencia'];

  if (archivo && iFoto !== -1) {
    ponerArchivoEnCelda_(hoja, numeroFila, iFoto + 1, archivo, 'Foto');
  }
}

function idTablaHistorial_(hoja) {
  try {
    const info = Sheets.Spreadsheets.get(hoja.getParent().getId(), {
      fields: 'sheets(properties(sheetId),tables(tableId))'
    });

    for (let i = 0; i < info.sheets.length; i++) {
      const s = info.sheets[i];
      if (s.properties.sheetId === hoja.getSheetId() && s.tables && s.tables.length) {
        return s.tables[0].tableId;
      }
    }
  } catch (e) {
    console.error('No se pudo leer la tabla del historial: ' + e);
  }

  return '';
}

/** Número de serie de Sheets para una fecha, en la zona de la hoja. */
function serialFecha_(fecha) {
  const zona = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const p = Utilities.formatDate(fecha, zona, 'yyyy-MM-dd-HH-mm-ss').split('-').map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5]) / 86400000 + 25569;
}

/** Todo el historial, del más reciente al más antiguo. */
function leerHistorial_() {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOMBRE_HOJA_HISTORIAL);

  if (!hoja) return [];

  const t = leerTablaSimple_(hoja);
  const m = t.mapa;

  function v(fila, enc) {
    return m[enc] === undefined ? '' : fila[m[enc]];
  }

  return t.filas
    .filter(function(f) { return String(v(f, 'ID Cámara')).trim() !== ''; })
    .map(function(f) {
      const fecha = v(f, 'Fecha');
      return {
        fecha: formatearFecha_(fecha),
        orden: fecha instanceof Date ? fecha.getTime() : 0,
        idCamara: String(v(f, 'ID Cámara')),
        tipo: String(v(f, 'Tipo')),
        actividades: String(v(f, 'Actividades')),
        estadoImagen: String(v(f, 'Estado de la imagen')),
        huboFalla: String(v(f, 'Hubo falla')) === 'Sí',
        falla: String(v(f, 'Falla')),
        repuesto: String(v(f, 'Repuesto')),
        diasFuera: v(f, 'Días fuera de servicio') === '' ? '' : String(v(f, 'Días fuera de servicio')),
        tecnico: String(v(f, 'Técnico')),
        observaciones: String(v(f, 'Observaciones')),
        tieneFoto: String(v(f, 'Foto de evidencia')).trim() !== '',
        uuid: String(v(f, 'UUID'))
      };
    })
    .sort(function(a, b) { return b.orden - a.orden; });
}


/***********************
 * CONTEOS
 ***********************/

function normalizar_(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim().toLowerCase();
}

/**
 * Cuenta por valor. Usa los nombres de la lista base en su orden y
 * agrega al final cualquier otro valor encontrado; los vacíos van como
 * "Sin dato". Nunca se pierde una cámara del conteo.
 */
function contarConLista_(valores, lista) {
  const conteo = {};
  const nombreDe = {};

  valores.forEach(function(v) {
    const clave = normalizar_(v);
    conteo[clave] = (conteo[clave] || 0) + 1;
    if (clave && !nombreDe[clave]) nombreDe[clave] = String(v).trim();
  });

  const filas = [];
  const usadas = {};

  lista.forEach(function(nombre) {
    const clave = normalizar_(nombre);
    usadas[clave] = true;
    filas.push([nombre, conteo[clave] || 0]);
  });

  Object.keys(conteo).sort().forEach(function(clave) {
    if (usadas[clave] || clave === '') return;
    filas.push([nombreDe[clave], conteo[clave]]);
  });

  if (conteo['']) filas.push(['Sin dato', conteo['']]);

  return filas;
}

function ordenarNivel_(nivel) {
  const texto = normalizar_(nivel);

  if (texto === 'sótano' || texto === 'sotano') return -1;
  if (texto === 'azotea') return 999;

  const m = texto.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 1000;
}

function contarPorNivel_(camaras) {
  const grupos = {};

  camaras.forEach(function(c) {
    const ed = String(c.edificacion || '').trim() || 'Sin edificación';
    const nivel = String(c.nivel || '').trim() || 'Sin nivel';

    if (!grupos[ed]) grupos[ed] = { edificacion: ed, total: 0, niveles: {} };

    grupos[ed].total++;
    grupos[ed].niveles[nivel] = (grupos[ed].niveles[nivel] || 0) + 1;
  });

  function posicion(nombre) {
    const i = LISTA_EDIFICACIONES.indexOf(nombre);
    return i === -1 ? 999 : i;
  }

  return Object.keys(grupos)
    .sort(function(a, b) { return posicion(a) - posicion(b) || a.localeCompare(b); })
    .map(function(nombre) {
      const g = grupos[nombre];
      return {
        edificacion: g.edificacion,
        total: g.total,
        niveles: Object.keys(g.niveles)
          .sort(function(a, b) { return ordenarNivel_(a) - ordenarNivel_(b) || a.localeCompare(b); })
          .map(function(n) { return [n, g.niveles[n]]; })
      };
    });
}

function vacio_(v) {
  return String(v === null || v === undefined ? '' : v).trim() === '';
}


/***********************
 * PANEL DE CONTROL
 *
 * El script escribe solo en las columnas A..H y las borra antes de
 * escribir. Las columnas J en adelante son NOTAS: nunca se tocan.
 ***********************/

/***********************
 * PANEL AUTOMÁTICO (cada 15 minutos)
 * Guardar desde la app ya no rearma el panel (tardaba unos segundos
 * por registro): solo deja una marca. Cada 15 minutos, si hay marca,
 * el panel se actualiza solo. "Actualizar panel" del menú lo hace ya.
 ***********************/

const PROPIEDAD_PANEL_PENDIENTE = 'PANEL_PENDIENTE';

function marcarPanelPendiente_() {
  PropertiesService.getScriptProperties().setProperty(PROPIEDAD_PANEL_PENDIENTE, String(new Date().getTime()));
}

/** La ejecuta el activador cada 15 minutos. */
function panelProgramado() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(PROPIEDAD_PANEL_PENDIENTE)) return;

  props.deleteProperty(PROPIEDAD_PANEL_PENDIENTE);
  actualizarPanelSeguro_();
}

/** Crea el activador de 15 minutos (una sola vez; si ya existe no duplica). */
function menuActivarPanelAutomatico() {
  const existe = ScriptApp.getProjectTriggers().some(function(t) {
    return t.getHandlerFunction() === 'panelProgramado';
  });

  if (!existe) {
    ScriptApp.newTrigger('panelProgramado').timeBased().everyMinutes(15).create();
  }

  marcarPanelPendiente_();

  try {
    SpreadsheetApp.getUi().alert(existe
      ? 'El panel automático ya estaba activo: se actualiza cada 15 minutos cuando hay registros nuevos.'
      : 'Listo: el panel se actualizará solo cada 15 minutos cuando haya registros nuevos.');
  } catch (e) { /* ejecutado desde el editor */ }
}

function actualizarPanelSeguro_() {
  try {
    actualizarPanel_();
  } catch (e) {
    console.error('No se pudo actualizar el panel: ' + e);
  }
}

function actualizarPanel_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaInv = ss.getSheetByName(NOMBRE_HOJA_INVENTARIO);
  let panel = ss.getSheetByName(NOMBRE_HOJA_PANEL);

  if (!hojaInv) return;
  if (!panel) panel = ss.insertSheet(NOMBRE_HOJA_PANEL);

  migrarNotasPanel_(panel);

  const inv = leerInventario_(hojaInv);
  const camaras = inv.filas.map(function(f) { return registroDe_(inv, f.valores); });
  const historial = leerHistorial_();

  // ---------- Contenido ----------
  const celdas = [];
  const formatos = { titulos: [], encabezados: [], subtitulos: [], bordes: [], alertas: [], unir: [] };
  let fila = 1;

  function poner(f, c, v) {
    while (celdas.length < f) celdas.push(new Array(PANEL_COLUMNAS).fill(''));
    celdas[f - 1][c - 1] = v;
  }

  function a1(f1, c1, f2, c2) {
    function col(c) { return String.fromCharCode(64 + c); }
    return col(c1) + f1 + ':' + col(c2) + f2;
  }

  function seccion(titulo) {
    fila++;
    poner(fila, 1, titulo);
    formatos.titulos.push(a1(fila, 1, fila, PANEL_COLUMNAS));
    fila++;
  }

  /** Tabla de 2 columnas (nombre | cantidad) que empieza en la columna c. */
  function tabla2(f0, c, t1, t2, filas) {
    poner(f0, c, t1);
    poner(f0, c + 1, t2);
    formatos.encabezados.push(a1(f0, c, f0, c + 1));
    filas.forEach(function(p, i) {
      poner(f0 + 1 + i, c, p[0]);
      poner(f0 + 1 + i, c + 1, p[1]);
    });
    formatos.bordes.push(a1(f0, c, f0 + filas.length, c + 1));
    return f0 + filas.length;
  }

  const ahora = new Date();
  const zona = Session.getScriptTimeZone();
  const mesActual = Utilities.formatDate(ahora, zona, 'yyyy-MM');

  function porSede(sede) {
    return camaras.filter(function(c) { return normalizar_(c.sede) === normalizar_(sede); });
  }

  function cuenta(lista, prueba) {
    return lista.filter(prueba).length;
  }

  const darImagen = function(c) { return /^operativa/i.test(String(c.estado).trim()); };
  const conNovedad = function(c) { return normalizar_(c.estado) === 'operativa con novedad'; };
  const fuera = function(c) { return normalizar_(c.estado) === 'fuera de servicio'; };
  const intermitente = function(c) { return normalizar_(c.estado) === 'intermitente'; };
  const enMtto = function(c) { return normalizar_(c.estado) === 'en mantenimiento'; };
  const buenFisico = function(c) { return normalizar_(c.estadoFisico) === 'bueno'; };
  const cableadoRevisado = function(c) {
    const e = normalizar_(c.estadoCableado);
    return e !== '' && e !== 'no verificado';
  };

  // Cámaras con al menos un mantenimiento en el historial
  const conHistorial = {};
  historial.forEach(function(h) { conHistorial[String(h.idCamara).trim()] = true; });

  const sedeDe = {};
  camaras.forEach(function(c) { sedeDe[String(c.id).trim()] = c.sede; });

  // Título
  poner(1, 1, 'PANEL DE CONTROL — INVENTARIO CCTV');
  poner(2, 1, 'Actualizado: ' + formatearFechaHora12_(ahora) +
    '   ·   Se actualiza solo cada 15 min · columnas J en adelante: notas (nunca se borran).');

  // Indicadores
  poner(3, 1, 'TOTAL DE CÁMARAS');
  poner(3, 3, 'DAN IMAGEN');
  poner(3, 5, 'CON NOVEDAD');
  poner(3, 7, 'FUERA DE SERVICIO');
  poner(4, 1, camaras.length);
  poner(4, 3, cuenta(camaras, darImagen));
  poner(4, 5, cuenta(camaras, conNovedad));
  poner(4, 7, cuenta(camaras, fuera));
  fila = 5;

  // ---- Mantenimiento ----
  seccion('MANTENIMIENTO (desde la hoja HISTORIAL_CCTV)');

  const encMtto = ['SEDE', 'CÁMARAS', 'CON MANTENIMIENTO', 'PENDIENTES',
                   'REGISTROS ESTE MES', 'FALLAS ESTE MES', 'DÍAS FUERA (PROM.)', 'ÚLTIMO REGISTRO'];
  encMtto.forEach(function(t, i) { poner(fila, i + 1, t); });
  formatos.encabezados.push(a1(fila, 1, fila, 8));
  const filaEncMtto = fila;

  const sedesMtto = LISTA_SEDES.concat(['Total']);

  sedesMtto.forEach(function(sede) {
    fila++;
    const lista = sede === 'Total' ? camaras : porSede(sede);
    const regs = historial.filter(function(h) {
      return sede === 'Total' || normalizar_(sedeDe[String(h.idCamara).trim()]) === normalizar_(sede);
    });
    const delMes = regs.filter(function(h) {
      return h.orden && Utilities.formatDate(new Date(h.orden), zona, 'yyyy-MM') === mesActual;
    });
    const dias = regs.filter(function(h) { return h.huboFalla && h.diasFuera !== '' && !isNaN(Number(h.diasFuera)); })
      .map(function(h) { return Number(h.diasFuera); });
    const conMtto = cuenta(lista, function(c) { return conHistorial[String(c.id).trim()]; });

    poner(fila, 1, sede);
    poner(fila, 2, lista.length);
    poner(fila, 3, conMtto);
    poner(fila, 4, lista.length - conMtto);
    poner(fila, 5, delMes.length);
    poner(fila, 6, delMes.filter(function(h) { return h.huboFalla; }).length);
    poner(fila, 7, dias.length ? Math.round(dias.reduce(function(a, b) { return a + b; }, 0) / dias.length * 10) / 10 : '—');
    poner(fila, 8, regs.length ? regs[0].fecha : '—');

    if (sede === 'Total') formatos.subtitulos.push(a1(fila, 1, fila, 8));
  });

  formatos.bordes.push(a1(filaEncMtto, 1, fila, 8));

  // ---- Resumen por sede ----
  seccion('RESUMEN POR SEDE');

  poner(fila, 1, 'INDICADOR');
  poner(fila, 5, 'BARRANQUILLA');
  poner(fila, 6, 'BARANOA');
  poner(fila, 7, 'TOTAL');
  formatos.unir.push(a1(fila, 1, fila, 4));
  formatos.encabezados.push(a1(fila, 1, fila, 7));
  const filaEncSede = fila;

  const indicadores = [
    ['Cámaras que dan imagen', darImagen],
    ['   de ellas con imagen degradada (con novedad)', conNovedad],
    ['Cámaras sin imagen (fuera de servicio)', fuera],
    ['Intermitentes', intermitente],
    ['En mantenimiento', enMtto],
    ['Equipo en buen estado físico (carcasa, soporte, lente)', buenFisico],
    ['Cableado revisado', cableadoRevisado],
    ['Con mantenimiento registrado', function(c) { return conHistorial[String(c.id).trim()]; }],
    ['Total de cámaras', function() { return true; }]
  ];

  indicadores.forEach(function(ind) {
    fila++;
    const b = cuenta(porSede('Barranquilla'), ind[1]);
    const r = cuenta(porSede('Baranoa'), ind[1]);
    poner(fila, 1, ind[0]);
    formatos.unir.push(a1(fila, 1, fila, 4));
    poner(fila, 5, b);
    poner(fila, 6, r);
    poner(fila, 7, cuenta(camaras, ind[1]));
  });

  // Verificación: dan imagen + sin imagen + intermitentes + en mantenimiento = total
  fila++;
  poner(fila, 1, 'Verificación (todas las cámaras tienen un estado válido)');
  formatos.unir.push(a1(fila, 1, fila, 4));
  LISTA_SEDES.forEach(function(sede, i) {
    const l = porSede(sede);
    const suma = cuenta(l, darImagen) + cuenta(l, fuera) + cuenta(l, intermitente) + cuenta(l, enMtto);
    poner(fila, 5 + i, suma === l.length ? 'OK' : 'Revisar: ' + (l.length - suma) + ' sin estado');
    if (suma !== l.length) formatos.alertas.push(a1(fila, 5 + i, fila, 5 + i));
  });
  formatos.bordes.push(a1(filaEncSede, 1, fila, 7));

  // ---- Distribución ----
  seccion('DISTRIBUCIÓN');

  const f0 = fila;
  const finA = tabla2(f0, 1, 'ESTADO', 'CANTIDAD', contarConLista_(camaras.map(function(c) { return c.estado; }), LISTA_ESTADOS));
  const finB = tabla2(f0, 4, 'TIPO DE CÁMARA', 'CANTIDAD', contarConLista_(camaras.map(function(c) { return c.tipoCamara; }), LISTA_TIPOS_CAMARA));
  const finC = tabla2(f0, 7, 'SUBZONA', 'CÁMARAS', contarConLista_(camaras.map(function(c) { return c.subzona; }), LISTA_SUBZONAS));
  fila = Math.max(finA, finB, finC) + 2;

  const f1 = fila;
  const finD = tabla2(f1, 1, 'EDIFICACIÓN', 'CÁMARAS', contarConLista_(camaras.map(function(c) { return c.edificacion; }), LISTA_EDIFICACIONES));
  const finE = tabla2(f1, 4, 'TIPO DE UBICACIÓN', 'CÁMARAS', contarConLista_(camaras.map(function(c) { return c.tipoUbicacion; }), LISTA_TIPOS_UBICACION));
  fila = Math.max(finD, finE);

  // ---- Datos que faltan ----
  seccion('DATOS QUE FALTAN (para completar la hoja de vida)');

  const faltantes = [
    ['Sin subzona', function(c) { return vacio_(c.subzona); }],
    ['Sin serial', function(c) { return vacio_(c.serial); }],
    ['Sin marca', function(c) { return vacio_(c.marca); }],
    ['Sin IP', function(c) { return vacio_(c.ip); }],
    ['Sin NVR / DVR', function(c) { return vacio_(c.nvr); }],
    ['Sin canal', function(c) { return vacio_(c.canal); }],
    ['Cableado sin revisar', function(c) { return !cableadoRevisado(c); }],
    ['Sin fotografía', function(c) { return vacio_(c.fotografia); }]
  ];

  poner(fila, 1, 'DATO');
  poner(fila, 5, 'BARRANQUILLA');
  poner(fila, 6, 'BARANOA');
  poner(fila, 7, 'TOTAL');
  formatos.unir.push(a1(fila, 1, fila, 4));
  formatos.encabezados.push(a1(fila, 1, fila, 7));
  const filaEncFalta = fila;

  faltantes.forEach(function(ff) {
    fila++;
    poner(fila, 1, ff[0]);
    formatos.unir.push(a1(fila, 1, fila, 4));
    poner(fila, 5, cuenta(porSede('Barranquilla'), ff[1]));
    poner(fila, 6, cuenta(porSede('Baranoa'), ff[1]));
    poner(fila, 7, cuenta(camaras, ff[1]));
  });
  formatos.bordes.push(a1(filaEncFalta, 1, fila, 7));

  // ---- Lista de cámaras sin imagen ----
  const sinImagen = camaras.filter(function(c) { return fuera(c) || intermitente(c); });

  seccion('CÁMARAS SIN IMAGEN O INTERMITENTES (' + sinImagen.length + ')');

  ['ID', 'SEDE', 'EDIFICACIÓN', 'NIVEL', 'ÁREA / ZONA', 'ESTADO', 'OBSERVACIONES', '']
    .forEach(function(t, i) { poner(fila, i + 1, t); });
  formatos.unir.push(a1(fila, 7, fila, 8));
  formatos.encabezados.push(a1(fila, 1, fila, 8));
  const filaEncLista = fila;

  if (!sinImagen.length) {
    fila++;
    poner(fila, 1, 'Ninguna. Todas las cámaras dan imagen.');
    formatos.unir.push(a1(fila, 1, fila, 8));
  }

  sinImagen
    .sort(function(a, b) { return String(a.sede).localeCompare(String(b.sede)) || String(a.id).localeCompare(String(b.id)); })
    .forEach(function(c) {
      fila++;
      poner(fila, 1, c.id);
      poner(fila, 2, c.sede);
      poner(fila, 3, c.edificacion);
      poner(fila, 4, c.nivel);
      poner(fila, 5, c.areaZona);
      poner(fila, 6, c.estado);
      poner(fila, 7, c.observaciones);
      formatos.unir.push(a1(fila, 7, fila, 8));
    });
  formatos.bordes.push(a1(filaEncLista, 1, fila, 8));

  // ---- Por nivel ----
  seccion('CÁMARAS POR NIVEL / PISO');

  poner(fila, 1, 'NIVEL / PISO');
  poner(fila, 2, 'CÁMARAS');
  formatos.encabezados.push(a1(fila, 1, fila, 2));
  const filaEncNivel = fila;

  contarPorNivel_(camaras).forEach(function(g) {
    fila++;
    poner(fila, 1, g.edificacion);
    poner(fila, 2, g.total);
    formatos.subtitulos.push(a1(fila, 1, fila, 2));
    g.niveles.forEach(function(p) {
      fila++;
      poner(fila, 1, p[0]);
      poner(fila, 2, p[1]);
    });
  });
  formatos.bordes.push(a1(filaEncNivel, 1, fila, 2));

  // ---------- Escribir: solo columnas A..H ----------
  const totalFilas = celdas.length;

  if (panel.getMaxRows() < totalFilas + 5) {
    panel.insertRowsAfter(panel.getMaxRows(), totalFilas + 5 - panel.getMaxRows());
  }

  if (panel.getMaxColumns() < PANEL_COLUMNA_NOTAS + 2) {
    panel.insertColumnsAfter(panel.getMaxColumns(), PANEL_COLUMNA_NOTAS + 2 - panel.getMaxColumns());
  }

  const zonaPanel = panel.getRange(1, 1, panel.getMaxRows(), PANEL_COLUMNAS);
  zonaPanel.breakApart();
  zonaPanel.clear();

  const todo = panel.getRange(1, 1, totalFilas, PANEL_COLUMNAS);
  todo.setValues(celdas);
  todo.setVerticalAlignment('middle').setWrap(true).setFontFamily('Arial').setFontSize(10);

  // ---------- Formato ----------
  const VINO = '#84303F';
  const ROSA = '#F7E3E6';
  const ROSA_FUERTE = '#FFCCD4';

  panel.getRange('A1:H1').merge()
    .setBackground(VINO).setFontColor('#FFFFFF').setFontWeight('bold')
    .setFontSize(16).setHorizontalAlignment('center');
  panel.setRowHeight(1, 40);

  panel.getRange('A2:H2').merge()
    .setFontColor('#45343A').setFontStyle('italic').setHorizontalAlignment('right');

  ['A3:B3', 'C3:D3', 'E3:F3', 'G3:H3', 'A4:B4', 'C4:D4', 'E4:F4', 'G4:H4']
    .forEach(function(r) { panel.getRange(r).merge(); });

  panel.getRange('A3:H3').setBackground(ROSA).setFontWeight('bold')
    .setFontColor('#45343A').setHorizontalAlignment('center');
  panel.getRange('A4:H4').setFontSize(22).setFontWeight('bold')
    .setFontColor(VINO).setHorizontalAlignment('center');
  panel.setRowHeight(4, 44);

  formatos.unir.forEach(function(r) { panel.getRange(r).merge(); });

  if (formatos.titulos.length) {
    formatos.titulos.forEach(function(r) { panel.getRange(r).merge(); });
    panel.getRangeList(formatos.titulos)
      .setBackground(VINO).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(11);
  }

  if (formatos.encabezados.length) {
    panel.getRangeList(formatos.encabezados)
      .setBackground(ROSA_FUERTE).setFontColor('#33030F').setFontWeight('bold')
      .setHorizontalAlignment('center');
  }

  if (formatos.subtitulos.length) {
    panel.getRangeList(formatos.subtitulos).setBackground(ROSA).setFontWeight('bold');
  }

  if (formatos.bordes.length) {
    panel.getRangeList(formatos.bordes)
      .setBorder(true, true, true, true, true, true, '#D3B8BC', SpreadsheetApp.BorderStyle.SOLID);
  }

  if (formatos.alertas.length) {
    panel.getRangeList(formatos.alertas).setBackground('#FCE4E1').setFontColor('#B3261E').setFontWeight('bold');
  }

  [230, 100, 110, 110, 110, 110, 120, 130].forEach(function(w, i) { panel.setColumnWidth(i + 1, w); });
  panel.setColumnWidth(9, 24);

  panel.setFrozenRows(1);
}

/**
 * Una sola vez: pasa a la columna de NOTAS los textos que se habían
 * escrito a mano en el panel (fuera de A..H), y deja esas columnas
 * limpias para notas.
 */
function migrarNotasPanel_(panel) {
  const props = PropertiesService.getScriptProperties();

  if (props.getProperty(PROPIEDAD_NOTAS_MIGRADAS)) return;

  const ultimaFila = Math.max(panel.getLastRow(), 1);
  const ultimaCol = panel.getMaxColumns();
  const notas = [];

  if (ultimaCol >= PANEL_COLUMNAS + 1) {
    const rango = panel.getRange(1, PANEL_COLUMNAS + 1, ultimaFila, ultimaCol - PANEL_COLUMNAS);
    const valores = rango.getValues();
    const formulas = rango.getFormulas();

    valores.forEach(function(fila, i) {
      fila.forEach(function(v, j) {
        if (formulas[i][j]) return;
        const texto = String(v).trim();
        // Las notas son frases (terminan en punto); los rótulos de tablas no
        if (typeof v === 'string' && texto.length > 30 && /[.!?]$/.test(texto)) notas.push(texto);
      });
    });

    rango.breakApart();
    rango.clear();
  }

  const c = PANEL_COLUMNA_NOTAS;

  panel.getRange(1, c).setValue('NOTAS')
    .setBackground('#84303F').setFontColor('#FFFFFF').setFontWeight('bold');
  panel.getRange(2, c).setValue('Escribe aquí debajo. El panel se actualiza solo y nunca borra esta columna.')
    .setFontStyle('italic').setFontColor('#45343A').setWrap(true);

  notas.forEach(function(n, i) {
    panel.getRange(3 + i, c).setValue(n).setWrap(true).setVerticalAlignment('top');
  });

  panel.setColumnWidth(c, 380);

  props.setProperty(PROPIEDAD_NOTAS_MIGRADAS, String(new Date().getTime()));
}


/***********************
 * HOJAS DE VIDA (PDF)
 ***********************/

function menuHojaDeVidaCamara() {
  const ui = SpreadsheetApp.getUi();

  const r = ui.prompt('Hoja de vida', 'Escribe el ID de la cámara (por ejemplo CAM-0045):', ui.ButtonSet.OK_CANCEL);

  if (r.getSelectedButton() !== ui.Button.OK) return;

  let id = String(r.getResponseText() || '').trim().toUpperCase();

  if (/^\d+$/.test(id)) id = 'CAM-' + id.padStart(4, '0');

  const archivo = generarHojasDeVida_(function(c) { return String(c.id).trim().toUpperCase() === id; },
    'Hoja de vida ' + id);

  if (!archivo) {
    ui.alert('No se encontró la cámara ' + id + '.');
    return;
  }

  mostrarEnlace_(archivo, 'Hoja de vida de ' + id);
}

function menuHojasBarranquilla() { menuHojasSede_('Barranquilla'); }
function menuHojasBaranoa() { menuHojasSede_('Baranoa'); }

function menuHojasSede_(sede) {
  const zona = Session.getScriptTimeZone();
  const archivo = generarHojasDeVida_(
    function(c) { return normalizar_(c.sede) === normalizar_(sede); },
    'Hojas de vida CCTV ' + sede + ' ' + Utilities.formatDate(new Date(), zona, 'yyyy-MM-dd')
  );

  if (!archivo) {
    SpreadsheetApp.getUi().alert('No hay cámaras de ' + sede + '.');
    return;
  }

  mostrarEnlace_(archivo, 'Hojas de vida de ' + sede);
}

function mostrarEnlace_(archivo, titulo) {
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial;font-size:14px;line-height:1.5">' +
    '<p>Se guardó en la carpeta <b>' + NOMBRE_CARPETA_PDF + '</b> de Drive.</p>' +
    '<p><a href="' + archivo.getUrl() + '" target="_blank" ' +
    'style="display:inline-block;padding:10px 18px;background:#84303F;color:#fff;' +
    'border-radius:20px;text-decoration:none;font-weight:bold">Abrir el PDF</a></p></div>'
  ).setWidth(360).setHeight(150);

  SpreadsheetApp.getUi().showModalDialog(html, titulo);
}

/**
 * Genera un PDF con una página por cámara (las que cumplan "filtro")
 * y lo guarda en Drive. Devuelve el archivo o null si no hubo cámaras.
 */
function generarHojasDeVida_(filtro, nombre) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inv = leerInventario_(ss.getSheetByName(NOMBRE_HOJA_INVENTARIO));

  const camaras = inv.filas.map(function(f) { return registroDe_(inv, f.valores); }).filter(filtro);

  if (!camaras.length) return null;

  camaras.sort(function(a, b) { return String(a.id).localeCompare(String(b.id)); });

  // Historial agrupado por cámara (del más antiguo al más reciente)
  const porCamara = {};
  leerHistorial_().slice().reverse().forEach(function(h) {
    const k = String(h.idCamara).trim();
    (porCamara[k] = porCamara[k] || []).push(h);
  });

  const logo = logoBase64_();
  const fotos = indiceFotos_();
  const zona = Session.getScriptTimeZone();
  const hoy = Utilities.formatDate(new Date(), zona, 'dd/MM/yyyy');

  const paginas = camaras.map(function(c, i) {
    return paginaHojaDeVida_(c, porCamara[String(c.id).trim()] || [], logo, fotoBase64_(fotos, c.id), hoy,
      i === camaras.length - 1);
  });

  const html =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + estiloHojaDeVida_() + '</style></head><body>' +
    paginas.join('') + '</body></html>';

  const pdf = HtmlService.createHtmlOutput(html).getAs('application/pdf').setName(nombre + '.pdf');

  return carpeta_(NOMBRE_CARPETA_PDF).createFile(pdf);
}

function logoBase64_() {
  try {
    const r = UrlFetchApp.fetch(URL_LOGO, { muteHttpExceptions: true });
    if (r.getResponseCode() === 200) {
      return 'data:image/jpeg;base64,' + Utilities.base64Encode(r.getContent());
    }
  } catch (e) {
    console.error('No se pudo traer el logo: ' + e);
  }
  return '';
}

/** { 'CAM-0001': archivo más reciente } de la carpeta de fotos */
function indiceFotos_() {
  const indice = {};
  const carpetas = DriveApp.getFoldersByName(NOMBRE_CARPETA_FOTOS);

  if (!carpetas.hasNext()) return indice;

  const archivos = carpetas.next().getFiles();

  while (archivos.hasNext()) {
    const a = archivos.next();
    const id = a.getName().replace(/\.[^.]+$/, '').trim().toUpperCase();
    if (!indice[id] || indice[id].getDateCreated() < a.getDateCreated()) indice[id] = a;
  }

  return indice;
}

function fotoBase64_(indice, id) {
  const a = indice[String(id).trim().toUpperCase()];

  if (!a) return '';

  try {
    const miniatura = a.getThumbnail();
    const blob = miniatura || a.getBlob();
    return 'data:' + (blob.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (e) {
    return '';
  }
}

/**
 * Foto de una cámara como data URL de unos 800 px (o '' si no tiene).
 * Se busca por nombre en la carpeta de fotos: CAM-0001.jpg
 */
function fotoCamara_(id) {
  const nombre = String(id || '').trim().toUpperCase();
  if (!/^CAM-\d+$/.test(nombre)) return '';

  const carpetas = DriveApp.getFoldersByName(NOMBRE_CARPETA_FOTOS);
  if (!carpetas.hasNext()) return '';

  const archivos = carpetas.next().getFilesByName(nombre + '.jpg');
  let archivo = null;

  while (archivos.hasNext()) {
    const a = archivos.next();
    if (!archivo || archivo.getDateCreated() < a.getDateCreated()) archivo = a;
  }

  if (!archivo) return '';

  // Miniatura mediana de Drive (pesa poco y se ve bien en el PDF)
  try {
    const r = UrlFetchApp.fetch('https://drive.google.com/thumbnail?id=' + archivo.getId() + '&sz=w800', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (r.getResponseCode() === 200 && /^image\//.test(String(r.getHeaders()['Content-Type'] || r.getBlob().getContentType()))) {
      return 'data:image/jpeg;base64,' + Utilities.base64Encode(r.getContent());
    }
  } catch (e) {
    console.error('Miniatura de Drive: ' + e);
  }

  // Respaldo: la foto original si no es muy pesada
  try {
    const blob = archivo.getBlob();
    if (blob.getBytes().length < 1500000) {
      return 'data:' + (blob.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(blob.getBytes());
    }
    const mini = archivo.getThumbnail();
    if (mini) return 'data:image/png;base64,' + Utilities.base64Encode(mini.getBytes());
  } catch (e) {
    console.error('Foto de ' + nombre + ': ' + e);
  }

  return '';
}

function esc_(t) {
  return String(t === null || t === undefined ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fechaCorta_(textoInput) {
  const m = String(textoInput || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
}

function estiloHojaDeVida_() {
  return [
    '@page { size: letter; margin: 14mm 12mm; }',
    'body { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; color: #160D0E; }',
    '.pagina { page-break-after: always; }',
    '.ultima { page-break-after: auto; }',
    'table { border-collapse: collapse; width: 100%; }',
    'td, th { font-size: 9pt; }',
    '.cab td { vertical-align: middle; }',
    '.cab .tit { font-size: 15pt; font-weight: bold; color: #84303F; }',
    '.cab .sub { font-size: 9pt; color: #45343A; }',
    '.cab .fmt { font-size: 8pt; color: #45343A; text-align: right; border: 1px solid #D3B8BC; padding: 4px 6px; }',
    '.linea { border-bottom: 2.5px solid #84303F; margin: 6px 0 8px; }',
    '.idcam { font-size: 13pt; font-weight: bold; }',
    '.estado { font-size: 9pt; font-weight: bold; padding: 2px 8px; border: 1px solid #857374; }',
    '.sec { background: #84303F; color: #FFFFFF; font-weight: bold; font-size: 9.5pt; padding: 4px 8px; margin-top: 10px; }',
    '.datos td { border: 1px solid #D3B8BC; padding: 3px 6px; vertical-align: top; }',
    '.datos .k { background: #F7E3E6; color: #45343A; width: 22%; font-weight: bold; font-size: 8.5pt; }',
    '.foto { border: 1px solid #D3B8BC; text-align: center; vertical-align: middle; color: #857374; }',
    '.foto img { max-width: 160px; max-height: 160px; }',
    '.hist th { background: #FFCCD4; color: #33030F; font-size: 8.5pt; border: 1px solid #D3B8BC; padding: 3px 5px; text-align: left; }',
    '.hist td { border: 1px solid #D3B8BC; padding: 3px 5px; font-size: 8.5pt; vertical-align: top; height: 16px; }',
    '.vacio { color: #857374; font-style: italic; }',
    '.firmas td { width: 50%; padding-top: 34px; text-align: center; font-size: 8.5pt; color: #45343A; }',
    '.firmas span { display: block; border-top: 1px solid #45343A; margin: 0 24px; padding-top: 3px; }',
    '.pie { font-size: 7.5pt; color: #857374; margin-top: 8px; text-align: right; }'
  ].join('\n');
}

function paginaHojaDeVida_(c, historial, logo, foto, hoy, ultima) {
  const mttos = historial;
  const fallas = historial.filter(function(h) { return h.huboFalla; });

  function fila(k1, v1, k2, v2) {
    return '<tr><td class="k">' + esc_(k1) + '</td><td>' + (esc_(v1) || '—') + '</td>' +
      '<td class="k">' + esc_(k2) + '</td><td>' + (esc_(v2) || '—') + '</td></tr>';
  }

  const datos =
    '<table class="datos">' +
    fila('Sede', c.sede, 'Edificación', c.edificacion) +
    fila('Nivel', c.nivel, 'Subzona', c.subzona) +
    fila('Área / Zona', c.areaZona, 'Dependencia', c.dependencia) +
    fila('Tipo de ubicación', c.tipoUbicacion, 'Referencia', c.referencia) +
    fila('Tipo de cámara', c.tipoCamara, 'Marca', c.marca) +
    fila('Modelo', c.modelo, 'Serial', c.serial) +
    fila('Visión nocturna', c.visionNocturna, 'Audio', c.audio) +
    fila('IP', c.ip, 'NVR / DVR · Canal', [c.nvr, c.canal].filter(String).join(' · ')) +
    fila('Estado físico', c.estadoFisico, 'Estado de cableado', c.estadoCableado) +
    fila('Último mantenimiento', fechaCorta_(c.ultimoMantenimiento), 'Próximo mantenimiento', fechaCorta_(c.proximoMantenimiento)) +
    fila('Responsable', c.responsable, 'Inventariada por', [c.registradoPor, c.fechaRegistro].filter(String).join(' · ')) +
    '</table>';

  const bloqueFoto = foto
    ? '<img src="' + foto + '">'
    : '<span class="vacio">Sin fotografía</span>';

  const obs = c.observaciones
    ? '<table class="datos" style="margin-top:4px"><tr><td class="k">Observaciones</td><td>' + esc_(c.observaciones) + '</td></tr></table>'
    : '';

  function filasVacias(n, columnas) {
    let s = '';
    for (let i = 0; i < n; i++) {
      s += '<tr>' + new Array(columnas + 1).join('<td>&nbsp;</td>') + '</tr>';
    }
    return s;
  }

  const tablaMtto =
    '<table class="hist"><tr><th style="width:15%">Fecha</th><th style="width:15%">Tipo</th>' +
    '<th>Actividades</th><th style="width:11%">Imagen</th><th style="width:18%">Técnico</th></tr>' +
    mttos.map(function(h) {
      return '<tr><td>' + esc_(h.fecha.split(' ')[0]) + '</td><td>' + esc_(h.tipo) + '</td><td>' +
        esc_(h.actividades) + (h.observaciones ? '<br><i>' + esc_(h.observaciones) + '</i>' : '') +
        '</td><td>' + esc_(h.estadoImagen) + '</td><td>' + esc_(h.tecnico) + '</td></tr>';
    }).join('') +
    filasVacias(mttos.length ? 2 : 4, 5) +
    '</table>';

  const tablaFallas =
    '<table class="hist"><tr><th style="width:15%">Fecha</th><th>Falla</th>' +
    '<th style="width:24%">Repuesto</th><th style="width:12%">Días fuera</th><th style="width:18%">Técnico</th></tr>' +
    fallas.map(function(h) {
      return '<tr><td>' + esc_(h.fecha.split(' ')[0]) + '</td><td>' + esc_(h.falla) + '</td><td>' +
        esc_(h.repuesto) + '</td><td>' + esc_(h.diasFuera) + '</td><td>' + esc_(h.tecnico) + '</td></tr>';
    }).join('') +
    filasVacias(fallas.length ? 1 : 3, 5) +
    '</table>';

  return '<div class="pagina' + (ultima ? ' ultima' : '') + '">' +
    '<table class="cab"><tr>' +
    '<td style="width:58px">' + (logo ? '<img src="' + logo + '" style="width:52px;height:52px">' : '') + '</td>' +
    '<td><div class="tit">Hoja de vida — Cámara CCTV</div>' +
    '<div class="sub">Clínica Reina Catalina · Departamento de seguridad</div></td>' +
    '<td class="fmt" style="width:150px">Código: ' + (esc_(FORMATO_CODIGO) || '________') +
    '<br>Versión: ' + (esc_(FORMATO_VERSION) || '____') + '<br>Fecha: ' + hoy + '</td>' +
    '</tr></table>' +
    '<div class="linea"></div>' +
    '<table><tr><td class="idcam">' + esc_(c.id) + '</td>' +
    '<td style="text-align:right"><span class="estado">' + esc_(c.estado || 'Sin estado') + '</span></td></tr></table>' +
    '<div class="sec">Datos técnicos</div>' +
    '<table style="margin-top:4px"><tr><td style="vertical-align:top">' + datos + '</td>' +
    '<td class="foto" style="width:170px">' + bloqueFoto + '</td></tr></table>' +
    obs +
    '<div class="sec">Mantenimientos</div>' + tablaMtto +
    '<div class="sec">Fallas y reparaciones</div>' + tablaFallas +
    '<table class="firmas"><tr><td><span>Elaboró</span></td><td><span>Revisó · Jefe de monitoreo</span></td></tr></table>' +
    '<div class="pie">Generado desde el Inventario CCTV el ' + hoy + '</div>' +
    '</div>';
}


/***********************
 * FECHAS
 ***********************/

/** 'aaaa-mm-dd' del formulario → fecha a medianoche en la zona del proyecto. */
function convertirFecha_(fecha) {
  if (!fecha) return '';
  if (fecha instanceof Date) return fecha;

  const p = String(fecha).match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (p) return new Date(parseInt(p[1], 10), parseInt(p[2], 10) - 1, parseInt(p[3], 10));

  const convertida = new Date(fecha);
  return isNaN(convertida.getTime()) ? '' : convertida;
}

function formatearFecha_(fecha) {
  return formatear_(fecha, 'dd/MM/yyyy HH:mm');
}

function formatearFechaInput_(fecha) {
  return formatear_(fecha, 'yyyy-MM-dd');
}

/** 17/11/2026 4:30 p. m. */
function formatearFechaHora12_(fecha) {
  const base = formatear_(fecha, 'dd/MM/yyyy h:mm');
  const hora = Number(formatear_(fecha, 'H'));
  return base ? base + (hora < 12 ? ' a. m.' : ' p. m.') : '';
}

function formatear_(fecha, formato) {
  if (!fecha) return '';

  try {
    const convertida = fecha instanceof Date ? fecha : new Date(fecha);
    if (isNaN(convertida.getTime())) return '';
    return Utilities.formatDate(convertida, Session.getScriptTimeZone(), formato);
  } catch (e) {
    return '';
  }
}
