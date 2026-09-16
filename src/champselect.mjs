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
const aplanar = (acciones = []) => acciones.flat().filter(Boolean);

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

  const ms = Number(sesion.timer?.adjustedTimeLeftInPhase ?? 0);
  const segundos = Math.max(0, Math.round(ms / 1000));

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
    infinito: !!sesion.timer?.isInfinite,
    miTurno: !!enCurso,
    tipoTurno: enCurso?.type ?? null,          // 'pick' | 'ban' | null
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
  return i < 0 ? null : i;
}

/* ------------------------------------------------------------------ avisos
   Qué momentos merecen molestar al teléfono. Uno por cosa que cambia lo que
   tenés que hacer; el resto es ruido, y un aviso que no exige nada entrena a
   ignorar los que sí. */
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
  },
  tuTurnoBan: {
    titulo: 'Te toca BANEAR',
    texto: (r) => `Quedan ${r.segundos} s.`,
    etiqueta: 'no_entry',
  },
  tuTurnoPick: {
    titulo: 'Te toca PICKEAR',
    texto: (r) => `Quedan ${r.segundos} s.` +
      (r.equipo?.some((j) => j.campeon && !j.esYo)
        ? ` Tu equipo: ${r.equipo.filter((j) => !j.esYo && j.campeon).map((j) => j.campeon).join(', ')}.`
        : ''),
    etiqueta: 'rotating_light',
  },
  ultimoAviso: {
    titulo: 'Últimos segundos',
    texto: (r) => `Quedan ${r.segundos} s y todavía no elegiste.`,
    etiqueta: 'alarm_clock',
  },
  cayo: {
    titulo: 'Se cayó la partida',
    texto: () => 'Alguien no aceptó o se fue. Volvés a la cola.',
    etiqueta: 'x',
  },
  empezo: {
    titulo: 'Arrancó la partida',
    texto: (r) => (r?.miCampeon ? `Estás jugando ${r.miCampeon}.` : 'La partida está cargando.'),
    etiqueta: 'checkered_flag',
  },
};

export function armarAviso(momento, r) {
  const m = MOMENTOS[momento];
  if (!m) return null;
  return { titulo: m.titulo, texto: m.texto(r ?? {}), etiqueta: m.etiqueta, evento: momento };
}
