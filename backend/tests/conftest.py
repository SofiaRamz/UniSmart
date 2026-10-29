"""Fixtures de pruebas. Por defecto usan SQLite en memoria; para PostgreSQL:
set TEST_DATABASE_URL=postgresql+psycopg://unismart:unismart_dev_2026@localhost:5432/unismart_test
"""

from __future__ import annotations

import os
import tempfile

os.environ["DATABASE_URL"] = os.getenv("TEST_DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ["EMBEDDING_PROVIDER"] = "hash"
os.environ["UPLOAD_DIR"] = tempfile.mkdtemp(prefix="unismart-uploads-")
os.environ["FRONTEND_DIR"] = tempfile.mkdtemp(prefix="unismart-static-")
os.environ["RAG_MIN_SIMILARITY"] = "0.30"
os.environ["COOKIE_SECURE"] = "false"
os.environ["CORS_ORIGINS"] = "[]"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.db import Base, engine  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import Department, Role, User, UserRole  # noqa: E402
from app.ratelimit import limiter  # noqa: E402
from app.security import hash_password  # noqa: E402
from app.seed import seed_reference_data  # noqa: E402
from app.services import retrieval  # noqa: E402
from app.services.embeddings import HashEmbedder  # noqa: E402
from app.services.llm import LLMUnavailable  # noqa: E402

PASSWORD = "Prueba2026segura"
_PASSWORD_HASH = hash_password(PASSWORD)  # Argon2id una sola vez para acelerar las pruebas

USERS = {
    "super": ("super@unismart.test", None),
    "control": ("control@unismart.test", "CONTROL_ESCOLAR"),
    "servicios": ("servicios@unismart.test", "SERVICIOS_ESCOLARES"),
    "coordinacion": ("coordinacion@unismart.test", "COORDINACION_ACADEMICA"),
    "mantenimiento": ("mantenimiento@unismart.test", "MANTENIMIENTO"),
    "campus": ("campus@unismart.test", "SERVICIOS_CAMPUS"),
}


class FakeLLM:
    """Sustituye a LM Studio: registra los mensajes y devuelve una respuesta controlada."""

    def __init__(self) -> None:
        self.calls: list[list[dict]] = []
        self.reply = "Según el reglamento, se requiere 80% de asistencia [1]."
        self.fail = False

    def __call__(self, messages: list[dict]) -> str:
        self.calls.append(messages)
        if self.fail:
            raise LLMUnavailable("sin servidor")
        return self.reply


@pytest.fixture()
def session_factory():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with factory() as db:
        seed_reference_data(db)
        super_role = db.scalar(select(Role).where(Role.code == "superadmin"))
        staff_role = db.scalar(select(Role).where(Role.code == "staff"))
        for key, (email, dep_code) in USERS.items():
            user = User(email=email, full_name=f"Usuario {key}", password_hash=_PASSWORD_HASH)
            if dep_code is None:
                user.roles.append(UserRole(role=super_role))
            else:
                dep = db.scalar(select(Department).where(Department.code == dep_code))
                user.roles.append(UserRole(role=staff_role, department=dep))
            db.add(user)
        db.commit()
    yield factory
    Base.metadata.drop_all(engine)


@pytest.fixture()
def app(session_factory):
    limiter.reset()
    retrieval.invalidate_vector_cache()
    retrieval._mode_cache.clear()
    fake = FakeLLM()
    application = create_app(session_factory=session_factory, llm=fake, embedder_factory=HashEmbedder)
    application.state.fake_llm = fake
    return application


@pytest.fixture()
def client(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def make_client(app):
    clients: list[TestClient] = []

    def factory() -> TestClient:
        c = TestClient(app)
        clients.append(c)
        return c

    yield factory
    for c in clients:
        c.close()


def login(client: TestClient, who: str, password: str = PASSWORD) -> dict:
    """Inicia sesión y devuelve el encabezado CSRF para peticiones que modifican datos."""
    response = client.post("/api/auth/login", json={"email": USERS[who][0], "password": password})
    assert response.status_code == 200, response.text
    return {"X-CSRF-Token": response.json()["csrf_token"]}
