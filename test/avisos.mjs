/* Pruebas de los avisos, contra un receptor falso que captura exactamente lo
   que la app manda: método, cabeceras y cuerpo. Sin tocar ntfy ni Pushcut de
   verdad — lo que hay que verificar es que el pedido salga bien armado. */
import { createServer } from 'node:http';
import { CANALES, armarMensaje, crearAvisador, enmascarar, destinoNtfy } from '../src/avisos.mjs';
import { resumen } from '../src/champselect.mjs';
import { sesionSeleccion, CAMPEONES } from './servidor-falso.mjs';

let fallos = 0, total = 0;
const ok = (n, c, d = '') => { total++; console.log(c ? `  ok    ${n}` : `  FALLA ${n}${d ? ' — ' + d : ''}`); if (!c) fallos++; };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* Receptor falso: guarda todo lo que llega y puede fingir fallas. */
const recibidos = [];
let responderCon = 200, demora = 0;
const receptor = createServer(async (req, res) => {
  let cuerpo = '';
  req.setEncoding('utf8');
  for await (const c of req) cuerpo += c;
  recibidos.push({ metodo: req.method, ruta: req.url, cabeceras: req.headers, cuerpo });
  if (demora) await dormir(demora);
  res.writeHead(responderCon); res.end('ok');
});
const puerto = await new Promise((r) => receptor.listen(0, '127.0.0.1', () => r(receptor.address().port)));
const base = `http://127.0.0.1:${puerto}`;

console.log('\nmensajes');
{
  const m = armarMensaje('aceptada', { tras: 1500, aceptadas: 3 });
  ok('el texto dice cuánto tardó y cuántas van', /1500 ms/.test(m.texto) && /Van 3/.test(m.texto), m.texto);
  ok('la primera partida no dice "van 1"', !/Van/.test(armarMensaje('aceptada', { tras: 10, aceptadas: 0 }).texto));
  ok('la prueba se anuncia como prueba', /funcionando/.test(armarMensaje('prueba').texto));
}

console.log('\nenmascarado de secretos');
{
  ok('una URL de webhook con token no se muestra entera',
     !enmascarar('https://api.pushcut.io/AbCdEfGhIjKlMn/notifications/LoL').includes('AbCdEfGhIjKlMn')
     || enmascarar('https://api.pushcut.io/AbCdEfGhIjKlMn/notifications/LoL').includes('…'),
     enmascarar('https://api.pushcut.io/AbCdEfGhIjKlMn/notifications/LoL'));
  ok('el último tramo queda recortado', /…/.test(enmascarar('https://ntfy.sh/mi-tema-secreto-largo')),
     enmascarar('https://ntfy.sh/mi-tema-secreto-largo'));
  ok('un tema simple no se toca', enmascarar('mi-tema') === 'mi-tema');
  ok('una URL rota no explota', enmascarar('http://[[[') === 'destino inválido');
}

console.log('\ncada canal arma bien su pedido');
{
  recibidos.length = 0;
  await CANALES.ntfy.enviar(base + '/mi-tema', armarMensaje('aceptada', { tras: 1200, aceptadas: 1 }));
  const n = recibidos.at(-1);
  const jn = JSON.parse(n.cuerpo);
  ok('ntfy: POST en JSON a la raíz del servidor, con el tema adentro',
     n.metodo === 'POST' && n.ruta === '/' && jn.topic === 'mi-tema', JSON.stringify({ ruta: n.ruta, topic: jn.topic }));
  ok('ntfy: título y texto', jn.title === 'Partida aceptada' && /1200 ms/.test(jn.message), n.cuerpo);
  ok('ntfy: aceptar una partida va con prioridad alta', jn.priority === 4, String(jn.priority));

  /* El motivo de mandar JSON: en una cabecera, fetch manda la "ó" como un
     byte Latin-1 y el iPhone mostraba "Selecci�n". */
  await CANALES.ntfy.enviar(base + '/mi-tema', { titulo: 'Selección de campeones', texto: 'Arrancó, ñandú', etiqueta: 'x' });
  const tildes = JSON.parse(recibidos.at(-1).cuerpo);
  ok('ntfy: las tildes y la ñ llegan intactas', tildes.title === 'Selección de campeones' && tildes.message === 'Arrancó, ñandú',
     recibidos.at(-1).cuerpo);
  ok('ntfy: ninguna cabecera lleva texto con tildes',
     !Object.values(recibidos.at(-1).cabeceras).some((v) => /[^\x00-\x7F]/.test(String(v))));

  await CANALES.ntfy.enviar(base + '/mi-tema', { ...armarMensaje('prueba'), url: 'http://192.168.1.45:8123/' });
  ok('ntfy: con el panel abierto a la red, tocar el aviso lo abre',
     JSON.parse(recibidos.at(-1).cuerpo).click === 'http://192.168.1.45:8123/', recibidos.at(-1).cuerpo);
  await CANALES.ntfy.enviar(base + '/mi-tema', armarMensaje('prueba'));
  ok('ntfy: sin panel remoto no manda un click vacío', !('click' in JSON.parse(recibidos.at(-1).cuerpo)));

  await CANALES.pushcut.enviar(base + '/pc', armarMensaje('prueba'));
  const p = recibidos.at(-1);
  const jp = JSON.parse(p.cuerpo);
  ok('pushcut: JSON con title y text', jp.title === 'Auto Accept anda' && typeof jp.text === 'string', p.cuerpo);
  await CANALES.pushcut.enviar(base + '/pc', { ...armarMensaje('encontrada', { restante: 9 }), url: 'http://mac.local:8123/' });
  const jp2 = JSON.parse(recibidos.at(-1).cuerpo);
  ok('pushcut: lo urgente atraviesa Concentración y abre el panel',
     jp2.isTimeSensitive === true && jp2.defaultAction?.url === 'http://mac.local:8123/', recibidos.at(-1).cuerpo);

  await CANALES.webhook.enviar(base + '/wh', armarMensaje('aceptada', { tras: 900, aceptadas: 2 }));
  const w = JSON.parse(recibidos.at(-1).cuerpo);
  ok('webhook: manda el evento entero para que lo use quien quiera',
     w.evento === 'aceptada' && w.tras === 900 && w.aceptadas === 2, JSON.stringify(w));
}

