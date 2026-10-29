"""Inicio y cierre de sesión del personal administrativo."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import delete, select

from .. import serializers
from ..config import get_settings
from ..core.fusion import password_problems
from ..db import as_aware, utcnow
from ..deps import CurrentPrincipal, DbSession, audit
from ..models import AuthSession, User
from ..ratelimit import client_ip, enforce
from ..schemas import ChangePasswordIn, LoginIn
from ..security import (
    burn_verification_time,
    hash_password,
    hash_token,
    new_token,
    password_needs_rehash,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["autenticación"])
INVALID_CREDENTIALS = "Correo o contraseña incorrectos"


def _set_session_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=token,
        max_age=settings.SESSION_TTL_HOURS * 3600,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        path="/",
    )


@router.post("/login")
def login(payload: LoginIn, request: Request, response: Response, db: DbSession) -> dict:
    settings = get_settings()
    enforce(request, "login", settings.RATE_LIMIT_LOGIN_PER_15_MIN, 900, "Demasiados intentos. Espera 15 minutos.")
    user = db.scalar(select(User).where(User.email == payload.email))
    now = utcnow()
    if user is None or not user.is_active:
        burn_verification_time(payload.password)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_CREDENTIALS)
    if user.locked_until is not None and as_aware(user.locked_until) > now:
        minutes = int((as_aware(user.locked_until) - now).total_seconds() // 60) + 1
        raise HTTPException(status_code=429, detail=f"Cuenta bloqueada temporalmente. Intenta en {minutes} min.")
    if not verify_password(user.password_hash, payload.password):
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= settings.LOGIN_MAX_ATTEMPTS:
            user.locked_until = now + timedelta(minutes=settings.LOGIN_LOCK_MINUTES)
            user.failed_login_attempts = 0
            audit(db, request, user, "auth.lock", "user", user.id)
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_CREDENTIALS)

    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)
    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login_at = now
    token, csrf = new_token(), new_token()
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.expires_at < now))
    db.add(
        AuthSession(
            id=hash_token(token),
            user_id=user.id,
            csrf_token=csrf,
            created_at=now,
            last_seen_at=now,
            expires_at=now + timedelta(hours=settings.SESSION_TTL_HOURS),
            ip_address=client_ip(request),
            user_agent=(request.headers.get("user-agent") or "")[:255],
        )
    )
    audit(db, request, user, "auth.login", "user", user.id)
    db.commit()
    _set_session_cookie(response, token)
    return serializers.me(user, csrf)


@router.post("/logout")
def logout(request: Request, response: Response, db: DbSession) -> dict:
    settings = get_settings()
    token = request.cookies.get(settings.SESSION_COOKIE_NAME)
    if token:
        session = db.get(AuthSession, hash_token(token))
        if session is not None:
            audit(db, request, session.user, "auth.logout", "user", session.user_id)
            db.delete(session)
            db.commit()
    response.delete_cookie(settings.SESSION_COOKIE_NAME, path="/", httponly=True, samesite=settings.COOKIE_SAMESITE)
    return {"ok": True}


@router.get("/me")
def me(principal: CurrentPrincipal) -> dict:
    return serializers.me(principal.user, principal.session.csrf_token)


@router.post("/change-password")
def change_password(payload: ChangePasswordIn, principal: CurrentPrincipal, request: Request, db: DbSession) -> dict:
    user = db.get(User, principal.user.id)
    if not verify_password(user.password_hash, payload.current_password):
        raise HTTPException(status_code=400, detail="La contraseña actual no es correcta")
    problems = password_problems(payload.new_password, user.email)
    if problems:
        raise HTTPException(status_code=422, detail=". ".join(problems))
    user.password_hash = hash_password(payload.new_password)
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.id != principal.session.id))
    audit(db, request, user, "auth.change_password", "user", user.id)
    db.commit()
    return {"ok": True}
