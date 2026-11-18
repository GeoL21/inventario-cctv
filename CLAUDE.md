# Inventario CCTV — instrucciones para Claude Code

Lee y sigue las notas del proyecto:

@NOTAS.md

## Al cambiar la app
- Todo en español. Interfaz con el estándar visual **Pixel** (skill `nueva-pwa`).
- Cada cambio en `index.html`, `app.js`, `manifest.webmanifest` o `lib/` necesita subir `VERSION` en `sw.js`
  (un hook lo revisa antes de cada commit).
- Para probar y publicar usa `/publicar-cctv`.
- Antes de publicar una pantalla nueva o rediseñada, pide la revisión del subagente `revisor-pixel`.
- Si cambias `apps-script/Codigo.gs`, avisa a Jorge: hay que pegarlo en el Apps Script y crear una
  nueva versión de la implementación (Implementar → Administrar implementaciones → editar → Nueva versión).
