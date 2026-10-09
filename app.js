/*****************************************************************
 * INVENTARIO CCTV — PWA
 *
 * Cómo funciona:
 *   1. Al guardar, la cámara (con su foto) se escribe primero en el
 *      celular, en la lista de "pendientes".
 *   2. Si hay señal se sube enseguida a la hoja de cálculo y recibe
 *      su ID. Si no hay señal se queda pendiente.
 *   3. Cuando vuelve la señal, los pendientes se suben solos, en el
 *      mismo orden en que se registraron.
 *
 * Cada cámara lleva una marca única (uuid). Si una subida se corta y
 * se reintenta, el servidor la reconoce y no la guarda dos veces.
 *****************************************************************/

'use strict';


/***********************
 * EDIFICACIONES Y NIVELES
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

const LISTA_ESTADOS = [
  'Operativa',
  'Operativa con novedad',
  'Intermitente',
  'Fuera de servicio',
  'En mantenimiento'
];

const LISTA_TIPOS_CAMARA = ['Domo', 'Bullet', 'Turret', 'Otra'];

// Marcas que siempre se sugieren, con su escritura correcta
const MARCAS_BASE = ['Hikvision', 'HiLook', 'Dahua', 'Epcom', 'Q-See'];

// Niveles en el orden del formulario
function nivelesDe(edificacion) {

  const niveles = [];

  if (edificacion === 'Barranquilla - Clínica') {
    for (let i = 1; i <= 11; i++) niveles.push('Piso ' + i);
    niveles.push('Sótano', 'Azotea');
  }

  if (edificacion === 'Baranoa - Clínica') {
    for (let i = 1; i <= 7; i++) niveles.push('Piso ' + i);
    niveles.push('Sótano', 'Azotea');
  }

  if (edificacion === 'Baranoa - Edificio de Dependencias') {
    niveles.push('Planta 1', 'Planta 2', 'Planta 3');
  }

  return niveles;
}

// Orden para el resumen: Sótano, 1, 2, 3... y Azotea al final
function ordenNivel(nivel) {

  const texto = String(nivel || '').trim().toLowerCase();

  if (texto === 'sótano' || texto === 'sotano') return -1;
  if (texto === 'azotea') return 999;

  const numero = texto.match(/(\d+)/);

  return numero ? parseInt(numero[1], 10) : 1000;
}

function llenarSelect(select, opciones, conSeleccione) {

  select.innerHTML = '';

  if (conSeleccione) {
    agregarOpcion(select, 'Seleccione', '');
  }

  opciones.forEach(function(texto) {
    agregarOpcion(select, texto);
  });
}

function agregarOpcion(select, texto, valorOpcion) {

  const option = document.createElement('option');

  option.value = valorOpcion === undefined ? texto : valorOpcion;
  option.textContent = texto;

  select.appendChild(option);
}

function actualizarEdificaciones() {

  llenarSelect(
    document.getElementById('edificacion'),
    EDIFICACIONES_POR_SEDE[valor('sede')] || [],
    true
  );

  actualizarNiveles();
}

function actualizarNiveles() {

  llenarSelect(
    document.getElementById('nivel'),
    nivelesDe(valor('edificacion')),
    true
  );
}


/***********************
 * ALMACÉN DEL CELULAR (IndexedDB)
 *   pendientes  cámaras guardadas que aún no se han subido
 *   datos       copia del inventario para buscar sin señal
 ***********************/

let promesaBD = null;

function abrirBD() {

  if (!promesaBD) {

    promesaBD = new Promise(function(resolve, reject) {

      const peticion = indexedDB.open('inventario-cctv', 1);

      peticion.onupgradeneeded = function() {
        const bd = peticion.result;
        bd.createObjectStore('pendientes', { keyPath: 'uuid' });
        bd.createObjectStore('datos');
      };

      peticion.onsuccess = function() { resolve(peticion.result); };
      peticion.onerror = function() { reject(peticion.error); };
    });
  }

  return promesaBD;
}

function enAlmacen(almacen, modo, operacion) {

  return abrirBD().then(function(bd) {

    return new Promise(function(resolve, reject) {

      const transaccion = bd.transaction(almacen, modo);
      const peticion = operacion(transaccion.objectStore(almacen));

      transaccion.oncomplete = function() {
        resolve(peticion ? peticion.result : undefined);
      };

      transaccion.onerror = function() { reject(transaccion.error); };
      transaccion.onabort = function() { reject(transaccion.error); };
    });
  });
}

function listarPendientes() {

  return enAlmacen('pendientes', 'readonly', function(a) {
    return a.getAll();
  }).then(function(lista) {
    return (lista || []).sort(function(a, b) {
      return a.datos.fechaCaptura - b.datos.fechaCaptura;
    });
  });
}

function guardarPendiente(pendiente) {
  return enAlmacen('pendientes', 'readwrite', function(a) {
    return a.put(pendiente);
  });
}

function borrarPendiente(uuid) {
  return enAlmacen('pendientes', 'readwrite', function(a) {
    return a.delete(uuid);
  });
}

function leerDato(clave) {
  return enAlmacen('datos', 'readonly', function(a) {
    return a.get(clave);
  });
}

function guardarDato(clave, contenido) {
  return enAlmacen('datos', 'readwrite', function(a) {
    return a.put(contenido, clave);
  });
}


/***********************
 * COMUNICACIÓN CON APPS SCRIPT
 ***********************/

const CLAVE_CODIGO = 'cctv_codigo';

function codigoAcceso() {
  try {
    return localStorage.getItem(CLAVE_CODIGO) || '';
  } catch (e) {
    return '';
  }
}

