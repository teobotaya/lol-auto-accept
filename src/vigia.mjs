/* ---------------------------------------------------------------------------
   El vigía: la máquina de estados que mira la cola y acepta.

   Dos decisiones que definen el comportamiento:

   1. No se sondea siempre al mismo ritmo. Fuera de cola alcanza con mirar cada
      dos segundos; en cola hay que mirar rápido, porque el contador dura diez
      y perder la ventana es justo lo que esta app viene a evitar. El ritmo lo
      decide la fase del cliente.

   2. No acepta al instante. Hay un retardo configurable con una pizca de
      variación, y una ventana para cancelar. Aceptar en cero milisegundos no
      te da tiempo a arrepentirte si te levantaste de la silla, y además es la
      firma más obvia de que hay algo automático del otro lado.
   --------------------------------------------------------------------------- */
import { EventEmitter } from 'node:events';
import { resumen } from './champselect.mjs';

export const FASES_EN_COLA = new Set(['Matchmaking', 'ReadyCheck', 'Lobby']);
/* La selección de campeones tiene su propio ritmo: dura minutos y no diez
   segundos, así que no necesita el sondeo rápido de la cola. */
export const FASES_SELECCION = new Set(['ChampSelect']);

export class Vigia extends EventEmitter {
  constructor(lcu, ajustes = {}) {
    super();
    this.lcu = lcu;
    this.ajustes = {
      retardoMs: 1500,      // espera antes de aceptar
      variacionMs: 400,     // ±, para que no sea siempre el mismo número
      ritmoLento: 2000,     // sondeo fuera de cola
      ritmoRapido: 300,     // sondeo en cola
      ritmoSeleccion: 1000, // sondeo en selección de campeones
      avisarUltimos: 10,    // segundos restantes para el último aviso
      activo: true,
      ...ajustes,
    };
    this.estado = { fase: 'desconocida', enCola: false, aceptando: false, restante: 0, seleccion: null };
    /* Que estemos en selección NO se deduce de estado.seleccion: el cliente
       puede bajar la sesión un instante antes de cambiar de fase, y si el
       cierre de partida dependiera de ese objeto, esa vez no se limpiaría la
       memoria de avisos y la partida SIGUIENTE entera saldría muda. */
    this._enSeleccion = false;
    /* Un aviso por momento y por partida: si se repitiera en cada sondeo, el
       teléfono vibraría una vez por segundo. */
    this._avisados = new Set();
    this._campeones = null;
    this.cuenta = { aceptadas: 0, canceladas: 0, errores: 0, desde: Date.now() };
    this.corriendo = false;
    this._cancelar = null;
    this._cancelado = false;   // cancelado para ESTE ready check
    this._timer = null;
    this._azar = Math.random;
  }

  arrancar() {
    if (this.corriendo) return;
    this.corriendo = true;
    this._ciclo();
  }

  parar() {
    this.corriendo = false;
    clearTimeout(this._timer);
    this.cancelarAceptacion('el vigía se detuvo');
  }

  /* Cancelar una aceptación en curso. Existe porque el usuario tiene que poder
     ganarle a su propia automatización. */
  cancelarAceptacion(motivo = 'cancelado a mano') {
    if (!this._cancelar) return false;
    const fn = this._cancelar;
    this._cancelar = null;
    this._cancelado = true;
    this.estado.aceptando = false;
    this.cuenta.canceladas++;
    fn(motivo);
    this.emit('cancelado', { motivo });
    return true;
  }

  async _ciclo() {
    while (this.corriendo) {
      let espera = this.ajustes.ritmoLento;
      try {
        espera = await this._paso();
      } catch (e) {
        this.cuenta.errores++;
        this.estado.fase = 'sin cliente';
        this.emit('problema', { mensaje: e.message });
        espera = this.ajustes.ritmoLento;
      }
      this.emit('estado', this.instantanea());
      await new Promise((r) => { this._timer = setTimeout(r, espera); });
    }
  }

