(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const hora = (t) => new Date(t).toLocaleTimeString('es-AR', { hour12: false });
  /* Todo POST lleva la cabecera propia: el servidor rechaza los que no la
     traen, que es lo que frena a otra página que quiera tocar el panel. */
  const post = (ruta) => fetch(ruta, { method: 'POST', headers: { 'x-auto-accept': '1' } });
  const DURACION_READY_CHECK = 12;
  let esLocal = null;

  /* El cliente nombra las fases en inglés y en una palabra; acá se dicen como
     las diría alguien sentado al lado. */
  const FASES = {
    None: 'Listo', Lobby: 'En la sala', Matchmaking: 'Buscando partida', ReadyCheck: '¡Partida encontrada!',
    ChampSelect: 'Selección', GameStart: 'Cargando', InProgress: 'En partida', Reconnect: 'Reconectando',
    WaitingForStats: 'Terminó', PreEndOfGame: 'Terminó', EndOfGame: 'Terminó', 'sin cliente': 'Sin cliente',
  };
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
    /* Desde el teléfono se esconde lo que solo se cambia en la Mac, y no se
       piden los canales, que el servidor no le da. */
    if (esLocal !== d.local) {
      esLocal = d.local !== false;
      document.body.dataset.local = String(esLocal);
      if (esLocal) { cargarCanales(); cargarRemoto(); }
    }
    $('#conex').dataset.ok = String(!!d.conectado);
    $('#conex-txt').textContent = d.conectado ? 'cliente conectado' : 'sin cliente';

    const fase = d.fase ?? '—';
    $('#fase').dataset.f = fase;
    $('#fase-txt').textContent = FASES[fase] ?? fase;
    $('#fase-sub').textContent = SUBTITULOS[fase] ?? 'esperando';

    /* El bloque del ready check se ve mientras haya algo que decidir: cuando
       la app está por aceptar, y también en pausa, que es justo cuando el
       botón "Aceptar ya" hace falta. */
    const activo = d.ajustes?.activo !== false;
    const cuenta = $('#cuenta');
    const decidir = d.fase === 'ReadyCheck' && !d.respondido;
    cuenta.hidden = !(d.aceptando || decidir);
    if (!cuenta.hidden) {
      const n = d.restante ?? 0;
      $('#anillo-n').textContent = n;
      $('#anillo').style.setProperty('--p', String(Math.min(1, n / DURACION_READY_CHECK)));
      $('#anillo').dataset.apremio = String(n <= 4);
      $('#anillo-txt').innerHTML = d.aceptando
        ? `acepto en <b>${d.ajustes?.retardoMs ?? 0} ms ±${d.ajustes?.variacionMs ?? 0}</b>`
        : activo ? 'saltó la partida' : '<b>estás en pausa:</b> aceptala vos';
      $('#cancelar').hidden = !d.aceptando;
    }

    const pausa = $('#pausa');
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
    pintarSeleccion(d.seleccion, d.plan);

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
  let ultimaSel = null, ultimoPlan = null;
  function pintarSeleccion(s, plan) {
    const caja = $('#seleccion');
    caja.hidden = !s;
    ultimaSel = s; ultimoPlan = plan;
    if (!s) { reloj = null; cerrarHoja(); return; }
    pintarJugada(s, plan ?? {});

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

  /* --------------------------------------------------------- tu jugada
     Dos casillas, Banear y Pickear. Lo que elegís queda marcado en el
     cliente; fijarlo es otro paso y lleva dos toques. */
  const icono = (id) => `api/icono/${Number(id)}`;
  function pintarSlot(tipo, { visible, hecho, hechoNombre, hechoId, elegido }) {
    const el = $(`#slot-${tipo}`);
    el.hidden = !visible;
    if (!visible) return;
    el.disabled = !!hecho;
    el.dataset.elegido = String(!!(elegido || hecho));
    const img = el.querySelector('img');
    /* Hecho, muestra la cara de lo que baneaste o elegiste; si no, la de lo
       que tenés marcado. */
    const id = hecho ? (hechoId ?? null) : (elegido?.id ?? null);
    if (id && img.dataset.id !== String(id)) { img.src = icono(id); img.dataset.id = String(id); }
    img.hidden = !id;
    el.querySelector('small').textContent = hecho ? (tipo === 'ban' ? 'Baneaste' : 'Elegiste')
                                                  : (tipo === 'ban' ? 'Banear' : 'Pickear');
    el.querySelector('b').textContent = hecho ? (hechoNombre ?? '—') : (elegido?.nombre ?? 'Elegir');
  }
  function pintarJugada(s, plan) {
    /* Sin plan, la casilla muestra lo que esté marcado en el cliente: si lo
       elegiste en la PC, el teléfono lo ve igual. */
    const enCliente = (id, nombre) => (id ? { id, nombre } : null);
    pintarSlot('ban', { visible: !!(s.banId || s.yaBanee), hecho: s.yaBanee && !s.banId,
                        hechoNombre: s.miBan, hechoId: s.miBanId, elegido: plan.ban ?? enCliente(s.banMarcadoId, s.banMarcado) });
    pintarSlot('pick', { visible: !!(s.pickId || s.yaPickee), hecho: s.yaPickee,
                         hechoNombre: s.miCampeon, hechoId: s.miPickId, elegido: plan.pick ?? enCliente(s.pickMarcadoId, s.pickMarcado) });
    $('#jugada').hidden = $('#slot-ban').hidden && $('#slot-pick').hidden;

    /* El botón grande aparece solo en tu turno, y dice exactamente qué va a
       hacer: "Banear Zed", "Fijar Ahri". */
    const tipo = s.miTurno ? s.tipoTurno : null;
    const nombre = tipo ? (plan[tipo]?.nombre ?? s.marcado) : null;
    const fijar = $('#fijar');
    fijar.hidden = !(tipo && nombre) || s.accionId === accionFijada;
    if (!fijar.hidden && fijar.dataset.armado !== 'true') {
      fijar.textContent = `${tipo === 'ban' ? 'Banear' : 'Fijar'} ${nombre}`;
    }
    fijar.dataset.tipo = tipo ?? '';
    fijar.dataset.nombre = nombre ?? '';
  }
  function resultadoSel(ok, txt) {
    const el = $('#sel-resultado');
    el.textContent = txt;
    if (ok === null) el.removeAttribute('data-ok'); else el.dataset.ok = String(ok);
  }
  let desarmar = null;
  /* La acción que acabás de fijar. El estado nuevo llega con el próximo
     sondeo, hasta un segundo después, y un sondeo viejo volvía a mostrar el
     botón ofreciendo algo ya hecho. */
  let accionFijada = null;
  $('#fijar').addEventListener('click', async () => {
    const b = $('#fijar');
    const { tipo, nombre } = b.dataset;
    if (!tipo) return;
    if (b.dataset.armado !== 'true') {
      b.dataset.armado = 'true';
      b.textContent = `Tocá otra vez para ${tipo === 'ban' ? 'banear' : 'fijar'} ${nombre}`;
      clearTimeout(desarmar);
      desarmar = setTimeout(() => { b.dataset.armado = 'false'; pintarJugada(ultimaSel ?? {}, ultimoPlan ?? {}); }, 3000);
      return;
    }
    clearTimeout(desarmar);
    b.dataset.armado = 'false';
    b.disabled = true;
    const r = await post(`api/fijar?tipo=${tipo}`).then((x) => x.json()).catch(() => ({ ok: false, detalle: 'sin respuesta' }));
    b.disabled = false;
    if (r.ok) { accionFijada = ultimaSel?.accionId ?? null; b.hidden = true; }
    resultadoSel(r.ok, r.ok ? (tipo === 'ban' ? `Baneaste ${r.campeon}.` : `Fijaste ${r.campeon}.`) : r.detalle);
    traer();
  });

  /* La hoja: buscador arriba, los últimos que elegiste, y todos. */
  let hojaTipo = null;
  const sinTildes = (t) => String(t).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  function boton(c, elegido) {
    return `<li data-busca="${esc(sinTildes(c.nombre))}"><button type="button" data-id="${c.id}" aria-pressed="${c.id === elegido}">
      <img src="${icono(c.id)}" alt="" loading="lazy" width="52" height="52"><span>${esc(c.nombre)}</span></button></li>`;
  }
  async function abrirHoja(tipo) {
    hojaTipo = tipo;
    $('#hoja-titulo').textContent = tipo === 'ban' ? 'Elegí qué banear' : 'Elegí tu pick';
    $('#hoja-buscar').value = '';
    $('#hoja-grilla').innerHTML = ''; $('#hoja-recientes').innerHTML = '';
    $('#hoja').hidden = false;
    document.body.classList.add('con-hoja');
    const d = await fetch(`api/campeones?tipo=${tipo}`).then((r) => r.json()).catch(() => null);
    if (hojaTipo !== tipo) return;
    const lista = d?.campeones ?? [];
    const elegido = d?.plan?.[tipo]?.id ?? null;
    const porId = new Map(lista.map((c) => [c.id, c]));
    const recientes = (d?.recientes ?? []).map((id) => porId.get(id)).filter(Boolean);
    $('#hoja-recientes').innerHTML = recientes.map((c) => boton(c, elegido)).join('');
    $('#hoja-recientes-rotulo').hidden = !recientes.length;
    $('#hoja-grilla').innerHTML = lista.map((c) => boton(c, elegido)).join('');
    $('#hoja-vacia').hidden = lista.length > 0;
    $('#hoja-quitar').hidden = !elegido;
    /* En la Mac el cursor va directo al buscador; en el teléfono no, porque
       abrir el teclado tapa media grilla. */
    if (matchMedia('(pointer:fine)').matches) $('#hoja-buscar').focus();
  }
  function cerrarHoja() {
    if ($('#hoja').hidden) return;
    $('#hoja').hidden = true;
    hojaTipo = null;
    document.body.classList.remove('con-hoja');
  }
  async function planear(campeon) {
    const tipo = hojaTipo;
    cerrarHoja();
    const r = await post(`api/plan?tipo=${tipo}&campeon=${campeon}`).then((x) => x.json()).catch(() => ({ ok: false, detalle: 'sin respuesta' }));
    const nombre = r.plan?.[tipo]?.nombre;
    /* El mensaje dice lo que de verdad pasó en el cliente: marcado ahora, o
       guardado hasta que llegue el turno. */
    const s = ultimaSel ?? {};
    const ahora = s.miTurno && s.tipoTurno === tipo;
    resultadoSel(r.ok, !r.ok ? r.detalle
      : !nombre ? 'Elección quitada.'
      : ahora ? `${nombre} quedó marcado. Confirmalo con el botón.`
      : tipo === 'pick' && s.fase === 'PLANNING' ? `${nombre} quedó marcado: tu equipo ya lo ve.`
      : `${nombre} queda guardado: se marca solo cuando te toque.`);
    traer();
  }
  for (const tipo of ['ban', 'pick']) $(`#slot-${tipo}`).addEventListener('click', () => abrirHoja(tipo));
  for (const id of ['#hoja-grilla', '#hoja-recientes']) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button[data-id]');
      if (b) planear(Number(b.dataset.id));
    });
  }
  $('#hoja-quitar').addEventListener('click', () => planear(0));
  $('#hoja-cerrar').addEventListener('click', cerrarHoja);
  $('#hoja').addEventListener('click', (e) => { if (e.target.id === 'hoja') cerrarHoja(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarHoja(); });
  $('#hoja-buscar').addEventListener('input', (e) => {
    const q = sinTildes(e.target.value.trim());
    for (const li of $('#hoja-grilla').children) li.hidden = !!q && !li.dataset.busca.includes(q);
    $('#hoja-recientes').hidden = !!q;
    $('#hoja-recientes-rotulo').hidden = !!q || !$('#hoja-recientes').children.length;
  });

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
    await post('api/avisos?' + p);
    mostrarResultado(true, 'guardado');
    cargarCanales(); traer();
  });
  $('#probar-aviso').addEventListener('click', async () => {
    mostrarResultado(null, 'enviando…');
    const r = await post('api/probar-aviso').then((x) => x.json()).catch(() => ({ ok: false, detalle: 'sin respuesta' }));
    mostrarResultado(r.ok, r.ok ? 'enviado — miralo en el iPhone' : r.detalle);
    traer();
  });
  function mostrarResultado(ok, txt) {
    const el = $('#resultado-aviso');
    el.textContent = txt;
    if (ok === null) el.removeAttribute('data-ok'); else el.dataset.ok = String(ok);
  }

  /* ------------------------------------------- el panel en el teléfono */
  let enlaces = [];
  async function cargarRemoto(datos) {
    const d = datos ?? await fetch('api/remoto').then((r) => r.json()).catch(() => null);
    if (!d) return;
    enlaces = d.enlaces ?? [];
    $('#remoto-activo').checked = !!d.activo;
    $('#remoto-detalle').hidden = !d.activo;
    $('#remoto-enlaces').innerHTML = enlaces.map((e) =>
      `<li><small>${esc(e.etiqueta)}</small>${esc(e.url)}</li>`).join('') ||
      '<li>No encuentro una red local. ¿La Mac está conectada al Wi-Fi?</li>';
  }
  function resultadoRemoto(ok, txt) {
    const el = $('#remoto-resultado');
    el.textContent = txt;
    if (ok === null) el.removeAttribute('data-ok'); else el.dataset.ok = String(ok);
  }
  $('#remoto-activo').addEventListener('change', async (ev) => {
    const r = await post(`api/remoto?activo=${ev.target.checked ? 'si' : 'no'}`).then((x) => x.json()).catch(() => null);
    resultadoRemoto(null, '');
    cargarRemoto(r);
    traer();
  });
  $('#remoto-copiar').addEventListener('click', async () => {
    if (!enlaces[0]) return;
    try { await navigator.clipboard.writeText(enlaces[0].url); resultadoRemoto(true, 'copiado — pegalo en Safari del iPhone'); }
    catch { resultadoRemoto(false, 'no pude copiar: seleccioná el enlace a mano'); }
  });
  $('#remoto-mandar').addEventListener('click', async () => {
    resultadoRemoto(null, 'enviando…');
    const r = await post('api/remoto/mandar').then((x) => x.json()).catch(() => ({ ok: false, detalle: 'sin respuesta' }));
    resultadoRemoto(r.ok, r.ok ? 'enviado — tocá la notificación' : r.detalle);
    traer();
  });
  $('#remoto-rotar').addEventListener('click', async () => {
    const r = await post('api/remoto?rotar=si').then((x) => x.json()).catch(() => null);
    cargarRemoto(r);
    resultadoRemoto(true, 'llave nueva: el enlace viejo ya no anda');
    traer();
  });

  const traer = () => fetch('api/estado').then((r) => r.json()).then(pintar).catch(() => {});
  traer(); setInterval(traer, 700);

  $('#pausa').addEventListener('click', () => post('api/pausa').then(traer));
  $('#cancelar').addEventListener('click', () => post('api/cancelar').then(traer));
  $('#aceptar-ya').addEventListener('click', () => post('api/aceptar').then(traer));

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
      post(`api/ajustes?retardoMs=${$('#retardo').value}&variacionMs=${$('#variacion').value}`).then(traer);
    });
  }
})();
