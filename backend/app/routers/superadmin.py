"""Panel global del superadministrador: usuarios, departamentos, métricas y auditoría."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import delete, func, select

from .. import serializers
from ..core.fusion import password_problems
from ..db import utcnow
from ..deps import DbSession, SuperAdmin, audit
from ..models import (
    AuditLog,
    AuthSession,
    ChatQueryLog,
    Classroom,
    Department,
    DepartmentModule,
    Document,
    DocumentChunk,
    MaintenanceReport,
    Role,
    ScheduleEntry,
    StudentGroup,
    User,
    UserRole,
)
from ..schemas import DepartmentIn, DepartmentUpdateIn, PasswordResetIn, UserCreateIn, UserUpdateIn
from ..security import hash_password
from ..services.llm import lmstudio_online

router = APIRouter(prefix="/api/superadmin", tags=["superadministración"])


def _role(db, code: str) -> Role:
    role = db.scalar(select(Role).where(Role.code == code))
    if role is None:
        raise HTTPException(status_code=500, detail=f"Falta el rol {code}. Ejecuta: python -m app.seed")
    return role


def _set_roles(db, user: User, is_superadmin: bool, department_ids: list[int]) -> None:
    departments = (
        db.scalars(select(Department).where(Department.id.in_(department_ids))).all() if department_ids else []
    )
    if len(departments) != len(set(department_ids)):
        raise HTTPException(status_code=422, detail="Uno de los departamentos no existe")
    if not is_superadmin and not departments:
        raise HTTPException(status_code=422, detail="Asigna al menos un departamento o el rol de superadministrador")
    user.roles.clear()
    db.flush()
    if is_superadmin:
        user.roles.append(UserRole(role=_role(db, "superadmin")))
    staff = _role(db, "staff")
    for dep in departments:
        user.roles.append(UserRole(role=staff, department=dep))


def _active_superadmins(db) -> int:
    return (
        db.scalar(
            select(func.count(func.distinct(User.id)))
            .join(UserRole, UserRole.user_id == User.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(Role.code == "superadmin", User.is_active.is_(True))
        )
        or 0
    )


# ---------------------------------------------------------------- Métricas
@router.get("/metrics")
def metrics(principal: SuperAdmin, db: DbSession) -> dict:
    since = utcnow() - timedelta(days=7)
    count = lambda stmt: db.scalar(stmt) or 0  # noqa: E731
    by_status = {
        row[0]: row[1]
        for row in db.execute(select(MaintenanceReport.status, func.count()).group_by(MaintenanceReport.status))
    }
    by_route = {
        row[0]: row[1] for row in db.execute(select(ChatQueryLog.route, func.count()).group_by(ChatQueryLog.route))
    }
    by_department = [
        {"department": row[0], "count": row[1]}
        for row in db.execute(
            select(Department.name, func.count(MaintenanceReport.id))
            .join(MaintenanceReport, MaintenanceReport.department_id == Department.id)
            .group_by(Department.name)
        )
    ]
    chat_total = count(select(func.count(ChatQueryLog.id)))
    answered = count(select(func.count(ChatQueryLog.id)).where(ChatQueryLog.answered.is_(True)))
    daily = [
        {"day": str(row[0]), "count": row[1]}
        for row in db.execute(
            select(func.date(ChatQueryLog.created_at), func.count())
            .where(ChatQueryLog.created_at >= since)
            .group_by(func.date(ChatQueryLog.created_at))
            .order_by(func.date(ChatQueryLog.created_at))
        )
    ]
    return {
        "users": {
            "total": count(select(func.count(User.id))),
            "active": count(select(func.count(User.id)).where(User.is_active.is_(True))),
        },
        "departments": count(select(func.count(Department.id))),
        "documents": {
            "total": count(select(func.count(Document.id))),
            "indexed": count(select(func.count(Document.id)).where(Document.status == "indexed")),
            "processing": count(select(func.count(Document.id)).where(Document.status == "processing")),
            "failed": count(select(func.count(Document.id)).where(Document.status == "failed")),
            "chunks": count(select(func.count(DocumentChunk.id))),
        },
        "schedules": {
            "entries": count(select(func.count(ScheduleEntry.id))),
            "groups": count(select(func.count(StudentGroup.id))),
            "classrooms": count(select(func.count(Classroom.id))),
        },
        "reports": {
            "total": sum(by_status.values()),
            "by_status": by_status,
            "by_department": by_department,
            "last_7_days": count(select(func.count(MaintenanceReport.id)).where(MaintenanceReport.created_at >= since)),
        },
        "chat": {
            "total": chat_total,
            "last_7_days": count(select(func.count(ChatQueryLog.id)).where(ChatQueryLog.created_at >= since)),
            "by_route": by_route,
            "answered_rate": round(answered / chat_total, 3) if chat_total else None,
            "avg_latency_ms": int(db.scalar(select(func.avg(ChatQueryLog.latency_ms))) or 0),
            "daily": daily,
        },
        "llm_online": lmstudio_online(),
    }


# ---------------------------------------------------------------- Usuarios
@router.get("/users")
def list_users(principal: SuperAdmin, db: DbSession) -> dict:
    return {"users": [serializers.user(u) for u in db.scalars(select(User).order_by(User.full_name))]}


@router.post("/users", status_code=201)
def create_user(payload: UserCreateIn, principal: SuperAdmin, request: Request, db: DbSession) -> dict:
    if db.scalar(select(User.id).where(User.email == payload.email)):
        raise HTTPException(status_code=409, detail="Ya existe un usuario con ese correo")
    problems = password_problems(payload.password, payload.email)
    if problems:
        raise HTTPException(status_code=422, detail=". ".join(problems))
    user = User(email=payload.email, full_name=payload.full_name, password_hash=hash_password(payload.password))
    db.add(user)
    _set_roles(db, user, payload.is_superadmin, payload.department_ids)
    db.flush()
    audit(
        db,
        request,
        principal.user,
        "user.create",
        "user",
        user.id,
        email=user.email,
        departments=payload.department_ids,
        superadmin=payload.is_superadmin,
    )
    db.commit()
    db.refresh(user)
    return serializers.user(user)


@router.patch("/users/{user_id}")
def update_user(user_id: int, payload: UserUpdateIn, principal: SuperAdmin, request: Request, db: DbSession) -> dict:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    is_self = user.id == principal.user.id
    if is_self and (payload.is_active is False or payload.is_superadmin is False):
        raise HTTPException(status_code=422, detail="No puedes desactivarte ni quitarte el rol de superadministrador")
    if (
        user.is_superadmin
        and (payload.is_active is False or payload.is_superadmin is False)
        and _active_superadmins(db) <= 1
    ):
        raise HTTPException(status_code=422, detail="Debe existir al menos un superadministrador activo")
    if payload.full_name is not None:
        user.full_name = " ".join(payload.full_name.split())
    if payload.is_active is not None:
        user.is_active = payload.is_active
        if not payload.is_active:
            db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    if payload.unlock:
        user.locked_until = None
        user.failed_login_attempts = 0
    if payload.is_superadmin is not None or payload.department_ids is not None:
        is_super = user.is_superadmin if payload.is_superadmin is None else payload.is_superadmin
        dep_ids = [d.id for d in user.departments] if payload.department_ids is None else payload.department_ids
        _set_roles(db, user, is_super, dep_ids)
        db.execute(delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.user_id != principal.user.id))
    audit(db, request, principal.user, "user.update", "user", user.id, **payload.model_dump(exclude_none=True))
    db.commit()
    db.refresh(user)
    return serializers.user(user)


@router.post("/users/{user_id}/reset-password")
def reset_password(
    user_id: int, payload: PasswordResetIn, principal: SuperAdmin, request: Request, db: DbSession
) -> dict:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    problems = password_problems(payload.new_password, user.email)
    if problems:
        raise HTTPException(status_code=422, detail=". ".join(problems))
    user.password_hash = hash_password(payload.new_password)
    user.locked_until = None
    user.failed_login_attempts = 0
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    audit(db, request, principal.user, "user.reset_password", "user", user.id)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- Departamentos
def _department_out(db, dep: Department) -> dict:
    users = db.scalar(select(func.count(func.distinct(UserRole.user_id))).where(UserRole.department_id == dep.id)) or 0
    return {
        **serializers.department_dict(dep),
        "description": dep.description,
        "is_active": dep.is_active,
        "modules": dep.module_codes,
        "user_count": users,
    }


@router.get("/departments")
def list_departments(principal: SuperAdmin, db: DbSession) -> dict:
    deps = db.scalars(select(Department).order_by(Department.name))
    return {"departments": [_department_out(db, d) for d in deps]}


@router.post("/departments", status_code=201)
def create_department(payload: DepartmentIn, principal: SuperAdmin, request: Request, db: DbSession) -> dict:
    if db.scalar(select(Department.id).where((Department.code == payload.code) | (Department.name == payload.name))):
        raise HTTPException(status_code=409, detail="Ya existe un departamento con ese código o nombre")
    dep = Department(code=payload.code, name=payload.name, description=payload.description)
    dep.modules = [DepartmentModule(module=m) for m in payload.modules]
    db.add(dep)
    db.flush()
    audit(
        db, request, principal.user, "department.create", "department", dep.id, code=dep.code, modules=payload.modules
    )
    db.commit()
    return _department_out(db, dep)


@router.patch("/departments/{department_id}")
def update_department(
    department_id: int, payload: DepartmentUpdateIn, principal: SuperAdmin, request: Request, db: DbSession
) -> dict:
    dep = db.get(Department, department_id)
    if dep is None:
        raise HTTPException(status_code=404, detail="Departamento no encontrado")
    if payload.name is not None:
        dep.name = payload.name
    if payload.description is not None:
        dep.description = payload.description
    if payload.is_active is not None:
        dep.is_active = payload.is_active
    if payload.modules is not None:
        dep.modules.clear()
        db.flush()
        dep.modules.extend(DepartmentModule(module=m) for m in payload.modules)
    audit(
        db, request, principal.user, "department.update", "department", dep.id, **payload.model_dump(exclude_none=True)
    )
    db.commit()
    db.refresh(dep)
    return _department_out(db, dep)


# ---------------------------------------------------------------- Auditoría
@router.get("/audit")
def audit_logs(
    principal: SuperAdmin,
    db: DbSession,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict:
    logs = db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).offset(offset).limit(limit))
    return {"logs": [serializers.audit_log(log) for log in logs]}
