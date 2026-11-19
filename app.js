/*****************************************************************
 * INVENTARIO CCTV — PWA (versión con hoja de vida)
 *
 * Cómo funciona:
 *   1. Al guardar una cámara o un mantenimiento, se escribe primero
 *      en el celular (lista de "pendientes").
 *   2. Si hay señal se sube enseguida a la hoja de cálculo. Si no, se
 *      queda pendiente y se sube sola cuando vuelve la conexión.
 *   3. Buscar y ver la ficha de una cámara funciona sin señal, con la
 *      copia del inventario y del historial guardada en el celular.
 *
 * Cada registro lleva una marca única (uuid): si una subida se corta
 * y se reintenta, el servidor no lo guarda dos veces.
 *****************************************************************/

'use strict';


/***********************
 * LISTAS
 ***********************/

const EDIFICACIONES_POR_SEDE = {
  'Barranquilla': ['Barranquilla - Clínica'],
  'Baranoa': ['Baranoa - Clínica', 'Baranoa - Edificio de Dependencias']
};

const TODAS_LAS_EDIFICACIONES = [
  'Barranquilla - Clínica',
  'Baranoa - Clínica',
  'Baranoa - Edificio de Dependencias'
];

const LISTA_ESTADOS = ['Operativa', 'Operativa con novedad', 'Intermitente', 'Fuera de servicio', 'En mantenimiento'];
const LISTA_TIPOS_CAMARA = ['Domo', 'Bullet', 'Turret', 'Otra'];
const LISTA_UBICACIONES = ['Pasillo', 'Habitación', 'Acceso', 'Escalera', 'Ascensor', 'Parqueadero',
  'Área administrativa', 'Área asistencial', 'Área externa', 'Cuarto técnico', 'Cocina', 'Lavandería', 'Otro'];
const SI_NO = ['Sí', 'No', 'No verificado'];
const ESTADO_EQUIPO = ['Bueno', 'Regular', 'Malo', 'No verificado'];
// Cableado: "No visible" = va dentro del cielo raso y no se ve sin desmontar la cámara (cuenta como completo).
const ESTADO_CABLEADO = ['Bueno', 'Regular', 'Malo', 'No visible', 'No verificado'];

const MARCAS_BASE = ['Hikvision', 'HiLook', 'Dahua', 'Epcom', 'Q-See'];

const TIPOS_MTTO = ['Revisión inicial', 'Preventivo', 'Correctivo'];
const ACTIVIDADES = ['Limpieza de lente', 'Limpieza de carcasa', 'Ajuste de ángulo',
  'Revisión de conectores', 'Revisión de fuente', 'Revisión de cableado', 'Cambio de cámara', 'Otro'];
const ESTADOS_IMAGEN = ['Buena', 'Regular', 'Mala', 'Sin imagen'];

function nivelesDe(edificacion) {
  const n = [];
  if (edificacion === 'Barranquilla - Clínica') {
    n.push('Sótano');
    for (let i = 1; i <= 11; i++) n.push('Piso ' + i);
    n.push('Azotea');
  } else if (edificacion === 'Baranoa - Clínica') {
    // El piso 7 es la azotea: no se lista aparte
    n.push('Sótano');
    for (let i = 1; i <= 7; i++) n.push('Piso ' + i);
  } else if (edificacion === 'Baranoa - Edificio de Dependencias') {
    n.push('Planta 1', 'Planta 2', 'Planta 3');
  }
  return n;
}

/** Torres de cada edificación (edificaciones pegadas que se distinguen por torre). */
function torresDe(edificacion) {
  // "Ninguna": la cámara está en la clínica pero no en una torre (afuera, otro edificio)
  if (edificacion === 'Barranquilla - Clínica') return ['A', 'B', 'C', 'Ninguna'];
  if (edificacion === 'Baranoa - Clínica') return ['A', 'B', 'Ninguna'];
  if (edificacion === 'Baranoa - Edificio de Dependencias') return ['No aplica'];
  return [];
}

/** En las clínicas la torre debe ser A, B o C; vacía o "No aplica" cuenta como faltante. */
function faltaTorre(d) {
  const t = torresDe(d.edificacion);
  return t.length > 1 && t.indexOf(String(d.subzona || '').trim()) === -1;
}

/***********************
 * SERVICIOS (antes "Dependencia"): una sola forma de escribir cada uno.
 * El mismo bloque está en app.js y en Codigo.gs: si cambias uno, cambia el otro.
 ***********************/

const LISTA_SERVICIOS = [
  'Administración', 'Admisiones', 'Archivo', 'Áreas externas', 'Bodega de farmacia',
  'Cafetería', 'Casa 81', 'Cirugía', 'Consulta Externa', 'Endoscopia', 'Facturación',
  'Farma Reina', 'Farmacia', 'Gerencia', 'Hospitalización', 'Hospitalización Ginecología',
  'Hospitalización Pediátrica', 'Imágenes', 'Lavandería', 'Mantenimiento', 'Monitoreo',
  'Otorrino', 'Pangea', 'Quimioterapia', 'Recepción', 'UCI', 'UCI 3', 'UCI 7',
  'UCI Cardio', 'UCI Neonatal', 'UCI Neuro', 'UCI Pediátrica', 'Unidad de Aislados',
  'Unidad Renal', 'Urgencias'
];

// Formas viejas → nombre único (la clave va sin tildes, espacios ni puntos)
const SERVICIOS_EQUIVALENTES = {
  urgencia: 'Urgencias', saladeurgencias: 'Urgencias', urgencia82: 'Urgencias',
  admisionesurgencias: 'Admisiones',
  hospitalizacionladoa: 'Hospitalización', hospitalizacionladob: 'Hospitalización',
  saladeesperauci3: 'UCI 3', saladeesperadeuci3: 'UCI 3',
  saladeesperauci7: 'UCI 7',
  ucicardiop: 'UCI Cardio',
  ucineo: 'UCI Neonatal', neonatal: 'UCI Neonatal', ucineoypediatria: 'UCI Neonatal',
  ucipediatra: 'UCI Pediátrica', ucip: 'UCI Pediátrica', ucipediatrica: 'UCI Pediátrica',
  saladeesperacirugia: 'Cirugía', areacx: 'Cirugía',
  areaquimio: 'Quimioterapia', quimio: 'Quimioterapia',
  ecografia: 'Imágenes',
  administrativa: 'Administración', areaadministrativa: 'Administración', pasillooficinas: 'Administración',
  cuartodemedicamentos: 'Farma Reina', cuartodecirugia: 'Farma Reina',
  cuartodemedicamentosparacirugia: 'Farma Reina', cuartodealmacenamientogeneral: 'Farma Reina',
  oficinaprincipaldebodega: 'Farma Reina',
  cafeteriapiso6: 'Cafetería',
  zonaexterna: 'Áreas externas', patiointerno: 'Áreas externas', pasilloexterno: 'Áreas externas',
  parqueaderointerno: 'Áreas externas', parqueaderointernoparteexterna: 'Áreas externas',
  parqueaderoexterno: 'Áreas externas', casademedicos: 'Áreas externas',
  zonadedesechos: 'Áreas externas', areaderesiduos: 'Áreas externas'
};

// Lo que se escribió como servicio pero es un lugar: queda "Sin servicio"
const NO_SON_SERVICIOS = [
  'puerta', 'pasillo', 'piso1', 'piso5', 'sotano', 'asistencial', 'areaasistencial', 'rampas',
  'rampa82', 'salaespera', 'puertadesaladejuntas', 'entradadesaladejuntas', 'pasillodemorgue',
  'estaciondegases', 'puertasaludtotal', 'pasillopuertahuellero', 'pasillodeconfecciones',
  'pasillodestar5topisoladoa', 'pasillodelaentradaprincipal'
];

