import pytest
from fastapi.testclient import TestClient

from gridxray.api.auth import COOKIE_NAME
from gridxray.api.main import app
from gridxray.config import settings


@pytest.fixture
def client():
    with TestClient(app) as c:  # runs lifespan: creates tables + demo user
        yield c


def test_scenarios_require_login(client):
    assert client.post("/scenarios").status_code == 401


def test_demo_button_signs_in(client):
    r = client.post("/auth/demo")
    assert r.status_code == 200 and r.json()["is_demo"]
    cookie = r.headers["set-cookie"]
    assert COOKIE_NAME in cookie and "HttpOnly" in cookie
    assert client.get("/auth/me").json()["email"] == settings.demo_user_email
    assert client.post("/scenarios?complexity=easy&seed=1").status_code == 200
    assert client.post("/scenarios?reference=cigre_mv").json()["source"] == "cigre_mv"


def test_password_login(client):
    bad = client.post("/auth/login", json={"email": settings.demo_user_email, "password": "nope"})
    assert bad.status_code == 401
    ok = client.post(
        "/auth/login",
        json={"email": settings.demo_user_email.upper(), "password": settings.demo_user_password},
    )
    assert ok.status_code == 200


def test_logout_ends_session(client):
    client.post("/auth/demo")
    assert client.post("/auth/logout").status_code == 204
    assert client.get("/auth/me").status_code == 401


def test_tampered_token_rejected(client):
    client.cookies.set(COOKIE_NAME, "not-a-jwt")
    assert client.get("/auth/me").status_code == 401


def test_showcase_is_public_and_includes_truth(client):
    body = client.get("/showcase").json()
    assert body["truth"]["edges"] and body["nodes"]


def test_truth_requires_login_and_matches_seed(client):
    assert client.post("/scenarios/truth?complexity=medium&seed=3").status_code == 401
    client.post("/auth/demo")
    truth = client.post("/scenarios/truth?complexity=medium&seed=3").json()["truth"]
    assert truth["edges"] and truth["lines"]
