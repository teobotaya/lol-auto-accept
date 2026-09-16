/* ---------------------------------------------------------------------------
   Cliente del LCU.

   El cliente de League expone una API REST en https://127.0.0.1:<puerto> con
   autenticación básica: usuario "riot", contraseña la del lockfile. El
   certificado es autofirmado por Riot, así que la verificación normal falla.

   La salida fácil es apagar la verificación de TLS. Acá no se hace eso: se
   apaga la cadena de confianza —imposible de validar sin el PEM de Riot— pero
   se comprueba que el certificado sea el que tiene que ser. Contra 127.0.0.1
   el riesgo real es bajo, pero "es local" no es una razón para no verificar.
   --------------------------------------------------------------------------- */
import { request } from 'node:https';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const EMISOR_ESPERADO = /riot games|riotgames/i;

export class Lcu {
  constructor({ puerto, clave, host = '127.0.0.1', pem } = {}) {
    this.puerto = puerto;
    this.host = host;
    this.autorizacion = 'Basic ' + Buffer.from(`riot:${clave}`).toString('base64');
    /* Si alguien deja el PEM de Riot al lado, se usa como ancla de confianza
       y la verificación pasa a ser completa. */
    const local = pem ?? join(import.meta.dirname, '..', 'riotgames.pem');
    this.ca = typeof local === 'string' && existsSync(local) ? readFileSync(local) : null;
    this.certificadoVisto = null;
  }

  pedir(metodo, ruta, cuerpo) {
    return new Promise((resolver, rechazar) => {
      const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
      const req = request({
        host: this.host, port: this.puerto, path: ruta, method: metodo,
        ca: this.ca ?? undefined,
        rejectUnauthorized: !!this.ca,
        headers: {
          authorization: this.autorizacion,
          accept: 'application/json',
          ...(datos ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(datos) } : {}),
        },
        timeout: 4000,
      }, (res) => {
        let txt = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { txt += c; });
        res.on('end', () => {
          let json = null;
          try { json = txt ? JSON.parse(txt) : null; } catch { json = txt; }
          if (res.statusCode >= 400) {
            const e = new Error(`${metodo} ${ruta} → ${res.statusCode}`);
            e.codigo = res.statusCode; e.cuerpo = json;
            return rechazar(e);
          }
          resolver(json);
        });
      });
      /* La comprobación del emisor va acá y no en checkServerIdentity porque
         Node solo llama a esa función cuando rejectUnauthorized es true: con la
         verificación de cadena apagada —que es lo que obliga un autofirmado sin
         el PEM— nunca se ejecutaba, y el código parecía verificar sin verificar.
         secureConnect sí corre siempre, antes de que llegue la respuesta. */
      req.on('socket', (socket) => {
        /* El agente reusa el socket entre pedidos: sin esta marca se acumulaba
           un listener por llamada sobre la misma conexión. */
        if (socket.__riotVerificado) return;
        const revisar = () => {
          socket.__riotVerificado = true;
          const cert = socket.getPeerCertificate?.();
          if (!cert || !Object.keys(cert).length) return;
          this.certificadoVisto = { emisor: cert.issuer?.O ?? cert.issuer?.CN, sujeto: cert.subject?.CN };
          const emisor = `${cert.issuer?.O ?? ''} ${cert.issuer?.CN ?? ''}`;
          if (!EMISOR_ESPERADO.test(emisor)) {
            req.destroy(new Error(`el certificado local no lo emitió Riot: "${emisor.trim() || 'sin emisor'}"`));
          }
        };
        if (socket.authorized !== undefined || socket.getPeerCertificate) {
          socket.once('secureConnect', revisar);
          if (!socket.connecting) revisar();
        }
      });
      req.on('timeout', () => req.destroy(new Error('el cliente no respondió en 4 s')));
      req.on('error', rechazar);
      if (datos) req.write(datos);
      req.end();
    });
  }

  /* La partida encontrada: state InProgress mientras corre el contador,
     playerResponse dice si ya respondí. */
  readyCheck() { return this.pedir('GET', '/lol-matchmaking/v1/ready-check'); }
  aceptar() { return this.pedir('POST', '/lol-matchmaking/v1/ready-check/accept'); }
  fase() { return this.pedir('GET', '/lol-gameflow/v1/gameflow-phase'); }
  yo() { return this.pedir('GET', '/lol-summoner/v1/current-summoner'); }

  /* La sesión de selección de campeones: acciones, equipos y el reloj. */
  champSelect() { return this.pedir('GET', '/lol-champ-select/v1/session'); }

  /* El catálogo de campeones lo sirve el propio cliente, así que los nombres
     no dependen de internet ni de Data Dragon: si League está abierto, están.
     Se pide una sola vez por sesión, que no cambia entre partidas. */
  async campeones() {
    if (this._campeones) return this._campeones;
    const lista = await this.pedir('GET', '/lol-game-data/assets/v1/champion-summary.json');
    this._campeones = new Map((lista ?? []).filter((c) => c.id > 0).map((c) => [c.id, c.name]));
    return this._campeones;
  }
}