  async _paso() {
    const fase = await this.lcu.fase();
    this.estado.fase = String(fase).replace(/"/g, '');
    this.estado.enCola = FASES_EN_COLA.has(this.estado.fase);

    if (FASES_SELECCION.has(this.estado.fase)) {
      this._enSeleccion = true;
      await this._selección();
      return this.ajustes.ritmoSeleccion;
    }
    /* Al salir de la selección se limpia la memoria de avisos: la próxima
       partida tiene que poder avisar de nuevo. */
    if (this._enSeleccion) {
      this._enSeleccion = false;
      const ultima = this.estado.seleccion;
      this.estado.seleccion = null;
      if (this.estado.fase === 'InProgress' || this.estado.fase === 'GameStart') {
        this._avisar('empezo', ultima);
      } else {
        this._avisar('cayo', ultima);
      }
      this._avisados.clear();
    }

    if (this.estado.fase !== 'ReadyCheck') {
      this.estado.restante = 0;
      if (this._cancelar) this.cancelarAceptacion('la partida se cayó antes de aceptar');
      /* La cancelación vale para esta partida, no para siempre: al salir del
         ready check se olvida, si no la app quedaría muda hasta reiniciarla. */
      this._cancelado = false;
      return FASES_EN_COLA.has(this.estado.fase) ? this.ajustes.ritmoRapido : this.ajustes.ritmoLento;
    }

    const rc = await this.lcu.readyCheck();
    this.estado.restante = Math.max(0, Math.round(rc?.timer ?? 0));

    /* Si ya respondí —a mano o antes— no hay nada que hacer. */
    if (rc?.playerResponse && rc.playerResponse !== 'None') {
      return this.ajustes.ritmoRapido;
    }
    /* Sin la marca de cancelado, el siguiente sondeo volvería a programar la
       aceptación a los pocos milisegundos y cancelar no serviría de nada. */
    if (!this.ajustes.activo || this.estado.aceptando || this._cancelado) return this.ajustes.ritmoRapido;

    this._programarAceptacion();
    return this.ajustes.ritmoRapido;
  }

  /* La clave puede ser más fina que el momento: los turnos se distinguen por
     el id de la acción, porque hay modos con dos rondas de baneo y el segundo
     también hay que avisarlo. */
  _avisar(momento, datos, clave = momento) {
    if (this._avisados.has(clave)) return;
    this._avisados.add(clave);
    this.emit('momento', { momento, datos });
  }

  async _selección() {
    if (!this._campeones && this.lcu.campeones) {
      /* Si el catálogo no viene, se sigue igual con los ids: mejor un aviso
         que diga "campeón 103" que ningún aviso. */
      this._campeones = await this.lcu.campeones().catch(() => new Map());
    }
    let sesion = null;
    try { sesion = await this.lcu.champSelect(); }
    catch (e) { if (e.codigo !== 404) throw e; }

    const r = resumen(sesion, this._campeones ?? new Map());
    /* Sin sesión no se pisa lo último que sí se supo: el panel sigue mostrando
       algo y, sobre todo, el cierre de partida no depende de este objeto. */
    if (!r) return;
    this.estado.seleccion = r;

    this._avisar('entraste', r);
    if (r.miTurno && r.tipoTurno === 'ban') this._avisar('tuTurnoBan', r, `ban:${r.accionId}`);
    if (r.miTurno && r.tipoTurno === 'pick') this._avisar('tuTurnoPick', r, `pick:${r.accionId}`);
    if (r.miTurno && r.tipoTurno === 'pick' && !r.yaPickee &&
        r.segundos > 0 && r.segundos <= this.ajustes.avisarUltimos) {
      this._avisar('ultimoAviso', r, `apuro:${r.accionId}`);
    }
  }

  _programarAceptacion() {
    const { retardoMs, variacionMs } = this.ajustes;
    const espera = Math.max(0, Math.round(retardoMs + (this._azar() * 2 - 1) * variacionMs));
    this.estado.aceptando = true;
    this.emit('aceptando', { enMs: espera });

    const prometido = new Promise((_, rechazar) => { this._cancelar = rechazar; });
    const dormir = new Promise((r) => setTimeout(r, espera));

    Promise.race([dormir, prometido])
      .then(async () => {
        if (!this._cancelar) return;          // lo cancelaron justo antes
        this._cancelar = null;
        await this.lcu.aceptar();
        this.cuenta.aceptadas++;
        this.estado.aceptando = false;
        this.emit('aceptado', { tras: espera });
      })
      .catch((e) => {
        this.estado.aceptando = false;
        if (e && e.message && !/cancel|detuvo|cayó/i.test(String(e))) {
          this.cuenta.errores++;
          this.emit('problema', { mensaje: `no pude aceptar: ${e.message}` });
        }
      });
  }

  instantanea() {
    return {
      ...this.estado,
      ajustes: this.ajustes,
      cuenta: { ...this.cuenta, minutosCorriendo: Math.round((Date.now() - this.cuenta.desde) / 60000) },
    };
  }
}
