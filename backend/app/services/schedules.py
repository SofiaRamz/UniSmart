"""Consultas exactas y mantenimiento de horarios (fuente de verdad: PostgreSQL)."""

from __future__ import annotations

from datetime import time

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..core.intent import DAY_NAMES, Vocabulary
from ..core.schedule_csv import ScheduleRow
from ..models import AcademicPeriod, CampusLocation, Classroom, ScheduleEntry, StudentGroup, Subject, Teacher


def active_period(db: Session) -> AcademicPeriod | None:
    period = db.scalar(
        select(AcademicPeriod).where(AcademicPeriod.is_active.is_(True)).order_by(AcademicPeriod.id.desc())
    )
    return period or db.scalar(select(AcademicPeriod).order_by(AcademicPeriod.id.desc()))


def get_period_by_code(db: Session, code: str) -> AcademicPeriod | None:
    return db.scalar(select(AcademicPeriod).where(func.upper(AcademicPeriod.code) == code.upper()))


def get_or_create_group(db: Session, code: str) -> StudentGroup:
    code = code.upper()
    group = db.scalar(select(StudentGroup).where(StudentGroup.code == code))
    if group is None:
        group = StudentGroup(code=code, name=f"Grupo {code}")
        db.add(group)
        db.flush()
    return group


def get_or_create_subject(db: Session, name: str) -> Subject:
    name = " ".join(name.split())
    subject = db.scalar(select(Subject).where(func.lower(Subject.name) == name.lower()))
    if subject is None:
        subject = Subject(name=name)
        db.add(subject)
        db.flush()
    return subject


def get_or_create_teacher(db: Session, full_name: str | None) -> Teacher | None:
    if not full_name or not full_name.strip():
        return None
    full_name = " ".join(full_name.split())
    teacher = db.scalar(select(Teacher).where(func.lower(Teacher.full_name) == full_name.lower()))
    if teacher is None:
        teacher = Teacher(full_name=full_name)
        db.add(teacher)
        db.flush()
    return teacher


def get_or_create_classroom(db: Session, code: str, building: str | None = None) -> Classroom:
    code = code.upper()
    room = db.scalar(select(Classroom).where(Classroom.code == code))
    if room is None:
        name = f"Aula {code}" if code.isdigit() else code
        location = db.scalar(select(CampusLocation).where(func.lower(CampusLocation.name) == name.lower()))
        room = Classroom(code=code, name=name, building=building or "", location_id=location.id if location else None)
        db.add(room)
        db.flush()
    elif building and not room.building:
        room.building = building
    return room


def search_entries(
    db: Session,
    *,
    period_id: int | None = None,
    groups: list[str] | None = None,
    classrooms: list[str] | None = None,
    day: int | None = None,
    teacher_ids: list[int] | None = None,
    subject_ids: list[int] | None = None,
    limit: int = 500,
) -> list[ScheduleEntry]:
    if period_id is None:
        period = active_period(db)
        if period is None:
            return []
        period_id = period.id
    stmt = (
        select(ScheduleEntry)
        .join(StudentGroup, StudentGroup.id == ScheduleEntry.group_id)
        .join(Classroom, Classroom.id == ScheduleEntry.classroom_id)
        .where(ScheduleEntry.period_id == period_id)
    )
    if groups:
        stmt = stmt.where(StudentGroup.code.in_([g.upper() for g in groups]))
    if classrooms:
        stmt = stmt.where(Classroom.code.in_([c.upper() for c in classrooms]))
    if day:
        stmt = stmt.where(ScheduleEntry.day_of_week == day)
    if teacher_ids:
        stmt = stmt.where(ScheduleEntry.teacher_id.in_(teacher_ids))
    if subject_ids:
        stmt = stmt.where(ScheduleEntry.subject_id.in_(subject_ids))
    stmt = stmt.order_by(StudentGroup.code, ScheduleEntry.day_of_week, ScheduleEntry.start_time).limit(limit)
    return list(db.scalars(stmt).unique())


