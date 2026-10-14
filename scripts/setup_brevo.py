"""Prépare le compte Brevo pour Pacewell, en une commande.

Crée (seulement s'ils n'existent pas déjà) :
- les attributs de contact utilisés par le workflow (PRATIQUE, SEGMENT, SCORE…) ;
- un dossier « Pacewell » et une liste par segment.
Puis affiche les ID des listes, à recopier dans le nœud « Configuration » de n8n.

Usage (aucune bibliothèque à installer) :
    Windows :  set BREVO_API_KEY=cle-brevo   puis   python scripts\\setup_brevo.py
    Mac/Linux: BREVO_API_KEY=cle-brevo python3 scripts/setup_brevo.py
Ajoute --simulation pour voir ce qui serait créé sans rien modifier.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

API = os.getenv("BREVO_API_URL", "https://api.brevo.com/v3")

ATTRIBUTS = {
    "PRENOM": "text",
    "PRATIQUE": "text",
    "FREQUENCE": "text",
    "OBJECTIF": "text",
    "BUDGET": "text",
    "SEGMENT": "text",
    "NIVEAU": "text",
    "SCORE": "float",
    "RAISON_IA": "text",
    "SOURCE_QUALIF": "text",
    "COUT_IA_USD": "float",
    "QUALIFIE_LE": "date",
}

DOSSIER = "Pacewell"
LISTES = {
    "ROUTE_DEBUTANT": "Pacewell · Route · Débuter",
    "ROUTE_PERF": "Pacewell · Route · Performance",
    "TRAIL_DECOUVERTE": "Pacewell · Trail · Découverte",
    "TRAIL_ENDURANCE": "Pacewell · Trail · Endurance et ultra",
    "A_QUALIFIER": "Pacewell · À qualifier",
}


class ErreurBrevo(Exception):
    pass


def appel(cle: str, methode: str, chemin: str, corps: dict | None = None) -> dict:
    donnees = json.dumps(corps).encode() if corps is not None else None
    req = urllib.request.Request(API + chemin, data=donnees, method=methode, headers={
        "api-key": cle, "accept": "application/json", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as rep:
            brut = rep.read()
            return json.loads(brut) if brut else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        if e.code == 401:
            raise ErreurBrevo("Clé API refusée par Brevo : vérifie BREVO_API_KEY.") from e
        raise ErreurBrevo(f"{methode} {chemin} → {e.code} : {detail}") from e


def tous(cle: str, chemin: str, champ: str) -> list[dict]:
    resultats, offset = [], 0
    while True:
        page = appel(cle, "GET", f"{chemin}?limit=50&offset={offset}").get(champ) or []
        resultats += page
        if len(page) < 50:
            return resultats
        offset += 50


def preparer(cle: str, simulation: bool = False, afficher=print) -> dict[str, int]:
    # 1. Attributs
    existants = {a["name"].upper() for a in appel(cle, "GET", "/contacts/attributes").get("attributes", [])}
    for nom, type_ in ATTRIBUTS.items():
        if nom in existants:
            afficher(f"  = attribut {nom} (déjà là)")
        else:
            afficher(f"  + attribut {nom} ({type_})")
            if not simulation:
                appel(cle, "POST", f"/contacts/attributes/normal/{nom}", {"type": type_})

    # 2. Dossier
    dossier = next((d for d in tous(cle, "/contacts/folders", "folders") if d["name"] == DOSSIER), None)
    if dossier:
        id_dossier = dossier["id"]
        afficher(f"  = dossier « {DOSSIER} » (déjà là)")
    else:
        afficher(f"  + dossier « {DOSSIER} »")
        id_dossier = 0 if simulation else appel(cle, "POST", "/contacts/folders", {"name": DOSSIER})["id"]

    # 3. Listes
    par_nom = {l["name"]: l["id"] for l in tous(cle, "/contacts/lists", "lists")}
    ids = {}
    for segment, nom in LISTES.items():
        if nom in par_nom:
            ids[segment] = par_nom[nom]
            afficher(f"  = liste « {nom} » (déjà là)")
        else:
            afficher(f"  + liste « {nom} »")
            ids[segment] = 0 if simulation else appel(
                cle, "POST", "/contacts/lists", {"name": nom, "folderId": id_dossier})["id"]
    return ids


def main() -> int:
    cle = os.getenv("BREVO_API_KEY", "").strip()
    if not cle:
        print("Il manque la clé : définis la variable BREVO_API_KEY (voir l'en-tête du script).")
        return 1
    simulation = "--simulation" in sys.argv
    print("Simulation : rien ne sera créé.\n" if simulation else "Préparation du compte Brevo…\n")
    try:
        ids = preparer(cle, simulation)
    except ErreurBrevo as e:
        print(f"\nErreur : {e}")
        return 1
    print("\nÀ recopier dans le nœud « Configuration » du workflow n8n :\n")
    print("  listes: {")
    for segment, id_ in ids.items():
        print(f"    {segment}: {id_},")
    print("  },")
    return 0


if __name__ == "__main__":
    sys.exit(main())
