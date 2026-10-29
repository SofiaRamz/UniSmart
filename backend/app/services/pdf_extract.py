"""Validación y extracción de texto de PDF con PyMuPDF (OCR opcional con Tesseract)."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from ..config import Settings
from ..core.chunking import PageText

log = logging.getLogger("unismart.pdf")

try:  # PyMuPDF >= 1.24 expone "pymupdf"; versiones anteriores "fitz"
    import pymupdf
except ImportError:  # pragma: no cover
    import fitz as pymupdf  # type: ignore


class PDFValidationError(ValueError):
    pass


def validate_pdf_bytes(data: bytes, filename: str, settings: Settings) -> int:
    """Valida tipo real, tamaño, cifrado y número de páginas. Devuelve el número de páginas."""
    if not filename.lower().endswith(".pdf"):
        raise PDFValidationError("Solo se permiten archivos PDF")
    if len(data) > settings.MAX_UPLOAD_MB * 1024 * 1024:
        raise PDFValidationError(f"El archivo supera el límite de {settings.MAX_UPLOAD_MB} MB")
    if not data.startswith(b"%PDF-"):
        raise PDFValidationError("El contenido no corresponde a un PDF válido")
    try:
        with pymupdf.open(stream=data, filetype="pdf") as doc:
            if doc.needs_pass or doc.is_encrypted:
                raise PDFValidationError("El PDF está protegido con contraseña")
            pages = doc.page_count
    except PDFValidationError:
        raise
    except Exception as exc:  # PyMuPDF lanza varios tipos según la corrupción
        raise PDFValidationError("El PDF está dañado o no se puede leer") from exc
    if pages == 0:
        raise PDFValidationError("El PDF no tiene páginas")
    if pages > settings.MAX_PDF_PAGES:
        raise PDFValidationError(f"El PDF tiene {pages} páginas; el máximo es {settings.MAX_PDF_PAGES}")
    return pages


def extract_pages(path: Path, settings: Settings) -> list[PageText]:
    """Extrae el texto página por página. Si una página no tiene texto y el OCR está activo, la reconoce."""
    if settings.TESSDATA_PREFIX:
        os.environ.setdefault("TESSDATA_PREFIX", settings.TESSDATA_PREFIX)
    pages: list[PageText] = []
    with pymupdf.open(path) as doc:
        for page in doc:
            text = page.get_text("text", sort=True) or ""
            if len(text.strip()) < 25 and settings.OCR_ENABLED:
                try:
                    textpage = page.get_textpage_ocr(language=settings.OCR_LANGUAGE, dpi=300, full=True)
                    text = page.get_text("text", textpage=textpage, sort=True) or ""
                except Exception as exc:  # Tesseract ausente o idioma no instalado
                    log.warning("OCR falló en la página %s de %s: %s", page.number + 1, path.name, exc)
            pages.append(PageText(page_number=page.number + 1, text=text))
    return pages


def extract_tables(path: Path) -> list[tuple[int, list[list[str]]]]:
    """Detecta tablas sin IA (para pasar horarios a CSV y revisarlos a mano)."""
    found: list[tuple[int, list[list[str]]]] = []
    with pymupdf.open(path) as doc:
        for page in doc:
            for table in page.find_tables().tables:
                rows = [[(cell or "").replace("\n", " ").strip() for cell in row] for row in table.extract()]
                if rows:
                    found.append((page.number + 1, rows))
    return found
