/* Prueba de punta a punta de la aplicación entera: se levanta el LCU falso, se
   arranca la app como la arrancaría el usuario y se la maneja desde su propia
   API HTTP, igual que hace el panel. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { servidorFalso } from './servidor-falso.mjs';

/* Un receptor de avisos falso: es el iPhone, para lo que importa acá. */
const avisos = [];
const receptor = createServer(async (req, res) => {
  let c = ''; req.setEncoding('utf8');
  for await (const t of req) c += t;
  avisos.push({ ruta: req.url, cuerpo: c });
  res.writeHead(200); res.end('ok');
});
const puertoAviso = await new Promise((r) => receptor.listen(0, '127.0.0.1', () => r(receptor.address().port)));

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let fallos = 0, total = 0;
const ok = (n, c, d = '') => { total++; console.log(c ? `  ok    ${n}` : `  FALLA ${n}${d ? ' — ' + d : ''}`); if (!c) fallos++; };

const falso = servidorFalso();
const puerto = await falso.escuchar();
const lockfile = falso.lockfile(puerto);

/* Puerto libre pedido al sistema, no uno fijo: un 8199 hardcodeado convierte
   cualquier proceso viejo colgado en una falla de test que no existe. */
const PANEL = await new Promise((r) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
});

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

  /* Avisos al teléfono */
  const destino = encodeURIComponent(`http://127.0.0.1:${puertoAviso}/telefono`);
  const cfg = await api(`/api/avisos?canal=webhook&destino=${destino}`, 'POST');
  ok('se puede configurar el canal desde el panel', cfg.canal === 'webhook', JSON.stringify(cfg));

  const canales = await api('/api/canales');
  ok('el panel lista los canales y marca los no disponibles',
     canales.canales.length >= 4 && canales.canales.some((c) => c.id === 'pushcut'),
     JSON.stringify(canales.canales?.map((c) => c.id)));
  ok('el destino guardado se devuelve enmascarado',
     !canales.actual.destinoVisible.includes('telefono') || canales.actual.destinoVisible.includes('…'),
     canales.actual.destinoVisible);

  avisos.length = 0;
  const prueba = await api('/api/probar-aviso', 'POST');
  ok('el botón de probar llega al receptor', prueba.ok === true && avisos.length === 1, JSON.stringify({ prueba, n: avisos.length }));

  /* Y ahora lo que importa: que una partida aceptada dispare el aviso. */
  avisos.length = 0;
  await api('/api/ajustes?retardoMs=200&variacionMs=0', 'POST');
  falso.estado.fase = 'Matchmaking'; falso.estado.readyCheck = null;
  await dormir(700);
  falso.saltarPartida();
  await dormir(2200);
  ok('aceptar una partida manda el aviso', avisos.length === 1, `avisos=${avisos.length}`);
  const cuerpo = avisos[0] ? JSON.parse(avisos[0].cuerpo) : {};
  ok('el aviso dice que fue una aceptación y cuántas van',
     cuerpo.evento === 'aceptada' && cuerpo.aceptadas === 2, JSON.stringify(cuerpo));

  /* Y ahora el motivo de todo esto: estar abajo, lejos de la computadora, y
     que el teléfono te diga qué te toca hacer en la selección. */
  const eventos = (n) => avisos.map((a) => JSON.parse(a.cuerpo)).filter((x) => x.evento === n);

  avisos.length = 0;
  falso.entrarSeleccion({ segundos: 27 });
  await dormir(2400);
  ok('entrar a la selección manda su propio aviso', eventos('entraste').length === 1,
     JSON.stringify(avisos.map((a) => JSON.parse(a.cuerpo).evento)));
  const entrada = eventos('entraste')[0] ?? {};
  ok('el aviso dice la posición y cuántos picks faltan',
     entrada.miPosicion === 'ADC' && /4 picks antes/.test(entrada.texto ?? ''), entrada.texto);
  e = await api('/api/estado');
  ok('el panel también muestra la selección', e.seleccion?.miPosicion === 'ADC',
     JSON.stringify(e.seleccion?.fase));
  ok('y sabe cuántos segundos quedan', e.seleccion?.segundos > 0 && e.seleccion.segundos <= 27,
     String(e.seleccion?.segundos));

  falso.entrarSeleccion({ turno: 'pick', segundos: 22 });
  await dormir(2400);
  ok('cuando toca pickear, el teléfono se entera', eventos('tuTurnoPick').length === 1,
     JSON.stringify(avisos.map((a) => JSON.parse(a.cuerpo).evento)));
  ok('con 22 s todavía no apura', eventos('ultimoAviso').length === 0);
  ok('el aviso trae los datos para un atajo, no solo texto',
     eventos('tuTurnoPick')[0]?.miTurno === true && eventos('tuTurnoPick')[0]?.tipoTurno === 'pick',
     JSON.stringify(eventos('tuTurnoPick')[0]));

  falso.entrarSeleccion({ turno: 'pick', segundos: 7 });
  await dormir(2400);
  ok('con el reloj en rojo avisa una última vez', eventos('ultimoAviso').length === 1,
     JSON.stringify(avisos.map((a) => JSON.parse(a.cuerpo).evento)));
  ok('y ninguno de los avisos se repitió',
     avisos.length === 3, JSON.stringify(avisos.map((a) => JSON.parse(a.cuerpo).evento)));

  falso.empezarPartida();
  await dormir(2400);
  ok('cuando arranca la partida, lo dice y cierra el ciclo', eventos('empezo').length === 1,
     JSON.stringify(avisos.map((a) => JSON.parse(a.cuerpo).evento)));
  e = await api('/api/estado');
  ok('y el panel ya no muestra una selección que terminó', !e.seleccion, JSON.stringify(e.seleccion));

  /* Se pueden apagar solo los de la selección. */
  await api('/api/avisos?seleccion=no', 'POST');
  avisos.length = 0;
  falso.entrarSeleccion({ segundos: 30 });
  await dormir(2400);
  ok('apagados, los avisos de selección no salen', avisos.length === 0,
     JSON.stringify(avisos.map((a) => JSON.parse(a.cuerpo).evento)));
  ok('pero el panel los sigue mostrando igual',
     (await api('/api/estado')).seleccion?.miPosicion === 'ADC');
  falso.caerse();
  await dormir(1600);
  await api('/api/avisos?seleccion=si', 'POST');

  /* Con el receptor caído la partida se tiene que aceptar igual. */
  await new Promise((r) => receptor.close(r));
  falso.estado.fase = 'Matchmaking'; falso.estado.readyCheck = null;
  await dormir(700);
  const antes = falso.estado.aceptaciones;
  falso.saltarPartida();
  await dormir(2500);
  ok('si el aviso falla, la partida se acepta igual', falso.estado.aceptaciones === antes + 1,
     `antes=${antes} ahora=${falso.estado.aceptaciones}`);

  /* El cliente se cierra */
  await falso.cerrar();
  await dormir(2500);
  e = await api('/api/estado');
  ok('si el cliente se cierra, la app sigue viva y lo dice',
     e.fase === 'sin cliente' || e.bitacora?.some((l) => l.tipo === 'error'), JSON.stringify(e.fase));
  ok('la app no se cayó', app.exitCode === null);
} finally {
  try { receptor.close(); } catch {}
  app.kill('SIGTERM');
  await dormir(400);
  app.kill('SIGKILL');
}

console.log(`\n${total - fallos}/${total} pruebas de punta a punta pasaron`);
if (fallos) console.log('\n--- salida de la app ---\n' + salida.slice(-1500));
process.exit(fallos ? 1 : 0);
