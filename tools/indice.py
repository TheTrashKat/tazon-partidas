"""Genera partidas.json: el índice público de partidas aprobadas que lee la web de Tazón para Dos.

    python -I tools/indice.py

Incluye solo partidas «aprobadas» (las pasadas también, con «pasada: true», para un futuro archivo);
la web muestra las próximas. Las pendientes y canceladas no salen.
"""
import datetime as dt
import json
import os
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
REPO = os.environ.get("GITHUB_REPOSITORY", "TheTrashKat/tazon-partidas")
dueno, nombre = REPO.split("/")
BASE = f"https://{dueno.lower()}.github.io/{nombre}/"
CAMPOS = ("id", "titulo", "juego", "descripcion", "fecha", "inicio", "fin", "lugar", "nivel", "cupos", "narra", "reserva", "texto")


def main():
    sys.stdout.reconfigure(encoding="utf-8")  # consola de Windows
    hoy = dt.datetime.now(dt.timezone(dt.timedelta(hours=-5))).date().isoformat()
    out = []
    for archivo in sorted((RAIZ / "partidas").glob("*/partida.json")):
        p = json.loads(archivo.read_text(encoding="utf-8"))
        if p.get("estado") != "aprobada":
            continue
        q = {k: p.get(k, "") for k in CAMPOS}
        q["estado"] = "aprobada"
        q["pasada"] = p.get("fecha", "") < hoy
        q["imagen"] = BASE + f"partidas/{p['id']}/{p.get('imagenes', {}).get('post', 'post.jpg')}"
        q["historia"] = BASE + f"partidas/{p['id']}/{p.get('imagenes', {}).get('historia', 'historia.jpg')}"
        out.append(q)
    out.sort(key=lambda q: (q["fecha"], q["inicio"]))
    datos = {"generado": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "partidas": out}
    (RAIZ / "partidas.json").write_text(json.dumps(datos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"partidas.json: {len(out)} aprobadas ({sum(not q['pasada'] for q in out)} próximas)")


if __name__ == "__main__":
    main()
