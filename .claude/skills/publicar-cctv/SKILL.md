---
name: publicar-cctv
description: Probar y publicar la PWA Inventario CCTV (sube la versión del service worker, prueba en Chrome y hace push a GitHub Pages). Úsala solo cuando Jorge pida publicar.
disable-model-invocation: true
---

# Publicar la PWA Inventario CCTV

1. **Versión del service worker.** Si cambió `index.html`, `app.js`, `manifest.webmanifest` o algo en `lib/`,
   sube `VERSION` en `sw.js` (`cctv-vN` → `cctv-vN+1`). Sin esto los celulares siguen con la copia vieja.
2. **Prueba.** Ejecuta `python3 .claude/skills/publicar-cctv/probar.py .` (necesita Playwright y Chrome).
   Debe terminar en "TODO BIEN". Si dice "FALLÓ", corrige y vuelve a probar; no publiques con fallas.
   Mira las capturas de `/tmp/cctv-prueba/` de las pantallas que cambiaste.
3. **Revisión visual.** Si hay una pantalla nueva o rediseñada, pide la revisión del subagente `revisor-pixel`.
4. **Publicar.** Commit en `main` con un mensaje en español que diga qué cambió para el usuario, y `git push`.
   GitHub Pages tarda 1 o 2 minutos.
5. **Apps Script.** Si cambió `apps-script/Codigo.gs`, entrégale el archivo a Jorge y recuérdale:
   pegarlo completo, y en Implementar → Administrar implementaciones → editar → **Nueva versión**
   (no una implementación nueva, porque cambiaría el enlace).
6. **Avisa** en una o dos frases qué cambió y que en el celular hay que abrir la app con señal, cerrarla y
   volver a abrirla.
