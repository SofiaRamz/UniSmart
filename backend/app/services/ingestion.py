"""Flujo de documentos: almacenamiento seguro → extracción → fragmentación → embeddings → índice."""

from __future__ import annotations

import hashlib
import logging
import uuid
from collections.abc import Callable
from pathlib import Path

from sqlalchemy import delete
from sqlalchemy.orm import Session

from ..config import Settings
from ..core.chunking import PageText, chunk_pages
from ..db import utcnow
from ..models import Document, DocumentChunk
from .embeddings import Embedder, EmbeddingError
from .retrieval import invalidate_vector_cache, to_search_text

log = logging.getLogger("unismart.ingestion")

PageExtractor = Callable[[Path, Settings], list[PageText]]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def store_upload(data: bytes, settings: Settings) -> str:
    """Guarda el archivo con un nombre aleatorio (nunca el nombre que envió el usuario)."""
    settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stored = f"{uuid.uuid4().hex}.pdf"
    (settings.UPLOAD_DIR / stored).write_bytes(data)
    return stored


def stored_path(doc: Document, settings: Settings) -> Path:
    path = (settings.UPLOAD_DIR / doc.stored_filename).resolve()
    if settings.UPLOAD_DIR.resolve() not in path.parents:
        raise ValueError("Ruta de archivo inválida")
    return path


def index_pages(db: Session, doc: Document, pages: list[PageText], embedder: Embedder, settings: Settings) -> int:
    """Fragmenta y genera embeddings; reemplaza el índice anterior del documento."""
    chunks = chunk_pages(pages, size=settings.CHUNK_SIZE, overlap=settings.CHUNK_OVERLAP)
    if not chunks:
        raise ValueError(
            "No se encontró texto en el PDF. Si es un documento escaneado, activa OCR_ENABLED e instala Tesseract."
        )
    texts = [f"{doc.title}\n{c.content}" for c in chunks]
    vectors = embedder.embed_documents(texts)
    db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == doc.id))
    db.add_all(
        DocumentChunk(
            document_id=doc.id,
            chunk_index=c.index,
            page_number=c.page_number,
            content=c.content,
            search_text=to_search_text(f"{doc.title} {c.content}"),
            embedding=vector,
            embedding_model=embedder.model_id,
        )
        for c, vector in zip(chunks, vectors, strict=True)
    )
    doc.page_count = max(doc.page_count, max(p.page_number for p in pages))
    doc.chunk_count = len(chunks)
    doc.status = "indexed"
    doc.error_message = None
    doc.indexed_at = utcnow()
    return len(chunks)


def process_document(
    session_factory: Callable[[], Session],
    document_id: int,
    settings: Settings,
    embedder: Embedder,
    extractor: PageExtractor | None = None,
) -> None:
    """Tarea en segundo plano. Nunca lanza excepciones: registra el error en el documento."""
    if extractor is None:
        from .pdf_extract import extract_pages as extractor  # importación diferida (PyMuPDF)
    db = session_factory()
    try:
        doc = db.get(Document, document_id)
        if doc is None:
            return
        try:
            pages = extractor(stored_path(doc, settings), settings)
            count = index_pages(db, doc, pages, embedder, settings)
            db.commit()
            log.info("Documento %s indexado: %s fragmentos", doc.id, count)
        except (ValueError, EmbeddingError, OSError) as exc:
            db.rollback()
            doc = db.get(Document, document_id)
            if doc is not None:
                doc.status = "failed"
                doc.error_message = str(exc)[:1000]
                db.commit()
        except Exception as exc:  # error inesperado de PyMuPDF u otro
            log.exception("Fallo al indexar el documento %s", document_id)
            db.rollback()
            doc = db.get(Document, document_id)
            if doc is not None:
                doc.status = "failed"
                doc.error_message = f"Error inesperado al procesar el PDF: {exc.__class__.__name__}"
                db.commit()
    finally:
        db.close()
        invalidate_vector_cache()
