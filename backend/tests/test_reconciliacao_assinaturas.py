"""
Testes da reconciliação de assinaturas órfãs no Asaas.

Esta task CANCELA assinaturas sozinha, numa conta Asaas que também é usada para
outras coisas. O que estes testes travam é justamente o que ela NÃO pode fazer:

  - só mexe em assinatura cujo externalReference é "{uuid}|{plano}" criado por nós;
  - nunca toca em assinatura sem referência ou com referência de outro sistema;
  - não cancela se a pizzaria ainda existe;
  - aborta se o banco não devolver pizzaria nenhuma (sintoma de leitura quebrada);
  - aborta se o volume de órfãs passar do teto (volume de bug, não de operação);
  - não faz nada se o gateway não estiver configurado.
"""
from __future__ import annotations

import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest


# ============================================
# Dublês
# ============================================
class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeDB:
    def __init__(self, ids):
        self.ids = ids
        self.commits = 0

    async def execute(self, *a, **k):
        return _FakeResult([(i,) for i in self.ids])

    async def commit(self):
        self.commits += 1


class _FakeSessionMaker:
    def __init__(self, db):
        self.db = db

    def __call__(self):
        return self

    async def __aenter__(self):
        return self.db

    async def __aexit__(self, *a):
        return False


def _assinatura(sub_id: str, ref: str | None, valor: float = 97.0) -> dict:
    return {
        "id": sub_id,
        "externalReference": ref,
        "value": valor,
        "cycle": "MONTHLY",
        "nextDueDate": "2026-11-12",
        "status": "ACTIVE",
    }


@pytest.fixture
def cenario(monkeypatch):
    """Monta o ambiente: Asaas dublê, banco dublê e alertas mudos.

    Devolve uma função `rodar(assinaturas, ids_no_banco)` que executa a task e
    entrega o resultado junto com o mock de cancelamento, para inspeção.
    """
    import app.db as db_mod
    import app.services.alertas as alertas_mod
    import app.services.billing_plataforma as billing_mod
    from app.workers.periodic import _reconciliar_assinaturas_asaas_async

    def rodar(assinaturas, ids_no_banco, *, configurado=True, erro_ao_cancelar=None):
        cancelar = AsyncMock(side_effect=erro_ao_cancelar)
        cliente = MagicMock()
        cliente.listar_assinaturas = AsyncMock(return_value=assinaturas)
        cliente.cancelar_assinatura = cancelar
        carregar = AsyncMock()

        monkeypatch.setattr(billing_mod, "billing_configurado", lambda: configurado)
        monkeypatch.setattr(billing_mod, "carregar_config", carregar)
        monkeypatch.setattr(billing_mod, "PlatformAsaasClient", lambda *a, **k: cliente)
        monkeypatch.setattr(alertas_mod, "registrar_alerta", AsyncMock())
        monkeypatch.setattr(db_mod, "AsyncSessionLocal", _FakeSessionMaker(_FakeDB(ids_no_banco)))

        resultado = asyncio.run(_reconciliar_assinaturas_asaas_async())
        rodar.carregar_config = carregar
        return resultado, cancelar

    return rodar


# ============================================
# O que ela DEVE fazer
# ============================================
class TestCancelaOrfa:
    def test_cancela_assinatura_de_pizzaria_que_nao_existe_mais(self, cenario):
        morta, viva = str(uuid.uuid4()), str(uuid.uuid4())
        resultado, cancelar = cenario(
            [_assinatura("sub_orfa", f"{morta}|basico")],
            ids_no_banco=[viva],
        )
        cancelar.assert_awaited_once_with("sub_orfa")
        assert resultado["orfas"] == 1
        assert resultado["canceladas"] == ["sub_orfa"]

    def test_falha_no_cancelamento_vira_registro_e_nao_derruba_a_rodada(self, cenario):
        """Asaas recusando não pode abortar tudo: a órfã entra em `falhas` para o
        admin cancelar na mão, e as demais seguem sendo processadas."""
        from app.services.billing_plataforma import BillingError

        morta_a, morta_b = str(uuid.uuid4()), str(uuid.uuid4())
        resultado, cancelar = cenario(
            [_assinatura("sub_a", f"{morta_a}|pro"), _assinatura("sub_b", f"{morta_b}|basico")],
            ids_no_banco=[str(uuid.uuid4())],
            erro_ao_cancelar=BillingError("Asaas DELETE /subscriptions/sub_a 500: indisponível"),
        )
        assert resultado["ok"] is True
        assert resultado["canceladas"] == []
        assert resultado["falhas"] == ["sub_a", "sub_b"]
        assert cancelar.await_count == 2  # tentou as duas, não parou na primeira


