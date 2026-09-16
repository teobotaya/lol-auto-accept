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
      return peticion(urlNtfy(destino), {
        method: 'POST',
        headers: {
          title: msg.titulo,
          tags: msg.etiqueta,
          priority: 'default',
          'content-type': 'text/plain; charset=utf-8',
        },
        body: msg.texto,
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
        body: JSON.stringify({ title: msg.titulo, text: msg.texto, sound: 'system' }),
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
      const texto = `${msg.titulo}\n${msg.texto}`;
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
   servidor propio. Vive aparte para poder probar el armado sin salir a la red. */
export function urlNtfy(destino = '') {
  return /^https?:\/\//i.test(destino)
    ? destino
    : `https://ntfy.sh/${encodeURIComponent(String(destino).trim())}`;
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
const CAMPOS = ['fase', 'segundos', 'miTurno', 'tipoTurno', 'miPosicion', 'miCampeon', 'turnosAntes'];

export function armarMensaje(evento, datos = {}) {
  if (evento === 'prueba') {
    return { titulo: 'Auto Accept anda', texto: 'Si ves esto en el iPhone, los avisos están funcionando.',
             etiqueta: 'white_check_mark', evento };
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
    texto: `Aceptada en ${datos.tras ?? '?'} ms.` + (n ? ` Van ${n} en esta sesión.` : ''),
    etiqueta: 'video_game',
    evento,
    ...datos,
  };
}

export function crearAvisador(leerConfig, anotar = () => {}) {
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
  };
}
