#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   Arranque: descubre el cliente, levanta el vigía y sirve el panel local.

   El panel es una página en localhost y no una ventana nativa. Con eso la
   misma app corre igual en Windows y en macOS, sin Electron, sin compilar
   nada y sin un solo paquete instalado.
   --------------------------------------------------------------------------- */
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces, hostname } from 'node:os';
import { descubrir } from './descubrir.mjs';
import { Lcu } from './lcu.mjs';
import { Vigia } from './vigia.mjs';
import * as ajustes from './ajustes.mjs';
import { crearAvisador, CANALES, enmascarar, armarMensaje } from './avisos.mjs';

const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
                '.js': 'text/javascript; charset=utf-8' };

const config = ajustes.leer();
if (process.env.PUERTO_PANEL) config.puertoPanel = Number(process.env.PUERTO_PANEL);
let lcu = null;
let vigia = null;
/* Las cifras sobreviven a que el cliente se cierre y vuelva: el vigía nuevo
   hereda la cuenta del anterior. */
let cuenta = null;
let buscando = null;
/* conectar() tarda segundos —lanza PowerShell o ps, y después dos pedidos con
   4 s de límite—, bastante más que los 5 s del reintento. Sin esta marca dos
   intentos podían solaparse y dejar dos vigías vivos (cada partida aceptada
   dos veces, cada aviso duplicado) o, peor, un vigía con el cliente en null
   que no vuelve a aceptar nunca. */
let conectando = false;
/* Un lockfile que quedó de un cliente cerrado de golpe apunta a un puerto
   muerto, y se lo vuelve a encontrar en cada reintento: se cuenta una vez. */
let ultimoFallo = '';
const bitacora = [];
const avisador = crearAvisador(() => config.avisos, (t, x) => anotar(t, x),
  /* Los avisos de rutina llevan la dirección SIN la llave: pasan por los
     servidores de ntfy o Pushcut, y el teléfono ya la tiene en una cookie
     desde la primera vez que abrió el enlace completo. */
  { enlace: () => enlacesRemotos()[0]?.base ?? null });

const anotar = (tipo, texto) => {
  bitacora.unshift({ t: Date.now(), tipo, texto });
  bitacora.length = Math.min(bitacora.length, 60);
  console.log(`[${tipo}] ${texto}`);
};

async function conectar() {
  if (vigia || conectando) return !!vigia;
  conectando = true;
  try {
    return await intentarConectar();
  } finally {
    conectando = false;
  }
}

/* El cliente se arma en una variable local y recién al final se publica: si
   dos intentos se cruzaran, ninguno puede dejarle al otro un lcu a medio
   hacer. */
async function intentarConectar() {
  const cred = await descubrir();
  if (!cred) return false;
  const cliente = new Lcu(cred);
  /* La prueba de vida es la fase del gameflow, que es lo que el vigía necesita.
     Antes era el nombre de invocador, y eso hacía que la app se negara a
     arrancar con el cliente abierto pero sin sesión iniciada —la pantalla de
     login responde 404 ahí— que es exactamente cuando uno la deja lista. */
  try {
    await cliente.fase();
  } catch (e) {
    if (e.message !== ultimoFallo) anotar('aviso', `encontré el cliente pero no pude hablarle: ${e.message}`);
    ultimoFallo = e.message;
    return false;
  }
  ultimoFallo = '';
  /* El saludo es un adorno: si falla, no pasa nada. */
  let quien = '';
  try {
    const yo = await cliente.yo();
    if (yo?.gameName) quien = ` · ${yo.gameName}#${yo.tagLine}`;
  } catch {}
  anotar('ok', `conectado al cliente por ${cred.origen}, puerto ${cred.puerto}${quien}`);
  lcu = cliente;
  vigia = new Vigia(cliente, config, { cuenta });
  cuenta = vigia.cuenta;
  vigia.on('aceptando', ({ enMs }) => anotar('cola', `partida encontrada, acepto en ${enMs} ms`));
  vigia.on('aceptado', ({ tras, aMano }) => {
    anotar('ok', aMano ? 'aceptada a mano desde el panel' : `aceptada tras ${tras} ms`);
    /* Sin await: si el aviso tarda o falla, la partida ya está aceptada igual. */
    avisador.avisar('aceptada', { tras, aMano, aceptadas: vigia?.cuenta.aceptadas ?? 0 });
  });
  /* Con la app activa, "partida aceptada" sale un segundo y medio después y
     alcanza. En pausa, este es el único aviso que dice que hay que correr. */
  vigia.on('encontrada', ({ activo, restante }) => {
    if (activo) return;
    anotar('cola', 'saltó la partida y estoy en pausa: no la acepto');
    avisador.avisar('encontrada', { restante });
  });
  vigia.on('cancelado', ({ motivo }) => anotar('aviso', `no acepté: ${motivo}`));
  /* La selección de campeones: el vigía decide CUÁNDO hay algo que contar y
     acá se lo cuenta al teléfono. Un momento, un aviso, una vez por partida. */
  vigia.on('momento', ({ momento, datos }) => {
    const m = armarMensaje(momento, datos);
    anotar(momento === 'cayo' ? 'aviso' : 'cola', `${m.titulo}: ${m.texto}`);
    avisador.avisar(momento, datos);
  });
  vigia.on('problema', ({ mensaje }) => anotar('error', mensaje));
  /* El cliente se cerró, o se reinició con otro puerto y otra contraseña: el
     vigía ya no le puede hablar. Se lo suelta y se vuelve a buscar desde cero,
     igual que al arrancar. */
  vigia.on('perdido', () => {
    vigia = null;
    lcu = null;
    anotar('aviso', 'el cliente de League se cerró; cuando vuelva me reconecto solo');
    insistir();
  });
  vigia.arrancar();
  return true;
}

