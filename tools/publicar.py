"""Publica en redes las partidas aprobadas que aún no han salido.

Lo ejecuta .github/workflows/publicar.yml cada vez que cambia una partida. Para cada
partidas/<id>/partida.json con estado «aprobada» y fecha de hoy en adelante publica en cada
red configurada que todavía no tenga un resultado «ok», y guarda el resultado en el mismo
archivo (clave «publicado»), así nunca se publica dos veces.

Redes y variables (secretos y variables del repositorio en GitHub):
  Telegram   secreto TELEGRAM_BOT_TOKEN · variable TELEGRAM_CHATS (separados por coma: @canal,-100123…)
  Facebook   secreto META_PAGE_TOKEN    · variable FB_PAGE_ID
  Instagram  secreto META_PAGE_TOKEN    · variable IG_USER_ID (cuenta profesional ligada a la Página)
             variable IG_HISTORIA=0 para no publicar la historia
  GRAPH_VERSION (opcional, por defecto v25.0) · DRY_RUN=1 para ensayar sin publicar nada.

Una red sin sus datos se salta en silencio. Solo usa la biblioteca estándar.

    python -I tools/publicar.py            # en GitHub Actions
    DRY_RUN=1 python -I tools/publicar.py  # ensayo local
"""
import datetime as dt
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

RAIZ = pathlib.Path(__file__).resolve().parent.parent
PARTIDAS = RAIZ / "partidas"
MAX_INTENTOS = 3
ZONA = dt.timezone(dt.timedelta(hours=-5))  # Bogotá

env = os.environ.get
DRY = env("DRY_RUN", "") in ("1", "true", "sí", "si")
GRAPH = f"https://graph.facebook.com/{env('GRAPH_VERSION') or 'v25.0'}"
REPO = env("GITHUB_REPOSITORY", "TheTrashKat/tazon-partidas")
SHA = env("GITHUB_SHA", "main")


def url_imagen(p, cual):
    # Meta y Telegram descargan la imagen de esta URL pública; con el SHA del commit no hay caché vieja
    return f"https://raw.githubusercontent.com/{REPO}/{SHA}/partidas/{p['id']}/{p.get('imagenes', {}).get(cual, cual + '.jpg')}"


def pedir(url, datos=None, metodo=None):
    cuerpo = urllib.parse.urlencode(datos).encode() if datos is not None else None
    req = urllib.request.Request(url, data=cuerpo, method=metodo or ("POST" if cuerpo else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        texto = e.read().decode(errors="replace")
        try:
            j = json.loads(texto)
            msg = (j.get("error") or {}).get("message") if isinstance(j.get("error"), dict) else j.get("description")
        except ValueError:
            msg = None
        raise RuntimeError(f"HTTP {e.code}: {msg or texto[:300]}") from None


# ---------------------------------------------------------------- redes
def telegram(p, chat):
    r = pedir(f"https://api.telegram.org/bot{env('TELEGRAM_BOT_TOKEN')}/sendPhoto",
              {"chat_id": chat, "photo": url_imagen(p, "post"), "caption": p.get("texto", "")[:1024]})
    if not r.get("ok"):
        raise RuntimeError(r.get("description", "Telegram no aceptó el mensaje"))
    return str(r["result"]["message_id"])


def facebook(p):
    r = pedir(f"{GRAPH}/{env('FB_PAGE_ID')}/photos",
              {"url": url_imagen(p, "post"), "message": p.get("texto", ""), "access_token": env("META_PAGE_TOKEN")})
    return r.get("post_id") or r.get("id")


def instagram(p, historia=False):
    datos = {"image_url": url_imagen(p, "historia" if historia else "post"), "access_token": env("META_PAGE_TOKEN")}
    if historia:
        datos["media_type"] = "STORIES"
    else:
        datos["caption"] = p.get("texto", "")[:2200]
    contenedor = pedir(f"{GRAPH}/{env('IG_USER_ID')}/media", datos)["id"]
    # Meta procesa la imagen antes de dejar publicarla
    for _ in range(24):
        estado = pedir(f"{GRAPH}/{contenedor}?" + urllib.parse.urlencode({"fields": "status_code", "access_token": env("META_PAGE_TOKEN")}))
        if estado.get("status_code") == "FINISHED":
            break
        if estado.get("status_code") in ("ERROR", "EXPIRED"):
            raise RuntimeError(f"Instagram no pudo procesar la imagen ({estado.get('status_code')})")
        time.sleep(5)
    r = pedir(f"{GRAPH}/{env('IG_USER_ID')}/media_publish", {"creation_id": contenedor, "access_token": env("META_PAGE_TOKEN")})
    return r.get("id")


def destinos():
    """[(clave, función)] de las redes configuradas."""
    out = []
    if env("TELEGRAM_BOT_TOKEN") and env("TELEGRAM_CHATS"):
        for chat in [c.strip() for c in env("TELEGRAM_CHATS").split(",") if c.strip()]:
            out.append((f"telegram:{chat}", lambda p, c=chat: telegram(p, c)))
    if env("META_PAGE_TOKEN") and env("FB_PAGE_ID"):
        out.append(("facebook", facebook))
    if env("META_PAGE_TOKEN") and env("IG_USER_ID"):
        out.append(("instagram", instagram))
        if env("IG_HISTORIA", "1") != "0":
            out.append(("instagram_historia", lambda p: instagram(p, historia=True)))
    return out


# ---------------------------------------------------------------- principal
def main():
    sys.stdout.reconfigure(encoding="utf-8")  # consola de Windows
    hoy = dt.datetime.now(ZONA).date().isoformat()
    redes = destinos()
    if not redes:
        print("No hay ninguna red configurada todavía (faltan secretos/variables). Nada que publicar.")
    cambios = 0
    for archivo in sorted(PARTIDAS.glob("*/partida.json")):
        p = json.loads(archivo.read_text(encoding="utf-8"))
        if p.get("estado") != "aprobada" or p.get("fecha", "") < hoy:
            continue
        publicado = p.setdefault("publicado", {})
        for clave, fn in redes:
            previo = publicado.get(clave, {})
            if previo.get("ok") or previo.get("intentos", 0) >= MAX_INTENTOS:
                continue
            if DRY:
                print(f"[ensayo] {p['id']} → {clave}  ({url_imagen(p, 'post')})")
                continue
            try:
                ident = fn(p)
                publicado[clave] = {"ok": True, "id": ident, "fecha": dt.datetime.now(ZONA).isoformat(timespec="seconds")}
                print(f"✓ {p['id']} → {clave} ({ident})")
            except Exception as e:  # noqa: BLE001 — se guarda el error y se sigue con las demás redes
                publicado[clave] = {"ok": False, "error": str(e)[:300], "intentos": previo.get("intentos", 0) + 1}
                print(f"✗ {p['id']} → {clave}: {e}")
            cambios += 1
        if not DRY:
            archivo.write_text(json.dumps(p, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{cambios} publicaciones intentadas.")


if __name__ == "__main__":
    main()
