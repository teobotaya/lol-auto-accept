/* Prueba de punta a punta de la aplicación entera: se levanta el LCU falso, se
   arranca la app como la arrancaría el usuario y se la maneja desde su propia
   API HTTP, igual que hace el panel. */
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { servidorFalso } from './servidor-falso.mjs';

/* Los ajustes de la prueba van a una carpeta descartable: correr el test no
   puede pisarte el canal de avisos ni el retardo que tengas configurados. */
const CARPETA_AJUSTES = mkdtempSync(join(tmpdir(), 'ajustes-'));
/* Buscar al cliente cada segundo y no cada cinco: la prueba de reconexión
   cierra el LCU falso y abre otro, y no tiene por qué esperar como un humano. */
writeFileSync(join(CARPETA_AJUSTES, 'ajustes.json'), JSON.stringify({ reintentoMs: 1000 }));

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
  env: { ...process.env, LOCKFILE: lockfile, PUERTO_PANEL: String(PANEL), SIN_NAVEGADOR: '1', CARPETA_AJUSTES },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let salida = '';
app.stdout.on('data', (c) => { salida += c; });
app.stderr.on('data', (c) => { salida += c; });

/* Como el panel: todo POST lleva la cabecera propia. */
const api = async (ruta, metodo = 'GET') => {
  const r = await fetch(`http://127.0.0.1:${PANEL}${ruta}`,
    { method: metodo, headers: metodo === 'POST' ? { 'x-auto-accept': '1' } : {} });
  return r.json();
};
/* Un pedido crudo, para poder mentir en el Host como lo haría un navegador
   engañado por DNS rebinding. fetch no deja tocar esa cabecera. */
