# Inventario CCTV — Notas para Claude

## Qué es
PWA del inventario de cámaras de seguridad (CCTV) de Clínica Reina Catalina.
Ya hay más de 100 cámaras registradas de una de las dos sedes. El registro se hace desde celulares.

## Dónde vive cada parte
- Código de la PWA: este repo, publicado en GitHub Pages.
- Datos: hoja de Google (cuenta cilindrocrc@gmail.com) con pestañas
  `INVENTARIO_CCTV`, `PANEL_CONTROL` y `CONFIGURACION`.
- Servidor: implementación de Apps Script de esa hoja. Su código NO está en este repo.
  La URL del servidor está en `config.js`.
- El link viejo de Apps Script muestra un aviso con botón a esta PWA.
  Quienes registran deben poder seguir entrando por el mismo link.

## Reglas que no se cambian
- Los cambios no deben romper la app ni la base de datos existente.
- Funciona sin señal: guarda y busca sin señal, y sube al volver la conexión. No se edita sin señal.
- Código de acceso para entrar.
- Registro en cuatro pasos; filtros por estado en Buscar; autocompletar de marca con aviso de serial repetido.
- Sin pantalla de confirmación al guardar.
- En el panel, los pisos sin cámaras se muestran en cero.
- Las fotos quedan como chips con enlace en la hoja; se revisan en la hoja, no en la app.
- Todo en español, con el logo y los colores de la clínica (botón Guardar en vino tinto). Letra: Plus Jakarta Sans.

## Ideas a futuro
- Dashboard en Looker Studio con los datos más importantes del inventario.

## Cómo trabajar aquí
- Preguntar SIEMPRE antes de generar cambios o mejoras, y mostrar un bosquejo para aprobar.
- Al cambiar archivos, subir el número de `VERSION` en `sw.js`.
- Este repo es público: no escribir aquí códigos de acceso, claves ni URLs del servidor.
