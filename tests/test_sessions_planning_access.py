from fastapi.testclient import TestClient

from app.main import create_app


def test_sessions_requires_authentication() -> None:
    app = create_app()
    client = TestClient(app)

    response = client.get("/api/v1/sessions/athlete-001")

    assert response.status_code == 401
    payload = response.json()
    assert payload.get("code") == "http_401"
    assert isinstance(payload.get("detail"), str)
    assert isinstance(payload.get("context"), dict)


def test_planning_templates_requires_authentication() -> None:
    app = create_app()
    client = TestClient(app)

    response = client.get("/api/v1/planning/templates")

    assert response.status_code == 401
    payload = response.json()
    assert payload.get("code") == "http_401"
    assert isinstance(payload.get("detail"), str)
    assert isinstance(payload.get("context"), dict)
