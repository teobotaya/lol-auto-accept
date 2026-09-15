#!/bin/bash
# macOS: doble clic. La primera vez puede hacer falta darle permiso:
#   chmod +x scripts/iniciar.command
cd "$(dirname "$0")/.."
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Falta Node.js. Instalalo desde https://nodejs.org (o: brew install node)"
  echo
  read -n 1 -s -r -p "  Enter para cerrar"
  exit 1
fi
echo "  Arrancando Auto Accept. Dejalo abierto mientras jugas."
echo "  Para cerrarlo: Ctrl + C, o cerra esta ventana."
node src/index.mjs
