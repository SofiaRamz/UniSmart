"""Configuración centralizada (variables de entorno / archivo .env)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent  # carpeta backend/


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    APP_ENV: str = "development"  # development | production
    SECRET_KEY: str = "cambia-esta-clave-larga-y-aleatoria"
    DATABASE_URL: str = "postgresql+psycopg://unismart:unismart_dev_2026@localhost:5432/unismart"

    # Sesiones (cookie HttpOnly con token opaco; el servidor guarda solo su hash)
    SESSION_COOKIE_NAME: str = "unismart_session"
    SESSION_TTL_HOURS: int = 8
    COOKIE_SECURE: bool = False  # True en producción con HTTPS
    COOKIE_SAMESITE: Literal["lax", "strict", "none"] = "lax"
    CORS_ORIGINS: list[str] = []
    TRUST_PROXY_HEADERS: bool = False

    # LM Studio (API compatible con OpenAI)
    LMSTUDIO_BASE_URL: str = "http://127.0.0.1:1234/v1"
    LLM_MODEL: str = "qwen3-4b-instruct-2507"
    LLM_TEMPERATURE: float = 0.1
    LLM_MAX_TOKENS: int = 700
    LLM_TIMEOUT_SECONDS: float = 120.0

    # Embeddings locales: lmstudio | fastembed | hash (solo pruebas)
    EMBEDDING_PROVIDER: str = "lmstudio"
    EMBEDDING_MODEL: str = "text-embedding-nomic-embed-text-v1.5"
    EMBEDDING_QUERY_PREFIX: str = "search_query: "
    EMBEDDING_DOC_PREFIX: str = "search_document: "
    VECTOR_BACKEND: str = "auto"  # auto | pgvector | array

    # RAG
    RAG_TOP_K: int = 5
    RAG_MIN_SIMILARITY: float = 0.40
    RAG_MIN_KEYWORD_COVERAGE: float = 0.5
    CHUNK_SIZE: int = 900
    CHUNK_OVERLAP: int = 150

    # Archivos
    UPLOAD_DIR: Path = BASE_DIR / "uploads"
    MAX_UPLOAD_MB: int = 20
    MAX_PDF_PAGES: int = 600
    OCR_ENABLED: bool = False
    OCR_LANGUAGE: str = "spa"
    TESSDATA_PREFIX: str | None = None

    # Frontend compilado servido por FastAPI (mismo origen = cookies sin CORS)
    FRONTEND_DIR: Path = BASE_DIR / "static"

    # Límites anti-abuso
    RATE_LIMIT_CHAT_PER_MINUTE: int = 20
    RATE_LIMIT_REPORTS_PER_HOUR: int = 5
    RATE_LIMIT_LOGIN_PER_15_MIN: int = 20
    LOGIN_MAX_ATTEMPTS: int = 5
    LOGIN_LOCK_MINUTES: int = 15

    # Zona horaria para interpretar "hoy" en el chat
    TIMEZONE: str = "America/Mexico_City"

    # Solo para "python -m app.seed" (si faltan, el script las pide en la terminal)
    SUPERADMIN_EMAIL: str | None = None
    SUPERADMIN_PASSWORD: str | None = None
    DEMO_PASSWORD: str | None = None

    @property
    def is_production(self) -> bool:
        return self.APP_ENV.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
