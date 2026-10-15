"""Test de bout en bout des workflows dans un vrai n8n (local), Brevo et Claude simulés.

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
import urllib.parse
import urllib.request
from pathlib import Path

RACINE = Path(__file__).resolve().parents[2]
ICI = Path(__file__).parent
N8N = sys.argv[1]
PORT_N8N, PORT_FAUX = 5690, 9100
BASE = f"http://127.0.0.1:{PORT_N8N}"
JOURNAL, SCENARIO = ICI / "journal.jsonl", ICI / "scenario.json"

dossier = Path(tempfile.mkdtemp(prefix="n8n-test-"))
env = {**os.environ, "N8N_USER_FOLDER": str(dossier), "N8N_PORT": str(PORT_N8N),
       "N8N_DIAGNOSTICS_ENABLED": "false", "N8N_PERSONALIZATION_ENABLED": "false",
       "N8N_SECURE_COOKIE": "false", "N8N_LOG_LEVEL": "info", "N8N_LISTEN_ADDRESS": "127.0.0.1",
       "NO_PROXY": "127.0.0.1,localhost", "no_proxy": "127.0.0.1,localhost"}
DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def cli(*args):
    # Port du gestionnaire de tâches distinct de celui du serveur n8n déjà lancé.
    r = subprocess.run([N8N, *args], env={**env, "N8N_RUNNERS_BROKER_PORT": "5698"}, capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        raise SystemExit(f"n8n {' '.join(args)} a échoué :\n{r.stdout}\n{r.stderr}")
    return r.stdout


# --- Préparation : identifiants de test et workflows pointant vers les faux serveurs ---
creds = [
    {"id": "credbrevo0000001", "name": "Brevo API", "type": "httpHeaderAuth",
     "data": {"name": "api-key", "value": "cle-brevo-test"}},
    {"id": "credclaude000001", "name": "Claude API", "type": "httpHeaderAuth",
     "data": {"name": "x-api-key", "value": "cle-claude-test"}},
]
(dossier / "creds.json").write_text(json.dumps(creds))

WORKFLOWS = {"qualification": "pacewellQualif01", "reactivation": "pacewellReact001",
             "validation": "pacewellValid001", "statistiques": "pacewellStats001", "evaluation": "pacewellEval0001"}
for nom, id_ in WORKFLOWS.items():
    wf = json.loads((RACINE / f"n8n/pacewell-{nom}.json").read_text())
    wf["id"] = id_
    for n in wf["nodes"]:
        if n["name"] == "Configuration":
            n["parameters"]["jsCode"] = (n["parameters"]["jsCode"]
                .replace("https://api.brevo.com/v3", f"http://127.0.0.1:{PORT_FAUX}/v3")
                .replace("https://api.anthropic.com/v1", f"http://127.0.0.1:{PORT_FAUX}/v1")
                .replace("https://n8n.simondelrue.fr", BASE)
                .replace("ROUTE_DEBUTANT: 0", "ROUTE_DEBUTANT: 11").replace("ROUTE_PERF: 0", "ROUTE_PERF: 12")
                .replace("TRAIL_DECOUVERTE: 0", "TRAIL_DECOUVERTE: 13").replace("TRAIL_ENDURANCE: 0", "TRAIL_ENDURANCE: 14")
                .replace("A_QUALIFIER: 0", "A_QUALIFIER: 15"))
        for c in (n.get("credentials") or {}).values():
            c["id"] = "credbrevo0000001" if c["name"] == "Brevo API" else "credclaude000001"
    (dossier / f"{nom}.json").write_text(json.dumps(wf))

cli("import:credentials", f"--input={dossier / 'creds.json'}")
for nom, id_ in WORKFLOWS.items():
    cli("import:workflow", f"--input={dossier / f'{nom}.json'}")
    if nom not in ("evaluation", "reactivation"):
        cli("publish:workflow", f"--id={id_}")

faux = subprocess.Popen([sys.executable, str(ICI / "faux_serveurs.py"), str(PORT_FAUX)])
serveur = subprocess.Popen([N8N, "start"], env=env, stdout=open(dossier / "n8n.log", "w"), stderr=subprocess.STDOUT)


def attendre():
    for _ in range(150):
        try:
            DIRECT.open(f"{BASE}/healthz", timeout=2)
            if (dossier / "n8n.log").read_text().count("Activated workflow") >= 3:
                return
            time.sleep(1)
        except Exception:
            time.sleep(1)
    raise SystemExit("n8n n'a pas démarré :\n" + (dossier / "n8n.log").read_text()[-3000:])


def journal(attente=0.0):
    """Lit les appels reçus par les faux serveurs, après que le workflow a fini de tourner."""
    precedent, stable = -1, 0
    fin = time.time() + attente
    while time.time() < fin or stable < 3:
        n = len(JOURNAL.read_text().splitlines())
        stable = stable + 1 if n == precedent else 0
        precedent = n
        time.sleep(0.4)
        if time.time() > fin + 20:
            break
    return [json.loads(l) for l in JOURNAL.read_text().splitlines() if l.strip()]


def requete(methode, chemin, scenario, corps=None, forme="json", origine=None):
    SCENARIO.write_text(json.dumps(scenario))
    JOURNAL.write_text("")
    entetes = {"Origin": origine} if origine else {}
    donnees = None
    if corps is not None:
        if forme == "json":
            donnees, entetes["Content-Type"] = json.dumps(corps).encode(), "application/json"
        else:
            donnees, entetes["Content-Type"] = urllib.parse.urlencode(corps).encode(), "application/x-www-form-urlencoded"
    req = urllib.request.Request(BASE + chemin, data=donnees, method=methode, headers=entetes)
    debut = time.time()
    try:
        with DIRECT.open(req, timeout=60) as r:
            code, brut, ent = r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        code, brut, ent = e.code, e.read(), dict(e.headers)
    return code, brut.decode(errors="replace"), ent, time.time() - debut


def inscrire(formulaire, scenario):
    code, brut, ent, duree = requete("POST", "/webhook/pacewell-inscription", scenario, formulaire,
                                     origine="https://pacewell.simondelrue.fr")
    try:
        corps = json.loads(brut or "{}")
    except ValueError:
        corps = {"brut": brut[:300]}
    return code, corps, ent, journal(1.5), duree


FORM = {"prenom": "Julie", "email": "Julie@Exemple.fr", "pratique": "trail", "frequence": "3-4",
        "objectif": "ultra", "budget": "400-plus", "consentement": "oui"}
IA_OK = {"ia_reponse": {"segment": "TRAIL_ENDURANCE", "niveau": "confirme", "score": 88,
                        "raison": "Ultra, 3-4 sorties par semaine et budget élevé."},
         "ia_bienvenue": {"objet": "Bienvenue, futur ultra-traileur", "intro": "Bienvenue ! On va préparer ton ultra ensemble.",
                          "conseils": ["Mange en courant.", "Fais du dénivelé.", "Allège une semaine sur quatre."],
                          "selection": "Un sac d'hydratation stable."}}
echecs = []


def verifier(nom, condition, detail=""):
    print(("  ✓ " if condition else "  ✗ ") + nom + ("" if condition else f"  → {detail}"))
    if not condition:
        echecs.append(nom)


try:
    attendre()

    print("Scénario 1 : nouveau lead chaud → bienvenue rédigée par l'IA + alerte")
    code, corps, ent, appels, duree = inscrire(FORM, IA_OK)
    chemins = [a["chemin"] for a in appels]
    verifier("réponse 200 {ok: true}", code == 200 and corps == {"ok": True}, (code, corps))
    verifier("CORS autorisé pour la landing", ent.get("Access-Control-Allow-Origin") == "https://pacewell.simondelrue.fr", ent)
    verifier("ordre des appels", chemins == ["/v3/contacts/julie%40exemple.fr", "/v1/messages", "/v3/contacts",
                                             "/v1/messages", "/v3/smtp/email", "/v3/smtp/email"], chemins)
    claudes = [a for a in appels if a["chemin"] == "/v1/messages"]
    verifier("clé Claude transmise", all(c["x_api_key"] == "cle-claude-test" for c in claudes))
    verifier("email et prénom absents des deux prompts", all("julie" not in json.dumps(c["corps"]).lower() for c in claudes))
    contact = next(a for a in appels if a["chemin"] == "/v3/contacts")
    verifier("contact : segment, liste et date d'activité", contact["corps"]["attributes"]["SEGMENT"] == "TRAIL_ENDURANCE"
             and contact["corps"]["listIds"] == [14] and contact["corps"]["attributes"].get("DERNIERE_ACTIVITE"), contact["corps"])
    envois = [a["corps"] for a in appels if a["chemin"] == "/v3/smtp/email"]
    bienvenue = next((e for e in envois if "pacewell-bienvenue" in e.get("tags", [])), None)
    verifier("bienvenue envoyée à l'inscrit, rédigée par l'IA",
             bienvenue and bienvenue["to"][0]["email"] == "julie@exemple.fr"
             and bienvenue["subject"] == "Bienvenue, futur ultra-traileur" and "Salut Julie," in bienvenue["htmlContent"], bienvenue)
    alerte = next((e for e in envois if "pacewell-alerte" in e.get("tags", [])), None)
    verifier("alerte envoyée à Simon", alerte and alerte["to"][0]["email"] == "simon59117@gmail.com", envois)

    print("Scénario 2 : lead tiède, contact existant aux réponses changées → ni bienvenue ni alerte")
    existant = {"contact": {"email": "julie@exemple.fr", "attributes": {"PRATIQUE": "route", "SEGMENT": "ROUTE_DEBUTANT",
                                                                         "QUALIFIE_LE": "2026-01-01"}}}
    froid = {**existant, "ia_reponse": {"segment": "ROUTE_DEBUTANT", "niveau": "debutant", "score": 22, "raison": "Reprise."}}
    code, corps, _, appels, _ = inscrire({**FORM, "pratique": "route", "objectif": "10km", "frequence": "1-2", "budget": "moins-150"}, froid)
    chemins = [a["chemin"] for a in appels]
    verifier("contact mis à jour, aucun email", code == 200 and "/v3/contacts" in chemins and "/v3/smtp/email" not in chemins
             and chemins.count("/v1/messages") == 1, chemins)

    print("Scénario 3 : l'IA répond n'importe quoi → segment par défaut, bienvenue sur modèle")
    code, corps, _, appels, _ = inscrire(FORM, {"ia_texte": "Désolé, je ne peux pas.", "ia_bienvenue": {"objet": "Promo -50 % !"}})
    contact = next((a for a in appels if a["chemin"] == "/v3/contacts"), None)
    verifier("segment A_QUALIFIER, liste 15, source repli",
             contact and contact["corps"]["attributes"]["SEGMENT"] == "A_QUALIFIER"
             and contact["corps"]["listIds"] == [15] and contact["corps"]["attributes"]["SOURCE_QUALIF"] == "repli",
             contact and contact["corps"])
    bienvenue = next((a["corps"] for a in appels if a["chemin"] == "/v3/smtp/email"), None)
    verifier("bienvenue sur modèle, sans la promo de l'IA", bienvenue and "50" not in bienvenue["subject"]
             and bienvenue["subject"] == "Bienvenue chez Pacewell", bienvenue and bienvenue["subject"])

    print("Scénario 4 : API Claude en panne (529)")
    code, corps, _, appels, _ = inscrire(FORM, {"ia_statut": 529})
    contact = next((a for a in appels if a["chemin"] == "/v3/contacts"), None)
    verifier("repli sans planter", code == 200 and contact and contact["corps"]["attributes"]["SEGMENT"] == "A_QUALIFIER",
             (code, [a["chemin"] for a in appels]))

    print("Scénario 5 : doublon récent → pas de nouvel appel IA")
    doublon = {"contact": {"email": "julie@exemple.fr", "attributes": {
        "PRATIQUE": "trail", "FREQUENCE": "3-4", "OBJECTIF": "ultra", "BUDGET": "400-plus",
        "SEGMENT": "TRAIL_ENDURANCE", "NIVEAU": "confirme", "SCORE": 88, "QUALIFIE_LE": time.strftime("%Y-%m-%d")}}}
    code, corps, _, appels, _ = inscrire(FORM, doublon)
    chemins = [a["chemin"] for a in appels]
    verifier("un seul appel (lecture Brevo)", code == 200 and chemins == ["/v3/contacts/julie%40exemple.fr"], chemins)

    print("Scénario 6 : formulaire invalide")
    code, corps, _, appels, _ = inscrire({**FORM, "consentement": ""}, IA_OK)
    verifier("refus 400 sans aucun appel externe", code == 400 and not appels and "consentement" in corps.get("erreur", ""), (code, corps, appels))
    code, corps, _, appels, _ = inscrire({**FORM, "site_web": "http://spam"}, IA_OK)
    verifier("robot refusé sans détail", code == 400 and corps.get("erreur") == "Demande refusée." and not appels, (code, corps))

    print("Scénario 7 : réactivation des inactifs")
    vieux = time.strftime("%Y-%m-%d", time.gmtime(time.time() - 90 * 86400))
    contacts = [
        {"email": "ancien@exemple.fr", "emailBlacklisted": False, "attributes": {"PRENOM": "Paul", "SEGMENT": "ROUTE_PERF", "SCORE": 60,
         "PRATIQUE": "route", "FREQUENCE": "3-4", "OBJECTIF": "marathon", "BUDGET": "150-400", "DERNIERE_ACTIVITE": vieux}},
        {"email": "recent@exemple.fr", "emailBlacklisted": False, "attributes": {"SEGMENT": "ROUTE_PERF", "SCORE": 90,
         "DERNIERE_ACTIVITE": time.strftime("%Y-%m-%d")}},
    ]
    SCENARIO.write_text(json.dumps({"contacts": contacts, "ia_relance": {
        "objet": "Ton prochain marathon se prépare", "message": "Ça fait un moment !\n\nUne sortie longue dimanche ?",
        "angle": "Marathonien : on parle de sortie longue."}}))
    JOURNAL.write_text("")
    cli("execute", f"--id={WORKFLOWS['reactivation']}")
    appels = journal()
    chemins = [f"{a['methode']} {a['chemin']}" for a in appels]
    verifier("liste, IA, mise en attente, email de validation",
             chemins == ["GET /v3/contacts?limit=1000&sort=desc", "POST /v1/messages",
                         "PUT /v3/contacts/ancien%40exemple.fr", "POST /v3/smtp/email"], chemins)
    attente = next((a["corps"] for a in appels if a["methode"] == "PUT"), {})
    jeton = attente.get("attributes", {}).get("RELANCE_JETON", "")
    validation = next((a["corps"] for a in appels if a["chemin"] == "/v3/smtp/email"), {})
    verifier("validation envoyée à Simon, pas à l'inscrit", validation.get("to", [{}])[0].get("email") == "simon59117@gmail.com", validation.get("to"))
    verifier("jeton présent dans le lien", jeton and f"jeton={jeton}" in validation.get("textContent", ""), jeton)

    print("Scénario 8 : validation d'une relance")
    fiche = {"contact": {"email": "ancien@exemple.fr", "attributes": {
        "PRENOM": "Paul", "SEGMENT": "ROUTE_PERF", "RELANCE_STATUT": "proposee", "RELANCE_JETON": jeton,
        "RELANCE_OBJET": "Ton prochain marathon se prépare", "RELANCE_MESSAGE": "Ça fait un moment !\n\nUne sortie longue dimanche ?"}}}
    q = urllib.parse.urlencode({"email": "ancien@exemple.fr", "jeton": jeton, "action": "envoyer"})
    code, page, ent, _ = requete("GET", f"/webhook/pacewell-relance?{q}", fiche)
    appels = journal()
    verifier("ouvrir le lien : page HTML de confirmation, rien envoyé",
             code == 200 and "text/html" in ent.get("Content-Type", "") and "Oui, envoyer" in page
             and [a["methode"] for a in appels] == ["GET"], (code, ent.get("Content-Type"), [a["chemin"] for a in appels]))
    code, page, _, _ = requete("POST", "/webhook/pacewell-relance-decision", fiche,
                               {"email": "ancien@exemple.fr", "jeton": jeton, "action": "envoyer", "decision": "1"}, forme="form")
    appels = journal()
    envoi = next((a["corps"] for a in appels if a["chemin"] == "/v3/smtp/email"), {})
    cloture = next((a["corps"] for a in appels if a["methode"] == "PUT"), {})
    verifier("confirmer : relance envoyée à l'inscrit", code == 200 and "Relance envoyée" in page
             and envoi.get("to", [{}])[0].get("email") == "ancien@exemple.fr" and envoi.get("subject") == "Ton prochain marathon se prépare", (code, page[:200], envoi))
    verifier("relance close (jeton effacé)", cloture.get("attributes", {}).get("RELANCE_STATUT") == "envoyee"
             and cloture["attributes"].get("RELANCE_JETON") == "", cloture)
    code, page, _, _ = requete("POST", "/webhook/pacewell-relance-decision", {"contact": {"email": "ancien@exemple.fr", "attributes": {
        "RELANCE_STATUT": "envoyee", "RELANCE_JETON": ""}}}, {"email": "ancien@exemple.fr", "jeton": jeton, "action": "envoyer", "decision": "1"}, forme="form")
    appels = journal()
    verifier("lien rejoué : refusé, rien envoyé", "déjà été envoyée" in page and "/v3/smtp/email" not in [a["chemin"] for a in appels], page[:300])
    code, page, _, _ = requete("POST", "/webhook/pacewell-relance-decision", fiche,
                               {"email": "ancien@exemple.fr", "jeton": jeton, "action": "ignorer", "decision": "1"}, forme="form")
    appels = journal()
    verifier("ignorer : rien envoyé, relance close", "Relance écartée" in page and [a["methode"] for a in appels] == ["GET", "PUT"],
             [a["chemin"] for a in appels])

    print("Scénario 9 : statistiques du tableau de bord")
    stats_contacts = [{"email": "a@x.fr", "attributes": {"PRENOM": "Alice", "SEGMENT": "TRAIL_ENDURANCE", "SCORE": 88, "SOURCE_QUALIF": "ia",
                                                           "COUT_IA_USD": 0.0001, "QUALIFIE_LE": "2026-10-15", "RAISON_IA": "Ultra."}},
                      {"email": "b@x.fr", "attributes": {"SEGMENT": "A_QUALIFIER", "SCORE": 0, "SOURCE_QUALIF": "repli"}}]
    code, brut, ent, _ = requete("GET", "/webhook/pacewell-stats", {"contacts": stats_contacts}, origine="https://pacewell.simondelrue.fr")
    try:
        s = json.loads(brut)
    except ValueError:
        s = {}
    verifier("chiffres agrégés", code == 200 and s.get("inscrits") == 2 and s.get("leadsChauds") == 1
             and s.get("emails", {}).get("bienvenue", {}).get("envoyes") == 4, brut[:300])
    verifier("CORS pour la landing, aucune donnée personnelle", ent.get("Access-Control-Allow-Origin") == "https://pacewell.simondelrue.fr"
             and "@" not in brut and "Alice" not in brut, (ent.get("Access-Control-Allow-Origin"), brut[:200]))

    print("Scénario 10 : évaluation sur 30 profils")
    SCENARIO.write_text(json.dumps({"ia_reponse": {"segment": "TRAIL_ENDURANCE", "niveau": "confirme", "score": 80, "raison": "r"}}))
    JOURNAL.write_text("")
    sortie = cli("execute", f"--id={WORKFLOWS['evaluation']}")
    appels = journal()
    verifier("30 appels à Claude", sum(1 for a in appels if a["chemin"] == "/v1/messages") == 30, len(appels))
    verifier("bilan calculé", '"profils": 30' in sortie.replace('":30', '": 30') or '"profils":30' in sortie, sortie[-400:])
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
