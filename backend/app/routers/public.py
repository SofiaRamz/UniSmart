"""Endpoints públicos (estudiantes y visitantes, sin registro)."""

from __future__ import annotations

import time
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import select, text

from .. import serializers
from ..config import get_settings
from ..core.intent import DAY_NAMES
from ..core.tracking import STATUS_LABELS, is_valid_tracking_code, new_tracking_code, normalize_tracking_code
from ..deps import DbSession
from ..models import (
    AcademicPeriod,
    CampusLocation,
    ChatQueryLog,
    Classroom,
    Document,
    MaintenanceReport,
    ReportCategory,
    ReportHistory,
    ScheduleEntry,
    StudentGroup,
    Subject,
    Teacher,
)
from ..ratelimit import client_ip, enforce
from ..schemas import ChatIn, ReportIn
from ..security import hash_ip
from ..services.chat import answer_question
from ..services.ingestion import stored_path
from ..services.llm import lmstudio_online
from ..services.schedules import active_period, search_entries

router = APIRouter(prefix="/api", tags=["público"])


@router.get("/health")
def health(request: Request, db: DbSession) -> dict:
    try:
        db.execute(text("SELECT 1"))
        database = True
    except Exception:
        database = False
    return {
        "service": "unismart",
        "status": "ok" if database else "degraded",
        "database": database,
        "llm": lmstudio_online(),
        "version": request.app.version,
    }


# ---------------------------------------------------------------- Chat
@router.post("/public/chat")
def chat(payload: ChatIn, request: Request, db: DbSession) -> dict:
    settings = get_settings()
    enforce(
        request, "chat", settings.RATE_LIMIT_CHAT_PER_MINUTE, 60, "Hiciste muchas preguntas seguidas. Espera un minuto."
    )
    started = time.perf_counter()
    weekday = datetime.now(ZoneInfo(settings.TIMEZONE)).isoweekday()
    result = answer_question(
        db, payload.message, settings, request.app.state.get_embedder(), request.app.state.llm, weekday
    )
    db.add(
        ChatQueryLog(
            route=result.route,
            answered=result.answered,
            source_count=len(result.sources),
            latency_ms=int((time.perf_counter() - started) * 1000),
        )
    )
    db.commit()
    return result.as_dict()


# ---------------------------------------------------------------- Horarios
@router.get("/public/schedules/options")
def schedule_options(db: DbSession) -> dict:
    period = active_period(db)
    periods = db.scalars(select(AcademicPeriod).order_by(AcademicPeriod.id.desc())).all()
    period_filter = (ScheduleEntry.period_id == period.id) if period is not None else (ScheduleEntry.id == -1)
    group_ids = select(ScheduleEntry.group_id).where(period_filter)
    room_ids = select(ScheduleEntry.classroom_id).where(period_filter)
    subject_ids = select(ScheduleEntry.subject_id).where(period_filter)
    teacher_ids = select(ScheduleEntry.teacher_id).where(period_filter)
    return {
        "active_period": {"id": period.id, "code": period.code, "name": period.name} if period else None,
        "periods": [{"id": p.id, "code": p.code, "name": p.name, "is_active": p.is_active} for p in periods],
        "groups": [
            g.code
            for g in db.scalars(select(StudentGroup).where(StudentGroup.id.in_(group_ids)).order_by(StudentGroup.code))
        ],
        "classrooms": [
            serializers.classroom(c)
            for c in db.scalars(select(Classroom).where(Classroom.id.in_(room_ids)).order_by(Classroom.code))
        ],
        "subjects": [
            {"id": s.id, "name": s.name}
            for s in db.scalars(select(Subject).where(Subject.id.in_(subject_ids)).order_by(Subject.name))
        ],
        "teachers": [
            {"id": t.id, "full_name": t.full_name}
            for t in db.scalars(select(Teacher).where(Teacher.id.in_(teacher_ids)).order_by(Teacher.full_name))
        ],
        "days": [{"value": k, "label": v} for k, v in DAY_NAMES.items()],
    }


@router.get("/public/schedules")
def schedules(
    db: DbSession,
    group: str | None = Query(default=None, max_length=20),
    classroom: str | None = Query(default=None, max_length=20),
    day: int | None = Query(default=None, ge=1, le=7),
    teacher_id: int | None = None,
    subject_id: int | None = None,
    period_id: int | None = None,
) -> dict:
    entries = search_entries(
        db,
        period_id=period_id,
        groups=[group] if group else None,
        classrooms=[classroom] if classroom else None,
        day=day,
        teacher_ids=[teacher_id] if teacher_id else None,
        subject_ids=[subject_id] if subject_id else None,
    )
    return {"entries": [serializers.schedule_entry(e) for e in entries]}


