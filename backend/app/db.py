"""Motor de base de datos, sesión y tipos compartidos."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from typing import overload

from fastapi import Request
from sqlalchemy import JSON, Float, create_engine
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.types import TypeDecorator

from .config import get_settings


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(UTC)


@overload
def as_aware(value: datetime) -> datetime: ...
@overload
def as_aware(value: None) -> None: ...
def as_aware(value: datetime | None) -> datetime | None:
    """SQLite devuelve fechas sin zona horaria; PostgreSQL con zona. Normaliza a UTC."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


class EmbeddingType(TypeDecorator):
    """Vector de embeddings.

    En PostgreSQL la columna real es `vector` (pgvector) o `double precision[]` si la
    extensión no está instalada; en ambos casos se escribe como arreglo de float8 y
    pgvector aplica su conversión de asignación. En SQLite (pruebas) se guarda como JSON.
    La búsqueda vectorial se hace con SQL explícito en services/retrieval.py.
    """

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(postgresql.ARRAY(Float))
        return dialect.type_descriptor(JSON())

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return [float(x) for x in value]

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, str):  # columna pgvector leída como texto: "[0.1,0.2]"
            return [float(x) for x in value.strip("[]{}").split(",") if x.strip()]
        return [float(x) for x in value]


def build_engine(url: str):
    if not url.startswith("sqlite"):
        return create_engine(url, pool_pre_ping=True)
    from sqlalchemy import event
    from sqlalchemy.pool import StaticPool

    sqlite_engine = create_engine(url, connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(sqlite_engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _record):  # SQLite (pruebas) respeta ON DELETE CASCADE
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    return sqlite_engine


engine = build_engine(get_settings().DATABASE_URL)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db(request: Request) -> Iterator[Session]:
    db: Session = request.app.state.session_factory()
    try:
        yield db
    finally:
        db.close()