# ============================================
# O que ela NUNCA pode fazer
# ============================================
class TestNaoTocaNoQueNaoEhNosso:
    def test_preserva_assinatura_de_pizzaria_viva(self, cenario):
        viva = str(uuid.uuid4())
        resultado, cancelar = cenario(
            [_assinatura("sub_viva", f"{viva}|basico")], ids_no_banco=[viva]
        )
        cancelar.assert_not_awaited()
        assert resultado["orfas"] == 0

    def test_ignora_assinatura_sem_referencia_externa(self, cenario):
        """Assinatura criada à mão no painel do Asaas — não é nossa."""
        resultado, cancelar = cenario(
            [_assinatura("sub_manual", None)], ids_no_banco=[str(uuid.uuid4())]
        )
        cancelar.assert_not_awaited()
        assert resultado["orfas"] == 0

    def test_ignora_referencia_de_outro_sistema(self, cenario):
        """externalReference que não é UUID nosso: outro produto na mesma conta."""
        resultado, cancelar = cenario(
            [_assinatura("sub_outro", "pedido-4521|mensal")], ids_no_banco=[str(uuid.uuid4())]
        )
        cancelar.assert_not_awaited()
        assert resultado["orfas"] == 0


# ============================================
# Travas de segurança
# ============================================
class TestTravas:
    def test_aborta_quando_o_banco_nao_devolve_pizzaria_nenhuma(self, cenario):
        """Banco vazio + assinaturas ativas = leitura quebrada, não realidade."""
        resultado, cancelar = cenario(
            [_assinatura("sub_a", f"{uuid.uuid4()}|basico")], ids_no_banco=[]
        )
        cancelar.assert_not_awaited()
        assert resultado["ok"] is False
        assert "abortada" in resultado["motivo"]

    def test_aborta_acima_do_teto_de_orfas(self, cenario, monkeypatch):
        import app.workers.periodic as periodic_mod

        monkeypatch.setattr(periodic_mod, "_RECON_MAX", 2)
        muitas = [_assinatura(f"sub_{i}", f"{uuid.uuid4()}|basico") for i in range(5)]
        resultado, cancelar = cenario(muitas, ids_no_banco=[str(uuid.uuid4())])
        cancelar.assert_not_awaited()
        assert resultado["acao"] == "abortado"
        assert resultado["orfas"] == 5

    def test_sem_gateway_configurado_nao_faz_nada(self, cenario):
        resultado, cancelar = cenario([], ids_no_banco=[], configurado=False)
        cancelar.assert_not_awaited()
        assert resultado["ok"] is False
        assert "não configurado" in resultado["motivo"]

    def test_recarrega_a_config_do_banco_antes_de_checar_o_gateway(self, cenario):
        """Regressao: cada processo tem o seu cache de config, e so o app/main.py
        (que roda apenas na API) o preenche no startup. Sem recarregar do banco
        aqui, o worker cai no fallback de ambiente — que pode nao ter a chave — e
        a task sai calada toda noite sem nunca reconciliar nada."""
        resultado, _ = cenario(
            [_assinatura("sub_orfa", f"{uuid.uuid4()}|basico")], ids_no_banco=[str(uuid.uuid4())]
        )
        cenario.carregar_config.assert_awaited_once()

    def test_modo_so_alerta_nao_cancela(self, cenario, monkeypatch):
        import app.workers.periodic as periodic_mod

        monkeypatch.setattr(periodic_mod, "_RECON_CANCELAR", False)
        resultado, cancelar = cenario(
            [_assinatura("sub_orfa", f"{uuid.uuid4()}|basico")], ids_no_banco=[str(uuid.uuid4())]
        )
        cancelar.assert_not_awaited()
        assert resultado["orfas"] == 1
        assert resultado["canceladas"] == []
