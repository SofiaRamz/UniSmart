"""Proveedores de embeddings locales.

- lmstudio : endpoint /v1/embeddings de LM Studio (p. ej. nomic-embed-text-v1.5). Sin dependencias extra.
- fastembed: modelo ONNX multilingüe en CPU (pip install fastembed).
- hash     : embeddings deterministas por hashing de términos. Solo para pruebas sin LM Studio.
"""

from __future__ import annotations

import hashlib
import logging
import math
from functools import lru_cache
from typing import Protocol

import httpx

from ..config import Settings, get_settings
from ..core.text import tokens

log = logging.getLogger("unismart.embeddings")


class EmbeddingError(RuntimeError):
    pass


class Embedder(Protocol):
    model_id: str

    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


class LMStudioEmbedder:
    def __init__(self, settings: Settings) -> None:
        self.base_url = settings.LMSTUDIO_BASE_URL.rstrip("/")
        self.model = settings.EMBEDDING_MODEL
        self.query_prefix = settings.EMBEDDING_QUERY_PREFIX
        self.doc_prefix = settings.EMBEDDING_DOC_PREFIX
        self.model_id = f"lmstudio:{self.model}"

    def _embed(self, inputs: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for start in range(0, len(inputs), 32):
            batch = inputs[start : start + 32]
            try:
                response = httpx.post(
                    f"{self.base_url}/embeddings",
                    json={"model": self.model, "input": batch},
                    timeout=httpx.Timeout(120.0, connect=3.0),
                )
                response.raise_for_status()
                data = sorted(response.json()["data"], key=lambda item: item["index"])
            except (httpx.HTTPError, KeyError, ValueError) as exc:
                raise EmbeddingError(
                    f"No se pudieron generar embeddings con LM Studio ({self.model}). "
                    "Verifica que el servidor esté activo y el modelo de embeddings descargado."
                ) from exc
            vectors.extend(item["embedding"] for item in data)
        return vectors

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._embed([f"{self.doc_prefix}{t}" for t in texts])

    def embed_query(self, text: str) -> list[float]:
        return self._embed([f"{self.query_prefix}{text}"])[0]


class FastEmbedEmbedder:
    def __init__(self, settings: Settings) -> None:
        try:
            from fastembed import TextEmbedding  # type: ignore
        except ImportError as exc:  # pragma: no cover - dependencia opcional
            raise EmbeddingError("Instala fastembed: pip install fastembed") from exc
        self.model = settings.EMBEDDING_MODEL
        self._model = TextEmbedding(model_name=self.model)
        self.model_id = f"fastembed:{self.model}"

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [list(map(float, v)) for v in self._model.embed(texts)]

    def embed_query(self, text: str) -> list[float]:
        return [float(x) for x in next(iter(self._model.embed([text])))]


class HashEmbedder:
    """Bolsa de términos con hashing (384 dimensiones). Determinista y sin red."""

    def __init__(self, dim: int = 384) -> None:
        self.dim = dim
        self.model_id = f"hash-{dim}"

    def _vector(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        terms = tokens(text)
        features = terms + [f"{a}_{b}" for a, b in zip(terms, terms[1:], strict=False)]
        for feature in features:
            digest = hashlib.blake2b(
                feature[:6].encode() if "_" not in feature else feature.encode(), digest_size=8
            ).digest()
            index = int.from_bytes(digest[:4], "little") % self.dim
            vec[index] += 1.0 if digest[4] % 2 == 0 else -1.0
        norm = math.sqrt(sum(x * x for x in vec)) or 1.0
        return [x / norm for x in vec]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._vector(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vector(text)


def build_embedder(settings: Settings) -> Embedder:
    provider = settings.EMBEDDING_PROVIDER.lower()
    if provider == "lmstudio":
        return LMStudioEmbedder(settings)
    if provider == "fastembed":
        return FastEmbedEmbedder(settings)
    if provider == "hash":
        return HashEmbedder()
    raise ValueError(f"EMBEDDING_PROVIDER desconocido: {settings.EMBEDDING_PROVIDER}")


@lru_cache
def get_embedder() -> Embedder:
    return build_embedder(get_settings())
