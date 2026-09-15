/* Pruebas. Las unitarias cubren el parseo de credenciales en los dos sistemas
   operativos con muestras reales; las de integración levantan un LCU falso y
   corren el vigía completo contra él, con TLS, auth y POST de verdad. */
import { leerLockfile, leerArgumentos, descubrir, RUTAS_LOCKFILE } from '../src/descubrir.mjs';
import { Lcu } from '../src/lcu.mjs';
import { Vigia } from '../src/vigia.mjs';
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
  const vigia = new Vigia(lcu, { retardoMs: 300, variacionMs: 50, ritmoLento: 120, ritmoRapido: 60 });
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

  /* El cliente se muere */
  vigia.parar();
  await falso.cerrar();
  const vigia2 = new Vigia(new Lcu({ puerto, clave: falso.clave }), { ritmoLento: 80, ritmoRapido: 60 });
  const problemas = [];
  vigia2.on('problema', (p) => problemas.push(p));
  vigia2.arrancar();
  await dormir(300);
  vigia2.parar();
  ok('si el cliente no está, avisa en vez de morirse', problemas.length > 0 && vigia2.estado.fase === 'sin cliente',
     JSON.stringify(problemas[0]));
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
