'use strict';
/* Publicador de partidas · Tazón para Dos
   - Dibuja el post (4:5) y la historia (9:16) con las plantillas «partida_post» y «partida_historia» del kit de marca.
   - «Enviar a revisión» sube partida.json + post.jpg + historia.jpg en un solo commit a partidas/<id>/ (estado: pendiente).
   - «Aprobar» cambia el estado a «aprobada»; la acción de GitHub (.github/workflows/publicar.yml) publica en
     Telegram, Facebook e Instagram, guarda el resultado en partida.json y actualiza partidas.json para la web.
   - WhatsApp no permite publicar por API en grupos ni canales: «Compartir» abre el menú del teléfono con la imagen y el texto. */
(function () {
  const KIT = 'https://thetrashkat.github.io/tazon-para-dos-marca/';
  const REPO_DEF = 'TheTrashKat/tazon-partidas';
  const WEB = 'https://thetrashkat.github.io/tazon-para-dos-web/#partidas';
  const D = window.TPDDraw, T = window.TPD;
  const PLANTILLA = { post: byId('partida_post'), historia: byId('partida_historia') };
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  function byId(id) { return (window.TPDTemplates || []).find((t) => t.id === id); }

  if (!D || !PLANTILLA.post || !PLANTILLA.historia) {
    document.body.insertAdjacentHTML('afterbegin', '<p style="padding:16px;background:#EA6077;font-weight:700">No pude cargar las plantillas del kit de marca. Revisa la conexión y recarga la página.</p>');
    return;
  }

  /* ------------------------------------------------------------ almacenamiento local (solo comodidad) */
  const guardado = {
    get(k, d = null) { try { const v = localStorage.getItem('tpd-partidas:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('tpd-partidas:' + k, JSON.stringify(v)); } catch { /* modo privado */ } },
    del(k) { try { localStorage.removeItem('tpd-partidas:' + k); } catch { /* nada */ } },
  };

  /* ------------------------------------------------------------ fuentes (también incrustadas para exportar) */
  const FUENTES = [['Barlow Condensed', 800, 'normal', 'BarlowCondensed-ExtraBold.ttf'], ['Barlow', 500, 'normal', 'Barlow-Medium.ttf'],
    ['Barlow', 600, 'normal', 'Barlow-SemiBold.ttf'], ['Barlow', 700, 'normal', 'Barlow-Bold.ttf'], ['Barlow', 600, 'italic', 'Barlow-SemiBoldItalic.ttf']];
  let fuentesCss = '';
  async function cargarFuentes() {
    const css = [];
    await Promise.all(FUENTES.map(async ([fam, peso, estilo, archivo]) => {
      try {
        const buf = await (await fetch(KIT + 'tools/fonts/' + archivo)).arrayBuffer();
        const face = new FontFace(fam, buf, { weight: String(peso), style: estilo });
        await face.load(); document.fonts.add(face);
        css.push(`@font-face{font-family:'${fam}';font-weight:${peso};font-style:${estilo};src:url(data:font/ttf;base64,${b64(new Uint8Array(buf))}) format('truetype')}`);
      } catch (e) { console.warn('Fuente no cargada', archivo, e); }
    }));
    fuentesCss = css.join('\n');
  }
  function b64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  const b64Texto = (s) => b64(new TextEncoder().encode(s));
  const textoDeB64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

  /* ------------------------------------------------------------ fechas y textos */
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const fechaLocal = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
  const fechaLarga = (iso) => { const f = fechaLocal(iso); return `${cap(DIAS[f.getDay()])} ${f.getDate()} de ${MESES[f.getMonth()]}`; };
  function hora12(h) {
    if (!h) return '';
    let [hh, mm] = h.split(':').map(Number); const pm = hh >= 12; hh = hh % 12 || 12;
    return `${hh}:${String(mm).padStart(2, '0')} ${pm ? 'p.m.' : 'a.m.'}`;
  }
  const rangoHora = (a, b) => (b ? `${hora12(a)} – ${hora12(b)}` : hora12(a));
  const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'partida';
  const hoyIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const LUGAR = `${T.location.address} · ${T.location.locality}`;
  const USUARIO = T.links?.instagram_handle || '@tazonparados';
  const WA_GRUPO = T.links?.whatsapp_community || 'https://chat.whatsapp.com/Gf85g13vkeuBiRvgvgYj1q';

  /* ------------------------------------------------------------ formulario */
  const form = $('#form');
  const campos = ['titulo', 'juego', 'descripcion', 'fecha', 'cupos', 'inicio', 'fin', 'lugar', 'nivel', 'narra', 'reserva', 'cta', 'enfoque', 'receta', 'invertir'];
  let foto = '';          // data URL reducida (no se sube al repo: solo se usa para dibujar)
  let editando = null;    // { id, sha } cuando se edita una partida existente
  let textoManual = false;

  $('#f-receta').replaceChildren(...Object.entries(D.RECIPES).map(([k, r]) => new Option(r.label, k)));
  $('#f-lugar').value = LUGAR;
  $('#f-reserva').value = WA_GRUPO;
  $('#f-fecha').value = proximoSabado();
  function proximoSabado() {
    const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function leer() {
    const v = {};
    for (const c of campos) { const el = form.elements[c]; v[c] = el.type === 'checkbox' ? el.checked : el.value.trim(); }
    v.cupos = v.cupos ? Number(v.cupos) : '';
    return v;
  }
  function escribir(p) {
    for (const c of campos) {
      const el = form.elements[c]; if (!el || p[c] === undefined) continue;
      if (el.type === 'checkbox') el.checked = !!p[c]; else el.value = p[c];
    }
  }
  // Valores para las plantillas del kit
  function valores(p) {
    const f = p.fecha ? fechaLocal(p.fecha) : null;
    return {
      foto, enfoque: p.enfoque, receta: p.receta, invertir: p.invertir,
      juego: p.juego, titulo: p.titulo || 'NOMBRE DE LA PARTIDA.',
      dia: f ? String(f.getDate()) : '', mes: f ? MESES[f.getMonth()].slice(0, 3).toUpperCase() : '',
      fecha: p.fecha ? fechaLarga(p.fecha) : '', hora: rangoHora(p.inicio, p.fin), lugar: p.lugar,
      nivel: p.nivel, cupos: p.cupos ? `${p.cupos} ${p.cupos === 1 ? 'CUPO' : 'CUPOS'}` : '',
      narra: p.narra ? `Narra: ${p.narra}` : '', cta: p.cta, usuario: USUARIO,
    };
  }
  function textoRedes(p) {
    const l = [];
    l.push(`🎲 ${String(p.titulo || '').toUpperCase()}`);
    if (p.juego) l.push(p.juego);
    l.push('');
    if (p.descripcion) l.push(p.descripcion, '');
    if (p.fecha) l.push(`📅 ${fechaLarga(p.fecha)} · ${rangoHora(p.inicio, p.fin)}`);
    if (p.lugar) l.push(`📍 ${p.lugar}`);
    const info = [p.cupos ? `${p.cupos} ${p.cupos === 1 ? 'cupo' : 'cupos'}` : '', p.nivel ? p.nivel.toLowerCase() : ''].filter(Boolean).join(' · ');
    if (info) l.push(`👥 ${cap(info)}`);
    if (p.narra) l.push(`🎙️ Narra: ${p.narra}`);
    l.push('');
    l.push(p.reserva ? `Reserva tu cupo: ${p.reserva}` : 'Escríbenos para reservar tu cupo.');
    l.push('Ven a jugar. Quédate a compartir.', '');
    const tagJuego = p.juego ? '#' + slug(p.juego).split('-').map(cap).join('').replace(/^(\d)/, 'Rol$1') : '';
    l.push(['#TazónParaDos', '#JuegosDeRol', '#RolEnBogotá', '#Engativá', '#LGBTI', tagJuego].filter(Boolean).join(' '));
    return l.join('\n');
  }

  /* ------------------------------------------------------------ dibujo y exportación */
  function svg(t, v, { exportar = false } = {}) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t.w} ${t.h}" width="${t.w}" height="${t.h}">` +
      `<title>${D.esc(t.name)} · Tazón para Dos</title>` + D.defs(exportar ? fuentesCss : '') + t.render(v) + '</svg>';
  }
  async function jpeg(t, v) {
    const url = URL.createObjectURL(new Blob([svg(t, v, { exportar: true })], { type: 'image/svg+xml' }));
    try {
      const img = new Image(); img.src = url; await img.decode();
      await new Promise((r) => setTimeout(r, 150)); // las fuentes incrustadas del SVG necesitan un momento
      const c = document.createElement('canvas'); c.width = t.w; c.height = t.h;
      const x = c.getContext('2d'); x.fillStyle = '#FFFDF8'; x.fillRect(0, 0, t.w, t.h); x.drawImage(img, 0, 0, t.w, t.h);
      return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92)); // Instagram solo acepta JPEG
    } finally { URL.revokeObjectURL(url); }
  }

  let pendienteDibujo = 0;
  function actualizar() {
    cancelAnimationFrame(pendienteDibujo);
    pendienteDibujo = requestAnimationFrame(() => {
      const p = leer(), v = valores(p);
      $('#prev-post').innerHTML = svg(PLANTILLA.post, v);
      $('#prev-historia').innerHTML = svg(PLANTILLA.historia, v);
      if (!textoManual) $('#f-texto').value = textoRedes(p);
      guardado.set('borrador', { ...p, foto, editando, texto: $('#f-texto').value, textoManual });
    });
  }
  form.addEventListener('input', () => { textoManual = false; actualizar(); });
  form.addEventListener('change', actualizar);
  $('#f-texto').addEventListener('input', () => { textoManual = true; guardado.set('borrador', { ...leer(), foto, editando, texto: $('#f-texto').value, textoManual }); });

  /* ------------------------------------------------------------ imagen */
  async function ponerFoto(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      foto = c.toDataURL('image/jpeg', 0.88);
      $('#f-quitar').checked = false;
      mostrarFoto(); actualizar();
    } finally { URL.revokeObjectURL(url); }
  }
  function mostrarFoto() {
    $('#foto-prev').hidden = !foto; if (foto) $('#foto-prev').src = foto;
    $('#foto-txt').textContent = foto ? 'Cambiar imagen' : 'Elegir o pegar imagen (opcional)';
  }
  $('#foto').addEventListener('click', () => $('#f-foto').click());
  $('#foto').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#f-foto').click(); } });
  $('#f-foto').addEventListener('change', (e) => { ponerFoto(e.target.files[0]); e.target.value = ''; });
  $('#f-quitar').addEventListener('change', (e) => { if (e.target.checked) { foto = ''; mostrarFoto(); actualizar(); } });
  $('#foto').addEventListener('dragover', (e) => e.preventDefault());
  $('#foto').addEventListener('drop', (e) => { e.preventDefault(); ponerFoto(e.dataTransfer.files[0]); });
  document.addEventListener('paste', (e) => {
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f && !$('#nueva').hidden) { e.preventDefault(); ponerFoto(f); }
  });

  /* ------------------------------------------------------------ descargar y compartir */
  const estado = (msg, el = '#estado') => { $(el).textContent = msg; };
  function descargar(nombre, blob) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function piezas() {
    const v = valores(leer());
    return { post: await jpeg(PLANTILLA.post, v), historia: await jpeg(PLANTILLA.historia, v) };
  }
  const idPartida = (p) => `${p.fecha}-${slug(p.titulo)}`;
  $('#b-descargar').addEventListener('click', async () => {
    const p = leer(); if (!p.titulo || !p.fecha) return estado('Falta el nombre o la fecha.');
    estado('Preparando imágenes…');
    const pz = await piezas();
    descargar(idPartida(p) + '-post.jpg', pz.post); descargar(idPartida(p) + '-historia.jpg', pz.historia);
    estado('✅ Imágenes descargadas.');
  });
  // Compartir: en el teléfono abre el menú del sistema (WhatsApp → grupo, canal o estado) con imagen + texto.
  async function compartir(texto, archivos, el) {
    try {
      if (archivos.length && navigator.canShare && navigator.canShare({ files: archivos })) {
        await navigator.clipboard?.writeText(texto).catch(() => {});
        await navigator.share({ files: archivos, text: texto });
        estado('✅ Listo. Si WhatsApp no pegó el texto, mantén presionado y elige «Pegar» (ya está copiado).', el);
        return;
      }
    } catch (e) { if (e.name === 'AbortError') return; }
    // Computador: copia el texto, descarga la imagen y abre WhatsApp Web con el texto
    await navigator.clipboard?.writeText(texto).catch(() => {});
    archivos.forEach((f) => descargar(f.name, f));
    window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank', 'noopener');
    estado('Se abrió WhatsApp con el texto y se descargó la imagen: adjúntala en el chat. El texto también quedó copiado.', el);
  }
  $('#b-wa').addEventListener('click', async () => {
    const p = leer(); if (!p.titulo || !p.fecha) return estado('Falta el nombre o la fecha.');
    estado('Preparando…');
    const pz = await piezas();
    await compartir($('#f-texto').value, [new File([pz.post], idPartida(p) + '.jpg', { type: 'image/jpeg' })], '#estado');
  });
  $('#b-limpiar').addEventListener('click', () => {
    if (!confirmar('¿Borrar el formulario y empezar una partida nueva?')) return;
    guardado.del('borrador'); location.hash = ''; location.reload();
  });
  function confirmar(msg) { return window.confirm(msg); }

  /* ------------------------------------------------------------ GitHub */
  const ajustes = () => ({ repo: guardado.get('repo', REPO_DEF) || REPO_DEF, token: guardado.get('token', '') });
  async function gh(ruta, opts = {}) {
    const { repo, token } = ajustes();
    if (!token) throw new Error('Falta el token: ve a «Ajustes».');
    const r = await fetch(`https://api.github.com/repos/${repo}${ruta}`, {
      ...opts, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) },
    });
    if (!r.ok) {
      let m = ''; try { m = (await r.json()).message; } catch { /* nada */ }
      if (r.status === 401) m = 'token inválido o vencido';
      if (r.status === 403 || r.status === 404) m = m + ' (¿el token tiene permiso «Contents: Read and write» en este repo?)';
      throw new Error(`GitHub ${r.status}: ${m}`);
    }
    return r.status === 204 ? null : r.json();
  }
  const blobB64 = async (blob) => b64(new Uint8Array(await blob.arrayBuffer()));
  // Un solo commit con varios archivos (API de datos de git)
  async function commit(archivos, mensaje) {
    const ref = await gh('/git/ref/heads/main');
    const padre = await gh(`/git/commits/${ref.object.sha}`);
    const arbol = [];
    for (const [ruta, contenido] of Object.entries(archivos)) {
      const b = await gh('/git/blobs', { method: 'POST', body: JSON.stringify(contenido instanceof Blob ? { content: await blobB64(contenido), encoding: 'base64' } : { content: contenido, encoding: 'utf-8' }) });
      arbol.push({ path: ruta, mode: '100644', type: 'blob', sha: b.sha });
    }
    const tree = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: padre.tree.sha, tree: arbol }) });
    const c = await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message: mensaje, tree: tree.sha, parents: [ref.object.sha] }) });
    await gh('/git/refs/heads/main', { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) });
    return c.sha;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = leer();
    if (!p.titulo || !p.fecha || !p.inicio) return estado('Falta el nombre, la fecha o la hora de inicio.');
    if (p.fecha < hoyIso()) return estado('La fecha ya pasó.');
    const b = $('#b-enviar'); b.disabled = true;
    try {
      estado('Dibujando las piezas…');
      const pz = await piezas();
      const id = editando?.id || idPartida(p);
      const previo = editando?.datos || {};
      const partida = {
        id, estado: 'pendiente', creada: previo.creada || new Date().toISOString(), actualizada: new Date().toISOString(),
        titulo: p.titulo, juego: p.juego, descripcion: p.descripcion, fecha: p.fecha, inicio: p.inicio, fin: p.fin, lugar: p.lugar,
        nivel: p.nivel, cupos: p.cupos, narra: p.narra, reserva: p.reserva, texto: $('#f-texto').value,
        diseno: { receta: p.receta, invertir: p.invertir, enfoque: p.enfoque, cta: p.cta, con_imagen: !!foto },
        imagenes: { post: 'post.jpg', historia: 'historia.jpg' },
        publicado: previo.publicado || {},
      };
      if (previo.estado === 'aprobada' && Object.keys(partida.publicado).length) partida.estado = 'aprobada'; // ya salió: solo se corrige la web
      estado('Subiendo a GitHub…');
      await commit({
        [`partidas/${id}/partida.json`]: JSON.stringify(partida, null, 2) + '\n',
        [`partidas/${id}/post.jpg`]: pz.post, [`partidas/${id}/historia.jpg`]: pz.historia,
      }, `${editando ? 'Actualiza' : 'Nueva'} partida: ${p.titulo} (${p.fecha})`);
      guardado.del('borrador'); editando = null;
      estado(partida.estado === 'aprobada' ? '✅ Partida actualizada en la web. Las redes no se vuelven a publicar.' : '✅ Enviada a revisión. Apruébala en la pestaña «Revisión» para publicarla.');
      $('#titulo-form').textContent = 'Nueva partida';
      cargarLista();
    } catch (err) { estado('❌ ' + err.message); } finally { b.disabled = false; }
  });

  /* ------------------------------------------------------------ revisión */
  let filtro = 'pendiente', todas = [], shaMain = 'main';
  const REDES = { telegram: 'Telegram', facebook: 'Facebook', instagram: 'Instagram', instagram_historia: 'IG historia' };
  async function cargarLista() {
    const { repo, token } = ajustes();
    estado('Cargando…', '#estado-rev');
    try {
      let rutas;
      if (token) {
        const ref = await gh('/git/ref/heads/main'); shaMain = ref.object.sha;
        const arbol = await gh(`/git/trees/${shaMain}?recursive=1`);
        rutas = arbol.tree.filter((x) => /^partidas\/[^/]+\/partida\.json$/.test(x.path));
        todas = await Promise.all(rutas.map(async (x) => {
          const b = await gh(`/git/blobs/${x.sha}`);
          return { ...JSON.parse(textoDeB64(b.content)), _sha: x.sha };
        }));
      } else {
        // Sin token: solo lectura desde el índice publicado (sin pendientes)
        const r = await fetch(`https://${repo.split('/')[0].toLowerCase()}.github.io/${repo.split('/')[1]}/partidas.json?t=${Date.now()}`);
        todas = r.ok ? (await r.json()).partidas : [];
        shaMain = 'main';
      }
      todas.sort((a, b) => (a.fecha + a.inicio).localeCompare(b.fecha + b.inicio));
      const n = todas.filter((x) => x.estado === 'pendiente').length;
      $('#n-pendientes').hidden = !n; $('#n-pendientes').textContent = n;
      estado(token ? '' : 'Sin token solo se ven las partidas aprobadas. Agrega tu token en «Ajustes».', '#estado-rev');
      pintarLista();
    } catch (err) { estado('❌ ' + err.message, '#estado-rev'); }
  }
  const urlImagen = (p, cual) => `https://raw.githubusercontent.com/${ajustes().repo}/${shaMain}/partidas/${p.id}/${p.imagenes?.[cual] || cual + '.jpg'}`;
  function pintarLista() {
    $$('[data-filtro]').forEach((b) => b.classList.toggle('primario', b.dataset.filtro === filtro));
    const hoy = hoyIso();
    const ver = todas.filter((p) => filtro === 'todas' || (p.estado === filtro && (filtro !== 'aprobada' || p.fecha >= hoy)));
    if (!ver.length) { $('#lista').innerHTML = `<div class="vacio">No hay partidas ${filtro === 'todas' ? '' : filtro === 'pendiente' ? 'pendientes' : 'aprobadas próximas'}.</div>`; return; }
    $('#lista').replaceChildren(...ver.map(tarjeta));
  }
  function tarjeta(p) {
    const el = document.createElement('article'); el.className = 'tarjeta';
    const pasada = p.fecha < hoyIso();
    const redes = Object.entries(p.publicado || {}).map(([k, r]) => {
      const nombre = REDES[k.split(':')[0]] || k; const extra = k.includes(':') ? ' ' + k.split(':').slice(1).join(':') : '';
      return `<span class="${r.ok ? 'ok' : 'error'}" title="${D.esc(r.error || r.fecha || '')}">${r.ok ? '✓' : '✗'} ${D.esc(nombre + extra)}</span>`;
    }).join('');
    el.innerHTML = `<img loading="lazy" alt="Post de ${D.esc(p.titulo)}" src="${urlImagen(p, 'post')}">
      <div class="cuerpo">
        <div><span class="pildora ${pasada ? 'pasada' : p.estado}">${pasada ? 'ya pasó' : D.esc(p.estado)}</span></div>
        <h3>${D.esc(p.titulo)}</h3>
        <div class="meta">${D.esc([p.juego, fechaLarga(p.fecha), rangoHora(p.inicio, p.fin)].filter(Boolean).join(' · '))}</div>
        ${redes ? `<div class="redes">${redes}</div>` : p.estado === 'aprobada' ? '<div class="meta">Publicando… recarga en un minuto.</div>' : ''}
        ${p.estado === 'pendiente' ? `<label>Texto para redes</label><textarea data-texto>${D.esc(p.texto || '')}</textarea>` : ''}
        <div class="botones"></div>
        <div class="estado"></div>
      </div>`;
    const bs = $('.botones', el), st = $('.estado', el);
    const boton = (txt, clase, fn) => { const b = document.createElement('button'); b.className = 'boton ' + clase; b.textContent = txt; b.onclick = async () => { b.disabled = true; try { await fn(); } catch (err) { st.textContent = '❌ ' + err.message; } finally { b.disabled = false; } }; bs.append(b); };
    if (p.estado === 'pendiente') {
      boton('Aprobar y publicar ↗', 'primario', async () => {
        if (!confirmar(`¿Publicar «${p.titulo}» en Telegram, Facebook e Instagram?`)) return;
        await guardarEstado(p, { estado: 'aprobada', texto: $('[data-texto]', el).value, aprobada: new Date().toISOString() }, `Aprueba partida: ${p.titulo}`);
        st.textContent = '✅ Aprobada. GitHub la publica en 1 o 2 minutos.'; setTimeout(cargarLista, 1500);
      });
      boton('Guardar texto', '', async () => { await guardarEstado(p, { texto: $('[data-texto]', el).value }, `Texto de partida: ${p.titulo}`); st.textContent = '✅ Texto guardado.'; });
    }
    if (p.estado !== 'cancelada') {
      boton('Compartir en WhatsApp', 'wa', async () => {
        st.textContent = 'Preparando…';
        const blob = await (await fetch(urlImagen(p, 'post'))).blob();
        await compartir(p.texto || '', [new File([blob], p.id + '.jpg', { type: 'image/jpeg' })], st);
      });
      boton('Historia', '', async () => { const blob = await (await fetch(urlImagen(p, 'historia'))).blob(); descargar(p.id + '-historia.jpg', blob); });
      boton('Copiar texto', '', async () => { await navigator.clipboard.writeText(p.texto || ''); st.textContent = '✅ Texto copiado.'; });
      boton('Editar', '', async () => { cargarEnFormulario(p); });
      boton(p.estado === 'aprobada' ? 'Cancelar partida' : 'Descartar', 'peligro', async () => {
        if (!confirmar(p.estado === 'aprobada' ? 'Se quita de la web. Lo que ya salió en redes hay que borrarlo a mano. ¿Continuar?' : '¿Descartar esta partida? No se publicará.')) return;
        await guardarEstado(p, { estado: 'cancelada' }, `Cancela partida: ${p.titulo}`); cargarLista();
      });
    }
    return el;
  }
  async function guardarEstado(p, cambios, mensaje) {
    // Se relee el archivo para no pisar lo que la acción de GitHub haya escrito (resultado de publicación)
    const ruta = `partidas/${p.id}/partida.json`;
    const actual = await gh(`/contents/${ruta}?ref=main`);
    const datos = { ...JSON.parse(textoDeB64(actual.content)), ...cambios, actualizada: new Date().toISOString() };
    await gh(`/contents/${ruta}`, { method: 'PUT', body: JSON.stringify({ message: mensaje, content: b64Texto(JSON.stringify(datos, null, 2) + '\n'), sha: actual.sha, branch: 'main' }) });
  }
  function cargarEnFormulario(p) {
    const d = p.diseno || {};
    escribir({ ...p, receta: d.receta || 'general', invertir: !!d.invertir, enfoque: d.enfoque || 'centro', cta: d.cta || 'ESCRÍBENOS PARA RESERVAR' });
    editando = { id: p.id, datos: p };
    foto = ''; mostrarFoto();
    textoManual = true; $('#f-texto').value = p.texto || '';
    $('#titulo-form').textContent = 'Editar partida';
    estado(d.con_imagen ? 'Vuelve a poner la imagen (no se guarda la original) y pulsa «Enviar».' : 'Cambia lo que necesites y pulsa «Enviar».');
    mostrarTab('nueva'); actualizar();
  }
  $$('[data-filtro]').forEach((b) => b.addEventListener('click', () => { filtro = b.dataset.filtro; pintarLista(); }));
  $('#b-recargar').addEventListener('click', cargarLista);

  /* ------------------------------------------------------------ ajustes */
  $('#a-repo').value = ajustes().repo; $('#a-token').value = ajustes().token;
  $('#b-guardar-ajustes').addEventListener('click', async () => {
    guardado.set('repo', $('#a-repo').value.trim() || REPO_DEF); guardado.set('token', $('#a-token').value.trim());
    try { const r = await gh(''); estado(`✅ Conectado a ${r.full_name}. ${r.permissions?.push ? 'Puedes enviar y aprobar.' : 'Ojo: el token no tiene permiso de escritura.'}`, '#estado-ajustes'); cargarLista(); }
    catch (err) { estado('❌ ' + err.message, '#estado-ajustes'); }
  });

  /* ------------------------------------------------------------ pestañas */
  function mostrarTab(t) {
    $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    ['nueva', 'revision', 'ajustes'].forEach((s) => { $('#' + s).hidden = s !== t; });
    if (location.hash.slice(1) !== t) history.replaceState(null, '', '#' + t);
  }
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => { mostrarTab(b.dataset.tab); if (b.dataset.tab === 'revision') cargarLista(); }));

  /* ------------------------------------------------------------ inicio */
  (async () => {
    const b = guardado.get('borrador');
    if (b) { escribir(b); foto = b.foto || ''; editando = b.editando || null; textoManual = !!b.textoManual; if (b.texto) $('#f-texto').value = b.texto; mostrarFoto(); if (editando) $('#titulo-form').textContent = 'Editar partida'; }
    actualizar();
    await cargarFuentes(); actualizar();
    const t = location.hash.slice(1);
    mostrarTab(['nueva', 'revision', 'ajustes'].includes(t) ? t : (ajustes().token ? 'nueva' : 'nueva'));
    if (ajustes().token) cargarLista();
    if (t === 'revision') cargarLista();
  })();
  window.TPDPartidas = { WEB };
})();
