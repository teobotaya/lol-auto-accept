#!/bin/bash
# Saca Auto Accept de esta Mac: lo detiene, borra el arranque automático, la
# copia de la app y el acceso de ~/Applications.
#
#   bash scripts/desinstalar-mac.sh     (o: npm run desinstalar)
#
# Tus ajustes (~/.lol-auto-accept) quedan: si volvés a instalar, arrancás con
# el mismo canal de avisos y el mismo retardo.
set -euo pipefail

ETIQUETA="com.teobotaya.lol-auto-accept"
launchctl bootout "gui/$(id -u)/$ETIQUETA" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$ETIQUETA.plist"
rm -rf "$HOME/Library/Application Support/LoL Auto Accept"
rm -rf "$HOME/Applications/LoL Auto Accept.app"

echo
echo "  Auto Accept desinstalado."
echo "  Tus ajustes siguen en ~/.lol-auto-accept (borralo a mano si no los querés)."
echo "  El registro sigue en ~/Library/Logs/LoL Auto Accept.log."
echo
