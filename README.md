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
3. **macOS**, instalado para que ande solo:

   ```bash
   npm run instalar
   ```

   Queda corriendo en segundo plano, arranca cada vez que iniciás sesión y
   aparece como **LoL Auto Accept** en Spotlight. Para sacarlo,
   `npm run desinstalar`.

   **macOS**, solo cuando lo abras vos: doble clic en `scripts/iniciar.command`.
   **Windows**: doble clic en `scripts\iniciar.bat`.

El panel está en `http://127.0.0.1:8123`, con el estado, los ajustes y lo que
fue pasando. No hace falta abrirlo antes que League: si el cliente todavía no
está, la app lo espera y se conecta sola. Y si cerrás League y lo volvés a
abrir, se reconecta sin que hagas nada.

### Por qué la instalación copia la app

`npm run instalar` no la corre desde donde la bajaste: la copia a
`~/Library/Application Support/LoL Auto Accept`. Escritorio, Documentos y
Descargas están protegidos por macOS, y un proceso que arranca `launchd` no
puede leerlos sin Acceso total al disco: fallaría sin decir nada. Para
actualizar, se vuelve a correr `npm run instalar`. El registro queda en
`~/Library/Logs/LoL Auto Accept.log`.

## Lo que hace el panel

| | |
|---|---|
| **Estado** | en qué fase está el cliente y, si saltó la partida, los segundos que quedan de los doce |
| **Selección** | tu posición, si te toca elegir, cuánto queda y qué agarró tu equipo |
| **Retardo** | cuánto espera antes de aceptar, con una variación al azar |
| **Aceptar ya** | acepta sin esperar el retardo; en pausa, es la forma de aceptar desde el panel |
| **Cancelar esta** | corta la aceptación en curso, para esta partida |
| **Pausar** | deja de aceptar sin cerrar la app |
| **Ver desde el teléfono** | abre el panel al Wi-Fi de tu casa, con llave |
| **Bitácora** | qué pasó y cuándo |

## Cuatro decisiones

**No acepta al instante.** El retardo por defecto es 1,5 s ± 0,4 s. Dos razones:
te da tiempo a cancelar si te levantaste de la silla, y aceptar en cero
milisegundos exactos, siempre, es la firma más obvia de que hay algo automático
del otro lado.

**No sondea siempre al mismo ritmo.** Fuera de cola alcanza con mirar cada dos
segundos; dentro, cada 300 ms, porque el contador del ready check dura doce y
perder la ventana es justo lo que esta app viene a evitar. El ritmo lo decide
la fase del cliente.

**Verifica el certificado.** El LCU usa un certificado autofirmado, así que la
validación de cadena no se puede hacer sin el PEM de Riot. La salida fácil es
apagar TLS del todo; acá se apaga la cadena pero se comprueba que el emisor sea
Riot, y la conexión se corta si no lo es. Si dejás `riotgames.pem` en la raíz
del proyecto, la validación pasa a ser completa.

**Se retira cuando el cliente se va.** Cada vez que League se abre, el LCU
estrena puerto y contraseña. Antes, si cerrabas el cliente y lo volvías a
abrir, la app seguía golpeando el puerto viejo y había que reiniciarla. Ahora,
al tercer fallo de conexión seguido el vigía se da por perdido, la bitácora lo
dice una sola vez, y la app vuelve a buscar al cliente desde cero —sin perder
la cuenta de las partidas que ya aceptó.

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

### Ver el panel en el iPhone

Los avisos te dicen que pasó algo. Para *ver* qué pasa —el reloj del ready
check, tu turno en la selección— y tener los botones a mano, el panel se puede
abrir al Wi-Fi de tu casa:

1. En el panel de la Mac, **Ver el panel desde el teléfono** → tildá la casilla.
2. **Copiar enlace** y pegalo en Safari del iPhone (con el portapapeles
   universal de Apple llega solo), o **Mandármelo al teléfono** para que te
   llegue por el canal de avisos.