console.log('\nel aviso nunca puede romper la aceptación');
{
  /* Para ntfy un nombre suelto no es un error: es el nombre del tema. Se
     verifica el armado de la URL sin salir a la red — una prueba que llama a
     un servicio de terceros es una prueba que falla el día que ese servicio
     tenga un mal rato. */
  const suelto = destinoNtfy('mi-tema');
  ok('ntfy: un tema suelto va al servidor público',
     suelto.servidor === 'https://ntfy.sh' && suelto.tema === 'mi-tema', JSON.stringify(suelto));
  const propio = destinoNtfy('https://ntfy.midominio.com/x');
  ok('ntfy: con una URL completa se separan servidor y tema',
     propio.servidor === 'https://ntfy.midominio.com' && propio.tema === 'x', JSON.stringify(propio));
  ok('ntfy: un tema que ntfy rechazaría se avisa antes, en castellano',
     destinoNtfy('a b/c').ok === false && /letras, números/.test(destinoNtfy('a b/c').detalle));
  const r0 = await CANALES.ntfy.enviar('tema con espacios', armarMensaje('prueba'));
  ok('ntfy: y el envío devuelve el error sin salir a la red', r0.ok === false, JSON.stringify(r0));

  const r1 = await CANALES.webhook.enviar('no-es-una-url', armarMensaje('prueba'));
  ok('webhook: una URL inválida devuelve error en vez de tirar excepción',
     r1.ok === false && /http/.test(r1.detalle), JSON.stringify(r1));

  responderCon = 500;
  const r2 = await CANALES.webhook.enviar(base + '/x', armarMensaje('prueba'));
  ok('un 500 del receptor se reporta como falla', r2.ok === false && /500/.test(r2.detalle), JSON.stringify(r2));
  responderCon = 200;

  const r3 = await CANALES.webhook.enviar('http://127.0.0.1:1/muerto', armarMensaje('prueba'));
  ok('un receptor caído no cuelga la app', r3.ok === false, JSON.stringify(r3));

  demora = 5000;
  const t0 = Date.now();
  const r4 = await CANALES.webhook.enviar(base + '/lento', armarMensaje('prueba'));
  const tardo = Date.now() - t0;
  ok('un receptor lento se corta a los ~4 s', r4.ok === false && tardo < 4800, `${tardo} ms · ${r4.detalle}`);
  demora = 0;
}

console.log('\nel avisador completo');
{
  recibidos.length = 0;
  const notas = [];
  const cfg = { canal: 'webhook', destino: base + '/hook' };
  const av = crearAvisador(() => cfg, (t, x) => notas.push([t, x]));

  await av.probar();
  ok('el botón de probar manda de verdad', recibidos.length === 1, `pedidos=${recibidos.length}`);
  ok('y lo anota sin mostrar el destino entero',
     notas.some(([t, x]) => t === 'ok' && /aviso enviado/.test(x) && !x.includes('/hook')),
     JSON.stringify(notas));

  recibidos.length = 0;
  responderCon = 500;
  await av.probar();
  ok('ante una falla reintenta una sola vez', recibidos.length === 2, `pedidos=${recibidos.length}`);
  responderCon = 200;

  cfg.canal = 'ninguno';
  recibidos.length = 0;
  av.avisar('aceptada', { tras: 100, aceptadas: 1 });
  await dormir(200);
  ok('con el canal apagado no manda nada', recibidos.length === 0);

  cfg.canal = 'webhook'; cfg.destino = '';
  const r = await av.probar();
  ok('sin destino avisa que falta, no revienta', r.ok === false && /destino/.test(r.detalle), JSON.stringify(r));

  /* Lo más importante: avisar() no espera ni propaga. */
  cfg.destino = 'http://127.0.0.1:1/muerto';
  let exploto = false;
  try { av.avisar('aceptada', { tras: 1, aceptadas: 1 }); } catch { exploto = true; }
  await dormir(300);
  ok('avisar() no lanza aunque el receptor esté muerto', exploto === false);
}

