/* ---------------------------------------------------------------------------
   Un LCU falso, para poder probar de verdad sin tener League instalado.

   Reproduce lo que importa: el certificado autofirmado emitido por "Riot
   Games", la autenticación básica, la fase del gameflow y el ready-check con
   su contador de diez segundos. Con esto las pruebas ejercitan el mismo
   camino que en la máquina del usuario: descubrimiento, TLS, auth, sondeo,
   retardo y POST de aceptación.

   También reproduce la selección de campeones, que es la parte cara de simular:
   las acciones vienen agrupadas por turno, con la que está en curso marcada, y
   el reloj de la fase se publica en milisegundos. Sin esto no habría forma de
   verificar que "te toca pickear y quedan 9 segundos" sale cuando tiene que
   salir y una sola vez.
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


/* Un PNG de 1×1: para lo que importa, un ícono es un ícono. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==', 'base64');

/* Un puñado de campeones reales: los nombres salen del cliente, no de internet,
   así que el catálogo es parte de lo que hay que simular. */
export const CAMPEONES = [
  { id: -1, name: 'None' }, { id: 266, name: 'Aatrox' }, { id: 103, name: 'Ahri' },
  { id: 84, name: 'Akali' }, { id: 12, name: 'Alistar' }, { id: 32, name: 'Amumu' },
  { id: 22, name: 'Ashe' }, { id: 53, name: 'Blitzcrank' }, { id: 63, name: 'Brand' },
  { id: 201, name: 'Braum' }, { id: 51, name: 'Caitlyn' },
];

/* Mi equipo son las celdas 0 a 4; el rival, 5 a 9. La celda 2 es la mía y va
   de ADC, que es el caso del que arrancó todo esto. */
const MI_EQUIPO = [
  { cellId: 0, assignedPosition: 'top' },
  { cellId: 1, assignedPosition: 'jungle' },
  { cellId: 2, assignedPosition: 'bottom' },
  { cellId: 3, assignedPosition: 'middle' },
  { cellId: 4, assignedPosition: 'utility' },
];
const ORDEN_PICKS = [0, 5, 6, 1, 2, 7, 3, 4, 8, 9];
const BANEOS = [266, 103, 84, 12, 32];
const PICKS = [22, 53, 63, 201, 51, 266, 103, 84, 12, 32];

/* turno: null | 'ban' | 'pick'. hechos: cuántos picks ya se completaron.
   ronda: qué número de ronda de baneos es (los modos de torneo tienen dos, y
   la segunda trae acciones con otros ids). simultaneo: blind y ARAM, donde los
   cinco pickean a la vez. Con eso alcanza para armar cualquier momento de la
   selección que importe. */
export function sesionSeleccion({ yo = 2, segundos = 27, turno = null, hechos = 0,
                                  infinito = false, ronda = 1, simultaneo = false,
                                  msCrudos = null, fase = 'BAN_PICK' } = {}) {
  const enBanes = turno === 'ban';
  const bans = MI_EQUIPO.map((j, i) => ({
    id: 100 + (ronda - 1) * 10 + i, actorCellId: j.cellId, championId: enBanes ? 0 : BANEOS[i],
    type: 'ban', completed: !enBanes, isInProgress: enBanes, isAllyAction: true,
  }));

  /* Si me toca pickear, todo lo anterior en el orden ya está hecho. */
  const miIndice = ORDEN_PICKS.indexOf(yo);
  const completadosHasta = turno === 'pick' ? miIndice : hechos;
  const picks = ORDEN_PICKS.map((celda, i) => ({
    id: 200 + i, actorCellId: celda,
    championId: i < completadosHasta ? PICKS[i] : 0,
    type: 'pick', completed: i < completadosHasta,
    isInProgress: simultaneo ? true : (turno === 'pick' && i === miIndice),
    isAllyAction: celda < 5,
  }));

  const elegido = new Map(picks.filter((a) => a.completed).map((a) => [a.actorCellId, a.championId]));
  return {
    localPlayerCellId: yo,
    timer: {
      adjustedTimeLeftInPhase: msCrudos ?? Math.round(segundos * 1000),
      totalTimeInPhase: 30000,
      phase: fase,
      isInfinite: infinito,
    },
    myTeam: MI_EQUIPO.map((j) => ({ ...j, championId: elegido.get(j.cellId) ?? 0, championPickIntent: 0, summonerId: 1000 + j.cellId })),
    theirTeam: [5, 6, 7, 8, 9].map((cellId) => ({ cellId, championId: elegido.get(cellId) ?? 0, assignedPosition: '' })),
    /* Agrupadas por turno, como las manda el cliente de verdad. */
    actions: [bans, ...picks.map((a) => [a])],
  };
}

/* El timer del ready check, como en el cliente real: los segundos que pasaron
   desde que saltó la partida, de 0 a 12. */
