"""Cliente de LM Studio (API compatible con OpenAI) para Qwen3-4B Instruct."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable

import httpx

from ..config import Settings, get_settings
from ..core.text import strip_reasoning

log = logging.getLogger("unismart.llm")

LLMCallable = Callable[[list[dict]], str]


class LLMUnavailable(RuntimeError):
    pass


def lmstudio_chat(messages: list[dict], settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    url = f"{settings.LMSTUDIO_BASE_URL.rstrip('/')}/chat/completions"
    payload = {
        "model": settings.LLM_MODEL,
        "messages": messages,
        "temperature": settings.LLM_TEMPERATURE,
        "max_tokens": settings.LLM_MAX_TOKENS,
        "stream": False,
    }
    try:
        response = httpx.post(url, json=payload, timeout=httpx.Timeout(settings.LLM_TIMEOUT_SECONDS, connect=3.0))
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"] or ""
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
        log.warning("LM Studio no respondió: %s", exc)
        raise LLMUnavailable("El modelo de lenguaje no está disponible en este momento") from exc
    return strip_reasoning(content)


_health_cache: dict[str, tuple[float, bool]] = {}


def lmstudio_online(settings: Settings | None = None, ttl_seconds: int = 15) -> bool:
    settings = settings or get_settings()
    cached = _health_cache.get(settings.LMSTUDIO_BASE_URL)
    if cached and time.monotonic() - cached[0] < ttl_seconds:
        return cached[1]
    try:
        ok = httpx.get(f"{settings.LMSTUDIO_BASE_URL.rstrip('/')}/models", timeout=1.5).status_code == 200
    except httpx.HTTPError:
        ok = False
    _health_cache[settings.LMSTUDIO_BASE_URL] = (time.monotonic(), ok)
    return ok
