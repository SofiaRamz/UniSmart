"""Extrae, fragmenta e indexa reglamentos y documentos oficiales en PDF con PyMuPDF.

Uso (desde backend/):
    # 1) Revisar el texto extraído antes de indexar (genera reglamento.extraido.txt)
    python -m scripts.ingest_pdf docs/reglamento.pdf --preview

    # 2) Indexar en la base de datos para el chatbot
    python -m scripts.ingest_pdf docs/reglamento.pdf --title "Reglamento General de Estudiantes" --department CONTROL_ESCOLAR

    # 3) Volver a generar embeddings de todos los documentos (tras cambiar EMBEDDING_MODEL)
    python -m scripts.ingest_pdf --reindex-all
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlalchemy import select

from app.config import get_settings
from app.core.chunking import chunk_pages
from app.db import SessionLocal
from app.models import Department, Document
from app.services.embeddings import get_embedder
from app.services.ingestion import index_pages, process_document, sha256_bytes, store_upload, stored_path
from app.services.pdf_extract import PDFValidationError, extract_pages, validate_pdf_bytes


def preview(path: Path) -> int:
    settings = get_settings()
    pages = extract_pages(path, settings)
    chunks = chunk_pages(pages, size=settings.CHUNK_SIZE, overlap=settings.CHUNK_OVERLAP)
    out = path.with_suffix(".extraido.txt")
    with out.open("w", encoding="utf-8") as fh:
        for page in pages:
            fh.write(f"\n===== Página {page.page_number} ({len(page.text.strip())} caracteres) =====\n{page.text}\n")
    empty = [p.page_number for p in pages if len(p.text.strip()) < 25]
    print(f"Páginas: {len(pages)} · Fragmentos: {len(chunks)} · Texto guardado en {out}")
    if empty:
        print(f"Páginas sin texto (¿escaneadas? activa OCR_ENABLED): {empty[:30]}")
    for chunk in chunks[:3]:
        print(f"\n--- Fragmento {chunk.index} (pág. {chunk.page_number}) ---\n{chunk.content[:400]}")
    return 0


def ingest(path: Path, title: str, department_code: str) -> int:
    settings = get_settings()
    data = path.read_bytes()
    try:
        pages_count = validate_pdf_bytes(data, path.name, settings)
    except PDFValidationError as exc:
        print(f"Archivo rechazado: {exc}")
        return 1
    with SessionLocal() as db:
        dep = db.scalar(select(Department).where(Department.code == department_code.upper()))
        if dep is None:
            codes = ", ".join(db.scalars(select(Department.code)))
            print(f"Departamento desconocido. Opciones: {codes}")
            return 1
        digest = sha256_bytes(data)
        doc = db.scalar(select(Document).where(Document.department_id == dep.id, Document.sha256 == digest))
        if doc is None:
            doc = Document(
                department_id=dep.id,
                title=title,
                original_filename=path.name,
                stored_filename=store_upload(data, settings),
                sha256=digest,
                size_bytes=len(data),
                page_count=pages_count,
                status="processing",
            )
            db.add(doc)
            db.flush()
        else:
            print(f"El archivo ya existía como documento #{doc.id}; se vuelve a indexar.")
        pages = extract_pages(stored_path(doc, settings), settings)
        count = index_pages(db, doc, pages, get_embedder(), settings)
        db.commit()
        print(f"Documento #{doc.id} «{doc.title}» indexado: {count} fragmentos de {len(pages)} páginas.")
    return 0


def reindex_all() -> int:
    settings = get_settings()
    with SessionLocal() as db:
        ids = list(db.scalars(select(Document.id)))
    for doc_id in ids:
        process_document(SessionLocal, doc_id, settings, get_embedder())
        with SessionLocal() as db:
            doc = db.get(Document, doc_id)
            print(f"#{doc.id} {doc.title}: {doc.status} {doc.error_message or ''}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Indexar PDF oficiales para el chatbot")
    parser.add_argument("pdf", type=Path, nargs="?")
    parser.add_argument("--preview", action="store_true", help="Solo extraer y mostrar el texto")
    parser.add_argument("--title", help="Título visible en las citas")
    parser.add_argument("--department", default="CONTROL_ESCOLAR", help="Código del departamento dueño")
    parser.add_argument("--reindex-all", action="store_true")
    args = parser.parse_args(argv)
    if args.reindex_all:
        return reindex_all()
    if not args.pdf or not args.pdf.exists():
        parser.error("Indica la ruta de un PDF existente")
    if args.preview:
        return preview(args.pdf)
    return ingest(args.pdf, args.title or args.pdf.stem.replace("_", " "), args.department)


if __name__ == "__main__":
    sys.exit(main())