const crudo = (opciones) => new Promise((resolver, rechazar) => {
  const req = request({ host: '127.0.0.1', port: PANEL, ...opciones }, (res) => {
    let cuerpo = ''; res.setEncoding('utf8');
    res.on('data', (c) => { cuerpo += c; });
    res.on('end', () => resolver({ codigo: res.statusCode, cabeceras: res.headers, cuerpo }));
  });
  req.on('error', rechazar);
  req.end();
});

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

  /* Otra página abierta en la Mac no puede tocar el panel. */
  const sinCabecera = await fetch(`http://127.0.0.1:${PANEL}/api/pausa`, { method: 'POST' });
  e = await api('/api/estado');
  ok('un POST sin la cabecera propia se rechaza (CSRF)',
     sinCabecera.status === 403 && e.ajustes.activo === true, `status=${sinCabecera.status}`);
  const rebind = await crudo({ path: '/api/estado', headers: { host: 'malo.example:8123' } });
  ok('un Host ajeno se rechaza aunque llegue por 127.0.0.1 (DNS rebinding)', rebind.codigo === 403, String(rebind.codigo));
  const carpeta = await crudo({ path: '/.', headers: { host: '127.0.0.1' } });
  ok('pedir una ruta rara no tira abajo la app', carpeta.codigo === 404 || carpeta.codigo === 200, String(carpeta.codigo));

  /* "Aceptar ya" desde el panel: en pausa es la única forma de aceptar. */
  await api('/api/pausa', 'POST');
  falso.estado.fase = 'Matchmaking'; falso.estado.readyCheck = null;
  await dormir(700);
  const antesYa = falso.estado.aceptaciones;
  falso.saltarPartida();
  await dormir(700);
  e = await api('/api/estado');
  ok('en pausa, el panel muestra el ready check con lo que queda',
     e.fase === 'ReadyCheck' && e.respondido === false && e.restante >= 9 && e.restante <= 12,
     JSON.stringify({ fase: e.fase, respondido: e.respondido, restante: e.restante }));
  const ya = await api('/api/aceptar', 'POST');
  await dormir(300);
  ok('y el botón "Aceptar ya" la acepta', ya.aceptado === true && falso.estado.aceptaciones === antesYa + 1,
     JSON.stringify(ya));
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
  const antesCancelar = falso.estado.aceptaciones;
  falso.saltarPartida();
  await dormir(900);
  const c = await api('/api/cancelar', 'POST');
  ok('el botón de cancelar corta la aceptación', c.cancelado === true, JSON.stringify(c));
  await dormir(3200);
  ok('y después de cancelar no acepta igual', falso.estado.aceptaciones === antesCancelar,
     `aceptaciones=${falso.estado.aceptaciones}`);

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
     cuerpo.evento === 'aceptada' && cuerpo.aceptadas === falso.estado.aceptaciones, JSON.stringify(cuerpo));

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

  /* Elegir el pick desde el panel, como desde el teléfono. */
  const camp = await api('/api/campeones?tipo=pick');
  ok('el panel lista los campeones que se pueden elegir',
     camp.campeones?.length === 5 && camp.campeones.every((c) => c.id && c.nombre), JSON.stringify(camp.campeones));
  const icono = await fetch(`http://127.0.0.1:${PANEL}/api/icono/51`);
  const bytes = Buffer.from(await icono.arrayBuffer());
  ok('y sirve los íconos que tiene el cliente, como PNG',
     icono.status === 200 && icono.headers.get('content-type') === 'image/png' && bytes.subarray(1, 4).toString() === 'PNG',
     `${icono.status} ${icono.headers.get('content-type')}`);
  ok('un ícono con un id raro no llega al cliente',
     (await fetch(`http://127.0.0.1:${PANEL}/api/icono/..%2F..%2Fx`)).status === 404);
  /* Ya pasó la planificación y no es mi turno: el plan se guarda y espera. */
  const plan = await api('/api/plan?tipo=pick&campeon=51', 'POST');
  ok('planear el pick fuera de tu turno lo guarda sin tocar el cliente',
     plan.ok && plan.plan.pick?.id === 51 && falso.estado.marcas.length === 0, JSON.stringify(falso.estado.marcas));
  e = await api('/api/estado');
  ok('el estado trae el plan para pintar la casilla', e.plan?.pick?.nombre === 'Caitlyn', JSON.stringify(e.plan));
  const temprano = await api('/api/fijar?tipo=pick', 'POST');
  ok('fijar sin que sea tu turno no hace nada', temprano.ok === false, JSON.stringify(temprano));
  falso.estado.seleccion.actions.flat().find((a) => a.id === 204).isInProgress = true;
  await dormir(1300);
  ok('cuando te toca, la app lo marca sola en el cliente',
     falso.estado.marcas.some((m) => m.accion === 204 && m.championId === 51 && !m.completed),
     JSON.stringify(falso.estado.marcas));
  const fijado = await api('/api/fijar?tipo=pick', 'POST');
  ok('en tu turno, "Fijar" lo bloquea', fijado.ok && fijado.campeon === 'Caitlyn' &&
     falso.estado.marcas.at(-1).completed === true, JSON.stringify(fijado));
  await dormir(300);
  const conRecientes = await api('/api/campeones?tipo=pick');
  ok('y queda primero entre los recientes', conRecientes.recientes?.[0] === 51, JSON.stringify(conRecientes.recientes));
  ok('ningún POST de selección pasa sin la cabecera propia',
     (await fetch(`http://127.0.0.1:${PANEL}/api/fijar?tipo=pick`, { method: 'POST' })).status === 403);
  falso.caerse();
  await dormir(1600);
  await api('/api/avisos?seleccion=si', 'POST');

  /* Cambiar de canal no puede arrastrar el destino del anterior: un token de
     Pushcut no es un tema de ntfy, y mandarlo igual sería postear tu secreto a
     otro servicio y quedarte sin avisos sin enterarte. */
  const aNtfy = await api('/api/avisos?canal=ntfy', 'POST');
  ok('cambiar de canal no hereda el destino del anterior',
     aNtfy.canal === 'ntfy' && !aNtfy.destinoVisible, JSON.stringify(aNtfy));
  const vuelta = await api(`/api/avisos?canal=webhook&destino=${destino}`, 'POST');
  ok('y volver a configurar el canal anda', vuelta.canal === 'webhook' && !!vuelta.destinoVisible,
     JSON.stringify(vuelta));
  ok('la respuesta nunca devuelve el destino en claro', vuelta.destino === undefined, JSON.stringify(vuelta));

  /* Antes /api/estado y /api/ajustes devolvían la configuración entera, con el
     destino adentro: el token de Pushcut a la vista de cualquiera que mirara. */
  const estadoTxt = JSON.stringify(await api('/api/estado'));
  const ajustesTxt = JSON.stringify(await api('/api/ajustes?retardoMs=200', 'POST'));
  ok('ni el estado ni los ajustes dejan ver el destino de los avisos',
     !estadoTxt.includes(`${puertoAviso}/telefono`) && !ajustesTxt.includes(`${puertoAviso}/telefono`),
     estadoTxt.slice(0, 200));

  /* El panel en el teléfono. Se prueba de verdad: se pide por la IP de la red
     y no por 127.0.0.1, que es exactamente lo que haría el iPhone. */
  const rem = await api('/api/remoto?activo=si', 'POST');
  await dormir(400);
  const porIp = rem.enlaces?.find((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x.etiqueta));
  ok('abrir el panel a la red da un enlace con llave', rem.activo === true && /llave=[\w-]{16,}/.test(rem.enlaces?.[0]?.url ?? ''),
     JSON.stringify(rem).replace(/llave=[\w-]+/g, 'llave=…'));
  ok('el estado ya no deja ver la llave', !JSON.stringify(await api('/api/estado')).includes(new URL(rem.enlaces?.[0]?.url ?? 'http://x').searchParams.get('llave') ?? '###'));
  if (porIp) {
    const base = porIp.base.replace(/\/$/, '');
    const llave = new URL(porIp.url).searchParams.get('llave');
    const sinLlave = await fetch(`${base}/api/estado`);
    ok('desde la red, sin llave no se ve nada', sinLlave.status === 401, String(sinLlave.status));
    const conLlave = await fetch(`${base}/?llave=${llave}`, { redirect: 'manual' });
    const galleta = conLlave.headers.get('set-cookie') ?? '';
    ok('con la llave deja una cookie y limpia la URL',
       conLlave.status === 302 && conLlave.headers.get('location') === '/' && /HttpOnly/.test(galleta),
       `${conLlave.status} ${conLlave.headers.get('location')}`);
    const cookie = galleta.split(';')[0];
    const remotoEstado = await fetch(`${base}/api/estado`, { headers: { cookie } }).then((r) => r.json());
    ok('y con la cookie el teléfono ve el estado', remotoEstado.conectado === true && remotoEstado.local === false,
       JSON.stringify({ c: remotoEstado.conectado, l: remotoEstado.local }));
    const tocar = await fetch(`${base}/api/avisos?canal=ninguno`, { method: 'POST', headers: { cookie, 'x-auto-accept': '1' } });
    ok('pero los ajustes no se tocan desde el teléfono', tocar.status === 403, String(tocar.status));
    const desdeTel = await fetch(`${base}/api/fijar?tipo=pick`, { method: 'POST', headers: { cookie, 'x-auto-accept': '1' } });
    const cuerpoTel = await desdeTel.json();
    ok('elegir y fijar campeón sí se puede desde el teléfono',
       desdeTel.status === 200 && /selección/.test(cuerpoTel.detalle ?? ''), JSON.stringify(cuerpoTel));
    const otra = await fetch(`${base}/api/estado`, { headers: { cookie: 'aa_llave=una-llave-cualquiera-de-24' } });
    ok('una llave inventada no entra', otra.status === 401, String(otra.status));

    await api('/api/remoto?rotar=si', 'POST');
    await dormir(200);
    const vieja = await fetch(`${base}/api/estado`, { headers: { cookie } });
    ok('cambiar la llave deja afuera al teléfono que tenía la vieja', vieja.status === 401, String(vieja.status));

    await api('/api/remoto?activo=no', 'POST');
    await dormir(400);
    let cerrado = false;
    try { await fetch(`${base}/api/estado`, { signal: AbortSignal.timeout(1500) }); } catch { cerrado = true; }
    ok('al cerrarlo, la red ya no llega al panel', cerrado);
    ok('y desde la Mac sigue andando', (await api('/api/estado')).conectado === true);
  } else {
    console.log('  (sin red local en esta máquina: se saltean las pruebas del panel por IP)');
    await api('/api/remoto?activo=no', 'POST');
    await dormir(400);
  }

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

  /* El cliente vuelve, como vuelve League: con otro puerto y otra clave, y el
     lockfile reescrito en el mismo lugar. Antes la app seguía golpeando el
     puerto viejo para siempre y había que reiniciarla. */
  const aceptadasAntes = (await api('/api/estado')).cuenta?.aceptadas ?? 0;
  await dormir(6000);
  e = await api('/api/estado');
  ok('con el cliente cerrado, el panel lo dice sin llenar la bitácora',
     e.conectado === false && e.bitacora.filter((l) => l.tipo === 'error').length <= 2,
     JSON.stringify(e.bitacora.slice(0, 4).map((l) => l.texto)));
  const nuevo = servidorFalso({ clave: 'otra-clave-al-reabrir' });
  const puertoNuevo = await nuevo.escuchar();
  nuevo.lockfile(puertoNuevo, lockfile);
  await dormir(2500);
  e = await api('/api/estado');
  ok('cuando el cliente vuelve, se reconecta solo', e.conectado === true && e.fase === 'None',
     JSON.stringify({ conectado: e.conectado, fase: e.fase }));
  nuevo.encolar();
  await dormir(700);
  nuevo.saltarPartida();
  await dormir(1500);
  ok('y vuelve a aceptar partidas', nuevo.estado.aceptaciones === 1, `aceptaciones=${nuevo.estado.aceptaciones}`);
  e = await api('/api/estado');
  ok('sin perder la cuenta de las anteriores', e.cuenta?.aceptadas === aceptadasAntes + 1,
     `antes=${aceptadasAntes} ahora=${e.cuenta?.aceptadas}`);
  await nuevo.cerrar();
} finally {
  try { receptor.close(); } catch {}
  app.kill('SIGTERM');
  await dormir(400);
  app.kill('SIGKILL');
}

console.log(`\n${total - fallos}/${total} pruebas de punta a punta pasaron`);
if (fallos) console.log('\n--- salida de la app ---\n' + salida.slice(-1500));
process.exit(fallos ? 1 : 0);
