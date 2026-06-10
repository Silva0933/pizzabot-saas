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


def _roda_dunning(monkeypatch, pizzarias, ja_alertado=False):
    """Executa _verificar_assinaturas_async com DB e alertas mockados."""
    import app.db as app_db
    import app.services.alertas as alertas_mod
    from app.workers import periodic

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
        assert out == {"ok": True, "avisos": 0, "suspensas": 0}
        alerta.assert_not_awaited()

    def test_nao_duplica_alerta_no_mesmo_dia(self, monkeypatch):
        p = _pizzaria(vence_delta_dias=1)
        out, alerta, _ = _roda_dunning(monkeypatch, [p], ja_alertado=True)
        assert out["avisos"] == 0
        alerta.assert_not_awaited()