console.log('\nlos avisos de la selección de campeones');
{
  const catalogo = new Map(CAMPEONES.filter((c) => c.id > 0).map((c) => [c.id, c.name]));
  const r = resumen(sesionSeleccion({ turno: 'pick', segundos: 9 }), catalogo);

  const m = armarMensaje('tuTurnoPick', r);
  ok('el mensaje del turno usa el texto de la selección',
     m.titulo === 'Te toca PICKEAR' && /9 s/.test(m.texto), JSON.stringify(m.titulo));
  ok('viaja lo que un atajo necesita para decidir',
     m.evento === 'tuTurnoPick' && m.segundos === 9 && m.tipoTurno === 'pick' && m.miPosicion === 'ADC',
     JSON.stringify(m));
  ok('pero no los dos equipos enteros', m.equipo === undefined && m.baneos === undefined,
     Object.keys(m).join(','));

  recibidos.length = 0;
  await CANALES.webhook.enviar(base + '/wh', m);
  const cuerpo = JSON.parse(recibidos.at(-1).cuerpo);
  ok('el webhook lo recibe listo para ramificar',
     cuerpo.evento === 'tuTurnoPick' && cuerpo.miTurno === true, recibidos.at(-1).cuerpo);

  const entrada = armarMensaje('entraste', resumen(sesionSeleccion({ segundos: 27 }), catalogo));
  ok('el aviso de entrar no repite el título de "partida aceptada"',
     entrada.titulo !== armarMensaje('aceptada', { tras: 1 }).titulo, entrada.titulo);

  /* Se pueden apagar los de la selección sin apagar el que más importa. */
  recibidos.length = 0;
  const cfg = { canal: 'webhook', destino: base + '/hook', seleccion: false };
  const av = crearAvisador(() => cfg);
  av.avisar('tuTurnoPick', r);
  av.avisar('aceptada', { tras: 100, aceptadas: 1 });
  await dormir(300);
  ok('apagar los avisos de selección no apaga el de aceptada',
     recibidos.length === 1 && JSON.parse(recibidos[0].cuerpo).evento === 'aceptada',
     JSON.stringify(recibidos.map((x) => JSON.parse(x.cuerpo).evento)));

  recibidos.length = 0;
  cfg.seleccion = true;
  av.avisar('tuTurnoPick', r);
  await dormir(300);
  ok('y encendidos, llegan', recibidos.length === 1, `pedidos=${recibidos.length}`);
}

console.log('\nel panel en el teléfono, desde los avisos');
{
  recibidos.length = 0;
  const cfg = { canal: 'webhook', destino: base + '/hook', seleccion: true };
  let panel = null;
  const av = crearAvisador(() => cfg, () => {}, { enlace: () => panel });
  /* Esperar a que llegue el pedido, no un tiempo fijo: con la máquina
     cargada, 200 ms a veces no alcanzaban y la prueba miraba el anterior. */
  const llegan = async (n) => { for (let i = 0; i < 40 && recibidos.length < n; i++) await dormir(50); };
  av.avisar('aceptada', { tras: 1, aceptadas: 1 });
  await llegan(1);
  ok('sin panel remoto, el aviso no lleva dirección', !('url' in JSON.parse(recibidos.at(-1).cuerpo)));
  panel = 'http://192.168.1.45:8123/';
  av.avisar('aceptada', { tras: 1, aceptadas: 2 });
  await llegan(2);
  ok('con panel remoto, cada aviso lleva la dirección limpia', JSON.parse(recibidos.at(-1).cuerpo).url === panel);

  const r = await av.mandarEnlace('http://192.168.1.45:8123/?llave=abcdefghijklmnopqrstuvwx');
  const e = JSON.parse(recibidos.at(-1).cuerpo);
  ok('"mandármelo al teléfono" sí lleva la llave, y espera la respuesta',
     r.ok === true && e.evento === 'enlace' && /llave=/.test(e.url), recibidos.at(-1).cuerpo);

  const enc = armarMensaje('encontrada', { restante: 9 });
  ok('en pausa, "saltó la partida" va con la prioridad máxima', enc.prioridad === 5 && /9 s/.test(enc.texto), JSON.stringify(enc));
  ok('aceptar a mano no inventa milisegundos', /desde el panel/.test(armarMensaje('aceptada', { aMano: true, tras: 0 }).texto));
}

await new Promise((r) => receptor.close(r));
console.log(`\n${total - fallos}/${total} pruebas de avisos pasaron`);
process.exit(fallos ? 1 : 0);