function claveServicio(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Devuelve el nombre único del servicio, '' si no es un servicio,
 * o null si es uno nuevo que no está en la lista.
 */
function servicioUnico(texto, extras) {
  const k = claveServicio(texto);
  if (!k) return '';
  const lista = LISTA_SERVICIOS.concat(extras || []);
  for (let i = 0; i < lista.length; i++) if (claveServicio(lista[i]) === k) return lista[i];
  if (SERVICIOS_EQUIVALENTES[k]) return SERVICIOS_EQUIVALENTES[k];
  if (NO_SON_SERVICIOS.indexOf(k) !== -1) return '';
  return null;
}

/** Servicios para elegir: la lista fija, los que ya están en el inventario y los agregados aquí. */
function serviciosExtra() {
  const extra = (ls.get('servicios', []) || []).slice();
  (registros || []).forEach(function(r) {
    const t = String(r.dependencia || '').trim();
    if (t && servicioUnico(t, extra) === null) extra.push(t);
  });
  return extra;
}

function opcionesServicio() {
  return LISTA_SERVICIOS.concat(serviciosExtra()).sort(function(a, b) { return a.localeCompare(b, 'es'); });
}

/** Los más usados, para mostrar antes de escribir. */
function serviciosFrecuentes(n) {
  const cuenta = {};
  (registros || []).forEach(function(r) { if (!vacio(r.dependencia)) cuenta[r.dependencia] = (cuenta[r.dependencia] || 0) + 1; });
  return Object.keys(cuenta).sort(function(a, b) { return cuenta[b] - cuenta[a]; }).slice(0, n);
}

function htmlChipsServicio(c, consulta, val) {
  const q = claveServicio(consulta);
  let ops;
  if (!q) {
    ops = serviciosFrecuentes(8);
    if (!ops.length) ops = LISTA_SERVICIOS.slice(0, 8);
  } else {
    ops = opcionesServicio().filter(function(o) { return claveServicio(o).indexOf(q) !== -1; }).slice(0, 12);
  }
  ops = ops.filter(function(o) { return o !== val; });

  let html = ops.map(function(o) {
    return '<button type="button" class="chip" aria-pressed="false" data-campo="' + c.k + '" data-valor="' + esc(o) + '">' + esc(o) + '</button>';
  }).join('');

  if (q) {
    const unico = servicioUnico(consulta, serviciosExtra());
    if (unico === null && q.length >= 3) {
      const nuevo = String(consulta).trim().replace(/\s+/g, ' ');
      const bonito = nuevo.charAt(0).toUpperCase() + nuevo.slice(1);
      html += '<button type="button" class="chip nuevo" data-nuevo-serv="1" data-campo="' + c.k + '" data-valor="' + esc(bonito) + '">' +
        ico('add') + 'Agregar servicio «' + esc(bonito) + '»</button>';
    } else if (unico === '') {
      html += '<p class="ayuda" style="margin:0">«' + esc(consulta.trim()) + '» es un lugar, no un servicio: escríbelo en Punto exacto.</p>';
    } else if (!ops.length && unico && unico !== val) {
      html += '<button type="button" class="chip" aria-pressed="false" data-campo="' + c.k + '" data-valor="' + esc(unico) + '">' + esc(unico) + '</button>';
    }
    if (!html) html = '<p class="ayuda" style="margin:0">No hay servicios con ese nombre.</p>';
  }
  return html;
}

function ordenNivel(nivel) {
  const t = String(nivel || '').trim().toLowerCase();
  if (t === 'sótano' || t === 'sotano') return -1;
  if (t === 'azotea') return 999;
  const m = t.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 1000;
}

/**
 * Campos de la cámara. t: seg (botones en una fila), chips, pisos,
 * texto, fecha, area. paso: en qué paso del registro va.
 */
const IP_ANALOGA = 'No aplica (análoga)';

const CAMPOS = [
  { k: 'sede', l: 'Sede', t: 'seg', o: ['Barranquilla', 'Baranoa'], req: true, paso: 1, secc: 'Dónde está' },
  { k: 'edificacion', l: 'Edificación', t: 'seg', o: function(v) { return EDIFICACIONES_POR_SEDE[v.sede] || []; },
    req: true, paso: 1, secc: 'Dónde está', vacio: 'Elige primero la sede.' },
  // La columna sigue llamándose "subzona" por dentro; en pantalla y en la hoja es "Torre"
  { k: 'subzona', l: 'Torre', t: 'seg', o: function(v) { return torresDe(v.edificacion); },
    paso: 1, secc: 'Dónde está', vacio: 'Elige primero la edificación.' },
  { k: 'nivel', l: 'Piso', t: 'pisos', o: function(v) { return nivelesDe(v.edificacion); },
    req: true, paso: 1, secc: 'Dónde está', vacio: 'Elige primero la edificación.' },

  // "dependencia" y "areaZona" por dentro; en pantalla y en la hoja son "Servicio" y "Punto exacto"
  { k: 'dependencia', l: 'Servicio', t: 'servicio', req: true, paso: 1, secc: 'Ubicación exacta' },
  { k: 'areaZona', l: 'Punto exacto', t: 'texto', ph: 'Qué mira. Ej.: estar de enfermería B', req: true, paso: 1, secc: 'Ubicación exacta' },

  { k: 'tipoCamara', l: 'Tipo de cámara', t: 'seg', o: LISTA_TIPOS_CAMARA, req: true, paso: 2, secc: 'La cámara' },
  { k: 'marca', l: 'Marca', t: 'texto', ph: 'Hikvision, Dahua', lista: 'listaMarcas', paso: 2, secc: 'La cámara' },
  { k: 'modelo', l: 'Modelo', t: 'texto', paso: 2, secc: 'La cámara' },
  { k: 'serial', l: 'Serial', t: 'texto', paso: 2, secc: 'La cámara', mayus: true },
  { k: 'visionNocturna', l: 'Visión nocturna', t: 'chips', o: SI_NO, paso: 2, secc: 'Funciones' },
  { k: 'audio', l: 'Audio', t: 'chips', o: SI_NO, paso: 2, secc: 'Funciones' },
  // Las cámaras análogas (Turbo HD, van a un DVR por coaxial) no tienen IP
  { k: 'ip', l: 'IP', t: 'texto', ph: '192.168.1.45', paso: 2, secc: 'Conexión', teclado: 'decimal', atajo: IP_ANALOGA },
  { k: 'nvr', l: 'NVR / DVR', t: 'texto', ph: 'NVR-2', paso: 2, secc: 'Conexión', mayus: true },
  { k: 'canal', l: 'Canal', t: 'texto', ph: '07', paso: 2, secc: 'Conexión', teclado: 'numeric' },

  { k: 'estado', l: 'Estado operativo', t: 'chips', o: LISTA_ESTADOS, req: true, paso: 3, secc: 'Estado' },
  { k: 'estadoFisico', l: 'Estado físico', t: 'chips', o: ESTADO_EQUIPO, paso: 3, secc: 'Estado' },
  { k: 'estadoCableado', l: 'Estado del cableado', t: 'chips', o: ESTADO_CABLEADO, paso: 3, secc: 'Estado' },
  { k: 'ultimoMantenimiento', l: 'Último mantenimiento', t: 'fecha', paso: 3, secc: 'Mantenimiento' },
  { k: 'proximoMantenimiento', l: 'Próximo mantenimiento', t: 'fecha', paso: 3, secc: 'Mantenimiento' },
  { k: 'responsable', l: 'Responsable del mantenimiento', t: 'texto', paso: 3, secc: 'Mantenimiento' },
  { k: 'observaciones', l: 'Observaciones', t: 'area', ph: 'Novedades, daños, recomendaciones', paso: 3, secc: 'Observaciones' },

  { k: 'registradoPor', l: 'Registrado por', t: 'texto', ph: 'Tu nombre', req: true, paso: 4, secc: 'Quién registra', soloRegistro: true }
];

const PASOS = ['Ubicación', 'Cámara', 'Estado', 'Foto y registro'];


/***********************
 * ALMACENAMIENTO EN EL CELULAR
 ***********************/

const PREF = 'cctv:';
const ls = {
  get: function(k, d) { try { const v = localStorage.getItem(PREF + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: function(k, v) { try { localStorage.setItem(PREF + k, JSON.stringify(v)); } catch (e) { /* sin espacio */ } }
};

// El código usa la misma clave de siempre para no pedirlo otra vez
const CLAVE_CODIGO = 'cctv_codigo';

function codigoAcceso() {
  try { return localStorage.getItem(CLAVE_CODIGO) || ''; } catch (e) { return ''; }
}

let promesaBD = null;

function abrirBD() {
  if (!promesaBD) {
    promesaBD = new Promise(function(resolve, reject) {
      const p = indexedDB.open('inventario-cctv', 1);
      p.onupgradeneeded = function() {
        p.result.createObjectStore('pendientes', { keyPath: 'uuid' });
        p.result.createObjectStore('datos');
      };
      p.onsuccess = function() { resolve(p.result); };
      p.onerror = function() { reject(p.error); };
    });
  }
  return promesaBD;
}

function enAlmacen(almacen, modo, operacion) {
  return abrirBD().then(function(bd) {
    return new Promise(function(resolve, reject) {
      const tx = bd.transaction(almacen, modo);
      const peticion = operacion(tx.objectStore(almacen));
      tx.oncomplete = function() { resolve(peticion ? peticion.result : undefined); };
      tx.onerror = function() { reject(tx.error); };
      tx.onabort = function() { reject(tx.error); };
    });
  });
}

function listarPendientes() {
  return enAlmacen('pendientes', 'readonly', function(a) { return a.getAll(); })
    .then(function(lista) {
      return (lista || []).sort(function(a, b) { return a.datos.fechaCaptura - b.datos.fechaCaptura; });
    });
}
function guardarPendiente(p) { return enAlmacen('pendientes', 'readwrite', function(a) { return a.put(p); }); }
function borrarPendiente(uuid) { return enAlmacen('pendientes', 'readwrite', function(a) { return a.delete(uuid); }); }
function leerDato(k) { return enAlmacen('datos', 'readonly', function(a) { return a.get(k); }); }
function guardarDato(k, v) { return enAlmacen('datos', 'readwrite', function(a) { return a.put(v, k); }); }

function esMtto(p) { return p && p.tipo === 'mantenimiento'; }


/***********************
 * SERVIDOR
 ***********************/

function urlConfigurada() {
  return typeof URL_APPS_SCRIPT === 'string' && /^https:\/\/.+\/exec$/.test(URL_APPS_SCRIPT.trim());
}

async function llamar(accion, extra, esperaMs, codigo) {
  if (!urlConfigurada()) throw new Error('Falta configurar la app: pega la URL de Apps Script en config.js.');

  const control = new AbortController();
  const reloj = setTimeout(function() { control.abort(); }, esperaMs || 60000);
  let respuesta;

  try {
    // Como texto y sin cabeceras: el navegador no hace consulta previa
    respuesta = await fetch(URL_APPS_SCRIPT.trim(), {
      method: 'POST',
      body: JSON.stringify(Object.assign({ accion: accion, codigo: codigo === undefined ? codigoAcceso() : codigo }, extra || {})),
      redirect: 'follow',
      signal: control.signal
    });
  } catch (e) {
    const err = new Error('Sin conexión con el servidor.');
    err.sinRed = true;
    throw err;
  } finally {
    clearTimeout(reloj);
  }

  let json;
  try {
    json = await respuesta.json();
  } catch (e) {
    throw new Error('El servidor no respondió como se esperaba. Revisa que la implementación de Apps Script esté publicada para "Cualquier usuario".');
  }

  if (!json.ok) {
    const err = new Error(json.error || 'El servidor rechazó la solicitud.');
    err.codigo = json.codigo || '';
    throw err;
  }

  return json;
}


/***********************
 * ESTADO DE LA APP
 ***********************/

const S = {
  vista: 'vRegistrar',
  paso: 1,
  reg: ls.get('borrador', {}),
  regFoto: '',
  errores: {},
  // Buscar
  texto: '',
  sede: '',
  filtro: '',
  sel: null,          // ID de la cámara abierta
  modo: 'ficha',      // ficha (hoja de vida) | mtto | editar | completar
  mt: null,           // formulario de mantenimiento
  ed: null,           // formulario de edición
  cp: null,           // completar lo que falta
  edFoto: '',
  extra: null,        // filtro que viene del Resumen (piso, estado, tipo)
  // Resumen
  sedeResumen: ''
};

let registros = null;   // copia del inventario
let historial = [];     // copia del historial
let fechaCopia = '';
let pendientesCache = [];


/***********************
 * UTILIDADES
 ***********************/

function $(id) { return document.getElementById(id); }

function esc(t) {
  return String(t === null || t === undefined ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ico(nombre, extra) { return '<span class="ms ' + (extra || '') + '" aria-hidden="true">' + nombre + '</span>'; }

const SVG_LISTO = '<svg viewBox="0 -960 960 960" aria-hidden="true"><path d="m344-60-76-128-144-32 14-148-98-112 98-112-14-148 144-32 76-128 136 58 136-58 76 128 144 32-14 148 98 112-98 112 14 148-144 32-76 128-136-58-136 58Zm94-278 226-226-56-58-170 170-86-84-56 56 142 142Z"/></svg>';

function chipListo() { return '<span class="listo">' + SVG_LISTO + 'Listo</span>'; }

function igual(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }

function vacio(v) { return String(v === null || v === undefined ? '' : v).trim() === ''; }

function dos(n) { return String(n).padStart(2, '0'); }

/** 4:30 p. m. */
function hora12(h, m) {
  return ((h % 12) || 12) + ':' + dos(m) + (h < 12 ? ' a. m.' : ' p. m.');
}

function fechaHora(ms) {
  const f = new Date(ms);
  return dos(f.getDate()) + '/' + dos(f.getMonth() + 1) + '/' + f.getFullYear() + ' ' + hora12(f.getHours(), f.getMinutes());
}

/** "17/11/2026 16:49" del servidor → "17/11/2026 4:49 p. m." */
function fecha12(texto) {
  const m = String(texto || '').match(/^(\d{2}\/\d{2}\/\d{4})\s+(\d{1,2}):(\d{2})/);
  if (m) return m[1] + ' ' + hora12(Number(m[2]), Number(m[3]));
  const iso = String(texto || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/);
  return iso ? iso[3] + '/' + iso[2] + '/' + iso[1] + ' ' + hora12(Number(iso[4]), Number(iso[5])) : String(texto || '');
}

/** "2026-11-17" → "17/11/2026" */
function fechaCorta(texto) {
  const m = String(texto || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
}

/** "17/11/2026 4:49 p. m." → milisegundos (para ordenar) */
function msDeFecha(texto) {
  const m = String(texto || '').match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0)).getTime() : 0;
}

function nuevoUuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function limpiarSerial(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

let relojToast = null;

/** Mensaje emergente. accion = { texto, fn } agrega un botón (por ejemplo "Ir"). */
function toast(icono, texto, ms, accion) {
  const t = $('toast');
  t.innerHTML = ico(icono) + '<span style="flex:1"></span>' +
    (accion ? '<button type="button" class="ir">' + esc(accion.texto) + '</button>' : '');
  t.children[1].textContent = texto;
  if (accion) {
    t.querySelector('.ir').onclick = function() {
      t.classList.add('oculto');
      accion.fn();
    };
  }
  t.classList.remove('oculto');
  clearTimeout(relojToast);
  relojToast = setTimeout(function() { t.classList.add('oculto'); }, ms || 4000);
}

/** Lleva a un campo marcado, lo centra en pantalla y lo hace parpadear. */
function irAlCampo(elemento) {
  if (!elemento) return;
  elemento.scrollIntoView({ behavior: 'smooth', block: 'center' });
  elemento.classList.remove('resalta');
  void elemento.offsetWidth;
  elemento.classList.add('resalta');
  const entrada = elemento.querySelector('input, textarea');
  if (entrada) setTimeout(function() { entrada.focus({ preventScroll: true }); }, 400);
}

/** Aviso de lo que falta, con el botón "Ir" al primer campo marcado. */
function avisarFalta(nombres, irA) {
  sonarFalta();
  toast('error', 'Falta: ' + nombres.join(', ') + '.', 8000, { texto: 'Ir', fn: irA });
}


/***********************
 * SONIDOS Y VIBRACIÓN
 ***********************/

let actx = null;

function prepararSonido() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch (e) { /* sin sonido */ }
}

function tono(notas, vol) {
  try {
    if (!actx) return;
    const t0 = actx.currentTime + 0.02;
    notas.forEach(function(n) {
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = 'sine';
      o.frequency.value = n[0];
      g.gain.setValueAtTime(0.0001, t0 + n[1]);
      g.gain.exponentialRampToValueAtTime(vol, t0 + n[1] + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1] + n[2]);
      o.connect(g);
      g.connect(actx.destination);
      o.start(t0 + n[1]);
      o.stop(t0 + n[1] + n[2] + 0.05);
    });
  } catch (e) { /* sin sonido */ }
}

function vibrar(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* nada */ } }
function sonarListo() { tono([[784, 0, 0.28], [1046.5, 0.13, 0.28], [1318.5, 0.26, 0.5]], 0.22); vibrar([50, 60, 90]); }
function sonarFalta() { tono([[659.3, 0, 0.18], [523.3, 0.16, 0.32]], 0.18); vibrar(80); }
function sonarError() { tono([[330, 0, 0.25], [247, 0.2, 0.4]], 0.2); vibrar(250); }


/***********************
 * FOTOS
 ***********************/

function comprimirImagen(file) {
  return new Promise(function(resolve, reject) {
    const lector = new FileReader();
    lector.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        const max = 1280;
        let w = img.width;
        let h = img.height;
        if (w > max) { h = h * max / w; w = max; }
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = function() { reject(new Error('No se pudo leer la fotografía.')); };
      img.src = e.target.result;
    };
    lector.onerror = function() { reject(new Error('No se pudo leer la fotografía.')); };
    lector.readAsDataURL(file);
  });
}

let destinoFoto = null;

function pedirFoto(alTener) {
  destinoFoto = alTener;
  const entrada = $('archivoFoto');
  entrada.value = '';
  entrada.click();
}


/***********************
 * FORMULARIO DE LA CÁMARA (registro y edición)
 ***********************/

function opcionesDe(campo, v) {
  return typeof campo.o === 'function' ? campo.o(v) : (campo.o || []);
}

/** Pinta los campos (de un paso o todos) agrupados por sección. */
function htmlCampos(campos, v, errores, prefijo) {
  const secciones = [];
  const porSeccion = {};

  campos.forEach(function(c) {
    if (!porSeccion[c.secc]) {
      porSeccion[c.secc] = [];
      secciones.push(c.secc);
    }
    porSeccion[c.secc].push(c);
  });

  return secciones.map(function(nombre) {
    const lista = porSeccion[nombre];
    const obligatorios = lista.filter(function(c) { return c.req; });
    const completa = obligatorios.length && obligatorios.every(function(c) { return !vacio(v[c.k]); });

    return '<div class="secc"><span>' + esc(nombre) + '</span>' +
      (obligatorios.length ? '<span data-listo-secc="' + esc(nombre) + '">' + (completa ? chipListo() : '') + '</span>' : '<span class="opc">opcional</span>') +
      '</div>' +
      '<div class="grupo">' + lista.map(function(c) { return htmlCampo(c, v, errores, prefijo); }).join('') + '</div>';
  }).join('');
}

function htmlCampo(c, v, errores, prefijo) {
  const id = prefijo + c.k;
  const val = v[c.k] === undefined || v[c.k] === null ? '' : String(v[c.k]);
  const error = errores[c.k];
  let control = '';

  if (c.t === 'servicio') {
    control =
      (val ? '<div class="chips" style="margin-bottom:10px"><button type="button" class="chip" aria-pressed="true" data-campo="' + c.k +
        '" data-valor="' + esc(val) + '">' + ico('check') + esc(val) + '</button></div>' : '') +
      '<input id="' + id + '" class="entrada" type="search" autocomplete="off" data-buscar-serv="' + c.k + '" placeholder="' +
        (val ? 'Cambiar: escribe otro servicio' : 'Busca: UCI, urgencias, farmacia…') + '">' +
      '<div class="chips" style="margin-top:10px" data-lista-serv="' + c.k + '">' + htmlChipsServicio(c, '', val) + '</div>';
  } else if (c.t === 'seg' || c.t === 'chips' || c.t === 'pisos') {
    const ops = opcionesDe(c, v);

    if (!ops.length) {
      control = '<p class="ayuda">' + esc(c.vacio || '') + '</p>';
    } else {
      // Si el valor guardado no está en la lista, se muestra igual para no perderlo
      const todas = val && ops.indexOf(val) === -1 ? ops.concat([val]) : ops;
      const clase = c.t === 'seg' ? 'seg' : (c.t === 'pisos' ? 'chips pisos' : 'chips');
      const cls = c.t === 'seg' ? '' : 'chip';

      control = '<div class="' + clase + '" role="group" aria-label="' + esc(c.l) + '">' +
        todas.map(function(o) {
          const on = o === val;
          return '<button type="button" class="' + cls + '" aria-pressed="' + on + '" data-campo="' + c.k +
            '" data-valor="' + esc(o) + '">' + (on && c.t !== 'seg' ? ico('check') : '') + esc(o) + '</button>';
        }).join('') + '</div>';
    }
  } else if (c.t === 'area') {
    control = '<textarea id="' + id + '" class="entrada" data-campo="' + c.k + '" placeholder="' + esc(c.ph || '') + '">' + esc(val) + '</textarea>';
  } else {
    control = '<input id="' + id + '" class="entrada" data-campo="' + c.k + '" value="' + esc(val) + '"' +
      (c.t === 'fecha' ? ' type="date"' : ' type="text" autocomplete="off"') +
      (c.lista ? ' list="' + c.lista + '"' : '') +
      (c.teclado ? ' inputmode="' + c.teclado + '"' : '') +
      (c.mayus ? ' autocapitalize="characters"' : '') +
      ' placeholder="' + esc(c.ph || '') + '">';
    if (c.atajo) {
      control += '<div class="chips" style="margin-top:10px"><button type="button" class="chip" aria-pressed="' + (val === c.atajo) +
        '" data-campo="' + c.k + '" data-valor="' + esc(c.atajo) + '">' + (val === c.atajo ? ico('check') : '') + esc(c.atajo) + '</button></div>';
    }
  }

  const conEntrada = ['texto', 'fecha', 'area', 'servicio'].indexOf(c.t) !== -1;

  return '<div class="campo' + (error ? ' mal' : '') + '" id="campo_' + id + '">' +
    (conEntrada ? '<label class="etq" for="' + id + '">' : '<div class="etq">') + '<span>' + esc(c.l) + '</span>' + (conEntrada ? '</label>' : '</div>') +
    control +
    (error ? '<p class="error-campo">' + ico('error', 's') + esc(error) + '</p>' : '') +
    '</div>';
}

/** Al elegir una opción: guarda, ajusta los campos que dependen y deshace si se toca la misma. */
function elegir(v, campo, valor) {
  const c = CAMPOS.filter(function(x) { return x.k === campo; })[0];

  v[campo] = v[campo] === valor && !(c && c.req) ? '' : valor;

  if (campo === 'sede') {
    const eds = EDIFICACIONES_POR_SEDE[v.sede] || [];
    if (eds.indexOf(v.edificacion) === -1) v.edificacion = eds.length === 1 ? eds[0] : '';
  }

  if (campo === 'sede' || campo === 'edificacion') {
    if (nivelesDe(v.edificacion).indexOf(v.nivel) === -1) v.nivel = '';
    const torres = torresDe(v.edificacion);
    if (torres.indexOf(v.subzona) === -1) v.subzona = torres.length === 1 ? torres[0] : '';
  }
}


/***********************
 * REGISTRAR
 ***********************/

function camposDelPaso(n) {
  return CAMPOS.filter(function(c) { return c.paso === n; });
}

function faltanDelPaso(n) {
  return camposDelPaso(n).filter(function(c) { return c.req && vacio(S.reg[c.k]); });
}

function pintarRegistro() {
  const v = S.reg;
  const caja = $('formRegistro');

  if (!v.edificacion && v.sede) elegir(v, 'sede', v.sede);

  const html = '<div class="bloque">' + htmlCampos(camposDelPaso(S.paso).filter(function(c) {
    return ['Dónde está', 'La cámara', 'Estado', 'Quién registra'].indexOf(c.secc) !== -1;
  }), v, S.errores, 'r_') + '</div>';

  const resto = camposDelPaso(S.paso).filter(function(c) {
    return ['Dónde está', 'La cámara', 'Estado', 'Quién registra'].indexOf(c.secc) === -1;
  });

  let html2 = htmlCampos(resto, v, S.errores, 'r_');

  if (S.paso === 4) {
    html2 = '<div class="secc"><span>Fotografía de la cámara</span><span class="opc">opcional</span></div>' +
      '<div class="tarjeta"><button type="button" class="foto-btn" data-accion="fotoRegistro">' +
      ico('photo_camera') + (S.regFoto ? 'Cambiar foto' : 'Tomar foto') + '</button>' +
      (S.regFoto ? '<img class="foto-prev" src="' + S.regFoto + '" alt="Vista previa de la foto">' : '') +
      '</div>' + html2;
  }

  caja.innerHTML = html + (html2 ? '<div class="bloque">' + html2 + '</div>' : '');

  // El paso va en la línea de abajo del título (sin tarjeta de avance)
  $('subtitulo').textContent = 'Paso ' + S.paso + ' de ' + PASOS.length + ' · ' + PASOS[S.paso - 1];

  pintarAccion();
}

function guardarBorrador() {
  ls.set('borrador', S.reg);
}

function siguientePaso() {
  const falta = faltanDelPaso(S.paso);

  if (!falta.length) { irPaso(S.paso + 1); return; }

  falta.forEach(function(c) { S.errores[c.k] = 'Falta completar: ' + c.l.toLowerCase(); });
  pintarRegistro();
  avisarFalta(falta.map(function(c) { return c.l.toLowerCase(); }), function() {
    irAlCampo($('campo_r_' + falta[0].k));
  });
}

function irPaso(n) {
  S.paso = Math.min(Math.max(n, 1), PASOS.length);
  pintarRegistro();
  window.scrollTo(0, 0);
}

function validarRegistro() {
  S.errores = {};

  CAMPOS.forEach(function(c) {
    if (c.req && vacio(S.reg[c.k])) S.errores[c.k] = 'Falta completar: ' + c.l.toLowerCase();
  });

  const faltan = Object.keys(S.errores);

  if (!faltan.length) return true;

  const lista = CAMPOS.filter(function(c) { return S.errores[c.k]; });
  const primero = lista[0];

  avisarFalta(lista.map(function(c) { return c.l.toLowerCase(); }), function() {
    if (S.vista !== 'vRegistrar') mostrarVista('vRegistrar');
    if (S.paso !== primero.paso) irPaso(primero.paso);
    setTimeout(function() { irAlCampo($('campo_r_' + primero.k)); }, 80);
  });

  return false;
}

async function serialAceptado(serial) {
  const buscado = limpiarSerial(serial);
  if (!buscado) return true;

  let donde = '';

  (registros || []).some(function(r) {
    if (limpiarSerial(r.serial) === buscado) {
      donde = r.id + ' (' + r.nivel + ', ' + r.areaZona + ')';
      return true;
    }
    return false;
  });

  if (!donde) {
    (await listarPendientes()).some(function(p) {
      if (!esMtto(p) && p.tipo !== 'actualizar' && limpiarSerial(p.datos.serial) === buscado) {
        donde = 'una cámara pendiente por subir (' + p.datos.nivel + ', ' + p.datos.areaZona + ')';
        return true;
      }
      return false;
    });
  }

  return !donde || window.confirm('El serial ' + serial + ' ya está registrado en ' + donde + '.\n\n¿Guardar esta cámara de todas formas?');
}

let guardando = false;

async function guardarCamara() {
  if (guardando) return;
  guardando = true;
  prepararSonido();

  try {
    if (!validarRegistro() || !(await serialAceptado(S.reg.serial))) return;

    const datos = { uuid: nuevoUuid(), fechaCaptura: Date.now(), fotografia: S.regFoto || '' };

    CAMPOS.forEach(function(c) { datos[c.k] = String(S.reg[c.k] || '').trim(); });

    await guardarPendiente({ uuid: datos.uuid, tipo: 'camara', datos: datos, intentos: 0 });

    // Se conserva el lugar y quien registra para seguir con la siguiente cámara
    S.reg = {
      sede: S.reg.sede, edificacion: S.reg.edificacion, nivel: S.reg.nivel,
      subzona: S.reg.subzona, registradoPor: S.reg.registradoPor
    };
    S.regFoto = '';
    S.errores = {};
    guardarBorrador();
    irPaso(1);

    sonarListo();
    toast('cloud_upload', 'Cámara guardada en el celular. Subiendo…');
    await pintarEstado();

    const r = await sincronizar();

    if (r.ids[datos.uuid]) {
      toast('cloud_done', 'Cámara registrada. ID asignado: ' + r.ids[datos.uuid], 6000);
    } else if (r.errores[datos.uuid]) {
      sonarError();
      toast('error', 'Quedó en el celular, pero el servidor la rechazó: ' + r.errores[datos.uuid], 8000);
    } else {
      toast('cloud_off', 'Sin señal: la cámara quedó en este celular y se subirá sola cuando vuelva la conexión.', 6000);
    }
  } catch (e) {
    sonarError();
    toast('error', 'No se pudo guardar en el celular: ' + e.message, 8000);
  } finally {
    guardando = false;
  }
}


/***********************
 * SUBIR PENDIENTES
 ***********************/

let sincronizando = false;
let verPendientes = false;
const idsSubidos = {};
const erroresSubida = {};
let turnoSubida = Promise.resolve();

function sincronizar() {
  turnoSubida = turnoSubida.then(subirPendientes, subirPendientes);
  return turnoSubida;
}

async function subirPendientes() {
  const resultado = { ids: idsSubidos, errores: erroresSubida, subidas: 0, sinRed: false };

  if (!codigoAcceso()) return resultado;

  sincronizando = true;
  pintarEstado();

  const intentados = {};

  try {
    while (true) {
      const p = (await listarPendientes()).filter(function(x) { return !intentados[x.uuid]; })[0];
      if (!p) break;
      intentados[p.uuid] = true;

      try {
        const accion = esMtto(p) ? 'mantenimiento' : (p.tipo === 'actualizar' ? 'actualizar' : 'registrar');
        const r = await llamar(accion, { datos: p.datos }, 120000);
        await borrarPendiente(p.uuid);
        idsSubidos[p.uuid] = r.id || 'ok';
        delete erroresSubida[p.uuid];
        resultado.ultimoId = r.id;
        resultado.subidas++;
      } catch (e) {
        if (e.sinRed) { resultado.sinRed = true; break; }
        if (e.codigo === 'ACCESO') { accesoRechazado(); break; }
        p.error = e.message;
        p.intentos = (p.intentos || 0) + 1;
        await guardarPendiente(p);
        erroresSubida[p.uuid] = e.message;
      }
    }
  } catch (e) {
    console.error('Error al subir pendientes', e);
  } finally {
    sincronizando = false;
  }

  if (resultado.subidas > 0) await descargarInventario();

  await pintarEstado();
  return resultado;
}

async function subirAhora() {
  const r = await sincronizar();
  const quedan = (await listarPendientes()).length;

  if (r.sinRed) toast('cloud_off', 'Todavía no hay señal. Todo sigue guardado en este celular.');
  else if (r.subidas > 0) toast('cloud_done', r.subidas === 1 ? 'Se subió 1 registro.' : 'Se subieron ' + r.subidas + ' registros.');
  else if (quedan > 0) toast('error', 'El servidor rechazó los pendientes. Toca "Ver" para revisar el motivo.', 6000);
}

async function descartarPendiente(uuid) {
  if (!window.confirm('¿Descartar este registro pendiente? Se borrará de este celular y no se subirá.')) return;
  await borrarPendiente(uuid);
  await pintarEstado();
  pintarVista();
}

async function pintarEstado() {
  try { pendientesCache = await listarPendientes(); } catch (e) { pendientesCache = []; }

  const cuantas = pendientesCache.length;
  const sinSenal = navigator.onLine === false;
  const franja = $('franja');
  const hayError = pendientesCache.some(function(p) { return p.error; });

  let clase = 'ok';
  let icono = 'cloud_done';
  let texto = 'En línea · todo subido';

  const frase = cuantas === 1 ? '1 registro pendiente por subir' : cuantas + ' registros pendientes por subir';

  if (sincronizando && cuantas) { clase = 'sube'; icono = 'sync'; texto = 'Subiendo… ' + frase; }
  else if (hayError) { clase = 'error'; icono = 'error'; texto = frase + ' · el servidor rechazó alguno'; }
  else if (sinSenal) { clase = 'espera'; icono = 'cloud_off'; texto = cuantas ? 'Sin señal · ' + frase : 'Sin señal: lo que guardes queda en este celular.'; }
  else if (cuantas) { clase = 'espera'; icono = 'cloud_upload'; texto = frase; }

  franja.className = 'franja ' + clase;
  $('franjaIco').textContent = icono;
  $('franjaTexto').textContent = texto;
  $('btnSubir').classList.toggle('oculto', !cuantas || sincronizando);
  $('btnVerPendientes').classList.toggle('oculto', !cuantas);
  $('btnVerPendientes').textContent = verPendientes ? 'Ocultar' : 'Ver';

  if (!cuantas) verPendientes = false;

  const lista = $('listaPendientes');
  lista.classList.toggle('oculto', !verPendientes);

  lista.innerHTML = pendientesCache.map(function(p) {
    const d = p.datos;
    const act = p.tipo === 'actualizar';
    const titulo = esMtto(p)
      ? 'Mantenimiento · ' + d.idCamara + ' · ' + d.tipo
      : (act ? 'Datos de ' + d.id + ' · ' + Object.keys(d).filter(function(k) { return ['uuid', 'fechaCaptura', 'id'].indexOf(k) === -1; })
          .map(function(k) { return (campoDe(k) || { l: k }).l; }).join(', ')
        : 'Cámara nueva · ' + d.nivel + ' · ' + d.areaZona);
    const sub = fechaHora(d.fechaCaptura) + (esMtto(p) ? ' · ' + d.tecnico : (act ? '' : ' · ' + d.registradoPor));
    return '<div class="mtto pend"><div class="ico">' + ico(esMtto(p) ? 'build' : (act ? 'edit' : 'videocam')) + '</div><div class="txt">' +
      '<b>' + esc(titulo) + '</b><div class="d">' + esc(sub) + '</div>' +
      (p.error ? '<div class="tags"><span class="tag mal">' + ico('error') + 'Rechazado: ' + esc(p.error) + '</span></div>' : '') +
      '</div><button type="button" class="btn-red" aria-label="Descartar" data-descartar="' + esc(p.uuid) + '">' + ico('delete') + '</button></div>';
  }).join('');
}


/***********************
 * COPIA DEL INVENTARIO
 ***********************/

let descargando = null;

async function cargarCopiaLocal() {
  try {
    const copia = await leerDato('inventario');
    if (copia) {
      registros = copia.registros || [];
      historial = copia.historial || [];
      fechaCopia = copia.fecha || '';
    }
  } catch (e) {
    console.error(e);
  }
  actualizarMarcas();
}

function descargarInventario() {
  if (descargando) return descargando;

  descargando = (async function() {
    try {
      const r = await llamar('inventario', {}, 60000);
      registros = r.registros || [];
      historial = r.historial || [];
      fechaCopia = r.fecha || '';
      await guardarDato('inventario', { registros: registros, historial: historial, fecha: fechaCopia });
      actualizarMarcas();
      return true;
    } catch (e) {
      if (e.codigo === 'ACCESO') accesoRechazado();
      return false;
    } finally {
      descargando = null;
    }
  })();

  return descargando;
}

function distancia(a, b) {
  let fila = [];
  for (let j = 0; j <= b.length; j++) fila[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const nueva = [i];
    for (let j = 1; j <= b.length; j++) {
      nueva[j] = Math.min(fila[j] + 1, nueva[j - 1] + 1, fila[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    fila = nueva;
  }
  return fila[b.length];
}

/** Marcas sugeridas: las de base y las que se repiten en el inventario (sin errores de digitación). */
function actualizarMarcas() {
  function clave(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  const vistas = {};
  const marcas = [];
  const conteo = {};

  MARCAS_BASE.forEach(function(m) { vistas[clave(m)] = true; marcas.push(m); });

  (registros || []).forEach(function(r) {
    const m = String(r.marca || '').trim();
    const k = clave(m);
    if (!k || vistas[k]) return;
    if (!conteo[k]) conteo[k] = { nombre: m, veces: 0 };
    conteo[k].veces++;
  });

  Object.keys(conteo)
    .sort(function(a, b) { return conteo[b].veces - conteo[a].veces; })
    .forEach(function(k) {
      if (conteo[k].veces < 3) return;
      if (Object.keys(vistas).some(function(o) { return distancia(k, o) <= 2; })) return;
      vistas[k] = true;
      marcas.push(conteo[k].nombre);
    });

  $('listaMarcas').innerHTML = marcas.map(function(m) { return '<option value="' + esc(m) + '">'; }).join('');
}

/** Mantenimientos de una cámara: los del servidor y los pendientes de este celular. */
function mttosDe(id) {
  const k = String(id).trim();

  const locales = pendientesCache.filter(function(p) { return esMtto(p) && String(p.datos.idCamara).trim() === k; })
    .map(function(p) {
      const d = p.datos;
      return {
        pendiente: true, error: p.error, orden: d.fechaCaptura, fecha: fechaHora(d.fechaCaptura),
        tipo: d.tipo, actividades: (d.actividades || []).join(', '), estadoImagen: d.estadoImagen,
        huboFalla: !!d.huboFalla, falla: d.falla, repuesto: d.repuesto, diasFuera: d.diasFuera,
        tecnico: d.tecnico, observaciones: d.observaciones, tieneFoto: !!d.foto
      };
    });

  const delServidor = historial.filter(function(h) { return String(h.idCamara).trim() === k; })
    .map(function(h) { return Object.assign({}, h, { fecha: fecha12(h.fecha), orden: h.orden || msDeFecha(h.fecha) }); });

  return locales.concat(delServidor).sort(function(a, b) { return b.orden - a.orden; });
}

/** Fecha del último mantenimiento conocido (historial o campo de la hoja). */
function ultimoMtto(r) {
  const m = mttosDe(r.id)[0];
  if (m) return m.fecha.split(' ')[0];
  return fechaCorta(r.ultimoMantenimiento);
}


/***********************
 * BUSCAR
 ***********************/

const FILTROS = [
  ['', 'Todas', function() { return true; }],
  ['novedad', 'Con novedad', function(r) { return igual(r.estado, 'Operativa con novedad') || igual(r.estado, 'Intermitente') || igual(r.estado, 'En mantenimiento'); }],
  ['fuera', 'Fuera de servicio', function(r) { return igual(r.estado, 'Fuera de servicio'); }],
  ['sinmtto', 'Sin revisión inicial', function(r) { return !ultimoMtto(r); }],
  ['conmtto', 'Con revisión inicial', function(r) { return !!ultimoMtto(r); }],
  ['incompleta', 'Hoja de vida incompleta', function(r) { return avanceHV(datosDe(r)).pct < 100; }],
  ['completa', 'Hoja de vida completa', function(r) { return avanceHV(datosDe(r)).pct === 100; }],
  ['sintorre', 'Sin torre', function(r) { return faltaTorre(datosDe(r)); }],
  ['sinservicio', 'Sin servicio', function(r) { return vacio(datosDe(r).dependencia); }],
  ['cablenovisible', 'Cableado no visible', function(r) { return igual(datosDe(r).estadoCableado, 'No visible'); }]
];

function claseFila(r) {
  if (igual(r.estado, 'Fuera de servicio')) return 'urgente';
  if (igual(r.estado, 'Operativa con novedad') || igual(r.estado, 'Intermitente') || igual(r.estado, 'En mantenimiento')) return 'atender';
  if (igual(r.estado, 'Operativa') && avanceHV(datosDe(r)).pct === 100) return 'completa';
  return '';
}

function tagEstado(estado) {
  const e = String(estado || '').trim();
  if (igual(e, 'Operativa')) return '<span class="tag ok">' + ico('check') + 'Operativa</span>';
  if (igual(e, 'Fuera de servicio')) return '<span class="tag mal">' + ico('error') + 'Fuera de servicio</span>';
  if (e) return '<span class="tag av">' + ico('warning') + esc(e) + '</span>';
  return '<span class="tag">Sin estado</span>';
}

function pintarBuscar() {
  const lista = $('resultados');
  const contador = $('contador');

  if (!registros) {
    $('filtros').innerHTML = '';
    contador.textContent = '';
    lista.innerHTML = '<div class="vacio"><b>Aún no hay inventario en este celular</b>Se descarga solo cuando hay señal.</div>';
    pintarDetalle();
    return;
  }

  const texto = S.texto.trim().toLowerCase();

  const extra = S.extra;

  let base = registros.filter(function(r) {
    if (S.sede && !igual(r.sede, S.sede)) return false;
    // Un criterio puede ser un valor o una lista de valores (cualquiera de ellos)
    if (extra && !Object.keys(extra.crit).every(function(k) {
      return [].concat(extra.crit[k]).some(function(v) { return igual(r[k], v); });
    })) return false;
    if (!texto) return true;
    return Object.keys(r).some(function(k) { return String(r[k] || '').toLowerCase().indexOf(texto) !== -1; });
  });

  $('filtros').innerHTML =
    (extra ? '<button type="button" class="chip activo" data-quitar-extra="1" aria-label="Quitar filtro ' + esc(extra.etiqueta) + '">' +
      esc(extra.etiqueta) + ico('close') + '</button>' : '') +
    ['', 'Barranquilla', 'Baranoa'].map(function(s) {
      return '<button type="button" class="chip" aria-pressed="' + (S.sede === s) + '" data-sede="' + s + '">' +
        (S.sede === s ? ico('check') : '') + (s || 'Las dos sedes') + '</button>';
    }).join('') +
    FILTROS.slice(1).map(function(f) {
      const n = base.filter(f[2]).length;
      return '<button type="button" class="chip" aria-pressed="' + (S.filtro === f[0]) + '" data-filtro="' + f[0] + '">' +
        (S.filtro === f[0] ? ico('check') : '') + esc(f[1]) + ' · ' + n + '</button>';
    }).join('');

  const filtro = FILTROS.filter(function(f) { return f[0] === S.filtro; })[0] || FILTROS[0];
  const res = base.filter(filtro[2]);

  contador.textContent = (res.length === 1 ? '1 cámara' : res.length + ' cámaras') +
    ' · inventario del ' + fecha12(fechaCopia);

  if (!res.length) {
    lista.innerHTML = '<div class="vacio"><b>No hay cámaras con ese filtro</b>Prueba con otra palabra o quita el filtro.</div>';
  } else {
    // Agrupadas por edificación y piso, en el orden del edificio
    const grupos = {};
    const orden = [];

    res.forEach(function(r) {
      const k = (r.edificacion || 'Sin edificación') + '|' + (r.nivel || 'Sin piso');
      if (!grupos[k]) { grupos[k] = []; orden.push(k); }
      grupos[k].push(r);
    });

    orden.sort(function(a, b) {
      const pa = a.split('|');
      const pb = b.split('|');
      const ea = TODAS_LAS_EDIFICACIONES.indexOf(pa[0]);
      const eb = TODAS_LAS_EDIFICACIONES.indexOf(pb[0]);
      return ((ea === -1 ? 99 : ea) - (eb === -1 ? 99 : eb)) || (ordenNivel(pa[1]) - ordenNivel(pb[1])) || pa[1].localeCompare(pb[1]);
    });

    lista.innerHTML = orden.map(function(k) {
      const p = k.split('|');
      const camaras = grupos[k].sort(function(a, b) { return String(a.id).localeCompare(String(b.id)); });
      const conNovedad = camaras.filter(tieneNovedad).length;

      return '<section class="grupo-piso" aria-label="' + esc(p[1] + ', ' + p[0]) + '">' +
        '<h3 class="cab-piso"><span><b>' + esc(p[1]) + '</b><small>' + esc(p[0]) + '</small></span>' +
        '<span class="cuenta">' + (conNovedad ? '<span class="tag av">' + ico('warning') + conNovedad + '</span>' : '') +
        camaras.length + (camaras.length === 1 ? ' cámara' : ' cámaras') + '</span></h3>' +
        camaras.map(htmlFilaCamara).join('') + '</section>';
    }).join('');
  }

  pintarDetalle();
}

function htmlFilaCamara(r) {
      const pct = avanceHV(datosDe(r)).pct;
      return '<button type="button" class="fila toque ' + claseFila(r) + (S.sel === r.id ? ' sel' : '') + '" data-camara="' + esc(r.id) + '">' +
        '<div class="txt"><div class="t1"><span class="num">' + esc(r.id) + '</span>' + tagEstado(r.estado) + '</div>' +
        '<div class="t2">' + esc(r.areaZona || r.tipoUbicacion || '') + '</div>' +
        (tieneNovedad(r) ? '<div class="t-nov">' + ico('warning', 's lleno') + esc(vacio(r.observaciones) ? 'Novedad sin describir' : r.observaciones) + '</div>' : '') +
        '<div class="t3">' + esc([r.tipoCamara, r.marca].filter(String).join(' · ')) +
        ' · Hoja de vida ' + pct + ' %</div></div>' +
        ico('chevron_right') + '</button>';
}

function abrirCamara(id) {
  if (fotos[id] === undefined) {
    fotoDeCamara(id).then(function() { if (S.sel === id && S.modo === 'ficha') pintarDetalle(); });
  }
  if (!S.sel && window.innerWidth < 1024) {
    try { history.pushState({ ficha: 1 }, ''); } catch (e) { /* nada */ }
  }
  S.sel = id;
  S.modo = 'ficha';
  pintarBuscar();
  if (window.innerWidth < 1024) window.scrollTo(0, 0);
}

function cerrarCamara(desdeHistorial) {
  if (!desdeHistorial && history.state && history.state.ficha) { history.back(); return; }
  S.sel = null;
  S.modo = 'ficha';
  pintarBuscar();
}

function camaraSel() {
  return (registros || []).filter(function(r) { return r.id === S.sel; })[0] || null;
}


/***********************
 * FICHA DE LA CÁMARA
 ***********************/

function pintarDetalle() {
  const caja = $('detalle');
  const lista = document.querySelector('#vBuscar .col-lista');
  const r = camaraSel();

  // En el celular la ficha reemplaza a la lista; en el PC van lado a lado
  lista.classList.toggle('oculto', !!r);

  if (!r) {
    caja.innerHTML = '<div class="vacio solo-pc"><b>Elige una cámara</b>Su ficha y su historial aparecen aquí.</div>';
    pintarAccion();
    return;
  }

  if (S.modo === 'mtto') caja.innerHTML = htmlMtto(r);
  else if (S.modo === 'editar') caja.innerHTML = htmlEditar(r);
  else if (S.modo === 'completar') caja.innerHTML = htmlCompletar(r);
  else caja.innerHTML = htmlFicha(r);

  pintarAccion();
}

function htmlCabDetalle(titulo, sub, volver) {
  return '<div class="ficha-cab"><button type="button" class="btn-red ' + (volver === 'lista' ? 'volver-lista' : '') +
    '" data-accion="' + (volver === 'lista' ? 'cerrarCamara' : 'verFicha') + '" aria-label="Volver">' + ico(volver === 'lista' ? 'arrow_back' : 'close') + '</button>' +
    '<div class="txt"><h2>' + titulo + '</h2><small>' + sub + '</small></div></div>';
}

/***********************
 * HOJA DE VIDA
 * Qué cuenta para que la hoja de vida esté completa.
 ***********************/

const CRITERIOS = [
  { k: 'marca', l: 'Marca' },
  { k: 'serial', l: 'Serial' },
  { k: 'ip', l: 'IP' },
  { k: 'nvr', l: 'NVR / DVR' },
  { k: 'canal', l: 'Canal' },
  { k: 'estadoFisico', l: 'Estado físico', revisado: true },
  { k: 'estadoCableado', l: 'Cableado', revisado: true },
  { k: 'mtto', l: 'Revisión inicial' }
];

// Datos que se pueden completar desde la hoja de vida (sin señal)
const COMPLETABLES = ['marca', 'serial', 'ip', 'nvr', 'canal', 'estadoFisico', 'estadoCableado'];

function cumple(c, d) {
  if (c.k === 'mtto') return !!ultimoMtto(d);
  if (c.revisado) return !vacio(d[c.k]) && !igual(d[c.k], 'No verificado');
  return !vacio(d[c.k]);
}

/** { pct, faltan: [criterios], completables: [claves] } */
function avanceHV(d) {
  const faltan = CRITERIOS.filter(function(c) { return !cumple(c, d); });
  return {
    pct: Math.round((CRITERIOS.length - faltan.length) * 100 / CRITERIOS.length),
    faltan: faltan,
    // La torre se pide aparte: no cuenta en los 8 puntos
    torre: faltaTorre(d),
    completables: (faltaTorre(d) ? ['subzona'] : []).concat(
      faltan.map(function(c) { return c.k; }).filter(function(k) { return COMPLETABLES.indexOf(k) !== -1; }))
  };
}

/** Datos de la cámara con los cambios que aún no se han subido. */
function datosDe(r) {
  const d = Object.assign({}, r);
  d.porSubir = {};
  pendientesCache.filter(function(p) { return p.tipo === 'actualizar' && p.datos.id === r.id; })
    .forEach(function(p) {
      Object.keys(p.datos).forEach(function(k) {
        if (['uuid', 'fechaCaptura', 'id'].indexOf(k) !== -1) return;
        d[k] = p.datos[k];
        d.porSubir[k] = true;
      });
    });
  return d;
}

/* ----- Foto de la cámara: se pide al servidor y se guarda en el celular ----- */

const fotos = {};          // id → data URL ('' = no tiene)
const pidiendoFoto = {};

async function fotoDeCamara(id, forzar) {
  if (fotos[id] !== undefined && !forzar) return fotos[id];

  try {
    const guardada = await leerDato('foto:' + id);
    if (guardada !== undefined && !forzar) { fotos[id] = guardada; return guardada; }
  } catch (e) { /* sigue */ }

  if (navigator.onLine === false || !codigoAcceso()) return null;
  if (pidiendoFoto[id]) return pidiendoFoto[id];

  pidiendoFoto[id] = (async function() {
    try {
      const r = await llamar('foto', { id: id }, 60000);
      fotos[id] = r.foto || '';
      await guardarDato('foto:' + id, fotos[id]);
      return fotos[id];
    } catch (e) {
      return null;     // sin señal o servidor viejo: se intenta otra vez después
    } finally {
      delete pidiendoFoto[id];
    }
  })();

  return pidiendoFoto[id];
}

function htmlFotoCamara(r) {
  const f = fotos[r.id];
  if (f) return '<div class="tarjeta" style="padding:8px"><img class="foto-prev" style="margin:0" src="' + f + '" alt="Foto de ' + esc(r.id) + '"></div>';
  if (f === '') return '';
  return '<div class="tarjeta"><p class="ayuda" style="margin:0">' + ico('photo_camera', 's') +
    (navigator.onLine === false ? ' La foto se descarga cuando haya señal.' : ' Cargando la foto…') + '</p></div>';
}

/** ¿La cámara tiene una novedad que mostrar? (todo estado distinto de Operativa) */
function tieneNovedad(d) {
  return !vacio(d.estado) && !igual(d.estado, 'Operativa');
}

function htmlNovedad(d) {
  if (!tieneNovedad(d)) return '';
  const grave = igual(d.estado, 'Fuera de servicio');
  return '<button type="button" class="novedad toque' + (grave ? ' grave' : '') + '" data-accion="editarCampo" data-k="observaciones">' +
    ico(grave ? 'error' : 'warning', 'lleno') + '<span><b>Novedad</b>' +
    (vacio(d.observaciones) ? '<em>No se escribió cuál es. Toca para agregarla.</em>' : esc(d.observaciones)) + '</span></button>';
}

function campoDe(k) { return CAMPOS.filter(function(c) { return c.k === k; })[0]; }

function htmlFicha(r) {
  const d = datosDe(r);
  const mttos = mttosDe(r.id);
  const fallas = mttos.filter(function(m) { return m.huboFalla; });
  const av = avanceHV(d);

  // Toda fila con dato propio se puede tocar para cambiarlo (sin señal)
  function fila(k, etiqueta, valor) {
    const falta = (k === 'subzona' && faltaTorre(d)) || COMPLETABLES.indexOf(k) !== -1 && !cumple(CRITERIOS.filter(function(c) { return c.k === k; })[0] || { k: k }, d);
    const pend = d.porSubir[k] ? ' <span class="tag av">' + ico('cloud_upload') + 'por subir</span>' : '';

    if (falta) {
      return '<button type="button" class="dato falta toque" data-accion="editarCampo" data-k="' + k + '"><span>' + esc(etiqueta) + '</span>' +
        '<span>' + (vacio(valor) ? '' : esc(valor) + ' · ') + 'Falta ' + ico('edit', 's') + '</span></button>';
    }
    if (k && campoDe(k)) {
      return '<button type="button" class="dato toque" data-accion="editarCampo" data-k="' + k + '"><span>' + esc(etiqueta) + '</span>' +
        '<span>' + (vacio(valor) ? '<span class="vacio-dato">Agregar</span>' : esc(valor)) + pend + ' ' + ico('edit', 's lapiz') + '</span></button>';
    }
    return '<div class="dato"><span>' + esc(etiqueta) + '</span><span>' + (vacio(valor) ? '—' : esc(valor)) + pend + '</span></div>';
  }

  const tecnicos = [
    fila('tipoCamara', 'Tipo de cámara', d.tipoCamara),
    fila('marca', 'Marca', d.marca),
    fila('modelo', 'Modelo', d.modelo),
    fila('serial', 'Serial', d.serial),
    fila('ip', 'IP', d.ip),
    fila('nvr', 'NVR / DVR', d.nvr),
    fila('canal', 'Canal', d.canal),
    fila('visionNocturna', 'Visión nocturna', d.visionNocturna),
    fila('audio', 'Audio', d.audio),
    fila('estadoFisico', 'Estado físico', d.estadoFisico),
    fila('estadoCableado', 'Cableado', d.estadoCableado)
  ].join('');

  const ubicacion = [
    fila('', 'Sede', d.sede),
    fila('', 'Edificación', String(d.edificacion || '').replace(d.sede + ' - ', '')),
    fila('nivel', 'Piso', d.nivel),
    fila('subzona', 'Torre', d.subzona),
    fila('dependencia', 'Servicio', d.dependencia),
    fila('areaZona', 'Punto exacto', d.areaZona)
  ].join('');

  const inventario = [
    fila('proximoMantenimiento', 'Próximo mantenimiento', fechaCorta(d.proximoMantenimiento)),
    fila('responsable', 'Responsable', d.responsable),
    fila('estado', 'Estado', d.estado),
    fila('observaciones', 'Observaciones / novedad', d.observaciones),
    fila('', 'Inventariada por', [d.registradoPor, fecha12(d.fechaRegistro)].filter(String).join(' · '))
  ].join('');

  // Avance en una sola línea (sin tarjeta ni barra)
  const faltanTodo = (av.torre ? ['Torre'] : []).concat(av.faltan.map(function(c) { return c.l; }));
  const avance =
    '<div class="linea-hv">' +
      '<span><b>Hoja de vida ' + (CRITERIOS.length - av.faltan.length) + ' de ' + CRITERIOS.length + '</b>' +
      (faltanTodo.length ? ' · Falta: ' + esc(faltanTodo.join(', ')) : '') + '</span>' +
      (faltanTodo.length ? (av.completables.length ? '<button type="button" class="btn tono mini" data-accion="completar">' + ico('edit') + 'Completar</button>' : '')
                        : chipListo()) +
    '</div>';

  const listaMttos = mttos.length ? mttos.map(htmlMttoFila).join('') :
    '<div class="vacio"><b>Sin mantenimientos</b>La primera vez que la revisen queda como revisión inicial.' +
    '<button type="button" class="btn prin mini" style="margin-top:12px;width:100%" data-accion="mtto">' + ico('build') + 'Registrar revisión inicial</button></div>';

  const listaFallas = fallas.length ? fallas.map(function(m) {
    return '<div class="dato"><span>' + esc(m.fecha.split(' ')[0]) + '<br><small>' + esc(m.tecnico) + '</small></span><span>' +
      esc(m.falla) + (m.repuesto ? '<br><small>Repuesto: ' + esc(m.repuesto) + '</small>' : '') +
      (m.diasFuera !== '' && m.diasFuera !== undefined ? '<br><small>' + esc(m.diasFuera) + ' días fuera</small>' : '') + '</span></div>';
  }).join('') : '<div class="dato"><span>Sin fallas registradas</span><span></span></div>';

  return '<div class="vista" style="padding:0">' +
    htmlCabDetalle(esc(r.id), esc([d.sede, String(d.edificacion).replace(d.sede + ' - ', ''), d.nivel].filter(String).join(' · ')), 'lista') +
    '<div>' + tagEstado(d.estado) + '</div>' +
    htmlNovedad(d) +
    avance +
    htmlFotoCamara(r) +
    '<div class="secc"><span>Datos técnicos</span><button type="button" class="link" data-accion="editar">' + ico('edit', 's') + 'Editar todo</button></div>' +
    '<div class="grupo">' + tecnicos + '</div>' +
    '<div class="secc"><span>Mantenimientos (' + mttos.length + ')</span><span class="opc">' + (mttos.length ? 'más reciente primero' : '') + '</span></div>' +
    '<div class="lista">' + listaMttos + '</div>' +
    '<div class="secc"><span>Fallas y reparaciones (' + fallas.length + ')</span></div>' +
    '<div class="grupo">' + listaFallas + '</div>' +
    '<div class="secc"><span>Ubicación</span></div>' +
    '<div class="grupo">' + ubicacion + '</div>' +
    '<div class="secc"><span>Inventario</span></div>' +
    '<div class="grupo">' + inventario + '</div>' +
    '</div>';
}


/***********************
 * COMPLETAR LO QUE FALTA (funciona sin señal)
 ***********************/

function abrirCompletar(soloClave) {
  const r = camaraSel();
  if (!r) return;
  const d = datosDe(r);
  const claves = soloClave ? [soloClave] : avanceHV(d).completables;
  if (!claves.length) return;

  S.cp = { claves: claves, errores: {}, uno: !!soloClave };
  claves.forEach(function(k) { S.cp[k] = igual(d[k], 'No verificado') || (k === 'subzona' && faltaTorre(d)) ? '' : (d[k] || ''); });
  S.modo = 'completar';
  pintarDetalle();
  window.scrollTo(0, 0);
}

function htmlCompletar(r) {
  const campos = S.cp.claves.map(function(k) {
    const c = Object.assign({}, campoDe(k));
    c.secc = S.cp.uno ? c.l : 'Datos que faltan';
    c.req = false;
    // Opciones que dependen de la ubicación (torre, piso): se calculan con los datos de la cámara
    if (typeof c.o === 'function') c.o = c.o(datosDe(r));
    // En el cableado y el estado físico no se ofrece "No verificado"
    if (k === 'estadoFisico') c.o = ['Bueno', 'Regular', 'Malo'];
    if (k === 'estadoCableado') c.o = ['Bueno', 'Regular', 'Malo', 'No visible'];
    return c;
  });

  const titulo = S.cp.uno ? 'Cambiar ' + campos[0].l.toLowerCase() : 'Completar datos';

  return '<div class="vista" style="padding:0">' +
    htmlCabDetalle(esc(titulo), esc(r.id) + ' · se guarda aunque no haya señal', 'ficha') +
    htmlCampos(campos, S.cp, S.cp.errores, 'c_').replace(/<span class="opc">opcional<\/span>/g, '') +
    (S.cp.uno ? '' : '<p class="nota">Llena lo que tengas a mano; lo que dejes vacío sigue apareciendo como "Falta".</p>') +
    '</div>';
}

async function guardarCompletar() {
  if (guardando) return;
  const r = camaraSel();
  if (!r || !S.cp) return;

  prepararSonido();

  const datos = { uuid: nuevoUuid(), fechaCaptura: Date.now(), id: r.id };
  let cuantos = 0;

  const antes = datosDe(r);

  S.cp.claves.forEach(function(k) {
    const v = String(S.cp[k] || '').trim();
    if (v && v !== String(antes[k] || '').trim()) { datos[k] = v; cuantos++; }
  });

  if (!cuantos) {
    sonarFalta();
    toast('error', S.cp.uno ? 'No cambiaste nada.' : 'No llenaste ningún dato.');
    return;
  }

  guardando = true;

  try {
    await guardarPendiente({ uuid: datos.uuid, tipo: 'actualizar', datos: datos, intentos: 0 });
    S.cp = null;
    S.modo = 'ficha';
    await pintarEstado();
    pintarDetalle();
    window.scrollTo(0, 0);
    sonarListo();
    toast('cloud_upload', 'Datos guardados en el celular. Subiendo…');

    const res = await sincronizar();

    if (res.ids[datos.uuid]) toast('cloud_done', 'Datos de ' + r.id + ' guardados en la hoja.', 5000);
    else if (res.errores[datos.uuid]) { sonarError(); toast('error', 'El servidor los rechazó: ' + res.errores[datos.uuid], 8000); }
    else toast('cloud_off', 'Sin señal: quedaron en este celular y se subirán solos cuando vuelva la conexión.', 6000);

    pintarVista();
  } catch (e) {
    sonarError();
    toast('error', 'No se pudo guardar en el celular: ' + e.message, 8000);
  } finally {
    guardando = false;
  }
}


/***********************
 * PDF DE LA HOJA DE VIDA (se arma en el celular)
 ***********************/

function cargarScript(src) {
  return new Promise(function(resolve, reject) {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = function() { reject(new Error('No se pudo cargar el generador de PDF. Abre la app una vez con señal.')); };
    document.head.appendChild(s);
  });
}

async function cargarLibreriasPdf() {
  if (!(window.jspdf && window.jspdf.jsPDF)) await cargarScript('lib/jspdf.umd.min.js');
  const J = window.jspdf && window.jspdf.jsPDF;
  if (!J) throw new Error('No se pudo cargar el generador de PDF.');
  if (!J.API.autoTable) {
    await cargarScript('lib/jspdf.plugin.autotable.min.js');
    if (!J.API.autoTable && typeof window.applyPlugin === 'function') window.applyPlugin(J);
  }
  if (!J.API.autoTable) throw new Error('No se pudo cargar el generador de tablas del PDF.');
}

let logoCache = null;

async function logoPdf() {
  if (logoCache) return logoCache;
  try {
    const blob = await (await fetch('logo-crc.jpg')).blob();
    logoCache = await new Promise(function(ok, mal) {
      const l = new FileReader();
      l.onload = function() { ok(l.result); };
      l.onerror = mal;
      l.readAsDataURL(blob);
    });
  } catch (e) {
    logoCache = null;
  }
  return logoCache;
}

let logoRedondoCache = null;
/** Logo redondo (con su círculo blanco) para la franja vino del encabezado del PDF. */
async function logoRedondoPdf() {
  if (logoRedondoCache) return logoRedondoCache;
  try {
    const blob = await (await fetch('logo-pdf.png')).blob();
    logoRedondoCache = await new Promise(function(ok, mal) {
      const l = new FileReader();
      l.onload = function() { ok(l.result); };
      l.onerror = mal;
      l.readAsDataURL(blob);
    });
  } catch (e) {
    logoRedondoCache = null;
  }
  return logoRedondoCache;
}

function tamImagenPdf(src) {
  return new Promise(function(ok) {
    const im = new Image();
    im.onload = function() { ok({ w: im.naturalWidth || im.width, h: im.naturalHeight || im.height }); };
    im.onerror = function() { ok({ w: 4, h: 3 }); };
    im.src = src;
  });
}

/**
 * Hoja de vida en PDF con el mismo estilo de las hojas de vida de gases medicinales:
 * franja vino con logo, secciones con borde y título vino, datos en cuadrícula y tablas con líneas.
 */
async function construirPdfHV(r) {
  await cargarLibreriasPdf();

  const d = datosDe(r);
  const mttos = mttosDe(r.id).slice().reverse();
  const fallas = mttos.filter(function(m) { return m.huboFalla; });
  const av = avanceHV(d);

  const jsPDF = window.jspdf.jsPDF;
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait', compress: true });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 12;
  const VINO = [132, 48, 63], TINTA = [34, 34, 34], SUAVE = [110, 110, 110], BORDE = [196, 176, 182], LINEAS = [218, 206, 210];
  const ARRIBA = 40, ABAJO = H - 14, TIT = 9;
  const hoy = new Date();
  const fechaHoy = dos(hoy.getDate()) + '/' + dos(hoy.getMonth() + 1) + '/' + hoy.getFullYear();
  const color = function(c, tipo) { if (tipo === 'f') doc.setFillColor(c[0], c[1], c[2]); else if (tipo === 'd') doc.setDrawColor(c[0], c[1], c[2]); else doc.setTextColor(c[0], c[1], c[2]); };
  const letra = function(tam, negrita) { doc.setFont('helvetica', negrita ? 'bold' : 'normal'); doc.setFontSize(tam); };
  const val = function(v) { return vacio(v) ? '—' : String(v).trim(); };
  const nueva = function() { doc.addPage(); return ARRIBA; };
  const ESTADOS = { 'Operativa': [30, 107, 58], 'Fuera de servicio': [179, 38, 30] };

  function franja(n, t, x, y, ancho) {
    color(VINO, 'f'); doc.roundedRect(x, y, ancho, TIT, 2.5, 2.5, 'F'); doc.rect(x, y + TIT - 3, ancho, 3, 'F');
    letra(9.5, true); doc.setTextColor(240, 205, 212); doc.text(String(n), x + 4, y + 6.1);
    doc.setTextColor(255, 255, 255); doc.text(t.toUpperCase(), x + 8.5, y + 6.1, { charSpace: 0.25 });
  }
  // Recuadro con franja de título y datos en cuadrícula
  function bloque(n, t, items, cols, x, y, ancho, minAlto) {
    const cw = ancho / cols, filas = [];
    for (let i = 0; i < items.length; i += cols) {
      let alto = 0;
      items.slice(i, i + cols).forEach(function(it) {
        letra(10, true);
        it.lineas = doc.splitTextToSize(val(it.v), cw - 7);
        alto = Math.max(alto, 4 + it.lineas.length * 4.2);
      });
      filas.push(alto + 3);
    }
    let alto = TIT + filas.reduce(function(a, b) { return a + b; }, 0);
    if (minAlto && alto < minAlto) { const extra = (minAlto - alto) / filas.length; for (let i = 0; i < filas.length; i++) filas[i] += extra; alto = minAlto; }
    color([255, 255, 255], 'f'); doc.roundedRect(x, y, ancho, alto, 2.5, 2.5, 'F');
    franja(n, t, x, y, ancho);
    color(LINEAS, 'd'); doc.setLineWidth(0.2);
    let yy = y + TIT;
    filas.forEach(function(f, k) {
      if (k < filas.length - 1) doc.line(x, yy + f, x + ancho, yy + f);
      for (let c = 1; c < cols; c++) doc.line(x + c * cw, yy, x + c * cw, yy + f);
      yy += f;
    });
    yy = y + TIT;
    items.forEach(function(it, i) {
      const col = i % cols;
      if (col === 0 && i > 0) yy += filas[Math.floor(i / cols) - 1];
      const xx = x + col * cw + 4;
      letra(7, true); color(VINO); doc.text(it.e.toUpperCase(), xx, yy + 3.9, { charSpace: 0.12 });
      letra(10, true);
      if (it.estado && ESTADOS[it.v]) color(ESTADOS[it.v]); else if (it.estado && !vacio(it.v)) doc.setTextColor(122, 74, 0); else doc.setTextColor(0, 0, 0);
      doc.text(it.lineas, xx, yy + 8);
    });
    color(BORDE, 'd'); doc.setLineWidth(0.3); doc.roundedRect(x, y, ancho, alto, 2.5, 2.5, 'S');
    return alto;
  }
  function bloqueEnPagina(n, t, items, cols, y) {
    if (y + TIT + 12 * Math.ceil(items.length / cols) > ABAJO) y = nueva();
    return y + bloque(n, t, items, cols, M, y, W - 2 * M) + 4;
  }
  // Tabla con franja de título y borde exterior
  function tabla(n, t, head, body, columnStyles, y) {
    if (y + TIT + 24 > ABAJO) y = nueva();
    const yIni = y, pag = doc.getNumberOfPages();
    franja(n, t, M, y, W - 2 * M);
    doc.autoTable({
      startY: y + TIT, margin: { left: M, right: M, top: ARRIBA, bottom: 16 }, theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8.8, textColor: TINTA, lineColor: LINEAS, lineWidth: 0.2, cellPadding: { top: 1.8, bottom: 1.8, left: 2.5, right: 2.5 }, valign: 'top', fillColor: [255, 255, 255], minCellHeight: 7 },
      head: [head], headStyles: { fillColor: [250, 246, 247], textColor: [74, 52, 58], fontStyle: 'bold', fontSize: 7.4 },
      body: body, columnStyles: columnStyles
    });
    color(BORDE, 'd'); doc.setLineWidth(0.3);
    if (doc.getNumberOfPages() === pag) doc.roundedRect(M, yIni, W - 2 * M, doc.lastAutoTable.finalY - yIni, 2.5, 2.5, 'S');
    return doc.lastAutoTable.finalY + 4;
  }

  let y = ARRIBA;
  // Novedad (franja ámbar o roja) como antes
  if (tieneNovedad(d)) {
    letra(9, true);
    const texto = doc.splitTextToSize('Novedad: ' + (vacio(d.observaciones) ? 'sin describir' : d.observaciones), W - 2 * M - 8);
    const alto = 4 + texto.length * 4;
    const grave = igual(d.estado, 'Fuera de servicio');
    if (grave) doc.setFillColor(252, 228, 225); else doc.setFillColor(255, 243, 220);
    doc.roundedRect(M, y, W - 2 * M, alto, 2.5, 2.5, 'F');
    if (grave) doc.setTextColor(179, 38, 30); else doc.setTextColor(122, 74, 0);
    doc.text(texto, M + 4, y + 5);
    y += alto + 4;
  }

  // 1. Foto + identificación y ubicación
  const foto = await fotoDeCamara(r.id);
  const fw = 60, xi = M + fw + 4, ai = W - M - xi;
  const altoId = bloque(1, 'Identificación y ubicación', [
    { e: 'Sede', v: d.sede }, { e: 'Edificación', v: d.edificacion }, { e: 'Piso', v: d.nivel },
    { e: 'Torre', v: d.subzona }, { e: 'Servicio', v: d.dependencia || 'Sin servicio' }, { e: 'Punto exacto', v: d.areaZona },
    { e: 'Tipo de cámara', v: d.tipoCamara }, { e: 'Estado', v: d.estado || 'Sin estado', estado: true }, { e: 'Hoja de vida', v: av.pct + ' %' }
  ], 3, xi, y, ai, 46);
  if (foto) {
    try {
      const t = await tamImagenPdf(foto);
      const s = Math.max(fw / t.w, altoId / t.h), iw = t.w * s, ih = t.h * s;
      doc.saveGraphicsState();
      doc.roundedRect(M, y, fw, altoId, 2.5, 2.5, null); doc.clip(); doc.discardPath();
      doc.addImage(foto, /png/.test(foto.slice(0, 30)) ? 'PNG' : 'JPEG', M + (fw - iw) / 2, y + (altoId - ih) / 2, iw, ih);
      doc.restoreGraphicsState();
    } catch (e) {
      console.error('Foto en el PDF', e);
    }
  } else {
    doc.setFillColor(247, 244, 245); doc.roundedRect(M, y, fw, altoId, 2.5, 2.5, 'F');
    letra(9, false); color(SUAVE); doc.text('Sin foto de la cámara', M + fw / 2, y + altoId / 2, { align: 'center' });
  }
  y += altoId + 4;

  // 2. Datos técnicos
  y = bloqueEnPagina(2, 'Datos técnicos', [
    { e: 'Marca', v: d.marca }, { e: 'Modelo', v: d.modelo }, { e: 'Serial', v: d.serial }, { e: 'Visión nocturna', v: d.visionNocturna },
    { e: 'Audio', v: d.audio }, { e: 'IP', v: d.ip }, { e: 'NVR / DVR', v: d.nvr }, { e: 'Canal', v: d.canal }
  ], 4, y);

  // 3. Estado y mantenimiento
  y = bloqueEnPagina(3, 'Estado y mantenimiento', [
    { e: 'Estado físico', v: d.estadoFisico }, { e: 'Cableado', v: d.estadoCableado }, { e: 'Responsable', v: d.responsable },
    { e: 'Último mantenimiento', v: ultimoMtto(d) }, { e: 'Próximo mantenimiento', v: fechaCorta(d.proximoMantenimiento) },
    { e: 'Inventariada por', v: [d.registradoPor, fecha12(d.fechaRegistro)].filter(String).join(' · ') }
  ], 3, y);
  if (!vacio(d.observaciones) && !tieneNovedad(d)) {
    letra(8.8, false); const lineas = doc.splitTextToSize(d.observaciones, W - 2 * M - 34);
    if (y + lineas.length * 4 + 6 > ABAJO) y = nueva();
    letra(8.8, true); color(TINTA); doc.text('Observaciones:', M + 1, y + 3);
    letra(8.8, false); doc.text(lineas, M + 27, y + 3);
    y += lineas.length * 4 + 4;
  }

  // 4. Mantenimientos (con filas en blanco para llenar a mano)
  const filasM = mttos.map(function(m) {
    return [m.fecha.split(' ')[0], m.tipo, [m.actividades, m.observaciones].filter(function(x) { return !vacio(x); }).join(' · '),
      m.estadoImagen || '', m.tecnico || ''];
  });
  const totalM = filasM.length ? filasM.length + 2 : 5;
  while (filasM.length < totalM) filasM.push(['', '', '', '', '']);
  y = tabla(4, 'Mantenimientos', ['FECHA', 'TIPO', 'ACTIVIDADES', 'IMAGEN', 'TÉCNICO'], filasM,
    { 0: { cellWidth: 22 }, 1: { cellWidth: 26 }, 3: { cellWidth: 20 }, 4: { cellWidth: 34 } }, y);

  // 5. Fallas y reparaciones
  const filasF = fallas.map(function(m) {
    return [m.fecha.split(' ')[0], m.falla || '', m.repuesto || '', m.diasFuera === undefined ? '' : String(m.diasFuera), m.tecnico || ''];
  });
  const totalF = filasF.length ? filasF.length + 1 : 3;
  while (filasF.length < totalF) filasF.push(['', '', '', '', '']);
  y = tabla(5, 'Fallas y reparaciones', ['FECHA', 'FALLA', 'REPUESTO', 'DÍAS FUERA', 'TÉCNICO'], filasF,
    { 0: { cellWidth: 22 }, 2: { cellWidth: 36 }, 3: { cellWidth: 20 }, 4: { cellWidth: 34 } }, y);

  // Firmas Elaboró / Revisó
  y += 1;
  if (y + 22 > H - 9) y = nueva();
  const anchoF = (W - 2 * M - 10) / 2;
  [['Elaboró', 'Técnico'], ['Revisó', 'Jefe de monitoreo']].forEach(function(f, i) {
    const x = M + i * (anchoF + 10);
    doc.setDrawColor(227, 215, 218); doc.setLineWidth(0.3); doc.roundedRect(x, y, anchoF, 22, 2.5, 2.5, 'S');
    letra(7.5, true); doc.setTextColor(74, 52, 58); doc.text(f[0].toUpperCase(), x + 4, y + 5.5, { charSpace: 0.2 });
    doc.setDrawColor(85, 85, 85); doc.setLineWidth(0.25); doc.line(x + 8, y + 14, x + anchoF - 8, y + 14);
    letra(8, false); color(SUAVE); doc.text(f[1], x + anchoF / 2, y + 18.5, { align: 'center' });
  });

  // Encabezado en todas las páginas: franja vino con logo, título y código / versión (en blanco) / fecha / página
  const logo = await logoRedondoPdf();
  const total = doc.getNumberOfPages();
  for (let n = 1; n <= total; n++) {
    doc.setPage(n);
    const y0 = 10, alto = 25, an = W - 2 * M;
    color(VINO, 'f'); doc.roundedRect(M, y0, an, alto, 3, 3, 'F');
    if (logo) doc.addImage(logo, 'PNG', M + 5, y0 + 2.5, 20, 20);
    const xt = M + 30;
    letra(14, true); doc.setTextColor(255, 255, 255); doc.text('HOJA DE VIDA DE CÁMARA CCTV', xt, y0 + 10, { charSpace: 0.2 });
    letra(9.5, false); doc.setTextColor(250, 235, 238); doc.text('Departamento de Seguridad', xt, y0 + 15.5);
    letra(8.2, false); doc.setTextColor(225, 190, 198);
    doc.text([r.id, d.dependencia, d.areaZona].filter(function(x) { return !vacio(x); }).join(' · '), xt, y0 + 20, { maxWidth: an - 30 - 48 });
    const xe = M + an - 44, xv = M + an - 27;
    [['Código', '________'], ['Versión', '____'], ['Fecha', fechaHoy], ['Página', n + ' de ' + total]].forEach(function(f, i) {
      const yy = y0 + 6.6 + i * 4.6;
      letra(8.2, false); doc.setTextColor(225, 190, 198); doc.text(f[0], xe, yy);
      letra(8.2, true); doc.setTextColor(255, 255, 255); doc.text(f[1], xv, yy);
    });
    letra(7.5, false); doc.setTextColor(136, 136, 136);
    doc.text('Generado desde el Inventario CCTV el ' + fechaHoy + ' a las ' + hora12(hoy.getHours(), hoy.getMinutes()) + ' · Clínica Reina Catalina', W / 2, H - 6, { align: 'center' });
  }

  return { blob: doc.output('blob'), nombre: 'Hoja de vida ' + r.id + '.pdf' };
}

async function pdfHojaDeVida() {
  const r = camaraSel();
  if (!r || guardando) return;

  guardando = true;
  toast('sync', 'Armando el PDF…', 2000);

  try {
    const pdf = await construirPdfHV(r);
    // Se descarga directo, en el celular y en el PC (queda en Descargas para compartirlo desde ahí)
    descargarBlob(pdf.blob, pdf.nombre);
  } catch (e) {
    sonarError();
    toast('error', e.message, 6000);
  } finally {
    guardando = false;
  }
}

function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function() { URL.revokeObjectURL(url); }, 60000);
  toast('download', 'PDF descargado: ' + nombre);
}

function htmlMttoFila(m) {
  const tags = [];

  if (m.pendiente) tags.push(m.error ? '<span class="tag mal">' + ico('error') + 'Rechazado: ' + esc(m.error) + '</span>' : '<span class="tag av">' + ico('cloud_upload') + 'Pendiente por subir</span>');
  if (m.estadoImagen) tags.push('<span class="tag ' + (igual(m.estadoImagen, 'Buena') ? 'ok' : (igual(m.estadoImagen, 'Regular') ? 'av' : 'mal')) + '">Imagen ' + esc(m.estadoImagen.toLowerCase()) + '</span>');
  if (m.huboFalla && m.diasFuera !== '' && m.diasFuera !== undefined) tags.push('<span class="tag">' + esc(m.diasFuera) + (Number(m.diasFuera) === 1 ? ' día' : ' días') + ' fuera</span>');
  if (m.tieneFoto) tags.push('<span class="tag rosa">' + ico('photo_camera') + 'Con foto</span>');

  const detalle = [m.actividades, m.huboFalla ? 'Falla: ' + m.falla + (m.repuesto ? ' · Repuesto: ' + m.repuesto : '') : '', m.observaciones]
    .filter(function(x) { return !vacio(x); }).join(' · ');

  return '<div class="mtto ' + (m.pendiente ? 'pend' : (m.huboFalla ? 'falla' : '')) + '">' +
    '<div class="ico">' + ico(m.huboFalla ? 'warning' : 'build', 'lleno') + '</div><div class="txt">' +
    '<b>' + esc(m.tipo) + ' · ' + esc(m.fecha) + '</b>' +
    '<div class="d">' + esc(detalle || 'Sin detalle') + '</div>' +
    '<div class="d">' + esc(m.tecnico) + '</div>' +
    (tags.length ? '<div class="tags">' + tags.join('') + '</div>' : '') +
    '</div></div>';
}


/***********************
 * REGISTRAR MANTENIMIENTO
 ***********************/

function abrirMtto() {
  const r = camaraSel();
  if (!r) return;

  S.mt = {
    tipo: mttosDe(r.id).length || ultimoMtto(r) ? 'Preventivo' : 'Revisión inicial',
    actividades: [], imagen: '', falla: false, fallaTxt: '', repuesto: '', dias: '', obs: '',
    foto: '', tecnico: ls.get('tecnico', ''), errores: {}, abierto: Date.now()
  };
  S.modo = 'mtto';
  pintarDetalle();
  window.scrollTo(0, 0);
}

function htmlMtto(r) {
  const m = S.mt;
  const e = m.errores;

  function err(k) { return e[k] ? '<p class="error-campo">' + ico('error', 's') + esc(e[k]) + '</p>' : ''; }

  const hechoActiv = m.actividades.length > 0;
  const hechoImagen = !!m.imagen;
  const hechoFalla = !m.falla || !vacio(m.fallaTxt);
  const hechoTecnico = !vacio(m.tecnico);

  return '<div class="vista" style="padding:0">' +
    htmlCabDetalle('Mantenimiento', esc(r.id) + ' · ' + esc(fechaHora(m.abierto)), 'ficha') +

    '<div class="secc"><span>Tipo</span></div>' +
    '<div class="tarjeta" style="padding:8px"><div class="seg" role="group" aria-label="Tipo de mantenimiento">' +
      TIPOS_MTTO.map(function(t) {
        return '<button type="button" aria-pressed="' + (m.tipo === t) + '" data-mt="tipo" data-valor="' + esc(t) + '">' + esc(t) + '</button>';
      }).join('') + '</div></div>' +

    '<div class="secc"><span>Qué se hizo</span>' + (hechoActiv ? chipListo() : '') + '</div>' +
    '<div class="tarjeta' + (e.actividades ? ' campo mal' : '') + '"><div class="chips" role="group" aria-label="Qué se hizo">' +
      ACTIVIDADES.map(function(a) {
        const on = m.actividades.indexOf(a) !== -1;
        return '<button type="button" class="chip" aria-pressed="' + on + '" data-mt="actividad" data-valor="' + esc(a) + '">' + (on ? ico('check') : '') + esc(a) + '</button>';
      }).join('') + '</div><p class="ayuda">Puedes marcar varias.</p>' + err('actividades') + '</div>' +

    '<div class="secc"><span>Cómo quedó la imagen</span>' + (hechoImagen ? chipListo() : '') + '</div>' +
    '<div class="tarjeta' + (e.imagen ? ' campo mal' : '') + '" style="padding:8px"><div class="seg" role="group" aria-label="Cómo quedó la imagen">' +
      ESTADOS_IMAGEN.map(function(t) {
        return '<button type="button" aria-pressed="' + (m.imagen === t) + '" data-mt="imagen" data-valor="' + esc(t) + '">' + esc(t) + '</button>';
      }).join('') + '</div>' + (e.imagen ? '<div style="padding:0 10px 6px">' + err('imagen') + '</div>' : '') + '</div>' +

    '<div class="secc"><span>Falla encontrada</span><span data-listo="fallaTxt">' + (m.falla && hechoFalla ? chipListo() : '') + '</span></div>' +
    '<div class="grupo">' +
      '<div><button type="button" class="fila-sw" role="switch" aria-checked="' + m.falla + '" data-mt="falla">' +
        '<span>¿Se encontró una falla?</span><span class="sw" aria-hidden="true"></span></button></div>' +
      (m.falla ?
        '<div class="campo' + (e.fallaTxt ? ' mal' : '') + '"><label class="etq" for="mt_falla"><span>Qué falla tenía</span></label>' +
          '<input id="mt_falla" class="entrada" data-mtx="fallaTxt" value="' + esc(m.fallaTxt) + '" placeholder="Sin video, imagen borrosa, sin energía">' + err('fallaTxt') + '</div>' +
        '<div class="campo"><label class="etq" for="mt_rep"><span>Repuesto cambiado</span><em>opcional</em></label>' +
          '<input id="mt_rep" class="entrada" data-mtx="repuesto" value="' + esc(m.repuesto) + '" placeholder="Fuente 12 V, conector BNC"></div>' +
        '<div class="campo"><label class="etq" for="mt_dias"><span>Días fuera de servicio</span><em>opcional</em></label>' +
          '<input id="mt_dias" class="entrada" data-mtx="dias" inputmode="numeric" value="' + esc(m.dias) + '" placeholder="0"></div>'
        : '') +
    '</div>' +

    '<div class="secc"><span>Observaciones</span><span class="opc">opcional</span></div>' +
    '<div class="grupo"><div class="campo"><label class="sr" for="mt_obs">Observaciones</label>' +
      '<textarea id="mt_obs" class="entrada" data-mtx="obs" placeholder="Humedad en la carcasa, cable suelto…">' + esc(m.obs) + '</textarea></div></div>' +

    '<div class="secc"><span>Foto de evidencia</span><span class="opc">opcional</span></div>' +
    '<div class="tarjeta"><button type="button" class="foto-btn" data-accion="fotoMtto">' + ico('photo_camera') + (m.foto ? 'Cambiar foto' : 'Tomar foto') + '</button>' +
      (m.foto ? '<img class="foto-prev" src="' + m.foto + '" alt="Foto de evidencia">' : '') + '</div>' +

    '<div class="secc"><span>Técnico</span><span data-listo="tecnico">' + (hechoTecnico ? chipListo() : '') + '</span></div>' +
    '<div class="grupo"><div class="campo' + (e.tecnico ? ' mal' : '') + '"><label class="sr" for="mt_tec">Técnico</label>' +
      '<input id="mt_tec" class="entrada" data-mtx="tecnico" value="' + esc(m.tecnico) + '" placeholder="Nombre de quien hizo el trabajo" autocomplete="name">' + err('tecnico') + '</div></div>' +
    '</div>';
}

function cambiarMtto(campo, valor) {
  const m = S.mt;

  if (campo === 'tipo') m.tipo = valor;
  if (campo === 'imagen') m.imagen = m.imagen === valor ? '' : valor;
  if (campo === 'falla') m.falla = !m.falla;
  if (campo === 'actividad') {
    const i = m.actividades.indexOf(valor);
    if (i === -1) m.actividades.push(valor); else m.actividades.splice(i, 1);
  }

  delete m.errores[campo === 'actividad' ? 'actividades' : campo];
  pintarDetalle();
}

async function guardarMtto() {
  if (guardando) return;
  const r = camaraSel();
  const m = S.mt;
  if (!r || !m) return;

  prepararSonido();

  m.errores = {};
  if (!m.actividades.length) m.errores.actividades = 'Marca al menos una actividad.';
  if (!m.imagen) m.errores.imagen = 'Elige cómo quedó la imagen.';
  if (m.falla && vacio(m.fallaTxt)) m.errores.fallaTxt = 'Escribe qué falla tenía.';
  if (m.falla && !vacio(m.dias) && isNaN(Number(String(m.dias).replace(',', '.')))) m.errores.dias = 'Escribe solo el número de días.';
  if (vacio(m.tecnico)) m.errores.tecnico = 'Escribe el nombre del técnico.';

  if (Object.keys(m.errores).length) {
    pintarDetalle();
    const nombres = { actividades: 'qué se hizo', imagen: 'cómo quedó la imagen', fallaTxt: 'qué falla tenía', dias: 'días fuera de servicio', tecnico: 'técnico' };
    avisarFalta(Object.keys(m.errores).map(function(k) { return nombres[k] || k; }), function() {
      irAlCampo(document.querySelector('#detalle .mal'));
    });
    return;
  }

  guardando = true;

  try {
    const datos = {
      uuid: nuevoUuid(),
      fechaCaptura: Date.now(),
      idCamara: r.id,
      tipo: m.tipo,
      actividades: m.actividades.slice(),
      estadoImagen: m.imagen,
      huboFalla: m.falla,
      falla: m.falla ? m.fallaTxt.trim() : '',
      repuesto: m.falla ? m.repuesto.trim() : '',
      diasFuera: m.falla ? String(m.dias).replace(',', '.').trim() : '',
      observaciones: m.obs.trim(),
      tecnico: m.tecnico.trim(),
      foto: m.foto || ''
    };

    ls.set('tecnico', datos.tecnico);
    await guardarPendiente({ uuid: datos.uuid, tipo: 'mantenimiento', datos: datos, intentos: 0 });

    S.mt = null;
    S.modo = 'ficha';
    await pintarEstado();
    pintarDetalle();
    window.scrollTo(0, 0);

    sonarListo();
    toast('cloud_upload', 'Mantenimiento guardado en el celular. Subiendo…');

    const res = await sincronizar();

    if (res.ids[datos.uuid]) toast('cloud_done', 'Mantenimiento de ' + r.id + ' registrado en la hoja de vida.', 5000);
    else if (res.errores[datos.uuid]) { sonarError(); toast('error', 'El servidor lo rechazó: ' + res.errores[datos.uuid], 8000); }
    else toast('cloud_off', 'Sin señal: quedó en este celular y se subirá solo cuando vuelva la conexión.', 6000);

    pintarVista();
  } catch (e) {
    sonarError();
    toast('error', 'No se pudo guardar en el celular: ' + e.message, 8000);
  } finally {
    guardando = false;
  }
}


/***********************
 * EDITAR DATOS (necesita señal)
 ***********************/

function abrirEditar() {
  const r = camaraSel();
  if (!r) return;

  const d = datosDe(r);
  S.ed = {};
  CAMPOS.forEach(function(c) { S.ed[c.k] = d[c.k] || ''; });
  S.ed.errores = {};
  S.edFoto = '';
  S.modo = 'editar';
  pintarDetalle();
  window.scrollTo(0, 0);
}

function htmlEditar(r) {
  const campos = CAMPOS.filter(function(c) { return !c.soloRegistro; });

  return '<div class="vista" style="padding:0">' +
    htmlCabDetalle('Editar ' + esc(r.id), 'Para guardar los cambios se necesita señal.', 'ficha') +
    htmlCampos(campos, S.ed, S.ed.errores, 'e_') +
    '<div class="secc"><span>Fotografía</span><span class="opc">opcional</span></div>' +
    '<div class="tarjeta"><button type="button" class="foto-btn" data-accion="fotoEditar">' + ico('photo_camera') +
      (S.edFoto ? 'Cambiar la foto nueva' : (vacio(r.fotografia) ? 'Tomar foto' : 'Reemplazar la foto actual')) + '</button>' +
      (S.edFoto ? '<img class="foto-prev" src="' + S.edFoto + '" alt="Foto nueva">' :
        '<p class="ayuda">' + (vacio(r.fotografia) ? 'Esta cámara no tiene fotografía.' : 'La foto actual está en la hoja (' + esc(r.fotografia) + ').') + '</p>') +
    '</div></div>';
}

async function guardarEdicion() {
  if (guardando) return;
  const r = camaraSel();
  if (!r) return;

  prepararSonido();

  const e = {};
  CAMPOS.forEach(function(c) {
    if (c.req && !c.soloRegistro && vacio(S.ed[c.k])) e[c.k] = 'Falta completar: ' + c.l.toLowerCase();
  });
  S.ed.errores = e;

  if (Object.keys(e).length) {
    pintarDetalle();
    avisarFalta(Object.keys(e).map(function(k) { return campoDe(k).l.toLowerCase(); }), function() {
      irAlCampo(document.querySelector('#detalle .mal'));
    });
    return;
  }

  guardando = true;
  pintarAccion();

  try {
    const datos = { id: r.id, fotografia: S.edFoto || '' };
    CAMPOS.forEach(function(c) { if (!c.soloRegistro) datos[c.k] = String(S.ed[c.k] || '').trim(); });

    const resp = await llamar('actualizar', { datos: datos }, 120000);
    await descargarInventario();

    S.modo = 'ficha';
    S.ed = null;
    sonarListo();
    toast('cloud_done', resp.mensaje || 'Cámara actualizada.');
    pintarBuscar();
    window.scrollTo(0, 0);
  } catch (err) {
    if (err.codigo === 'ACCESO') accesoRechazado();
    sonarError();
    toast(err.sinRed ? 'cloud_off' : 'error', err.sinRed
      ? 'Sin señal: para editar se necesita conexión. Los cambios siguen en pantalla; intenta de nuevo con señal.'
      : err.message, 8000);
  } finally {
    guardando = false;
    pintarAccion();
  }
}


/***********************
 * RESUMEN
 ***********************/

function pintarResumen() {
  const caja = $('vResumen');

  if (!registros) {
    caja.innerHTML = '<div class="vacio ancho"><b>Aún no hay inventario en este celular</b>Se descarga solo cuando hay señal.</div>';
    return;
  }

  const lista = registros.filter(function(r) { return !S.sedeResumen || igual(r.sede, S.sedeResumen); });
  const total = lista.length;

  function cuenta(f) { return lista.filter(f).length; }

  const danImagen = cuenta(function(r) { return /^operativa/i.test(String(r.estado).trim()); });
  const novedad = cuenta(function(r) { return igual(r.estado, 'Operativa con novedad') || igual(r.estado, 'Intermitente'); });
  const fuera = cuenta(function(r) { return igual(r.estado, 'Fuera de servicio'); });

  const conMtto = cuenta(function(r) { return !!ultimoMtto(r); });
  const completas = cuenta(function(r) { return avanceHV(datosDe(r)).pct === 100; });
  const pctHV = total ? Math.round(completas * 100 / total) : 0;
  const pct = total ? Math.round(conMtto * 100 / total) : 0;

  const ahora = new Date();
  const ids = {};
  lista.forEach(function(r) { ids[String(r.id).trim()] = true; });

  const delMes = historial.filter(function(h) {
    const f = new Date(h.orden || msDeFecha(h.fecha));
    return ids[String(h.idCamara).trim()] && f.getMonth() === ahora.getMonth() && f.getFullYear() === ahora.getFullYear();
  });

  // Tarjeta de cifra que lleva a Buscar con esas cámaras (crit null = todas)
  function cifra(clase, n, icono, texto, crit) {
    const ir = JSON.stringify({ crit: crit || {}, etiqueta: crit ? texto : '' });
    return '<button type="button" class="cifra toque ' + clase + '"' + (n ? ' data-ir="' + esc(ir) + '"' : ' disabled') + '>' +
      '<b>' + n + '</b><span>' + ico(icono, 's') + texto + '</span>' + (n ? '<i class="ms ir" aria-hidden="true">chevron_right</i>' : '') + '</button>';
  }

  // filas: [nombre, cantidad, criterio para Buscar (opcional), etiqueta del filtro]
  function barras(filas, ocultarCeros) {
    const max = Math.max.apply(null, filas.map(function(f) { return f[1]; }).concat([1]));
    return filas.filter(function(f) { return !ocultarCeros || f[1]; }).map(function(f) {
      const ir = f[2] && f[1] ? ' data-ir="' + esc(JSON.stringify({ crit: f[2], etiqueta: f[3] || f[0] })) + '"' : '';
      return '<' + (ir ? 'button type="button"' : 'div') + ' class="barra-fila' + (f[1] ? '' : ' cero') + (ir ? ' toque' : '') + '"' + ir + '>' +
        '<span>' + esc(f[0]) + '</span>' +
        '<span class="bar"><i style="width:' + Math.round(f[1] * 100 / max) + '%"></i></span><b>' + f[1] +
        (ir ? ico('chevron_right', 's') : '') + '</b></' + (ir ? 'button' : 'div') + '>';
    }).join('');
  }

  function contar(campo, base) {
    const filas = base.map(function(n) {
      const crit = {};
      crit[campo] = n;
      return [n, cuenta(function(r) { return igual(r[campo], n); }), crit];
    });
    const otros = total - filas.reduce(function(a, f) { return a + f[1]; }, 0);
    if (otros > 0) filas.push(['Otro o sin dato', otros]);
    return filas;
  }

  // Por nivel, con los pisos sin cámaras en cero
  const edificaciones = TODAS_LAS_EDIFICACIONES.filter(function(ed) {
    return !S.sedeResumen || ed.indexOf(S.sedeResumen) === 0;
  });

  const porNivel = edificaciones.map(function(ed) {
    const propias = lista.filter(function(r) { return r.edificacion === ed; });
    const conteo = {};
    nivelesDe(ed).forEach(function(n) { conteo[n] = 0; });
    propias.forEach(function(r) { const n = String(r.nivel || '').trim() || 'Sin piso'; conteo[n] = (conteo[n] || 0) + 1; });
    const filas = Object.keys(conteo).sort(function(a, b) { return ordenNivel(a) - ordenNivel(b) || a.localeCompare(b); })
      .map(function(n) { return [n, conteo[n], { edificacion: ed, nivel: n }, n + ' · ' + ed.replace(' - Clínica', '')]; });
    return '<div class="sub-grupo"><span>' + esc(ed) + '</span><span>' + propias.length + '</span></div>' + barras(filas, false);
  }).join('');

  const faltan = [
    ['Sin IP', cuenta(function(r) { return vacio(datosDe(r).ip); })],
    ['Sin NVR / DVR', cuenta(function(r) { return vacio(datosDe(r).nvr); })],
    ['Sin canal', cuenta(function(r) { return vacio(datosDe(r).canal); })],
    ['Sin serial', cuenta(function(r) { return vacio(datosDe(r).serial); })],
    ['Sin torre', cuenta(function(r) { return vacio(r.subzona); })],
    ['Estado físico sin revisar', cuenta(function(r) { return !cumple(CRITERIOS[5], datosDe(r)); })],
    ['Cableado sin revisar', cuenta(function(r) { return !cumple(CRITERIOS[6], datosDe(r)); })],
    ['Sin fotografía', cuenta(function(r) { return vacio(r.fotografia); })]
  ];

  const pendCam = pendientesCache.filter(function(p) { return !esMtto(p); }).length;
  const pendMt = pendientesCache.filter(esMtto).length;

  caja.innerHTML =
    '<div class="ancho tarjeta" style="padding:8px"><div class="seg" role="group" aria-label="Sede">' +
      ['', 'Barranquilla', 'Baranoa'].map(function(s) {
        return '<button type="button" aria-pressed="' + (S.sedeResumen === s) + '" data-sede-resumen="' + s + '">' + (s || 'Todas') + '</button>';
      }).join('') + '</div></div>' +

    '<div class="cifras ancho">' +
      cifra('', total, 'videocam', 'Cámaras', null) +
      cifra('ok', danImagen, 'check', 'Dan imagen', { estado: ['Operativa', 'Operativa con novedad'] }) +
      cifra('av', novedad, 'warning', 'Con novedad o intermitentes', { estado: ['Operativa con novedad', 'Intermitente'] }) +
      cifra('mal', fuera, 'error', 'Fuera de servicio', { estado: ['Fuera de servicio'] }) +
    '</div>' +

    '<p class="nota ancho">Inventario del ' + esc(fecha12(fechaCopia).replace(/\.$/, '')) +
      (pendCam || pendMt ? ' · no incluye ' + [pendCam ? pendCam + (pendCam === 1 ? ' cámara' : ' cámaras') : '', pendMt ? pendMt + (pendMt === 1 ? ' mantenimiento' : ' mantenimientos') : ''].filter(String).join(' ni ') + ' por subir' : '') + '.</p>' +

    '<div><div class="secc" style="margin-bottom:8px"><span>Hojas de vida</span></div>' +
    '<div class="grupo">' +
      '<div class="cifras-hv">' +
        '<button type="button" class="cifra toque ok" data-ir-filtro="completa"><b>' + completas + '<small> de ' + total + '</small></b><span>' + ico('verified', 's') + 'Hojas de vida completas</span><i class="ms ir" aria-hidden="true">chevron_right</i></button>' +
        '<button type="button" class="cifra toque" data-ir-filtro="conmtto"><b>' + conMtto + '<small> de ' + total + '</small></b><span>' + ico('build', 's') + 'Con revisión inicial</span><i class="ms ir" aria-hidden="true">chevron_right</i></button>' +
      '</div>' +
      '<div class="dato"><span>Sin ningún mantenimiento</span><span>' + (total - conMtto) + '</span></div>' +
      '<div class="dato"><span>Registros este mes</span><span>' + delMes.length + '</span></div>' +
      '<div class="dato"><span>Fallas este mes</span><span>' + delMes.filter(function(h) { return h.huboFalla; }).length + '</span></div>' +
    '</div></div>' +

    '<div><div class="secc" style="margin-bottom:8px"><span>Datos que faltan</span></div>' +
    '<div class="grupo">' + faltan.map(function(f) {
      return '<div class="dato"><span>' + f[0] + '</span><span>' + f[1] + '</span></div>';
    }).join('') + '</div></div>' +

    '<div><div class="secc" style="margin-bottom:8px"><span>Por estado</span></div>' +
    '<div class="grupo">' + barras(contar('estado', LISTA_ESTADOS), true) + '</div></div>' +

    '<div><div class="secc" style="margin-bottom:8px"><span>Por tipo de cámara</span></div>' +
    '<div class="grupo">' + barras(contar('tipoCamara', LISTA_TIPOS_CAMARA), true) + '</div></div>' +

    '<div class="ancho"><div class="secc" style="margin-bottom:8px"><span>Por piso</span></div>' +
    '<div class="grupo">' + porNivel + '</div></div>';
}


/***********************
 * BARRA DE ACCIÓN Y VISTAS
 ***********************/

function pintarAccion() {
  const d = $('accionDentro');
  let html = '';

  if (S.vista === 'vRegistrar') {
    html = (S.paso > 1 ? '<button type="button" class="btn sec" data-accion="atras">' + ico('arrow_back') + 'Atrás</button>' : '') +
      (S.paso < PASOS.length
        ? '<button type="button" class="btn prin" data-accion="siguiente">Siguiente: ' + PASOS[S.paso].toLowerCase() + ico('arrow_forward') + '</button>'
        : '<button type="button" class="btn prin" data-accion="guardarCamara">' + ico('check') + 'Guardar cámara</button>');
  } else if (S.vista === 'vBuscar' && camaraSel()) {
    if (S.modo === 'ficha') {
      html = '<button type="button" class="btn borde" data-accion="pdf">' + ico('picture_as_pdf') + 'PDF</button>' +
        '<button type="button" class="btn prin" data-accion="mtto">' + ico('build') +
        '<span class="largo">Registrar mantenimiento</span><span class="corto">Mantenimiento</span></button>';
    } else if (S.modo === 'mtto') {
      html = '<button type="button" class="btn sec" data-accion="verFicha">Cancelar</button>' +
        '<button type="button" class="btn prin" data-accion="guardarMtto">' + ico('check') + 'Guardar</button>';
    } else if (S.modo === 'completar') {
      html = '<button type="button" class="btn sec" data-accion="verFicha">Cancelar</button>' +
        '<button type="button" class="btn prin" data-accion="guardarCompletar">' + ico('check') + 'Guardar</button>';
    } else if (S.modo === 'editar') {
      html = '<button type="button" class="btn sec" data-accion="verFicha">Cancelar</button>' +
        '<button type="button" class="btn prin" data-accion="guardarEdicion"' + (guardando ? ' disabled' : '') + '>' +
        ico(guardando ? 'sync' : 'check') + (guardando ? 'Guardando…' : 'Guardar cambios') + '</button>';
    }
  } else if (S.vista === 'vResumen') {
    html = '<button type="button" class="btn tono" data-accion="actualizarResumen" style="flex:1">' + ico('sync') + 'Actualizar resumen</button>';
  }

  d.innerHTML = html;
  $('accion').classList.toggle('oculto', !html);
}

const TITULOS = { vRegistrar: 'Registrar cámara', vBuscar: 'Buscar cámara', vResumen: 'Resumen' };

function mostrarVista(id) {
  S.vista = id;

  ['vResumen', 'vBuscar', 'vRegistrar'].forEach(function(v) { $(v).classList.toggle('oculto', v !== id); });

  document.querySelectorAll('.nav button').forEach(function(b) {
    if (b.dataset.vista === id) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });

  $('titulo').textContent = TITULOS[id];
  pintarHora();
  document.title = TITULOS[id] + ' · Inventario CCTV';
  window.scrollTo(0, 0);

  pintarVista();

  if (id !== 'vRegistrar') descargarInventario().then(function(ok) { if (ok) pintarVista(); });
}

function pintarVista() {
  if (S.vista === 'vRegistrar') pintarRegistro();
  else if (S.vista === 'vBuscar') pintarBuscar();
  else pintarResumen();
  pintarAccion();
}


/***********************
 * EVENTOS
 ***********************/

function enlazarEventos() {

  document.querySelectorAll('.nav button').forEach(function(b) {
    b.addEventListener('click', function() { mostrarVista(b.dataset.vista); });
  });

  document.addEventListener('click', function(ev) {
    const b = ev.target.closest('button');
    if (!b) return;

    // Opciones de los formularios de cámara
    if (b.dataset.campo && b.dataset.valor !== undefined) {
      if (b.dataset.nuevoServ) {
        const propios = ls.get('servicios', []) || [];
        if (propios.indexOf(b.dataset.valor) === -1) { propios.push(b.dataset.valor); ls.set('servicios', propios); }
      }
      const editando = !!b.closest('#detalle');
      const v = editando ? (S.modo === 'completar' ? S.cp : S.ed) : S.reg;
      elegir(v, b.dataset.campo, b.dataset.valor);
      if (editando) { delete v.errores[b.dataset.campo]; pintarDetalle(); }
      else { delete S.errores[b.dataset.campo]; guardarBorrador(); pintarRegistro(); }
      return;
    }

    if (b.dataset.mt) { cambiarMtto(b.dataset.mt, b.dataset.valor); return; }
    if (b.dataset.paso) { irPaso(Number(b.dataset.paso)); return; }
    if (b.dataset.camara) { abrirCamara(b.dataset.camara); return; }
    if (b.dataset.sede !== undefined) { S.sede = b.dataset.sede; pintarBuscar(); return; }
    if (b.dataset.filtro !== undefined) { S.filtro = S.filtro === b.dataset.filtro ? '' : b.dataset.filtro; pintarBuscar(); return; }
    if (b.dataset.ir) {
      const ir = JSON.parse(b.dataset.ir);
      S.extra = Object.keys(ir.crit).length ? ir : null;
      S.sede = S.sedeResumen;
      S.texto = '';
      $('terminoBusqueda').value = '';
      S.filtro = '';
      S.sel = null;
      mostrarVista('vBuscar');
      return;
    }
    if (b.dataset.irFiltro) {
      S.extra = null;
      S.sede = S.sedeResumen;
      S.texto = '';
      $('terminoBusqueda').value = '';
      S.filtro = b.dataset.irFiltro;
      S.sel = null;
      mostrarVista('vBuscar');
      return;
    }
    if (b.dataset.quitarExtra) { S.extra = null; pintarBuscar(); return; }
    if (b.dataset.sedeResumen !== undefined) { S.sedeResumen = b.dataset.sedeResumen; pintarResumen(); return; }
    if (b.dataset.descartar) { descartarPendiente(b.dataset.descartar); return; }

    switch (b.dataset.accion) {
      case 'atras': irPaso(S.paso - 1); break;
      case 'siguiente': siguientePaso(); break;
      case 'guardarCamara': guardarCamara(); break;
      case 'cerrarCamara': cerrarCamara(); break;
      case 'verFicha': S.modo = 'ficha'; pintarDetalle(); window.scrollTo(0, 0); break;
      case 'mtto': abrirMtto(); break;
      case 'editar': abrirEditar(); break;
      case 'completar': abrirCompletar(); break;
      case 'editarCampo': abrirCompletar(b.dataset.k); break;
      case 'guardarCompletar': guardarCompletar(); break;
      case 'pdf': pdfHojaDeVida(); break;
      case 'guardarMtto': guardarMtto(); break;
      case 'guardarEdicion': guardarEdicion(); break;
      case 'actualizarResumen': actualizarResumen(); break;
      case 'fotoRegistro': pedirFoto(function(f) { S.regFoto = f; pintarRegistro(); }); break;
      case 'fotoMtto': pedirFoto(function(f) { if (S.mt) { S.mt.foto = f; pintarDetalle(); } }); break;
      case 'fotoEditar': pedirFoto(function(f) { S.edFoto = f; pintarDetalle(); }); break;
    }
  });

  // Textos: se guardan sin volver a pintar (para no perder el cursor)
  document.addEventListener('input', function(ev) {
    const t = ev.target;

    if (t.dataset.buscarServ) {
      const editando = !!t.closest('#detalle');
      const v = editando ? (S.modo === 'completar' ? S.cp : S.ed) : S.reg;
      const caja = t.parentNode.querySelector('[data-lista-serv]');
      if (caja) caja.innerHTML = htmlChipsServicio(campoDe(t.dataset.buscarServ), t.value, String(v[t.dataset.buscarServ] || ''));
      return;
    }

    if (t.dataset.campo) {
      const editando = !!t.closest('#detalle');
      const v = editando ? (S.modo === 'completar' ? S.cp : S.ed) : S.reg;
      v[t.dataset.campo] = t.value;

      if (!editando) {
        guardarBorrador();
        if (S.errores[t.dataset.campo] && t.value.trim()) {
          delete S.errores[t.dataset.campo];
          const campo = $('campo_r_' + t.dataset.campo);
          if (campo) { campo.classList.remove('mal'); const e = campo.querySelector('.error-campo'); if (e) e.remove(); }
        }
        actualizarProgreso();
      }
    }

    if (t.dataset.mtx && S.mt) {
      S.mt[t.dataset.mtx] = t.value;
      const span = document.querySelector('[data-listo="' + t.dataset.mtx + '"]');
      if (span) span.innerHTML = t.value.trim() ? chipListo() : '';
    }
  });

  $('archivoFoto').addEventListener('change', async function(ev) {
    const archivo = ev.target.files[0];
    if (!archivo || !destinoFoto) return;
    try {
      destinoFoto(await comprimirImagen(archivo));
    } catch (e) {
      toast('error', e.message);
    }
  });

  let reloj = null;
  $('terminoBusqueda').addEventListener('input', function(ev) {
    clearTimeout(reloj);
    reloj = setTimeout(function() { S.texto = ev.target.value; S.sel = window.innerWidth >= 1024 ? S.sel : null; pintarBuscar(); }, 200);
  });

  $('btnSubir').addEventListener('click', subirAhora);
  $('btnVerPendientes').addEventListener('click', function() { verPendientes = !verPendientes; pintarEstado(); });
  $('btnAcceso').addEventListener('click', validarAcceso);
  $('codigoAcceso').addEventListener('keydown', function(e) { if (e.key === 'Enter') validarAcceso(); });
  $('btnInstalar').addEventListener('click', instalarApp);

  // Atrás del celular: cierra la ficha antes de salir de Buscar
  window.addEventListener('popstate', function() {
    if (S.vista !== 'vBuscar' || !S.sel) return;
    if (S.modo !== 'ficha') {
      // Atrás desde el formulario vuelve a la ficha sin salir de ella
      S.modo = 'ficha';
      pintarDetalle();
      try { history.pushState({ ficha: 1 }, ''); } catch (e) { /* nada */ }
    } else {
      cerrarCamara(true);
    }
  });
}

function actualizarProgreso() {
  document.querySelectorAll('#formRegistro [data-listo-secc]').forEach(function(span) {
    const obligatorios = CAMPOS.filter(function(c) { return c.secc === span.dataset.listoSecc && c.req; });
    const completa = obligatorios.every(function(c) { return !vacio(S.reg[c.k]); });
    if (completa !== !!span.firstChild) span.innerHTML = completa ? chipListo() : '';
  });
}

async function actualizarResumen() {
  toast('sync', 'Actualizando…', 1500);
  const ok = await descargarInventario();
  pintarResumen();
  toast(ok ? 'cloud_done' : 'cloud_off', ok ? 'Resumen actualizado.' : 'Sin señal: se muestra la última copia descargada.');
}


/***********************
 * CÓDIGO DE ACCESO
 ***********************/

function pedirCodigo(mensaje) {
  $('pAcceso').classList.remove('oculto');
  $('errorAcceso').textContent = mensaje || '';
  $('codigoAcceso').value = '';
  setTimeout(function() { $('codigoAcceso').focus(); }, 100);
}

async function validarAcceso() {
  const codigo = $('codigoAcceso').value.trim();
  const aviso = $('errorAcceso');

  if (!codigo) { aviso.textContent = 'Escribe el código.'; return; }

  $('btnAcceso').disabled = true;
  aviso.textContent = 'Comprobando…';

  try {
    await llamar('validar', {}, 30000, codigo);
    localStorage.setItem(CLAVE_CODIGO, codigo);
    $('pAcceso').classList.add('oculto');
    iniciarDatos();
  } catch (e) {
    aviso.textContent = e.sinRed ? 'No hay señal. El código se comprueba una sola vez y necesita conexión.' : e.message;
  } finally {
    $('btnAcceso').disabled = false;
  }
}

function accesoRechazado() {
  try { localStorage.removeItem(CLAVE_CODIGO); } catch (e) { /* nada */ }
  pedirCodigo('El código cambió. Escribe el nuevo.');
}


/***********************
 * INSTALAR
 ***********************/

let avisoInstalacion = null;

window.addEventListener('beforeinstallprompt', function(e) {
  e.preventDefault();
  avisoInstalacion = e;
  $('btnInstalar').classList.remove('oculto');
});

window.addEventListener('appinstalled', function() {
  avisoInstalacion = null;
  $('btnInstalar').classList.add('oculto');
});

async function instalarApp() {
  if (!avisoInstalacion) return;
  avisoInstalacion.prompt();
  await avisoInstalacion.userChoice;
  avisoInstalacion = null;
  $('btnInstalar').classList.add('oculto');
}


/***********************
 * ARRANQUE
 ***********************/

function pintarHora() {
  const f = new Date();
  const dias = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  $('hora').textContent = hora12(f.getHours(), f.getMinutes());
  if (S.vista === 'vRegistrar') return;
  $('subtitulo').textContent = 'Clínica Reina Catalina · ' + dias[f.getDay()] + ' ' + f.getDate() + ' ' + meses[f.getMonth()];
}

function iniciarDatos() {
  sincronizar().then(function() { return descargarInventario(); }).then(function(ok) { if (ok) pintarVista(); });
}

async function iniciar() {
  enlazarEventos();
  pintarHora();
  setInterval(pintarHora, 30000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(function(reg) {
      // Al volver a la app, revisa si hay una versión nueva publicada
      document.addEventListener('visibilitychange', function() { if (!document.hidden) reg.update().catch(function() {}); });
    }).catch(function(e) { console.error('Sin modo sin señal', e); });

    // Cuando la versión nueva toma el control, se avisa para recargar con un toque
    let habiaControl = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function() {
      if (!habiaControl) { habiaControl = true; return; }   // primera instalación: nada que avisar
      toast('sync', 'Hay una versión nueva de la app', 600000, { texto: 'Actualizar', fn: function() { location.reload(); } });
    });
  }

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function() {});

  await cargarCopiaLocal();
  await pintarEstado();
  mostrarVista('vResumen');

  if (!urlConfigurada()) {
    toast('error', 'Falta configurar la app: pega la URL de Apps Script en config.js.', 10000);
    return;
  }

  if (!codigoAcceso()) { pedirCodigo(''); return; }

  iniciarDatos();
}

window.addEventListener('online', function() { pintarEstado(); sincronizar(); });
window.addEventListener('offline', pintarEstado);
document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'visible') sincronizar(); });

setInterval(function() {
  if (document.visibilityState !== 'visible' || sincronizando) return;
  listarPendientes().then(function(l) { if (l.length) sincronizar(); });
}, 60000);

iniciar();
