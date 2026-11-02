#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   Demo: la app de verdad contra un cliente de League simulado.

   Para ver el panel funcionando —la cola, la partida encontrada, la selección
   con tu ban y tu pick— sin tener League abierto y sin tocar nada tuyo:

     npm run demo        → http://127.0.0.1:8125

   Usa el LCU falso de las pruebas, una carpeta de ajustes descartable y otro
   puerto. Así convive con la copia instalada, no le habla a tu cliente real y
   no manda ningún aviso.

   La partida se juega sola: entrás en cola, salta, la app la acepta, y en la
   selección espera a que banees y pickees desde el panel. Si no lo hacés, el
   reloj se termina y sigue igual. Después arranca otra.
   --------------------------------------------------------------------------- */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { servidorFalso, sesionSeleccion, CAMPEONES } from '../test/servidor-falso.mjs';

const PUERTO = Number(process.env.PUERTO_DEMO) || 8125;
const YO = 2;   // la celda del jugador en la sesión simulada: va de ADC
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const DD = 'https://ddragon.leagueoflegends.com';

/* El catálogo y las caras salen de Data Dragon, el CDN público de Riot. Sin
   internet la demo sigue igual, con los diez campeones de las pruebas. */
async function catalogo() {
  const pedir = (url) => fetch(url, { signal: AbortSignal.timeout(5000) });
  try {
    const [version] = await (await pedir(`${DD}/api/versions.json`)).json();
    const { data } = await (await pedir(`${DD}/cdn/${version}/data/es_AR/champion.json`)).json();
    const lista = Object.values(data).map((c) => ({ id: Number(c.key), name: c.name, imagen: c.image.full }));
    const porId = new Map(lista.map((c) => [c.id, c]));
    /* Las caras se piden recién cuando el panel las muestra, una vez cada una. */
    const caras = new Map();
    const icono = (id) => {
      const c = porId.get(id);
      if (!c) return null;
      if (!caras.has(id)) {
        caras.set(id, pedir(`${DD}/cdn/${version}/img/champion/${c.imagen}`)
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .then((b) => (b ? Buffer.from(b) : null))
          .catch(() => null));
      }
      return caras.get(id);
    };
    console.log(`[demo] ${lista.length} campeones de Data Dragon ${version}`);
    return { campeones: [{ id: -1, name: 'None' }, ...lista.map(({ id, name }) => ({ id, name }))], icono };
  } catch {
    console.log('[demo] sin internet: sigo con los diez campeones de las pruebas');
    return { campeones: CAMPEONES, icono: null };
  }
}

const { campeones, icono } = await catalogo();
const falso = servidorFalso({ campeones, icono });
const lockfile = falso.lockfile(await falso.escuchar());
const est = falso.estado;

/* La app, tal cual la corre el usuario, pero mirando al cliente simulado. */
const ajustes = mkdtempSync(join(tmpdir(), 'auto-accept-demo-'));
writeFileSync(join(ajustes, 'ajustes.json'), JSON.stringify({ puertoPanel: PUERTO, reintentoMs: 1000 }));
const app = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'index.mjs')], {
  env: { ...process.env, LOCKFILE: lockfile, PUERTO_PANEL: String(PUERTO), CARPETA_AJUSTES: ajustes, SIN_NAVEGADOR: '1' },
  stdio: 'inherit',
});
app.on('exit', (codigo) => {
  rmSync(ajustes, { recursive: true, force: true });
  process.exit(codigo ?? 0);
});
for (const senal of ['SIGINT', 'SIGTERM']) process.on(senal, () => app.kill(senal));

/* -------------------------------------------------------- la partida */
const acciones = () => est.seleccion.actions.flat();
const mia = (tipo) => acciones().find((a) => a.actorCellId === YO && a.type === tipo);
/* Los demás no agarran lo que ya está marcado: en la demo nadie te roba el
   campeón que estás por elegir. */
function libre() {
  const ocupados = new Set(acciones().map((a) => a.championId).filter((id) => id > 0));
  const opciones = campeones.filter((c) => c.id > 0 && !ocupados.has(c.id));
  return opciones[Math.floor(Math.random() * opciones.length)]?.id ?? 0;
}
function cerrar(a, id) {
  Object.assign(a, { championId: id, completed: true, isInProgress: false });
  const jugador = est.seleccion.myTeam.find((j) => j.cellId === a.actorCellId);
  if (a.type === 'pick' && jugador) jugador.championId = id;
}
/* El reloj baja de verdad, y la fase se corta antes si ya pasó lo que se
   estaba esperando (que banees, que pickees). */
async function reloj(fase, segundos, listo = () => false) {
  est.seleccion.timer.phase = fase;
  for (let ms = segundos * 1000; ms > 0 && !listo(); ms -= 250) {
    est.seleccion.timer.adjustedTimeLeftInPhase = ms;
    await dormir(250);
  }
}

async function partida() {
  est.fase = 'None'; est.readyCheck = null; est.seleccion = null;
  await dormir(4000);
  console.log('[demo] en cola');
  falso.encolar();
  await dormir(5000);
  console.log('[demo] saltó la partida');
  falso.saltarPartida();
  for (let i = 0; i < 24 && est.readyCheck?.playerResponse !== 'Accepted'; i++) await dormir(500);
  if (est.readyCheck?.playerResponse !== 'Accepted') {
    console.log('[demo] nadie aceptó (¿está en pausa?): vuelta a empezar');
    return;
  }

  /* La selección arranca limpia: nadie baneó ni eligió nada todavía. */
  const sesion = sesionSeleccion({ yo: YO, turno: 'ban', segundos: 20 });
  for (const a of sesion.actions.flat()) Object.assign(a, { championId: 0, completed: false, isInProgress: false });
  for (const j of sesion.myTeam) Object.assign(j, { championId: 0, championPickIntent: 0 });
  est.seleccion = sesion;
  console.log('[demo] selección: planificación');
  await reloj('PLANNING', 20);

  console.log('[demo] selección: bans');
  const bans = acciones().filter((a) => a.type === 'ban');
  for (const a of bans) a.isInProgress = true;
  await reloj('BAN_PICK', 30, () => mia('ban').completed);
  /* Tu ban, si no lo fijaste, es lo que hayas dejado marcado (o ninguno). */
  for (const a of bans) if (!a.completed) cerrar(a, a.actorCellId === YO ? a.championId : libre());

  console.log('[demo] selección: picks');
  for (const a of acciones().filter((x) => x.type === 'pick')) {
    a.isInProgress = true;
    if (a.actorCellId === YO) await reloj('BAN_PICK', 30, () => a.completed);
    else await reloj('BAN_PICK', 4);
    /* En League, no fijar a tiempo cancela la partida. La demo es más
       buena: fija lo que estaba marcado, o cualquiera, y sigue. */
    if (!a.completed) cerrar(a, a.championId || libre());
  }
  await reloj('FINALIZATION', 8);

  console.log('[demo] arrancó la partida');
  est.fase = 'GameStart'; est.seleccion = null;
  await dormir(2000);
  est.fase = 'InProgress';
  await dormir(10000);
  est.fase = 'EndOfGame';
  await dormir(3000);
}

for (;;) {
  try { await partida(); }
  catch (e) { console.log(`[demo] algo falló (${e.message}); empiezo otra partida`); await dormir(2000); }
}
