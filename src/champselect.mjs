/* ---------------------------------------------------------------------------
   Selección de campeones.

   El LCU publica la sesión entera en /lol-champ-select/v1/session: las
   acciones (cada pick y cada ban, de quién son y si están en curso), quién soy
   yo dentro de la partida, el reloj de la fase y los dos equipos.

   Todo lo de este archivo son funciones puras sobre ese objeto. Esa decisión
   es la que hace que se pueda probar de verdad: no hace falta un cliente de
   League corriendo para verificar que "me toca pickear y quedan 12 segundos"
   se calcula bien.
   --------------------------------------------------------------------------- */

/* Las acciones vienen agrupadas por turno: [[ban,ban,ban],[pick],[pick,pick]].
   Aplanarlas es lo primero, porque lo que importa es cuál está en curso. */
const aplanar = (acciones) => (Array.isArray(acciones) ? acciones : []).flat().filter(Boolean);

export function resumen(sesion, catalogo = new Map()) {
  if (!sesion || typeof sesion !== 'object') return null;

  const yo = sesion.localPlayerCellId;
  const acciones = aplanar(sesion.actions);
  const nombre = (id) => (id > 0 ? (catalogo.get(id) ?? `campeón ${id}`) : null);

  /* Mi turno es cuando hay una acción mía marcada como en curso y sin
     completar. Ojo: puede haber varias en curso a la vez (los bans son
     simultáneos), por eso se filtra por actorCellId y no se toma la primera. */
  const mias = acciones.filter((a) => a.actorCellId === yo);
  const enCurso = mias.find((a) => a.isInProgress && !a.completed) ?? null;

  const yaHice = {
    ban: mias.some((a) => a.type === 'ban' && a.completed),
    pick: mias.some((a) => a.type === 'pick' && a.completed),
  };
  const miPick = mias.find((a) => a.type === 'pick');
  /* Las acciones que todavía me quedan por hacer, estén en curso o no: el
     pick se puede marcar desde la fase de planificación, mucho antes de que
     me toque, y así el equipo ya sabe qué voy a jugar. */
  const banPendiente = mias.find((a) => a.type === 'ban' && !a.completed) ?? null;
  const pickPendiente = mias.find((a) => a.type === 'pick' && !a.completed) ?? null;
  const miBan = mias.filter((a) => a.type === 'ban' && a.completed).at(-1);

  /* El reloj tiene tres formas de no ser un número de segundos: la bandera
     isInfinite, el centinela enorme que manda el cliente cuando la fase no
     corre (partidas personalizadas, practice tool) y directamente basura. Las
     tres terminan en lo mismo: no hay cuenta regresiva que mostrar. Sin esto
     el aviso decía "quedan 2147484 s", que es peor que no decir nada. */
  const ms = Number(sesion.timer?.adjustedTimeLeftInPhase);
  const infinito = !!sesion.timer?.isInfinite || !Number.isFinite(ms) || ms > 60 * 60 * 1000;
  const segundos = infinito ? 0 : Math.max(0, Math.round(ms / 1000));

  const equipo = (sesion.myTeam ?? []).map((j) => ({
    esYo: j.cellId === yo,
    posicion: normalizarPosicion(j.assignedPosition),
    campeon: nombre(j.championId || j.championPickIntent),
    bloqueado: !!j.championId,
  }));

  const mio = equipo.find((j) => j.esYo);

  return {
    fase: sesion.timer?.phase ?? 'DESCONOCIDA',
    segundos,
    infinito,
    miTurno: !!enCurso,
    tipoTurno: enCurso?.type ?? null,          // 'pick' | 'ban' | null
    /* El id de la acción en curso distingue un turno de otro. Hace falta para
       no comerse el segundo baneo en los modos que tienen dos rondas: sin él,
       "ya avisé tuTurnoBan" valdría para toda la partida. */
    accionId: enCurso?.id ?? null,
    banId: banPendiente?.id ?? null,
    pickId: pickPendiente?.id ?? null,
    /* Lo que está marcado en la acción en curso (en el cliente se ve como el
       campeón "elegido pero sin fijar"); si no es mi turno, el pick marcado. */
    marcadoId: (enCurso ?? pickPendiente)?.championId || null,
    marcado: nombre((enCurso ?? pickPendiente)?.championId),
    /* Y lo marcado en cada una de mis acciones pendientes, por separado: en
       mi turno de ban, "lo marcado" es el ban, pero el pick sigue teniendo lo
       suyo, y hay que poder mirar los dos. */
    banMarcadoId: banPendiente?.championId || null,
    pickMarcadoId: pickPendiente?.championId || null,
    banMarcado: nombre(banPendiente?.championId),
    pickMarcado: nombre(pickPendiente?.championId),
    miBan: nombre(miBan?.championId),
    miPosicion: mio?.posicion ?? null,
    miCampeon: nombre(miPick?.championId) ?? mio?.campeon ?? null,
    yaBanee: yaHice.ban,
    yaPickee: yaHice.pick,
    equipo,
    baneos: aplanar(sesion.actions).filter((a) => a.type === 'ban' && a.completed)
      .map((a) => nombre(a.championId)).filter(Boolean),
    /* Cuántos turnos faltan antes del mío: sirve para decir "sos el tercero". */
    turnosAntes: turnosAntesDelMio(acciones, yo),
  };
}

