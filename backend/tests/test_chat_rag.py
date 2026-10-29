"""RAG: respuestas solo con documentos oficiales, citas y comportamiento ante fallos."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.core.chunking import PageText
from app.core.text import NO_INFO_MESSAGE
from app.models import Department, Document
from app.services.embeddings import HashEmbedder
from app.services.ingestion import index_pages

from .conftest import login

REGLAMENTO = [
    PageText(1, "Reglamento General de Estudiantes.\n\nArtículo 1. El presente reglamento aplica a todos los alumnos."),
    PageText(
        4,
        "Artículo 12. Para tener derecho a examen ordinario el alumno debe cumplir con al menos el 80% "
        "de asistencia a las clases del curso. Las faltas justificadas no se contabilizan.",
    ),
    PageText(
        7,
        "Artículo 30. Para la inscripción se requiere acta de nacimiento, CURP, certificado de "
        "bachillerato y el comprobante de pago de la cuota de inscripción.",
    ),
]


@pytest.fixture()
def indexed_document(session_factory):
    with session_factory() as db:
        dep = db.scalar(select(Department).where(Department.code == "CONTROL_ESCOLAR"))
        doc = Document(
            department_id=dep.id,
            title="Reglamento General de Estudiantes",
            original_filename="r.pdf",
            stored_filename="prueba.pdf",
            sha256="abc",
            size_bytes=100,
            page_count=7,
            status="processing",
        )
        db.add(doc)
        db.flush()
        index_pages(db, doc, REGLAMENTO, HashEmbedder(), get_settings())
        db.commit()
        return doc.id


def test_document_question_uses_llm_with_context_and_sources(client, app, indexed_document):
    app.state.fake_llm.reply = "Debes cumplir al menos el 80% de asistencia para tener derecho a examen [1]."
    body = client.post(
        "/api/public/chat", json={"message": "¿Qué porcentaje de asistencia necesito para el examen?"}
    ).json()
    assert body["route"] == "documents" and body["answered"] is True
    assert body["sources"][0]["page"] == 4 and body["sources"][0]["cited"] is True
    prompt = app.state.fake_llm.calls[0][1]["content"]
    assert "80% de asistencia" in prompt and "PREGUNTA:" in prompt
    assert "EXCLUSIVAMENTE" in app.state.fake_llm.calls[0][0]["content"]


def test_unrelated_question_returns_exact_message_without_llm(client, app, indexed_document):
    body = client.post("/api/public/chat", json={"message": "¿Cuál es el precio del boleto del metro?"}).json()
    assert body["answer"] == NO_INFO_MESSAGE and body["answered"] is False and body["sources"] == []
    assert app.state.fake_llm.calls == []


def test_model_saying_no_info_is_normalized(client, app, indexed_document):
    app.state.fake_llm.reply = "No tengo información oficial sobre esto en los documentos cargados."
    body = client.post("/api/public/chat", json={"message": "¿Qué se requiere para la inscripción?"}).json()
    assert body["answer"] == NO_INFO_MESSAGE and body["sources"] == []


def test_llm_down_returns_official_fragments(client, app, indexed_document):
    app.state.fake_llm.fail = True
    body = client.post("/api/public/chat", json={"message": "¿Qué se requiere para la inscripción?"}).json()
    assert body["route"] == "llm_unavailable" and body["sources"]
    assert any(s["page"] == 7 for s in body["sources"])


def test_empty_knowledge_base(client):
    body = client.post("/api/public/chat", json={"message": "¿Cuáles son los requisitos de titulación?"}).json()
    assert body["answer"] == NO_INFO_MESSAGE


def test_chat_input_validation_and_rate_limit(client):
    assert client.post("/api/public/chat", json={"message": "x"}).status_code == 422
    assert client.post("/api/public/chat", json={"message": "a" * 601}).status_code == 422
    codes = [
        client.post("/api/public/chat", json={"message": "¿Dónde está la biblioteca?"}).status_code for _ in range(21)
    ]
    assert codes[-1] == 429


def test_public_document_list(client, indexed_document):
    docs = client.get("/api/public/documents").json()["documents"]
    assert docs[0]["title"] == "Reglamento General de Estudiantes"


def test_upload_rejects_non_pdf(client):
    headers = login(client, "control")
    fake = client.post(
        "/api/admin/documents",
        headers=headers,
        data={"title": "Falso"},
        files={"file": ("virus.pdf", b"MZ\x90\x00 no es pdf", "application/pdf")},
    )
    assert fake.status_code == 400
    wrong_ext = client.post(
        "/api/admin/documents",
        headers=headers,
        data={"title": "Imagen"},
        files={"file": ("foto.png", b"%PDF-1.7", "image/png")},
    )
    assert wrong_ext.status_code == 400


def test_upload_requires_documents_module(make_client):
    c = make_client()
    headers = login(c, "mantenimiento")
    response = c.post(
        "/api/admin/documents",
        headers=headers,
        data={"title": "Manual"},
        files={"file": ("m.pdf", b"%PDF-1.7", "application/pdf")},
    )
    assert response.status_code == 403


def test_department_cannot_see_other_documents(make_client, indexed_document):
    servicios = make_client()
    login(servicios, "servicios")
    assert servicios.get("/api/admin/documents").json()["documents"] == []
    assert servicios.get(f"/api/admin/documents/{indexed_document}").status_code == 404
    control = make_client()
    login(control, "control")
    assert control.get(f"/api/admin/documents/{indexed_document}").json()["chunk_count"] >= 3


def test_real_pdf_upload_is_extracted_and_indexed(client):
    """Requiere PyMuPDF: genera un PDF real, lo sube y verifica la indexación en segundo plano."""
    pymupdf = pytest.importorskip("pymupdf")
    pdf = pymupdf.open()
    page = pdf.new_page()
    page.insert_text((72, 72), "Articulo 5. La credencial se tramita en Servicios Escolares con una fotografia.")
    data = pdf.tobytes()
    headers = login(client, "servicios")
    response = client.post(
        "/api/admin/documents",
        headers=headers,
        data={"title": "Guía de credencial"},
        files={"file": ("guia.pdf", data, "application/pdf")},
    )
    assert response.status_code == 201, response.text
    doc = client.get(f"/api/admin/documents/{response.json()['id']}").json()
    assert doc["status"] == "indexed" and doc["chunks_preview"][0]["page"] == 1
    duplicate = client.post(
        "/api/admin/documents",
        headers=headers,
        data={"title": "Copia"},
        files={"file": ("guia.pdf", data, "application/pdf")},
    )
    assert duplicate.status_code == 409
