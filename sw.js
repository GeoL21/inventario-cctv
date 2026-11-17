/*****************************************************************
 * SERVICE WORKER — hace que la app abra sin señal.
 *
 * Guarda una copia de los archivos de la app en el celular.
 * Con señal trae la versión más reciente; sin señal (o si la red
 * tarda más de 3 segundos) usa la copia guardada.
 *
 * Si cambias algún archivo de la app, sube también el número de
 * VERSION para que los celulares renueven la copia.
 *****************************************************************/

const VERSION = 'cctv-v4';
const FUENTES = 'cctv-fuentes-v1';

const ARCHIVOS = [
  './',
  'index.html',
  'app.js',
  'config.js',
  'manifest.webmanifest',
  'logo-crc.jpg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'lib/jspdf.umd.min.js',
  'lib/jspdf.plugin.autotable.min.js'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(VERSION)
      .then(function(cache) {
        // cache: 'reload' evita copiar archivos viejos guardados por el navegador
        return cache.addAll(ARCHIVOS.map(function(url) {
          return new Request(url, { cache: 'reload' });
        })).then(function() {
          // La tipografía es opcional: si falta, la app usa la del celular
          return cache.add('PlusJakartaSans.ttf').catch(function() {});
        });
      })
      .then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys()
      .then(function(nombres) {
        return Promise.all(
          // Solo las copias viejas de ESTA app: las demás apps de
          // geol21.github.io comparten el mismo almacenamiento
          nombres
            .filter(function(nombre) {
              return nombre.indexOf('cctv-') === 0 && nombre !== VERSION && nombre !== FUENTES;
            })
            .map(function(nombre) { return caches.delete(nombre); })
        );
      })
      .then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event) {
  const peticion = event.request;

  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);

  // Letras e íconos de Google: se guardan la primera vez para que la
  // app se vea igual sin señal
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FUENTES).then(function(cache) {
        return cache.match(peticion).then(function(guardada) {
          return guardada || fetch(peticion).then(function(r) {
            if (r && (r.ok || r.type === 'opaque')) cache.put(peticion, r.clone());
            return r;
          });
        });
      })
    );
    return;
  }

  // Los envíos a Apps Script (POST, otro dominio) no pasan por aquí
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(VERSION).then(function(cache) {

      const deLaRed = fetch(peticion).then(function(respuesta) {
        if (respuesta && respuesta.ok) {
          cache.put(peticion, respuesta.clone());
        }
        return respuesta;
      });

      const espera = new Promise(function(resolve) {
        setTimeout(resolve, 3000);
      });

      return cache.match(peticion, { ignoreSearch: true })
        .then(function(guardada) {

          if (!guardada) {
            return deLaRed;
          }

          // Hay copia: se usa si la red falla o tarda demasiado
          return Promise.race([
            deLaRed.catch(function() { return guardada; }),
            espera.then(function() { return guardada; })
          ]);
        });
    })
  );
});
