"""Fragmentación de texto por página, consciente de párrafos y artículos."""

from __future__ import annotations

import re
from dataclasses import dataclass

from .text import clean_extracted_text

_ARTICLE_RE = re.compile(r"(?im)^(art[ií]culo|cap[ií]tulo|secci[oó]n|t[ií]tulo)\s+[\divxlc]+")
_SENTENCE_RE = re.compile(r"(?<=[.;:!?])\s+")


@dataclass(frozen=True)
class PageText:
    page_number: int
    text: str


@dataclass(frozen=True)
class Chunk:
    index: int
    page_number: int
    content: str


def _paragraphs(text: str) -> list[str]:
    text = _ARTICLE_RE.sub(lambda m: "\n\n" + m.group(0), text)
    parts = [p.replace("\n", " ").strip() for p in re.split(r"\n\s*\n", text)]
    return [p for p in parts if p]


def _split_long(paragraph: str, size: int) -> list[str]:
    if len(paragraph) <= size:
        return [paragraph]
    pieces: list[str] = []
    current = ""
    for sentence in _SENTENCE_RE.split(paragraph):
        while len(sentence) > size:  # oración enorme (tablas, listas sin puntos)
            cut = sentence[:size].rsplit(" ", 1)[0] or sentence[:size]
            if current:
                pieces.append(current)
                current = ""
            pieces.append(cut)
            sentence = sentence[len(cut) :].strip()
        if len(current) + len(sentence) + 1 > size and current:
            pieces.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        pieces.append(current)
    return pieces


def _overlap_tail(text: str, overlap: int) -> str:
    if overlap <= 0 or len(text) <= overlap:
        return ""
    tail = text[-overlap:]
    space = tail.find(" ")
    return tail[space + 1 :] if space != -1 else tail


def chunk_pages(pages: list[PageText], size: int = 900, overlap: int = 150, min_chars: int = 40) -> list[Chunk]:
    """Divide cada página en fragmentos de ~size caracteres con solapamiento.

    Los fragmentos nunca cruzan páginas para que la cita (documento + página) sea exacta.
    """
    if size < 200:
        raise ValueError("size debe ser al menos 200 caracteres")
    overlap = max(0, min(overlap, size // 2))
    chunks: list[Chunk] = []
    for page in pages:
        text = clean_extracted_text(page.text)
        if not text:
            continue
        buffer = ""
        for paragraph in _paragraphs(text):
            for piece in _split_long(paragraph, size):
                if buffer and len(buffer) + len(piece) + 1 > size:
                    chunks.append(Chunk(len(chunks), page.page_number, buffer))
                    tail = _overlap_tail(buffer, overlap)
                    buffer = f"{tail} {piece}".strip() if tail else piece
                else:
                    buffer = f"{buffer}\n{piece}".strip() if buffer else piece
        if len(buffer) >= min_chars or (buffer and not any(c.page_number == page.page_number for c in chunks)):
            chunks.append(Chunk(len(chunks), page.page_number, buffer))
    return chunks