export const POSICIONES = {
  top: 'Top', jungle: 'Jungla', middle: 'Mid', bottom: 'ADC', utility: 'Support',
};
export function normalizarPosicion(p) {
  if (!p) return null;
  return POSICIONES[String(p).toLowerCase()] ?? String(p);
}

export function turnosAntesDelMio(acciones, yo) {
  const pendientes = acciones.filter((a) => a.type === 'pick' && !a.completed);
  const i = pendientes.findIndex((a) => a.actorCellId === yo);
  if (i < 0) return null;
  /* En blind y en ARAM los cinco pickean a la vez, así que los picks de mis
     compañeros figuran "antes" del mío aunque nadie esté esperando a nadie.
     Si el mío ya está en curso, no hay ninguno antes: decir "hay 2 picks antes
     del tuyo" y "te toca pickear" en el mismo segundo es peor que no avisar. */
  return pendientes[i].isInProgress ? 0 : i;
}

/* ------------------------------------------------------------------ avisos
   Qué momentos merecen molestar al teléfono. Uno por cosa que cambia lo que
   tenés que hacer; el resto es ruido, y un aviso que no exige nada entrena a
   ignorar los que sí. La prioridad sigue la misma lógica: 5 es "dejá lo que
   estés haciendo" y en el iPhone atraviesa el modo Concentración. */
const reloj = (r) => (r.infinito || !Number.isFinite(r.segundos) ? 'Es tu turno.' : `Quedan ${r.segundos} s.`);

export const MOMENTOS = {
  entraste: {
    /* El título no repite "Partida aceptada": ese aviso ya salió un segundo
       antes y dos notificaciones iguales seguidas no dicen nada nuevo. */
    titulo: 'Selección de campeones',
    texto: (r) => `Ya estás adentro${r.miPosicion ? `, vas ${r.miPosicion}` : ''}.` +
      (r.turnosAntes === 0 ? ' Pickeás primero.'
       : r.turnosAntes > 0 ? ` Hay ${r.turnosAntes} ${r.turnosAntes === 1 ? 'pick' : 'picks'} antes del tuyo.`
       : '') +
      (r.segundos > 0 && !r.infinito ? ` Quedan ${r.segundos} s de esta fase.` : ''),
    etiqueta: 'video_game',
    prioridad: 4,
  },
  tuTurnoBan: {
    titulo: 'Te toca BANEAR',
    texto: (r) => reloj(r) + (r.planBan ? ` Ya está marcado ${r.planBan}: banealo desde el panel.` : ''),
    etiqueta: 'no_entry',
    prioridad: 4,
  },
  tuTurnoPick: {
    titulo: 'Te toca PICKEAR',
    texto: (r) => reloj(r) +
      (r.planPick ? ` Ya está marcado ${r.planPick}: fijalo desde el panel.` : '') +
      (r.equipo?.some((j) => j.campeon && !j.esYo)
        ? ` Tu equipo: ${r.equipo.filter((j) => !j.esYo && j.campeon).map((j) => j.campeon).join(', ')}.`
        : ''),
    etiqueta: 'rotating_light',
    prioridad: 5,
  },
  ultimoAviso: {
    titulo: 'Últimos segundos',
    texto: (r) => `Quedan ${r.segundos} s y todavía no elegiste.`,
    etiqueta: 'alarm_clock',
    prioridad: 5,
  },
  cayo: {
    titulo: 'Se cayó la partida',
    texto: () => 'Alguien no aceptó o se fue. Volvés a la cola.',
    etiqueta: 'x',
    prioridad: 3,
  },
  empezo: {
    titulo: 'Arrancó la partida',
    texto: (r) => (r?.miCampeon ? `Estás jugando ${r.miCampeon}.` : 'La partida está cargando.'),
    etiqueta: 'checkered_flag',
    prioridad: 3,
  },
};

export function armarAviso(momento, r) {
  const m = MOMENTOS[momento];
  if (!m) return null;
  return { titulo: m.titulo, texto: m.texto(r ?? {}), etiqueta: m.etiqueta, evento: momento,
           prioridad: m.prioridad ?? 3 };
}
