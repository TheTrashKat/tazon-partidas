# Publicador de partidas · Tazón para Dos

Una página para anunciar mesas y partidas de rol. Llenas los datos una vez, o los trae una mesa de la plataforma, y el anuncio sale con la marca de Tazón en:

| Dónde | Cómo |
|---|---|
| Telegram (canal y grupo) | automático, con un bot |
| Facebook (Página) | automático, API de Meta |
| Instagram (post + historia) | automático, API de Meta |
| WhatsApp (grupo, canal, estado) | **semiautomático**: botón «Compartir» con imagen y texto listos (WhatsApp no permite publicar por API en grupos ni canales) |

Publicador: **https://thetrashkat.github.io/tazon-partidas/**

## Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Mesas (las crean los GMs en la web) | Firebase, colección `mesas` |
| Anuncios: datos, estado (`pendiente` → `aprobada` / `cancelada`), texto para redes y resultado por red (`publicado`) | Firebase, colección `anuncios` |
| Imágenes: portadas de los GMs, post 4:5 e historia 9:16 | Google Drive, carpeta **Tazón para Dos · Mesas** |
| Publicación en redes y reintentos | Script de Apps Script de la misma cuenta del Drive (`apps-script/`) |
| Esta página | GitHub Pages (este repo) |

En GitHub no queda ningún dato ni ninguna clave.

## Cómo se usa

1. **Ajustes → Entrar con Google**, con tu cuenta de administración de la plataforma.
2. **Nueva partida**: nombre, juego, fecha, hora, cupos y nivel. Si quieres, pega una imagen (Ctrl+V). A la derecha ves el post 4:5, la historia 9:16 y el texto para redes, que puedes editar.
3. **Enviar a revisión**: sube el post y la historia a Drive y guarda el anuncio en Firebase. Todavía no sale a ninguna red.
4. **Revisión → Aprobar y publicar**: el script publica en Telegram, Facebook e Instagram en menos de un minuto. En la tarjeta aparece ✓ o ✗ por cada red.
5. **Compartir en WhatsApp**: en el celular abre el menú de compartir con la imagen y el texto. Eliges el grupo, el canal o tu estado. En el computador abre WhatsApp Web con el texto y descarga la imagen.

**Mesas de la plataforma.** Cuando un GM crea una mesa en la web (`/mesas`), aparece en **Revisión → Mesas nuevas de la plataforma** hasta que tenga anuncio. **Preparar anuncio** llena el formulario con estos datos de la mesa:
- título, sistema, fecha y hora (Bogotá) y duración;
- cupos libres, el GM y la portada;
- el enlace de reserva, que apunta a la página de inscripción de la mesa.

El anuncio guarda el id en `mesa`. Si el GM cancela la mesa, la tarjeta del anuncio muestra un aviso. También puedes abrir `?mesa=<id>` para preparar una mesa en particular.

Cada anuncio se publica una sola vez por red. Si una red falla, el script la reintenta cada 10 minutos, hasta 3 veces. Los anuncios cuya fecha ya pasó no se publican.

## Configuración (una sola vez)

1. **Script de Apps Script:** sigue [apps-script/LEEME.md](apps-script/LEEME.md) (instalar, implementar como aplicación web y copiar la URL).
2. **Reglas de Firestore:** las reglas de la colección `anuncios` están en `firestore.rules` del proyecto de la web. Pégalas en *Firebase → Firestore → Reglas*.
3. **Redes:** sus claves van en las *Propiedades del script* (tabla en el LEEME). Una red sin sus datos se salta, así que puedes empezar solo con Telegram.

### Telegram

1. En Telegram, habla con **@BotFather** → `/newbot` → nombre `Tazón para Dos` → copia el token.
2. Agrega el bot como **administrador** del canal (con permiso de publicar) y como miembro del grupo.
3. Propiedad `TELEGRAM_BOT_TOKEN` = el token.
4. Propiedad `TELEGRAM_CHATS` = los destinos separados por coma:
   - el canal público: `@nombre_del_canal`;
   - el grupo, con su id numérico (`-100…`). Para verlo, escribe algo en el grupo y abre `https://api.telegram.org/bot<TOKEN>/getUpdates`.

### Facebook e Instagram (API de Meta)

Requisitos:
- El Instagram de Tazón es **cuenta profesional** (empresa o creador).
- Está **vinculado a la Página de Facebook**.

Pasos:
1. En https://developers.facebook.com/apps crea una app de tipo **Empresa** y agrégale el producto **Instagram** (API con inicio de sesión de Facebook).
2. En el **Explorador de la API Graph**, con tu app, pide los permisos `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic` e `instagram_content_publish`.
3. Cambia ese token por uno de **larga duración** con el Depurador de tokens («Extender token de acceso»).
4. Con ese token consulta `GET /me/accounts`. Ahí aparece el **token de la Página**, que no vence, y el **id de la Página**.
5. Consulta `GET /<id de la Página>?fields=instagram_business_account`. Ahí aparece el **id de Instagram**.
6. Guárdalos como propiedades del script:
   - `META_PAGE_TOKEN` = token de la Página;
   - `FB_PAGE_ID` = id de la Página;
   - `IG_USER_ID` = id de Instagram.

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html`, `publicador.js` | La página. Dibuja con las plantillas `partida_post` / `partida_historia` del [kit de marca](https://github.com/TheTrashKat/tazon-para-dos-marca), cargadas desde su GitHub Pages. Usa Firebase (sesión y anuncios) y el script (imágenes y publicación) |
| `apps-script/Codigo.gs`, `appsscript.json` | El script: guarda imágenes en Drive, publica en redes y reintenta cada 10 minutos |
| `.github/workflows/pages.yml` | Publica esta página en GitHub Pages |

**Privacidad:** la foto original no se sube, solo las piezas ya armadas. Este es un espacio seguro LGBTI+: no publiques caras ni nombres sin permiso explícito.
