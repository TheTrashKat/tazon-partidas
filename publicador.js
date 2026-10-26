/* Publicador de partidas · Tazón para Dos
   - Dibuja el post (4:5) y la historia (9:16) con las plantillas «partida_post» y «partida_historia» del kit de marca.
   - «Enviar a revisión» sube las dos imágenes a Google Drive (por el script de Apps Script, apps-script/Codigo.gs)
     y guarda el anuncio en Firestore («anuncios/<id>», estado: pendiente).
   - «Aprobar» cambia el estado a «aprobada» y le pide al script que publique en Telegram, Facebook e Instagram;
     el script guarda el resultado por red en el anuncio y reintenta solo cada 10 minutos.
   - WhatsApp no permite publicar por API en grupos ni canales: «Compartir» abre el menú del teléfono con la imagen y el texto.
   - Las mesas que los GMs crean en la plataforma aparecen en «Revisión» hasta que tengan anuncio; «Preparar anuncio»
     (o ?mesa=<id> en la URL) llena el formulario. El anuncio guarda «mesa» con su id. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  collection, doc, getDoc, getDocs, getFirestore, query, setDoc, updateDoc, where,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

(function () {
  const KIT = 'https://thetrashkat.github.io/tazon-para-dos-marca/';
  // Script de Apps Script (cuenta dueña del Drive). Se puede cambiar en «Ajustes → Avanzado».
  const SERVIDOR_DEF = '';
  const WEB_BASE = 'https://thetrashkat.github.io/tazon-para-dos-web/';
  const WEB = WEB_BASE + '#partidas';
  // Proyecto de Firebase de la plataforma de mesas (valores públicos; la seguridad la dan las reglas de Firestore)
  const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/tazon-para-dos/databases/(default)/documents';
  const FIREBASE_KEY = 'AIzaSyBDE5_lvYBKD8MYAXAimF7QF_SH5QxH36E';
  const app = initializeApp({
    apiKey: FIREBASE_KEY, authDomain: 'tazon-para-dos.firebaseapp.com', projectId: 'tazon-para-dos',
    storageBucket: 'tazon-para-dos.firebasestorage.app', messagingSenderId: '603001960201', appId: '1:603001960201:web:c177e78caf2cb0012685d8',
  });
  const auth = getAuth(app), db = getFirestore(app);
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
  let foto = '';          // data URL reducida (la foto original no se sube: solo se usa para dibujar)
  let editando = null;    // { id, sha } cuando se edita una partida existente
  let textoManual = false;
  let mesaId = '';        // mesa de la plataforma de la que sale esta partida

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
      guardado.set('borrador', { ...p, foto, editando, mesaId, texto: $('#f-texto').value, textoManual });
    });
  }
  form.addEventListener('input', () => { textoManual = false; actualizar(); });
  form.addEventListener('change', actualizar);
  $('#f-texto').addEventListener('input', () => { textoManual = true; guardado.set('borrador', { ...leer(), foto, editando, mesaId, texto: $('#f-texto').value, textoManual }); });

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

  /* ------------------------------------------------------------ sesión y servidor */
  let perfil = null; // { uid, nombre, foto, esAdmin }
  const servidorUrl = () => guardado.get('servidor', '') || SERVIDOR_DEF;
  function exigirAdmin() {
    if (!perfil) throw new Error('Entra con tu cuenta en «Ajustes».');
    if (!perfil.esAdmin) throw new Error('Tu cuenta no es de administración.');
    if (!servidorUrl()) throw new Error('Falta la dirección del script en «Ajustes → Avanzado».');
  }
  async function servidor(accion, datos) {
    const idToken = await auth.currentUser.getIdToken();
    // text/plain evita la consulta previa de CORS, que Apps Script no responde
    const r = await fetch(servidorUrl(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ accion, idToken, ...datos }) });
    const j = await r.json().catch(() => ({ ok: false, error: `El script respondió ${r.status}` }));
    if (!j.ok) throw new Error(j.error || 'El script no respondió bien.');
    return j;
  }
  const blobB64 = async (blob) => b64(new Uint8Array(await blob.arrayBuffer()));
  async function subirImagen(blob, tipo, nombre, reemplaza) {
    const r = await servidor('subir', { tipo, nombre, mime: blob.type || 'image/jpeg', datos: await blobB64(blob), reemplaza: reemplaza || '' });
    return { id: r.id, url: r.url };
  }
  // Imágenes de Drive: si el navegador no deja leerlas directo (CORS), se piden al script
  const idDrive = (url) => (String(url).match(/googleusercontent\.com\/d\/([\w-]+)/) || [])[1];
  async function blobDe(url) {
    try { const r = await fetch(url); if (r.ok) return await r.blob(); } catch { /* CORS: se intenta por el script */ }
    const id = idDrive(url);
    if (!id || !servidorUrl()) throw new Error('No pude descargar la imagen.');
    const j = await (await fetch(`${servidorUrl()}?imagen=${encodeURIComponent(id)}`)).json();
    if (!j.ok) throw new Error(j.error);
    return new Blob([Uint8Array.from(atob(j.datos), (c) => c.charCodeAt(0))], { type: j.mime });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = leer();
    if (!p.titulo || !p.fecha || !p.inicio) return estado('Falta el nombre, la fecha o la hora de inicio.');
    if (p.fecha < hoyIso()) return estado('La fecha ya pasó.');
    const b = $('#b-enviar'); b.disabled = true;
    try {
      exigirAdmin();
      estado('Dibujando las piezas…');
      const pz = await piezas();
      let id = editando?.id || idPartida(p);
      if (!editando) for (let n = 2; (await getDoc(doc(db, 'anuncios', id))).exists(); n++) id = `${idPartida(p)}-${n}`;
      const previo = editando?.datos || {};
      estado('Subiendo las imágenes a Drive…');
      const imagenes = {
        post: await subirImagen(pz.post, 'post', `${id}-post.jpg`, previo.imagenes?.post?.id),
        historia: await subirImagen(pz.historia, 'historia', `${id}-historia.jpg`, previo.imagenes?.historia?.id),
      };
      const partida = {
        id, estado: 'pendiente', creada: previo.creada || new Date().toISOString(), actualizada: new Date().toISOString(),
        autor: perfil.uid,
        titulo: p.titulo, juego: p.juego, descripcion: p.descripcion, fecha: p.fecha, inicio: p.inicio, fin: p.fin, lugar: p.lugar,
        nivel: p.nivel, cupos: p.cupos, narra: p.narra, reserva: p.reserva, texto: $('#f-texto').value,
        mesa: mesaId || previo.mesa || '',
        diseno: { receta: p.receta, invertir: p.invertir, enfoque: p.enfoque, cta: p.cta, con_imagen: !!foto },
        imagenes,
      };
      if (!editando) partida.publicado = {};
      // Ya salió en alguna red: sigue aprobada (no se vuelve a publicar donde ya está)
      if (previo.estado === 'aprobada' && Object.values(previo.publicado || {}).some((r) => r?.ok)) partida.estado = 'aprobada';
      estado('Guardando en Firebase…');
      await setDoc(doc(db, 'anuncios', id), partida, { merge: true }); // merge: no pisa «publicado», que escribe el script
      guardado.del('borrador'); editando = null; mesaId = '';
      estado(partida.estado === 'aprobada' ? '✅ Anuncio actualizado. Las redes donde ya salió no se vuelven a publicar.' : '✅ Enviado a revisión. Apruébalo en la pestaña «Revisión» para publicarlo.');
      $('#titulo-form').textContent = 'Nueva partida';
      cargarLista();
    } catch (err) { estado('❌ ' + err.message); } finally { b.disabled = false; }
  });

  /* ------------------------------------------------------------ revisión */
  let filtro = 'pendiente', todas = [];
  const REDES = { telegram: 'Telegram', facebook: 'Facebook', instagram: 'Instagram', instagram_historia: 'IG historia' };
  async function cargarLista() {
    estado('Cargando…', '#estado-rev');
    try {
      // Sin cuenta de administración solo se pueden leer los aprobados
      const q = perfil?.esAdmin ? collection(db, 'anuncios') : query(collection(db, 'anuncios'), where('estado', '==', 'aprobada'));
      todas = (await getDocs(q)).docs.map((d) => ({ ...d.data(), id: d.id }));
      todas.sort((a, b) => (a.fecha + a.inicio).localeCompare(b.fecha + b.inicio));
      contarPendientes();
      estado(perfil?.esAdmin ? '' : 'Entra con tu cuenta de administración en «Ajustes» para ver los pendientes.', '#estado-rev');
      pintarLista();
    } catch (err) { estado('❌ ' + err.message, '#estado-rev'); }
    await cargarMesas();
  }
  const urlImagen = (p, cual) => p.imagenes?.[cual]?.url || '';
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
        ${p.mesa && mesasEstado[p.mesa] === 'cancelada' && p.estado !== 'cancelada' && !pasada ? '<div class="aviso-mesa">⚠ El GM canceló esta mesa en la plataforma. Cancélala aquí también.</div>' : ''}
        ${p.estado === 'pendiente' ? `<label>Texto para redes</label><textarea data-texto>${D.esc(p.texto || '')}</textarea>` : ''}
        <div class="botones"></div>
        <div class="estado"></div>
      </div>`;
    const bs = $('.botones', el), st = $('.estado', el);
    const boton = (txt, clase, fn) => { const b = document.createElement('button'); b.className = 'boton ' + clase; b.textContent = txt; b.onclick = async () => { b.disabled = true; try { await fn(); } catch (err) { st.textContent = '❌ ' + err.message; } finally { b.disabled = false; } }; bs.append(b); };
    if (p.estado === 'pendiente') {
      boton('Aprobar y publicar ↗', 'primario', async () => {
        if (!confirmar(`¿Publicar «${p.titulo}» en Telegram, Facebook e Instagram?`)) return;
        exigirAdmin();
        await guardarEstado(p, { estado: 'aprobada', texto: $('[data-texto]', el).value, aprobada: new Date().toISOString() });
        st.textContent = 'Publicando…';
        const r = await servidor('publicar', { anuncioId: p.id });
        const redes = Object.entries(r.publicado || {}).filter(([k]) => !k.startsWith('_'));
        st.textContent = r.publicado?._aviso ? '✅ Aprobado. ' + r.publicado._aviso
          : `✅ Aprobado. ${redes.filter(([, x]) => x.ok).length} de ${redes.length} redes publicadas.`;
        setTimeout(cargarLista, 1500);
      });
      boton('Guardar texto', '', async () => { await guardarEstado(p, { texto: $('[data-texto]', el).value }); st.textContent = '✅ Texto guardado.'; });
    }
    if (p.estado !== 'cancelada') {
      boton('Compartir en WhatsApp', 'wa', async () => {
        st.textContent = 'Preparando…';
        const blob = await blobDe(urlImagen(p, 'post'));
        await compartir(p.texto || '', [new File([blob], p.id + '.jpg', { type: 'image/jpeg' })], st);
      });
      boton('Historia', '', async () => { descargar(p.id + '-historia.jpg', await blobDe(urlImagen(p, 'historia'))); });
      boton('Copiar texto', '', async () => { await navigator.clipboard.writeText(p.texto || ''); st.textContent = '✅ Texto copiado.'; });
      boton('Editar', '', async () => { cargarEnFormulario(p); });
      boton(p.estado === 'aprobada' ? 'Cancelar partida' : 'Descartar', 'peligro', async () => {
        if (!confirmar(p.estado === 'aprobada' ? 'Se quita de la web. Lo que ya salió en redes hay que borrarlo a mano. ¿Continuar?' : '¿Descartar esta partida? No se publicará.')) return;
        await guardarEstado(p, { estado: 'cancelada' }); cargarLista();
      });
    }
    return el;
  }
  async function guardarEstado(p, cambios) {
    if (!perfil?.esAdmin) throw new Error('Entra con tu cuenta de administración en «Ajustes».');
    await updateDoc(doc(db, 'anuncios', p.id), { ...cambios, actualizada: new Date().toISOString() });
  }
  function cargarEnFormulario(p) {
    const d = p.diseno || {};
    escribir({ ...p, receta: d.receta || 'general', invertir: !!d.invertir, enfoque: d.enfoque || 'centro', cta: d.cta || 'ESCRÍBENOS PARA RESERVAR' });
    editando = { id: p.id, datos: p }; mesaId = p.mesa || '';
    foto = ''; mostrarFoto();
    textoManual = true; $('#f-texto').value = p.texto || '';
    $('#titulo-form').textContent = 'Editar partida';
    estado(d.con_imagen ? 'Vuelve a poner la imagen (no se guarda la original) y pulsa «Enviar».' : 'Cambia lo que necesites y pulsa «Enviar».');
    mostrarTab('nueva'); actualizar();
  }
  function contarPendientes() {
    const n = todas.filter((x) => x.estado === 'pendiente').length + mesasNuevas.length;
    $('#n-pendientes').hidden = !n; $('#n-pendientes').textContent = n;
  }

  /* ------------------------------------------------------------ mesas de la plataforma (Firestore) */
  let mesasNuevas = [], mesasEstado = {};
  function valorFs(v) {
    if (!v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('timestampValue' in v) return v.timestampValue;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(valorFs);
    if ('mapValue' in v) return docFs(v.mapValue);
    return null;
  }
  function docFs(d) { return Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, valorFs(v)])); }
  const idDoc = (nombre) => nombre.split('/').pop();
  async function mesasProximas() {
    const r = await fetch(`${FIRESTORE}:runQuery?key=${FIREBASE_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: 'mesas' }], orderBy: [{ field: { fieldPath: 'fecha' } }], limit: 100,
        where: { fieldFilter: { field: { fieldPath: 'fecha' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: new Date().toISOString() } } },
      } }),
    });
    if (!r.ok) throw new Error(`Firestore ${r.status}`);
    return (await r.json()).filter((x) => x.document).map((x) => ({ id: idDoc(x.document.name), ...docFs(x.document) }));
  }
  async function unaMesa(id) {
    const r = await fetch(`${FIRESTORE}/mesas/${encodeURIComponent(id)}?key=${FIREBASE_KEY}`);
    if (!r.ok) throw new Error(r.status === 404 ? 'Esa mesa no existe en la plataforma.' : `Firestore ${r.status}`);
    const d = await r.json(); return { id: idDoc(d.name), ...docFs(d) };
  }
  async function cargarMesas() {
    try {
      const mesas = await mesasProximas();
      mesasEstado = Object.fromEntries(mesas.map((m) => [m.id, m.estado]));
      const anunciadas = new Set(todas.map((p) => p.mesa).filter(Boolean));
      mesasNuevas = mesas.filter((m) => m.estado === 'abierta' && !anunciadas.has(m.id));
    } catch (err) { console.warn('No pude leer las mesas de la plataforma', err); mesasNuevas = []; }
    $('#mesas').hidden = !mesasNuevas.length; $('#n-mesas').textContent = mesasNuevas.length;
    $('#mesas-lista').replaceChildren(...mesasNuevas.map((m) => {
      const el = document.createElement('div'); el.className = 'mesa-fila';
      const { fecha, inicio } = enBogota(m.fecha);
      el.innerHTML = `${m.portada ? `<img alt="" loading="lazy" src="${D.esc(new URL(m.portada, WEB_BASE).href)}">` : ''}
        <div><strong>${D.esc(m.titulo)}</strong><span class="meta">${D.esc([m.sistema, fechaLarga(fecha) + ' · ' + hora12(inicio), m.gmNombre ? 'narra ' + m.gmNombre : ''].filter(Boolean).join(' · '))}</span></div>`;
      const b = document.createElement('button'); b.className = 'boton primario'; b.textContent = 'Preparar anuncio';
      b.onclick = () => desdeMesa(m); el.append(b);
      return el;
    }));
    pintarLista(); contarPendientes();
  }
  // Fecha y hora de la mesa en Bogotá → «AAAA-MM-DD» y «HH:MM»
  function enBogota(iso, sumarHoras = 0) {
    const d = new Date(new Date(iso).getTime() + sumarHoras * 3600e3);
    const x = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d).map((q) => [q.type, q.value]));
    return { fecha: `${x.year}-${x.month}-${x.day}`, inicio: `${x.hour}:${x.minute}` };
  }
  async function desdeMesa(m) {
    if (todas.some((p) => p.mesa === m.id && p.estado !== 'cancelada') && !confirmar('Esta mesa ya tiene un anuncio. ¿Preparar otro?')) return;
    const { fecha, inicio } = enBogota(m.fecha);
    const fin = m.duracionHoras ? enBogota(m.fecha, m.duracionHoras).inicio : '';
    const libres = Math.max(0, (m.cupos || 0) - (m.inscritos || 0));
    const etiquetas = m.etiquetas || [];
    let descripcion = (m.descripcion || '').trim();
    if (descripcion.length > 500) descripcion = descripcion.slice(0, 497).replace(/\s+\S*$/, '') + '…';
    escribir({
      titulo: m.titulo || '', juego: m.sistema || '', descripcion, fecha, inicio, fin,
      cupos: libres || m.cupos || '', lugar: m.modalidad === 'online' ? 'En línea' : (m.lugar || LUGAR),
      nivel: etiquetas.includes('principiantes') ? 'Para principiantes' : 'Todo nivel',
      narra: m.gmNombre || '', reserva: new URL(`mesas/${m.id}`, WEB_BASE).href, cta: 'INSCRÍBETE EN LA WEB',
    });
    editando = null; mesaId = m.id; textoManual = false; foto = ''; mostrarFoto();
    $('#titulo-form').textContent = 'Anuncio de mesa';
    mostrarTab('nueva'); actualizar();
    estado('Datos de la mesa cargados. Revisa, ajusta la imagen si quieres y pulsa «Enviar a revisión».');
    if (m.portada) {
      try {
        const url = new URL(m.portada, WEB_BASE).href;
        const blob = await blobDe(url.replace(/-800\.jpg$/, '-1600.jpg')).catch(() => blobDe(url));
        await ponerFoto(new File([blob], 'portada.jpg', { type: blob.type || 'image/jpeg' }));
      } catch (err) { console.warn('Portada no cargada', err); }
    }
  }

  $$('[data-filtro]').forEach((b) => b.addEventListener('click', () => { filtro = b.dataset.filtro; pintarLista(); }));
  $('#b-recargar').addEventListener('click', cargarLista);

  /* ------------------------------------------------------------ ajustes: cuenta */
  $('#a-servidor').value = servidorUrl();
  $('#b-entrar').addEventListener('click', async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (err) { estado('❌ ' + err.message, '#estado-ajustes'); }
  });
  $('#b-salir').addEventListener('click', () => signOut(auth));
  $('#b-guardar-ajustes').addEventListener('click', async () => {
    guardado.set('servidor', $('#a-servidor').value.trim());
    await probarServidor();
  });
  async function probarServidor() {
    if (!servidorUrl()) return estado('Falta la dirección del script (Avanzado).', '#estado-ajustes');
    try {
      const j = await (await fetch(servidorUrl())).json();
      if (j.carpeta) $('#enlace-carpeta').href = j.carpeta;
      estado(perfil?.esAdmin ? '✅ Todo listo: puedes enviar y aprobar anuncios.' : '✅ Script conectado.', '#estado-ajustes');
    } catch (err) { estado('❌ No pude hablar con el script: ' + err.message, '#estado-ajustes'); }
  }
  onAuthStateChanged(auth, async (u) => {
    perfil = null;
    if (u) {
      try {
        const d = (await getDoc(doc(db, 'usuarios', u.uid))).data() || {};
        perfil = { uid: u.uid, nombre: d.nombre || u.displayName || u.email, foto: u.photoURL, esAdmin: !!d.esAdmin };
      } catch { perfil = { uid: u.uid, nombre: u.displayName || u.email, foto: u.photoURL, esAdmin: false }; }
    }
    $('#sesion-info').innerHTML = perfil
      ? `${perfil.foto ? `<img alt="" src="${D.esc(perfil.foto)}">` : ''}<b>${D.esc(perfil.nombre)}</b> · ${perfil.esAdmin ? 'administración' : 'sin permisos de administración'}`
      : 'Sin sesión.';
    $('#b-entrar').hidden = !!perfil; $('#b-salir').hidden = !perfil;
    if (perfil && !perfil.esAdmin) estado('Tu cuenta no es de administración: puedes ver, pero no enviar ni aprobar.', '#estado-ajustes');
    else if (perfil) probarServidor();
    cargarLista();
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
    if (b) { escribir(b); foto = b.foto || ''; editando = b.editando || null; mesaId = b.mesaId || ''; textoManual = !!b.textoManual; if (b.texto) $('#f-texto').value = b.texto; mostrarFoto(); if (editando) $('#titulo-form').textContent = 'Editar partida'; }
    actualizar();
    await cargarFuentes(); actualizar();
    const t = location.hash.slice(1);
    mostrarTab(['nueva', 'revision', 'ajustes'].includes(t) ? t : 'nueva');
    const pedida = new URLSearchParams(location.search).get('mesa');
    if (pedida) {
      try { await desdeMesa(await unaMesa(pedida)); } catch (err) { estado('❌ ' + err.message); }
      history.replaceState(null, '', location.pathname + '#nueva');
    }
    // la lista se carga cuando Firebase dice si hay sesión (onAuthStateChanged)
  })();
  window.TPDPartidas = { WEB };
})();