/* El cliente puede no estar abierto todavía, o cerrarse y volver. Reintentar
   en silencio es mejor que pedirle al usuario que reinicie la app. */
async function insistir() {
  if (buscando) return;
  if (await conectar()) return;
  anotar('aviso', `no encuentro el cliente de League; sigo mirando cada ${Math.round(config.reintentoMs / 1000)} s`);
  buscando = setInterval(async () => {
    if (vigia || await conectar()) { clearInterval(buscando); buscando = null; }
  }, config.reintentoMs);
}

/* ------------------------------------------------------------ el panel
   Lo que se puede mostrar de los ajustes. El destino de los avisos y la llave
   del panel remoto quedan afuera: antes /api/estado devolvía la configuración
   entera, token de Pushcut incluido, y eso contradecía todo el cuidado que el
   resto del código pone en no mostrarlo. */
const publicos = (a) => ({
  retardoMs: a.retardoMs, variacionMs: a.variacionMs, activo: a.activo,
  avisarUltimos: a.avisarUltimos, puertoPanel: config.puertoPanel,
});

/* ---------------------------------------------- el panel en el teléfono
   Apagado, el panel escucha solo en 127.0.0.1. Encendido, escucha en la red
   de la casa, y cualquier pedido que no venga de la propia Mac tiene que traer
   la llave: una vez en el enlace y, desde ahí, en una cookie. */
const LOCALES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const HOST_LOCAL = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
const COOKIE = 'aa_llave';

function enlacesRemotos() {
  if (!config.remoto.activo) return [];
  const puerto = config.puertoPanel;
  const llave = config.remoto.llave;
  /* La IP de la red de la casa, y el nombre .local de la Mac, que el iPhone
     resuelve por Bonjour y no cambia cuando el router reparte otra IP. */
  const ips = Object.values(networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal && /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(i.address))
    .map((i) => i.address);
  const nombre = hostname().endsWith('.local') ? hostname() : null;
  return [...(nombre ? [nombre] : []), ...ips].map((h) => ({
    etiqueta: h, base: `http://${h}:${puerto}/`, url: `http://${h}:${puerto}/?llave=${llave}`,
  }));
}

const mismaLlave = (dada) => {
  const a = Buffer.from(String(dada ?? '')), b = Buffer.from(config.remoto.llave);
  return b.length > 0 && a.length === b.length && timingSafeEqual(a, b);
};
const leerCookie = (req) => (req.headers.cookie ?? '').split(/;\s*/)
  .map((c) => c.split('=')).find(([k]) => k === COOKIE)?.[1];

