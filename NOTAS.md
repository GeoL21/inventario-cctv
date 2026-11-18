# Inventario CCTV — Notas para Claude

## Qué es
PWA del inventario y la hoja de vida de las cámaras de seguridad (CCTV) de Clínica Reina Catalina.
Las dos sedes (Barranquilla y Baranoa) ya están inventariadas: 293 cámaras (nov 2026).
El registro se hace desde celulares. Al jefe de monitoreo le pidieron la hoja de vida de todas las cámaras.

## Dónde vive cada parte
- Código de la PWA: este repo, publicado en GitHub Pages.
- Servidor: `apps-script/Codigo.gs` de este repo, pegado en el Apps Script de la hoja.
  La URL del servidor está en `config.js`.
- Datos: hoja "Inventario departamento de seguridad" (cuenta cilindrocrc@gmail.com) con pestañas
  `INVENTARIO_CCTV`, `HISTORIAL_CCTV` (tabla), `PANEL_CONTROL`, `CONFIGURACION` y `SUBIDAS_PWA` (oculta).
  Carpetas en Drive: `FOTOS_INVENTARIO_CCTV`, `FOTOS_MANTENIMIENTO_CCTV`, `HOJAS_DE_VIDA_CCTV` (PDF).
- El link viejo de Apps Script muestra un aviso con botón a esta PWA.

## Hoja de vida (versión 4, 17 nov 2026)
- Cada mantenimiento, revisión o falla es una fila en `HISTORIAL_CCTV`. Al guardar uno se actualiza
  "Último mantenimiento" de la cámara en `INVENTARIO_CCTV`.
- Columnas nuevas al final de `INVENTARIO_CCTV`: IP, NVR / DVR, Canal.
- "Subzona" se llama ahora **"Torre"** y "Nivel" se llama **"Piso"** en la hoja y la app (las claves internas siguen siendo `subzona` y `nivel`).
  Barranquilla: torres A, B y C. Baranoa - Clínica: torres A y B (su piso 7 es la azotea; no hay "Azotea").
  Edificio de Dependencias: "No aplica". "Ninguna" = cámara de la clínica que no está en una torre (cuenta como completa;
  el "No aplica" viejo en las clínicas se sigue pidiendo para revisarlo).
- "Dependencia" se llama **"Servicio"** y "Área / Zona" se llama **"Punto exacto"** (claves `dependencia` y `areaZona`).
  El servicio se elige de una lista con buscador (`LISTA_SERVICIOS`, igual en app.js y Codigo.gs); las formas
  viejas se unifican con `SERVICIOS_EQUIVALENTES` (una vez, marca `SERVICIOS_V1`) y al guardar. Lo que era un
  lugar queda "Sin servicio" (filtro en Buscar) y su texto pasa a Punto exacto. "Tipo de ubicación" ya no se pide
  (la columna queda en la hoja). "Referencia" se quitó de la app y de la hoja (estaba vacía). Bodega de farmacia (sótano) y Farma Reina (afuera) son lugares distintos.
- El script lee y escribe por NOMBRE de encabezado. Al editar no reescribe la celda de la foto (chip).
- `PANEL_CONTROL`: el script solo escribe en las columnas A a H. Las columnas J en adelante son NOTAS
  y nunca se tocan. (La versión 3 hacía `panel.clear()` y borraba lo que se agregaba a mano.)
- El panel se actualiza solo cada 15 minutos (activador `panelProgramado`, se crea desde el menú
  "Activar panel automático"). Guardar desde la app solo deja la marca `PANEL_PENDIENTE`.
- Menú de la hoja "Hojas de vida": PDF de una cámara o de una sede (una página por cámara).
  Código y versión del formato: constantes `FORMATO_CODIGO` y `FORMATO_VERSION` del script.
- Requiere el servicio avanzado "Google Sheets API" (tabla del historial y fotos como chip).

## Hoja de vida en la app (17 nov 2026)
- Al tocar una cámara en Buscar se abre su hoja de vida: avance (8 puntos: marca, serial, IP, NVR / DVR,
  canal, estado físico, cableado revisado y al menos un mantenimiento), datos, mantenimientos y fallas.
- Al publicar una versión nueva, la app muestra "Hay una versión nueva · Actualizar" (controllerchange del service worker).
- Cableado acepta "No visible" (18 nov 2026): va dentro del cielo raso y no se ve sin desmontar la cámara; cuenta como completo
  (el servidor ya lo cuenta como revisado) y hay filtro "Cableado no visible" en Buscar para revisarlas cuando se baje la cámara.
- IP acepta "No aplica (análoga)" (cámaras Turbo HD que van a un DVR) y cuenta como completo.
- En las clínicas la torre vacía o "No aplica" sale como "Falta: Torre" (aparte de los 8 puntos) y hay filtro "Sin torre" en Buscar.
- Lo que falta sale en rojo; "Completar lo que falta" guarda en el celular sin señal (pendiente tipo
  `actualizar`, que usa la acción `actualizar` del servidor solo con esos campos).
- Botón PDF: se arma en el celular con jsPDF (`lib/`), con la foto de la cámara (acción `foto` del servidor, guardada en el celular como `foto:ID`); se comparte en el celular y se descarga en el PC.

## Reglas que no se cambian
- Los cambios no deben romper la app ni la base de datos existente.
- Funciona sin señal: registrar cámaras, buscar, ver la ficha y registrar mantenimientos.
  Editar los datos de una cámara necesita señal.
- Código de acceso para entrar (clave `cctv_codigo` en el celular, la misma de siempre).
- Registro en cuatro pasos (el paso va bajo el título, sin tarjeta de avance); si falta algo, mensaje
  emergente "Falta: …" con botón Ir al campo. Autocompletar de marca con aviso de serial repetido.
- Las fotos quedan como chips en la hoja; se revisan en la hoja, no en la app.
- Estándar visual "Pixel" (Material 3, skill nueva-pwa): vino #84303F, letra Google Sans Flex (texto normal 560, negritas 660–860),
  íconos Material Symbols Rounded (el service worker los guarda para verlos sin señal),
  ícono propio de la app (círculo rosa con cámara `videocam`), filas por estado
  (blanco normal, ámbar con novedad, rojo que late fuera de servicio), sonidos al guardar.

## Ideas a futuro
- Dashboard en Looker Studio con los datos más importantes del inventario.

## Cómo trabajar aquí
- Preguntar SIEMPRE antes de generar cambios o mejoras, y mostrar un bosquejo para aprobar.
- Al cambiar archivos, subir el número de `VERSION` en `sw.js`.
- Si se cambia `Codigo.gs`, hay que pegarlo en el Apps Script y crear una nueva versión de la implementación.
- Este repo es público: no escribir aquí códigos de acceso ni claves.
