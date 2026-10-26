/**
 * Tazón para Dos · servidor de mesas y anuncios (Google Apps Script, corre con la cuenta dueña del Drive).
 *
 *  - Guarda imágenes en tu Google Drive: portadas que suben los GMs y piezas de los anuncios (post 4:5, historia 9:16).
 *    Quedan visibles «con el enlace» para que la web, Instagram, Facebook y Telegram puedan mostrarlas.
 *  - Publica los anuncios aprobados (colección «anuncios» de Firestore) en Telegram, Facebook e Instagram
 *    y guarda el resultado por red en el mismo anuncio. Nunca publica dos veces en la misma red.
 *
 * Solo atiende a personas con sesión en la plataforma: verifica el token de Firebase y mira el perfil en Firestore
 * (GMs pueden subir portadas; solo admins suben piezas y publican).
 *
 * Instalación: ver apps-script/LEEME.md. Las claves de las redes van en Propiedades del script, nunca en el código:
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHATS (separados por coma), META_PAGE_TOKEN, FB_PAGE_ID, IG_USER_ID,
 *   IG_HISTORIA (0 para no publicar la historia), GRAPH_VERSION (por defecto v25.0), CARPETA_ID (opcional).
 */

const PROYECTO = 'tazon-para-dos';
const FIREBASE_KEY = 'AIzaSyBDE5_lvYBKD8MYAXAimF7QF_SH5QxH36E'; // pública, igual que en la web
const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;
const CARPETA_NOMBRE = 'Tazón para Dos · Mesas';
const TIPOS = { portada: 'Portadas', post: 'Anuncios', historia: 'Anuncios' };
const MAX_BYTES = 6 * 1024 * 1024;
const MAX_INTENTOS = 3;
const prop = (k, d = '') => PropertiesService.getScriptProperties().getProperty(k) || d;

/* ------------------------------------------------------------------ web */
function doPost(e) {
  try {
    const cuerpo = JSON.parse(e.postData.contents);
    const persona = verificar(cuerpo.idToken);
    if (cuerpo.accion === 'subir') return json(subir(persona, cuerpo));
    if (cuerpo.accion === 'publicar') {
      if (!persona.esAdmin) throw new Error('Solo administración puede publicar.');
      return json({ ok: true, publicado: publicarAnuncio(cuerpo.anuncioId) });
    }
    throw new Error('Acción desconocida.');
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  }
}

/** ?imagen=<id>: devuelve la imagen en base64 (para dibujarla en un canvas sin problemas de CORS). */
function doGet(e) {
  try {
    const id = e.parameter.imagen;
    if (!id) return json({ ok: true, servicio: 'Tazón para Dos · mesas', carpeta: carpeta().getUrl() });
    const archivo = DriveApp.getFileById(id);
    if (!dentroDeCarpeta(archivo)) throw new Error('Esa imagen no es de Tazón para Dos.');
    const blob = archivo.getBlob();
    return json({ ok: true, mime: blob.getContentType(), datos: Utilities.base64Encode(blob.getBytes()) });
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  }
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ quién llama */
function verificar(idToken) {
  if (!idToken) throw new Error('Inicia sesión en la plataforma.');
  const r = UrlFetchApp.fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_KEY}`, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken }), muteHttpExceptions: true,
  });
  const usuario = (JSON.parse(r.getContentText()).users || [])[0];
  if (r.getResponseCode() !== 200 || !usuario) throw new Error('Tu sesión venció. Vuelve a iniciar sesión.');
  const perfil = leerDoc(`usuarios/${usuario.localId}`) || {};
  return { uid: usuario.localId, nombre: perfil.nombre || '', esGm: !!perfil.esGm, esAdmin: !!perfil.esAdmin };
}

/* ------------------------------------------------------------------ Drive */
function carpeta() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('CARPETA_ID');
  if (id) return DriveApp.getFolderById(id);
  const existentes = DriveApp.getFoldersByName(CARPETA_NOMBRE);
  const c = existentes.hasNext() ? existentes.next() : DriveApp.createFolder(CARPETA_NOMBRE);
  props.setProperty('CARPETA_ID', c.getId());
  return c;
}
function subcarpeta(nombre) {
  const raiz = carpeta(), it = raiz.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : raiz.createFolder(nombre);
}
function dentroDeCarpeta(archivo) {
  const raiz = carpeta().getId();
  for (let padres = archivo.getParents(); padres.hasNext();) {
    const p = padres.next();
    if (p.getId() === raiz) return true;
    for (let abuelos = p.getParents(); abuelos.hasNext();) if (abuelos.next().getId() === raiz) return true;
  }
  return false;
}
const urlPublica = (id) => `https://lh3.googleusercontent.com/d/${id}`;

function subir(persona, { tipo, nombre, mime, datos, reemplaza }) {
  if (!TIPOS[tipo]) throw new Error('Tipo de imagen desconocido.');
  if (tipo === 'portada' ? !(persona.esGm || persona.esAdmin) : !persona.esAdmin) throw new Error('No tienes permiso para subir esta imagen.');
  if (!/^image\/(jpeg|png|webp)$/.test(mime || '')) throw new Error('La imagen debe ser JPG, PNG o WebP.');
  const bytes = Utilities.base64Decode(datos || '');
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('La imagen pesa demasiado (máximo 6 MB).');
  const limpio = String(nombre || tipo).replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]+/g, '').slice(0, 80) || tipo;
  const archivo = subcarpeta(TIPOS[tipo]).createFile(Utilities.newBlob(bytes, mime, limpio));
  archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  archivo.setDescription(`Subida por ${persona.nombre || persona.uid} (${persona.uid})`);
  // Una pieza nueva reemplaza la anterior del mismo anuncio: la vieja va a la papelera (se puede recuperar 30 días).
  if (reemplaza) { try { const v = DriveApp.getFileById(reemplaza); if (dentroDeCarpeta(v)) v.setTrashed(true); } catch (e) { /* ya no existe */ } }
  return { ok: true, id: archivo.getId(), url: urlPublica(archivo.getId()) };
}

