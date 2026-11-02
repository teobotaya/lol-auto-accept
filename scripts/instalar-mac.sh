#!/bin/bash
# Instala Auto Accept en esta Mac para que ande solo, sin una terminal abierta.
#
#   bash scripts/instalar-mac.sh        (o: npm run instalar)
#
# Qué hace, y por qué cada cosa:
#
#  1. Copia la app a ~/Library/Application Support/LoL Auto Accept. No corre
#     desde donde la bajaste porque Escritorio, Documentos y Descargas están
#     protegidos por macOS: un proceso que lanza launchd no puede leerlos sin
#     Acceso total al disco, y fallaría sin decir nada.
#  2. Registra un LaunchAgent: arranca cuando iniciás sesión, vuelve si se cae
#     y no te abre el navegador cada vez que prendés la Mac.
#  3. Agrega "LoL Auto Accept" a ~/Applications: aparece en Spotlight y en
#     Launchpad, y abre el panel.
#
# Para actualizar, se vuelve a correr este mismo script. Para sacarlo:
#   bash scripts/desinstalar-mac.sh
set -euo pipefail

if [ "$(uname)" != "Darwin" ]; then
  echo "  Esto es solo para macOS. En Windows: scripts\\iniciar.bat"
  exit 1
fi

ORIGEN="$(cd "$(dirname "$0")/.." && pwd)"
DESTINO="$HOME/Library/Application Support/LoL Auto Accept"
ETIQUETA="com.teobotaya.lol-auto-accept"
PLIST="$HOME/Library/LaunchAgents/$ETIQUETA.plist"
REGISTRO="$HOME/Library/Logs/LoL Auto Accept.log"
LANZADOR="$HOME/Applications/LoL Auto Accept.app"
DOMINIO="gui/$(id -u)"

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "  Falta Node.js 20 o más nuevo: https://nodejs.org (o: brew install node)"
  exit 1
fi
if [ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "  Hace falta Node 20 o más nuevo; tenés $("$NODE" -v)."
  exit 1
fi
# launchd no carga tu .zshrc, así que no sabe dónde está node: se guarda la
# ruta exacta. Si después cambiás de versión con nvm, volvé a instalar.
NODE="$(cd "$(dirname "$NODE")" && pwd -P)/$(basename "$NODE")"

# El puerto del panel sale de tus ajustes, si lo cambiaste.
PUERTO="$("$NODE" -e '
  try { const a = JSON.parse(require("fs").readFileSync(require("os").homedir() + "/.lol-auto-accept/ajustes.json", "utf8"));
        console.log(a.puertoPanel || 8123); } catch { console.log(8123); }')"

echo
echo "  Instalando Auto Accept"
echo "  ─────────────────────"

# Si ya estaba corriendo, se lo baja antes de pisarle los archivos.
launchctl bootout "$DOMINIO/$ETIQUETA" 2>/dev/null || true

echo "  · app        → $DESTINO"
mkdir -p "$DESTINO"
rm -rf "$DESTINO/src"
cp -R "$ORIGEN/src" "$ORIGEN/package.json" "$ORIGEN/LICENSE" "$DESTINO/"
if [ -f "$ORIGEN/riotgames.pem" ]; then cp "$ORIGEN/riotgames.pem" "$DESTINO/"; fi

echo "  · arranque   → $PLIST"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$ETIQUETA</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DESTINO/src/index.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$DESTINO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SIN_NAVEGADOR</key><string>1</string>
    <key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <!-- Vuelve solo si se cae; si lo cerrás bien, queda cerrado. -->
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <!-- Interactive: macOS no le estira los temporizadores para ahorrar
       batería. El ready check dura doce segundos; no hay margen. -->
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$REGISTRO</string>
  <key>StandardErrorPath</key><string>$REGISTRO</string>
</dict>
</plist>
PLIST
plutil -lint "$PLIST" >/dev/null

echo "  · acceso     → $LANZADOR"
mkdir -p "$HOME/Applications"
rm -rf "$LANZADOR"
# osacompile firma la app y avisa "replacing existing signature" aunque todo
# ande bien: se guarda lo que dice y se muestra solo si falló.
SALIDA="$(mktemp)"
if ! osacompile -o "$LANZADOR" \
  -e "do shell script \"launchctl kickstart $DOMINIO/$ETIQUETA >/dev/null 2>&1 || true\"" \
  -e "delay 0.5" \
  -e "open location \"http://127.0.0.1:$PUERTO\"" 2>"$SALIDA"; then
  cat "$SALIDA"; rm -f "$SALIDA"; exit 1
fi
rm -f "$SALIDA"

# El bootout de arriba devuelve antes de que el proceso viejo suelte el
# puerto; arrancar encima daría "puerto ocupado".
for _ in $(seq 1 20); do
  lsof -nP -iTCP:"$PUERTO" -sTCP:LISTEN >/dev/null 2>&1 || break
  sleep 0.25
done
launchctl bootstrap "$DOMINIO" "$PLIST"

printf "  · esperando el panel"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PUERTO/api/estado" >/dev/null 2>&1; then
    echo " listo."
    echo
    echo "  Auto Accept queda corriendo, y arranca solo cada vez que inicies sesión."
    echo "  Panel:     http://127.0.0.1:$PUERTO   (o \"LoL Auto Accept\" en Spotlight)"
    echo "  Registro:  $REGISTRO"
    echo
    exit 0
  fi
  printf "."
  sleep 0.5
done
echo
echo "  El panel no respondió. Lo que dijo la app:"
tail -n 20 "$REGISTRO" 2>/dev/null || true
exit 1
