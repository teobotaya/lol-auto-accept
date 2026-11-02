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

  /* El cliente manda un centinela enorme cuando la fase no corre. Sin esto el
     aviso decía "quedan 2147484 s", que es peor que no decir nada. */
  const centinela = resumen(sesionSeleccion({ turno: 'pick', msCrudos: 2147483647 }), catalogo);
  ok('un reloj detenido no se muestra como dos millones de segundos',
     centinela.infinito === true && centinela.segundos === 0, String(centinela.segundos));
  ok('y el aviso del turno no habla de segundos que no existen',
     armarAviso('tuTurnoPick', centinela).texto.startsWith('Es tu turno.'),
     armarAviso('tuTurnoPick', centinela).texto);

  ok('un timer negativo no da segundos negativos',
     resumen({ localPlayerCellId: 0, timer: { adjustedTimeLeftInPhase: -500 } }).segundos === 0);
  ok('un timer que no es número tampoco da NaN',
     resumen({ localPlayerCellId: 0, timer: { adjustedTimeLeftInPhase: 'x' } }).segundos === 0);
  ok('una sesión sin acciones no explota',
     resumen({ localPlayerCellId: 0, actions: null })?.turnosAntes === null);

  /* Blind y ARAM: los cinco pickean a la vez. */
  const blind = resumen(sesionSeleccion({ simultaneo: true, segundos: 30 }), catalogo);
  ok('en blind, si estoy pickeando no hay picks "antes del mío"',
     blind.miTurno === true && blind.turnosAntes === 0,
     JSON.stringify({ miTurno: blind.miTurno, turnosAntes: blind.turnosAntes }));
  ok('y el texto no se contradice con el de tu turno',
     /Pickeás primero/.test(armarAviso('entraste', blind).texto),
     armarAviso('entraste', blind).texto);
  ok('el resumen dice qué acción es la mía', blind.accionId !== null, String(blind.accionId));
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

  /* Segunda ronda de baneos (torneo, Clash): el turno vuelve con otra acción y
     también hay que avisarlo. Antes se lo comía la memoria de avisos. */
  falso.entrarSeleccion({ turno: 'ban', segundos: 18, ronda: 2 });
  await dormir(300);
  ok('la segunda ronda de baneos también avisa', cuantos('tuTurnoBan') === 2, JSON.stringify(nombres()));

  falso.caerse();
  await dormir(300);
  ok('si la selección se cae, lo dice', cuantos('cayo') === 1, JSON.stringify(nombres()));
  const hasta = momentos.length;
  await dormir(300);
  ok('y después se queda callado', momentos.length === hasta, JSON.stringify(nombres().slice(hasta)));

  /* El caso feo: el cliente baja la sesión un instante ANTES de cambiar de
     fase. Si el cierre de partida dependiera de ese objeto, no se limpiaría la
     memoria de avisos y la partida siguiente entera saldría muda. */
  const antesDelHueco = momentos.length;
  falso.entrarSeleccion({ turno: 'pick', segundos: 20 });
  await dormir(300);
  ok('la partida nueva avisa igual', momentos.length > antesDelHueco, JSON.stringify(nombres()));
  falso.soltarSesion();
  await dormir(200);
  ok('perder la sesión en plena selección no borra lo que ya se sabía',
     vigia.estado.seleccion?.miPosicion === 'ADC', JSON.stringify(vigia.estado.seleccion));
  falso.empezarPartida();
  await dormir(300);
  ok('y la partida arranca avisando igual', cuantos('empezo') === 2, JSON.stringify(nombres()));

  const antesDeLaSiguiente = momentos.length;
  falso.entrarSeleccion({ turno: 'pick', segundos: 24 });
  await dormir(300);
  ok('la partida DESPUÉS de ese hueco no se queda muda',
     momentos.length - antesDeLaSiguiente === 2, JSON.stringify(nombres().slice(antesDeLaSiguiente)));
  falso.caerse();
  await dormir(300);

  /* ChampSelect sin sesión: el cliente responde 404 y eso no es un error. */
  const mudo = momentos.length;
  falso.estado.fase = 'ChampSelect';
  await dormir(300);
  ok('una selección sin sesión no rompe ni avisa',
     momentos.length === mudo && vigia.estado.seleccion === null,
     JSON.stringify({ nuevos: nombres().slice(mudo), seleccion: vigia.estado.seleccion }));
  ok('el vigía sigue vivo', vigia.cuenta.errores === 0, `errores=${vigia.cuenta.errores}`);

  /* ------------------------------------------ elegir desde el teléfono */
  console.log('\nelegir campeón y ban desde el panel');
  const fijados = [];
  vigia.on('fijado', (f) => fijados.push(f));
  const marcas = () => falso.estado.marcas;
  const mia = (id) => falso.estado.seleccion.actions.flat().find((a) => a.id === id);

  falso.caerse(); await dormir(200);
  ok('fuera de la selección no se puede planear',
     (await vigia.planear('pick', 51)).ok === false);

  /* Planificación: todavía no le toca a nadie, pero el pick ya se puede marcar. */
  falso.entrarSeleccion({ fase: 'PLANNING', segundos: 30 });
  await dormir(200);
  const r0 = vigia.estado.seleccion;
  ok('el resumen sabe cuál es mi acción de pick', r0?.pickId === 204 && r0.fase === 'PLANNING',
     JSON.stringify({ pickId: r0?.pickId, fase: r0?.fase }));
  const lista = await vigia.disponibles('pick');
  ok('la lista sale del cliente, sin los baneados y en orden alfabético',
     lista.length === 5 && lista[0].nombre === 'Ashe' && !lista.some((c) => c.nombre === 'Ahri'),
     JSON.stringify(lista.map((c) => c.nombre)));
  const mal = await vigia.planear('pick', 103);
  ok('no deja planear un campeón que ya está baneado', mal.ok === false && /no lo podés elegir/.test(mal.detalle),
     JSON.stringify(mal));
  ok('ni algo que no es ban ni pick', (await vigia.planear('jungla', 51)).ok === false);

  const bien = await vigia.planear('pick', 51);
  ok('planear el pick lo marca en el cliente en el acto, sin fijarlo',
     bien.ok && marcas().some((m) => m.accion === 204 && m.championId === 51 && m.completed === false),
     JSON.stringify(marcas()));
  ok('y el equipo lo ve como intención', falso.estado.seleccion.myTeam[2].championPickIntent === 51);
  ok('el plan se ve en el estado', vigia.instantanea().plan.pick?.nombre === 'Caitlyn',
     JSON.stringify(vigia.instantanea().plan));
  const fuera = await vigia.fijar('pick');
  ok('fijar antes de tiempo se rechaza con una razón', fuera.ok === false && /no te toca/.test(fuera.detalle),
     JSON.stringify(fuera));

  /* Si lo cambiás en la PC, gana la PC: la app no vuelve a pisarlo. */
  const antesDeTocar = marcas().length;
  mia(204).championId = 53;
  await dormir(250);
  ok('si cambiás el campeón en la PC, la app no te lo pisa', marcas().length === antesDeTocar,
     JSON.stringify(marcas().slice(antesDeTocar)));
  ok('y suelta su plan: el panel muestra lo que elegiste en la PC',
     vigia.plan.pick === null && vigia.estado.seleccion.pickMarcado === 'Blitzcrank',
     JSON.stringify({ plan: vigia.plan, marcado: vigia.estado.seleccion.pickMarcado }));
  await vigia.planear('pick', 51);
  ok('pero si lo volvés a pedir desde el panel, se marca de nuevo',
     marcas().length === antesDeTocar + 1 && mia(204).championId === 51, JSON.stringify(marcas().slice(antesDeTocar)));

  /* Me toca: la sesión es la misma, con mi acción en curso. */
  falso.estado.seleccion.timer.phase = 'BAN_PICK';
  mia(204).isInProgress = true;
  await dormir(200);
  ok('en mi turno no lo vuelve a marcar si ya estaba', marcas().length === antesDeTocar + 1);
  /* Si el cliente limpia la marca al empezar el turno, se vuelve a poner:
     no es que la cambiaste vos, es que desapareció. */
  mia(204).championId = 0;
  await dormir(200);
  ok('si la marca desaparece, la vuelve a poner', mia(204).championId === 51 && marcas().length === antesDeTocar + 2,
     JSON.stringify(marcas().slice(antesDeTocar)));
  const fijo = await vigia.fijar('pick');
  ok('fijar lo bloquea con el campeón planeado',
     fijo.ok && fijo.campeon === 'Caitlyn' && marcas().at(-1).completed === true && mia(204).completed,
     JSON.stringify({ fijo, ultima: marcas().at(-1) }));
  ok('y avisa que se fijó, para guardarlo en los recientes',
     fijados.length === 1 && fijados[0].tipo === 'pick' && fijados[0].id === 51, JSON.stringify(fijados));
  await dormir(150);
  ok('el resumen ya dice que pickeé y con qué', vigia.estado.seleccion.yaPickee && vigia.estado.seleccion.miCampeon === 'Caitlyn',
     JSON.stringify({ ya: vigia.estado.seleccion.yaPickee, c: vigia.estado.seleccion.miCampeon }));

  /* Al salir de la selección, el plan se olvida: la próxima es otra partida. */
  falso.caerse(); await dormir(200);
  ok('al terminar la selección el plan se borra', vigia.plan.ban === null && vigia.plan.pick === null);

  /* El ban: se planea, se marca en mi turno, y se fija. */
  falso.entrarSeleccion({ turno: 'ban', segundos: 25 });
  await dormir(200);
  const antesDelBan = marcas().length;
  const ban = await vigia.planear('ban', 22);
  ok('en mi turno de ban, planear lo marca enseguida',
     ban.ok && marcas().length === antesDelBan + 1 && marcas().at(-1).accion === 102 && marcas().at(-1).championId === 22,
     JSON.stringify(marcas().slice(antesDelBan)));
  /* La carrera con el sondeo, sin depender del reloj: una sesión pedida
     antes de que el cliente confirmara la marca no dispara nada. */
  const vieja = (banMarcadoId) => ({ ...vigia.estado.seleccion, miTurno: true, tipoTurno: 'ban', banId: 102, banMarcadoId });
  const patchesAntes = falso.estado.pedidos.filter((x) => x.startsWith('PATCH')).length;
  await vigia._aplicarPlan(vieja(null), 1);
  await vigia._aplicarPlan(vieja(53), 1);
  ok('una lectura vieja ni vuelve a marcar ni hace soltar el plan',
     falso.estado.pedidos.filter((x) => x.startsWith('PATCH')).length === patchesAntes && vigia.plan.ban === 22,
     JSON.stringify({ plan: vigia.plan }));
  const baneo = await vigia.fijar('ban');
  ok('y fijar lo banea', baneo.ok && mia(102).completed && mia(102).championId === 22, JSON.stringify(baneo));
  ok('fijar un pick en turno de ban se rechaza', (await vigia.fijar('pick')).ok === false);

  /* Si el cliente rechaza la marca, se avisa una vez y no se insiste. Se
     planea Ashe antes del turno; mientras tanto la banea otro; llega el turno
     y el cliente rechaza marcarla. */
  const problemas = [];
  vigia.on('problema', (x) => problemas.push(x));
  falso.caerse(); await dormir(200);
  falso.entrarSeleccion({ turno: 'ban', segundos: 25 });
  mia(102).isInProgress = false;
  await dormir(150);
  ok('el ban se puede planear antes de que te toque', (await vigia.planear('ban', 22)).ok && mia(102).championId === 0);
  const otro = falso.estado.seleccion.actions.flat().find((a) => a.id === 100);
  Object.assign(otro, { championId: 22, completed: true, isInProgress: false });
  const intentos = () => falso.estado.pedidos.filter((x) => x === 'PATCH /lol-champ-select/v1/session/actions/102').length;
  const antesDelRechazo = intentos();
  mia(102).isInProgress = true;
  await dormir(400);
  ok('si el cliente rechaza la marca, lo intenta una sola vez', intentos() - antesDelRechazo === 1,
     `intentos=${intentos() - antesDelRechazo}`);
  ok('y lo dice una sola vez, con el nombre', problemas.length === 1 && /Ashe/.test(problemas[0].mensaje),
     JSON.stringify(problemas));
  const rechazado = await vigia.fijar('ban');
  ok('fijar explica por qué no se puede', rechazado.ok === false && /no lo aceptó/.test(rechazado.detalle),
     JSON.stringify(rechazado));
  falso.caerse(); await dormir(200);

  /* Sin plan, fijar usa lo que esté marcado en el cliente. */
  falso.caerse(); await dormir(200);
  falso.entrarSeleccion({ turno: 'pick', segundos: 20 });
  await dormir(150);
  /* Caitlyn: en esta sesión Ashe, Blitzcrank, Brand y Braum ya están tomados. */
  mia(204).championId = 51;
  const sinPlan = await vigia.fijar('pick');
  ok('sin plan, fija lo que marcaste en la PC', sinPlan.ok && sinPlan.campeon === 'Caitlyn', JSON.stringify(sinPlan));
  falso.caerse(); await dormir(200);
  falso.entrarSeleccion({ turno: 'pick', segundos: 20 });
  await dormir(150);
  const nada = await vigia.fijar('pick');
  ok('y sin nada marcado, no inventa', nada.ok === false && /ningún campeón/.test(nada.detalle), JSON.stringify(nada));

  ok('el aviso del turno cuenta lo que ya está marcado',
     /Zed/.test(armarAviso('tuTurnoBan', { segundos: 20, planBan: 'Zed' }).texto) &&
     /Ahri/.test(armarAviso('tuTurnoPick', { segundos: 20, planPick: 'Ahri', equipo: [] }).texto));
  falso.caerse(); await dormir(200);
} finally {
  vigia.parar();
  await falso.cerrar();
}

console.log(`\n${total - fallos}/${total} pruebas de selección pasaron`);
process.exit(fallos ? 1 : 0);
