"""Smoke test do endpoint de saúde (não exige banco)."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health() -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_root() -> None:
    r = client.get("/")
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "PizzaBot API"
    assert data["version"] == "2.0.0"
