/* ---------------------------------------------------------------------------
   Pruebas de la selección de campeones.

   Dos mitades. La primera es pura: se le dan sesiones armadas a mano a
   resumen() y se verifica qué saca en limpio. La segunda levanta el LCU falso
   y corre el vigía completo contra él, para comprobar lo que de verdad
   importa del aviso: que salga cuando cambia algo y UNA SOLA VEZ, aunque el
   sondeo pase cien veces por el mismo estado.
   --------------------------------------------------------------------------- */
import { resumen, armarAviso, turnosAntesDelMio, normalizarPosicion } from '../src/champselect.mjs';
import { Lcu } from '../src/lcu.mjs';
import { Vigia } from '../src/vigia.mjs';
import { servidorFalso, sesionSeleccion, CAMPEONES } from './servidor-falso.mjs';

let fallos = 0, total = 0;
const ok = (n, c, d = '') => { total++; console.log(c ? `  ok    ${n}` : `  FALLA ${n}${d ? ' — ' + d : ''}`); if (!c) fallos++; };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const catalogo = new Map(CAMPEONES.filter((c) => c.id > 0).map((c) => [c.id, c.name]));

console.log('\nleer la sesión de selección');
{
  ok('sin sesión no inventa nada', resumen(null) === null && resumen(undefined) === null);
  ok('una sesión que no es un objeto tampoco', resumen('None') === null);

  const entrada = resumen(sesionSeleccion({ segundos: 27 }), catalogo);
  ok('saca mi posición del equipo', entrada.miPosicion === 'ADC', entrada.miPosicion);
  ok('convierte los segundos de milisegundos', entrada.segundos === 27, String(entrada.segundos));
  ok('al entrar no es mi turno', entrada.miTurno === false && entrada.tipoTurno === null);
  ok('cuenta cuántos picks van antes del mío', entrada.turnosAntes === 4, String(entrada.turnosAntes));
  ok('lista los baneos con nombre', entrada.baneos.includes('Aatrox') && entrada.baneos.length === 5,
     JSON.stringify(entrada.baneos));

  const pick = resumen(sesionSeleccion({ turno: 'pick', segundos: 9 }), catalogo);
  ok('detecta que me toca pickear', pick.miTurno === true && pick.tipoTurno === 'pick');
  ok('cuando me toca, no hay nadie antes', pick.turnosAntes === 0, String(pick.turnosAntes));
  ok('todavía no pickeé', pick.yaPickee === false);
  ok('ya ve los campeones de mi equipo',
     pick.equipo.filter((j) => j.campeon).length === 2, JSON.stringify(pick.equipo.map((j) => j.campeon)));

  const ban = resumen(sesionSeleccion({ turno: 'ban', segundos: 20 }), catalogo);
  ok('distingue el turno de baneo del de pick', ban.miTurno === true && ban.tipoTurno === 'ban');
  ok('en el turno de baneo todavía no baneé', ban.yaBanee === false);

  /* hechos: 5 = los cinco primeros del orden, y el quinto es el mío. */
  const listo = resumen(sesionSeleccion({ hechos: 5 }), catalogo);
  ok('después de pickear dice qué campeón me tocó', listo.yaPickee === true && listo.miCampeon === 'Caitlyn',
     JSON.stringify({ yaPickee: listo.yaPickee, miCampeon: listo.miCampeon }));
  ok('y ya no hay turnos míos pendientes', listo.turnosAntes === null, String(listo.turnosAntes));

  const sinCatalogo = resumen(sesionSeleccion({ hechos: 5 }));
  ok('sin catálogo no se rompe: usa el id', /campeón \d+/.test(sinCatalogo.miCampeon ?? ''), sinCatalogo.miCampeon);

  const infinito = resumen(sesionSeleccion({ segundos: 0, infinito: true }), catalogo);
  ok('marca el reloj infinito en vez de decir 0 s', infinito.infinito === true && infinito.segundos === 0);

  ok('un timer negativo no da segundos negativos',
     resumen({ localPlayerCellId: 0, timer: { adjustedTimeLeftInPhase: -500 } }).segundos === 0);
  ok('turnosAntesDelMio devuelve null si no tengo pick pendiente',
     turnosAntesDelMio([{ type: 'pick', completed: true, actorCellId: 2 }], 2) === null);
  ok('las posiciones se traducen al castellano',
     normalizarPosicion('utility') === 'Support' && normalizarPosicion('jungle') === 'Jungla');
  ok('una posición desconocida se muestra tal cual', normalizarPosicion('raro') === 'raro');
  ok('sin posición asignada no inventa una', normalizarPosicion('') === null);
}

