/* Los ajustes viven en un JSON al lado del usuario, no en el código. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CARPETA = join(homedir(), '.lol-auto-accept');
const ARCHIVO = join(CARPETA, 'ajustes.json');

export const POR_DEFECTO = {
  retardoMs: 1500,
  variacionMs: 400,
  ritmoLento: 2000,
  ritmoRapido: 300,
  ritmoSeleccion: 1000,
  avisarUltimos: 10,
  activo: true,
  puertoPanel: 8123,
  avisos: { canal: 'ninguno', destino: '', seleccion: true },
};

const CANALES_VALIDOS = new Set(['ninguno', 'ntfy', 'pushcut', 'webhook', 'imessage']);

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
  };
}

export function leer() {
  try { return sanear(JSON.parse(readFileSync(ARCHIVO, 'utf8'))); }
  catch { return { ...POR_DEFECTO }; }
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