/* Devuelve null si el pedido pasa, o la respuesta que hay que darle si no. */
function puerta(req, res, url) {
  const local = LOCALES.has(req.socket.remoteAddress);
  if (local) {
    /* DNS rebinding: una página cualquiera puede hacer que su dominio apunte a
       127.0.0.1 y hablarle al panel como si fuera propia. El Host delata el
       truco, porque el navegador manda el nombre del sitio y no la IP. */
    const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
    /* El nombre .local de la propia Mac también vale: en la Mac resuelve a
       127.0.0.1, y una página ajena no puede adueñarse de ese nombre. */
    if (!HOST_LOCAL.test(req.headers.host ?? '') && host !== hostname().toLowerCase()) {
      return () => json(res, { error: 'host no permitido' }, 403);
    }
  } else {
    if (!config.remoto.activo) return () => json(res, { error: 'el panel no está abierto a la red' }, 403);
    const enUrl = url.searchParams.get('llave');
    if (enUrl !== null && mismaLlave(enUrl)) {
      /* La llave pasa una vez por la URL y queda en una cookie. Se redirige a
         la dirección limpia para que no quede en el historial ni en la barra. */
      url.searchParams.delete('llave');
      return () => {
        res.writeHead(302, {
          'set-cookie': `${COOKIE}=${config.remoto.llave}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax`,
          location: url.pathname + url.search,
        });
        res.end();
      };
    }
    if (!mismaLlave(leerCookie(req))) {
      return () => {
        res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Auto Accept</title><body style="font:16px/1.5 -apple-system,sans-serif;background:#0A0E14;color:#EAF2F8;padding:32px">
<h1 style="font-size:20px">Falta la llave</h1><p>Abrí el enlace completo que aparece en el panel de la Mac, en
<i>Ver desde el teléfono</i>. Si cambiaste la llave, el enlace viejo deja de andar.</p>`);
      };
    }
  }
  /* CSRF: sin esto, cualquier página abierta en la Mac podía mandar un POST
     simple a 127.0.0.1 —pausar, o cambiar el destino de tus avisos por uno
     suyo— y el navegador lo dejaba salir. Una cabecera propia obliga al
     navegador a preguntar antes (preflight), y este servidor nunca dice que sí. */
  if (req.method === 'POST' && req.headers['x-auto-accept'] !== '1') {
    return () => json(res, { error: 'falta la cabecera x-auto-accept' }, 403);
  }
  return null;
}

const json = (res, cuerpo, codigo = 200) => {
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(cuerpo));
};

const servidor = createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  const rechazo = puerta(req, res, url);
  if (rechazo) return rechazo();
  const local = LOCALES.has(req.socket.remoteAddress);

  if (url.pathname === '/api/estado') {
    const inst = vigia ? vigia.instantanea() : { fase: 'sin cliente', cuenta };
    return json(res, {
      conectado: !!vigia,
      local,
      remoto: config.remoto.activo,
      bitacora: bitacora.slice(0, 25),
      ...inst,
      ajustes: publicos(vigia ? vigia.ajustes : config),
    });
  }
  if (url.pathname === '/api/aceptar' && req.method === 'POST') {
    if (!vigia) return json(res, { aceptado: false, detalle: 'no hay cliente' });
    return vigia.aceptarYa().then(
      (aceptado) => json(res, { aceptado }),
      (e) => json(res, { aceptado: false, detalle: e.message }));
  }
  /* Lo que sigue configura la Mac: solo desde la Mac. El teléfono mira, pausa,
     acepta y cancela; no cambia a dónde van los avisos ni abre la red. */
  if (!local && /^\/api\/(avisos|probar-aviso|ajustes|remoto|canales)/.test(url.pathname)) {
    return json(res, { error: 'esto se cambia desde la Mac' }, 403);
  }
  if (url.pathname === '/api/remoto' && req.method === 'GET') {
    return json(res, { activo: config.remoto.activo, enlaces: enlacesRemotos() });
  }
  if (url.pathname === '/api/remoto' && req.method === 'POST') {
    const pedido = url.searchParams.get('activo');
    const rotar = url.searchParams.get('rotar') === 'si';
    const activo = pedido === null ? config.remoto.activo : pedido === 'si';
    /* Cambiar la llave deja afuera a todo teléfono que tuviera la vieja. */
    const llave = rotar || !config.remoto.llave ? randomBytes(18).toString('base64url') : config.remoto.llave;
    const cambiaRed = activo !== config.remoto.activo;
    config.remoto = ajustes.sanear({ ...config, remoto: { activo, llave } }).remoto;
    ajustes.guardar(config);
    anotar('aviso', activo ? (rotar ? 'llave del panel remoto cambiada' : 'panel abierto al teléfono, en la red de la casa')
                           : 'panel cerrado a la red: solo desde esta Mac');
    json(res, { activo: config.remoto.activo, enlaces: enlacesRemotos() });
    if (cambiaRed) res.once('finish', escuchar);
    return;
  }
  if (url.pathname === '/api/remoto/mandar' && req.method === 'POST') {
    const enlace = enlacesRemotos()[0];
    if (!enlace) return json(res, { ok: false, detalle: 'primero abrí el panel a la red' });
    return avisador.mandarEnlace(enlace.url).then((r) => json(res, r));
  }
  if (url.pathname === '/api/pausa' && req.method === 'POST') {
    config.activo = !config.activo;
    if (vigia) vigia.ajustes.activo = config.activo;
    ajustes.guardar(config);
    anotar('aviso', config.activo ? 'activado' : 'en pausa');
    return json(res, { activo: config.activo });
  }
  if (url.pathname === '/api/cancelar' && req.method === 'POST') {
    return json(res, { cancelado: vigia ? vigia.cancelarAceptacion('lo cancelaste vos') : false });
  }
  if (url.pathname === '/api/canales') {
    return json(res, {
      canales: Object.entries(CANALES).map(([id, c]) => ({
        id, etiqueta: c.etiqueta, ayuda: c.ayuda,
        destinoRotulo: c.destinoRotulo ?? null,
        disponible: !c.soloEn || c.soloEn === process.platform,
      })),
      actual: { ...config.avisos, destino: undefined, destinoVisible: enmascarar(config.avisos.destino) },
    });
  }
  if (url.pathname === '/api/avisos' && req.method === 'POST') {
    const bandera = url.searchParams.get('seleccion');
    const canal = url.searchParams.get('canal') ?? config.avisos.canal;
    const escrito = url.searchParams.get('destino');
    /* Si cambiaste de canal y no escribiste un destino nuevo, el viejo NO se
       hereda: el token de Pushcut no es un tema de ntfy, y mandarlo igual
       significaba postear tu secreto a otro servicio y quedarte sin avisos sin
       enterarte. Vacío también sirve para borrar el destino guardado. */
    const destino = escrito !== null ? escrito
                  : canal === config.avisos.canal ? config.avisos.destino : '';
    const nuevo = ajustes.sanear({ ...config, avisos: {
      canal,
      destino,
      seleccion: bandera === null ? config.avisos.seleccion : bandera !== 'no',
    } });
    config.avisos = nuevo.avisos;
    ajustes.guardar(config);
    anotar('aviso', `avisos por ${config.avisos.canal}` +
      (config.avisos.destino ? ` → ${enmascarar(config.avisos.destino)}` : '') +
      (config.avisos.seleccion ? ' · también en selección' : ' · solo al aceptar'));
    /* El destino no vuelve en la respuesta: puede llevar un secreto adentro. */
    return json(res, { ...config.avisos, destino: undefined,
                       destinoVisible: enmascarar(config.avisos.destino) });
  }
  if (url.pathname === '/api/probar-aviso' && req.method === 'POST') {
    return avisador.probar().then((r) => json(res, r));
  }
  if (url.pathname === '/api/ajustes' && req.method === 'POST') {
    const nuevo = ajustes.sanear({
      ...config,
      retardoMs: url.searchParams.get('retardoMs') ?? config.retardoMs,
      variacionMs: url.searchParams.get('variacionMs') ?? config.variacionMs,
    });
    Object.assign(config, nuevo);
    if (vigia) Object.assign(vigia.ajustes, nuevo);
    ajustes.guardar(config);
    return json(res, publicos(config));
  }

  const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const base = join(import.meta.dirname, 'ui');
  const f = join(base, rel);
  if (!f.startsWith(base)) return json(res, { error: 'ruta inválida' }, 400);
  /* isFile y no existsSync: leer una carpeta tira EISDIR, y una excepción en
     el manejador tiraba abajo la app entera. */
  let esArchivo = false;
  try { esArchivo = statSync(f).isFile(); } catch {}
  if (esArchivo) {
    res.writeHead(200, { 'content-type': TIPOS[extname(f)] || 'application/octet-stream' });
    return res.end(readFileSync(f));
  }
  json(res, { error: 'no encontrado' }, 404);
});

/* Solo 127.0.0.1, salvo que abras el panel al teléfono a propósito. Cambiar
   eso con la app andando obliga a soltar el puerto y volver a tomarlo. */
let primeraVez = true;
function escuchar() {
  const host = config.remoto.activo ? '0.0.0.0' : '127.0.0.1';
  const tomar = () => servidor.listen(config.puertoPanel, host, () => {
    const direccion = `http://127.0.0.1:${config.puertoPanel}`;
    if (!primeraVez) return anotar('ok', config.remoto.activo ? 'el panel ya se ve desde la red' : 'el panel volvió a ser solo local');
    primeraVez = false;
    anotar('ok', `panel en ${direccion}` + (config.remoto.activo ? ' (y en la red de la casa)' : ''));
    if (!process.env.SIN_NAVEGADOR) {
      const abrir = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', direccion]]
                  : process.platform === 'darwin' ? ['open', [direccion]]
                  : ['xdg-open', [direccion]];
      execFile(abrir[0], abrir[1], () => {});
    }
    insistir();
  });
  if (!servidor.listening) return tomar();
  servidor.close(tomar);
  /* El panel pide el estado cada 700 ms con conexiones que quedan abiertas:
     sin cortarlas, close() esperaría a que se cansen. */
  servidor.closeAllConnections();
}
servidor.on('error', (e) => {
  anotar('error', e.code === 'EADDRINUSE'
    ? `el puerto ${config.puertoPanel} está ocupado: ¿ya hay otro Auto Accept abierto?`
    : `el panel no pudo arrancar: ${e.message}`);
  if (primeraVez) process.exitCode = 1;
});
escuchar();

for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => {
  anotar('aviso', 'cerrando');
  vigia?.parar();
  servidor.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
});