console.log('\nel texto del aviso');
{
  const entrada = resumen(sesionSeleccion({ segundos: 27 }), catalogo);
  const a = armarAviso('entraste', entrada);
  ok('al entrar dice la posición y cuántos faltan',
     /vas ADC/.test(a.texto) && /4 picks antes/.test(a.texto), a.texto);
  ok('y cuánto queda de la fase', /27 s/.test(a.texto), a.texto);

  const primero = armarAviso('entraste', { ...entrada, turnosAntes: 0 });
  ok('si pickeo primero, lo dice así', /Pickeás primero/.test(primero.texto), primero.texto);
  ok('un pick solo no se dice en plural',
     /1 pick antes/.test(armarAviso('entraste', { ...entrada, turnosAntes: 1 }).texto));

  const pick = armarAviso('tuTurnoPick', resumen(sesionSeleccion({ turno: 'pick', segundos: 9 }), catalogo));
  ok('el aviso de pickear grita que te toca', /PICKEAR/.test(pick.titulo), pick.titulo);
  ok('dice los segundos que quedan', /9 s/.test(pick.texto), pick.texto);
  ok('y qué eligió el equipo', /Ashe/.test(pick.texto), pick.texto);

  ok('el de banear es distinto del de pickear',
     armarAviso('tuTurnoBan', { segundos: 20 }).titulo !== pick.titulo);
  ok('la partida caída se explica sola', /cola/.test(armarAviso('cayo', null).texto));
  ok('al empezar dice con qué campeón', /Caitlyn/.test(armarAviso('empezo', { miCampeon: 'Caitlyn' }).texto));
  ok('un momento inventado no arma nada', armarAviso('cualquiera', {}) === null);
}

console.log('\nel vigía mirando la selección, contra el LCU falso');
const falso = servidorFalso();
const puerto = await falso.escuchar();
const vigia = new Vigia(new Lcu({ puerto, clave: falso.clave }), {
  ritmoLento: 50, ritmoRapido: 50, ritmoSeleccion: 50, avisarUltimos: 10, activo: false,
});
const momentos = [];
vigia.on('momento', (m) => momentos.push(m));
const nombres = () => momentos.map((m) => m.momento);
const cuantos = (n) => nombres().filter((x) => x === n).length;
vigia.arrancar();

try {
  await dormir(200);
  ok('fuera de la selección no avisa nada', momentos.length === 0, JSON.stringify(nombres()));

  falso.entrarSeleccion({ segundos: 27 });
  await dormir(300);
  ok('avisa al entrar a la selección', cuantos('entraste') === 1, JSON.stringify(nombres()));
  ok('y no repite el aviso en cada sondeo', momentos.length === 1, `${momentos.length} avisos en 6 sondeos`);
  ok('el aviso viaja con los datos, no solo con el texto',
     momentos[0].datos.miPosicion === 'ADC' && momentos[0].datos.turnosAntes === 4,
     JSON.stringify(momentos[0].datos?.miPosicion));
  ok('el panel puede ver la selección en el estado',
     vigia.instantanea().seleccion?.miPosicion === 'ADC', JSON.stringify(vigia.estado.seleccion?.fase));
  ok('los nombres salen del catálogo del cliente',
     vigia.estado.seleccion.baneos.includes('Ahri'), JSON.stringify(vigia.estado.seleccion.baneos));
  ok('el catálogo se pide una sola vez',
     falso.estado.pedidos.filter((p) => p.includes('champion-summary')).length === 1);

  falso.entrarSeleccion({ turno: 'pick', segundos: 25 });
  await dormir(300);
  ok('avisa cuando me toca pickear', cuantos('tuTurnoPick') === 1, JSON.stringify(nombres()));
  ok('con 25 s no molesta con el apuro', cuantos('ultimoAviso') === 0);

  falso.entrarSeleccion({ turno: 'pick', segundos: 8 });
  await dormir(300);
  ok('con el reloj en rojo avisa de nuevo', cuantos('ultimoAviso') === 1, JSON.stringify(nombres()));
  ok('el apuro tampoco se repite', momentos.length === 3, JSON.stringify(nombres()));

  falso.empezarPartida();
  await dormir(300);
  ok('avisa que arrancó la partida', cuantos('empezo') === 1, JSON.stringify(nombres()));
  ok('y no dice que se cayó', cuantos('cayo') === 0);

  /* Segunda partida: la memoria de avisos tiene que haberse limpiado. */
  falso.entrarSeleccion({ turno: 'ban', segundos: 20 });
  await dormir(300);
  ok('la partida siguiente vuelve a avisar', cuantos('entraste') === 2, JSON.stringify(nombres()));
  ok('y avisa el turno de baneo', cuantos('tuTurnoBan') === 1, JSON.stringify(nombres()));

  falso.caerse();
  await dormir(300);
  ok('si la selección se cae, lo dice', cuantos('cayo') === 1, JSON.stringify(nombres()));
  const hasta = momentos.length;
  await dormir(300);
  ok('y después se queda callado', momentos.length === hasta, JSON.stringify(nombres().slice(hasta)));

  /* ChampSelect sin sesión: el cliente responde 404 y eso no es un error. */
  falso.estado.fase = 'ChampSelect';
  await dormir(300);
  ok('una selección sin sesión no rompe ni avisa',
     momentos.length === hasta && vigia.estado.seleccion === null, JSON.stringify(vigia.estado.seleccion));
  ok('el vigía sigue vivo', vigia.cuenta.errores === 0, `errores=${vigia.cuenta.errores}`);
} finally {
  vigia.parar();
  await falso.cerrar();
}

console.log(`\n${total - fallos}/${total} pruebas de selección pasaron`);
process.exit(fallos ? 1 : 0);
