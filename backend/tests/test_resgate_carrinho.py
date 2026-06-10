"""
Testes do resgate de carrinho abandonado (workers/tasks.resgatar_carrinho).

Travam as guardas que impedem spam/interferência:
  - só resgata no meio do funil com itens no carrinho;
  - no máximo 1 resgate por conversa (flag resgate_enviado);
  - conversa que mexeu há pouco (cliente voltou sozinho) não recebe resgate;
  - humano assumiu → não interfere;
  - caminho feliz: envia, marca a flag e persiste a mensagem.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest


def _setup(monkeypatch, *, estado, updated_age_s=None, conv=None, pizz="default"):
    """Mocka sessão, estado, evolution e broadcaster; retorna (run, mocks)."""
    import app.db as app_db
    import app.services.broadcaster as broadcaster_mod
    import app.services.conversation_state as cs
    import app.services.evolution as evo_mod
    from app.workers import tasks

    db = MagicMock()
    db.add = MagicMock()
    db.commit = AsyncMock()

    # db.execute responde em sequência: updated_at → conversa → pizzaria.
    resultados = []

    if estado and estado.get("etapa") in tasks._ETAPAS_RESGATE and estado.get("carrinho") \
            and not estado.get("resgate_enviado"):
        res_updated = MagicMock()
        age = updated_age_s if updated_age_s is not None else tasks.RESGATE_CARRINHO_SECONDS + 60
        res_updated.first.return_value = (datetime.now(timezone.utc) - timedelta(seconds=age),)
        resultados.append(res_updated)

        res_conv = MagicMock()
        res_conv.scalar_one_or_none.return_value = conv
        resultados.append(res_conv)

        if pizz == "default":
            pizz = MagicMock()
            pizz.instancia = "inst-1"
            pizz.suspensa = False
        res_pizz = MagicMock()
        res_pizz.scalar_one_or_none.return_value = pizz
        resultados.append(res_pizz)

    db.execute = AsyncMock(side_effect=resultados or [MagicMock()])

    class _Ctx:
        async def __aenter__(self):
            return db
        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(app_db, "AsyncSessionLocal", lambda: _Ctx())
    monkeypatch.setattr(app_db, "engine", MagicMock(dispose=AsyncMock()))
    monkeypatch.setattr(cs, "load_state", AsyncMock(return_value=estado))
    monkeypatch.setattr(cs, "save_state", AsyncMock())

    evolution = MagicMock()
    evolution.send_text = AsyncMock(return_value={"ok": True})
    evolution.close = AsyncMock()
    monkeypatch.setattr(evo_mod, "evolution", evolution)
    monkeypatch.setattr(broadcaster_mod.broadcaster, "publish", AsyncMock())

    def run():
        return asyncio.run(tasks._resgatar_carrinho_async(uuid.uuid4(), "5511999990000"))

    return run, {"db": db, "evolution": evolution, "save_state": cs.save_state}


_ESTADO_FUNIL = {"etapa": "ENTREGA", "carrinho": [{"nome": "Calabresa", "qtd": 1}]}


class TestGuardas:
    def test_fora_do_funil_nao_envia(self, monkeypatch):
        run, m = _setup(monkeypatch, estado={"etapa": "FINALIZADO", "carrinho": [{"x": 1}]})
        assert run() == {"ok": False, "motivo": "fora_do_funil"}
        m["evolution"].send_text.assert_not_awaited()

    def test_carrinho_vazio_nao_envia(self, monkeypatch):
        run, m = _setup(monkeypatch, estado={"etapa": "COLETA_ITENS", "carrinho": []})
        assert run() == {"ok": False, "motivo": "fora_do_funil"}

    def test_apenas_um_resgate_por_conversa(self, monkeypatch):
        run, m = _setup(monkeypatch, estado={**_ESTADO_FUNIL, "resgate_enviado": True})
        assert run() == {"ok": False, "motivo": "ja_resgatado"}
        m["evolution"].send_text.assert_not_awaited()

    def test_conversa_ativa_recente_nao_envia(self, monkeypatch):
        # Cliente mexeu há 1 min (um novo resgate foi reagendado) → este task antigo cala.
        run, m = _setup(monkeypatch, estado=dict(_ESTADO_FUNIL), updated_age_s=60)
        assert run() == {"ok": False, "motivo": "conversa_ativa"}
        m["evolution"].send_text.assert_not_awaited()

    def test_humano_assumiu_nao_interfere(self, monkeypatch):
        conv = MagicMock()
        conv.bot_ativo = False
        run, m = _setup(monkeypatch, estado=dict(_ESTADO_FUNIL), conv=conv)
        assert run() == {"ok": False, "motivo": "humano_assumiu"}
        m["evolution"].send_text.assert_not_awaited()

    def test_pizzaria_sem_instancia_nao_envia(self, monkeypatch):
        pizz = MagicMock()
        pizz.instancia = None
        pizz.suspensa = False
        run, m = _setup(monkeypatch, estado=dict(_ESTADO_FUNIL), pizz=pizz)
        assert run() == {"ok": False, "motivo": "pizzaria_indisponivel"}


class TestCaminhoFeliz:
    def test_envia_marca_flag_e_persiste(self, monkeypatch):
        conv = MagicMock()
        conv.bot_ativo = True
        conv.id = uuid.uuid4()
        estado = dict(_ESTADO_FUNIL)
        run, m = _setup(monkeypatch, estado=estado, conv=conv)

        out = run()
        assert out == {"ok": True}
        m["evolution"].send_text.assert_awaited_once()
        # Flag marcada e estado salvo (não resgata 2x).
        assert estado["resgate_enviado"] is True
        m["save_state"].assert_awaited_once()
        # Mensagem persistida no histórico do painel.
        m["db"].add.assert_called_once()
        m["db"].commit.assert_awaited()
