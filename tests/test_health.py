from fastapi.testclient import TestClient

from app.main import create_app


def test_health_ok():
    app = create_app()
    client = TestClient(app)

    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_ping():
    app = create_app()
    client = TestClient(app)

    r = client.get("/api/v1/meta/ping")
    assert r.status_code == 200
    assert r.json() == {"pong": True}


def test_ready_ok():
    app = create_app()
    client = TestClient(app)

    r = client.get("/ready")
    assert r.status_code == 200
    payload = r.json()
    assert payload.get("status") in {"ok", "degraded"}
    assert "checks" in payload


def test_error_contract_404_and_request_headers():
    app = create_app()
    client = TestClient(app)

    r = client.get("/api/v1/route-does-not-exist")
    assert r.status_code == 404
    payload = r.json()
    assert payload.get("code") == "http_404"
    assert isinstance(payload.get("detail"), str)
    assert isinstance(payload.get("context"), dict)
    assert r.headers.get("X-Request-Id")
    assert r.headers.get("X-Response-Time-Ms")
