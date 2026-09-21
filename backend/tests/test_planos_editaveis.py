"""
Planos editáveis pelo painel admin.

Os defaults continuam no código (services/plans.py) e o admin sobrescreve campo
a campo em app_config. Isso importa: um plano novo adicionado no código aparece
mesmo sem ninguém reconfigurar, e limpar um campo volta ao padrão em vez de
gravar vazio.
"""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _limpa_ajustes():
    """Cada teste começa sem ajuste — o cache é global no módulo."""
    from app.services.plans import aplicar_ajustes
    aplicar_ajustes({})
    yield
    aplicar_ajustes({})


class TestSemAjustes:
    def test_usa_os_defaults_do_codigo(self):
        from app.services.plans import plan_price, plans_catalog

        assert plan_price("basico") == 97.0
        assert [p["id"] for p in plans_catalog()] == ["basico", "pro", "premium"]

    def test_trial_fora_do_catalogo_de_venda(self):
        from app.services.plans import plans_catalog, plans_editaveis

        assert "trial" not in [p["id"] for p in plans_catalog()]
        # ...mas aparece na tela de edição do admin.
        assert "trial" in [p["id"] for p in plans_editaveis()]


class TestComAjustes:
    def test_preco_do_admin_vale(self):
        from app.services.plans import aplicar_ajustes, plan_price

        aplicar_ajustes({"pro": {"preco_mensal": 249.0}})
        assert plan_price("pro") == 249.0
        assert plan_price("basico") == 97.0  # os outros seguem no default

    def test_limite_do_admin_vale(self):
        from app.services.plans import aplicar_ajustes, plan_info

        aplicar_ajustes({"basico": {"limites": {"conversas_mes": 250}}})
        info = plan_info("basico")
        assert info["limites"]["conversas_mes"] == 250
        # Limite não citado mantém o default.
        assert info["limites"]["produtos"] == 30

    def test_nome_e_descricao(self):
        from app.services.plans import aplicar_ajustes, plan_info

        aplicar_ajustes({"premium": {"nome": "Black", "descricao": "Tudo liberado"}})
        info = plan_info("premium")
        assert info["nome"] == "Black"
        assert info["descricao"] == "Tudo liberado"

    def test_ajuste_nao_contamina_o_default(self):
        """O merge não pode mutar PLANS — senão o 'voltar ao padrão' some."""
        from app.services.plans import PLANS, aplicar_ajustes, plan_info

        aplicar_ajustes({"pro": {"preco_mensal": 999.0, "limites": {"produtos": 9999}}})
        assert plan_info("pro")["preco_mensal"] == 999.0

        aplicar_ajustes({})
        assert plan_info("pro")["preco_mensal"] == 197.0
        assert PLANS["pro"]["limites"]["produtos"] == 100

    def test_plano_desconhecido_cai_no_basico(self):
        from app.services.plans import aplicar_ajustes, plan_info

        aplicar_ajustes({"basico": {"nome": "Inicial"}})
        assert plan_info("inexistente")["nome"] == "Inicial"
        assert plan_info(None)["id"] == "basico"

    def test_ajuste_de_plano_que_nao_existe_e_ignorado(self):
        from app.services.plans import aplicar_ajustes, plans_catalog

        aplicar_ajustes({"plano_fantasma": {"preco_mensal": 1.0}})
        assert "plano_fantasma" not in [p["id"] for p in plans_catalog()]

    def test_ordem_do_catalogo_nao_muda_com_preco(self):
        """Reordenar quebraria a leitura da tela; ordem vem do código."""
        from app.services.plans import aplicar_ajustes, plans_catalog

        aplicar_ajustes({"basico": {"preco_mensal": 999.0}})
        assert [p["id"] for p in plans_catalog()] == ["basico", "pro", "premium"]
