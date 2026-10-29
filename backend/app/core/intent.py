"""Interpretación determinista de preguntas: horarios, aulas y ubicaciones.

La IA nunca lee tablas de horarios: esta capa detecta grupo/aula/día/docente/materia
y el backend consulta PostgreSQL de forma exacta.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .text import normalize, tokens

DAY_NAMES = {1: "Lunes", 2: "Martes", 3: "Miércoles", 4: "Jueves", 5: "Viernes", 6: "Sábado", 7: "Domingo"}
_DAY_WORDS = {
    "lunes": 1,
    "lun": 1,
    "martes": 2,
    "mar": 2,
    "miercoles": 3,
    "mie": 3,
    "jueves": 4,
    "jue": 4,
    "viernes": 5,
    "vie": 5,
    "sabado": 6,
    "sab": 6,
    "domingo": 7,
    "dom": 7,
}
_GROUP_RE = re.compile(r"\b(\d{1,2})\s?(?:°|º|o\.)?\s?([a-z]{1,3})\b")
_CLASSROOM_RE = re.compile(
    r"\b(?:aula|aulas|salon|salones|sala|laboratorio|lab)\s*(?:no\.?|num\.?|numero|#)?\s*([a-z]?\d{1,3}[a-z]?)\b"
)
_NOT_GROUP_SUFFIX = frozenset(
    "a al am pm de del el en la las lo los y o u e con por que mas hr hrs h hs min va es se le me mi su tu un "
    "er ra ro do da to ta vo va no na mo ma".split()
)
_STRONG_CLASS_WORDS = frozenset(
    "clase clases materia materias grupo grupos salon salones aula aulas docente docentes profesor profesora "
    "profesores maestro maestra maestros".split()
)
_SCHEDULE_WORDS = _STRONG_CLASS_WORDS | frozenset("horario horarios hora horas toca tocan entra entran tengo".split())
_LOCATION_WORDS = frozenset("donde ubicacion ubica ubicado ubicada encuentra queda llegar mapa".split())
_GENERIC_LOCATION_TOKENS = frozenset("edificio area zona centro oficina oficinas sala modulo planta aula aulas".split())
_TITLE_TOKENS = frozenset("mtro mtra dr dra ing lic prof profa maestro maestra doctor doctora".split())


@dataclass
class Vocabulary:
    """Datos conocidos en la base de datos para validar lo que se detecta en la pregunta."""

    groups: set[str] = field(default_factory=set)  # códigos en mayúsculas: {"1AS", "3AS"}
    classrooms: set[str] = field(default_factory=set)  # códigos: {"15", "LAB2"}
    subjects: dict[int, str] = field(default_factory=dict)  # id -> nombre
    teachers: dict[int, str] = field(default_factory=dict)  # id -> nombre completo
    locations: dict[int, str] = field(default_factory=dict)  # id -> nombre


@dataclass
class ParsedQuery:
    normalized: str
    groups: list[str] = field(default_factory=list)
    unknown_groups: list[str] = field(default_factory=list)
    classrooms: list[str] = field(default_factory=list)
    unknown_classrooms: list[str] = field(default_factory=list)
    subject_ids: list[int] = field(default_factory=list)
    teacher_ids: list[int] = field(default_factory=list)
    location_ids: list[int] = field(default_factory=list)
    day: int | None = None
    schedule_words: bool = False
    strong_class_words: bool = False
    location_intent: bool = False

    @property
    def has_schedule_entity(self) -> bool:
        named = bool(self.subject_ids or self.teacher_ids) and self.schedule_words
        return bool(self.groups or self.classrooms) or named

    @property
    def route(self) -> str:
        """schedule | location | clarify | documents"""
        if self.unknown_groups and not self.groups and self.schedule_words:
            return "schedule"
        if self.location_intent and self.location_ids and not self.groups:
            return "location"
        if self.has_schedule_entity:
            return "schedule"
        if self.unknown_classrooms and (self.schedule_words or self.location_intent):
            return "schedule"
        if self.strong_class_words and not self.location_intent:
            return "clarify"
        return "documents"


def _detect_day(norm_tokens: list[str], today_weekday: int | None) -> int | None:
    for tok in norm_tokens:
        if tok in _DAY_WORDS:
            return _DAY_WORDS[tok]
    if today_weekday:
        if "hoy" in norm_tokens:
            return today_weekday
        if "manana" in norm_tokens and "en la manana" not in " ".join(norm_tokens):
            return today_weekday % 7 + 1
    return None


def _match_names(norm_query: str, query_tokens: set[str], names: dict[int, str], *, people: bool) -> list[int]:
    exact: list[int] = []
    partial: list[tuple[int, int]] = []
    for item_id, name in names.items():
        n = normalize(name)
        if n and n in norm_query:
            exact.append(item_id)
            continue
        significant = [t for t in tokens(name) if len(t) >= 4 and t not in _GENERIC_LOCATION_TOKENS]
        if people:
            significant = [t for t in significant if t not in _TITLE_TOKENS][-2:]  # apellidos
        hits = sum(1 for t in significant if t in query_tokens)
        if hits:
            partial.append((hits, item_id))
    if exact:
        return exact
    if not partial:
        return []
    best = max(h for h, _ in partial)
    winners = [i for h, i in partial if h == best]
    return winners if len(winners) <= 3 else []


def parse_query(text: str, vocab: Vocabulary, today_weekday: int | None = None) -> ParsedQuery:
    norm = normalize(text)
    all_tokens = tokens(text, drop_stopwords=False)
    token_set = set(all_tokens)
    parsed = ParsedQuery(normalized=norm)

    classroom_spans: list[tuple[int, int]] = []
    for m in _CLASSROOM_RE.finditer(norm):
        code = m.group(1).upper()
        classroom_spans.append(m.span())
        target = parsed.classrooms if code in vocab.classrooms else parsed.unknown_classrooms
        if code not in target:
            target.append(code)

    for m in _GROUP_RE.finditer(norm):
        if any(s <= m.start() < e for s, e in classroom_spans):
            continue
        number, letters = m.group(1), m.group(2)
        code = f"{int(number)}{letters.upper()}"
        if code in vocab.groups:
            if code not in parsed.groups:
                parsed.groups.append(code)
        elif letters not in _NOT_GROUP_SUFFIX and letters not in _DAY_WORDS and code not in parsed.unknown_groups:
            parsed.unknown_groups.append(code)

    parsed.day = _detect_day(all_tokens, today_weekday)
    parsed.schedule_words = bool(token_set & _SCHEDULE_WORDS)
    parsed.strong_class_words = bool(token_set & _STRONG_CLASS_WORDS)
    parsed.location_intent = bool(token_set & _LOCATION_WORDS)
    parsed.subject_ids = _match_names(norm, token_set, vocab.subjects, people=False)
    parsed.teacher_ids = _match_names(norm, token_set, vocab.teachers, people=True)
    if parsed.location_intent:
        parsed.location_ids = _match_names(norm, token_set, vocab.locations, people=False)
    return parsed
