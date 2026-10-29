"""Carga inicial idempotente: roles, 5 departamentos, módulos, categorías, periodo, mapa y superadministrador.

Uso (desde backend/):
    python -m app.seed                      # datos de referencia + superadministrador
    python -m app.seed --demo               # además: usuarios de prueba por departamento y horario de ejemplo
"""

from __future__ import annotations

import argparse
import getpass
import json
import secrets
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import BASE_DIR, get_settings
from .core.fusion import password_problems
from .core.schedule_csv import parse_schedule_csv
from .db import SessionLocal
from .models import (
    AcademicPeriod,
    CampusLocation,
    Department,
    DepartmentModule,
    ReportCategory,
    Role,
    User,
    UserRole,
)
from .security import hash_password
from .services.schedules import get_or_create_classroom, import_rows

DATA_DIR = BASE_DIR / "data"

DEPARTMENTS = [
    ("CONTROL_ESCOLAR", "Control Escolar", "Inscripciones, reinscripciones, bajas y kárdex.", ["documents"]),
    ("SERVICIOS_ESCOLARES", "Servicios Escolares", "Constancias, credenciales, becas y trámites.", ["documents"]),
    (
        "COORDINACION_ACADEMICA",
        "Coordinación Académica",
        "Horarios, aulas, calendario y planes de estudio.",
        ["documents", "schedules"],
    ),
    (
        "MANTENIMIENTO",
        "Mantenimiento",
        "Atención de fallas eléctricas, plomería, mobiliario e infraestructura.",
        ["reports"],
    ),
    (
        "SERVICIOS_CAMPUS",
        "Servicios del Campus",
        "Limpieza, seguridad, áreas verdes y mapa del campus.",
        ["documents", "reports", "locations"],
    ),
]

REPORT_CATEGORIES = [
    ("electrico", "Eléctrico e iluminación", "MANTENIMIENTO"),
    ("plomeria", "Plomería y fugas", "MANTENIMIENTO"),
    ("mobiliario", "Mobiliario dañado", "MANTENIMIENTO"),
    ("infraestructura", "Infraestructura (puertas, ventanas, techos)", "MANTENIMIENTO"),
    ("climatizacion", "Aire acondicionado y ventilación", "MANTENIMIENTO"),
    ("limpieza", "Limpieza y sanitarios", "SERVICIOS_CAMPUS"),
    ("seguridad", "Seguridad y accesos", "SERVICIOS_CAMPUS"),
    ("areas_verdes", "Áreas verdes y exteriores", "SERVICIOS_CAMPUS"),
]

DEFAULT_PERIOD = ("2026-AGO-DIC", "Agosto–Diciembre 2026")


def seed_reference_data(db: Session) -> None:
    for code, name in (("superadmin", "Superadministrador"), ("staff", "Personal administrativo")):
        if not db.scalar(select(Role).where(Role.code == code)):
            db.add(Role(code=code, name=name))
    for code, name, description, modules in DEPARTMENTS:
        dep = db.scalar(select(Department).where(Department.code == code))
        if dep is None:
            dep = Department(code=code, name=name, description=description)
            dep.modules = [DepartmentModule(module=m) for m in modules]
            db.add(dep)
    db.flush()
    for code, name, dep_code in REPORT_CATEGORIES:
        if not db.scalar(select(ReportCategory).where(ReportCategory.code == code)):
            dep = db.scalar(select(Department).where(Department.code == dep_code))
            db.add(ReportCategory(code=code, name=name, department_id=dep.id))
    if not db.scalar(select(AcademicPeriod.id)):
        db.add(AcademicPeriod(code=DEFAULT_PERIOD[0], name=DEFAULT_PERIOD[1], is_active=True))
    if not db.scalar(select(CampusLocation.id)):
        campus = db.scalar(select(Department).where(Department.code == "SERVICIOS_CAMPUS"))
        for item in json.loads((DATA_DIR / "campus_locations.json").read_text(encoding="utf-8")):
            db.add(CampusLocation(department_id=campus.id if campus else None, **item))
    db.flush()
    for code in ("15", "16", "17", "18"):  # aulas del horario de referencia, ligadas a su pin del mapa
        get_or_create_classroom(db, code, "Edificio A")
    db.commit()


def ensure_superadmin(db: Session, email: str, password: str, full_name: str = "Superadministrador") -> User:
    problems = password_problems(password, email)
    if problems:
        raise SystemExit("Contraseña inválida: " + ". ".join(problems))
    user = db.scalar(select(User).where(User.email == email.lower()))
    role = db.scalar(select(Role).where(Role.code == "superadmin"))
    if user is None:
        user = User(email=email.lower(), full_name=full_name, password_hash=hash_password(password))
        db.add(user)
    if not any(ur.role_id == role.id for ur in user.roles):
        user.roles.append(UserRole(role=role))
    db.commit()
    return user


def seed_demo(db: Session, password: str | None) -> dict[str, str]:
    """Un usuario por departamento (correo depto@unismart.local) y horario de ejemplo."""
    staff = db.scalar(select(Role).where(Role.code == "staff"))
    created: dict[str, str] = {}
    for code, *_ in DEPARTMENTS:
        email = f"{code.lower().replace('_', '.')}@unismart.local"
        if db.scalar(select(User).where(User.email == email)):
            continue
        dep = db.scalar(select(Department).where(Department.code == code))
        pwd = password or f"Demo-{secrets.token_hex(4)}9"
        user = User(email=email, full_name=f"Personal de {dep.name}", password_hash=hash_password(pwd))
        user.roles.append(UserRole(role=staff, department=dep))
        db.add(user)
        created[email] = pwd
    db.commit()
    sample = DATA_DIR / "horarios_ejemplo.csv"
    rows, errors = parse_schedule_csv(sample.read_bytes())
    if errors:
        raise SystemExit(f"El horario de ejemplo tiene errores: {errors[:3]}")
    summary = import_rows(db, rows, replace=True, user_id=None)
    if summary["conflicts"]:
        db.rollback()
        raise SystemExit(f"Empalmes en el horario de ejemplo: {summary['conflicts'][:3]}")
    db.commit()
    print(f"Horario de ejemplo cargado: {summary['created']} clases (reemplázalo por el oficial).")
    return created


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Carga inicial de UniSmart AI")
    parser.add_argument("--demo", action="store_true", help="Crear usuarios de prueba y horario de ejemplo")
    args = parser.parse_args(argv)
    with SessionLocal() as db:
        seed_reference_data(db)
        print("Datos de referencia listos: roles, 5 departamentos, categorías, periodo y mapa.")
        settings = get_settings()
        email = settings.SUPERADMIN_EMAIL or input("Correo del superadministrador: ").strip()
        password = settings.SUPERADMIN_PASSWORD or getpass.getpass("Contraseña (mín. 10, letras y números): ")
        ensure_superadmin(db, email, password)
        print(f"Superadministrador listo: {email.lower()}")
        if args.demo:
            for user_email, pwd in seed_demo(db, settings.DEMO_PASSWORD).items():
                print(f"  usuario de prueba: {user_email}  contraseña: {pwd}")


if __name__ == "__main__":
    sys.exit(main())
