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

const VERSION = 'cctv-v1';

const ARCHIVOS = [
  './',
  'index.html',
  'app.js',
  'config.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(VERSION)
      .then(function(cache) { return cache.addAll(ARCHIVOS); })
      .then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys()
      .then(function(nombres) {
        return Promise.all(
          nombres
            .filter(function(nombre) { return nombre !== VERSION; })
            .map(function(nombre) { return caches.delete(nombre); })
        );
      })
      .then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event) {
  const peticion = event.request;

  // Los envíos a Apps Script (POST, otro dominio) no pasan por aquí
  if (peticion.method !== 'GET' ||
      new URL(peticion.url).origin !== self.location.origin) {
    return;
  }

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