/* ------------------------------------------------------------------ Firestore (como dueña del proyecto) */
function fs(ruta, opciones) {
  const r = UrlFetchApp.fetch(`${FIRESTORE}/${ruta}`, Object.assign({
    headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}`, 'x-goog-user-project': PROYECTO },
    contentType: 'application/json', muteHttpExceptions: true,
  }, opciones || {}));
  if (r.getResponseCode() === 404) return null;
  if (r.getResponseCode() >= 300) throw new Error(`Firestore ${r.getResponseCode()}: ${r.getContentText().slice(0, 300)}`);
  return JSON.parse(r.getContentText() || '{}');
}
function leerDoc(ruta) { const d = fs(ruta); return d ? deFs(d) : null; }
function deValor(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(deValor);
  if ('mapValue' in v) return deFs(v.mapValue);
  return null;
}
function deFs(d) { const o = {}; Object.keys(d.fields || {}).forEach((k) => { o[k] = deValor(d.fields[k]); }); return o; }
function aValor(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(aValor) } };
  if (typeof v === 'object') { const f = {}; Object.keys(v).forEach((k) => { f[k] = aValor(v[k]); }); return { mapValue: { fields: f } }; }
  return { stringValue: String(v) };
}
/** Escribe solo el campo «publicado.<red>» sin tocar lo demás del anuncio. */
function guardarResultado(anuncioId, red, resultado) {
  const clave = '`' + red.replace(/`/g, '') + '`';
  const cuerpo = { fields: { publicado: { mapValue: { fields: { [red]: aValor(resultado) } } } } };
  fs(`anuncios/${anuncioId}?updateMask.fieldPaths=${encodeURIComponent('publicado.' + clave)}`, { method: 'patch', payload: JSON.stringify(cuerpo) });
}

/* ------------------------------------------------------------------ redes */
function destinos() {
  const out = [];
  if (prop('TELEGRAM_BOT_TOKEN') && prop('TELEGRAM_CHATS')) {
    prop('TELEGRAM_CHATS').split(',').map((c) => c.trim()).filter(String).forEach((chat) => out.push([`telegram:${chat}`, (a) => telegram(a, chat)]));
  }
  if (prop('META_PAGE_TOKEN') && prop('FB_PAGE_ID')) out.push(['facebook', facebook]);
  if (prop('META_PAGE_TOKEN') && prop('IG_USER_ID')) {
    out.push(['instagram', (a) => instagram(a, false)]);
    if (prop('IG_HISTORIA', '1') !== '0') out.push(['instagram_historia', (a) => instagram(a, true)]);
  }
  return out;
}
function pedir(url, opciones) {
  const r = UrlFetchApp.fetch(url, Object.assign({ muteHttpExceptions: true }, opciones || {}));
  let j = {}; try { j = JSON.parse(r.getContentText()); } catch (e) { /* no es JSON */ }
  if (r.getResponseCode() >= 300 || j.ok === false || j.error) {
    const m = (j.error && j.error.message) || j.description || r.getContentText().slice(0, 300);
    throw new Error(`HTTP ${r.getResponseCode()}: ${m}`);
  }
  return j;
}
const imagenBlob = (a, cual) => DriveApp.getFileById(a.imagenes[cual].id).getBlob();
const graph = () => `https://graph.facebook.com/${prop('GRAPH_VERSION', 'v25.0')}`;

function telegram(a, chat) {
  const r = pedir(`https://api.telegram.org/bot${prop('TELEGRAM_BOT_TOKEN')}/sendPhoto`, {
    method: 'post', payload: { chat_id: chat, caption: (a.texto || '').slice(0, 1024), photo: imagenBlob(a, 'post') },
  });
  return String(r.result.message_id);
}
function facebook(a) {
  const r = pedir(`${graph()}/${prop('FB_PAGE_ID')}/photos`, {
    method: 'post', payload: { message: a.texto || '', access_token: prop('META_PAGE_TOKEN'), source: imagenBlob(a, 'post') },
  });
  return r.post_id || r.id;
}
function instagram(a, historia) {
  // Instagram descarga la imagen desde una URL pública: la de Drive (archivo compartido con el enlace)
  const datos = { image_url: a.imagenes[historia ? 'historia' : 'post'].url, access_token: prop('META_PAGE_TOKEN') };
  if (historia) datos.media_type = 'STORIES'; else datos.caption = (a.texto || '').slice(0, 2200);
  const contenedor = pedir(`${graph()}/${prop('IG_USER_ID')}/media`, { method: 'post', payload: datos }).id;
  for (let i = 0; i < 24; i++) {
    const e = pedir(`${graph()}/${contenedor}?fields=status_code&access_token=${encodeURIComponent(prop('META_PAGE_TOKEN'))}`);
    if (e.status_code === 'FINISHED') break;
    if (e.status_code === 'ERROR' || e.status_code === 'EXPIRED') throw new Error(`Instagram no pudo procesar la imagen (${e.status_code})`);
    Utilities.sleep(5000);
  }
  return pedir(`${graph()}/${prop('IG_USER_ID')}/media_publish`, { method: 'post', payload: { creation_id: contenedor, access_token: prop('META_PAGE_TOKEN') } }).id;
}

/* ------------------------------------------------------------------ publicar */
const hoyBogota = () => Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd');

function publicarAnuncio(anuncioId) {
  const lock = LockService.getScriptLock(); // evita que el disparador y el botón publiquen a la vez
  lock.waitLock(60000);
  try {
    const a = leerDoc(`anuncios/${anuncioId}`);
    if (!a) throw new Error('Ese anuncio no existe.');
    if (a.estado !== 'aprobada') return a.publicado || {};
    if ((a.fecha || '') < hoyBogota()) return a.publicado || {};
    const publicado = a.publicado || {};
    const redes = destinos();
    redes.forEach(([red, fn]) => {
      const previo = publicado[red] || {};
      if (previo.ok || (previo.intentos || 0) >= MAX_INTENTOS) return;
      let resultado;
      try {
        resultado = { ok: true, id: String(fn(a) || ''), fecha: new Date().toISOString() };
      } catch (err) {
        resultado = { ok: false, error: String(err.message || err).slice(0, 300), intentos: (previo.intentos || 0) + 1 };
      }
      publicado[red] = resultado;
      guardarResultado(anuncioId, red, resultado);
    });
    if (!redes.length) publicado._aviso = 'No hay redes configuradas todavía (Propiedades del script).';
    return publicado;
  } finally {
    lock.releaseLock();
  }
}

/** Disparador cada 10 minutos: publica lo aprobado que falte y reintenta los errores (hasta 3 veces por red). */
function revisar() {
  const r = UrlFetchApp.fetch(`${FIRESTORE}:runQuery`, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}`, 'x-goog-user-project': PROYECTO },
    payload: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'anuncios' }],
      where: { fieldFilter: { field: { fieldPath: 'estado' }, op: 'EQUAL', value: { stringValue: 'aprobada' } } },
    } }),
  });
  if (r.getResponseCode() >= 300) throw new Error(r.getContentText().slice(0, 300));
  const hoy = hoyBogota(); // la fecha se filtra aquí para no necesitar un índice compuesto
  JSON.parse(r.getContentText()).filter((x) => x.document && deFs(x.document).fecha >= hoy).forEach((x) => {
    try { publicarAnuncio(x.document.name.split('/').pop()); } catch (e) { console.error(e); }
  });
}

/** Ejecútalo una vez a mano desde el editor: crea la carpeta, pide los permisos y programa la revisión. */
function instalar() {
  const c = carpeta();
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'revisar').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('revisar').timeBased().everyMinutes(10).create();
  fs('usuarios?pageSize=1'); // comprueba el acceso a Firestore
  console.log(`Listo. Carpeta: ${c.getUrl()}`);
}
