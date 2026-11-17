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
- El script lee y escribe por NOMBRE de encabezado. Al editar no reescribe la celda de la foto (chip).
- `PANEL_CONTROL`: el script solo escribe en las columnas A a H. Las columnas J en adelante son NOTAS
  y nunca se tocan. (La versión 3 hacía `panel.clear()` y borraba lo que se agregaba a mano.)
- Menú de la hoja "Hojas de vida": PDF de una cámara o de una sede (una página por cámara).
  Código y versión del formato: constantes `FORMATO_CODIGO` y `FORMATO_VERSION` del script.
- Requiere el servicio avanzado "Google Sheets API" (tabla del historial y fotos como chip).

## Reglas que no se cambian
- Los cambios no deben romper la app ni la base de datos existente.
- Funciona sin señal: registrar cámaras, buscar, ver la ficha y registrar mantenimientos.
  Editar los datos de una cámara necesita señal.
- Código de acceso para entrar (clave `cctv_codigo` en el celular, la misma de siempre).
- Registro en cuatro pasos; autocompletar de marca con aviso de serial repetido.
- Las fotos quedan como chips en la hoja; se revisan en la hoja, no en la app.
- Estándar visual Material 3 / estilo Mornye (skill nueva-pwa): vino #84303F, letra Google Sans Flex,
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
