# Auto Accept — League of Legends

Acepta la partida por vos cuando salta el *ready check*. Windows y macOS, sin
instalar nada más que Node.

```
  cola → ready check → espera 1,5 s (cancelable) → POST accept
```

## Antes que nada: qué riesgo tiene

Esto **no** lee la pantalla, **no** mueve el mouse y **no** toca la memoria ni
el proceso del juego. Habla con el **LCU**, la API local que el propio cliente
de League expone en `https://127.0.0.1:<puerto>` — la misma que usan OP.GG,
Blitz, Porofessor y compañía.

Aun así, el acuerdo de uso de Riot prohíbe el software de terceros que
automatice acciones, y aceptar la cola cae en una zona gris: automatiza un
botón del cliente, no del juego. En la práctica hay aplicaciones muy conocidas
que traen esta función desde hace años y no se conocen baneos por eso, pero
**la decisión es tuya y el riesgo lo corre tu cuenta**. No soy Riot y no puedo
prometerte nada sobre cómo lo van a interpretar.

Lo que sí puedo decirte es que este proyecto se mantiene deliberadamente del
lado prolijo de la línea: no inyecta entradas, no modifica el juego, y no hace
nada dentro de la partida.

## Cómo se usa

1. Instalá [Node.js](https://nodejs.org) (versión 20 o superior).
2. Descargá esta carpeta.
3. **Windows**: doble clic en `scripts\iniciar.bat`.
   **macOS**: `chmod +x scripts/iniciar.command` una vez, después doble clic.

Se abre un panel en `http://127.0.0.1:8123` con el estado, los ajustes y lo que
fue pasando. Dejalo corriendo mientras jugás. No hace falta abrirlo antes que
League: si el cliente todavía no está, la app lo espera y se conecta sola.

## Lo que hace el panel

| | |
|---|---|
| **Estado** | en qué fase está el cliente y, si saltó la partida, cuánto falta |
| **Retardo** | cuánto espera antes de aceptar, con una variación al azar |
| **Cancelar esta** | corta la aceptación en curso, para esta partida |
| **Pausar** | deja de aceptar sin cerrar la app |
| **Bitácora** | qué pasó y cuándo |

## Tres decisiones

**No acepta al instante.** El retardo por defecto es 1,5 s ± 0,4 s. Dos razones:
te da tiempo a cancelar si te levantaste de la silla, y aceptar en cero
milisegundos exactos, siempre, es la firma más obvia de que hay algo automático
del otro lado.

**No sondea siempre al mismo ritmo.** Fuera de cola alcanza con mirar cada dos
segundos; dentro, cada 300 ms, porque el contador del ready check dura diez y
perder la ventana es justo lo que esta app viene a evitar. El ritmo lo decide
la fase del cliente.

**Verifica el certificado.** El LCU usa un certificado autofirmado, así que la
validación de cadena no se puede hacer sin el PEM de Riot. La salida fácil es
apagar TLS del todo; acá se apaga la cadena pero se comprueba que el emisor sea
Riot, y la conexión se corta si no lo es. Si dejás `riotgames.pem` en la raíz
del proyecto, la validación pasa a ser completa.

## Cómo encuentra al cliente

Dos caminos, en este orden:

1. **Los argumentos del proceso** (`--app-port` y `--remoting-auth-token`), que
   es lo más confiable porque no depende de dónde esté instalado el juego.
   En Windows por `Get-CimInstance` —no `wmic`, que ya no viene en Windows 11—
   y en macOS por `ps`.
2. **El lockfile**, en las rutas habituales de cada sistema.

Si tenés el juego en un lugar raro: `LOCKFILE=/ruta/al/lockfile npm start`.

## Probado

```bash
npm test
```

**31 pruebas** de unidad e integración y **16 de punta a punta**, contra un LCU
falso que reproduce lo que importa: el certificado autofirmado emitido por Riot,
la autenticación básica, la fase del gameflow y el ready-check con su contador.

Las de punta a punta arrancan la aplicación como la arranca el usuario y la
manejan desde su propia API HTTP: partida encontrada → acepta; en pausa → no
acepta; cancelar → no acepta; la partida se cae → no dispara un accept
huérfano; el cliente se cierra → la app sigue viva y lo dice.

Corren en Windows, macOS y Linux en cada push.

**Lo que no está probado contra un cliente real.** El proyecto se escribió en
una máquina sin League instalado. Todo lo que es protocolo —TLS, auth, sondeo,
retardo, POST— está ejercitado contra el LCU falso, y el parseo de credenciales
contra muestras reales de las dos plataformas. Lo que falta verificar en vivo
es que las rutas del lockfile y el nombre del proceso sigan siendo los de hoy
en tu instalación; si algo de eso cambió, la app lo dice en la bitácora en vez
de fallar en silencio.

## Estructura

```
src/descubrir.mjs   encuentra puerto y token (proceso, luego lockfile)
src/lcu.mjs         cliente HTTPS del LCU, con verificación del emisor
src/vigia.mjs       la máquina de estados: sondeo adaptativo, retardo, cancelación
src/ajustes.mjs     configuración en ~/.lol-auto-accept/ajustes.json
src/index.mjs       arranque, reconexión y panel en 127.0.0.1
test/servidor-falso.mjs   un LCU simulado, con TLS y auth de verdad
```

Cero dependencias. Solo módulos de Node.

---

Teo Matías Botaya · MIT
