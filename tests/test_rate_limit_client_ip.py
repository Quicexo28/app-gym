from types import SimpleNamespace

from app.core.rate_limit import client_ip


def _req(peer: str, xff: str | None = None):
    headers = {"x-forwarded-for": xff} if xff else {}
    return SimpleNamespace(client=SimpleNamespace(host=peer), headers=headers)


def test_proxy_privado_usa_ultima_entrada_de_xff():
    assert client_ip(_req("172.18.0.5", "9.9.9.9, 203.0.113.7")) == "203.0.113.7"


def test_peer_publico_ignora_xff():
    assert client_ip(_req("8.8.4.4", "1.2.3.4")) == "8.8.4.4"


def test_sin_xff_usa_peer():
    assert client_ip(_req("172.18.0.5")) == "172.18.0.5"
