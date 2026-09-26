"""Criptografia leve de segredos persistidos no banco.

Mantem compatibilidade: valores antigos sem prefixo sao tratados como texto claro
e valores novos sao salvos com prefixo enc:.
"""
from __future__ import annotations

import base64
import hashlib
import hmac

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings

PREFIX = "enc:"


def _fernet() -> Fernet:
    secret = get_settings().app_secret_key.encode("utf-8")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret).digest())
    return Fernet(key)


def encrypt_secret(value: str | None) -> str | None:
    if not value:
        return value
    if value.startswith(PREFIX):
        return value
    token = _fernet().encrypt(value.encode("utf-8")).decode("utf-8")
    return PREFIX + token


def decrypt_secret(value: str | None) -> str | None:
    if not value:
        return value
    if not value.startswith(PREFIX):
        return value
    try:
        return _fernet().decrypt(value[len(PREFIX):].encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return None


def mask_secret(value: str | None) -> str:
    raw = decrypt_secret(value) or value or ""
    if not raw:
        return ""
    if len(raw) <= 8:
        return "••••"
    return f"{raw[:4]}••••{raw[-4:]}"


def looks_masked(value: str | None) -> bool:
    return bool(value and ("••••" in value or "****" in value))


def token_confere(recebido: str | None, esperados) -> bool:
    """Compara o token recebido com um ou mais esperados em tempo constante.

    `==`/`in` param na primeira diferença: o tempo de resposta vaza quantos
    caracteres do começo acertaram, o que permite descobrir o token aos poucos.
    """
    if isinstance(esperados, str):
        esperados = (esperados,)
    rec = (recebido or "").encode()
    ok = False
    for esperado in esperados:
        if esperado and hmac.compare_digest(rec, esperado.encode()):
            ok = True   # sem break: o tempo não depende de qual token casou
    return ok