function urlConfigurada() {
  return typeof URL_APPS_SCRIPT === 'string' &&
         /^https:\/\/.+\/exec$/.test(URL_APPS_SCRIPT.trim());
}

/**
 * Envía una acción al servidor. Si no hay red, el error lleva
 * sinRed = true para que quien llama sepa que puede reintentar luego.
 */
async function llamar(accion, extra, esperaMs, codigo) {

  if (!urlConfigurada()) {
    throw new Error(
      'Falta configurar la app: pega la URL de Apps Script en el archivo config.js.'
    );
  }

  const control = new AbortController();
  const reloj = setTimeout(function() { control.abort(); }, esperaMs || 60000);

  let respuesta;

  try {

    // Sin cabeceras: se envía como texto y Apps Script lo lee con
    // e.postData.contents. Así el navegador no hace consulta previa.
    respuesta = await fetch(URL_APPS_SCRIPT.trim(), {
      method: 'POST',
      body: JSON.stringify(Object.assign(
        { accion: accion, codigo: codigo === undefined ? codigoAcceso() : codigo },
        extra || {}
      )),
      redirect: 'follow',
      signal: control.signal
    });

  } catch (e) {

    const error = new Error('Sin conexión con el servidor.');
    error.sinRed = true;
    throw error;

  } finally {
    clearTimeout(reloj);
  }

  let json;

  try {
    json = await respuesta.json();
  } catch (e) {
    throw new Error(
      'El servidor no respondió como se esperaba. Revisa que la ' +
      'implementación de Apps Script esté publicada con acceso para ' +
      '"Cualquier usuario".'
    );
  }

  if (!json.ok) {
    const error = new Error(json.error || 'El servidor rechazó la solicitud.');
    error.codigo = json.codigo || '';
    throw error;
  }

  return json;
}


/***********************
 * CÓDIGO DE ACCESO
 ***********************/

function pedirCodigo(mensaje) {

  document.getElementById('acceso').classList.remove('hidden');
  document.getElementById('errorAcceso').textContent = mensaje || '';
  document.getElementById('codigoAcceso').value = '';
}

async function validarAcceso() {

  const codigo = valor('codigoAcceso');
  const aviso = document.getElementById('errorAcceso');

  if (!codigo) {
    aviso.textContent = 'Escribe el código.';
    return;
  }

  bloquearBoton('btnAcceso', true);
  aviso.textContent = '⏳ Comprobando...';

  try {

    await llamar('validar', {}, 30000, codigo);

    localStorage.setItem(CLAVE_CODIGO, codigo);

    document.getElementById('acceso').classList.add('hidden');

    iniciarDatos();

  } catch (e) {

    aviso.textContent = e.sinRed
      ? 'No hay señal. El código se comprueba una sola vez y necesita conexión.'
      : e.message;

  } finally {
    bloquearBoton('btnAcceso', false);
  }
}

function accesoRechazado() {

  try {
    localStorage.removeItem(CLAVE_CODIGO);
  } catch (e) { /* sin almacenamiento */ }

  pedirCodigo('El código cambió. Escribe el nuevo.');
}


/***********************
 * CAMBIAR VISTAS
 ***********************/

function mostrarVista(id) {

  ['registro', 'busqueda', 'resumen'].forEach(function(vista) {
    document.getElementById(vista)
      .classList.toggle('hidden', vista !== id);
  });

  ocultarMensaje();
}

function mostrarRegistro() {
  mostrarVista('registro');
}

function mostrarBusqueda() {
  mostrarVista('busqueda');
  cerrarEdicion();
  cargarRegistros();
}

function mostrarResumen() {
  mostrarVista('resumen');
  cargarResumen();
}


/***********************
 * FOTO
 ***********************/

function previsualizarFoto(event, idImagen) {

  const archivo = event.target.files[0];
  const img = document.getElementById(idImagen);

  if (!archivo) {
    img.classList.add('hidden');
    return;
  }

  const reader = new FileReader();

  reader.onload = function(e) {
    img.src = e.target.result;
    img.classList.remove('hidden');
  };

  reader.readAsDataURL(archivo);
}

function comprimirImagen(file) {

  return new Promise(function(resolve, reject) {

    const reader = new FileReader();

    reader.onload = function(e) {

      const img = new Image();

      img.onload = function() {

        const maxWidth = 1280;

        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = height * maxWidth / width;
          width = maxWidth;
        }

        const canvas = document.createElement('canvas');

        canvas.width = width;
        canvas.height = height;

        canvas.getContext('2d').drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };

      img.onerror = function() {
        reject(new Error('No se pudo leer la fotografía.'));
      };

      img.src = e.target.result;
    };

    reader.onerror = function() {
      reject(new Error('No se pudo leer la fotografía.'));
    };

    reader.readAsDataURL(file);
  });
}

async function fotoDe(idInput) {

  const archivo = document.getElementById(idInput).files[0];

  return archivo ? await comprimirImagen(archivo) : '';
}


/***********************
 * GUARDAR
 ***********************/

let guardando = false;

