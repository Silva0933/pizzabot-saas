"""
Bloqueio de pizzaria SUSPENSA (inadimplência ou trial vencido).

Antes a suspensão só era checada no bot, no webhook do WhatsApp e no cardápio
público. O painel e a API seguiam abertos: bastava não pagar para continuar
operando pedidos, cardápio e equipe. Estes testes travam o bloqueio e, tão
importante quanto, travam as EXCEÇÕES — sem elas a pizzaria inadimplente não
conseguiria nem ver o próprio estado nem pagar para voltar.
"""
from __future__ import annotations

import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException


def _request(caminho: str, metodo: str = "GET"):
    r = MagicMock()
    r.url.path = caminho
    r.method = metodo
    return r


def _usuario(admin: bool = False):
    u = MagicMock()
    u.id = uuid.uuid4()
    u.email = "dono@pizzaria.com"
    u.is_platform_admin = admin
    return u


class _Res:
    def __init__(self, valor=None):
        self._valor = valor

    def scalar_one_or_none(self):
        return self._valor

    def first(self):
        return self._valor


def _db(vinculo, suspensa: bool | None, motivo: str | None = None):
    """Primeiro execute() devolve o vínculo; o segundo, o estado de suspensão."""
    resultados = [_Res(vinculo)]
    if suspensa is not None:
        resultados.append(_Res((suspensa, motivo)))
    db = MagicMock()

    async def execute(*_a, **_k):
        return resultados.pop(0) if resultados else _Res(None)

    db.execute = execute
    return db


# ============================================================
# Quais rotas seguem abertas com a assinatura suspensa
# ============================================================
class TestRotasLiberadas:
    def test_assinatura_e_fatura_continuam_abertas(self):
        from app.deps import _liberada_com_suspensao

        pid = str(uuid.uuid4())
        assert _liberada_com_suspensao(_request(f"/pizzarias/{pid}/assinatura"))
        assert _liberada_com_suspensao(_request(f"/pizzarias/{pid}/assinatura", "POST"))
        assert _liberada_com_suspensao(
            _request(f"/pizzarias/{pid}/assinatura/fatura/{uuid.uuid4()}/pix")
        )

    def test_ler_o_proprio_cadastro_continua_aberto(self):
        """O painel precisa disso pra saber que está suspensa e mostrar o aviso."""
        from app.deps import _liberada_com_suspensao

        pid = str(uuid.uuid4())
        assert _liberada_com_suspensao(_request(f"/pizzarias/{pid}"))
        assert _liberada_com_suspensao(_request(f"/pizzarias/{pid}/uso"))

    def test_operacao_nao_e_liberada(self):
        from app.deps import _liberada_com_suspensao

        pid = str(uuid.uuid4())
        assert not _liberada_com_suspensao(_request(f"/pizzarias/{pid}", "PATCH"))
        assert not _liberada_com_suspensao(_request(f"/pedidos/{pid}"))
        assert not _liberada_com_suspensao(_request(f"/cardapio/{pid}/produtos", "POST"))
        assert not _liberada_com_suspensao(_request(f"/agente/{pid}/testar", "POST"))


# ============================================================
# membership()
# ============================================================
class TestMembership:
    def test_suspensa_bloqueia_operacao_com_402(self):
        from app.deps import membership

        pid = uuid.uuid4()
        db = _db(MagicMock(), suspensa=True, motivo="inadimplencia")
        with pytest.raises(HTTPException) as e:
            asyncio.run(membership(pid, _request(f"/pedidos/{pid}"), _usuario(), db))

        assert e.value.status_code == 402  # Payment Required, não 403
        assert e.value.detail["erro"] == "pizzaria_suspensa"
        assert e.value.detail["motivo"] == "inadimplencia"

    def test_trial_vencido_tambem_bloqueia(self):
        from app.deps import membership

        pid = uuid.uuid4()
        db = _db(MagicMock(), suspensa=True, motivo="trial_expirado")
        with pytest.raises(HTTPException) as e:
            asyncio.run(membership(pid, _request(f"/pedidos/{pid}"), _usuario(), db))
        assert e.value.status_code == 402
        assert e.value.detail["motivo"] == "trial_expirado"

    def test_suspensa_ainda_consegue_pagar(self):
        """A rota de assinatura NÃO pode ser bloqueada — é a saída da suspensão."""
        from app.deps import membership

        pid = uuid.uuid4()
        vinculo = MagicMock()
        db = _db(vinculo, suspensa=None)  # nem chega a consultar a suspensão
        assert asyncio.run(
            membership(pid, _request(f"/pizzarias/{pid}/assinatura", "POST"), _usuario(), db)
        ) is vinculo

    def test_ativa_passa_normalmente(self):
        from app.deps import membership

        pid = uuid.uuid4()
        vinculo = MagicMock()
        db = _db(vinculo, suspensa=False)
        assert asyncio.run(
            membership(pid, _request(f"/pedidos/{pid}"), _usuario(), db)
        ) is vinculo

    def test_sem_vinculo_continua_403(self):
        from app.deps import membership

        pid = uuid.uuid4()
        db = _db(None, suspensa=None)
        with pytest.raises(HTTPException) as e:
            asyncio.run(membership(pid, _request(f"/pedidos/{pid}"), _usuario(), db))
        assert e.value.status_code == 403

    def test_admin_da_plataforma_passa_mesmo_suspensa(self):
        """Suporte precisa entrar na pizzaria justamente quando ela está suspensa."""
        from app.deps import membership

        pid = uuid.uuid4()
        db = _db(None, suspensa=True)
        link = asyncio.run(membership(pid, _request(f"/pedidos/{pid}"), _usuario(admin=True), db))
        assert link.role == "admin"
