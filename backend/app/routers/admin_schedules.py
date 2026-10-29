"""Gestión de horarios estructurados (módulo 'schedules', p. ej. Coordinación Académica)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
from sqlalchemy import select, update

from .. import serializers
from ..core.schedule_csv import TEMPLATE_HEADER, parse_schedule_csv
from ..deps import DbSession, Principal, audit, require_module
from ..models import AcademicPeriod, ScheduleEntry
from ..schemas import PeriodIn, ScheduleEntryIn
from ..services.schedules import (
    find_db_conflicts,
    get_or_create_classroom,
    get_or_create_group,
    get_or_create_subject,
    get_or_create_teacher,
    import_rows,
    search_entries,
)

router = APIRouter(prefix="/api/admin", tags=["horarios"])
SchedPrincipal = Annotated[Principal, Depends(require_module("schedules"))]

TEMPLATE_ROWS = [
    TEMPLATE_HEADER,
    "2026-AGO-DIC,1AS,Fundamentos de Programación,Mtra. Laura Méndez,15,Edificio A,Lunes,07:00,08:40",
    "2026-AGO-DIC,3AS,Estructuras de Datos,Ing. Carlos Ruiz,16,Edificio A,Lunes,07:00,08:40",
]


def _period(db, period_id: int) -> AcademicPeriod:
    period = db.get(AcademicPeriod, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Periodo no encontrado")
    return period


# ---------------------------------------------------------------- Periodos
@router.get("/periods")
def list_periods(principal: SchedPrincipal, db: DbSession) -> dict:
    periods = db.scalars(select(AcademicPeriod).order_by(AcademicPeriod.id.desc()))
    return {"periods": [{"id": p.id, "code": p.code, "name": p.name, "is_active": p.is_active} for p in periods]}


@router.post("/periods", status_code=201)
def create_period(payload: PeriodIn, principal: SchedPrincipal, request: Request, db: DbSession) -> dict:
    code = payload.code.upper()
    if db.scalar(select(AcademicPeriod).where(AcademicPeriod.code == code)):
        raise HTTPException(status_code=409, detail="Ya existe un periodo con ese código")
    if payload.is_active:
        db.execute(update(AcademicPeriod).values(is_active=False))
    period = AcademicPeriod(
        code=code, name=payload.name, starts_on=payload.starts_on, ends_on=payload.ends_on, is_active=payload.is_active
    )
    db.add(period)
    db.flush()
    audit(db, request, principal.user, "period.create", "academic_period", period.id, code=code)
    db.commit()
    return {"id": period.id, "code": period.code, "name": period.name, "is_active": period.is_active}


@router.post("/periods/{period_id}/activate")
def activate_period(period_id: int, principal: SchedPrincipal, request: Request, db: DbSession) -> dict:
    period = _period(db, period_id)
    db.execute(update(AcademicPeriod).values(is_active=False))
    period.is_active = True
    audit(db, request, principal.user, "period.activate", "academic_period", period.id)
    db.commit()
    return {"id": period.id, "code": period.code, "name": period.name, "is_active": True}


# ---------------------------------------------------------------- Clases
@router.get("/schedules")
def list_entries(
    principal: SchedPrincipal,
    db: DbSession,
    period_id: int | None = None,
    group: str | None = Query(default=None, max_length=20),
    classroom: str | None = Query(default=None, max_length=20),
    day: int | None = Query(default=None, ge=1, le=7),
) -> dict:
    entries = search_entries(
        db,
        period_id=period_id,
        groups=[group] if group else None,
        classrooms=[classroom] if classroom else None,
        day=day,
        limit=2000,
    )
    return {"entries": [serializers.schedule_entry(e) for e in entries]}


def _apply(db, entry: ScheduleEntry, payload: ScheduleEntryIn) -> None:
    _period(db, payload.period_id)
    group = get_or_create_group(db, payload.group)
    classroom = get_or_create_classroom(db, payload.classroom, payload.building)
    subject = get_or_create_subject(db, payload.subject)
    teacher = get_or_create_teacher(db, payload.teacher)
    conflicts = find_db_conflicts(
        db,
        period_id=payload.period_id,
        group_id=group.id,
        classroom_id=classroom.id,
        teacher_id=teacher.id if teacher else None,
        day=payload.day,
        start=payload.start_time,
        end=payload.end_time,
        exclude_id=entry.id,
    )
    if conflicts:
        db.rollback()
        raise HTTPException(status_code=409, detail={"message": "El horario se empalma", "conflicts": conflicts})
    entry.period_id = payload.period_id
    entry.group_id = group.id
    entry.classroom_id = classroom.id
    entry.subject_id = subject.id
    entry.teacher_id = teacher.id if teacher else None
    entry.day_of_week = payload.day
    entry.start_time = payload.start_time
    entry.end_time = payload.end_time


@router.post("/schedules", status_code=201)
def create_entry(payload: ScheduleEntryIn, principal: SchedPrincipal, request: Request, db: DbSession) -> dict:
    entry = ScheduleEntry(updated_by_id=principal.user.id)
    _apply(db, entry, payload)
    db.add(entry)
    db.flush()
    audit(db, request, principal.user, "schedule.create", "schedule_entry", entry.id, group=payload.group)
    db.commit()
    db.refresh(entry)
    return serializers.schedule_entry(entry)


@router.put("/schedules/{entry_id}")
def update_entry(
    entry_id: int, payload: ScheduleEntryIn, principal: SchedPrincipal, request: Request, db: DbSession
) -> dict:
    entry = db.get(ScheduleEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Clase no encontrada")
    _apply(db, entry, payload)
    entry.updated_by_id = principal.user.id
    audit(db, request, principal.user, "schedule.update", "schedule_entry", entry.id)
    db.commit()
    db.refresh(entry)
    return serializers.schedule_entry(entry)


@router.delete("/schedules/{entry_id}", status_code=204, response_class=Response)
def delete_entry(entry_id: int, principal: SchedPrincipal, request: Request, db: DbSession) -> Response:
    entry = db.get(ScheduleEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Clase no encontrada")
    audit(db, request, principal.user, "schedule.delete", "schedule_entry", entry.id, group=entry.group.code)
    db.delete(entry)
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------- Importación CSV (sin IA)
@router.get("/schedules/template")
def csv_template(principal: SchedPrincipal) -> Response:
    content = "\ufeff" + "\r\n".join(TEMPLATE_ROWS) + "\r\n"
    return Response(
        content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="plantilla_horarios.csv"'},
    )


@router.post("/schedules/import")
def import_csv(
    principal: SchedPrincipal,
    request: Request,
    db: DbSession,
    file: UploadFile = File(...),
    dry_run: bool = Query(default=True),
    mode: str = Query(default="append", pattern="^(append|replace)$"),
) -> dict:
    data = file.file.read(2 * 1024 * 1024 + 1)
    if len(data) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="El CSV supera 2 MB")
    try:
        rows, errors = parse_schedule_csv(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    preview = [
        {
            "line": r.line,
            "period": r.period,
            "group": r.group,
            "subject": r.subject,
            "teacher": r.teacher,
            "classroom": r.classroom,
            "day": r.day,
            "start_time": f"{r.start:%H:%M}",
            "end_time": f"{r.end:%H:%M}",
        }
        for r in rows[:200]
    ]
    result = {
        "valid_rows": len(rows),
        "errors": [e.as_dict() for e in errors],
        "preview": preview,
        "created": 0,
        "deleted": 0,
        "dry_run": dry_run,
    }
    if dry_run or errors:
        return result
    try:
        summary = import_rows(db, rows, replace=(mode == "replace"), user_id=principal.user.id)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if summary["conflicts"]:
        db.rollback()  # todo o nada: no se publica un horario con empalmes
        return {**result, "errors": summary["conflicts"]}
    audit(
        db,
        request,
        principal.user,
        "schedule.import",
        "schedule_entry",
        None,
        created=summary["created"],
        deleted=summary["deleted"],
        mode=mode,
    )
    db.commit()
    return {**result, "created": summary["created"], "deleted": summary["deleted"]}
