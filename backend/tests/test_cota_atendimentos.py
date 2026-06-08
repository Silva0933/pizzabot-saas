"""
Testes da cota de ATENDIMENTOS por plano (1 conversa/cliente por mês).

Travam:
  - os novos limites dos planos (100 / 300 / 500);
  - a contagem de atendimentos do mês (conversas distintas com resposta do bot);
  - o teste de 'conversa já atendida' (não bloqueia/reconta conversa em andamento).
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest


class TestLimitesDosPlanos:
    def test_novos_limites(self):
        from app.services.plans import plan_info
        assert plan_info("basico")["limites"]["conversas_mes"] == 100
        assert plan_info("pro")["limites"]["conversas_mes"] == 300
        assert plan_info("premium")["limites"]["conversas_mes"] == 500

    def test_desconhecido_cai_no_basico(self):
        from app.services.plans import plan_info
        assert plan_info("xpto")["limites"]["conversas_mes"] == 100


class TestContagemAtendimentos:
    def test_conversas_atendidas_mes_retorna_inteiro(self):
        from app.services import app_config
        res = MagicMock()
        res.first.return_value = (42,)
        db = MagicMock()
        db.execute = AsyncMock(return_value=res)
        n = asyncio.run(app_config.conversas_atendidas_mes(db, "pid-1"))
        assert n == 42

    def test_conversas_atendidas_mes_zero_quando_vazio(self):
        from app.services import app_config
        res = MagicMock()
        res.first.return_value = None
        db = MagicMock()
        db.execute = AsyncMock(return_value=res)
        n = asyncio.run(app_config.conversas_atendidas_mes(db, "pid-1"))
        assert n == 0

    def test_conversa_ja_atendida_true(self):
        from app.services import app_config
        res = MagicMock()
        res.first.return_value = (1,)
        db = MagicMock()
        db.execute = AsyncMock(return_value=res)
        assert asyncio.run(app_config.conversa_ja_atendida_mes(db, "pid", "conv-1")) is True

    def test_conversa_ja_atendida_false(self):
        from app.services import app_config
        res = MagicMock()
        res.first.return_value = None
        db = MagicMock()
        db.execute = AsyncMock(return_value=res)
        assert asyncio.run(app_config.conversa_ja_atendida_mes(db, "pid", "conv-1")) is False

    def test_todas_mapeia_pizzaria_para_contagem(self):
        from app.services import app_config
        res = MagicMock()
        res.fetchall.return_value = [("pid-a", 10), ("pid-b", 3)]
        db = MagicMock()
        db.execute = AsyncMock(return_value=res)
        out = asyncio.run(app_config.conversas_atendidas_mes_todas(db))
        assert out == {"pid-a": 10, "pid-b": 3}
