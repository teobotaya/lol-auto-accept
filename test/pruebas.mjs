/* Pruebas. Las unitarias cubren el parseo de credenciales en los dos sistemas
   operativos con muestras reales; las de integración levantan un LCU falso y
   corren el vigía completo contra él, con TLS, auth y POST de verdad. */
import { leerLockfile, leerArgumentos, descubrir, RUTAS_LOCKFILE } from '../src/descubrir.mjs';
import { Lcu } from '../src/lcu.mjs';
import { Vigia, restanteReadyCheck } from '../src/vigia.mjs';
import { servidorFalso } from './servidor-falso.mjs';

let fallos = 0, total = 0;
const ok = (nombre, cond, detalle = '') => {
  total++;
  if (cond) console.log(`  ok    ${nombre}`);
  else { console.log(`  FALLA ${nombre}${detalle ? ' — ' + detalle : ''}`); fallos++; }
};
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('\ndescubrimiento de credenciales');
{
  const l = leerLockfile('LeagueClient:21308:52937:HgQ3nB7l_xm2:https');
  ok('lockfile: puerto y clave', l?.puerto === 52937 && l.clave === 'HgQ3nB7l_xm2');
  ok('lockfile: línea corta se rechaza', leerLockfile('LeagueClient:21308') === null);
  ok('lockfile: vacío se rechaza', leerLockfile('') === null);

  const win = '"C:\\Riot Games\\League of Legends\\LeagueClientUx.exe" "--riotclient-auth-token=abc" "--app-port=52937" "--remoting-auth-token=HgQ3nB7l_xm2" "--install-directory=C:\\Riot Games"';
  const w = leerArgumentos(win);
  ok('Windows: argumentos entre comillas', w?.puerto === 52937 && w.clave === 'HgQ3nB7l_xm2', JSON.stringify(w));

  const mac = '/Applications/League of Legends.app/Contents/LoL/../LeagueClientUx.app/Contents/MacOS/LeagueClientUx --app-port=49152 --remoting-auth-token=Zk-9_qQ --no-rads';
  const m = leerArgumentos(mac);
  ok('macOS: argumentos sin comillas', m?.puerto === 49152 && m.clave === 'Zk-9_qQ', JSON.stringify(m));

  /* La línea real de macOS trae también --riotclient-app-port, que es el
     puerto del Riot Client y no el del LCU. Confundirlos es hablarle al
     programa equivocado. (Muestra tomada de un cliente de verdad, LAS.) */
  const real = '/Applications/League of Legends.app/Contents/LoL/League of Legends.app/Contents/MacOS/LeagueClientUx --riotclient-auth-token=AAAA --riotclient-app-port=53298 --no-rads --disable-self-update --region=LA2 --locale=es_AR --remoting-auth-token=Zk-9_qQ --app-port=53509';
  const r = leerArgumentos(real);
  ok('macOS real: no confunde el puerto del Riot Client con el del LCU',
     r?.puerto === 53509 && r.clave === 'Zk-9_qQ', JSON.stringify(r));

  ok('no confunde el token del riot client con el del LCU',
     leerArgumentos('--riotclient-auth-token=NOOO --app-port=1 --remoting-auth-token=SI')?.clave === 'SI');
  ok('sin los dos datos no devuelve nada', leerArgumentos('--app-port=52937') === null);
  ok('rutas conocidas para los dos sistemas',
     RUTAS_LOCKFILE.win32.length > 0 && RUTAS_LOCKFILE.darwin.length > 0);
}

console.log('\nTLS y autenticación contra un LCU falso');
const falso = servidorFalso();
const puerto = await falso.escuchar();
{
  const lcu = new Lcu({ puerto, clave: falso.clave });
  ok('fase inicial legible', String(await lcu.fase()).includes('None'));
  ok('verificó que el certificado lo emitió Riot', /riot/i.test(lcu.certificadoVisto?.emisor ?? ''),
     JSON.stringify(lcu.certificadoVisto));

  const malo = new Lcu({ puerto, clave: 'clave-equivocada' });
  let err = null;
  try { await malo.fase(); } catch (e) { err = e; }
  ok('rechaza una clave equivocada con 401', err?.codigo === 401, String(err?.message));

  let err2 = null;
  try { await new Lcu({ puerto, clave: falso.clave }).readyCheck(); } catch (e) { err2 = e; }
  ok('sin ready check devuelve 404 y lo dice', err2?.codigo === 404, String(err2?.message));

  /* Un certificado que no sea de Riot tiene que rebotar: es la comprobación
     que reemplaza a apagar TLS del todo. */
  const { createServer } = await import('node:https');
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const d = mkdtempSync(join(tmpdir(), 'impostor-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(d, 'k'),
    '-out', join(d, 'c'), '-days', '2', '-subj', '/O=Impostor SA/CN=localhost'], { stdio: 'ignore' });
  const impostor = createServer({ key: readFileSync(join(d, 'k')), cert: readFileSync(join(d, 'c')) },
    (_, res) => { res.writeHead(200); res.end('"None"'); });
  const p2 = await new Promise((r) => impostor.listen(0, '127.0.0.1', () => r(impostor.address().port)));
  let err3 = null;
  try { await new Lcu({ puerto: p2, clave: 'x' }).fase(); } catch (e) { err3 = e; }
  ok('rechaza un certificado que no emitió Riot', /no lo emitió Riot/.test(String(err3?.message)), String(err3?.message));
  await new Promise((r) => impostor.close(r));
}

