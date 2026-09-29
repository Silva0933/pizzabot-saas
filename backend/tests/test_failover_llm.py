"""
Failover de LLM no FSM.

Antes: a voz e a NLU livre engoliam qualquer erro do provedor (devolviam "" /
'duvida_geral'), e o com_failover — que só troca para o reserva ao receber
exceção — nunca era acionado. Com o provedor principal fora, TODA resposta era
"Pode repetir, por favor?". E um soluço de rede na tentativa com json_schema
marcava o modelo como "sem suporte" até o container reiniciar.
"""
from __future__ import annotations

import asyncio
from unittest.mock import patch

import httpx


class TestErroDeSuporte:
    def test_formato_recusado_e_suporte(self):
        from app.agent.providers import erro_de_suporte
        assert erro_de_suporte(RuntimeError("openrouter 400: response_format json_schema is not supported"))
        assert erro_de_suporte(RuntimeError("json mode unsupported"))

    def test_passageiros_nao_sao_suporte(self):
        from app.agent.providers import erro_de_suporte
        assert not erro_de_suporte(httpx.ConnectTimeout("timeout"))
        assert not erro_de_suporte(httpx.ConnectError("sem rede"))
        assert not erro_de_suporte(RuntimeError("openrouter 503: json_schema temporarily unavailable"))
        assert not erro_de_suporte(RuntimeError("openrouter 429: rate limit"))
        assert not erro_de_suporte(RuntimeError("openrouter 400: invalid api key"))


def _cfg():
    return {"provider": "openrouter", "keys": {"openrouter": "k1", "openai": "k2"},
            "fallback_provider": "openai", "fallback_model": "reserva"}


class TestVozComFailover:
    def test_provedor_fora_usa_o_reserva(self):
        from app.agent.failover import com_failover
        from app.agent.fsm import voice

        async def fake_chat(**kw):
            if kw["provider"] == "openrouter":
                raise httpx.ConnectTimeout("primario fora")
            return {"content": "Anotado! Vai ser entrega ou retirada?", "usage": {}}

        async def _voz(prov, key, mdl):
            return await voice.gerar_voz(provider=prov, api_key=key, model=mdl, comando="x")

        with patch("app.agent.providers.openai_chat", new=fake_chat):
            (texto, _), prov, mdl = asyncio.run(com_failover(_voz, cfg=_cfg(), model="principal"))
        assert texto == "Anotado! Vai ser entrega ou retirada?"
        assert (prov, mdl) == ("openai", "reserva")


class TestNluComFailover:
    def test_nlu_livre_propaga_erro_passageiro_e_nao_marca_o_modelo(self):
        from app.agent.fsm import nlu

        async def fake_chat(**kw):
            raise httpx.ReadTimeout("lento")

        chave = "openrouter:m-lento"
        nlu._SEM_JSON_MODE.discard(chave)
        with patch("app.agent.providers.openai_chat", new=fake_chat):
            try:
                asyncio.run(nlu.nlu_extract(
                    provider="openrouter", api_key="k", model="m-lento",
                    estado_resumo="", historico_texto="", user_input="oi",
                ))
                raise AssertionError("deveria ter propagado o erro para o failover")
            except httpx.ReadTimeout:
                pass
        assert chave not in nlu._SEM_JSON_MODE

    def test_nlu_comandos_nao_desliga_o_schema_por_erro_passageiro(self):
        from decimal import Decimal

        from app.agent.fsm import nlu_comandos as mod
        from app.agent.fsm.catalogo import Catalogo, ProdutoCat

        cat = Catalogo(pizzaria_id="p", produtos=[ProdutoCat(id="1", codigo="P1", nome="Calabresa",
                                                             categoria="pizza", preco=Decimal("40"))])

        async def fake_chat(**kw):
            raise RuntimeError("openrouter 502: bad gateway")

        mod._SEM_SCHEMA.clear()
        with patch("app.agent.providers.openai_chat", new=fake_chat):
            try:
                asyncio.run(mod.nlu_comandos(
                    provider="openrouter", api_key="k", model="m", cat=cat, estado={"carrinho": []},
                    estado_resumo="", historico_texto="", user_input="quero uma calabresa",
                ))
                raise AssertionError("deveria ter propagado o erro para o failover")
            except RuntimeError as e:
                assert "502" in str(e)
        assert "openrouter:m" not in mod._SEM_SCHEMA
