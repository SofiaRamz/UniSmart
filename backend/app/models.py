"""Modelos SQLAlchemy 2.0 (esquema relacional normalizado)."""

from __future__ import annotations

from datetime import date, datetime, time

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .core.constants import DOCUMENT_STATUSES, LOCATION_KINDS, MODULES  # noqa: F401  (reexportados)
from .db import Base, EmbeddingType, utcnow

JSONType = JSON().with_variant(JSONB(), "postgresql")


def _ts(**kw) -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, **kw)


# ---------------------------------------------------------------- Organización y acceso
class Department(Base):
    __tablename__ = "departments"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    description: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = _ts()
    modules: Mapped[list[DepartmentModule]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="DepartmentModule.module"
    )

    @property
    def module_codes(self) -> list[str]:
        return [m.module for m in self.modules]


class DepartmentModule(Base):
    """Módulos que un departamento puede operar (documentos, horarios, reportes, ubicaciones)."""

    __tablename__ = "department_modules"
    __table_args__ = (
        CheckConstraint(
            "module IN ('documents','schedules','reports','locations')", name="ck_department_modules_module"
        ),
    )
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id", ondelete="CASCADE"), primary_key=True)
    module: Mapped[str] = mapped_column(String(30), primary_key=True)


class Role(Base):
    __tablename__ = "roles"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True)  # superadmin | staff
    name: Mapped[str] = mapped_column(String(80))


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    full_name: Mapped[str] = mapped_column(String(160))
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = _ts(onupdate=utcnow)
    roles: Mapped[list[UserRole]] = relationship(back_populates="user", cascade="all, delete-orphan", lazy="selectin")

    @property
    def is_superadmin(self) -> bool:
        return any(ur.role.code == "superadmin" for ur in self.roles)

    @property
    def departments(self) -> list[Department]:
        return [ur.department for ur in self.roles if ur.department is not None]


class UserRole(Base):
    __tablename__ = "user_roles"
    __table_args__ = (UniqueConstraint("user_id", "role_id", "department_id", name="uq_user_roles"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id", ondelete="RESTRICT"))
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id", ondelete="CASCADE"))
    user: Mapped[User] = relationship(back_populates="roles")
    role: Mapped[Role] = relationship(lazy="joined")
    department: Mapped[Department | None] = relationship(lazy="joined")


class AuthSession(Base):
    """Sesión de servidor. El id es el SHA-256 del token de la cookie (nunca el token)."""

    __tablename__ = "auth_sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = _ts()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = _ts()
    ip_address: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    user: Mapped[User] = relationship(lazy="joined")


# ---------------------------------------------------------------- Documentos y RAG
class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint("department_id", "sha256", name="uq_documents_department_sha256"),
        CheckConstraint("status IN ('processing','indexed','failed')", name="ck_documents_status"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id", ondelete="RESTRICT"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    original_filename: Mapped[str] = mapped_column(String(255))
    stored_filename: Mapped[str] = mapped_column(String(80), unique=True)
    sha256: Mapped[str] = mapped_column(String(64))
    mime_type: Mapped[str] = mapped_column(String(80), default="application/pdf")
    size_bytes: Mapped[int] = mapped_column(Integer)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="processing")
    error_message: Mapped[str | None] = mapped_column(Text)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    uploaded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = _ts(onupdate=utcnow)
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    department: Mapped[Department] = relationship(lazy="joined")
    uploaded_by: Mapped[User | None] = relationship(lazy="joined")


class DocumentChunk(Base):
    __tablename__ = "document_chunks"
    __table_args__ = (UniqueConstraint("document_id", "chunk_index", name="uq_chunks_document_index"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    chunk_index: Mapped[int] = mapped_column(Integer)
    page_number: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    search_text: Mapped[str] = mapped_column(Text)  # minúsculas y sin acentos (búsqueda por palabras)
    embedding: Mapped[list[float] | None] = mapped_column(EmbeddingType(), deferred=True)
    embedding_model: Mapped[str] = mapped_column(String(160), index=True)
    created_at: Mapped[datetime] = _ts()


# ---------------------------------------------------------------- Horarios (datos estructurados, fuera del RAG)
class AcademicPeriod(Base):
    __tablename__ = "academic_periods"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True)  # 2026-AGO-DIC
    name: Mapped[str] = mapped_column(String(120))  # Agosto–Diciembre 2026
    starts_on: Mapped[date | None] = mapped_column(Date)
    ends_on: Mapped[date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)


class StudentGroup(Base):
    __tablename__ = "student_groups"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)  # 1AS, 3AS…
    name: Mapped[str] = mapped_column(String(120), default="")


class Subject(Base):
    __tablename__ = "subjects"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), unique=True)


class Teacher(Base):
    __tablename__ = "teachers"
    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(160), unique=True)


