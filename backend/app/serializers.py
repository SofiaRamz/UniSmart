"""Conversión de modelos a JSON. La vista pública nunca incluye datos personales ni notas internas."""

from __future__ import annotations

from datetime import datetime

from .core.intent import DAY_NAMES
from .core.tracking import STATUS_LABELS, allowed_transitions
from .db import as_aware, utcnow
from .models import (
    AuditLog,
    CampusLocation,
    Classroom,
    Department,
    Document,
    MaintenanceReport,
    ReportCategory,
    ScheduleEntry,
    User,
)


def iso(value: datetime | None) -> str | None:
    value = as_aware(value)
    return value.isoformat() if value else None


def department_dict(dep: Department) -> dict:
    return {"id": dep.id, "code": dep.code, "name": dep.name}


def department_ref(dep: Department | None) -> dict | None:
    return department_dict(dep) if dep else None


def location(loc: CampusLocation) -> dict:
    return {
        "id": loc.id,
        "name": loc.name,
        "kind": loc.kind,
        "description": loc.description,
        "latitude": loc.latitude,
        "longitude": loc.longitude,
        "department": department_ref(loc.department),
        "is_active": loc.is_active,
    }


def classroom(room: Classroom) -> dict:
    return {"code": room.code, "name": room.name, "building": room.building, "location_id": room.location_id}


def schedule_entry(entry: ScheduleEntry) -> dict:
    return {
        "id": entry.id,
        "period": {"id": entry.period.id, "code": entry.period.code, "name": entry.period.name},
        "group": entry.group.code,
        "subject": entry.subject.name,
        "teacher": entry.teacher.full_name if entry.teacher else None,
        "classroom": entry.classroom.code,
        "classroom_name": entry.classroom.name,
        "building": entry.classroom.building,
        "location_id": entry.classroom.location_id,
        "day": entry.day_of_week,
        "day_name": DAY_NAMES[entry.day_of_week],
        "start_time": entry.start_time.strftime("%H:%M"),
        "end_time": entry.end_time.strftime("%H:%M"),
    }


def report_category(cat: ReportCategory) -> dict:
    return {"id": cat.id, "code": cat.code, "name": cat.name, "department": cat.department.name}


def report_public(report: MaintenanceReport) -> dict:
    return {
        "tracking_code": report.tracking_code,
        "category": report.category.name,
        "location": report.location.name if report.location else report.location_text,
        "status": report.status,
        "status_label": STATUS_LABELS[report.status],
        "created_at": iso(report.created_at),
        "updated_at": iso(report.updated_at),
        "history": [
            {
                "status": h.to_status,
                "status_label": STATUS_LABELS.get(h.to_status, h.to_status),
                "public_note": h.public_note,
                "created_at": iso(h.created_at),
            }
            for h in report.history
        ],
    }


def report_admin(report: MaintenanceReport) -> dict:
    return {
        "id": report.id,
        "tracking_code": report.tracking_code,
        "category": {"id": report.category.id, "name": report.category.name},
        "department": department_ref(report.department),
        "location_id": report.location_id,
        "location_name": report.location.name if report.location else None,
        "location_text": report.location_text,
        "description": report.description,
        "contact_email": report.contact_email,
        "status": report.status,
        "status_label": STATUS_LABELS[report.status],
        "priority": report.priority,
        "created_at": iso(report.created_at),
        "updated_at": iso(report.updated_at),
        "resolved_at": iso(report.resolved_at),
        "allowed_transitions": allowed_transitions(report.status),
        "history": [
            {
                "from_status": h.from_status,
                "to_status": h.to_status,
                "status_label": STATUS_LABELS.get(h.to_status, h.to_status),
                "internal_note": h.internal_note,
                "public_note": h.public_note,
                "changed_by": h.changed_by.full_name if h.changed_by else None,
                "created_at": iso(h.created_at),
            }
            for h in report.history
        ],
    }


def document(doc: Document) -> dict:
    return {
        "id": doc.id,
        "title": doc.title,
        "original_filename": doc.original_filename,
        "department": department_ref(doc.department),
        "status": doc.status,
        "error_message": doc.error_message,
        "page_count": doc.page_count,
        "chunk_count": doc.chunk_count,
        "size_bytes": doc.size_bytes,
        "is_public": doc.is_public,
        "uploaded_by": doc.uploaded_by.full_name if doc.uploaded_by else None,
        "created_at": iso(doc.created_at),
        "indexed_at": iso(doc.indexed_at),
    }


def document_public(doc: Document) -> dict:
    return {
        "id": doc.id,
        "title": doc.title,
        "department": doc.department.name,
        "page_count": doc.page_count,
        "indexed_at": iso(doc.indexed_at),
    }


def user(u: User) -> dict:
    locked = u.locked_until is not None and as_aware(u.locked_until) > utcnow()
    return {
        "id": u.id,
        "email": u.email,
        "full_name": u.full_name,
        "is_active": u.is_active,
        "is_superadmin": u.is_superadmin,
        "departments": [department_ref(d) for d in u.departments],
        "last_login_at": iso(u.last_login_at),
        "created_at": iso(u.created_at),
        "locked": locked,
    }


def me(u: User, csrf_token: str) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "full_name": u.full_name,
        "is_superadmin": u.is_superadmin,
        "departments": [{**department_dict(d), "modules": d.module_codes} for d in u.departments if d.is_active],
        "csrf_token": csrf_token,
    }


def audit_log(log: AuditLog) -> dict:
    return {
        "id": log.id,
        "created_at": iso(log.created_at),
        "user": log.user.email if log.user else None,
        "action": log.action,
        "entity_type": log.entity_type,
        "entity_id": log.entity_id,
        "details": log.details or {},
        "ip_address": log.ip_address,
    }
