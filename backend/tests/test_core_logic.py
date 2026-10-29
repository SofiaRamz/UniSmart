"""Pruebas de la lógica pura (sin base de datos ni red)."""

from __future__ import annotations

from datetime import time

from app.core.chunking import PageText, chunk_pages
from app.core.fusion import cosine, password_problems, reciprocal_rank_fusion
from app.core.intent import Vocabulary, parse_query
from app.core.schedule_csv import parse_day, parse_schedule_csv, parse_time
from app.core.text import (
    NO_INFO_MESSAGE,
    clean_extracted_text,
    is_no_info_answer,
    keyword_coverage,
    normalize,
    strip_reasoning,
)
from app.core.tracking import can_transition, is_valid_tracking_code, new_tracking_code, normalize_tracking_code

VOCAB = Vocabulary(
    groups={"1AS", "3AS", "5AS", "7AS"},
    classrooms={"15", "16", "17", "18"},
    subjects={1: "Cálculo Diferencial", 2: "Bases de Datos"},
    teachers={1: "Dr. Ramón Aguilar Peña"},
    locations={1: "Biblioteca Central", 2: "Control Escolar"},
)


# ---------------------------------------------------------------- Texto
def test_normalize_removes_accents_and_case():
    assert normalize("Inscripción AÑO") == "inscripcion ano"


def test_clean_text_joins_hyphenated_words():
    assert clean_extracted_text("inscrip-\nción   del  alumno") == "inscripción del alumno"


def test_strip_reasoning_removes_think_blocks():
    assert strip_reasoning("<think>razono…</think>\nRespuesta [1]") == "Respuesta [1]"


def test_no_info_detection():
    assert is_no_info_answer(NO_INFO_MESSAGE)
    assert not is_no_info_answer("Se requiere el 80% de asistencia [1].")


def test_keyword_coverage():
    assert keyword_coverage("requisitos de inscripción", normalize("Requisitos para la inscripción: acta")) == 1.0
    assert keyword_coverage("precio del estacionamiento", "reglamento de becas") == 0.0


# ---------------------------------------------------------------- Fragmentación
def test_chunks_keep_page_numbers_and_size():
    text = "\n\n".join(f"Artículo {i}. " + "El alumno deberá cumplir con lo establecido. " * 12 for i in range(1, 6))
    chunks = chunk_pages([PageText(1, text), PageText(2, "Artículo 99. Disposición final del reglamento.")], 900, 150)
    assert chunks, "debe producir fragmentos"
    assert all(len(c.content) <= 900 + 150 for c in chunks)
    assert {c.page_number for c in chunks} == {1, 2}
    assert [c.index for c in chunks] == list(range(len(chunks)))


def test_empty_pages_produce_no_chunks():
    assert chunk_pages([PageText(1, "   \n  ")]) == []


# ---------------------------------------------------------------- Interpretación de preguntas
def test_group_classroom_question_routes_to_schedule():
    parsed = parse_query("¿En qué salón toma clases el grupo 3AS?", VOCAB)
    assert parsed.route == "schedule" and parsed.groups == ["3AS"]


def test_group_with_space_and_day():
    parsed = parse_query("horario del 3 as el miércoles", VOCAB)
    assert parsed.groups == ["3AS"] and parsed.day == 3


def test_unknown_group_is_reported():
    parsed = parse_query("¿Qué clases tiene el 9AS?", VOCAB)
    assert parsed.route == "schedule" and parsed.unknown_groups == ["9AS"]


def test_ordinals_are_not_groups():
    parsed = parse_query("Requisitos de baja en 1er semestre", VOCAB)
    assert parsed.unknown_groups == [] and parsed.route == "documents"


def test_missing_group_asks_for_clarification():
    assert parse_query("¿Qué clases hay el lunes?", VOCAB).route == "clarify"


def test_office_hours_question_goes_to_documents():
    assert parse_query("¿Cuál es el horario de atención de control escolar?", VOCAB).route == "documents"


def test_location_question():
    parsed = parse_query("¿Dónde está la biblioteca?", VOCAB)
    assert parsed.route == "location" and parsed.location_ids == [1]


def test_today_uses_given_weekday():
    assert parse_query("¿Qué materias tengo hoy en el 1AS?", VOCAB, today_weekday=5).day == 5


# ---------------------------------------------------------------- CSV de horarios
CSV_OK = (
    "periodo,grupo,materia,docente,aula,edificio,dia,hora_inicio,hora_fin\n"
    "2026-AGO-DIC,1AS,Cálculo Diferencial,Dr. Ramón Aguilar Peña,Aula 15,Edificio A,Lunes,7:00,8:40\n"
    "2026-AGO-DIC,3AS,Bases de Datos,,16,Edificio A,mar,1:00 PM,2:40 PM\n"
).encode()


def test_csv_parses_and_normalizes():
    rows, errors = parse_schedule_csv(CSV_OK)
    assert errors == []
    assert rows[0].classroom == "15" and rows[0].start == time(7, 0)
    assert rows[1].day == 2 and rows[1].start == time(13, 0) and rows[1].teacher == ""


def test_csv_with_semicolons_and_cp1252():
    data = CSV_OK.decode().replace(",", ";").encode("cp1252")
    rows, errors = parse_schedule_csv(data)
    assert errors == [] and len(rows) == 2


def test_csv_detects_errors_and_overlaps():
    bad = (
        b"periodo,grupo,materia,aula,dia,hora_inicio,hora_fin\n"
        b"2026-AGO-DIC,1AS,Algebra,15,Lunes,07:00,08:40\n"
        b"2026-AGO-DIC,1AS,Fisica,16,Lunes,08:00,09:00\n"
        b"2026-AGO-DIC,3AS,Quimica,17,Funday,09:00,08:00\n"
    )
    rows, errors = parse_schedule_csv(bad)
    fields = {(e.line, e.field) for e in errors}
    assert (3, "grupo") in fields  # empalme del grupo 1AS
    assert (4, "dia") in fields and (4, "hora_fin") in fields
    assert len(rows) == 2


def test_csv_missing_columns():
    rows, errors = parse_schedule_csv(b"grupo,aula\n1AS,15\n")
    assert rows == [] and errors[0].field == "encabezado"


def test_parse_helpers():
    assert parse_time("7:05 pm") == time(19, 5)
    assert parse_time("25:00") is None
    assert parse_day("Miércoles") == 3 and parse_day("SAB") == 6


# ---------------------------------------------------------------- Folios y estados
def test_tracking_codes():
    code = new_tracking_code()
    assert is_valid_tracking_code(code)
    assert normalize_tracking_code(code.lower().replace("uni-", "")) == code
    assert not is_valid_tracking_code("UNI-0000-IIII")


def test_status_transitions():
    assert can_transition("recibido", "en_revision")
    assert can_transition("en_proceso", "resuelto")
    assert not can_transition("recibido", "resuelto")


# ---------------------------------------------------------------- Búsqueda y contraseñas
def test_rrf_prefers_items_in_both_lists():
    fused = reciprocal_rank_fusion([[1, 2, 3], [3, 4]])
    assert fused[0][0] == 3


def test_cosine():
    assert round(cosine([1, 0], [1, 0]), 3) == 1.0
    assert cosine([1, 0], [0, 1]) == 0.0


def test_password_policy():
    assert password_problems("corta1")
    assert password_problems("solamenteletras")
    assert password_problems("ana.perez2026", "ana.perez@uni.mx")
    assert password_problems("Segura2026unismart") == []
