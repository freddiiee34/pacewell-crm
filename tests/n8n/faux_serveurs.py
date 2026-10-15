"""Faux Brevo + faux Claude pour tester le workflow dans un vrai n8n.

Enregistre chaque requête reçue dans journal.jsonl. Le comportement se règle
via le fichier scenario.json (contact existant, réponse de l'IA…).
"""

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ICI = Path(__file__).parent
JOURNAL = ICI / "journal.jsonl"
SCENARIO = ICI / "scenario.json"


def scenario():
    return json.loads(SCENARIO.read_text()) if SCENARIO.exists() else {}


class Faux(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _repondre(self, code, corps=None):
        donnees = json.dumps(corps).encode() if corps is not None else b""
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(donnees)))
        self.end_headers()
        self.wfile.write(donnees)

    def _noter(self, corps):
        with JOURNAL.open("a") as f:
            f.write(json.dumps({"methode": self.command, "chemin": self.path, "corps": corps,
                                "api_key": self.headers.get("api-key"),
                                "x_api_key": self.headers.get("x-api-key"),
                                "anthropic_version": self.headers.get("anthropic-version")}) + "\n")

    def do_GET(self):
        self._noter(None)
        s = scenario()
        if self.path.startswith("/v3/contacts?"):
            return self._repondre(200, {"contacts": s.get("contacts", []), "count": len(s.get("contacts", []))})
        if self.path.startswith("/v3/contacts/"):
            if s.get("contact"):
                return self._repondre(200, s["contact"])
            return self._repondre(404, {"code": "document_not_found", "message": "Contact does not exist"})
        if self.path.startswith("/v3/smtp/statistics/aggregatedReport"):
            return self._repondre(200, {"requests": 4, "delivered": 4, "uniqueOpens": 2, "uniqueClicks": 1,
                                        "hardBounces": 0, "softBounces": 0, "blocked": 0})
        self._repondre(404, {})

    def do_PUT(self):
        taille = int(self.headers.get("Content-Length", 0))
        self._noter(json.loads(self.rfile.read(taille) or b"{}"))
        self._repondre(204)

    def do_POST(self):
        taille = int(self.headers.get("Content-Length", 0))
        corps = json.loads(self.rfile.read(taille) or b"{}")
        self._noter(corps)
        s = scenario()
        if self.path == "/v1/messages":
            consignes = corps.get("system", "")
            if "email de bienvenue" in consignes or "email de relance" in consignes:
                cle = "ia_bienvenue" if "bienvenue" in consignes else "ia_relance"
                return self._repondre(200, {"content": [{"type": "text", "text": json.dumps(s.get(cle, {}))}],
                                            "usage": {"input_tokens": 700, "output_tokens": 200}})
            if s.get("ia_statut", 200) != 200:
                return self._repondre(s["ia_statut"], {"type": "error"})
            texte = s.get("ia_texte") or json.dumps(s.get("ia_reponse", {}))
            return self._repondre(200, {"content": [{"type": "text", "text": texte}],
                                        "usage": {"input_tokens": 600, "output_tokens": 60}})
        if self.path == "/v3/contacts":
            return self._repondre(201, {"id": 42})
        if self.path == "/v3/smtp/email":
            return self._repondre(201, {"messageId": "<test@brevo>"})
        self._repondre(404, {})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9100
    ThreadingHTTPServer(("127.0.0.1", port), Faux).serve_forever()