3. En Safari: **Compartir → Agregar a inicio**. Queda como una app.

Desde ahí ves el estado y la selección, y podés **aceptar**, **cancelar** o
**pausar**. Lo que configura la Mac —el canal de avisos, el retardo, abrir o
cerrar la red— solo se cambia en la Mac.

Con la red abierta, además, **tocar cualquier aviso abre el panel**. Es la
combinación que buscaba: suena el teléfono, lo tocás y ves cuánto falta.

**Cómo está cuidado.** Apagado de fábrica. Encendido, cualquier pedido que no
venga de la propia Mac necesita la llave: 24 caracteres al azar que viajan una
sola vez en el enlace y quedan en una cookie `HttpOnly`; la URL se limpia con
una redirección para que la llave no quede en el historial. Los avisos de
rutina mandan la dirección *sin* la llave, porque pasan por los servidores de
ntfy o Pushcut. **Cambiar la llave** deja afuera a cualquier teléfono que
tuviera la vieja. Y nada de esto sale de tu red: fuera de casa el panel no se ve.

Si el iPhone no llega, revisá que esté en el mismo Wi-Fi que la Mac y que el
firewall de macOS no esté bloqueando `node` (Ajustes del Sistema → Red →
Firewall).

### Qué te avisa, y por qué esos momentos y no otros

Un aviso que no te pide nada entrena a ignorar los que sí. Así que son pocos, y
cada uno sale **una sola vez por partida** aunque la app mire el cliente cien
veces:

| Momento | Qué dice |
|---|---|
| **Saltó la partida** | solo si estás en pausa: tenés doce segundos y la app no la va a aceptar |
| **Partida aceptada** | acepté por vos, y en cuánto |
| **Selección de campeones** | ya estás adentro, vas ADC, hay 2 picks antes del tuyo, quedan 27 s |
| **Te toca PICKEAR / BANEAR** | es tu turno, quedan N segundos, y qué eligió tu equipo |
| **Últimos segundos** | quedan 10 o menos y todavía no elegiste |
| **Arrancó / se cayó** | empezó la partida (y con qué campeón), o volviste a la cola |

Los de la selección se pueden apagar solos, con la casilla del panel, sin perder
el de *partida aceptada*.

Cada aviso lleva una prioridad. Los que piden que hagas algo ya —te toca
pickear, últimos segundos, saltó la partida en pausa— van con la más alta: en
ntfy y en Pushcut atraviesan el modo Concentración del iPhone, si se lo
permitís a la app.

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
así un mensaje con comillas no puede cerrar la cadena y colar código. La
primera vez, macOS te va a preguntar si `node` puede controlar Mensajes: hay
que decirle que sí. Y conviene escribir el número completo, con `+54 9`.

**Las tildes llegan.** ntfy se publica en JSON y no con el título en una
cabecera, que es la forma corta de su documentación: `fetch` manda las
cabeceras en Latin-1 y "Selección de campeones" llegaba como "Selecci�n".

**Otra página no puede tocar el panel.** Un servidor en 127.0.0.1 no está
protegido por ser local: cualquier sitio abierto en tu navegador puede
mandarle un POST simple. Todo POST del panel exige una cabecera propia, que un
sitio ajeno no puede agregar sin que el navegador pregunte antes —y este
servidor nunca dice que sí—, y se rechaza cualquier pedido cuyo `Host` no sea
el de la Mac, que es la huella del DNS rebinding. Tampoco se filtra la
configuración: `/api/estado` devolvía antes el destino de los avisos entero,
token incluido.

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

**211 pruebas**: 45 de unidad e integración, 43 de avisos, 64 de selección de
campeones y 59 de punta a punta. Corren contra un LCU falso que reproduce lo que
importa —el certificado autofirmado emitido por Riot, la autenticación básica,
la fase del gameflow, el ready-check con su contador y la sesión de selección
con sus acciones y su reloj— y un receptor de notificaciones falso que captura
lo que la app manda.

