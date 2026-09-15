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
    $('#bitacora').innerHTML = (d.bitacora ?? []).map((l) =>
      `<li data-t="${esc(l.tipo)}"><span class="hora">${hora(l.t)}</span><span>${esc(l.texto)}</span></li>`).join('');
  }

  const traer = () => fetch('api/estado').then((r) => r.json()).then(pintar).catch(() => {});
  traer(); setInterval(traer, 700);

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
