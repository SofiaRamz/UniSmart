"""Gestión de documentos oficiales por departamento (módulo 'documents')."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, Response, UploadFile
from sqlalchemy import select

from .. import serializers
from ..config import get_settings
from ..deps import DbSession, Principal, audit, require_module
from ..models import Department, Document, DocumentChunk
from ..schemas import DocumentUpdateIn
from ..services.ingestion import process_document, sha256_bytes, store_upload, stored_path
from ..services.pdf_extract import PDFValidationError, validate_pdf_bytes
from ..services.retrieval import invalidate_vector_cache

router = APIRouter(prefix="/api/admin/documents", tags=["documentos"])
DocsPrincipal = Annotated[Principal, Depends(require_module("documents"))]


def _get_owned(db, principal: Principal, document_id: int) -> Document:
    doc = db.get(Document, document_id)
    if doc is None or not principal.can("documents", doc.department_id):
        raise HTTPException(status_code=404, detail="Documento no encontrado")  # no revela documentos de otras áreas
    return doc


def _resolve_department(db, principal: Principal, department_id: int | None) -> int:
    allowed = principal.department_ids("documents")
    if department_id is None:
        if len(allowed) == 1:
            return next(iter(allowed))
        raise HTTPException(status_code=422, detail="Indica el departamento del documento")
    if not principal.can("documents", department_id):
        raise HTTPException(status_code=403, detail="No puedes publicar documentos en otro departamento")
    dep = db.get(Department, department_id)
    if dep is None or not dep.is_active:
        raise HTTPException(status_code=422, detail="Departamento inválido")
    return department_id


@router.get("")
def list_documents(principal: DocsPrincipal, db: DbSession) -> dict:
    stmt = select(Document).order_by(Document.created_at.desc())
    if not principal.is_superadmin:
        stmt = stmt.where(Document.department_id.in_(principal.department_ids("documents")))
    return {"documents": [serializers.document(d) for d in db.scalars(stmt)]}


@router.post("", status_code=201)
def upload_document(
    request: Request,
    background: BackgroundTasks,
    principal: DocsPrincipal,
    db: DbSession,
    file: UploadFile = File(...),
    title: str = Form(..., min_length=3, max_length=200),
    department_id: int | None = Form(default=None),
    is_public: bool = Form(default=True),
) -> dict:
    settings = get_settings()
    dep_id = _resolve_department(db, principal, department_id)
    data = file.file.read(settings.MAX_UPLOAD_MB * 1024 * 1024 + 1)
    try:
        pages = validate_pdf_bytes(data, file.filename or "", settings)
    except PDFValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    digest = sha256_bytes(data)
    duplicate = db.scalar(select(Document).where(Document.department_id == dep_id, Document.sha256 == digest))
    if duplicate is not None:
        raise HTTPException(status_code=409, detail=f"Este archivo ya está cargado como «{duplicate.title}»")
    doc = Document(
        department_id=dep_id,
        title=" ".join(title.split()),
        original_filename=(file.filename or "documento.pdf")[-255:],
        stored_filename=store_upload(data, settings),
        sha256=digest,
        size_bytes=len(data),
        page_count=pages,
        status="processing",
        is_public=is_public,
        uploaded_by_id=principal.user.id,
    )
    db.add(doc)
    db.flush()
    audit(db, request, principal.user, "document.upload", "document", doc.id, title=doc.title, pages=pages)
    db.commit()
    background.add_task(
        process_document, request.app.state.session_factory, doc.id, settings, request.app.state.get_embedder()
    )
    return serializers.document(doc)


@router.get("/{document_id}")
def get_document(document_id: int, principal: DocsPrincipal, db: DbSession) -> dict:
    doc = _get_owned(db, principal, document_id)
    chunks = db.scalars(
        select(DocumentChunk).where(DocumentChunk.document_id == doc.id).order_by(DocumentChunk.chunk_index).limit(8)
    )
    preview = [{"index": c.chunk_index, "page": c.page_number, "content": c.content} for c in chunks]
    return {**serializers.document(doc), "chunks_preview": preview}


@router.patch("/{document_id}")
def update_document(
    document_id: int, payload: DocumentUpdateIn, principal: DocsPrincipal, request: Request, db: DbSession
) -> dict:
    doc = _get_owned(db, principal, document_id)
    changes = payload.model_dump(exclude_none=True)
    for key, value in changes.items():
        setattr(doc, key, value)
    audit(db, request, principal.user, "document.update", "document", doc.id, **changes)
    db.commit()
    invalidate_vector_cache()
    return serializers.document(doc)


@router.post("/{document_id}/reindex", status_code=202)
def reindex_document(
    document_id: int, background: BackgroundTasks, principal: DocsPrincipal, request: Request, db: DbSession
) -> dict:
    doc = _get_owned(db, principal, document_id)
    doc.status = "processing"
    doc.error_message = None
    audit(db, request, principal.user, "document.reindex", "document", doc.id)
    db.commit()
    background.add_task(
        process_document, request.app.state.session_factory, doc.id, get_settings(), request.app.state.get_embedder()
    )
    return serializers.document(doc)


@router.delete("/{document_id}", status_code=204, response_class=Response)
def delete_document(document_id: int, principal: DocsPrincipal, request: Request, db: DbSession) -> Response:
    doc = _get_owned(db, principal, document_id)
    path = stored_path(doc, get_settings())
    audit(db, request, principal.user, "document.delete", "document", doc.id, title=doc.title)
    db.delete(doc)
    db.commit()
    path.unlink(missing_ok=True)
    invalidate_vector_cache()
    return Response(status_code=204)
