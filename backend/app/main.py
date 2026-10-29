"""Punto de entrada FastAPI: API + frontend compilado servido en el mismo origen."""

from __future__ import annotations

import base64
import hashlib
import logging
import re
from collections.abc import Callable
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session

from . import __version__
from .config import get_settings
from .db import SessionLocal
from .routers import admin_documents, admin_locations, admin_reports, admin_schedules, auth, public, superadmin
from .services.embeddings import get_embedder
from .services.llm import lmstudio_chat

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("unismart")

_SCRIPT_RE = re.compile(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.DOTALL | re.IGNORECASE)


def _content_security_policy(index_html: Path) -> str:
    """CSP estricta: solo se permiten los scripts en línea del index.html compilado (por hash)."""
    hashes = []
    if index_html.exists():
        for script in _SCRIPT_RE.findall(index_html.read_text(encoding="utf-8")):
            digest = base64.b64encode(hashlib.sha256(script.encode("utf-8")).digest()).decode()
            hashes.append(f"'sha256-{digest}'")
    return "; ".join(
        [
            "default-src 'self'",
            f"script-src 'self' {' '.join(hashes)} https://cdnjs.cloudflare.com",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
            "connect-src 'self'",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
        ]
    )


def create_app(
    session_factory: Callable[[], Session] | None = None,
    llm: Callable | None = None,
    embedder_factory: Callable | None = None,
) -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="UniSmart AI API",
        version=__version__,
        docs_url=None if settings.is_production else "/api/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/api/openapi.json",
    )
    app.state.session_factory = session_factory or SessionLocal
    app.state.llm = llm or lmstudio_chat
    app.state.get_embedder = embedder_factory or get_embedder

    if settings.CORS_ORIGINS:  # solo para desarrollo con el servidor de Vite en otro puerto
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.CORS_ORIGINS,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=["Content-Type", "X-CSRF-Token"],
        )

    index_html = settings.FRONTEND_DIR / "index.html"
    csp = _content_security_policy(index_html)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        else:
            response.headers.setdefault("Content-Security-Policy", csp)
        if settings.COOKIE_SECURE:
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):  # nunca se exponen trazas al cliente
        log.exception("Error no controlado en %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Error interno del servidor"})

    for router in (
        public.router,
        auth.router,
        admin_documents.router,
        admin_schedules.router,
        admin_reports.router,
        admin_locations.router,
        superadmin.router,
    ):
        app.include_router(router)

    frontend_root = settings.FRONTEND_DIR.resolve()

    @app.get("/{full_path:path}", include_in_schema=False)
    def frontend(full_path: str):
        if full_path.startswith("api/") or full_path == "api":
            raise HTTPException(status_code=404, detail="Ruta no encontrada")
        candidate = (frontend_root / full_path).resolve()
        if full_path and candidate.is_file() and frontend_root in candidate.parents:
            return FileResponse(candidate)
        if index_html.exists():
            return FileResponse(index_html, headers={"Cache-Control": "no-cache"})
        return JSONResponse(
            {"detail": "Frontend no compilado. Copia unismart-frontend.html a backend/static/index.html"},
            status_code=404,
        )

    return app


app = create_app()
