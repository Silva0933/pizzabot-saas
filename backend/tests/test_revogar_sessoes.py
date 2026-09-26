"""
Sessões revogáveis. O JWT valia 30 dias sem como derrubar: trocar a senha do
entregador não desconectava quem estava logado com a antiga.
"""
from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.auth import create_access_token, decode_token, revogar_sessoes, sessao_revogada


def _user(desde=None):
    return SimpleNamespace(id="00000000-0000-0000-0000-0000000000aa", sessoes_validas_desde=desde)


class TestSessaoRevogada:
    def test_sem_revogacao_aceita(self):
        assert not sessao_revogada(_user(None), {"iat": 1})

    def test_token_anterior_e_recusado(self):
        agora = datetime.now(UTC)
        payload = {"iat": int((agora - timedelta(minutes=5)).timestamp())}
        assert sessao_revogada(_user(agora), payload)

    def test_token_novo_depois_da_revogacao_vale(self):
        u = _user()
        revogar_sessoes(u)
        # Login logo em seguida (mesmo segundo) precisa funcionar.
        payload = decode_token(create_access_token(u.id))
        assert not sessao_revogada(u, payload)


class TestCurrentUser:
    def _db(self, user):
        res = MagicMock()
        res.scalar_one_or_none = MagicMock(return_value=user)
        db = AsyncMock()
        db.execute = AsyncMock(return_value=res)
        return db

    def test_token_revogado_da_401(self):
        from app.deps import current_user

        uid = "00000000-0000-0000-0000-0000000000aa"
        token = create_access_token(uid)
        user = _user(datetime.now(UTC) + timedelta(seconds=2))
        with pytest.raises(HTTPException) as exc:
            asyncio.run(current_user(token, self._db(user)))
        assert exc.value.status_code == 401

    def test_token_valido_passa(self):
        from app.deps import current_user

        uid = "00000000-0000-0000-0000-0000000000aa"
        user = _user(None)
        assert asyncio.run(current_user(create_access_token(uid), self._db(user))) is user