def find_db_conflicts(
    db: Session,
    *,
    period_id: int,
    group_id: int,
    classroom_id: int,
    teacher_id: int | None,
    day: int,
    start: time,
    end: time,
    exclude_id: int | None = None,
) -> list[str]:
    """Empalmes contra lo ya registrado: grupo, aula o docente ocupados en ese horario."""
    stmt = select(ScheduleEntry).where(
        ScheduleEntry.period_id == period_id,
        ScheduleEntry.day_of_week == day,
        ScheduleEntry.start_time < end,
        ScheduleEntry.end_time > start,
    )
    if exclude_id is not None:
        stmt = stmt.where(ScheduleEntry.id != exclude_id)
    conflicts: list[str] = []
    for other in db.scalars(stmt).unique():
        when = f"{DAY_NAMES[day]} {other.start_time:%H:%M}-{other.end_time:%H:%M}"
        if other.group_id == group_id:
            conflicts.append(f"El grupo {other.group.code} ya tiene {other.subject.name} ({when})")
        if other.classroom_id == classroom_id:
            conflicts.append(f"El aula {other.classroom.code} está ocupada por {other.group.code} ({when})")
        if teacher_id is not None and other.teacher_id == teacher_id:
            conflicts.append(f"{other.teacher.full_name} ya imparte clase a {other.group.code} ({when})")
    return conflicts


def import_rows(db: Session, rows: list[ScheduleRow], *, replace: bool, user_id: int | None) -> dict:
    """Inserta filas ya validadas. replace=True borra antes los horarios de los periodos incluidos."""
    periods: dict[str, AcademicPeriod] = {}
    for code in sorted({r.period for r in rows}):
        period = get_period_by_code(db, code)
        if period is None:
            raise ValueError(f"El periodo {code} no existe. Créalo primero en el panel o con el seed.")
        periods[code] = period
    deleted = 0
    if replace:
        for period in periods.values():
            deleted += db.execute(delete(ScheduleEntry).where(ScheduleEntry.period_id == period.id)).rowcount or 0
        db.flush()
    conflicts: list[dict] = []
    created = 0
    for row in rows:
        period = periods[row.period]
        group = get_or_create_group(db, row.group)
        classroom = get_or_create_classroom(db, row.classroom, row.building)
        subject = get_or_create_subject(db, row.subject)
        teacher = get_or_create_teacher(db, row.teacher)
        problems = find_db_conflicts(
            db,
            period_id=period.id,
            group_id=group.id,
            classroom_id=classroom.id,
            teacher_id=teacher.id if teacher else None,
            day=row.day,
            start=row.start,
            end=row.end,
        )
        if problems:
            conflicts.extend({"line": row.line, "field": "horario", "message": p} for p in problems)
            continue
        db.add(
            ScheduleEntry(
                period_id=period.id,
                group_id=group.id,
                subject_id=subject.id,
                teacher_id=teacher.id if teacher else None,
                classroom_id=classroom.id,
                day_of_week=row.day,
                start_time=row.start,
                end_time=row.end,
                updated_by_id=user_id,
            )
        )
        db.flush()
        created += 1
    return {"created": created, "deleted": deleted, "conflicts": conflicts}


def vocabulary(db: Session) -> Vocabulary:
    period = active_period(db)
    vocab = Vocabulary(
        groups=set(db.scalars(select(StudentGroup.code))),
        classrooms=set(db.scalars(select(Classroom.code))),
        locations={
            loc.id: loc.name for loc in db.scalars(select(CampusLocation).where(CampusLocation.is_active.is_(True)))
        },
    )
    if period is not None:
        used = select(ScheduleEntry.subject_id).where(ScheduleEntry.period_id == period.id)
        vocab.subjects = {s.id: s.name for s in db.scalars(select(Subject).where(Subject.id.in_(used)))}
        used_t = select(ScheduleEntry.teacher_id).where(ScheduleEntry.period_id == period.id)
        vocab.teachers = {t.id: t.full_name for t in db.scalars(select(Teacher).where(Teacher.id.in_(used_t)))}
    return vocab
