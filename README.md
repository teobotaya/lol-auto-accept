# Auto Accept — League of Legends

Acepta la partida por vos cuando salta el *ready check* y te avisa al teléfono
qué te toca hacer en la selección de campeones. Windows y macOS, sin instalar
nada más que Node.

```
  cola → ready check → espera 1,5 s (cancelable) → POST accept
                                                      ↓
                        selección → tu turno → últimos 10 s → arrancó
                                     ( cada uno, un aviso al teléfono )
```

Porque el problema real no es aceptar: es que la computadora acepte mientras
estás abajo tomando mate, y nadie pickee.

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
| **Selección** | tu posición, si te toca elegir, cuánto queda y qué agarró tu equipo |
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

## Avisarme al teléfono

**Lo primero, porque cambia el diseño entero:** Atajos, solo, no puede quedarse
escuchando un evento de internet. No expone una URL ni recibe push. Lo que sí
puede hacer es *reaccionar* a una notificación que llegue por otra vía. Así que
la app manda un HTTP y hace falta algo del lado del iPhone que lo reciba.

Hay cuatro canales. Elegí el que te sirva en el panel y probalo con el botón,
sin esperar a que salte una partida.

| Canal | Qué necesitás | Cuándo conviene |
|---|---|---|
| **ntfy** | La app ntfy (gratis, sin cuenta) y un tema con nombre difícil de adivinar | El más simple. Es el que recomendaría para empezar |
| **Pushcut** | La app Pushcut y su URL de webhook | **El que se lleva con Atajos**: la notificación que llega puede ejecutar un atajo en el iPhone |
| **Webhook propio** | Una URL tuya | Home Assistant, tu propio servidor, lo que tengas |
| **iMessage** | Nada, solo macOS | La Mac te manda un iMessage a vos mismo y te llega al teléfono |

### Qué te avisa, y por qué esos momentos y no otros

Un aviso que no te pide nada entrena a ignorar los que sí. Así que son cinco, y
cada uno sale **una sola vez por partida** aunque la app mire el cliente cien
veces:

| Momento | Qué dice |
|---|---|
| **Partida aceptada** | acepté por vos, y en cuánto |
| **Selección de campeones** | ya estás adentro, vas ADC, hay 2 picks antes del tuyo, quedan 27 s |
| **Te toca PICKEAR / BANEAR** | es tu turno, quedan N segundos, y qué eligió tu equipo |
| **Últimos segundos** | quedan 10 o menos y todavía no elegiste |
| **Arrancó / se cayó** | empezó la partida (y con qué campeón), o volviste a la cola |

Los de la selección se pueden apagar solos, con la casilla del panel, sin perder
el de *partida aceptada*.

De dónde sale todo esto: `/lol-champ-select/v1/session`, del mismo LCU. Publica
las acciones agrupadas por turno —cada pick y cada ban, de quién es y si está en
curso—, quién sos vos dentro de la partida, el reloj de la fase y los dos
equipos. Los nombres de los campeones también salen del cliente
(`champion-summary.json`), no de internet: si League está abierto, están, sin
depender de Data Dragon ni de que tengas conexión.

Si mandás los avisos por **webhook**, el JSON lleva los datos sueltos además del
texto —`evento`, `miTurno`, `tipoTurno`, `segundos`, `miPosicion`— para que un
atajo pueda ramificar sin parsear una frase.

### Si querés que corra un atajo de verdad

Ese es el camino de Pushcut:

1. Instalá **Pushcut** en el iPhone y creá una notificación.
2. En la notificación, elegí el atajo que querés que corra.
3. Copiá la URL del webhook que te da la app.
4. Pegala en el panel, canal **Pushcut**, y apretá *Probar ahora*.

Con eso, cada partida aceptada puede disparar el atajo que quieras: bajarte el
volumen de la música, prender una luz, escribir en una nota, lo que se te ocurra.

### Con ntfy, desde Atajos

Si preferís no instalar Pushcut, ntfy también se puede consumir desde Atajos con
una acción *Obtener contenido de URL* contra `https://ntfy.sh/tu-tema/json?poll=1`,
dentro de una automatización. Anda, pero depende de que el atajo se ejecute, así
que llega con más retraso que un push de verdad.

### Tres cosas que cuidé

**El aviso nunca rompe la aceptación.** Se manda sin esperar la respuesta, con
cuatro segundos de límite y un solo reintento. Si el teléfono está sin señal o
el receptor caído, la partida se acepta igual. Hay una prueba que apaga el
receptor a propósito y verifica exactamente eso.

**Los secretos no se muestran.** Las URL de Pushcut llevan el token adentro. En
la bitácora y en el panel se muestran recortadas, y el campo del destino nunca
se rellena con el valor guardado: si no escribís uno nuevo, el que había se
respeta. Un log no es lugar para una credencial, y una pantalla compartida
tampoco.

**El texto de iMessage va como argumento**, no interpolado en el AppleScript,
así un mensaje con comillas no puede cerrar la cadena y colar código.

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

**150 pruebas**: 31 de unidad e integración, 31 de avisos, 52 de selección de
campeones y 36 de punta a punta. Corren contra un LCU falso que reproduce lo que
importa —el certificado autofirmado emitido por Riot, la autenticación básica,
la fase del gameflow, el ready-check con su contador y la sesión de selección
con sus acciones y su reloj— y un receptor de notificaciones falso que captura
lo que la app manda.

Las de selección son las que más pagan: la mitad son puras —se le dan sesiones
armadas a mano al reductor y se verifica qué saca en limpio— y la otra mitad
corre el vigía completo contra el LCU falso para comprobar lo único que de
verdad importa de un aviso: que salga cuando cambia algo y **una sola vez**,
aunque el sondeo pase cien veces por el mismo estado.

Las de punta a punta arrancan la aplicación como la arranca el usuario y la
manejan desde su propia API HTTP: partida encontrada → acepta; en pausa → no
acepta; cancelar → no acepta; la partida se cae → no dispara un accept
huérfano; el cliente se cierra → la app sigue viva y lo dice; el receptor de
avisos se cae → la partida se acepta igual; entra la selección → avisa tu
posición y cuántos picks faltan; te toca pickear → avisa; quedan 7 s → avisa una
última vez; arranca la partida → cierra el ciclo.

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
src/champselect.mjs funciones puras sobre la sesión de selección, y los textos
src/avisos.mjs      los canales de notificación, con secretos enmascarados
src/ajustes.mjs     configuración en ~/.lol-auto-accept/ajustes.json
src/index.mjs       arranque, reconexión y panel en 127.0.0.1
test/servidor-falso.mjs   un LCU simulado, con TLS y auth de verdad
```

Cero dependencias. Solo módulos de Node.

---

Teo Matías Botaya · MIT
