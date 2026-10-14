"""Test du script de mise en place Brevo contre un faux Brevo local."""

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))


class FauxBrevo(BaseHTTPRequestHandler):
    etat: dict = {}

    def log_message(self, *a):
        pass

    def _rep(self, code, corps):
        b = json.dumps(corps).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        e = self.etat
        if self.headers.get("api-key") != "bonne-cle":
            return self._rep(401, {"message": "Key not found"})
        if self.path.startswith("/v3/contacts/attributes"):
            return self._rep(200, {"attributes": [{"name": n} for n in e["attributs"]]})
        if self.path.startswith("/v3/contacts/folders"):
            return self._rep(200, {"folders": e["dossiers"]})
        if self.path.startswith("/v3/contacts/lists"):
            return self._rep(200, {"lists": e["listes"]})
        self._rep(404, {})

    def do_POST(self):
        e = self.etat
        corps = json.loads(self.rfile.read(int(self.headers["Content-Length"])) or b"{}")
        e["appels"].append((self.path, corps))
        if self.path.startswith("/v3/contacts/attributes/normal/"):
            e["attributs"].append(self.path.rsplit("/", 1)[1])
            return self._rep(201, {})
        if self.path == "/v3/contacts/folders":
            e["dossiers"].append({"id": 7, "name": corps["name"]})
            return self._rep(201, {"id": 7})
        if self.path == "/v3/contacts/lists":
            nouvel_id = 100 + len(e["listes"])
            e["listes"].append({"id": nouvel_id, "name": corps["name"], "folderId": corps["folderId"]})
            return self._rep(201, {"id": nouvel_id})
        self._rep(404, {})


@pytest.fixture
def brevo(monkeypatch):
    FauxBrevo.etat = {"attributs": ["PRENOM", "NOM", "EMAIL"], "dossiers": [], "listes": [], "appels": []}
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), FauxBrevo)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    monkeypatch.setenv("NO_PROXY", "127.0.0.1")
    monkeypatch.setenv("no_proxy", "127.0.0.1")
    import setup_brevo
    monkeypatch.setattr(setup_brevo, "API", f"http://127.0.0.1:{httpd.server_address[1]}/v3")
    yield setup_brevo, FauxBrevo.etat
    httpd.shutdown()


def test_cree_tout_puis_est_idempotent(brevo):
    mod, etat = brevo
    ids = mod.preparer("bonne-cle", afficher=lambda *_: None)
    assert set(ids) == set(mod.LISTES)
    assert all(i >= 100 for i in ids.values())
    crees = [p.rsplit("/", 1)[1] for p, _ in etat["appels"] if "/attributes/" in p]
    assert "PRENOM" not in crees  # existait déjà
    assert "SEGMENT" in crees and "SCORE" in crees
    assert all(c["folderId"] == 7 for p, c in etat["appels"] if p == "/v3/contacts/lists")

    nb = len(etat["appels"])
    assert mod.preparer("bonne-cle", afficher=lambda *_: None) == ids  # 2e passage : mêmes ID
    assert len(etat["appels"]) == nb  # et rien de recréé


def test_simulation_ne_cree_rien(brevo):
    mod, etat = brevo
    mod.preparer("bonne-cle", simulation=True, afficher=lambda *_: None)
    assert etat["appels"] == []


def test_mauvaise_cle(brevo):
    mod, _ = brevo
    with pytest.raises(mod.ErreurBrevo, match="Clé API refusée"):
        mod.preparer("mauvaise", afficher=lambda *_: None)
