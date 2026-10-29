"""Lectura y validación de horarios en CSV (plantilla oficial). Sin IA de por medio."""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from datetime import time

from .intent import DAY_NAMES
from .text import normalize

REQUIRED_COLUMNS = ("periodo", "grupo", "materia", "aula", "dia", "hora_inicio", "hora_fin")
OPTIONAL_COLUMNS = ("docente", "edificio")
TEMPLATE_HEADER = "periodo,grupo,materia,docente,aula,edificio,dia,hora_inicio,hora_fin"

_DAY_LOOKUP = {normalize(name): num for num, name in DAY_NAMES.items()}
_DAY_LOOKUP.update({k[:3]: v for k, v in list(_DAY_LOOKUP.items())})
_DAY_LOOKUP.update({str(n): n for n in DAY_NAMES})
_TIME_RE = re.compile(r"^\s*(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap]\.?\s?m\.?)?\s*$", re.IGNORECASE)
_CODE_RE = re.compile(r"^[A-Za-z0-9\-_.]{1,20}$")


@dataclass(frozen=True)
class ScheduleRow:
    line: int
    period: str
    group: str
    subject: str
    teacher: str
    classroom: str
    building: str
    day: int
    start: time
    end: time


@dataclass(frozen=True)
class RowError:
    line: int
    field: str
    message: str

    def as_dict(self) -> dict:
        return {"line": self.line, "field": self.field, "message": self.message}


def parse_time(value: str) -> time | None:
    m = _TIME_RE.match(value or "")
    if not m:
        return None
    hour, minute = int(m.group(1)), int(m.group(2) or 0)
    meridiem = (m.group(3) or "").lower().replace(".", "").replace(" ", "")
    if meridiem == "pm" and hour < 12:
        hour += 12
    if meridiem == "am" and hour == 12:
        hour = 0
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return time(hour, minute)


def parse_day(value: str) -> int | None:
    return _DAY_LOOKUP.get(normalize(value).strip().rstrip("."))


def overlaps(a_start: time, a_end: time, b_start: time, b_end: time) -> bool:
    return a_start < b_end and b_start < a_end


def _decode(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("No se pudo leer el archivo: usa CSV UTF-8")


def _getter(raw: dict, header_map: dict[str, str]):
    return lambda col: (raw.get(header_map.get(col, ""), "") or "").strip()


def parse_schedule_csv(data: bytes, max_rows: int = 5000) -> tuple[list[ScheduleRow], list[RowError]]:
    """Convierte el CSV a filas validadas. Acepta separador ',' o ';' (Excel en español)."""
    text = _decode(data)
    first_line = text.split("\n", 1)[0]
    delimiter = ";" if first_line.count(";") > first_line.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    if not reader.fieldnames:
        return [], [RowError(1, "encabezado", "El archivo está vacío")]
    header_map = {normalize(h).strip().replace(" ", "_"): h for h in reader.fieldnames if h}
    missing = [c for c in REQUIRED_COLUMNS if c not in header_map]
    if missing:
        return [], [RowError(1, "encabezado", f"Faltan columnas: {', '.join(missing)}. Usa: {TEMPLATE_HEADER}")]

    rows: list[ScheduleRow] = []
    errors: list[RowError] = []
    for line, raw in enumerate(reader, start=2):
        if line - 1 > max_rows:
            errors.append(RowError(line, "archivo", f"Máximo {max_rows} filas por importación"))
            break
        get = _getter(raw, header_map)
        if not any(get(c) for c in REQUIRED_COLUMNS):
            continue  # fila vacía
        row_errors: list[RowError] = []
        for col in REQUIRED_COLUMNS:
            if not get(col):
                row_errors.append(RowError(line, col, "Campo obligatorio vacío"))
        group = get("grupo").upper().replace(" ", "")
        classroom = re.sub(r"^(AULA|SAL[OÓ]N)\s*", "", get("aula").upper()).replace(" ", "")
        if group and not _CODE_RE.match(group):
            row_errors.append(RowError(line, "grupo", f"Código de grupo inválido: {group}"))
        if classroom and not _CODE_RE.match(classroom):
            row_errors.append(RowError(line, "aula", f"Código de aula inválido: {classroom}"))
        day = parse_day(get("dia")) if get("dia") else None
        if get("dia") and day is None:
            row_errors.append(RowError(line, "dia", f"Día no reconocido: {get('dia')}"))
        start = parse_time(get("hora_inicio")) if get("hora_inicio") else None
        end = parse_time(get("hora_fin")) if get("hora_fin") else None
        if get("hora_inicio") and start is None:
            row_errors.append(RowError(line, "hora_inicio", f"Hora inválida: {get('hora_inicio')} (usa HH:MM)"))
        if get("hora_fin") and end is None:
            row_errors.append(RowError(line, "hora_fin", f"Hora inválida: {get('hora_fin')} (usa HH:MM)"))
        if start and end and end <= start:
            row_errors.append(RowError(line, "hora_fin", "La hora de fin debe ser posterior a la de inicio"))
        if row_errors:
            errors.extend(row_errors)
            continue
        assert day is not None and start is not None and end is not None
        rows.append(
            ScheduleRow(
                line=line,
                period=get("periodo").upper(),
                group=group,
                subject=" ".join(get("materia").split()),
                teacher=" ".join(get("docente").split()),
                classroom=classroom,
                building=get("edificio"),
                day=day,
                start=start,
                end=end,
            )
        )
    errors.extend(find_conflicts(rows))
    return rows, errors


def find_conflicts(rows: list[ScheduleRow]) -> list[RowError]:
    """Detecta empalmes dentro del mismo archivo: grupo, aula o docente en dos lugares a la vez."""
    errors: list[RowError] = []
    for i, a in enumerate(rows):
        for b in rows[i + 1 :]:
            if a.period != b.period or a.day != b.day or not overlaps(a.start, a.end, b.start, b.end):
                continue
            when = f"{DAY_NAMES[a.day]} {a.start:%H:%M}-{a.end:%H:%M}"
            if a.group == b.group:
                errors.append(RowError(b.line, "grupo", f"Empalme del grupo {a.group} con la línea {a.line} ({when})"))
            if a.classroom == b.classroom:
                errors.append(
                    RowError(b.line, "aula", f"Empalme del aula {a.classroom} con la línea {a.line} ({when})")
                )
            if a.teacher and a.teacher == b.teacher:
                errors.append(RowError(b.line, "docente", f"Empalme de {a.teacher} con la línea {a.line} ({when})"))
    return errors
