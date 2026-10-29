"""Búsqueda híbrida sobre fragmentos de documentos: vectorial + palabras clave (RRF)."""

from __future__ import annotations

import logging
import re
import threading
from dataclasses import dataclass

import numpy as np
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..config import Settings
from ..core.fusion import reciprocal_rank_fusion
from ..core.text import keyword_coverage, normalize, tokens
from ..models import Document, DocumentChunk
from .embeddings import Embedder, EmbeddingError

log = logging.getLogger("unismart.retrieval")

_VISIBLE_DOCS = "d.status = 'indexed' AND d.is_public = TRUE"


@dataclass
class RetrievedChunk:
    chunk_id: int
    document_id: int
    document_title: str
    department: str
    page_number: int
    content: str
    vector_score: float | None
    keyword_coverage: float
    fused_score: float


# ---------------------------------------------------------------- Detección del tipo de columna
_mode_cache: dict[str, str] = {}
_matrix_cache: dict[str, tuple[int, list[int], np.ndarray]] = {}
_cache_lock = threading.Lock()
_index_version = 0


def invalidate_vector_cache() -> None:
    """Se llama después de indexar o eliminar documentos."""
    global _index_version
    with _cache_lock:
        _index_version += 1
        _matrix_cache.clear()


def vector_mode(db: Session) -> str:
    """'pgvector' si la columna es de tipo vector; 'array' en caso contrario (Python + NumPy)."""
    bind = db.get_bind()
    key = str(bind.engine.url)
    if key in _mode_cache:
        return _mode_cache[key]
    mode = "array"
    if bind.dialect.name == "postgresql":
        udt = db.execute(
            text(
                "SELECT udt_name FROM information_schema.columns "
                "WHERE table_name = 'document_chunks' AND column_name = 'embedding'"
            )
        ).scalar()
        mode = "pgvector" if udt == "vector" else "array"
    _mode_cache[key] = mode
    return mode


# ---------------------------------------------------------------- Búsquedas
def vector_search(db: Session, query_vector: list[float], model_id: str, limit: int) -> list[tuple[int, float]]:
    if vector_mode(db) == "pgvector":
        literal = "[" + ",".join(f"{x:.7f}" for x in query_vector) + "]"
        rows = db.execute(
            text(
                "SELECT c.id, 1 - (c.embedding <=> CAST(:q AS vector)) AS score "
                "FROM document_chunks c JOIN documents d ON d.id = c.document_id "
                f"WHERE c.embedding_model = :model AND c.embedding IS NOT NULL AND {_VISIBLE_DOCS} "
                "ORDER BY c.embedding <=> CAST(:q AS vector) LIMIT :limit"
            ),
            {"q": literal, "model": model_id, "limit": limit},
        ).all()
        return [(int(r[0]), float(r[1])) for r in rows]

    cache_key = f"{db.get_bind().engine.url}|{model_id}"
    with _cache_lock:
        cached = _matrix_cache.get(cache_key)
    if cached is None or cached[0] != _index_version:
        rows = db.execute(
            select(DocumentChunk.id, DocumentChunk.embedding)
            .join(Document, Document.id == DocumentChunk.document_id)
            .where(
                DocumentChunk.embedding_model == model_id,
                DocumentChunk.embedding.is_not(None),
                Document.status == "indexed",
                Document.is_public.is_(True),
            )
        ).all()
        ids = [int(r[0]) for r in rows]
        matrix = np.array([r[1] for r in rows], dtype=np.float32) if rows else np.zeros((0, 1), dtype=np.float32)
        if len(matrix):
            norms = np.linalg.norm(matrix, axis=1, keepdims=True)
            matrix = matrix / np.where(norms == 0, 1, norms)
        cached = (_index_version, ids, matrix)
        with _cache_lock:
            _matrix_cache[cache_key] = cached
    _, ids, matrix = cached
    if not ids:
        return []
    q = np.asarray(query_vector, dtype=np.float32)
    if q.shape[0] != matrix.shape[1]:
        log.warning("Dimensión de consulta %s distinta a la del índice %s", q.shape[0], matrix.shape[1])
        return []
    q = q / (np.linalg.norm(q) or 1.0)
    scores = matrix @ q
    top = np.argsort(-scores)[:limit]
    return [(ids[i], float(scores[i])) for i in top]


