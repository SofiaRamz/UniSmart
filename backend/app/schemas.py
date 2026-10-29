"""Esquemas Pydantic de entrada: toda la validación ocurre aquí, nunca en el frontend."""

from __future__ import annotations

import re
from datetime import date, time

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .core.constants import LOCATION_KINDS, MODULES
from .core.tracking import PRIORITIES, STATUSES

_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")


def _email(value: str) -> str:
    value = value.strip().lower()
    if not _EMAIL_RE.match(value) or len(value) > 254:
        raise ValueError("Correo electrónico inválido")
    return value


def _check_modules(value: list[str]) -> list[str]:
    bad = [m for m in value if m not in MODULES]
    if bad:
        raise ValueError(f"Módulos inválidos: {', '.join(bad)}")
    return sorted(set(value))


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class SecretModel(BaseModel):
    """Modelos con contraseñas: no se recortan espacios para no alterar la contraseña."""

    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------- Público
class ChatIn(StrictModel):
    message: str = Field(min_length=2, max_length=600)


class ReportIn(StrictModel):
    category_id: int
    location_id: int | None = None
    location_text: str = Field(min_length=3, max_length=255)
    description: str = Field(min_length=10, max_length=2000)
    contact_email: str | None = Field(default=None, max_length=254)
    website: str | None = Field(default=None, max_length=200)  # trampa anti-bots: debe venir vacío

    @field_validator("contact_email")
    @classmethod
    def check_email(cls, v: str | None) -> str | None:
        return _email(v) if v else None


# ---------------------------------------------------------------- Autenticación
class LoginIn(SecretModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def lower(cls, v: str) -> str:
        return v.strip().lower()


class ChangePasswordIn(SecretModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=10, max_length=128)


# ---------------------------------------------------------------- Documentos
class DocumentUpdateIn(StrictModel):
    title: str | None = Field(default=None, min_length=3, max_length=200)
    is_public: bool | None = None


# ---------------------------------------------------------------- Horarios
class PeriodIn(StrictModel):
    code: str = Field(min_length=3, max_length=30, pattern=r"^[A-Za-z0-9\-_]+$")
    name: str = Field(min_length=3, max_length=120)
    starts_on: date | None = None
    ends_on: date | None = None
    is_active: bool = False


class ScheduleEntryIn(StrictModel):
    period_id: int
    group: str = Field(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9\-_.]+$")
    subject: str = Field(min_length=2, max_length=160)
    teacher: str | None = Field(default=None, max_length=160)
    classroom: str = Field(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9\-_.]+$")
    building: str | None = Field(default=None, max_length=120)
    day: int = Field(ge=1, le=7)
    start_time: time
    end_time: time

    @field_validator("group", "classroom")
    @classmethod
    def upper(cls, v: str) -> str:
        return v.upper()

    @field_validator("end_time")
    @classmethod
    def after_start(cls, v: time, info) -> time:
        start = info.data.get("start_time")
        if start and v <= start:
            raise ValueError("La hora de fin debe ser posterior a la de inicio")
        return v


# ---------------------------------------------------------------- Reportes (administración)
class ReportStatusIn(StrictModel):
    status: str
    internal_note: str = Field(default="", max_length=2000)
    public_note: str = Field(default="", max_length=500)
    priority: str | None = None

    @field_validator("status")
    @classmethod
    def valid_status(cls, v: str) -> str:
        if v not in STATUSES:
            raise ValueError(f"Estado inválido. Opciones: {', '.join(STATUSES)}")
        return v

    @field_validator("priority")
    @classmethod
    def valid_priority(cls, v: str | None) -> str | None:
        if v is not None and v not in PRIORITIES:
            raise ValueError("Prioridad inválida")
        return v


# ---------------------------------------------------------------- Ubicaciones
class LocationIn(StrictModel):
    name: str = Field(min_length=2, max_length=160)
    kind: str
    description: str = Field(default="", max_length=1000)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    department_id: int | None = None
    is_active: bool = True

    @field_validator("kind")
    @classmethod
    def valid_kind(cls, v: str) -> str:
        if v not in LOCATION_KINDS:
            raise ValueError(f"Tipo inválido. Opciones: {', '.join(LOCATION_KINDS)}")
        return v


# ---------------------------------------------------------------- Superadministración
class UserCreateIn(SecretModel):
    email: str
    full_name: str = Field(min_length=3, max_length=160)
    password: str = Field(min_length=10, max_length=128)
    is_superadmin: bool = False
    department_ids: list[int] = Field(default_factory=list)

    @field_validator("email")
    @classmethod
    def check_email(cls, v: str) -> str:
        return _email(v)

    @field_validator("full_name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        return " ".join(v.split())


class UserUpdateIn(StrictModel):
    full_name: str | None = Field(default=None, min_length=3, max_length=160)
    is_active: bool | None = None
    is_superadmin: bool | None = None
    department_ids: list[int] | None = None
    unlock: bool | None = None


class PasswordResetIn(SecretModel):
    new_password: str = Field(min_length=10, max_length=128)


class DepartmentIn(StrictModel):
    code: str = Field(min_length=3, max_length=40, pattern=r"^[A-Z0-9_]+$")
    name: str = Field(min_length=3, max_length=120)
    description: str = Field(default="", max_length=1000)
    modules: list[str] = Field(default_factory=list)

    @field_validator("modules")
    @classmethod
    def valid_modules(cls, v: list[str]) -> list[str]:
        return _check_modules(v)


class DepartmentUpdateIn(StrictModel):
    name: str | None = Field(default=None, min_length=3, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    is_active: bool | None = None
    modules: list[str] | None = None

    @field_validator("modules")
    @classmethod
    def valid_modules(cls, v: list[str] | None) -> list[str] | None:
        return _check_modules(v) if v is not None else None
