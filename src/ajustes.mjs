/* Los ajustes viven en un JSON al lado del usuario, no en el código. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/* La carpeta se puede mover con una variable de entorno. No es un capricho:
   sin esto, correr las pruebas de punta a punta en tu propia máquina te pisa
   los ajustes de verdad —el canal, el destino, el retardo— con los que usa el
   test. Una prueba no tiene por qué tocar la configuración del usuario. */
const CARPETA = process.env.CARPETA_AJUSTES || join(homedir(), '.lol-auto-accept');
const ARCHIVO = join(CARPETA, 'ajustes.json');

export const POR_DEFECTO = {
  retardoMs: 1500,
  variacionMs: 400,
  ritmoLento: 2000,
  ritmoRapido: 300,
  ritmoSeleccion: 1000,
  avisarUltimos: 10,
  reintentoMs: 5000,
  activo: true,
  puertoPanel: 8123,
  avisos: { canal: 'ninguno', destino: '', seleccion: true },
  /* Ver el panel desde el teléfono. Apagado de fábrica: abrir algo a la red
     tiene que ser una decisión, no un valor por defecto. */
  remoto: { activo: false, llave: '' },
  /* Los últimos que elegiste desde el panel, para tenerlos a un toque. */
  recientes: { ban: [], pick: [] },
};

/* La llave del panel remoto: 24 caracteres al azar, de los que se pueden
   escribir en una URL sin escaparlos. */
const LLAVE_VALIDA = /^[\w-]{16,64}$/;

const CANALES_VALIDOS = new Set(['ninguno', 'ntfy', 'pushcut', 'webhook', 'imessage']);

const listaDeIds = (v) => (Array.isArray(v) ? v : [])
  .map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 8);

const entero = (v, min, max, sino) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : sino;
};

/* Sanear siempre: un retardo de 0 acepta en el mismo milisegundo y uno de un
   minuto deja pasar la partida. Los límites son parte del contrato. */
export function sanear(entrada = {}) {
  return {
    retardoMs: entero(entrada.retardoMs, 0, 7000, POR_DEFECTO.retardoMs),
    variacionMs: entero(entrada.variacionMs, 0, 3000, POR_DEFECTO.variacionMs),
    ritmoLento: entero(entrada.ritmoLento, 500, 10000, POR_DEFECTO.ritmoLento),
    ritmoRapido: entero(entrada.ritmoRapido, 100, 2000, POR_DEFECTO.ritmoRapido),
    /* La selección dura minutos, no diez segundos: sondearla cada segundo
       alcanza de sobra y no llena el log del cliente de pedidos. */
    ritmoSeleccion: entero(entrada.ritmoSeleccion, 300, 5000, POR_DEFECTO.ritmoSeleccion),
    avisarUltimos: entero(entrada.avisarUltimos, 0, 30, POR_DEFECTO.avisarUltimos),
    /* Cada cuánto se busca al cliente cuando no está abierto. */
    reintentoMs: entero(entrada.reintentoMs, 1000, 60000, POR_DEFECTO.reintentoMs),
    activo: entrada.activo !== false,
    puertoPanel: entero(entrada.puertoPanel, 1024, 65535, POR_DEFECTO.puertoPanel),
    avisos: {
      /* Un canal desconocido apaga los avisos en vez de romper el arranque. */
      canal: CANALES_VALIDOS.has(entrada.avisos?.canal) ? entrada.avisos.canal : 'ninguno',
      destino: String(entrada.avisos?.destino ?? '').trim().slice(0, 500),
      /* Los avisos de la selección se pueden apagar solos, sin perder el de
         "partida aceptada", que es el que de verdad no querés perderte. */
      seleccion: entrada.avisos?.seleccion !== false,
    },
    recientes: {
      ban: listaDeIds(entrada.recientes?.ban),
      pick: listaDeIds(entrada.recientes?.pick),
    },
    remoto: {
      /* Sin llave no hay acceso remoto: un panel abierto a la red sin nada que
         lo proteja es justo lo que este ajuste no puede permitir. */
      activo: entrada.remoto?.activo === true && LLAVE_VALIDA.test(entrada.remoto?.llave ?? ''),
      llave: LLAVE_VALIDA.test(entrada.remoto?.llave ?? '') ? entrada.remoto.llave : '',
    },
  };
}

export function leer() {
  try { return sanear(JSON.parse(readFileSync(ARCHIVO, 'utf8'))); }
  catch { return sanear(POR_DEFECTO); }
}

export function guardar(ajustes) {
  const limpio = sanear(ajustes);
  try {
    mkdirSync(CARPETA, { recursive: true });
    writeFileSync(ARCHIVO, JSON.stringify(limpio, null, 2));
  } catch {}
  return limpio;
}

export const RUTA_AJUSTES = ARCHIVO;
