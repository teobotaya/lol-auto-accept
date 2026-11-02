/* ---------------------------------------------------------------------------
   Avisos al teléfono.

   Un detalle que conviene saber de entrada: Atajos, solo, no puede quedarse
   escuchando un evento de internet. No expone un endpoint ni recibe push. Lo
   que sí puede hacer es *reaccionar* a una notificación que llegue por otra
   vía. Así que la app manda un HTTP a un receptor, y el receptor es el que
   despierta al iPhone (y, si querés, corre un atajo).

   Por eso hay varios canales en vez de uno: cada uno resuelve esa parte de
   forma distinta, y el que te sirva depende de qué tengas instalado.

   Regla que atraviesa todo el archivo: un aviso que falla NUNCA puede romper
   una aceptación. La partida importa; la notificación es un lujo.
   --------------------------------------------------------------------------- */
import { execFile } from 'node:child_process';
import { armarAviso, MOMENTOS } from './champselect.mjs';

const TIEMPO_LIMITE = 4000;

/* Las URL de Pushcut y los webhooks suelen llevar el secreto adentro. En la
   bitácora se muestra recortado: un log no es lugar para una credencial. */
export function enmascarar(destino = '') {
  const t = String(destino);
  if (!/^https?:\/\//i.test(t)) return t;
  try {
    const u = new URL(t);
    const partes = u.pathname.split('/').filter(Boolean);
    const ultimo = partes.at(-1) ?? '';
    const corto = ultimo.length > 6 ? `${ultimo.slice(0, 3)}…${ultimo.slice(-2)}` : '…';
    return `${u.host}/${partes.slice(0, -1).join('/')}${partes.length > 1 ? '/' : ''}${corto}`;
  } catch { return 'destino inválido'; }
}

/* Cada canal recibe el mismo mensaje y decide cómo mandarlo. */
export const CANALES = {
  ninguno: {
    etiqueta: 'Sin avisos',
    ayuda: 'No manda nada.',
    async enviar() { return { ok: true, detalle: 'canal apagado' }; },
  },

  ntfy: {
    etiqueta: 'ntfy',
    ayuda: 'Gratis y sin cuenta. Instalá ntfy en el iPhone, suscribite a un tema con un nombre difícil de adivinar y escribilo acá.',
    destinoRotulo: 'Tema (o URL completa)',
    async enviar(destino, msg) {
      const d = destinoNtfy(destino);
      if (!d.ok) return { ok: false, detalle: d.detalle };
      /* Se publica como JSON y no con el título en una cabecera, que es la
         forma corta que muestra la documentación: fetch manda las cabeceras en
         Latin-1, y "Selección de campeones" llegaba al iPhone como
         "Selecci�n de campeones". En el cuerpo JSON viaja en UTF-8. */
      return peticion(d.servidor, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          topic: d.tema,
          title: msg.titulo,
          message: msg.texto,
          tags: msg.etiqueta ? [msg.etiqueta] : [],
          priority: msg.prioridad ?? 3,
          /* Tocar la notificación abre el panel en el teléfono. */
          ...(msg.url ? { click: msg.url } : {}),
        }),
      });
    },
  },

  pushcut: {
    etiqueta: 'Pushcut',
    ayuda: 'El que mejor se lleva con Atajos: la notificación que llega puede ejecutar un atajo en el iPhone. Pegá acá la URL del webhook que te da la app.',
    destinoRotulo: 'URL del webhook',
    async enviar(destino, msg) {
      return peticion(destino, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: msg.titulo, text: msg.texto, sound: 'system',
          /* Los urgentes atraviesan el modo Concentración, si se lo permitís. */
          ...(msg.prioridad >= 4 ? { isTimeSensitive: true } : {}),
          ...(msg.url ? { defaultAction: { url: msg.url } } : {}),
        }),
      });
    },
  },

  webhook: {
    etiqueta: 'Webhook propio',
    ayuda: 'Un POST con JSON a la URL que quieras: Home Assistant, tu propio servidor, lo que sea.',
    destinoRotulo: 'URL',
    async enviar(destino, msg) {
      return peticion(destino, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(msg),
      });
    },
  },

  imessage: {
    etiqueta: 'iMessage (solo macOS)',
    ayuda: 'Sin instalar nada: la Mac te manda un iMessage a vos mismo y te llega al iPhone. Poné tu número o tu Apple ID.',
    destinoRotulo: 'Número o Apple ID',
    soloEn: 'darwin',
    async enviar(destino, msg) {
      if (process.platform !== 'darwin') return { ok: false, detalle: 'iMessage solo corre en macOS' };
      /* En iMessage el enlace va solo en el que lo pide: en cada aviso sería
         una vista previa enorme repetida cinco veces por partida. */
      const texto = `${msg.titulo}\n${msg.texto}` + (msg.evento === 'enlace' && msg.url ? `\n${msg.url}` : '');
      /* El texto va como argumento de osascript, no interpolado en el script:
         así un mensaje con comillas no puede cerrar la cadena y colar código. */
      const guion = `on run {destinatario, cuerpo}
        tell application "Messages"
          set svc to 1st account whose service type = iMessage
          send cuerpo to participant destinatario of svc
        end tell
      end run`;
      return new Promise((resolver) => {
        execFile('osascript', ['-e', guion, destino, texto], { timeout: TIEMPO_LIMITE }, (err) => {
          resolver(err ? { ok: false, detalle: err.message.split('\n')[0] } : { ok: true, detalle: 'enviado' });
        });
      });
    },
  },
};