# ---------------------------------------------------------------- Mapa y documentos
@router.get("/public/locations")
def locations(db: DbSession, kind: str | None = Query(default=None, max_length=30)) -> dict:
    stmt = select(CampusLocation).where(CampusLocation.is_active.is_(True)).order_by(CampusLocation.name)
    if kind:
        stmt = stmt.where(CampusLocation.kind == kind)
    return {"locations": [serializers.location(loc) for loc in db.scalars(stmt)]}


@router.get("/public/documents")
def public_documents(db: DbSession) -> dict:
    docs = db.scalars(
        select(Document).where(Document.status == "indexed", Document.is_public.is_(True)).order_by(Document.title)
    )
    return {"documents": [serializers.document_public(d) for d in docs]}


@router.get("/public/documents/{document_id}/file")
def public_document_file(document_id: int, db: DbSession):
    doc = db.get(Document, document_id)
    if doc is None or doc.status != "indexed" or not doc.is_public:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    path = stored_path(doc, get_settings())
    if not path.exists():
        raise HTTPException(status_code=404, detail="El archivo ya no está disponible")
    return FileResponse(
        path, media_type="application/pdf", filename=doc.original_filename, content_disposition_type="inline"
    )


# ---------------------------------------------------------------- Reportes de mantenimiento
@router.get("/public/report-categories")
def report_categories(db: DbSession) -> dict:
    cats = db.scalars(select(ReportCategory).where(ReportCategory.is_active.is_(True)).order_by(ReportCategory.name))
    return {"categories": [serializers.report_category(c) for c in cats]}


@router.post("/public/reports", status_code=201)
def create_report(payload: ReportIn, request: Request, db: DbSession) -> dict:
    settings = get_settings()
    enforce(
        request,
        "reports",
        settings.RATE_LIMIT_REPORTS_PER_HOUR,
        3600,
        "Enviaste varios reportes en poco tiempo. Intenta de nuevo más tarde.",
    )
    if payload.website:  # campo trampa: los humanos no lo ven
        raise HTTPException(status_code=400, detail="Solicitud inválida")
    category = db.get(ReportCategory, payload.category_id)
    if category is None or not category.is_active:
        raise HTTPException(status_code=422, detail="Selecciona una categoría válida")
    if payload.location_id is not None:
        loc = db.get(CampusLocation, payload.location_id)
        if loc is None or not loc.is_active:
            raise HTTPException(status_code=422, detail="La ubicación seleccionada no existe")
    for _ in range(10):
        code = new_tracking_code()
        if not db.scalar(select(MaintenanceReport.id).where(MaintenanceReport.tracking_code == code)):
            break
    else:  # pragma: no cover - probabilidad despreciable
        raise HTTPException(status_code=503, detail="No se pudo generar el folio, intenta de nuevo")
    report = MaintenanceReport(
        tracking_code=code,
        category_id=category.id,
        department_id=category.department_id,
        location_id=payload.location_id,
        location_text=payload.location_text,
        description=payload.description,
        contact_email=payload.contact_email,
        status="recibido",
        priority="media",
        reporter_ip_hash=hash_ip(client_ip(request), settings.SECRET_KEY),
    )
    report.history.append(ReportHistory(from_status=None, to_status="recibido", public_note="Reporte recibido"))
    db.add(report)
    db.commit()
    return {
        "tracking_code": report.tracking_code,
        "status": report.status,
        "status_label": STATUS_LABELS[report.status],
        "department": category.department.name,
        "created_at": serializers.iso(report.created_at),
    }


@router.get("/public/reports/{tracking_code}")
def report_status(tracking_code: str, request: Request, db: DbSession) -> dict:
    enforce(request, "report-lookup", 30, 60, "Demasiadas consultas. Espera un minuto.")
    code = normalize_tracking_code(tracking_code)
    if not is_valid_tracking_code(code):
        raise HTTPException(status_code=422, detail="El folio tiene el formato UNI-XXXX-XXXX")
    report = db.scalar(select(MaintenanceReport).where(MaintenanceReport.tracking_code == code))
    if report is None:
        raise HTTPException(status_code=404, detail="No encontramos un reporte con ese folio")
    return serializers.report_public(report)
