"""Autenticación por sesión y autorización RBAC por departamento y módulo.

El backend nunca confía en el frontend: cada endpoint protegido reconstruye los
permisos a partir de la sesión guardada en la base de datos.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from .config import get_settings
from .db import as_aware, get_db, utcnow
from .models import AuditLog, AuthSession, User
from .ratelimit import client_ip
from .security import hash_token, tokens_match

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
DbSession = Annotated[Session, Depends(get_db)]


@dataclass
class Principal:
    user: User
    session: AuthSession
    is_superadmin: bool = False
    modules_by_department: dict[int, set[str]] = field(default_factory=dict)

    def department_ids(self, module: str) -> set[int]:
        return {dep_id for dep_id, mods in self.modules_by_department.items() if module in mods}

    def can(self, module: str, department_id: int | None) -> bool:
        if self.is_superadmin:
            return True
        return department_id is not None and department_id in self.department_ids(module)


def _unauthorized(message: str = "Inicia sesión para continuar") -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=message)


def build_principal(user: User, session: AuthSession) -> Principal:
    principal = Principal(user=user, session=session)
    for user_role in user.roles:
        if user_role.role.code == "superadmin":
            principal.is_superadmin = True
        elif user_role.department is not None and user_role.department.is_active:
            principal.modules_by_department[user_role.department.id] = set(user_role.department.module_codes)
    return principal


def get_principal(request: Request, db: DbSession) -> Principal:
    settings = get_settings()
    token = request.cookies.get(settings.SESSION_COOKIE_NAME)
    if not token:
        raise _unauthorized()
    session = db.get(AuthSession, hash_token(token))
    now = utcnow()
    if session is None or as_aware(session.expires_at) <= now:
        if session is not None:
            db.delete(session)
            db.commit()
        raise _unauthorized("Tu sesión expiró. Inicia sesión de nuevo")
    user = session.user
    if not user.is_active:
        raise _unauthorized("Tu cuenta está desactivada")
    if request.method not in SAFE_METHODS and not tokens_match(
        session.csrf_token, request.headers.get("X-CSRF-Token", "")
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token CSRF inválido o ausente")
    if now - as_aware(session.last_seen_at) > timedelta(minutes=5):
        session.last_seen_at = now
        db.commit()
    return build_principal(user, session)


CurrentPrincipal = Annotated[Principal, Depends(get_principal)]


def require_superadmin(principal: CurrentPrincipal) -> Principal:
    if not principal.is_superadmin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo el superadministrador puede hacer esto")
    return principal


def require_module(module: str):
    def dependency(principal: CurrentPrincipal) -> Principal:
        if not principal.is_superadmin and not principal.department_ids(module):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Tu departamento no tiene acceso a este módulo"
            )
        return principal

    return dependency


SuperAdmin = Annotated[Principal, Depends(require_superadmin)]


def audit(
    db: Session,
    request: Request | None,
    user: User | None,
    action: str,
    entity_type: str,
    entity_id: object = None,
    **details,
) -> None:
    """Agrega un registro de auditoría a la transacción actual (se confirma con el commit del endpoint)."""
    db.add(
        AuditLog(
            user_id=user.id if user else None,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            details={k: v for k, v in details.items() if v is not None},
            ip_address=client_ip(request) if request else None,
        )
    )