/* Un destino sin esquema es un tema del servidor público; con esquema, un
   servidor propio con el tema al final. ntfy publica en JSON contra la raíz
   del servidor, así que hay que separar las dos cosas. Vive aparte para poder
   probar el armado sin salir a la red. */
const TEMA_VALIDO = /^[\w-]{1,64}$/;
export function destinoNtfy(destino = '') {
  const t = String(destino).trim();
  let servidor = 'https://ntfy.sh', tema = t;
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      const partes = u.pathname.split('/').filter(Boolean);
      tema = partes.pop() ?? '';
      servidor = u.origin + (partes.length ? `/${partes.join('/')}` : '');
    } catch { return { ok: false, detalle: 'la URL del servidor de ntfy no es válida' }; }
  }
  /* ntfy rechaza cualquier otra cosa con un 400 que no explica nada; mejor
     decirlo acá, en castellano, antes de salir a la red. */
  if (!TEMA_VALIDO.test(tema)) {
    return { ok: false, detalle: 'el tema de ntfy solo puede tener letras, números, - y _ (hasta 64)' };
  }
  return { ok: true, servidor, tema };
}

async function peticion(url, opciones) {
  if (!/^https?:\/\//i.test(url || '')) return { ok: false, detalle: 'la URL tiene que empezar con http:// o https://' };
  try {
    const r = await fetch(url, { ...opciones, signal: AbortSignal.timeout(TIEMPO_LIMITE) });
    if (!r.ok) return { ok: false, detalle: `el receptor respondió ${r.status}` };
    return { ok: true, detalle: `${r.status}` };
  } catch (e) {
    return { ok: false, detalle: e.name === 'TimeoutError' ? 'no respondió en 4 s' : e.message };
  }
}

/* Los momentos de la selección son eventos propios y se pueden apagar sin
   apagar el aviso de "partida aceptada", que es el que nadie quiere perderse. */
export const MOMENTOS_SELECCION = new Set(Object.keys(MOMENTOS));

/* Del resumen de la selección viaja solo esto. El objeto entero trae los dos
   equipos y no hace falta: un webhook que enciende una luz o un atajo que lee
   en voz alta necesita saber si te toca y cuánto queda, nada más. */
const CAMPOS = ['fase', 'segundos', 'infinito', 'miTurno', 'tipoTurno', 'miPosicion', 'miCampeon', 'turnosAntes',
                'planBan', 'planPick'];

export function armarMensaje(evento, datos = {}) {
  if (evento === 'prueba') {
    return { titulo: 'Auto Accept anda', texto: 'Si ves esto en el iPhone, los avisos están funcionando.',
             etiqueta: 'white_check_mark', evento, prioridad: 3 };
  }
  if (evento === 'enlace') {
    return { titulo: 'El panel, en tu teléfono',
             texto: 'Tocá para abrirlo. Desde ahí ves la cola y la selección, y podés aceptar o cancelar. Solo funciona en el mismo Wi-Fi que la Mac.',
             etiqueta: 'iphone', evento, prioridad: 3, url: datos.url };
  }
  /* Solo sale con la app en pausa: es el único aviso que te dice que tenés
     doce segundos para hacer algo, así que va con la prioridad más alta. */
  if (evento === 'encontrada') {
    return { titulo: 'Saltó la partida',
             texto: `Estás en pausa, no la acepto yo.${datos.restante ? ` Quedan ${datos.restante} s.` : ''} Tocá para aceptarla desde el teléfono.`,
             etiqueta: 'bell', evento, prioridad: 5 };
  }
  /* Los textos de la selección viven en champselect.mjs, al lado de los datos
     que describen: acá solo se los envuelve para mandarlos. */
  if (MOMENTOS_SELECCION.has(evento)) {
    const aviso = armarAviso(evento, datos);
    for (const c of CAMPOS) if (datos?.[c] !== undefined) aviso[c] = datos[c];
    return aviso;
  }
  const n = datos.aceptadas ?? 0;
  return {
    titulo: 'Partida aceptada',
    texto: (datos.aMano ? 'La aceptaste desde el panel.' : `Aceptada en ${datos.tras ?? '?'} ms.`) +
      (n ? ` Van ${n} en esta sesión.` : ''),
    etiqueta: 'video_game',
    evento,
    prioridad: 4,
    ...datos,
  };
}

/* `enlace` devuelve la dirección del panel para el teléfono, o nada si no
   está abierto a la red: con ella, tocar cualquier aviso abre el panel. */
export function crearAvisador(leerConfig, anotar = () => {}, { enlace = () => null } = {}) {
  /* Un solo reintento, y separado en el tiempo: si el teléfono está sin
     señal, insistir diez veces no lo va a despertar y sí puede trabar la app. */
  const mandar = async (evento, datos) => {
    const cfg = leerConfig();
    const canal = CANALES[cfg.canal] ?? CANALES.ninguno;
    if (cfg.canal === 'ninguno') return { ok: true, detalle: 'canal apagado' };
    if (cfg.seleccion === false && MOMENTOS_SELECCION.has(evento)) {
      return { ok: true, detalle: 'avisos de selección apagados' };
    }
    if (!cfg.destino) return { ok: false, detalle: 'falta el destino' };

    const msg = armarMensaje(evento, datos);
    if (!msg.url) { const u = enlace(); if (u) msg.url = u; }
    let r = await canal.enviar(cfg.destino, msg);
    if (!r.ok) r = await canal.enviar(cfg.destino, msg);
    anotar(r.ok ? 'ok' : 'aviso',
      r.ok ? `aviso enviado por ${canal.etiqueta} a ${enmascarar(cfg.destino)}`
           : `no pude avisar por ${canal.etiqueta}: ${r.detalle}`);
    return r;
  };

  return {
    /* Sin await del lado de quien acepta: el aviso nunca bloquea la partida. */
    avisar(evento, datos) { mandar(evento, datos).catch(() => {}); },
    probar() { return mandar('prueba', {}); },
    /* Este sí se espera: lo pide alguien desde el panel y quiere saber si llegó. */
    mandarEnlace(url) { return mandar('enlace', { url }); },
  };
}
