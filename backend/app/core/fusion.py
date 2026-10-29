"""Fusión de resultados de búsqueda híbrida y reglas de contraseña."""

from __future__ import annotations

import math
import re
from collections.abc import Iterable, Sequence


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def reciprocal_rank_fusion(rankings: Iterable[Sequence[int]], k: int = 60) -> list[tuple[int, float]]:
    """Combina listas ordenadas de ids (vectorial y por palabras clave)."""
    scores: dict[int, float] = {}
    for ranking in rankings:
        for position, item_id in enumerate(ranking):
            scores[item_id] = scores.get(item_id, 0.0) + 1.0 / (k + position + 1)
    return sorted(scores.items(), key=lambda kv: kv[1], reverse=True)


def password_problems(password: str, email: str = "") -> list[str]:
    problems = []
    if len(password) < 10:
        problems.append("Debe tener al menos 10 caracteres")
    if len(password) > 128:
        problems.append("Debe tener como máximo 128 caracteres")
    if not re.search(r"[A-Za-zÁÉÍÓÚáéíóúÑñ]", password) or not re.search(r"\d", password):
        problems.append("Debe combinar letras y números")
    local = email.split("@", 1)[0].lower()
    if local and len(local) >= 4 and local in password.lower():
        problems.append("No debe contener tu correo")
    return problems
