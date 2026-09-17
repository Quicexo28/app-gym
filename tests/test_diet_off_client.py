from __future__ import annotations

from typing import Any

import pytest

from app.nutrition import off_client


class _FakeResponse:
    def __init__(self, payload: Any, *, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise off_client.httpx.HTTPStatusError("error", request=None, response=self)  # type: ignore[arg-type]

    def json(self) -> Any:
        return self._payload


def test_fetch_product_by_barcode_returns_product_on_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    def fake_get(url: str, **kwargs: Any) -> _FakeResponse:
        captured["url"] = url
        captured["kwargs"] = kwargs
        return _FakeResponse(
            {
                "code": "7501234567890",
                "status": 1,
                "product": {
                    "code": "7501234567890",
                    "product_name": "Leche entera",
                    "brands": "Alqueria",
                    "quantity": "1 L",
                    "nutriments": {"energy-kcal_100g": 60.0},
                },
            }
        )

    monkeypatch.setattr(off_client.httpx, "get", fake_get)

    product = off_client.fetch_product_by_barcode("7501234567890")

    assert product is not None
    assert product.barcode == "7501234567890"
    assert product.name == "Leche entera"
    assert product.brand == "Alqueria"
    assert product.quantity_label == "1 L"
    assert product.nutriments == {"energy-kcal_100g": 60.0}
    assert "7501234567890" in captured["url"]


def test_fetch_product_by_barcode_returns_none_when_status_is_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verificado en vivo: status=0 con HTTP 200 significa 'no encontrado'."""

    def fake_get(url: str, **kwargs: Any) -> _FakeResponse:
        return _FakeResponse(
            {"code": "0000000000000", "status": 0, "status_verbose": "product not found"}
        )

    monkeypatch.setattr(off_client.httpx, "get", fake_get)

    product = off_client.fetch_product_by_barcode("0000000000000")

    assert product is None


def test_fetch_product_by_barcode_returns_none_when_status_field_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_get(url: str, **kwargs: Any) -> _FakeResponse:
        return _FakeResponse({"code": "123"})

    monkeypatch.setattr(off_client.httpx, "get", fake_get)

    assert off_client.fetch_product_by_barcode("123") is None


def test_fetch_product_by_barcode_never_raises_on_network_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_get(url: str, **kwargs: Any) -> _FakeResponse:
        raise ConnectionError("network is down")

    monkeypatch.setattr(off_client.httpx, "get", fake_get)

    product = off_client.fetch_product_by_barcode("7501234567890")

    assert product is None


def test_fetch_product_by_barcode_never_raises_on_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get(url: str, **kwargs: Any) -> _FakeResponse:
        raise TimeoutError("timed out")

    monkeypatch.setattr(off_client.httpx, "get", fake_get)

    assert off_client.fetch_product_by_barcode("7501234567890") is None


def test_fetch_product_by_barcode_never_raises_on_malformed_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _BadJsonResponse(_FakeResponse):
        def json(self) -> Any:
            raise ValueError("not json")

    def fake_get(url: str, **kwargs: Any) -> _BadJsonResponse:
        return _BadJsonResponse({})

    monkeypatch.setattr(off_client.httpx, "get", fake_get)

    assert off_client.fetch_product_by_barcode("7501234567890") is None


def test_fetch_product_by_barcode_never_raises_on_http_error_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_get(url: str, **kwargs: Any) -> _FakeResponse:
        return _FakeResponse({}, status_code=500)

    monkeypatch.setattr(off_client.httpx, "get", fake_get)

    assert off_client.fetch_product_by_barcode("7501234567890") is None


def test_fetch_product_by_barcode_empty_barcode_returns_none_without_network_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_get(url: str, **kwargs: Any) -> _FakeResponse:
        raise AssertionError("no deberia llamar a la red")

    monkeypatch.setattr(off_client.httpx, "get", fake_get)

    assert off_client.fetch_product_by_barcode("   ") is None
    assert off_client.fetch_product_by_barcode("") is None


def test_fetch_product_by_barcode_sends_required_user_agent_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    def fake_get(url: str, **kwargs: Any) -> _FakeResponse:
        captured["headers"] = kwargs.get("headers")
        captured["timeout"] = kwargs.get("timeout")
        return _FakeResponse({"status": 0})

    monkeypatch.setattr(off_client.httpx, "get", fake_get)

    off_client.fetch_product_by_barcode("123")

    assert captured["headers"] == {"User-Agent": off_client.USER_AGENT}
    assert captured["timeout"] == off_client.REQUEST_TIMEOUT_SECONDS == 8.0


def test_search_products_returns_parsed_results(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get(url: str, **kwargs: Any) -> _FakeResponse:
        return _FakeResponse(
            {
                "products": [
                    {"code": "111", "product_name": "Arroz", "nutriments": {}},
                    {"code": "222", "product_name": "Frijol", "nutriments": {}},
                ]
            }
        )

    monkeypatch.setattr(off_client.httpx, "get", fake_get)

    results = off_client.search_products("arroz")

    assert [r.barcode for r in results] == ["111", "222"]
    assert [r.name for r in results] == ["Arroz", "Frijol"]


def test_search_products_skips_items_without_name_or_barcode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_get(url: str, **kwargs: Any) -> _FakeResponse:
        return _FakeResponse(
            {
                "products": [
                    {"code": "111", "product_name": ""},
                    {"code": "", "product_name": "Sin codigo"},
                    {"code": "333", "product_name": "Valido"},
                    "not-a-dict",
                ]
            }
        )

    monkeypatch.setattr(off_client.httpx, "get", fake_get)

    results = off_client.search_products("x")

    assert len(results) == 1
    assert results[0].barcode == "333"


def test_search_products_empty_query_returns_empty_without_network_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_get(url: str, **kwargs: Any) -> _FakeResponse:
        raise AssertionError("no deberia llamar a la red")

    monkeypatch.setattr(off_client.httpx, "get", fake_get)

    assert off_client.search_products("   ") == []


def test_search_products_never_raises_on_network_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get(url: str, **kwargs: Any) -> _FakeResponse:
        raise ConnectionError("down")

    monkeypatch.setattr(off_client.httpx, "get", fake_get)

    assert off_client.search_products("arroz") == []


def test_search_products_malformed_payload_returns_empty_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_get(url: str, **kwargs: Any) -> _FakeResponse:
        return _FakeResponse({"products": "not-a-list"})

    monkeypatch.setattr(off_client.httpx, "get", fake_get)

    assert off_client.search_products("arroz") == []
