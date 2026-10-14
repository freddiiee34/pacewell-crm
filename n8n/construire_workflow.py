"""Assemble le workflow n8n « Qualification » à partir des fichiers de code/.

Le code des nœuds vit dans des fichiers .js testés (tests/), et ce script
les injecte dans le JSON importable dans n8n. Lancer :
    python3 n8n/construire_workflow.py
"""

import json
import uuid
from pathlib import Path

ICI = Path(__file__).parent
CODE = ICI / "code"
SORTIE = ICI / "pacewell-qualification.json"

CRED_BREVO = {"httpHeaderAuth": {"id": "", "name": "Brevo API"}}
CRED_CLAUDE = {"httpHeaderAuth": {"id": "", "name": "Claude API"}}
CONF = "$('Configuration').item.json.config"
REPONSE_COMPLETE = {"response": {"response": {"fullResponse": True, "neverError": True}}}


def noeud(nom, type_, version, x, y, parametres, **extra):
    return {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, "pacewell/" + nom)), "name": nom,
            "type": type_, "typeVersion": version, "position": [x, y], "parameters": parametres, **extra}


def code(nom, fichier, x, y):
    return noeud(nom, "n8n-nodes-base.code", 2, x, y, {
        "mode": "runOnceForEachItem",
        "jsCode": (CODE / fichier).read_text(encoding="utf-8"),
    })


def si(nom, expression, x, y):
    return noeud(nom, "n8n-nodes-base.if", 2.3, x, y, {
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 3},
            "conditions": [{
                "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "cond/" + nom)),
                "leftValue": "={{ " + expression + " }}",
                "rightValue": "",
                "operator": {"type": "boolean", "operation": "true", "singleValue": True},
            }],
            "combinator": "and",
        },
        "options": {},
    })


def http(nom, methode, url, x, y, credentials, corps=None, entetes=None, reponse_complete=False, timeout=None):
    p = {
        "method": methode,
        "url": url,
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "options": {},
    }
    if entetes:
        p["sendHeaders"] = True
        p["headerParameters"] = {"parameters": [{"name": k, "value": v} for k, v in entetes.items()]}
    if corps:
        p.update({"sendBody": True, "specifyBody": "json", "jsonBody": corps})
    if reponse_complete:
        p["options"].update(REPONSE_COMPLETE)
    if timeout:
        p["options"]["timeout"] = timeout
    return noeud(nom, "n8n-nodes-base.httpRequest", 4.5, x, y, p, credentials=credentials)


def repondre(nom, corps, code_http, x, y):
    return noeud(nom, "n8n-nodes-base.respondToWebhook", 1.5, x, y, {
        "respondWith": "json",
        "responseBody": corps,
        "options": {"responseCode": code_http},
    })


noeuds = [
    noeud("Formulaire Pacewell", "n8n-nodes-base.webhook", 2.1, 0, 300, {
        "httpMethod": "POST",
        "path": "pacewell-inscription",
        "responseMode": "responseNode",
        "options": {"allowedOrigins": "https://pacewell.simondelrue.fr"},
    }, webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "pacewell/webhook"))),
    code("Configuration", "01_configuration.js", 220, 300),
    code("Nettoyer et valider", "02_nettoyer.js", 440, 300),
    si("Entrée valide ?", "$json.ok", 660, 300),
    repondre("Réponse : refus", "={{ JSON.stringify({ ok: false, erreur: $json.erreur === 'spam' ? 'Demande refusée.' : $json.erreur }) }}", 400, 880, 520),
    http("Brevo : contact existant ?", "GET",
         "={{ " + CONF + ".urlBrevo }}/contacts/{{ encodeURIComponent($json.lead.email) }}",
         880, 300, CRED_BREVO, reponse_complete=True),
    code("Dédoublonner", "03_dedoublonner.js", 1100, 300),
    si("Déjà qualifié ?", "$json.doublon", 1320, 300),
    code("Préparer le prompt", "04_preparer_prompt.js", 1540, 400),
    http("Claude : qualifier", "POST", "={{ " + CONF + ".urlClaude }}/messages", 1760, 400, CRED_CLAUDE,
         corps="={{ JSON.stringify($json.requete) }}", entetes={"anthropic-version": "2023-06-01"},
         reponse_complete=True, timeout=30000),
    code("Valider la réponse IA", "05_valider_ia.js", 1980, 400),
    code("Préparer Brevo", "06_preparer_brevo.js", 2200, 400),
    http("Brevo : créer ou mettre à jour", "POST", "={{ " + CONF + ".urlBrevo }}/contacts", 2420, 400, CRED_BREVO,
         corps="={{ JSON.stringify($json.contact) }}"),
    si("Lead chaud ?", "$('Préparer Brevo').item.json.leadChaud", 2640, 400),
    code("Préparer l'alerte", "07_alerte.js", 2860, 300),
    http("Brevo : envoyer l'alerte", "POST", "={{ " + CONF + ".urlBrevo }}/smtp/email", 3080, 300, CRED_BREVO,
         corps="={{ JSON.stringify($json.email) }}"),
    repondre("Réponse : inscrit", '={{ JSON.stringify({ ok: true }) }}', 200, 3300, 400),
]


def lien(source, cible, sortie=0):
    return source, sortie, cible


liens = [
    lien("Formulaire Pacewell", "Configuration"),
    lien("Configuration", "Nettoyer et valider"),
    lien("Nettoyer et valider", "Entrée valide ?"),
    lien("Entrée valide ?", "Brevo : contact existant ?", 0),
    lien("Entrée valide ?", "Réponse : refus", 1),
    lien("Brevo : contact existant ?", "Dédoublonner"),
    lien("Dédoublonner", "Déjà qualifié ?"),
    lien("Déjà qualifié ?", "Réponse : inscrit", 0),
    lien("Déjà qualifié ?", "Préparer le prompt", 1),
    lien("Préparer le prompt", "Claude : qualifier"),
    lien("Claude : qualifier", "Valider la réponse IA"),
    lien("Valider la réponse IA", "Préparer Brevo"),
    lien("Préparer Brevo", "Brevo : créer ou mettre à jour"),
    lien("Brevo : créer ou mettre à jour", "Lead chaud ?"),
    lien("Lead chaud ?", "Préparer l'alerte", 0),
    lien("Lead chaud ?", "Réponse : inscrit", 1),
    lien("Préparer l'alerte", "Brevo : envoyer l'alerte"),
    lien("Brevo : envoyer l'alerte", "Réponse : inscrit"),
]

connexions: dict = {}
for source, sortie, cible in liens:
    sorties = connexions.setdefault(source, {"main": []})["main"]
    while len(sorties) <= sortie:
        sorties.append([])
    sorties[sortie].append({"node": cible, "type": "main", "index": 0})

workflow = {
    "name": "Pacewell · Qualification des inscrits",
    "nodes": noeuds,
    "connections": connexions,
    "settings": {"executionOrder": "v1"},
    "pinData": {},
    "active": False,
}

SORTIE.write_text(json.dumps(workflow, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"{SORTIE.name} : {len(noeuds)} nœuds, {len(liens)} liens")
