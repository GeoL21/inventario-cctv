#!/usr/bin/env bash
# Antes de un "git commit": si cambiaron archivos de la app y no se subió VERSION en sw.js, se detiene.
entrada=$(cat)
echo "$entrada" | grep -q 'git[^"]*commit' || exit 0
cd "$CLAUDE_PROJECT_DIR" || exit 0

# Archivos que van en el commit (preparados o, con -a, también los modificados)
cambios=$( { git diff --cached --name-only; echo "$entrada" | grep -qE 'commit[^"]*-[a-zA-Z]*a' && git diff --name-only; } | sort -u)

if echo "$cambios" | grep -qE '^(index\.html|app\.js|manifest\.webmanifest|lib/)'; then
  if ! { git diff --cached sw.js; git diff sw.js; } | grep -q "^+const VERSION"; then
    echo "Cambiaron archivos de la app pero no se subió VERSION en sw.js: los celulares seguirían con la copia vieja. Súbela (por ejemplo cctv-v9 → cctv-v10) antes del commit." >&2
    exit 2
  fi
fi
exit 0