console.log('\nel vigía, de punta a punta');
{
  const lcu = new Lcu({ puerto, clave: falso.clave });
  const vigia = new Vigia(lcu, { retardoMs: 300, variacionMs: 50, ritmoLento: 120, ritmoRapido: 60, ritmoSeleccion: 60 });
  const eventos = [];
  for (const e of ['aceptando', 'aceptado', 'cancelado', 'problema']) vigia.on(e, (d) => eventos.push([e, d]));
  vigia.arrancar();

  await dormir(250);
  ok('fuera de cola no acepta nada', falso.estado.aceptaciones === 0 && !vigia.estado.enCola);

  falso.encolar();
  await dormir(250);
  ok('detecta que estoy en cola', vigia.estado.enCola === true, vigia.estado.fase);

  falso.saltarPartida();
  await dormir(200);
  ok('ve el ready check y programa la aceptación', vigia.estado.aceptando === true);
  ok('no aceptó todavía: el retardo existe', falso.estado.aceptaciones === 0);
  ok('avisa cuánto va a esperar', eventos.some(([n, d]) => n === 'aceptando' && d.enMs >= 250 && d.enMs <= 350),
     JSON.stringify(eventos.filter(([n]) => n === 'aceptando')));

  await dormir(500);
  ok('aceptó la partida', falso.estado.aceptaciones === 1, `aceptaciones=${falso.estado.aceptaciones}`);
  ok('el contador lo registra', vigia.cuenta.aceptadas === 1);
  ok('el POST fue al endpoint correcto',
     falso.estado.pedidos.includes('POST /lol-matchmaking/v1/ready-check/accept'));

  await dormir(200);
  ok('no acepta dos veces la misma partida', falso.estado.aceptaciones === 1);

  /* Cancelar a tiempo */
  falso.estado.fase = 'Matchmaking'; falso.estado.readyCheck = null;
  await dormir(200);
  falso.saltarPartida();
  await dormir(150);
  const cancelo = vigia.cancelarAceptacion('prueba');
  await dormir(500);
  ok('se puede cancelar antes de que acepte', cancelo === true && falso.estado.aceptaciones === 1,
     `aceptaciones=${falso.estado.aceptaciones}`);
  ok('la cancelación queda contada', vigia.cuenta.canceladas === 1);

  /* Pausado */
  falso.estado.fase = 'Matchmaking'; falso.estado.readyCheck = null; await dormir(200);
  vigia.ajustes.activo = false;
  falso.saltarPartida();
  await dormir(600);
  ok('en pausa no acepta', falso.estado.aceptaciones === 1, `aceptaciones=${falso.estado.aceptaciones}`);
  vigia.ajustes.activo = true;

  /* La partida se cae mientras esperaba */
  falso.estado.fase = 'Matchmaking'; falso.estado.readyCheck = null; await dormir(200);
  falso.saltarPartida(); await dormir(120);
  falso.caerse();
  await dormir(600);
  ok('si la partida se cae, no dispara un accept huérfano', falso.estado.aceptaciones === 1);

  /* Aceptar ya: el botón corta el retardo, no lo saltea a ciegas. */
  falso.estado.fase = 'Matchmaking'; falso.estado.readyCheck = null; await dormir(200);
  vigia.ajustes.retardoMs = 5000; vigia.ajustes.variacionMs = 0;
  const antesYa = falso.estado.aceptaciones;
  falso.saltarPartida();
  await dormir(150);
  const t0 = Date.now();
  const apuro = await vigia.aceptarYa();
  await dormir(150);
  ok('"aceptar ya" corta el retardo de 5 s', apuro === true && falso.estado.aceptaciones === antesYa + 1,
     `aceptaciones=${falso.estado.aceptaciones} en ${Date.now() - t0} ms`);
  const ultimo = eventos.filter(([n]) => n === 'aceptado').at(-1)?.[1];
  ok('y el aviso dice cuánto esperó de verdad, no los 5 s', ultimo?.tras < 1000, JSON.stringify(ultimo));
  vigia.ajustes.retardoMs = 300; vigia.ajustes.variacionMs = 50;

  /* En pausa, "aceptar ya" es la única forma de aceptar desde el panel. */
  const encontradas = [];
  vigia.on('encontrada', (d) => encontradas.push(d));
  falso.estado.fase = 'Matchmaking'; falso.estado.readyCheck = null; await dormir(200);
  vigia.ajustes.activo = false;
  falso.saltarPartida();
  await dormir(250);
  ok('en pausa avisa que saltó la partida, una sola vez',
     encontradas.length === 1 && encontradas[0].activo === false, JSON.stringify(encontradas));
  ok('el contador del ready check va para atrás: quedan casi 12 s',
     vigia.estado.restante >= 11 && vigia.estado.restante <= 12, String(vigia.estado.restante));
  const antesPausa = falso.estado.aceptaciones;
  await vigia.aceptarYa();
  ok('en pausa, "aceptar ya" acepta igual', falso.estado.aceptaciones === antesPausa + 1);
  await dormir(150);
  ok('y el vigía sabe que ya respondí', vigia.estado.respondido === true || vigia.estado.fase !== 'ReadyCheck');
  vigia.ajustes.activo = true;
  falso.estado.fase = 'Matchmaking'; falso.estado.readyCheck = null; await dormir(200);
  ok('fuera del ready check, "aceptar ya" no hace nada', (await vigia.aceptarYa()) === false);

  /* El cliente se muere */
  vigia.parar();
  await falso.cerrar();
  const vigia2 = new Vigia(new Lcu({ puerto, clave: falso.clave }), { ritmoLento: 80, ritmoRapido: 60 });
  const problemas = [];
  vigia2.on('problema', (p) => problemas.push(p));
  let perdido = 0;
  vigia2.on('perdido', () => perdido++);
  vigia2.arrancar();
  await dormir(500);
  ok('si el cliente no está, avisa en vez de morirse', problemas.length > 0 && vigia2.estado.fase === 'sin cliente',
     JSON.stringify(problemas[0]));
  /* Un cliente cerrado falla en cada sondeo: la bitácora tiene que decirlo
     una vez, no llenarse de la misma línea. */
  ok('el mismo error no se repite en cada sondeo', problemas.length === 1, `problemas=${problemas.length}`);
  /* Y al tercer fallo se retira: al volver, el cliente tiene otro puerto y
     otra clave, así que seguir sondeando este no sirve para nada. */
  ok('tras tres fallos seguidos se da por perdido y se detiene',
     perdido === 1 && vigia2.corriendo === false, `perdido=${perdido} corriendo=${vigia2.corriendo}`);
}

