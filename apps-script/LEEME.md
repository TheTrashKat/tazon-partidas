# Servidor de Apps Script · Tazón para Dos

Este script guarda las imágenes en tu Google Drive y publica los anuncios aprobados en Telegram, Facebook e Instagram. Corre con tu cuenta de Google, así que los archivos quedan en **tu** Drive, en la carpeta **Tazón para Dos · Mesas**:

- `Portadas/` guarda las imágenes que suben los GMs al crear una mesa.
- `Anuncios/` guarda el post 4:5 y la historia 9:16 de cada anuncio.

Cada imagen queda compartida como «cualquiera con el enlace puede ver». Así la ven la web, Instagram, Facebook y Telegram, pero no aparece en búsquedas.

## Instalación (una sola vez)

1. Abre el proyecto **Tazón para Dos · Mesas y anuncios** en https://script.google.com. Ya tiene `Código.gs` y `appsscript.json` de esta carpeta.
2. En la barra de arriba elige la función **instalar** y pulsa **Ejecutar**. Google te pide permisos:
   - **Revisar permisos**, eliges tu cuenta.
   - Si sale «Google no ha verificado esta app», pulsas **Configuración avanzada** y luego **Ir a Tazón para Dos · Mesas y anuncios**.
   - Al final pulsas **Permitir**.

   Los permisos son: Drive para guardar las imágenes, Firestore para leer y escribir los anuncios, conexión a internet para las redes y disparadores para la revisión cada 10 minutos.
3. En el registro debe salir `Listo. Carpeta: https://drive.google.com/…`.
4. Ve a **Implementar → Nueva implementación**, tipo **Aplicación web**:
   - Ejecutar como: **Yo**.
   - Quién tiene acceso: **Cualquier usuario**.

   Pulsa **Implementar** y copia la **URL de la aplicación web**, que termina en `/exec`.
5. Esa URL va en dos lugares:
   - en el publicador: constante `SERVIDOR_DEF` de `publicador.js` (o en Ajustes → Avanzado);
   - en la web: `servidorImagenes` de `src/app/firebase.config.ts`.

Si cambias el código después, usa **Implementar → Gestionar implementaciones → editar → Versión: nueva**. Así la URL no cambia.

## Redes (Propiedades del script)

Las claves se guardan en **Configuración del proyecto → Propiedades del script**, nunca en el código:

| Propiedad | Qué es |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token del bot (@BotFather). El bot debe ser administrador del canal y del grupo |
| `TELEGRAM_CHATS` | Canal y grupo separados por coma, por ejemplo `@tazonparados,-1001234567890` |
| `META_PAGE_TOKEN` | Token de larga duración de la Página de Facebook (ver README principal) |
| `FB_PAGE_ID` | Id de la Página de Facebook |
| `IG_USER_ID` | Id de la cuenta profesional de Instagram ligada a la Página |
| `IG_HISTORIA` | `0` para no publicar la historia en Instagram |
| `GRAPH_VERSION` | Opcional, por defecto `v25.0` |
| `CARPETA_ID` | Opcional: usa otra carpeta de Drive en vez de crear «Tazón para Dos · Mesas» |

Una red sin sus datos se salta sin error.

## Seguridad

- El script atiende a cualquiera, pero lo primero que hace es verificar el token de sesión de Firebase y leer el perfil en Firestore:
  - los GMs y administradores pueden subir portadas;
  - solo administración puede subir piezas y publicar.
- `?imagen=<id>` solo entrega imágenes que estén dentro de la carpeta de Tazón para Dos.
- Cuando un anuncio se edita, la imagen anterior va a la papelera de Drive, donde se puede recuperar durante 30 días.
