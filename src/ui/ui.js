(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const hora = (t) => new Date(t).toLocaleTimeString('es-AR', { hour12: false });

  const SUBTITULOS = {
    None: 'el cliente está abierto, no estás en cola',
    Lobby: 'en la sala, todavía sin buscar',
    Matchmaking: 'buscando partida',
    ReadyCheck: 'saltó la partida',
    ChampSelect: 'selección de campeones',
    InProgress: 'partida en curso',
    'sin cliente': 'no puedo hablar con el cliente',
  };

  let tocandoSliders = false;

  function pintar(d) {
    $('#conex').dataset.ok = String(!!d.conectado);
    $('#conex-txt').textContent = d.conectado ? 'cliente conectado' : 'sin cliente';

    const fase = d.fase ?? '—';
    $('#fase').dataset.f = fase;
    $('#fase-txt').textContent = fase === 'None' ? 'Listo' : fase;
    $('#fase-sub').textContent = SUBTITULOS[fase] ?? 'esperando';

    const cuenta = $('#cuenta');
    cuenta.hidden = !d.aceptando;
    if (d.aceptando) {
      $('#anillo-n').textContent = d.restante ?? 0;
      $('#anillo-ms').textContent = `${d.ajustes?.retardoMs ?? 0} ms ±${d.ajustes?.variacionMs ?? 0}`;
    }

    const pausa = $('#pausa');
    const activo = d.ajustes?.activo !== false;
    pausa.textContent = activo ? 'Pausar' : 'Reanudar';
    pausa.dataset.pausado = String(!activo);

    if (d.cuenta) {
      $('#c-aceptadas').textContent = d.cuenta.aceptadas;
      $('#c-canceladas').textContent = d.cuenta.canceladas;
      $('#c-errores').textContent = d.cuenta.errores;
      $('#c-min').textContent = d.cuenta.minutosCorriendo ?? 0;
    }
    if (d.ajustes && !tocandoSliders) {
      $('#retardo').value = d.ajustes.retardoMs;
      $('#retardo-v').textContent = `${d.ajustes.retardoMs} ms`;
      $('#variacion').value = d.ajustes.variacionMs;
      $('#variacion-v').textContent = `± ${d.ajustes.variacionMs} ms`;
    }
    pintarSeleccion(d.seleccion);

    $('#bitacora').innerHTML = (d.bitacora ?? []).map((l) =>
      `<li data-t="${esc(l.tipo)}"><span class="hora">${hora(l.t)}</span><span>${esc(l.texto)}</span></li>`).join('');
  }


  /* ------------------------------------------ selección de campeones
     El servidor sondea al cliente una vez por segundo; el panel se refresca
     cada 700 ms. Si el número se pintara tal cual llega, el reloj daría
     saltos. Por eso se ancla el último valor del servidor y se descuenta
     local hasta que llegue uno nuevo: el contador baja parejo y nunca miente
     más de un segundo. */
  let reloj = null;
  function pintarSeleccion(s) {
    const caja = $('#seleccion');
    caja.hidden = !s;
    if (!s) { reloj = null; return; }

    caja.dataset.turno = String(!!s.miTurno);
    $('#sel-turno').textContent =
        s.miTurno && s.tipoTurno === 'pick' ? 'Te toca PICKEAR'
      : s.miTurno && s.tipoTurno === 'ban' ? 'Te toca BANEAR'
      : s.yaPickee ? `Ya elegiste${s.miCampeon ? `: ${s.miCampeon}` : ''}`
      : s.turnosAntes === 0 ? 'Pickeás vos primero'
      : s.turnosAntes > 0 ? `Faltan ${s.turnosAntes} ${s.turnosAntes === 1 ? 'pick' : 'picks'} para el tuyo`
      : 'Esperando tu turno';

    $('#sel-detalle').textContent = [
      s.miPosicion ? `Vas ${s.miPosicion}` : null,
      s.yaBanee ? 'ya baneaste' : null,
    ].filter(Boolean).join(' · ') || 'sin posición asignada';

    $('#sel-equipo').innerHTML = (s.equipo ?? []).map((j) => `
      <li data-yo="${j.esYo}" data-listo="${!!j.campeon}">
        <span class="pos">${esc(j.posicion ?? '—')}</span>
        <span class="camp">${esc(j.campeon ?? 'sin elegir')}</span>
        ${j.esYo ? '<span class="pos" style="width:auto;margin-left:auto">vos</span>' : ''}
      </li>`).join('');

    $('#sel-baneos').textContent = s.baneos?.length ? `Baneados: ${s.baneos.join(', ')}` : '';

    if (s.infinito) { reloj = null; $('#sel-seg').textContent = '∞'; $('#sel-reloj').dataset.apremio = 'false'; return; }
    const ahora = Date.now();
    if (!reloj) { reloj = { origen: s.segundos, desde: ahora }; }
    else {
      /* Un número que sube es lo único que se ve roto de verdad. Si el valor
         del servidor es menor, se adopta; si es un poco mayor, es el desfasaje
         normal entre sondeos y se ignora; si es mucho mayor, empezó otra fase
         y hay que volver a anclar. */
      const mostrado = Math.max(0, reloj.origen - Math.floor((ahora - reloj.desde) / 1000));
      if (s.segundos < mostrado || s.segundos > mostrado + 3) reloj = { origen: s.segundos, desde: ahora };
    }
    tictac();
  }
  function tictac() {
    if (!reloj || $('#seleccion').hidden) return;
    const n = Math.max(0, reloj.origen - Math.floor((Date.now() - reloj.desde) / 1000));
    $('#sel-seg').textContent = n;
    $('#sel-reloj').dataset.apremio = String(n <= 10);
  }
  setInterval(tictac, 250);

  /* ------------------------------------------------------------ avisos */
  let canales = [];
  async function cargarCanales() {
    const d = await fetch('api/canales').then((r) => r.json()).catch(() => null);
    if (!d) return;
    canales = d.canales;
    $('#canal').innerHTML = canales.map((c) =>
      `<option value="${esc(c.id)}"${c.disponible ? '' : ' disabled'}>${esc(c.etiqueta)}${c.disponible ? '' : ' — no disponible acá'}</option>`).join('');
    $('#canal').value = d.actual.canal;
    /* El destino no se rellena con el valor real: puede tener un secreto y
       queda a la vista de cualquiera que mire la pantalla. Se muestra
       recortado como marcador, y solo se manda si escribís uno nuevo. */
    $('#destino').value = '';
    $('#destino').placeholder = d.actual.destinoVisible || '—';
    $('#avisar-seleccion').checked = d.actual.seleccion !== false;
    pintarCanal();
  }
  function pintarCanal() {
    const c = canales.find((x) => x.id === $('#canal').value);
    $('#canal-ayuda').textContent = c?.ayuda ?? '';
    $('#fila-destino').style.display = c && c.destinoRotulo ? '' : 'none';
    if (c?.destinoRotulo) $('#destino-rotulo').textContent = c.destinoRotulo;
  }
  $('#canal').addEventListener('change', pintarCanal);
  $('#guardar-aviso').addEventListener('click', async () => {
    const p = new URLSearchParams({ canal: $('#canal').value,
                                    seleccion: $('#avisar-seleccion').checked ? 'si' : 'no' });
    if ($('#destino').value.trim()) p.set('destino', $('#destino').value.trim());
    await fetch('api/avisos?' + p, { method: 'POST' });
    mostrarResultado(true, 'guardado');
    cargarCanales(); traer();
  });
  $('#probar-aviso').addEventListener('click', async () => {
    mostrarResultado(null, 'enviando…');
    const r = await fetch('api/probar-aviso', { method: 'POST' }).then((x) => x.json()).catch(() => ({ ok: false, detalle: 'sin respuesta' }));
    mostrarResultado(r.ok, r.ok ? 'enviado — miralo en el iPhone' : r.detalle);
    traer();
  });
  function mostrarResultado(ok, txt) {
    const el = $('#resultado-aviso');
    el.textContent = txt;
    if (ok === null) el.removeAttribute('data-ok'); else el.dataset.ok = String(ok);
  }

  const traer = () => fetch('api/estado').then((r) => r.json()).then(pintar).catch(() => {});
  traer(); cargarCanales(); setInterval(traer, 700);

  $('#pausa').addEventListener('click', () => fetch('api/pausa', { method: 'POST' }).then(traer));
  $('#cancelar').addEventListener('click', () => fetch('api/cancelar', { method: 'POST' }).then(traer));

  /* Mientras el dedo está en el slider no se pisa el valor con el del servidor. */
  for (const [id, sufijo] of [['retardo', ' ms'], ['variacion', ' ms']]) {
    const el = document.getElementById(id);
    el.addEventListener('pointerdown', () => { tocandoSliders = true; });
    el.addEventListener('input', () => {
      document.getElementById(id + '-v').textContent =
        (id === 'variacion' ? '± ' : '') + el.value + sufijo;
    });
    el.addEventListener('change', () => {
      tocandoSliders = false;
      fetch(`api/ajustes?retardoMs=${$('#retardo').value}&variacionMs=${$('#variacion').value}`,
        { method: 'POST' }).then(traer);
    });
  }
})();
