/* ---------------------------------------------------------------------------
   Un LCU falso, para poder probar de verdad sin tener League instalado.

   Reproduce lo que importa: el certificado autofirmado emitido por "Riot
   Games", la autenticación básica, la fase del gameflow y el ready-check con
   su contador de diez segundos. Con esto las pruebas ejercitan el mismo
   camino que en la máquina del usuario: descubrimiento, TLS, auth, sondeo,
   retardo y POST de aceptación.
   --------------------------------------------------------------------------- */
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function certificadoFalso() {
  const dir = mkdtempSync(join(tmpdir(), 'lcu-'));
  const llave = join(dir, 'k.pem'), cert = join(dir, 'c.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', llave, '-out', cert, '-days', '2', '-subj',
    '/C=US/O=Riot Games, Inc./CN=rclient', '-addext', 'subjectAltName=IP:127.0.0.1'],
    { stdio: 'ignore' });
  return { key: readFileSync(llave), cert: readFileSync(cert), dir };
}

export function servidorFalso({ clave = 'clave-de-prueba', timerInicial = 10 } = {}) {
  const { key, cert, dir } = certificadoFalso();
  const est = {
    fase: 'None',
    readyCheck: null,
    aceptaciones: 0,
    pedidos: [],
    fallarAceptar: false,
  };

  const esperado = 'Basic ' + Buffer.from(`riot:${clave}`).toString('base64');

  const servidor = createServer({ key, cert }, (req, res) => {
    est.pedidos.push(`${req.method} ${req.url}`);
    const responder = (codigo, cuerpo) => {
      const t = JSON.stringify(cuerpo);
      res.writeHead(codigo, { 'content-type': 'application/json' });
      res.end(t);
    };
    if (req.headers.authorization !== esperado) return responder(401, { message: 'no autorizado' });

    if (req.url === '/lol-gameflow/v1/gameflow-phase') return responder(200, est.fase);

    /* Con sesión iniciada devuelve el invocador; sin sesión, 404, que es el
       caso que rompía la app. est.sinSesion lo reproduce. */
    if (req.url === '/lol-summoner/v1/current-summoner') {
      if (est.sinSesion) return responder(404, { message: 'no logueado' });
      return responder(200, { gameName: 'Teo', tagLine: 'LAS', summonerLevel: 210 });
    }

    if (req.url === '/lol-matchmaking/v1/ready-check') {
      if (!est.readyCheck) return responder(404, { httpStatus: 404, message: 'Not attached to a ready check' });
      return responder(200, est.readyCheck);
    }
    if (req.method === 'POST' && req.url === '/lol-matchmaking/v1/ready-check/accept') {
      if (est.fallarAceptar) return responder(500, { message: 'error simulado' });
      if (!est.readyCheck) return responder(404, { message: 'no hay ready check' });
      est.readyCheck.playerResponse = 'Accepted';
      est.aceptaciones++;
      est.fase = 'ChampSelect';
      return responder(200, null);
    }
    responder(404, { message: 'ruta desconocida' });
  });

  return {
    estado: est,
    dir,
    escuchar: () => new Promise((r) => servidor.listen(0, '127.0.0.1', () => r(servidor.address().port))),
    cerrar: () => new Promise((r) => servidor.close(r)),
    clave,
    /* Empuja el mundo: entrar en cola y que salte la partida. */
    encolar() { est.fase = 'Matchmaking'; est.readyCheck = null; },
    saltarPartida() {
      est.fase = 'ReadyCheck';
      est.readyCheck = { state: 'InProgress', playerResponse: 'None', timer: timerInicial, declinerIds: [] };
    },
    caerse() { est.fase = 'Matchmaking'; est.readyCheck = null; },
    lockfile(puerto) {
      const ruta = join(dir, 'lockfile');
      writeFileSync(ruta, `LeagueClient:4242:${puerto}:${clave}:https`);
      return ruta;
    },
  };
}