function nuevoUuid() {

  if (window.crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return Date.now().toString(36) + '-' +
         Math.random().toString(36).slice(2) +
         Math.random().toString(36).slice(2);
}

async function obtenerDatosFormulario() {

  return {
    uuid: nuevoUuid(),
    fechaCaptura: Date.now(),

    sede: valor('sede'),
    edificacion: valor('edificacion'),
    nivel: valor('nivel'),
    subzona: valor('subzona'),
    dependencia: valor('dependencia'),
    tipoUbicacion: valor('tipoUbicacion'),
    areaZona: valor('areaZona'),
    referencia: valor('referencia'),
    tipoCamara: valor('tipoCamara'),
    marca: valor('marca'),
    modelo: valor('modelo'),
    serial: valor('serial'),
    visionNocturna: valor('visionNocturna'),
    audio: valor('audio'),
    estado: valor('estado'),
    estadoFisico: valor('estadoFisico'),
    estadoCableado: valor('estadoCableado'),
    ultimoMantenimiento: valor('ultimoMantenimiento'),
    proximoMantenimiento: valor('proximoMantenimiento'),
    responsable: valor('responsable'),
    observaciones: valor('observaciones'),
    registradoPor: valor('registradoPor'),
    fotografia: await fotoDe('fotografia')
  };
}

async function guardar() {

  // Evita el doble toque
  if (guardando) {
    return;
  }

  // Se marca antes de cualquier espera: un segundo toque ya no entra
  guardando = true;
  bloquearBoton('btnGuardar', true);

  ocultarMensaje();

  let datos;

  try {

    if (!validarFormulario() ||
        !(await serialAceptado(valor('serial')))) {

      guardando = false;
      bloquearBoton('btnGuardar', false);

      return;
    }

    mostrarCargando('Guardando cámara...');

    datos = await obtenerDatosFormulario();

    // 1. Primero al celular: desde aquí la cámara ya no se pierde
    await guardarPendiente({ uuid: datos.uuid, datos: datos, intentos: 0 });

  } catch (error) {

    guardando = false;
    bloquearBoton('btnGuardar', false);

    mostrarMensaje(
      'No se pudo guardar en el celular: ' + error.message,
      'error'
    );

    return;
  }

  // El formulario queda libre para la siguiente cámara
  limpiarFormulario(true);

  guardando = false;
  bloquearBoton('btnGuardar', false);

  mostrarCargando('Guardada en el celular. Subiendo...');
  pintarEstado();

  // 2. Luego a la hoja de cálculo, si hay señal
  const resultado = await sincronizar();

  if (resultado.ids[datos.uuid]) {

    mostrarMensaje(
      'Cámara registrada correctamente. ID asignado: ' +
      resultado.ids[datos.uuid],
      'success'
    );

  } else if (resultado.errores[datos.uuid]) {

    mostrarMensaje(
      'La cámara quedó guardada en el celular, pero el servidor la ' +
      'rechazó: ' + resultado.errores[datos.uuid],
      'error'
    );

  } else {

    mostrarMensaje(
      '📥 Sin señal: la cámara quedó guardada en este celular y se ' +
      'subirá sola cuando vuelva la conexión.',
      'success'
    );
  }
}


/***********************
 * VALIDACIÓN
 ***********************/

function validarFormulario() {

  const obligatorios = [
    ['sede', 'Sede'],
    ['edificacion', 'Edificación'],
    ['nivel', 'Nivel'],
    ['tipoUbicacion', 'Tipo de ubicación'],
    ['areaZona', 'Área / Zona'],
    ['tipoCamara', 'Tipo de cámara'],
    ['estado', 'Estado'],
    ['registradoPor', 'Registrado por']
  ];

  for (let i = 0; i < obligatorios.length; i++) {

    const id = obligatorios[i][0];
    const nombre = obligatorios[i][1];

    if (!valor(id)) {
      mostrarMensaje('Debe completar: ' + nombre, 'error');
      document.getElementById(id).focus();
      return false;
    }
  }

  return true;
}

function limpiarSerial(serial) {
  return String(serial || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Si el serial ya existe (en el inventario descargado o en los
 * pendientes de este celular) pregunta antes de guardar.
 */
async function serialAceptado(serial) {

  const buscado = limpiarSerial(serial);

  if (!buscado) {
    return true;
  }

  let donde = '';

  (registrosCache || []).some(function(registro) {

    if (limpiarSerial(registro.serial) === buscado) {
      donde = registro.id + ' (' + registro.nivel + ', ' +
              registro.areaZona + ')';
      return true;
    }

    return false;
  });

  if (!donde) {

    const pendientes = await listarPendientes();

    pendientes.some(function(p) {

      if (limpiarSerial(p.datos.serial) === buscado) {
        donde = 'una cámara pendiente por subir (' + p.datos.nivel +
                ', ' + p.datos.areaZona + ')';
        return true;
      }

      return false;
    });
  }

  if (!donde) {
    return true;
  }

  return window.confirm(
    'El serial ' + serial + ' ya está registrado en ' + donde +
    '.\n\n¿Guardar esta cámara de todas formas?'
  );
}


/***********************
 * SUBIR PENDIENTES
 ***********************/

let sincronizando = false;
let verPendientes = false;

// Resultado de las subidas hechas desde que se abrió la app
const idsSubidos = {};      // uuid -> ID asignado
const erroresSubida = {};   // uuid -> motivo del rechazo

let turnoSubida = Promise.resolve();

/**
 * Sube los pendientes. Si ya hay una subida en curso, espera a que
 * termine y vuelve a revisar (nunca corren dos a la vez).
 * Devuelve { ids, errores, subidas, sinRed }.
 */
function sincronizar() {

  turnoSubida = turnoSubida.then(subirPendientes, subirPendientes);

  return turnoSubida;
}

/**
 * Sube los pendientes uno por uno, del más antiguo al más nuevo.
 */
async function subirPendientes() {

  const resultado = {
    ids: idsSubidos,
    errores: erroresSubida,
    subidas: 0,
    sinRed: false
  };

  if (!codigoAcceso()) {
    return resultado;
  }

  sincronizando = true;
  pintarEstado();

  const intentados = {};
  let subidas = 0;

  try {

    while (true) {

      // Se vuelve a leer la lista por si se guardó otra cámara mientras tanto
      const lista = await listarPendientes();

      const pendiente = lista.filter(function(p) {
        return !intentados[p.uuid];
      })[0];

      if (!pendiente) {
        break;
      }

      intentados[pendiente.uuid] = true;

      try {

        const respuesta =
          await llamar('registrar', { datos: pendiente.datos }, 120000);

        await borrarPendiente(pendiente.uuid);

        idsSubidos[pendiente.uuid] = respuesta.id;
        delete erroresSubida[pendiente.uuid];

        resultado.ultimoId = respuesta.id;
        subidas++;

      } catch (e) {

        if (e.sinRed) {
          resultado.sinRed = true;
          break;
        }

        if (e.codigo === 'ACCESO') {
          accesoRechazado();
          break;
        }

        // El servidor la rechazó: se conserva y se sigue con las demás
        pendiente.error = e.message;
        pendiente.intentos = (pendiente.intentos || 0) + 1;

        await guardarPendiente(pendiente);

        erroresSubida[pendiente.uuid] = e.message;
      }
    }

  } catch (e) {

    console.error('Error al subir pendientes', e);

  } finally {
    sincronizando = false;
  }

  resultado.subidas = subidas;

  if (subidas > 0) {
    await descargarInventario();
  }

  await pintarEstado();

  return resultado;
}

async function subirAhora() {

  ocultarMensaje();

  const resultado = await sincronizar();
  const subidas = resultado.subidas;
  const quedan = (await listarPendientes()).length;

  if (resultado.sinRed) {

    mostrarMensaje(
      'Todavía no hay señal. Las cámaras siguen guardadas en este celular.',
      'error'
    );

  } else if (subidas > 0) {

    mostrarMensaje(
      subidas === 1
        ? 'Se subió 1 cámara. ID asignado: ' + resultado.ultimoId
        : 'Se subieron ' + subidas + ' cámaras.',
      'success'
    );

  } else if (quedan > 0) {

    mostrarMensaje(
      'El servidor rechazó los pendientes. Toca "Ver" para revisar el motivo.',
      'error'
    );
  }
}

function alternarPendientes() {
  verPendientes = !verPendientes;
  pintarEstado();
}

async function descartarPendiente(uuid) {

  const seguro = window.confirm(
    '¿Descartar esta cámara pendiente? Se borrará de este celular y ' +
    'no se subirá.'
  );

  if (!seguro) {
    return;
  }

  await borrarPendiente(uuid);
  pintarEstado();
}

/**
 * Barra de estado: señal y cámaras pendientes.
 */
async function pintarEstado() {

  let pendientes = [];

  try {
    pendientes = await listarPendientes();
  } catch (e) {
    console.error(e);
  }

  const barra = document.getElementById('barraEstado');
  const texto = document.getElementById('estadoTexto');
  const tarjeta = document.getElementById('tarjetaPendientes');

  const cuantas = pendientes.length;
  const sinSenal = navigator.onLine === false;

  if (cuantas === 0 && !sinSenal) {
    barra.style.display = 'none';
    tarjeta.classList.add('hidden');
    verPendientes = false;
    return;
  }

  barra.style.display = 'flex';

  const frase = cuantas === 1
    ? '1 cámara pendiente por subir'
    : cuantas + ' cámaras pendientes por subir';

  if (sincronizando) {
    texto.textContent = '⏳ Subiendo... ' + frase;
  } else if (cuantas === 0) {
    texto.textContent =
      '📴 Sin señal: lo que registres se guarda en este celular.';
  } else if (sinSenal) {
    texto.textContent = '📴 Sin señal · ' + frase;
  } else {
    texto.textContent = '📤 ' + frase;
  }

  document.getElementById('btnSubir')
    .classList.toggle('hidden', cuantas === 0);
  document.getElementById('btnVerPendientes')
    .classList.toggle('hidden', cuantas === 0);

  bloquearBoton('btnSubir', sincronizando);

  document.getElementById('btnVerPendientes').textContent =
    verPendientes ? 'Ocultar' : 'Ver';

  // Lista de pendientes
  tarjeta.classList.toggle('hidden', !verPendientes || cuantas === 0);

  const lista = document.getElementById('listaPendientes');

  lista.innerHTML = '';

  pendientes.forEach(function(p) {

    const div = document.createElement('div');
    div.className = 'pendiente';

    agregarLinea(div, p.datos.nivel + ' — ' + p.datos.areaZona, true);
    agregarLinea(div, p.datos.sede + ' — ' + p.datos.edificacion);
    agregarLinea(
      div,
      'Registrada el ' + formatoFecha(p.datos.fechaCaptura) +
      ' por ' + p.datos.registradoPor
    );

    if (p.error) {
      const fallo = document.createElement('span');
      fallo.className = 'fallo';
      fallo.textContent = 'El servidor la rechazó: ' + p.error;
      div.appendChild(fallo);
      div.appendChild(document.createElement('br'));
    }

    const boton = document.createElement('button');
    boton.textContent = 'Descartar';
    boton.onclick = function() { descartarPendiente(p.uuid); };

    div.appendChild(boton);
    lista.appendChild(div);
  });
}

function formatoFecha(milisegundos) {

  const f = new Date(milisegundos);

  function dos(n) { return String(n).padStart(2, '0'); }

  return dos(f.getDate()) + '/' + dos(f.getMonth() + 1) + '/' +
         f.getFullYear() + ' ' + dos(f.getHours()) + ':' +
         dos(f.getMinutes());
}


/***********************
 * INVENTARIO (copia en el celular)
 ***********************/

let registrosCache = null;
let fechaCache = '';
let temporizadorBusqueda = null;
let descargando = null;

const MAX_RESULTADOS = 150;

async function cargarCopiaLocal() {

  try {

    const copia = await leerDato('inventario');

    if (copia) {
      registrosCache = copia.registros || [];
      fechaCache = copia.fecha || '';
    }

  } catch (e) {
    console.error(e);
  }

  actualizarMarcas();
}

/**
 * Trae el inventario del servidor y lo guarda en el celular.
 * Devuelve true si se pudo. Nunca lanza error.
 */
function descargarInventario() {

  if (descargando) {
    return descargando;
  }

  descargando = (async function() {

    try {

      const respuesta = await llamar('inventario', {}, 60000);

      registrosCache = respuesta.registros || [];
      fechaCache = respuesta.fecha || '';

      await guardarDato('inventario', {
        registros: registrosCache,
        fecha: fechaCache
      });

      actualizarMarcas();

      return true;

    } catch (e) {

      if (e.codigo === 'ACCESO') {
        accesoRechazado();
      }

      return false;

    } finally {
      descargando = null;
    }
  })();

  return descargando;
}

function pintarFechaInventario(actualizando) {

  const elemento = document.getElementById('fechaInventario');

  if (!registrosCache) {
    elemento.textContent = actualizando
      ? '⏳ Descargando inventario...'
      : 'Aún no se ha descargado el inventario en este celular. ' +
        'Se descargará cuando haya señal.';
    return;
  }

  elemento.textContent =
    'Inventario del ' + fechaCache +
    (actualizando ? ' · ⏳ actualizando...' : '');
}

// Cuántas letras hay que cambiar para pasar de un texto al otro
function distancia(a, b) {

  let fila = [];

  for (let j = 0; j <= b.length; j++) fila[j] = j;

  for (let i = 1; i <= a.length; i++) {

    const nueva = [i];

    for (let j = 1; j <= b.length; j++) {
      nueva[j] = Math.min(
        fila[j] + 1,
        nueva[j - 1] + 1,
        fila[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }

    fila = nueva;
  }

  return fila[b.length];
}

/**
 * Sugerencias de marca: las de base más las que ya se usan en el
 * inventario. No se sugieren las que parecen un error de digitación
 * de otra marca (por ejemplo "HiLoook").
 */
function actualizarMarcas() {

  function clave(texto) {
    return String(texto || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  const vistas = {};
  const marcas = [];

  MARCAS_BASE.forEach(function(marca) {
    vistas[clave(marca)] = true;
    marcas.push(marca);
  });

  const conteo = {};

  (registrosCache || []).forEach(function(registro) {

    const marca = String(registro.marca || '').trim();
    const k = clave(marca);

    if (!k || vistas[k]) return;

    if (!conteo[k]) conteo[k] = { nombre: marca, veces: 0 };
    conteo[k].veces++;
  });

  // Las más usadas primero; se descartan las que aparecen menos de
  // 3 veces o se parecen demasiado a una marca ya aceptada
  Object.keys(conteo)
    .sort(function(a, b) { return conteo[b].veces - conteo[a].veces; })
    .forEach(function(k) {

      if (conteo[k].veces < 3) return;

      const parecida = Object.keys(vistas).some(function(otra) {
        return distancia(k, otra) <= 2;
      });

      if (parecida) return;

      vistas[k] = true;
      marcas.push(conteo[k].nombre);
    });

  const lista = document.getElementById('listaMarcas');

  lista.innerHTML = '';

  marcas.forEach(function(marca) {
    const option = document.createElement('option');
    option.value = marca;
    lista.appendChild(option);
  });
}


/***********************
 * BUSCAR
 * Se busca en la copia del celular, así que funciona sin señal.
 ***********************/

async function cargarRegistros() {

  filtrarResultados();
  pintarFechaInventario(true);

  await descargarInventario();

  pintarFechaInventario(false);
  filtrarResultados();
}

function buscar() {

  clearTimeout(temporizadorBusqueda);

  temporizadorBusqueda = setTimeout(filtrarResultados, 250);
}

function filtrarResultados() {

  const texto = valor('terminoBusqueda').toLowerCase();

  let resultados = registrosCache || [];

  if (texto) {

    resultados = resultados.filter(function(registro) {

      return Object.keys(registro).some(function(campo) {

        return String(registro[campo] || '')
          .toLowerCase()
          .includes(texto);
      });
    });
  }

  mostrarResultados(resultados);
}

function mostrarResultados(resultados) {

  const contenedor = document.getElementById('resultados');
  const contador = document.getElementById('contadorResultados');

  contenedor.innerHTML = '';

  if (!registrosCache) {
    contador.textContent = '';
    return;
  }

  if (!resultados.length) {
    contador.textContent = 'No se encontraron registros.';
    return;
  }

  contador.textContent =
    resultados.length === 1
      ? '1 cámara. Toca la tarjeta para editarla.'
      : resultados.length + ' cámaras. Toca una para editarla.';

  if (resultados.length > MAX_RESULTADOS) {
    contador.textContent +=
      ' Se muestran las primeras ' + MAX_RESULTADOS +
      '; escribe algo para reducir la lista.';
  }

  resultados.slice(0, MAX_RESULTADOS).forEach(function(registro) {

    const div = document.createElement('div');

    div.className = 'result';

    agregarLinea(div, registro.id, true);
    agregarLinea(div, registro.sede + ' — ' + registro.edificacion);
    agregarLinea(div, registro.nivel + ' — ' + registro.areaZona);
    agregarLinea(div, 'Estado: ' + registro.estado);

    div.onclick = function() {
      cargarEdicion(registro);
    };

    contenedor.appendChild(div);
  });
}

function agregarLinea(contenedor, texto, negrita) {

  const linea = document.createElement(negrita ? 'strong' : 'span');

  linea.textContent = texto;

  contenedor.appendChild(linea);
  contenedor.appendChild(document.createElement('br'));
}


/***********************
 * EDICIÓN (necesita señal)
 ***********************/

function cargarEdicion(registro) {

  ocultarMensaje();

  // Mientras se edita se oculta la lista para no tener que bajar
  document.getElementById('tarjetaBusqueda').classList.add('hidden');
  document.getElementById('editar').classList.remove('hidden');

  document.getElementById('tituloEdicion').textContent =
    'Editar cámara ' + registro.id;

  document.getElementById('editId').value = registro.id;

  setSelect('editSede', registro.sede);

  actualizarEdificacionesEdicion(
    registro.sede,
    registro.edificacion,
    registro.nivel
  );

  setSelect('editSubzona', registro.subzona);
  setValue('editDependencia', registro.dependencia);
  setSelect('editTipoUbicacion', registro.tipoUbicacion);
  setValue('editAreaZona', registro.areaZona);
  setValue('editReferencia', registro.referencia);
  setSelect('editTipoCamara', registro.tipoCamara);
  setValue('editMarca', registro.marca);
  setValue('editModelo', registro.modelo);
  setValue('editSerial', registro.serial);
  setSelect('editVisionNocturna', registro.visionNocturna);
  setSelect('editAudio', registro.audio);
  setSelect('editEstado', registro.estado);
  setSelect('editEstadoFisico', registro.estadoFisico);
  setSelect('editEstadoCableado', registro.estadoCableado);
  setValue('editUltimoMantenimiento', registro.ultimoMantenimiento);
  setValue('editProximoMantenimiento', registro.proximoMantenimiento);
  setValue('editResponsable', registro.responsable);
  setValue('editObservaciones', registro.observaciones);

  // Fotografía
  document.getElementById('editFotografia').value = '';
  document.getElementById('editPreview').classList.add('hidden');

  const enlace = document.getElementById('editFotoActual');
  const tieneFoto = /^https:\/\//.test(registro.fotografia || '');

  if (tieneFoto) {
    enlace.href = registro.fotografia;
  } else {
    enlace.removeAttribute('href');
  }

  enlace.classList.toggle('hidden', !tieneFoto);
  document.getElementById('editSinFoto')
    .classList.toggle('hidden', tieneFoto);

  document.getElementById('editRegistro').textContent =
    'Registrada por ' + (registro.registradoPor || 'sin dato') +
    (registro.fechaRegistro ? ' el ' + registro.fechaRegistro : '') +
    '. Para guardar cambios se necesita señal.';

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function actualizarEdificacionesEdicion(sede, edificacion, nivel) {

  llenarSelect(
    document.getElementById('editEdificacion'),
    EDIFICACIONES_POR_SEDE[sede] || [],
    false
  );

  if (edificacion !== undefined) {
    setSelect('editEdificacion', edificacion);
  }

  actualizarNivelesEdicion(valor('editEdificacion'), nivel);
}

function actualizarNivelesEdicion(edificacion, nivel) {

  llenarSelect(
    document.getElementById('editNivel'),
    nivelesDe(edificacion),
    false
  );

  if (nivel !== undefined) {
    setSelect('editNivel', nivel);
  }
}

function cambioSedeEdicion() {
  actualizarEdificacionesEdicion(valor('editSede'));
}

function cambioEdificacionEdicion() {
  actualizarNivelesEdicion(valor('editEdificacion'));
}

async function actualizar() {

  if (guardando) {
    return;
  }

  ocultarMensaje();

  if (!valor('editEdificacion') || !valor('editNivel')) {
    mostrarMensaje('Debe completar: Edificación y Nivel', 'error');
    return;
  }

  guardando = true;
  bloquearBoton('btnActualizar', true);
  mostrarCargando('Actualizando cámara...');

  try {

    const datos = {
      id: valor('editId'),
      sede: valor('editSede'),
      edificacion: valor('editEdificacion'),
      nivel: valor('editNivel'),
      subzona: valor('editSubzona'),
      dependencia: valor('editDependencia'),
      tipoUbicacion: valor('editTipoUbicacion'),
      areaZona: valor('editAreaZona'),
      referencia: valor('editReferencia'),
      tipoCamara: valor('editTipoCamara'),
      marca: valor('editMarca'),
      modelo: valor('editModelo'),
      serial: valor('editSerial'),
      visionNocturna: valor('editVisionNocturna'),
      audio: valor('editAudio'),
      estado: valor('editEstado'),
      estadoFisico: valor('editEstadoFisico'),
      estadoCableado: valor('editEstadoCableado'),
      ultimoMantenimiento: valor('editUltimoMantenimiento'),
      proximoMantenimiento: valor('editProximoMantenimiento'),
      responsable: valor('editResponsable'),
      observaciones: valor('editObservaciones'),

      // "Registrado por" no se envía: el servidor conserva el original.
      // La foto solo se envía si se tomó una nueva.
      fotografia: await fotoDe('editFotografia')
    };

    const respuesta = await llamar('actualizar', { datos: datos }, 120000);

    await descargarInventario();

    cerrarEdicion();
    pintarFechaInventario(false);
    filtrarResultados();

    mostrarMensaje(respuesta.mensaje, 'success');

  } catch (error) {

    if (error.codigo === 'ACCESO') {
      accesoRechazado();
    }

    mostrarMensaje(
      error.sinRed
        ? 'Sin señal: para editar una cámara se necesita conexión. ' +
          'Los cambios siguen en pantalla; intenta de nuevo cuando haya señal.'
        : error.message,
      'error'
    );

  } finally {

    guardando = false;
    bloquearBoton('btnActualizar', false);
  }
}

function cerrarEdicion() {

  document.getElementById('editar').classList.add('hidden');
  document.getElementById('tarjetaBusqueda').classList.remove('hidden');
}


/***********************
 * RESUMEN
 * Se calcula en el celular con la copia del inventario.
 ***********************/

function igual(a, b) {
  return String(a || '').trim().toLowerCase() ===
         String(b || '').trim().toLowerCase();
}

function contarPorLista(registros, campo, lista) {

  return lista.map(function(nombre) {

    const cantidad = registros.filter(function(registro) {
      return igual(registro[campo], nombre);
    }).length;

    return [nombre, cantidad];
  });
}

/**
 * Cámaras por nivel para las tres edificaciones. Incluye en cero los
 * niveles que aún no tienen cámaras, para ver qué falta por inventariar.
 */
function contarPorNivel(registros) {

  const nombres = TODAS_LAS_EDIFICACIONES.slice();

  // Por si en la hoja hay una edificación que no está en la lista
  registros.forEach(function(registro) {
    const nombre = String(registro.edificacion || '').trim() || 'Sin edificación';
    if (nombres.indexOf(nombre) === -1) nombres.push(nombre);
  });

  return nombres.map(function(edificacion) {

    const propias = registros.filter(function(registro) {
      return (String(registro.edificacion || '').trim() || 'Sin edificación') ===
             edificacion;
    });

    const conteo = {};

    nivelesDe(edificacion).forEach(function(nivel) {
      conteo[nivel] = 0;
    });

    propias.forEach(function(registro) {
      const nivel = String(registro.nivel || '').trim() || 'Sin nivel';
      conteo[nivel] = (conteo[nivel] || 0) + 1;
    });

    const niveles = Object.keys(conteo)
      .sort(function(a, b) {
        return ordenNivel(a) - ordenNivel(b) || a.localeCompare(b);
      })
      .map(function(nivel) {
        return [nivel, conteo[nivel]];
      });

    return {
      edificacion: edificacion,
      total: propias.length,
      niveles: niveles
    };
  });
}

function cargarResumen() {

  pintarResumen(false);

  descargarInventario().then(function(seDescargo) {
    if (seDescargo) pintarResumen(false);
  });
}

async function actualizarResumen() {

  pintarResumen(true);

  const seDescargo = await descargarInventario();

  pintarResumen(false);

  if (!seDescargo) {
    mostrarMensaje(
      'Sin señal: se muestra la última copia descargada.',
      'error'
    );
  }
}

async function pintarResumen(actualizando) {

  const registros = registrosCache || [];

  const estados = contarPorLista(registros, 'estado', LISTA_ESTADOS);

  function cantidad(nombre) {
    return estados.filter(function(par) { return par[0] === nombre; })[0][1];
  }

  document.getElementById('resTotal').textContent = registros.length;
  document.getElementById('resOperativas').textContent = cantidad('Operativa');
  document.getElementById('resNovedad').textContent = cantidad('Operativa con novedad');
  document.getElementById('resFuera').textContent = cantidad('Fuera de servicio');

  let nota;

  if (!registrosCache) {
    nota = 'Aún no se ha descargado el inventario en este celular.';
  } else {
    nota = 'Inventario del ' + fechaCache;
  }

  if (actualizando) {
    nota += ' · ⏳ actualizando...';
  }

  const pendientes = (await listarPendientes()).length;

  if (pendientes > 0) {
    nota += ' · No incluye ' + pendientes +
            (pendientes === 1 ? ' cámara pendiente' : ' cámaras pendientes') +
            ' por subir.';
  }

  document.getElementById('resActualizado').textContent = nota;

  // Por nivel, agrupado por edificación
  const niveles = document.getElementById('resNiveles');

  niveles.innerHTML = '';

  contarPorNivel(registros).forEach(function(grupo) {

    const titulo = document.createElement('div');
    titulo.className = 'grupo-titulo';

    const nombre = document.createElement('span');
    nombre.textContent = grupo.edificacion;

    const total = document.createElement('span');
    total.textContent =
      grupo.total === 1 ? '1 cámara' : grupo.total + ' cámaras';

    titulo.appendChild(nombre);
    titulo.appendChild(total);
    niveles.appendChild(titulo);

    pintarConteos(niveles, grupo.niveles, false);
  });

  // Por estado y por tipo (solo los que tienen cámaras)
  const cajaEstados = document.getElementById('resEstados');
  cajaEstados.innerHTML = '';
  pintarConteos(cajaEstados, estados, true);

  const cajaTipos = document.getElementById('resTipos');
  cajaTipos.innerHTML = '';
  pintarConteos(
    cajaTipos,
    contarPorLista(registros, 'tipoCamara', LISTA_TIPOS_CAMARA),
    true
  );
}

function pintarConteos(contenedor, filas, ocultarCeros) {

  let maximo = 0;

  filas.forEach(function(par) {
    if (par[1] > maximo) maximo = par[1];
  });

  filas.forEach(function(par) {

    if (ocultarCeros && !par[1]) return;

    const fila = document.createElement('div');
    fila.className = 'conteo' + (par[1] ? '' : ' vacio');

    const nombre = document.createElement('span');
    nombre.textContent = par[0];

    const barra = document.createElement('div');
    barra.className = 'barra';

    const relleno = document.createElement('span');
    relleno.style.width =
      (maximo ? Math.round(par[1] * 100 / maximo) : 0) + '%';

    barra.appendChild(relleno);

    const numero = document.createElement('span');
    numero.className = 'cantidad';
    numero.textContent = par[1];

    fila.appendChild(nombre);
    fila.appendChild(barra);
    fila.appendChild(numero);

    contenedor.appendChild(fila);
  });
}


/***********************
 * LIMPIAR
 * Después de guardar se conservan sede, edificación, nivel y quien
 * registra, para seguir con la siguiente cámara del mismo piso.
 * El botón "Limpiar" borra todo.
 ***********************/

function limpiarFormulario(conservar) {

  const guardados = {
    sede: valor('sede'),
    edificacion: valor('edificacion'),
    nivel: valor('nivel'),
    registradoPor: valor('registradoPor')
  };

  document
    .querySelectorAll('#registro input, #registro select, #registro textarea')
    .forEach(function(campo) {
      campo.value = '';
    });

  document.getElementById('preview').classList.add('hidden');

  actualizarEdificaciones();

  if (conservar === true) {

    setValue('sede', guardados.sede);
    actualizarEdificaciones();

    setValue('edificacion', guardados.edificacion);
    actualizarNiveles();

    setValue('nivel', guardados.nivel);
    setValue('registradoPor', guardados.registradoPor);
  }
}


/***********************
 * UTILIDADES
 ***********************/

function valor(id) {

  const elemento = document.getElementById(id);

  if (!elemento) {
    return '';
  }

  return elemento.value.trim();
}

function setValue(id, value) {

  const elemento = document.getElementById(id);

  if (elemento) {
    elemento.value = value || '';
  }
}

/**
 * Pone un valor en una lista desplegable. Si el valor guardado en la
 * hoja no está en la lista (o está vacío), lo agrega como opción para
 * que al guardar no se pierda.
 */
function setSelect(id, value) {

  const select = document.getElementById(id);

  if (!select) {
    return;
  }

  const texto = value === null || value === undefined ? '' : String(value);

  // Quitar opciones agregadas en una edición anterior
  Array.prototype.slice.call(select.options).forEach(function(option) {
    if (option.dataset.temporal) {
      select.removeChild(option);
    }
  });

  const existe = Array.prototype.some.call(select.options, function(option) {
    return option.value === texto;
  });

  if (!existe) {

    const option = document.createElement('option');

    option.value = texto;
    option.textContent = texto === '' ? '(sin dato)' : texto;
    option.dataset.temporal = '1';

    select.insertBefore(option, select.firstChild);
  }

  select.value = texto;
}

function bloquearBoton(id, bloquear) {

  const boton = document.getElementById(id);

  if (boton) {
    boton.disabled = bloquear;
  }
}

function mostrarMensaje(texto, tipo) {

  const elemento = document.getElementById('mensaje');

  elemento.textContent = texto;
  elemento.className = 'message ' + tipo;
  elemento.style.display = 'block';

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function ocultarMensaje() {
  document.getElementById('mensaje').style.display = 'none';
}

function mostrarCargando(texto) {

  const elemento = document.getElementById('mensaje');

  elemento.textContent = '⏳ ' + texto;
  elemento.className = 'message success';
  elemento.style.display = 'block';

  window.scrollTo({ top: 0, behavior: 'smooth' });
}


/***********************
 * INSTALAR LA APP
 ***********************/

let avisoInstalacion = null;

window.addEventListener('beforeinstallprompt', function(evento) {

  evento.preventDefault();

  avisoInstalacion = evento;

  document.getElementById('btnInstalar').classList.remove('hidden');
});

window.addEventListener('appinstalled', function() {

  avisoInstalacion = null;

  document.getElementById('btnInstalar').classList.add('hidden');
});

async function instalarApp() {

  if (!avisoInstalacion) {
    return;
  }

  avisoInstalacion.prompt();

  await avisoInstalacion.userChoice;

  avisoInstalacion = null;

  document.getElementById('btnInstalar').classList.add('hidden');
}


/***********************
 * ARRANQUE
 ***********************/

// Con el código ya validado: subir pendientes y refrescar el inventario
function iniciarDatos() {

  sincronizar().then(function() {
    return descargarInventario();
  });
}

async function iniciar() {

  // Enter en la pantalla del código
  document.getElementById('codigoAcceso')
    .addEventListener('keydown', function(evento) {
      if (evento.key === 'Enter') validarAcceso();
    });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function(e) {
      console.error('No se pudo activar el modo sin señal', e);
    });
  }

  // Pide al navegador no borrar los pendientes si falta espacio
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(function() {});
  }

  await cargarCopiaLocal();
  await pintarEstado();

  if (!urlConfigurada()) {
    mostrarMensaje(
      'Falta configurar la app: pega la URL de Apps Script en el archivo config.js.',
      'error'
    );
    return;
  }

  if (!codigoAcceso()) {
    pedirCodigo('');
    return;
  }

  iniciarDatos();
}

// Cuando vuelve la señal o se regresa a la app, se intenta subir
window.addEventListener('online', function() {
  pintarEstado();
  sincronizar();
});

window.addEventListener('offline', pintarEstado);

document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') sincronizar();
});

// Reintento cada minuto mientras haya pendientes y la app esté abierta
setInterval(function() {

  if (document.visibilityState !== 'visible' || sincronizando) return;

  listarPendientes().then(function(lista) {
    if (lista.length > 0) sincronizar();
  });

}, 60000);

iniciar();
