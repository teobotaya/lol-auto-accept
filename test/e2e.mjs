/* Prueba de punta a punta de la aplicación entera: se levanta el LCU falso, se
   arranca la app como la arrancaría el usuario y se la maneja desde su propia
   API HTTP, igual que hace el panel. */
import { spawn } from 'node:child_process';
import { servidorFalso } from './servidor-falso.mjs';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let fallos = 0, total = 0;
const ok = (n, c, d = '') => { total++; console.log(c ? `  ok    ${n}` : `  FALLA ${n}${d ? ' — ' + d : ''}`); if (!c) fallos++; };

const falso = servidorFalso();
const puerto = await falso.escuchar();
const lockfile = falso.lockfile(puerto);
const PANEL = 8199;

const app = spawn(process.execPath, ['src/index.mjs'], {
  env: { ...process.env, LOCKFILE: lockfile, PUERTO_PANEL: String(PANEL), SIN_NAVEGADOR: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let salida = '';
app.stdout.on('data', (c) => { salida += c; });
app.stderr.on('data', (c) => { salida += c; });

const api = async (ruta, metodo = 'GET') => {
  const r = await fetch(`http://127.0.0.1:${PANEL}${ruta}`, { method: metodo });
  return r.json();
};

try {
  await dormir(1400);
  let e = await api('/api/estado');
  ok('la app encontró el cliente por el lockfile', e.conectado === true, JSON.stringify(e).slice(0, 160));
  ok('el panel sirve su propia página', (await fetch(`http://127.0.0.1:${PANEL}/`)).status === 200);
  ok('arranca fuera de cola', e.fase === 'None', e.fase);

  falso.encolar();
  await dormir(2600);
  e = await api('/api/estado');
  ok('detecta la cola y acelera el sondeo', e.enCola === true, e.fase);

  falso.saltarPartida();
  await dormir(900);
  e = await api('/api/estado');
  ok('vio la partida y está por aceptar', e.aceptando === true || falso.estado.aceptaciones === 1,
     JSON.stringify({ aceptando: e.aceptando, acept: falso.estado.aceptaciones }));

  await dormir(2500);
  ok('aceptó la partida de verdad', falso.estado.aceptaciones === 1, `aceptaciones=${falso.estado.aceptaciones}`);
  e = await api('/api/estado');
  ok('el contador del panel lo refleja', e.cuenta?.aceptadas === 1, JSON.stringify(e.cuenta));
  ok('la bitácora lo cuenta en castellano',
     e.bitacora?.some((l) => /aceptada tras \d+ ms/.test(l.texto)),
     JSON.stringify(e.bitacora?.slice(0, 3)));

  /* Pausa */
  let p = await api('/api/pausa', 'POST');
  ok('el botón de pausa responde', p.activo === false, JSON.stringify(p));
  falso.estado.fase = 'Matchmaking'; falso.estado.readyCheck = null;
  await dormir(700);
  falso.saltarPartida();
  await dormir(2800);
  ok('en pausa no acepta', falso.estado.aceptaciones === 1, `aceptaciones=${falso.estado.aceptaciones}`);
  await api('/api/pausa', 'POST');

  /* Ajustes desde el panel */
  const a = await api('/api/ajustes?retardoMs=2500&variacionMs=0', 'POST');
  ok('los ajustes se aplican y se sanean', a.retardoMs === 2500 && a.variacionMs === 0, JSON.stringify(a));
  const b = await api('/api/ajustes?retardoMs=999999&variacionMs=-5', 'POST');
  ok('un retardo absurdo queda dentro de los límites', b.retardoMs === 7000 && b.variacionMs === 0, JSON.stringify(b));

  /* Cancelar desde el panel, con retardo largo para llegar a tiempo */
  await api('/api/ajustes?retardoMs=3000&variacionMs=0', 'POST');
  falso.estado.fase = 'Matchmaking'; falso.estado.readyCheck = null;
  await dormir(700);
  falso.saltarPartida();
  await dormir(900);
  const c = await api('/api/cancelar', 'POST');
  ok('el botón de cancelar corta la aceptación', c.cancelado === true, JSON.stringify(c));
  await dormir(3200);
  ok('y después de cancelar no acepta igual', falso.estado.aceptaciones === 1, `aceptaciones=${falso.estado.aceptaciones}`);

  /* El cliente se cierra */
  await falso.cerrar();
  await dormir(2500);
  e = await api('/api/estado');
  ok('si el cliente se cierra, la app sigue viva y lo dice',
     e.fase === 'sin cliente' || e.bitacora?.some((l) => l.tipo === 'error'), JSON.stringify(e.fase));
  ok('la app no se cayó', app.exitCode === null);
} finally {
  app.kill('SIGTERM');
  await dormir(400);
  app.kill('SIGKILL');
}

console.log(`\n${total - fallos}/${total} pruebas de punta a punta pasaron`);
if (fallos) console.log('\n--- salida de la app ---\n' + salida.slice(-1500));
process.exit(fallos ? 1 : 0);
