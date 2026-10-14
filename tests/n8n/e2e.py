"""Test de bout en bout du workflow dans un vrai n8n (local), Brevo et Claude simulés.

Usage : python3 tests/n8n/e2e.py /chemin/vers/node_modules/.bin/n8n
Le n8n de test utilise son propre dossier : rien n'est écrit dans ~/.n8n.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

RACINE = Path(__file__).resolve().parents[2]
ICI = Path(__file__).parent
N8N = sys.argv[1]
PORT_N8N, PORT_FAUX = 5690, 9100
WEBHOOK = f"http://127.0.0.1:{PORT_N8N}/webhook/pacewell-inscription"
JOURNAL, SCENARIO = ICI / "journal.jsonl", ICI / "scenario.json"

dossier = Path(tempfile.mkdtemp(prefix="n8n-test-"))
env = {**os.environ, "N8N_USER_FOLDER": str(dossier), "N8N_PORT": str(PORT_N8N),
       "N8N_DIAGNOSTICS_ENABLED": "false", "N8N_PERSONALIZATION_ENABLED": "false",
       "N8N_SECURE_COOKIE": "false", "N8N_LOG_LEVEL": "info", "N8N_LISTEN_ADDRESS": "127.0.0.1",
       "NO_PROXY": "127.0.0.1,localhost", "no_proxy": "127.0.0.1,localhost"}
DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def cli(*args):
    r = subprocess.run([N8N, *args], env=env, capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        raise SystemExit(f"n8n {' '.join(args)} a échoué :\n{r.stdout}\n{r.stderr}")
    return r.stdout


# --- Préparation : identifiants de test et workflow pointant vers les faux serveurs ---
creds = [
    {"id": "credbrevo0000001", "name": "Brevo API", "type": "httpHeaderAuth",
     "data": {"name": "api-key", "value": "cle-brevo-test"}},
    {"id": "credclaude000001", "name": "Claude API", "type": "httpHeaderAuth",
     "data": {"name": "x-api-key", "value": "cle-claude-test"}},
]
(dossier / "creds.json").write_text(json.dumps(creds))

wf = json.loads((RACINE / "n8n/pacewell-qualification.json").read_text())
wf["id"] = "pacewellTest0001"
for n in wf["nodes"]:
    if n["name"] == "Configuration":
        n["parameters"]["jsCode"] = (n["parameters"]["jsCode"]
            .replace("https://api.brevo.com/v3", f"http://127.0.0.1:{PORT_FAUX}/v3")
            .replace("https://api.anthropic.com/v1", f"http://127.0.0.1:{PORT_FAUX}/v1")
            .replace("ROUTE_DEBUTANT: 0", "ROUTE_DEBUTANT: 11").replace("ROUTE_PERF: 0", "ROUTE_PERF: 12")
            .replace("TRAIL_DECOUVERTE: 0", "TRAIL_DECOUVERTE: 13").replace("TRAIL_ENDURANCE: 0", "TRAIL_ENDURANCE: 14")
            .replace("A_QUALIFIER: 0", "A_QUALIFIER: 15"))
    for c in (n.get("credentials") or {}).values():
        c["id"] = "credbrevo0000001" if c["name"] == "Brevo API" else "credclaude000001"
(dossier / "wf.json").write_text(json.dumps(wf))

cli("import:credentials", f"--input={dossier / 'creds.json'}")
cli("import:workflow", f"--input={dossier / 'wf.json'}")
cli("publish:workflow", "--id=pacewellTest0001")

faux = subprocess.Popen([sys.executable, str(ICI / "faux_serveurs.py"), str(PORT_FAUX)])
serveur = subprocess.Popen([N8N, "start"], env=env, stdout=open(dossier / "n8n.log", "w"), stderr=subprocess.STDOUT)


def attendre():
    for _ in range(120):
        try:
            DIRECT.open(f"http://127.0.0.1:{PORT_N8N}/healthz", timeout=2)
            if "Activated workflow" in (dossier / "n8n.log").read_text():
                return
            time.sleep(1)
        except Exception:
            time.sleep(1)
    raise SystemExit("n8n n'a pas démarré :\n" + (dossier / "n8n.log").read_text()[-3000:])


def envoyer(formulaire, scenario):
    SCENARIO.write_text(json.dumps(scenario))
    JOURNAL.write_text("")
    req = urllib.request.Request(WEBHOOK, data=json.dumps(formulaire).encode(), method="POST",
                                 headers={"Content-Type": "application/json",
                                          "Origin": "https://pacewell.simondelrue.fr"})
    try:
        with DIRECT.open(req, timeout=60) as r:
            code, brut, entetes = r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        code, brut, entetes = e.code, e.read(), dict(e.headers)
    try:
        corps = json.loads(brut or b"{}")
    except ValueError:
        corps = {"brut": brut.decode(errors="replace")[:300]}
    appels = [json.loads(l) for l in JOURNAL.read_text().splitlines() if l.strip()]
    return code, corps, entetes, appels


FORM = {"prenom": "Julie", "email": "Julie@Exemple.fr", "pratique": "trail", "frequence": "3-4",
        "objectif": "ultra", "budget": "400-plus", "consentement": "oui"}
IA_OK = {"ia_reponse": {"segment": "TRAIL_ENDURANCE", "niveau": "confirme", "score": 88,
                        "raison": "Ultra, 3-4 sorties par semaine et budget élevé."}}
echecs = []


def verifier(nom, condition, detail=""):
    print(("  ✓ " if condition else "  ✗ ") + nom + ("" if condition else f"  → {detail}"))
    if not condition:
        echecs.append(nom)


try:
    attendre()

    print("Scénario 1 : nouveau lead chaud, IA valide")
    code, corps, ent, appels = envoyer(FORM, IA_OK)
    chemins = [a["chemin"] for a in appels]
    verifier("réponse 200 {ok: true}", code == 200 and corps == {"ok": True}, (code, corps))
    verifier("CORS autorisé pour la landing", ent.get("Access-Control-Allow-Origin") == "https://pacewell.simondelrue.fr", ent)
    verifier("ordre des appels", chemins == ["/v3/contacts/julie%40exemple.fr", "/v1/messages", "/v3/contacts", "/v3/smtp/email"], chemins)
    claude = next(a for a in appels if a["chemin"] == "/v1/messages")
    verifier("clé Claude transmise", claude["x_api_key"] == "cle-claude-test")
    verifier("en-tête anthropic-version", claude["anthropic_version"] == "2023-06-01")
    verifier("email absent du prompt", "julie" not in json.dumps(claude["corps"]).lower(), claude["corps"])
    contact = next(a for a in appels if a["chemin"] == "/v3/contacts")
    verifier("clé Brevo transmise", contact["api_key"] == "cle-brevo-test")
    verifier("contact : segment et liste", contact["corps"]["attributes"]["SEGMENT"] == "TRAIL_ENDURANCE"
             and contact["corps"]["listIds"] == [14], contact["corps"])
    verifier("contact : upsert et coût IA", contact["corps"]["updateEnabled"] is True
             and contact["corps"]["attributes"]["COUT_IA_USD"] == 0.00009, contact["corps"])
    alerte = next(a for a in appels if a["chemin"] == "/v3/smtp/email")
    verifier("alerte envoyée à Simon", alerte["corps"]["to"][0]["email"] == "simondelruepro@gmail.com")

    print("Scénario 2 : lead tiède (pas d'alerte)")
    froid = {"ia_reponse": {"segment": "ROUTE_DEBUTANT", "niveau": "debutant", "score": 22, "raison": "Reprise, petit budget."}}
    code, corps, _, appels = envoyer({**FORM, "pratique": "route", "objectif": "10km", "frequence": "1-2", "budget": "moins-150"}, froid)
    chemins = [a["chemin"] for a in appels]
    verifier("inscrit sans alerte", code == 200 and "/v3/smtp/email" not in chemins and "/v3/contacts" in chemins, chemins)

    print("Scénario 3 : l'IA répond n'importe quoi → segment par défaut")
    code, corps, _, appels = envoyer(FORM, {"ia_texte": "Désolé, je ne peux pas."})
    contact = next((a for a in appels if a["chemin"] == "/v3/contacts"), None)
    verifier("contact quand même enregistré", code == 200 and contact is not None, appels)
    verifier("segment A_QUALIFIER, liste 15, source repli",
             contact and contact["corps"]["attributes"]["SEGMENT"] == "A_QUALIFIER"
             and contact["corps"]["listIds"] == [15] and contact["corps"]["attributes"]["SOURCE_QUALIF"] == "repli",
             contact and contact["corps"])

    print("Scénario 4 : API Claude en panne (529)")
    code, corps, _, appels = envoyer(FORM, {"ia_statut": 529})
    contact = next((a for a in appels if a["chemin"] == "/v3/contacts"), None)
    verifier("repli sans planter", code == 200 and contact and contact["corps"]["attributes"]["SEGMENT"] == "A_QUALIFIER",
             (code, appels))

    print("Scénario 5 : doublon récent → pas de nouvel appel IA")
    existant = {"contact": {"email": "julie@exemple.fr", "attributes": {
        "PRATIQUE": "trail", "FREQUENCE": "3-4", "OBJECTIF": "ultra", "BUDGET": "400-plus",
        "SEGMENT": "TRAIL_ENDURANCE", "NIVEAU": "confirme", "SCORE": 88, "QUALIFIE_LE": time.strftime("%Y-%m-%d")}}}
    code, corps, _, appels = envoyer(FORM, existant)
    chemins = [a["chemin"] for a in appels]
    verifier("un seul appel (lecture Brevo)", code == 200 and chemins == ["/v3/contacts/julie%40exemple.fr"], chemins)

    print("Scénario 6 : formulaire invalide")
    code, corps, _, appels = envoyer({**FORM, "consentement": ""}, IA_OK)
    verifier("refus 400 sans aucun appel externe", code == 400 and not appels and "consentement" in corps.get("erreur", ""), (code, corps, appels))
    code, corps, _, appels = envoyer({**FORM, "site_web": "http://spam"}, IA_OK)
    verifier("robot refusé sans détail", code == 400 and corps.get("erreur") == "Demande refusée." and not appels, (code, corps))
finally:
    serveur.terminate()
    faux.terminate()
    serveur.wait(30)
    for f in (JOURNAL, SCENARIO):
        f.unlink(missing_ok=True)
    if echecs:
        print("\nJournal n8n :\n" + (dossier / "n8n.log").read_text()[-4000:])
    shutil.rmtree(dossier, ignore_errors=True)

print(f"\n{'ÉCHECS : ' + ', '.join(echecs) if echecs else 'Tous les scénarios passent.'}")
sys.exit(1 if echecs else 0)
