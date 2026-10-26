# Publicador de partidas · Tazón para Dos

Una página para anunciar partidas de rol. Llenas los datos una vez y la partida sale con la marca de Tazón en:

| Dónde | Cómo |
|---|---|
| Telegram (canal y grupo) | automático, con un bot |
| Facebook (Página) | automático, API de Meta |
| Instagram (post + historia) | automático, API de Meta |
| Web de Tazón (sección «Próximas partidas») | automático, lee `partidas.json` |
| WhatsApp (grupo, canal, estado) | **semiautomático**: botón «Compartir» con imagen y texto listos (WhatsApp no permite publicar por API en grupos ni canales) |

Publicador: **https://thetrashkat.github.io/tazon-partidas/**

## Cómo se usa

1. **Nueva partida**: nombre, juego, fecha, hora, cupos y nivel. Si quieres, pega una imagen (Ctrl+V). A la derecha ves el post 4:5, la historia 9:16 y el texto para redes, que puedes editar.
2. **Enviar a revisión**: sube `partidas/<fecha>-<nombre>/` con `partida.json`, `post.jpg` e `historia.jpg`. Todavía no sale a ninguna red.
3. **Revisión → Aprobar y publicar**: en 1 o 2 minutos GitHub Actions publica en Telegram, Facebook e Instagram y actualiza la web. En la tarjeta aparece ✓ o ✗ por cada red.
4. **Compartir en WhatsApp**: en el celular abre el menú de compartir con la imagen y el texto. Eliges el grupo, el canal o tu estado. En el computador abre WhatsApp Web con el texto y descarga la imagen.

Cada partida se publica una sola vez por red. Si una red falla, se reintenta en el siguiente cambio y cada mañana, hasta 3 veces. Las partidas cuya fecha ya pasó desaparecen solas de la web.

## Configuración (una sola vez)

En GitHub: **Settings → Secrets and variables → Actions**. Los *secrets* van cifrados. Las *variables* son datos que no son secretos.

### Telegram

1. En Telegram, habla con **@BotFather** → `/newbot` → nombre `Tazón para Dos` → copia el token.
2. Agrega el bot como **administrador** del canal (con permiso de publicar) y como miembro del grupo.
3. Secret `TELEGRAM_BOT_TOKEN` = el token.
4. Variable `TELEGRAM_CHATS` = los destinos separados por coma:
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
6. Guárdalos en GitHub:
   - secret `META_PAGE_TOKEN` = token de la Página;
   - variable `FB_PAGE_ID` = id de la Página;
   - variable `IG_USER_ID` = id de Instagram.

Opcionales:
- `IG_HISTORIA=0`: no publica la historia.
- `GRAPH_VERSION`: por defecto `v25.0`.
- `DRY_RUN=1`: modo ensayo, que muestra en el registro qué publicaría y no publica nada.

Una red sin sus datos simplemente se salta. Puedes empezar solo con Telegram.

### Quién puede enviar y aprobar

Cada persona del equipo crea un **token de GitHub de grano fino** que solo tiene acceso al repo `tazon-partidas` con permiso *Contents: Read and write*. Lo pega en la pestaña **Ajustes** del publicador. Se guarda solo en ese navegador. Los pasos están en la misma pestaña.

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html`, `publicador.js` | La página. Dibuja con las plantillas `partida_post` / `partida_historia` del [kit de marca](https://github.com/TheTrashKat/tazon-para-dos-marca), cargadas desde su GitHub Pages |
| `partidas/<id>/partida.json` | Datos, estado (`pendiente` → `aprobada` / `cancelada`), texto para redes y resultado por red (`publicado`) |
| `tools/publicar.py` | Publica en Telegram, Facebook e Instagram (solo biblioteca estándar) |
| `tools/indice.py` | Genera `partidas.json` para la web |
| `.github/workflows/publicar.yml` | Corre los dos scripts, guarda resultados y despliega GitHub Pages |

Para un ensayo local sin publicar nada: `DRY_RUN=1 python -I tools/publicar.py`.

**Privacidad:** la foto original no se sube, solo las piezas ya armadas. Este es un espacio seguro LGBTI+: no publiques caras ni nombres sin permiso explícito.
