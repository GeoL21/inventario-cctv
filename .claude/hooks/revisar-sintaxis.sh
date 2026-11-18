#!/usr/bin/env bash
# Después de editar: revisa que app.js, sw.js y Codigo.gs no tengan errores de sintaxis.
# Si hay error, sale con código 2 para que Claude lo vea y lo corrija.
cd "$CLAUDE_PROJECT_DIR" || exit 0
errores=""
for f in app.js sw.js config.js; do
  [ -f "$f" ] && { node --check "$f" 2>/tmp/cctv-sintaxis || errores="$errores\n$f: $(head -5 /tmp/cctv-sintaxis)"; }
done
if [ -f apps-script/Codigo.gs ]; then
  node -e "new Function(require('fs').readFileSync('apps-script/Codigo.gs','utf8'))" 2>/tmp/cctv-sintaxis \
    || errores="$errores\napps-script/Codigo.gs: $(head -5 /tmp/cctv-sintaxis)"
fi
if [ -n "$errores" ]; then
  printf "Error de sintaxis:%b\n" "$errores" >&2
  exit 2
fi
exit 0