Las de selección son las que más pagan: la mitad son puras —se le dan sesiones
armadas a mano al reductor y se verifica qué saca en limpio— y la otra mitad
corre el vigía completo contra el LCU falso para comprobar lo único que de
verdad importa de un aviso: que salga cuando cambia algo y **una sola vez**,
aunque el sondeo pase cien veces por el mismo estado.

Y los casos raros que rompen esa promesa, que son los que hay que buscar a
propósito: blind y ARAM, donde los cinco pickean a la vez; el reloj detenido
del practice tool, que manda un centinela de dos mil millones; la segunda ronda
de baneos de los modos de torneo; y el hueco de un segundo en el que el cliente
ya bajó la sesión pero todavía dice estar en selección.

Las de punta a punta arrancan la aplicación como la arranca el usuario y la
manejan desde su propia API HTTP: partida encontrada → acepta; en pausa → no
acepta; cancelar → no acepta; la partida se cae → no dispara un accept
huérfano; el cliente se cierra → la app sigue viva y lo dice; el receptor de
avisos se cae → la partida se acepta igual; entra la selección → avisa tu
posición y cuántos picks faltan; te toca pickear → avisa; quedan 7 s → avisa una
última vez; arranca la partida → cierra el ciclo.

Y no te tocan la configuración: la de punta a punta arranca la app con
`CARPETA_AJUSTES` apuntando a una carpeta descartable, así correr `npm test` en
tu propia máquina no te pisa el canal de avisos ni el retardo que tengas puesto.

Y las de la versión 1.1: el panel en el teléfono pedido de verdad por la IP de
la red —sin llave no entra, con llave deja la cookie, una llave inventada o
rotada no pasa, y los ajustes no se tocan desde ahí—; un POST sin la cabecera
propia y un `Host` ajeno se rechazan; el estado no deja ver ni el destino de
los avisos ni la llave; y el cliente que se cierra y vuelve con otro puerto y
otra clave, que la app tiene que encontrar sola y seguir aceptando sin perder
la cuenta.

Corren en Windows, macOS y Linux en cada push.

### Contra un cliente de verdad

Probado el 2 de noviembre de 2026 en una MacBook Pro con macOS 26.6, cliente
de LAS:

- encuentra al cliente por el proceso (`LeagueClientUx`, entre una docena de
  procesos *Helper* que también lo nombran) y también por el lockfile;
- el certificado lo emite `O=Riot Games`, y la verificación del emisor pasa;
- autenticación, fase del gameflow, invocador y el catálogo de 254 campeones
  servido por el propio cliente;
- el ready check y la selección responden 404 fuera de partida, que es lo que
  la app espera.

El `timer` del ready check cuenta los segundos que **pasaron**, no los que
quedan. No hace falta adivinarlo: el propio cliente trae su interfaz en disco,
y el componente `ready-check-timer` ajusta la velocidad de su video con
`(duración − actual) / (duración − timer)`. Antes el panel mostraba esa cifra
como si fuera la cuenta regresiva.

La línea de comandos real trae dos puertos: `--riotclient-app-port` (el del
Riot Client) y `--app-port` (el del LCU). Hay una prueba con esa línea tal cual,
para que nadie los confunda.

## Estructura

```
src/descubrir.mjs   encuentra puerto y token (proceso, luego lockfile)
src/lcu.mjs         cliente HTTPS del LCU, con verificación del emisor
src/vigia.mjs       la máquina de estados: sondeo adaptativo, retardo, cancelación
src/champselect.mjs funciones puras sobre la sesión de selección, y los textos
src/avisos.mjs      los canales de notificación, con secretos enmascarados
src/ajustes.mjs     configuración en ~/.lol-auto-accept/ajustes.json
src/index.mjs       arranque, reconexión y el panel (local, o en la red con llave)
scripts/instalar-mac.sh   copia, LaunchAgent y acceso en ~/Applications
test/servidor-falso.mjs   un LCU simulado, con TLS y auth de verdad
```

Cero dependencias. Solo módulos de Node.

---

Teo Matías Botaya · MIT
