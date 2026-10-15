"""Assemble les workflows n8n de Pacewell à partir des fichiers de code/.

Le code des nœuds vit dans des fichiers .js testés (tests/), et ce script
les injecte dans des JSON importables dans n8n. Lancer :
    python3 n8n/construire_workflow.py

Workflows produits :
- pacewell-qualification.json   : inscription, qualification IA, bienvenue, alerte (étapes 1 et 2)
- pacewell-reactivation.json    : chaque lundi, propose des relances à valider (étape 3)
- pacewell-validation.json      : pages « Envoyer / Ignorer » des relances (étape 3)
- pacewell-statistiques.json    : chiffres du tableau de bord (étape 4)
- pacewell-evaluation.json      : évaluation de l'IA sur 30 profils annotés (étape 4)
"""

import json
import uuid
from pathlib import Path

ICI = Path(__file__).parent
CODE = ICI / "code"
COMMUN = (CODE / "_commun.js").read_text(encoding="utf-8")

CRED_BREVO = {"httpHeaderAuth": {"id": "", "name": "Brevo API"}}
CRED_CLAUDE = {"httpHeaderAuth": {"id": "", "name": "Claude API"}}
CONF = "$('Configuration').item.json.config"
CONF1 = "$('Configuration').first().json.config"
REPONSE_COMPLETE = {"response": {"response": {"fullResponse": True, "neverError": True}}}
ORIGINE_LANDING = "https://pacewell.simondelrue.fr"


def ident(prefixe, nom):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"pacewell/{prefixe}/{nom}"))


