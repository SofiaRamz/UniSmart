"""Utilidades de texto en español sin dependencias externas."""

from __future__ import annotations

import re
import unicodedata

NO_INFO_MESSAGE = "No tengo información oficial sobre esto en los documentos cargados."

SPANISH_STOPWORDS = frozenset(
    """a al algo algun alguna algunas alguno algunos ante antes aqui asi aun cada como con contra cual cuales
    cuando cuanto de del desde donde dos el ella ellas ellos en entre era eran es esa esas ese eso esos esta
    estan estas este esto estos fue fueron ha han hasta hay la las le les lo los mas me mi mis muy ni no nos
    o otra otras otro otros para pero por porque que quien quienes se sea segun ser si sin sobre son su sus
    tambien tan tiene tienen todo todos tu tus un una unas uno unos y ya yo puedo puede pueden debo debe
    necesito quiero saber cual cuales hola gracias favor me podrias podria dime decir""".split()
)

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_HYPHEN_BREAK_RE = re.compile(r"(\w)-\n(\w)")
_SPACES_RE = re.compile(r"[ \t\xa0]+")
_MANY_NEWLINES_RE = re.compile(r"\n{3,}")


def strip_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def normalize(text: str) -> str:
    """Minúsculas y sin acentos; conserva la ñ como 'n'."""
    return strip_accents(text or "").lower()


def tokens(text: str, drop_stopwords: bool = True) -> list[str]:
    found = _TOKEN_RE.findall(normalize(text))
    if drop_stopwords:
        return [t for t in found if t not in SPANISH_STOPWORDS]
    return found


def stem(token: str) -> str:
    """Raíz aproximada (prefijo) para comparar 'inscripcion' con 'inscripciones'."""
    return token[:6] if len(token) > 6 else token


def keyword_coverage(query: str, content_normalized: str) -> float:
    """Fracción de términos significativos de la pregunta presentes en el fragmento."""
    q_terms = {stem(t) for t in tokens(query) if len(t) >= 3}
    if not q_terms:
        return 0.0
    c_terms = {stem(t) for t in _TOKEN_RE.findall(content_normalized)}
    return len(q_terms & c_terms) / len(q_terms)


def clean_extracted_text(text: str) -> str:
    """Limpia el texto que entrega PyMuPDF/OCR antes de fragmentarlo."""
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    text = _HYPHEN_BREAK_RE.sub(r"\1\2", text)
    lines = [_SPACES_RE.sub(" ", line).strip() for line in text.split("\n")]
    text = "\n".join(lines)
    return _MANY_NEWLINES_RE.sub("\n\n", text).strip()


def strip_reasoning(text: str) -> str:
    """Quita bloques <think> que algunos modelos Qwen3 devuelven."""
    text = _THINK_RE.sub("", text or "")
    if "</think>" in text:  # bloque abierto antes del inicio de la respuesta
        text = text.split("</think>", 1)[1]
    return text.strip()


def is_no_info_answer(text: str) -> bool:
    n = normalize(text)
    return "no tengo informacion oficial" in n or n.strip() in {"", "no se", "no lo se"}


def snippet(text: str, limit: int = 220) -> str:
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return cut + "…"
