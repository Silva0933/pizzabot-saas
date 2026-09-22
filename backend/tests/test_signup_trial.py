"""
Testes do trial + dunning (suspensão automática).

Travam:
  - a duração do trial (14 dias) e o schema do signup;
  - o dunning diário (workers/periodic.verificar_assinaturas):
      trial expirado → suspensa (motivo trial_expirado);
      vencida além da carência → suspensa (motivo inadimplencia);
      vence em D-1 → alerta sem suspender;
      em dia → não mexe.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest


class TestSignupSchema:
    def test_trial_dias(self):
        from app.routes.auth import TRIAL_DIAS
        assert TRIAL_DIAS == 14

    def test_signup_valida_campos(self):
        from app.routes.auth import SignupIn
        s = SignupIn(nome_pizzaria="Pizza X", email="a@b.com", senha="12345678")
        assert s.nome_pizzaria == "Pizza X"
        with pytest.raises(Exception):
            SignupIn(nome_pizzaria="P", email="a@b.com", senha="12345678")  # nome curto
        with pytest.raises(Exception):
            SignupIn(nome_pizzaria="Pizza X", email="a@b.com", senha="123")  # senha curta


# ============================================
# Dunning (verificar_assinaturas)
# ============================================
def _pizzaria(plano="pro", vence_delta_dias=None, trial_delta_dias=None):
    p = MagicMock()
    p.id = "pid-1"
    p.nome = "Pizza Teste"
    p.plano = plano
    p.suspensa = False
    p.suspensa_motivo = None
    agora = datetime.now(timezone.utc)
    p.plano_vence_em = (
        agora + timedelta(days=vence_delta_dias) if vence_delta_dias is not None else None
    )
    p.trial_fim = (
        agora + timedelta(days=trial_delta_dias) if trial_delta_dias is not None else None
    )
    return p


def _roda_dunning(monkeypatch, pizzarias, ja_alertado=False, billing_ok=True):
    """Executa _verificar_assinaturas_async com DB e alertas mockados.

    `billing_ok` espelha ASAAS_PLATFORM_API_KEY estar configurada: sem gateway a
    suspensao automatica fica DESLIGADA de proposito (ninguem conseguiria pagar
    pra sair dela).
    """
    import app.db as app_db
    import app.services.alertas as alertas_mod
    import app.services.billing_plataforma as billing_mod
    from app.workers import periodic

    monkeypatch.setattr(billing_mod, "billing_configurado", lambda: billing_ok)

    res = MagicMock()
    res.scalars.return_value.all.return_value = pizzarias
    db = MagicMock()
    db.execute = AsyncMock(return_value=res)
    db.commit = AsyncMock()

    class _Ctx:
        async def __aenter__(self):
            return db
        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(app_db, "AsyncSessionLocal", lambda: _Ctx())
    monkeypatch.setattr(app_db, "engine", MagicMock(dispose=AsyncMock()))
    alerta = AsyncMock()
    monkeypatch.setattr(alertas_mod, "registrar_alerta", alerta)
    monkeypatch.setattr(periodic, "_ja_alertado_hoje", AsyncMock(return_value=ja_alertado))

    out = asyncio.run(periodic._verificar_assinaturas_async())
    return out, alerta, db


class TestDunning:
    def test_trial_expirado_suspende(self, monkeypatch):
        p = _pizzaria(plano="trial", trial_delta_dias=-1)
        out, alerta, _ = _roda_dunning(monkeypatch, [p])
        assert out["ok"] is True and out["suspensas"] == 1
        assert p.suspensa is True
        assert p.suspensa_motivo == "trial_expirado"
        alerta.assert_awaited_once()

    def test_trial_vigente_nao_suspende(self, monkeypatch):
        p = _pizzaria(plano="trial", trial_delta_dias=5)
        out, alerta, _ = _roda_dunning(monkeypatch, [p])
        assert out["suspensas"] == 0
        assert p.suspensa is False
        alerta.assert_not_awaited()

    def test_inadimplente_alem_da_carencia_suspende(self, monkeypatch):
        from app.services.billing_plataforma import GRACE_DAYS
        p = _pizzaria(vence_delta_dias=-(GRACE_DAYS + 1))
        out, alerta, _ = _roda_dunning(monkeypatch, [p])
        assert out["suspensas"] == 1
        assert p.suspensa is True
        assert p.suspensa_motivo == "inadimplencia"

    def test_vencida_dentro_da_carencia_so_alerta(self, monkeypatch):
        p = _pizzaria(vence_delta_dias=-2)  # vencida há 2 dias (carência = 5)
        out, alerta, _ = _roda_dunning(monkeypatch, [p])
        assert out["suspensas"] == 0
        assert p.suspensa is False
        assert out["avisos"] == 1
        alerta.assert_awaited_once()

    def test_vence_amanha_alerta_sem_suspender(self, monkeypatch):
        p = _pizzaria(vence_delta_dias=1)
        out, alerta, _ = _roda_dunning(monkeypatch, [p])
        assert out["suspensas"] == 0
        assert out["avisos"] == 1
        assert p.suspensa is False

    def test_em_dia_nao_alerta(self, monkeypatch):
        p = _pizzaria(vence_delta_dias=20)
        out, alerta, _ = _roda_dunning(monkeypatch, [p])
        assert out["ok"] is True and out["avisos"] == 0 and out["suspensas"] == 0
        alerta.assert_not_awaited()

    def test_sem_gateway_nao_suspende_ninguem(self, monkeypatch):
        """Sem ASAAS_PLATFORM_API_KEY ninguem consegue pagar.

        Suspender nesse estado trancaria todas as pizzarias para fora sem saida,
        inclusive as que queriam pagar. Entao a suspensao fica desligada e o
        operador e alertado.
        """
        from app.services.billing_plataforma import GRACE_DAYS

        trial = _pizzaria(plano="trial", trial_delta_dias=-1)
        devedora = _pizzaria(vence_delta_dias=-(GRACE_DAYS + 1))
        out, alerta, _ = _roda_dunning(monkeypatch, [trial, devedora], billing_ok=False)

        assert out["suspensas"] == 0
        assert trial.suspensa is False
        assert devedora.suspensa is False
        assert out["pode_suspender"] is False
        tipos = [c.kwargs.get("tipo") for c in alerta.await_args_list]
        assert "billing_nao_configurado" in tipos

    def test_nao_duplica_alerta_no_mesmo_dia(self, monkeypatch):
        p = _pizzaria(vence_delta_dias=1)
        out, alerta, _ = _roda_dunning(monkeypatch, [p], ja_alertado=True)
        assert out["avisos"] == 0
        alerta.assert_not_awaited()


class TestSlugNoCadastro:
    """
    O cadastro publico criava a pizzaria sem slug. Como o cardapio digital vive
    em /m/<slug>, toda pizzaria que entrou por ali nascia SEM cardapio — a rota
    devolvia 404 e so funcionava quem tinha sido criada pelo admin.
    """

    def test_slugify_troca_acento_pela_letra_base(self):
        from app.routes.pizzarias import _slugify

        # Antes virava "pizzaria-a-a": endereco que ninguem digita.
        assert _slugify("Pizzaria Açaí") == "pizzaria-acai"
        assert _slugify("Forno & Lenha") == "forno-lenha"
        assert _slugify("  São João  ") == "sao-joao"
        assert _slugify("Pizzaria   do   Zé") == "pizzaria-do-ze"

    def test_slugify_nunca_devolve_vazio(self):
        from app.routes.pizzarias import _slugify

        assert _slugify("") == "pizzaria"
        assert _slugify("!!!") == "pizzaria"
        assert _slugify(None) == "pizzaria"

    def test_slug_unico_usa_o_nome_quando_esta_livre(self):
        import uuid as _uuid
        from unittest.mock import AsyncMock, MagicMock

        from app.routes.pizzarias import slug_unico

        res = MagicMock()
        res.scalar_one_or_none.return_value = None  # ninguem usa
        db = MagicMock()
        db.execute = AsyncMock(return_value=res)

        assert asyncio.run(slug_unico(db, "Fornalha Burger", _uuid.uuid4())) == "fornalha-burger"

    def test_slug_unico_acrescenta_sufixo_quando_ocupado(self):
        import uuid as _uuid
        from unittest.mock import AsyncMock, MagicMock

        from app.routes.pizzarias import slug_unico

        ocupado, livre = MagicMock(), MagicMock()
        ocupado.scalar_one_or_none.return_value = _uuid.uuid4()
        livre.scalar_one_or_none.return_value = None
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[ocupado, livre])

        assert asyncio.run(slug_unico(db, "Fornalha", _uuid.uuid4())) == "fornalha-1"


class TestBackfillSlug:
    """Conserta quem ja nasceu sem slug (e por isso sem cardapio digital)."""

    def _db(self, pizzarias, livres=True):
        from unittest.mock import AsyncMock, MagicMock

        lista = MagicMock()
        lista.scalars.return_value.all.return_value = pizzarias
        checagem = MagicMock()
        checagem.scalar_one_or_none.return_value = None if livres else uuid.uuid4()

        db = MagicMock()
        chamadas = {"n": 0}

        async def execute(*_a, **_k):
            chamadas["n"] += 1
            return lista if chamadas["n"] == 1 else checagem

        db.execute = execute
        db.flush = AsyncMock()
        db.commit = AsyncMock()
        return db

    def _rodar(self, monkeypatch, db):
        import app.db as app_db
        from app.services import backfill_slug

        class _Ctx:
            async def __aenter__(self):
                return db
            async def __aexit__(self, *a):
                return False

        monkeypatch.setattr(app_db, "AsyncSessionLocal", lambda: _Ctx())
        return asyncio.run(backfill_slug.preencher_slugs_faltantes())

    def test_preenche_quem_esta_sem(self, monkeypatch):
        p = MagicMock()
        p.id, p.nome, p.slug = uuid.uuid4(), "Pizzaria do Zé", None
        assert self._rodar(monkeypatch, self._db([p])) == 1
        assert p.slug == "pizzaria-do-ze"

    def test_nao_faz_nada_quando_todos_tem_slug(self, monkeypatch):
        db = self._db([])
        assert self._rodar(monkeypatch, db) == 0
        db.commit.assert_not_awaited()

    def test_string_vazia_conta_como_sem_slug(self, monkeypatch):
        p = MagicMock()
        p.id, p.nome, p.slug = uuid.uuid4(), "Forno & Lenha", ""
        assert self._rodar(monkeypatch, self._db([p])) == 1
        assert p.slug == "forno-lenha"