class Workflow:
    def __init__(self, nom, fichier, prefixe):
        self.nom, self.fichier, self.prefixe = nom, fichier, prefixe
        self.noeuds, self.liens = [], []

    def noeud(self, nom, type_, version, x, y, parametres, **extra):
        self.noeuds.append({"id": ident(self.prefixe, nom), "name": nom, "type": type_, "typeVersion": version,
                            "position": [x, y], "parameters": parametres, **extra})
        return nom

    def code(self, nom, fichier, x, y, commun=False, tous=False, remplacer=None):
        js = (CODE / fichier).read_text(encoding="utf-8")
        for avant, apres in (remplacer or {}).items():
            assert avant in js, f"{avant!r} absent de {fichier}"
            js = js.replace(avant, apres)
        if commun:
            js = COMMUN + "\n" + js
        return self.noeud(nom, "n8n-nodes-base.code", 2, x, y, {
            "mode": "runOnceForAllItems" if tous else "runOnceForEachItem", "jsCode": js})

    def si(self, nom, expression, x, y):
        return self.noeud(nom, "n8n-nodes-base.if", 2.3, x, y, {
            "conditions": {
                "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 3},
                "conditions": [{
                    "id": ident(self.prefixe, "cond/" + nom),
                    "leftValue": "={{ " + expression + " }}",
                    "rightValue": "",
                    "operator": {"type": "boolean", "operation": "true", "singleValue": True},
                }],
                "combinator": "and",
            },
            "options": {},
        })

    def http(self, nom, methode, url, x, y, credentials, corps=None, entetes=None, reponse_complete=False,
             timeout=None, continuer=False):
        p = {"method": methode, "url": url, "authentication": "genericCredentialType",
             "genericAuthType": "httpHeaderAuth", "options": {}}
        if entetes:
            p["sendHeaders"] = True
            p["headerParameters"] = {"parameters": [{"name": k, "value": v} for k, v in entetes.items()]}
        if corps:
            p.update({"sendBody": True, "specifyBody": "json", "jsonBody": corps})
        if reponse_complete:
            p["options"].update(REPONSE_COMPLETE)
        if timeout:
            p["options"]["timeout"] = timeout
        extra = {"onError": "continueRegularOutput"} if continuer else {}
        return self.noeud(nom, "n8n-nodes-base.httpRequest", 4.5, x, y, p, credentials=credentials, **extra)

    def claude(self, nom, x, y, espacer_ms=None):
        nom = self.http(nom, "POST", "={{ " + CONF + ".urlClaude }}/messages", x, y, CRED_CLAUDE,
                        corps="={{ JSON.stringify($json.requete) }}", entetes={"anthropic-version": "2023-06-01"},
                        reponse_complete=True, timeout=30000)
        if espacer_ms:
            # Un appel à la fois, espacés : reste sous la limite de requêtes par minute de l'API.
            self.noeuds[-1]["parameters"]["options"]["batching"] = {"batch": {"batchSize": 1, "batchInterval": espacer_ms}}
        return nom

    def webhook(self, nom, methode, chemin, x, y, origine=None):
        options = {"allowedOrigins": origine} if origine else {}
        return self.noeud(nom, "n8n-nodes-base.webhook", 2.1, x, y, {
            "httpMethod": methode, "path": chemin, "responseMode": "responseNode", "options": options,
        }, webhookId=ident(self.prefixe, "webhook/" + chemin))

    def repondre(self, nom, corps, code_http, x, y, html=False):
        p = {"respondWith": "text" if html else "json", "responseBody": corps, "options": {"responseCode": code_http}}
        if html:
            p["options"]["responseHeaders"] = {"entries": [
                {"name": "Content-Type", "value": "text/html; charset=utf-8"},
                {"name": "Cache-Control", "value": "no-store"}]}
        return self.noeud(nom, "n8n-nodes-base.respondToWebhook", 1.5, x, y, p)

    def lien(self, source, cible, sortie=0):
        self.liens.append((source, sortie, cible))

    def chaine(self, *noms):
        for a, b in zip(noms, noms[1:]):
            self.lien(a, b)

    def ecrire(self):
        connexions = {}
        for source, sortie, cible in self.liens:
            sorties = connexions.setdefault(source, {"main": []})["main"]
            while len(sorties) <= sortie:
                sorties.append([])
            sorties[sortie].append({"node": cible, "type": "main", "index": 0})
        noms = {n["name"] for n in self.noeuds}
        for s, _, c in self.liens:
            assert s in noms and c in noms, (s, c)
        donnees = {"name": self.nom, "nodes": self.noeuds, "connections": connexions,
                   "settings": {"executionOrder": "v1", "timezone": "Europe/Paris"}, "pinData": {}, "active": False}
        (ICI / self.fichier).write_text(json.dumps(donnees, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"{self.fichier} : {len(self.noeuds)} nœuds, {len(self.liens)} liens")


# --- 1. Qualification, bienvenue et alerte (étapes 1 et 2) -------------------------------
w = Workflow("Pacewell · Qualification des inscrits", "pacewell-qualification.json", "qualif")
w.webhook("Formulaire Pacewell", "POST", "pacewell-inscription", 0, 300, ORIGINE_LANDING)
w.code("Configuration", "01_configuration.js", 220, 300)
w.code("Nettoyer et valider", "02_nettoyer.js", 440, 300)
w.si("Entrée valide ?", "$json.ok", 660, 300)
w.repondre("Réponse : refus", "={{ JSON.stringify({ ok: false, erreur: $json.erreur === 'spam' ? 'Demande refusée.' : $json.erreur }) }}", 400, 880, 520)
# Le visiteur a sa réponse tout de suite ; la suite (IA, Brevo, emails) tourne ensuite.
w.repondre("Réponse : inscrit", '={{ JSON.stringify({ ok: true }) }}', 200, 880, 300)
w.http("Brevo : contact existant ?", "GET",
       "={{ " + CONF + ".urlBrevo }}/contacts/{{ encodeURIComponent($json.lead.email) }}",
       1100, 300, CRED_BREVO, reponse_complete=True)
w.code("Dédoublonner", "03_dedoublonner.js", 1320, 300)
w.si("Déjà qualifié ?", "$json.doublon", 1540, 300)
w.code("Préparer le prompt", "04_preparer_prompt.js", 1760, 400)
w.claude("Claude : qualifier", 1980, 400)
w.code("Valider la réponse IA", "05_valider_ia.js", 2200, 400)
w.code("Préparer Brevo", "06_preparer_brevo.js", 2420, 400)
w.http("Brevo : créer ou mettre à jour", "POST", "={{ " + CONF + ".urlBrevo }}/contacts", 2640, 400, CRED_BREVO,
       corps="={{ JSON.stringify($json.contact) }}")
w.si("Nouvel inscrit ?", "$('Dédoublonner').item.json.existant === false", 2860, 400)
w.code("Préparer la bienvenue", "08_bienvenue_prompt.js", 3080, 560, commun=True)
w.claude("Claude : rédiger la bienvenue", 3300, 560)
w.code("Composer la bienvenue", "09_bienvenue_email.js", 3520, 560, commun=True)
w.http("Brevo : envoyer la bienvenue", "POST", "={{ " + CONF + ".urlBrevo }}/smtp/email", 3740, 560, CRED_BREVO,
       corps="={{ JSON.stringify($json.email) }}", continuer=True)
w.si("Lead chaud ?", "$('Préparer Brevo').item.json.leadChaud", 3960, 400)
w.code("Préparer l'alerte", "07_alerte.js", 4180, 300)
w.http("Brevo : envoyer l'alerte", "POST", "={{ " + CONF + ".urlBrevo }}/smtp/email", 4400, 300, CRED_BREVO,
       corps="={{ JSON.stringify($json.email) }}")

w.chaine("Formulaire Pacewell", "Configuration", "Nettoyer et valider", "Entrée valide ?")
w.lien("Entrée valide ?", "Réponse : inscrit", 0)
w.lien("Entrée valide ?", "Réponse : refus", 1)
w.chaine("Réponse : inscrit", "Brevo : contact existant ?", "Dédoublonner", "Déjà qualifié ?")
w.lien("Déjà qualifié ?", "Préparer le prompt", 1)
w.chaine("Préparer le prompt", "Claude : qualifier", "Valider la réponse IA", "Préparer Brevo",
         "Brevo : créer ou mettre à jour", "Nouvel inscrit ?")
w.lien("Nouvel inscrit ?", "Préparer la bienvenue", 0)
w.lien("Nouvel inscrit ?", "Lead chaud ?", 1)
w.chaine("Préparer la bienvenue", "Claude : rédiger la bienvenue", "Composer la bienvenue",
         "Brevo : envoyer la bienvenue", "Lead chaud ?")
w.lien("Lead chaud ?", "Préparer l'alerte", 0)
w.lien("Préparer l'alerte", "Brevo : envoyer l'alerte")
w.ecrire()

# --- 2. Réactivation : propose des relances, chaque lundi à 9 h (étape 3) -----------------
w = Workflow("Pacewell · Réactivation des inactifs", "pacewell-reactivation.json", "reactiv")
w.noeud("Chaque lundi à 9 h", "n8n-nodes-base.scheduleTrigger", 1.2, 0, 300, {
    "rule": {"interval": [{"field": "weeks", "weeksInterval": 1, "triggerAtDay": [1], "triggerAtHour": 9, "triggerAtMinute": 0}]}})
w.noeud("Lancer à la main", "n8n-nodes-base.manualTrigger", 1, 0, 480, {})
w.code("Configuration", "01_configuration.js", 220, 300)
w.http("Brevo : lister les contacts", "GET", "={{ " + CONF + ".urlBrevo }}/contacts?limit=1000&sort=desc",
       440, 300, CRED_BREVO)
w.code("Choisir les inactifs", "10_relance_selection.js", 660, 300, tous=True)
w.code("Préparer la relance", "11_relance_prompt.js", 880, 300, commun=True)
w.claude("Claude : proposer une relance", 1100, 300)
w.code("Composer la proposition", "12_relance_proposition.js", 1320, 300, commun=True)
w.http("Brevo : mettre la relance en attente", "PUT",
       "={{ " + CONF + ".urlBrevo }}/contacts/{{ encodeURIComponent($json.contact.email) }}", 1540, 300, CRED_BREVO,
       corps="={{ JSON.stringify($json.majContact) }}")
w.http("Brevo : demander ta validation", "POST", "={{ " + CONF + ".urlBrevo }}/smtp/email", 1760, 300, CRED_BREVO,
       corps="={{ JSON.stringify($('Composer la proposition').item.json.emailValidation) }}")
w.lien("Lancer à la main", "Configuration")
w.chaine("Chaque lundi à 9 h", "Configuration", "Brevo : lister les contacts", "Choisir les inactifs",
         "Préparer la relance", "Claude : proposer une relance", "Composer la proposition",
         "Brevo : mettre la relance en attente", "Brevo : demander ta validation")
w.ecrire()

# --- 3. Validation des relances : liens « Envoyer » et « Ignorer » (étape 3) -------------
w = Workflow("Pacewell · Validation des relances", "pacewell-validation.json", "valid")
w.webhook("Lien de validation", "GET", "pacewell-relance", 0, 200)
w.webhook("Confirmation", "POST", "pacewell-relance-decision", 0, 420)
w.code("Configuration", "01_configuration.js", 220, 300)
w.http("Brevo : lire le contact", "GET",
       "={{ " + CONF + ".urlBrevo }}/contacts/{{ encodeURIComponent(String($json.formulaire.email || $json.query.email || '-').trim().toLowerCase()) }}",
       440, 300, CRED_BREVO, reponse_complete=True)
w.code("Traiter la décision", "13_relance_decision.js", 660, 300, commun=True)
w.si("Décision à appliquer ?", "['envoyer', 'ignorer'].includes($json.action)", 880, 300)
w.si("Envoyer ?", "$json.action === 'envoyer'", 1100, 200)
w.http("Brevo : envoyer la relance", "POST", "={{ " + CONF + ".urlBrevo }}/smtp/email", 1320, 120, CRED_BREVO,
       corps="={{ JSON.stringify($json.emailContact) }}")
w.http("Brevo : clore la relance", "PUT",
       "={{ " + CONF + ".urlBrevo }}/contacts/{{ encodeURIComponent($('Traiter la décision').item.json.email) }}",
       1540, 200, CRED_BREVO, corps="={{ JSON.stringify($('Traiter la décision').item.json.majContact) }}")
w.repondre("Page de réponse", "={{ $('Traiter la décision').item.json.page }}", 200, 1760, 300, html=True)
w.lien("Lien de validation", "Configuration")
w.lien("Confirmation", "Configuration")
w.chaine("Configuration", "Brevo : lire le contact", "Traiter la décision", "Décision à appliquer ?")
w.lien("Décision à appliquer ?", "Envoyer ?", 0)
w.lien("Décision à appliquer ?", "Page de réponse", 1)
w.lien("Envoyer ?", "Brevo : envoyer la relance", 0)
w.lien("Envoyer ?", "Brevo : clore la relance", 1)
w.chaine("Brevo : envoyer la relance", "Brevo : clore la relance", "Page de réponse")
w.ecrire()

# --- 4. Statistiques du tableau de bord (étape 4) -------------------------------------------
w = Workflow("Pacewell · Statistiques", "pacewell-statistiques.json", "stats")
w.webhook("Tableau de bord", "GET", "pacewell-stats", 0, 300, ORIGINE_LANDING)
w.code("Configuration", "01_configuration.js", 220, 300)
w.http("Brevo : lister les contacts", "GET", "={{ " + CONF + ".urlBrevo }}/contacts?limit=1000&sort=desc",
       440, 300, CRED_BREVO)
w.noeud("Étiquettes à mesurer", "n8n-nodes-base.code", 2, 660, 300, {"mode": "runOnceForAllItems", "jsCode": """// Une ligne par type d'email suivi dans Brevo (étiquette posée à l'envoi).
return [
  { cle: 'bienvenue', tag: 'pacewell-bienvenue', libelle: 'Bienvenue' },
  { cle: 'alerte', tag: 'pacewell-alerte', libelle: 'Alertes lead chaud' },
  { cle: 'relance', tag: 'pacewell-relance', libelle: 'Relances' },
].map((json) => ({ json }));"""})
w.http("Brevo : statistiques d'envoi", "GET",
       "={{ " + CONF1 + ".urlBrevo }}/smtp/statistics/aggregatedReport?days=90&tag={{ $json.tag }}",
       880, 300, CRED_BREVO, continuer=True)
w.code("Calculer les statistiques", "14_statistiques.js", 1100, 300, commun=True, tous=True)
w.repondre("Réponse : statistiques", "={{ JSON.stringify($json) }}", 200, 1320, 300)
w.chaine("Tableau de bord", "Configuration", "Brevo : lister les contacts", "Étiquettes à mesurer",
         "Brevo : statistiques d'envoi", "Calculer les statistiques", "Réponse : statistiques")
w.ecrire()

# --- 5. Évaluation de l'IA sur 30 profils annotés (étape 4) ----------------------------------
profils = json.loads((ICI.parent / "evaluation" / "profils.json").read_text(encoding="utf-8"))
w = Workflow("Pacewell · Évaluation de l'IA", "pacewell-evaluation.json", "eval")
w.noeud("Lancer l'évaluation", "n8n-nodes-base.manualTrigger", 1, 0, 300, {})
w.code("Configuration", "01_configuration.js", 220, 300)
w.code("Profils annotés", "15_evaluation_profils.js", 440, 300, tous=True,
       remplacer={"__PROFILS__": json.dumps(profils, ensure_ascii=False)})
w.code("Préparer le prompt", "04_preparer_prompt.js", 660, 300)
w.claude("Claude : qualifier", 880, 300, espacer_ms=2500)
w.code("Valider la réponse IA", "05_valider_ia.js", 1100, 300,
       remplacer={"$('Dédoublonner')": "$('Profils annotés')"})
w.code("Bilan", "16_evaluation_bilan.js", 1320, 300, tous=True)
w.chaine("Lancer l'évaluation", "Configuration", "Profils annotés", "Préparer le prompt",
         "Claude : qualifier", "Valider la réponse IA", "Bilan")
w.ecrire()
