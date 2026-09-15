#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   Arranque: descubre el cliente, levanta el vigía y sirve el panel local.

   El panel es una página en localhost y no una ventana nativa. Con eso la
   misma app corre igual en Windows y en macOS, sin Electron, sin compilar
   nada y sin un solo paquete instalado.
   --------------------------------------------------------------------------- */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { descubrir } from './descubrir.mjs';
import { Lcu } from './lcu.mjs';
import { Vigia } from './vigia.mjs';
import * as ajustes from './ajustes.mjs';

const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
                '.js': 'text/javascript; charset=utf-8' };

const config = ajustes.leer();
if (process.env.PUERTO_PANEL) config.puertoPanel = Number(process.env.PUERTO_PANEL);
let lcu = null;
let vigia = null;
const bitacora = [];

const anotar = (tipo, texto) => {
  bitacora.unshift({ t: Date.now(), tipo, texto });
  bitacora.length = Math.min(bitacora.length, 60);
  console.log(`[${tipo}] ${texto}`);
};

async function conectar() {
  const cred = await descubrir();
  if (!cred) return false;
  lcu = new Lcu(cred);
  /* La prueba de vida es la fase del gameflow, que es lo que el vigía necesita.
     Antes era el nombre de invocador, y eso hacía que la app se negara a
     arrancar con el cliente abierto pero sin sesión iniciada —la pantalla de
     login responde 404 ahí— que es exactamente cuando uno la deja lista. */
  try {
    await lcu.fase();
  } catch (e) {
    anotar('aviso', `encontré el cliente pero no pude hablarle: ${e.message}`);
    lcu = null;
    return false;
  }
  /* El saludo es un adorno: si falla, no pasa nada. */
  let quien = '';
  try {
    const yo = await lcu.yo();
    if (yo?.gameName) quien = ` · ${yo.gameName}#${yo.tagLine}`;
  } catch {}
  anotar('ok', `conectado al cliente por ${cred.origen}, puerto ${cred.puerto}${quien}`);
  vigia = new Vigia(lcu, config);
  vigia.on('aceptando', ({ enMs }) => anotar('cola', `partida encontrada, acepto en ${enMs} ms`));
  vigia.on('aceptado', ({ tras }) => anotar('ok', `aceptada tras ${tras} ms`));
  vigia.on('cancelado', ({ motivo }) => anotar('aviso', `no acepté: ${motivo}`));
  vigia.on('problema', ({ mensaje }) => anotar('error', mensaje));
  vigia.arrancar();
  return true;
}

/* El cliente puede no estar abierto todavía, o cerrarse y volver. Reintentar
   en silencio es mejor que pedirle al usuario que reinicie la app. */
async function insistir() {
  if (await conectar()) return;
  anotar('aviso', 'no encuentro el cliente de League; sigo mirando cada 5 s');
  const reloj = setInterval(async () => {
    if (vigia) return clearInterval(reloj);
    if (await conectar()) clearInterval(reloj);
  }, 5000);
}

const json = (res, cuerpo, codigo = 200) => {
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(cuerpo));
};

const servidor = createServer((req, res) => {
  const url = new URL(req.url, 'http://local');

  if (url.pathname === '/api/estado') {
    return json(res, {
      conectado: !!vigia,
      bitacora: bitacora.slice(0, 25),
      ...(vigia ? vigia.instantanea() : { ajustes: config, estado: null }),
    });
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
  if (url.pathname === '/api/ajustes' && req.method === 'POST') {
    const nuevo = ajustes.sanear({
      ...config,
      retardoMs: url.searchParams.get('retardoMs') ?? config.retardoMs,
      variacionMs: url.searchParams.get('variacionMs') ?? config.variacionMs,
    });
    Object.assign(config, nuevo);
    if (vigia) Object.assign(vigia.ajustes, nuevo);
    ajustes.guardar(config);
    return json(res, config);
  }

  const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const base = join(import.meta.dirname, 'ui');
  const f = join(base, rel);
  if (!f.startsWith(base)) return json(res, { error: 'ruta inválida' }, 400);
  if (existsSync(f)) {
    res.writeHead(200, { 'content-type': TIPOS[extname(f)] || 'application/octet-stream' });
    return res.end(readFileSync(f));
  }
  json(res, { error: 'no encontrado' }, 404);
});

/* Solo 127.0.0.1: el panel no tiene por qué ser visible desde la red. */
servidor.listen(config.puertoPanel, '127.0.0.1', () => {
  const direccion = `http://127.0.0.1:${config.puertoPanel}`;
  anotar('ok', `panel en ${direccion}`);
  if (!process.env.SIN_NAVEGADOR) {
    const abrir = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', direccion]]
                : process.platform === 'darwin' ? ['open', [direccion]]
                : ['xdg-open', [direccion]];
    execFile(abrir[0], abrir[1], () => {});
  }
  insistir();
});

for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => {
  anotar('aviso', 'cerrando');
  vigia?.parar();
  servidor.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
});