def _tsquery(query: str) -> str:
    terms = [t for t in tokens(query) if len(t) >= 3][:12]
    return " | ".join(re.sub(r"[^a-z0-9]", "", t) for t in terms if t)


def keyword_search(db: Session, query: str, limit: int) -> list[tuple[int, float]]:
    if db.get_bind().dialect.name == "postgresql":
        ts = _tsquery(query)
        if not ts:
            return []
        rows = db.execute(
            text(
                "SELECT c.id, ts_rank_cd(to_tsvector('spanish', c.search_text), to_tsquery('spanish', :q)) AS rank "
                "FROM document_chunks c JOIN documents d ON d.id = c.document_id "
                f"WHERE to_tsvector('spanish', c.search_text) @@ to_tsquery('spanish', :q) AND {_VISIBLE_DOCS} "
                "ORDER BY rank DESC LIMIT :limit"
            ),
            {"q": ts, "limit": limit},
        ).all()
        return [(int(r[0]), float(r[1])) for r in rows]
    # SQLite / otros motores: cobertura de términos en Python (suficiente para pruebas)
    rows = db.execute(
        select(DocumentChunk.id, DocumentChunk.search_text)
        .join(Document, Document.id == DocumentChunk.document_id)
        .where(Document.status == "indexed", Document.is_public.is_(True))
    ).all()
    scored = [(int(r[0]), keyword_coverage(query, r[1])) for r in rows]
    scored = [s for s in scored if s[1] > 0]
    return sorted(scored, key=lambda s: s[1], reverse=True)[:limit]


def hybrid_search(db: Session, query: str, embedder: Embedder, settings: Settings) -> list[RetrievedChunk]:
    """Devuelve solo fragmentos con evidencia suficiente (similitud o cobertura de términos)."""
    k = settings.RAG_TOP_K
    vector_hits: list[tuple[int, float]] = []
    try:
        vector_hits = vector_search(db, embedder.embed_query(query), embedder.model_id, k * 3)
    except EmbeddingError as exc:
        log.warning("Búsqueda vectorial no disponible, se usa solo palabras clave: %s", exc)
    keyword_hits = keyword_search(db, query, k * 3)
    fused = reciprocal_rank_fusion([[i for i, _ in vector_hits], [i for i, _ in keyword_hits]])[: k * 2]
    if not fused:
        return []
    vector_scores = dict(vector_hits)
    ids = [i for i, _ in fused]
    rows = db.execute(
        select(DocumentChunk, Document)
        .join(Document, Document.id == DocumentChunk.document_id)
        .where(DocumentChunk.id.in_(ids))
    ).all()
    by_id = {chunk.id: (chunk, doc) for chunk, doc in rows}
    results: list[RetrievedChunk] = []
    for chunk_id, fused_score in fused:
        if chunk_id not in by_id:
            continue
        chunk, doc = by_id[chunk_id]
        coverage = keyword_coverage(query, chunk.search_text)
        vscore = vector_scores.get(chunk_id)
        if (vscore or 0.0) < settings.RAG_MIN_SIMILARITY and coverage < settings.RAG_MIN_KEYWORD_COVERAGE:
            continue  # sin evidencia suficiente: no se envía al modelo
        results.append(
            RetrievedChunk(
                chunk_id=chunk.id,
                document_id=doc.id,
                document_title=doc.title,
                department=doc.department.name,
                page_number=chunk.page_number,
                content=chunk.content,
                vector_score=vscore,
                keyword_coverage=coverage,
                fused_score=fused_score,
            )
        )
        if len(results) >= k:
            break
    return results


def to_search_text(content: str) -> str:
    return normalize(content)
