"""Folios de seguimiento y máquina de estados de los reportes de mantenimiento."""

from __future__ import annotations

import re
import secrets

# Sin 0/O, 1/I/L ni U para que el folio se pueda dictar sin errores.
ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
TRACKING_RE = re.compile(r"^UNI-[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$")

STATUS_LABELS = {
    "recibido": "Recibido",
    "en_revision": "En revisión",
    "asignado": "Asignado",
    "en_proceso": "En proceso",
    "resuelto": "Resuelto",
    "descartado": "Descartado",
}
STATUSES = tuple(STATUS_LABELS)

TRANSITIONS: dict[str, frozenset[str]] = {
    "recibido": frozenset({"en_revision", "asignado", "descartado"}),
    "en_revision": frozenset({"asignado", "en_proceso", "descartado"}),
    "asignado": frozenset({"en_proceso", "descartado"}),
    "en_proceso": frozenset({"resuelto", "asignado"}),
    "resuelto": frozenset({"en_proceso"}),  # reapertura
    "descartado": frozenset({"en_revision"}),  # reconsideración
}

PRIORITIES = ("baja", "media", "alta")


def new_tracking_code() -> str:
    part = lambda: "".join(secrets.choice(ALPHABET) for _ in range(4))  # noqa: E731
    return f"UNI-{part()}-{part()}"


def normalize_tracking_code(value: str) -> str:
    code = (value or "").strip().upper().replace(" ", "")
    if len(code) == 8 and "-" not in code:
        code = f"UNI-{code[:4]}-{code[4:]}"
    if len(code) == 9 and code.count("-") == 1:
        code = f"UNI-{code}"
    return code


def is_valid_tracking_code(value: str) -> bool:
    return bool(TRACKING_RE.match(value or ""))


def can_transition(current: str, new: str) -> bool:
    return new in TRANSITIONS.get(current, frozenset())


def allowed_transitions(current: str) -> list[str]:
    return [s for s in STATUSES if s in TRANSITIONS.get(current, frozenset())]
