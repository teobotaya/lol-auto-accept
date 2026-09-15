/* ---------------------------------------------------------------------------
   Encontrar al cliente de League.

   El cliente levanta un servidor HTTPS local —el LCU— y publica sus
   credenciales de dos formas. Se intenta primero por los argumentos del
   proceso, que es lo más confiable porque no depende de dónde esté instalado
   el juego, y se cae al lockfile si eso falla.

   Nada de esto toca el juego: se lee información que el propio cliente
   publica en la máquina del usuario.
   --------------------------------------------------------------------------- */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const correr = promisify(execFile);

/* El lockfile es una línea con cinco campos separados por dos puntos:
   nombre:pid:puerto:contraseña:protocolo                                    */
export function leerLockfile(texto) {
  const partes = String(texto).trim().split(':');
  if (partes.length < 5) return null;
  const [, pid, puerto, clave, protocolo] = partes;
  if (!puerto || !clave) return null;
  return { puerto: Number(puerto), clave, pid: Number(pid), protocolo, origen: 'lockfile' };
}

/* De la línea de comandos del proceso salen los mismos datos. Las comillas
   varían entre Windows y macOS, así que el patrón las acepta o no. */
export function leerArgumentos(linea) {
  const puerto = /--app-port=["']?(\d+)/.exec(linea);
  const clave = /--remoting-auth-token=["']?([\w-]+)/.exec(linea);
  if (!puerto || !clave) return null;
  return { puerto: Number(puerto[1]), clave: clave[1], origen: 'proceso' };
}

export const RUTAS_LOCKFILE = {
  win32: [
    'C:\\Riot Games\\League of Legends\\lockfile',
    'C:\\Program Files\\Riot Games\\League of Legends\\lockfile',
    'C:\\Program Files (x86)\\Riot Games\\League of Legends\\lockfile',
  ],
  darwin: [
    '/Applications/League of Legends.app/Contents/LoL/lockfile',
    `${process.env.HOME}/Applications/League of Legends.app/Contents/LoL/lockfile`,
  ],
};

async function porProceso(plataforma) {
  try {
    if (plataforma === 'win32') {
      /* Get-CimInstance en vez de wmic: wmic está deprecado y ya no viene en
         las instalaciones nuevas de Windows 11. */
      const { stdout } = await correr('powershell.exe', ['-NoProfile', '-Command',
        "(Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\").CommandLine"],
        { timeout: 8000, windowsHide: true });
      return leerArgumentos(stdout);
    }
    const { stdout } = await correr('/bin/sh', ['-c',
      "ps -A -o args= | grep -m1 'LeagueClientU[x]'"], { timeout: 8000 });
    return leerArgumentos(stdout);
  } catch { return null; }
}

async function porLockfile(plataforma, rutas) {
  for (const ruta of rutas ?? RUTAS_LOCKFILE[plataforma] ?? []) {
    try { return leerLockfile(await readFile(ruta, 'utf8')); } catch {}
  }
  return null;
}

export async function descubrir({ plataforma = process.platform, rutas } = {}) {
  /* Escotilla para instalaciones en lugares raros —y para las pruebas—:
     LOCKFILE=/ruta/al/lockfile manda sobre todo lo demás. */
  if (!rutas && process.env.LOCKFILE) rutas = [process.env.LOCKFILE];
  /* Si el llamador nombra rutas, esas mandan: es lo que hacen las pruebas y
     quien tenga el juego instalado en un lugar raro.
     Y preguntar por los procesos solo tiene sentido si la plataforma que se
     pide es la que estamos corriendo; si no, se lee la caja de otro sistema. */
  if (rutas?.length) return (await porLockfile(plataforma, rutas)) ?? (await porProceso(plataforma));
  const mismaMaquina = plataforma === process.platform;
  return (mismaMaquina ? await porProceso(plataforma) : null) ?? (await porLockfile(plataforma, rutas));
}
