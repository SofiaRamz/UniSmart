"""Atención de reportes de mantenimiento (módulo 'reports'). Cada área ve solo sus reportes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select

from .. import serializers
from ..core.tracking import STATUS_LABELS, STATUSES, can_transition
from ..db import utcnow
from ..deps import DbSession, Principal, audit, require_module
from ..models import MaintenanceReport, ReportCategory, ReportHistory
from ..schemas import ReportStatusIn

router = APIRouter(prefix="/api/admin/reports", tags=["reportes"])
ReportsPrincipal = Annotated[Principal, Depends(require_module("reports"))]


def _scope(stmt, principal: Principal):
    if principal.is_superadmin:
        return stmt
    return stmt.where(MaintenanceReport.department_id.in_(principal.department_ids("reports")))


def _get_owned(db, principal: Principal, report_id: int) -> MaintenanceReport:
    report = db.get(MaintenanceReport, report_id)
    if report is None or not principal.can("reports", report.department_id):
        raise HTTPException(status_code=404, detail="Reporte no encontrado")
    return report


@router.get("")
def list_reports(
    principal: ReportsPrincipal,
    db: DbSession,
    status: str | None = Query(default=None),
    category_id: int | None = None,
    q: str | None = Query(default=None, max_length=60),
) -> dict:
    if status is not None and status not in STATUSES:
        raise HTTPException(status_code=422, detail="Estado inválido")
    stmt = _scope(select(MaintenanceReport), principal).order_by(MaintenanceReport.created_at.desc()).limit(300)
    if status:
        stmt = stmt.where(MaintenanceReport.status == status)
    if category_id:
        stmt = stmt.where(MaintenanceReport.category_id == category_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            MaintenanceReport.tracking_code.ilike(like)
            | MaintenanceReport.location_text.ilike(like)
            | MaintenanceReport.description.ilike(like)
        )
    counts_stmt = _scope(select(MaintenanceReport.status, func.count()), principal).group_by(MaintenanceReport.status)
    counts = {s: 0 for s in STATUSES} | {row[0]: row[1] for row in db.execute(counts_stmt)}
    categories = db.scalars(select(ReportCategory).order_by(ReportCategory.name))
    visible = [c for c in categories if principal.can("reports", c.department_id)]
    return {
        "reports": [serializers.report_admin(r) for r in db.scalars(stmt).unique()],
        "counts": counts,
        "categories": [serializers.report_category(c) for c in visible],
        "status_labels": STATUS_LABELS,
    }


@router.get("/{report_id}")
def get_report(report_id: int, principal: ReportsPrincipal, db: DbSession) -> dict:
    return serializers.report_admin(_get_owned(db, principal, report_id))


@router.patch("/{report_id}/status")
def change_status(
    report_id: int, payload: ReportStatusIn, principal: ReportsPrincipal, request: Request, db: DbSession
) -> dict:
    report = _get_owned(db, principal, report_id)
    if payload.status != report.status and not can_transition(report.status, payload.status):
        raise HTTPException(
            status_code=409,
            detail=f"No se puede pasar de «{STATUS_LABELS[report.status]}» a «{STATUS_LABELS[payload.status]}»",
        )
    if (
        payload.status == report.status
        and not payload.internal_note
        and not payload.public_note
        and not payload.priority
    ):
        raise HTTPException(status_code=422, detail="No hay cambios que guardar")
    previous = report.status
    report.status = payload.status
    if payload.priority:
        report.priority = payload.priority
    report.resolved_at = utcnow() if payload.status == "resuelto" else None
    report.history.append(
        ReportHistory(
            from_status=previous,
            to_status=payload.status,
            internal_note=payload.internal_note,
            public_note=payload.public_note,
            changed_by_id=principal.user.id,
        )
    )
    audit(
        db,
        request,
        principal.user,
        "report.status",
        "maintenance_report",
        report.id,
        from_status=previous,
        to_status=payload.status,
    )
    db.commit()
    db.refresh(report)
    return serializers.report_admin(report)