class CampusLocation(Base):
    __tablename__ = "campus_locations"
    __table_args__ = (
        CheckConstraint("latitude BETWEEN -90 AND 90", name="ck_locations_lat"),
        CheckConstraint("longitude BETWEEN -180 AND 180", name="ck_locations_lng"),
        CheckConstraint(
            "kind IN ('edificio','aula','oficina','servicio','acceso','area_verde','deportivo','estacionamiento')",
            name="ck_locations_kind",
        ),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    kind: Mapped[str] = mapped_column(String(30))
    description: Mapped[str] = mapped_column(Text, default="")
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = _ts(onupdate=utcnow)
    department: Mapped[Department | None] = relationship(lazy="joined")


class Classroom(Base):
    __tablename__ = "classrooms"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)  # "15"
    name: Mapped[str] = mapped_column(String(120))  # "Aula 15"
    building: Mapped[str] = mapped_column(String(120), default="")
    location_id: Mapped[int | None] = mapped_column(ForeignKey("campus_locations.id", ondelete="SET NULL"))
    location: Mapped[CampusLocation | None] = relationship(lazy="joined")


class ScheduleEntry(Base):
    __tablename__ = "schedule_entries"
    __table_args__ = (
        CheckConstraint("day_of_week BETWEEN 1 AND 7", name="ck_schedule_day"),
        CheckConstraint("end_time > start_time", name="ck_schedule_times"),
        UniqueConstraint("period_id", "group_id", "day_of_week", "start_time", name="uq_schedule_group_slot"),
        UniqueConstraint("period_id", "classroom_id", "day_of_week", "start_time", name="uq_schedule_classroom_slot"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    period_id: Mapped[int] = mapped_column(ForeignKey("academic_periods.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("student_groups.id", ondelete="RESTRICT"), index=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id", ondelete="RESTRICT"))
    teacher_id: Mapped[int | None] = mapped_column(ForeignKey("teachers.id", ondelete="SET NULL"))
    classroom_id: Mapped[int] = mapped_column(ForeignKey("classrooms.id", ondelete="RESTRICT"), index=True)
    day_of_week: Mapped[int] = mapped_column(SmallInteger)  # 1 = lunes … 7 = domingo
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = _ts(onupdate=utcnow)
    period: Mapped[AcademicPeriod] = relationship(lazy="joined")
    group: Mapped[StudentGroup] = relationship(lazy="joined")
    subject: Mapped[Subject] = relationship(lazy="joined")
    teacher: Mapped[Teacher | None] = relationship(lazy="joined")
    classroom: Mapped[Classroom] = relationship(lazy="joined")


# ---------------------------------------------------------------- Reportes de mantenimiento
class ReportCategory(Base):
    __tablename__ = "report_categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id", ondelete="RESTRICT"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    department: Mapped[Department] = relationship(lazy="joined")


class MaintenanceReport(Base):
    __tablename__ = "maintenance_reports"
    __table_args__ = (
        CheckConstraint(
            "status IN ('recibido','en_revision','asignado','en_proceso','resuelto','descartado')",
            name="ck_reports_status",
        ),
        CheckConstraint("priority IN ('baja','media','alta')", name="ck_reports_priority"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    tracking_code: Mapped[str] = mapped_column(String(20), unique=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("report_categories.id", ondelete="RESTRICT"))
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id", ondelete="RESTRICT"), index=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("campus_locations.id", ondelete="SET NULL"))
    location_text: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text)
    contact_email: Mapped[str | None] = mapped_column(String(254))  # privado: nunca se expone en la vista pública
    status: Mapped[str] = mapped_column(String(20), default="recibido", index=True)
    priority: Mapped[str] = mapped_column(String(10), default="media")
    reporter_ip_hash: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = _ts(onupdate=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    category: Mapped[ReportCategory] = relationship(lazy="joined")
    department: Mapped[Department] = relationship(lazy="joined")
    location: Mapped[CampusLocation | None] = relationship(lazy="joined")
    history: Mapped[list[ReportHistory]] = relationship(
        back_populates="report", cascade="all, delete-orphan", lazy="selectin", order_by="ReportHistory.id"
    )


class ReportHistory(Base):
    __tablename__ = "report_history"
    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("maintenance_reports.id", ondelete="CASCADE"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(20))
    to_status: Mapped[str] = mapped_column(String(20))
    internal_note: Mapped[str] = mapped_column(Text, default="")
    public_note: Mapped[str] = mapped_column(String(500), default="")
    changed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = _ts()
    report: Mapped[MaintenanceReport] = relationship(back_populates="history")
    changed_by: Mapped[User | None] = relationship(lazy="joined")


# ---------------------------------------------------------------- Trazabilidad y métricas
class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    action: Mapped[str] = mapped_column(String(60))
    entity_type: Mapped[str] = mapped_column(String(60))
    entity_id: Mapped[str | None] = mapped_column(String(60))
    details: Mapped[dict] = mapped_column(JSONType, default=dict)
    ip_address: Mapped[str | None] = mapped_column(String(45))
    created_at: Mapped[datetime] = _ts(index=True)
    user: Mapped[User | None] = relationship(lazy="joined")


class ChatQueryLog(Base):
    """Métricas anónimas del chat (no se guarda el texto de la pregunta)."""

    __tablename__ = "chat_queries"
    id: Mapped[int] = mapped_column(primary_key=True)
    route: Mapped[str] = mapped_column(String(20))
    answered: Mapped[bool] = mapped_column(Boolean)
    source_count: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = _ts(index=True)
