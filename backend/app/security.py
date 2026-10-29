"""Hash de contraseñas (Argon2id), tokens de sesión y CSRF."""

from __future__ import annotations

import hashlib
import hmac
import secrets

from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

# Parámetros OWASP para Argon2id: 64 MiB de memoria, 3 iteraciones, 4 hilos.
_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4, hash_len=32, salt_len=16, type=Type.ID)
_DUMMY_HASH = _hasher.hash("unismart-dummy-password-para-tiempo-constante")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def burn_verification_time(password: str) -> None:
    """Evita revelar por tiempo de respuesta si un correo existe."""
    verify_password(_DUMMY_HASH, password)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def tokens_match(expected: str, received: str) -> bool:
    return bool(expected) and hmac.compare_digest(expected.encode(), (received or "").encode())


def hash_ip(ip: str, secret_key: str) -> str:
    return hmac.new(secret_key.encode(), (ip or "").encode(), hashlib.sha256).hexdigest()