console.log('\nel contador del ready check');
{
  ok('recién saltada quedan 12 s', restanteReadyCheck({ timer: 0 }) === 12);
  ok('a los 3,4 s quedan 9 (redondea para arriba)', restanteReadyCheck({ timer: 3.4 }) === 9);
  ok('pasada la ventana no da negativo', restanteReadyCheck({ timer: 15 }) === 0);
  ok('sin timer, cero y no NaN', restanteReadyCheck({}) === 0 && restanteReadyCheck(null) === 0);
}

console.log('\ndescubrimiento por lockfile, con archivo real');
{
  const f2 = servidorFalso({ clave: 'otra-clave' });
  const p = await f2.escuchar();
  const ruta = f2.lockfile(p);
  const cred = await descubrir({ plataforma: 'darwin', rutas: [ruta] });
  ok('lee el lockfile del disco', cred?.puerto === p && cred.clave === 'otra-clave', JSON.stringify(cred));
  const lcu = new Lcu(cred);
  ok('y con eso habla con el cliente', String(await lcu.fase()).includes('None'));
  await f2.cerrar();
}

console.log('\ncliente abierto pero sin sesión iniciada');
{
  const f3 = servidorFalso();
  f3.estado.sinSesion = true;
  const p3 = await f3.escuchar();
  const lcu = new Lcu({ puerto: p3, clave: f3.clave });
  ok('la fase se lee igual sin login', String(await lcu.fase()).includes('None'));
  let e = null;
  try { await lcu.yo(); } catch (x) { e = x; }
  ok('el nombre de invocador da 404 sin login, y eso es normal', e?.codigo === 404);
  await f3.cerrar();
}

console.log(`\n${total - fallos}/${total} pruebas pasaron`);
process.exit(fallos ? 1 : 0);