export function servidorFalso({ clave = 'clave-de-prueba' } = {}) {
  const { key, cert, dir } = certificadoFalso();
  const est = {
    fase: 'None',
    readyCheck: null,
    aceptaciones: 0,
    pedidos: [],
    fallarAceptar: false,
    seleccion: null,
    marcas: [],
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

    /* Sin selección en curso el cliente responde 404, no un objeto vacío. */
    if (req.url === '/lol-champ-select/v1/session') {
      if (!est.seleccion) return responder(404, { httpStatus: 404, message: 'No active delegate' });
      return responder(200, est.seleccion);
    }
    if (req.url === '/lol-game-data/assets/v1/champion-summary.json') return responder(200, CAMPEONES);

    /* Lo que se puede elegir o banear: todo el catálogo menos lo que ya está
       tomado. est.sinTener simula campeones que el jugador no compró. */
    if (req.url === '/lol-champ-select/v1/pickable-champion-ids' || req.url === '/lol-champ-select/v1/bannable-champion-ids') {
      if (!est.seleccion) return responder(404, { message: 'No active delegate' });
      const tomados = new Set(est.seleccion.actions.flat().filter((a) => a.completed).map((a) => a.championId));
      const pick = req.url.includes('pickable');
      return responder(200, CAMPEONES.map((c) => c.id)
        .filter((id) => id > 0 && !tomados.has(id) && !(pick && est.sinTener?.includes(id))));
    }
    const icono = /^\/lol-game-data\/assets\/v1\/champion-icons\/(-?\d+)\.png$/.exec(req.url);
    if (icono) {
      /* est.iconos permite mostrar caras de verdad en una demo; sin eso, un
         PNG de un píxel alcanza para las pruebas. */
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(est.iconos?.get(Number(icono[1])) ?? PNG);
    }

    /* Marcar o fijar, como lo hace la interfaz de League: PATCH a la acción
       con { championId, completed }. Rechaza lo que rechazaría el cliente:
       una acción que no es tuya y un campeón tomado. */
    const accion = /^\/lol-champ-select\/v1\/session\/actions\/(\d+)$/.exec(req.url);
    if (req.method === 'PATCH' && accion) {
      let cuerpo = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { cuerpo += c; });
      req.on('end', () => {
        const a = est.seleccion?.actions.flat().find((x) => x.id === Number(accion[1]));
        if (!a) return responder(404, { message: 'no existe esa acción' });
        if (a.actorCellId !== est.seleccion.localPlayerCellId) return responder(400, { message: 'no es tu acción' });
        const { championId, completed } = JSON.parse(cuerpo || '{}');
        const tomado = est.seleccion.actions.flat().some((x) => x.completed && x.championId === championId);
        if (tomado) return responder(400, { message: 'campeón no disponible' });
        if (completed && !a.isInProgress) return responder(400, { message: 'todavía no es tu turno' });
        est.marcas.push({ accion: a.id, championId, completed: !!completed });
        a.championId = championId;
        if (completed) { a.completed = true; a.isInProgress = false; }
        const jugador = est.seleccion.myTeam.find((j) => j.cellId === a.actorCellId);
        if (a.type === 'pick' && jugador) {
          if (completed) jugador.championId = championId; else jugador.championPickIntent = championId;
        }
        responder(204, null);
      });
      return;
    }

    if (req.url === '/lol-matchmaking/v1/ready-check') {
      if (!est.readyCheck) return responder(404, { httpStatus: 404, message: 'Not attached to a ready check' });
      return responder(200, { ...est.readyCheck, timer: (Date.now() - est.readyCheckDesde) / 1000 });
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
      est.readyCheckDesde = Date.now();
      est.readyCheck = { state: 'InProgress', playerResponse: 'None', timer: 0, declinerIds: [] };
    },
    caerse() { est.fase = 'Matchmaking'; est.readyCheck = null; est.seleccion = null; },
    /* La selección: entrar, que cambie el turno y que arranque la partida. */
    entrarSeleccion(opciones) {
      est.fase = 'ChampSelect';
      est.seleccion = sesionSeleccion(opciones);
      return est.seleccion;
    },
    empezarPartida() { est.fase = 'InProgress'; est.seleccion = null; },
    /* El cliente baja la sesión un instante antes de cambiar de fase: sigue
       diciendo ChampSelect y la sesión ya responde 404. */
    soltarSesion() { est.seleccion = null; },
    /* `ruta` permite que un cliente "reiniciado" escriba su lockfile donde
       estaba el del anterior, como hace League al volver a abrirse. */
    lockfile(puerto, ruta = join(dir, 'lockfile')) {
      writeFileSync(ruta, `LeagueClient:4242:${puerto}:${clave}:https`);
      return ruta;
    },
  };
}
