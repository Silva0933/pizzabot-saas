"""
Testes do endereço via LOCALIZAÇÃO do WhatsApp (clipe → Localização).

Travam o fluxo de ponta a ponta:
  - webhook converte locationMessage em "[localizacao lat=.. lon=..]" (e não
    guarda o thumbnail gigante no metadata);
  - pipeline converte a localização em 'informar_endereco' via reverse
    geocoding, sem LLM (e marca _localizacao_sem_numero quando falta o número);
  - engine: sem número → confirma o endereço e pede SÓ o número; resposta com
    o número ANEXA ao endereço (não substitui a rua/bairro);
  - NLU determinística reconhece "123" / "nº 123 apto 4" quando aguardando o
    número;
  - geocoding indisponível → segue para a NLU LLM (sem travar).
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ============================================================
# Webhook: extração do locationMessage
# ============================================================
class TestExtracaoWebhook:
    def _extrai(self, loc):
        from app.routes.webhook import _extract_content
        return _extract_content({"message": {"locationMessage": loc}})

    def test_vira_texto_estruturado_com_coordenadas(self):
        conteudo, tipo, metadata = self._extrai({
            "degreesLatitude": -23.5505, "degreesLongitude": -46.6333,
            "name": "Casa", "jpegThumbnail": "x" * 5000,
        })
        assert tipo == "localizacao"
        assert "[localizacao lat=-23.5505 lon=-46.6333]" in conteudo
        assert "Casa" in conteudo
        # Thumbnail gigante NÃO vai pro metadata.
        assert "jpegThumbnail" not in str(metadata)
        assert metadata["localizacao"]["lat"] == -23.5505

    def test_sem_coordenadas_cai_no_placeholder(self):
        conteudo, tipo, _ = self._extrai({"name": "Casa"})
        assert conteudo == "[localização]"
        assert tipo == "localizacao"


# ============================================================
# Pipeline: localização → informar_endereco (sem LLM)
# ============================================================
def _geo_ok(numero=None):
    return {"ok": True, "rua": "Rua das Flores", "numero": numero,
            "bairro": "Centro", "cidade": "São Paulo",
            "display_name": "Rua das Flores, Centro, São Paulo"}


class TestPipelineLocalizacao:
    def _roda(self, user_input, geo):
        import app.services.geocoding as geocoding
        from app.agent.fsm.pipeline import _nlu_localizacao
        with patch.object(geocoding, "reverse_geocode", new=AsyncMock(return_value=geo)):
            return asyncio.run(_nlu_localizacao(user_input))

    def test_converte_em_informar_endereco(self):
        out = self._roda("[localizacao lat=-23.5505 lon=-46.6333]", _geo_ok(numero="123"))
        assert out is not None
        assert out["intencao"] == "informar_endereco"
        assert out["confianca"] == 1.0
        assert out["_deterministica"] is True
        end = out["dados"]["endereco"]
        assert end["rua"] == "Rua das Flores"
        assert end["numero"] == "123"
        assert end["bairro"] == "Centro"
        # Mandar a localização implica entrega.
        assert out["dados"]["tipo_entrega"] == "delivery"
        assert "_localizacao_sem_numero" not in out["dados"]

    def test_sem_numero_marca_pendencia(self):
        out = self._roda("[localizacao lat=-23.5505 lon=-46.6333]", _geo_ok(numero=None))
        assert out["dados"]["_localizacao_sem_numero"] is True

    def test_mensagem_normal_nao_dispara(self):
        out = self._roda("quero uma pizza", _geo_ok())
        assert out is None

    def test_geocoding_falhou_vai_para_llm(self):
        out = self._roda(
            "[localizacao lat=-23.5505 lon=-46.6333]",
            {"ok": False, "rua": None, "numero": None, "bairro": None,
             "cidade": None, "display_name": None},
        )
        assert out is None  # segue pra NLU LLM


# ============================================================
# NLU determinística: número da casa após a localização
# ============================================================
class TestNumeroAposLocalizacao:
    def test_numero_puro(self):
        from app.agent.fsm.pipeline import _nlu_deterministica
        out = _nlu_deterministica("123", {"aguardando_numero": True})
        assert out is not None
        assert out["intencao"] == "informar_endereco"
        assert out["dados"]["endereco"]["numero"] == "123"

    def test_numero_com_complemento(self):
        from app.agent.fsm.pipeline import _nlu_deterministica
        out = _nlu_deterministica("nº 45 apto 12", {"aguardando_numero": True})
        assert out["dados"]["endereco"]["numero"] == "45"
        assert "apto 12" in out["dados"]["endereco"]["referencia"]

    def test_sem_flag_nao_dispara(self):
        from app.agent.fsm.pipeline import _nlu_deterministica
        assert _nlu_deterministica("123", {}) is None

    def test_resposta_nao_numerica_vai_para_llm(self):
        from app.agent.fsm.pipeline import _nlu_deterministica
        assert _nlu_deterministica("não tem número", {"aguardando_numero": True}) is None


# ============================================================
# Engine: confirmação do endereço e anexo do número
# ============================================================
def _ctx_db():
    ctx = MagicMock()
    ctx.pizzaria.id = "00000000-0000-0000-0000-000000000001"
    ctx.pizzaria.nome = "Pizzaria Palazio"
    ctx.pizzaria.adicionais = []
    ctx.ultimo_pedido_resumo = None
    ctx.telefone = "5511999999999"
    db = MagicMock()
    return ctx, db


def _estado_com_pizza():
    from app.agent.fsm import engine
    estado = engine.estado_inicial()
    estado["apresentou"] = True
    estado["upsell_feito"] = True
    estado["carrinho"] = [{
        "nome": "Calabresa", "tamanho": "P", "qtd": 1,
        "preco_congelado": 30.0, "nome_congelado": "Calabresa (P)",
    }]
    return estado


class TestEngineLocalizacao:
    def test_sem_numero_confirma_endereco_e_pede_numero(self):
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        estado = _estado_com_pizza()
        nlu = {
            "intencao": "informar_endereco",
            "dados": {
                "tipo_entrega": "delivery",
                "endereco": {"rua": "Rua das Flores", "numero": None,
                             "bairro": "Centro", "referencia": "localização enviada pelo WhatsApp"},
                "_localizacao_sem_numero": True,
            },
        }
        out = asyncio.run(engine.processar(
            db, ctx, estado, nlu, user_input="[localizacao lat=-23.5 lon=-46.6]"
        ))
        assert out["decisao"]["acao"] == "pedir_info"
        assert "número" in out["decisao"]["proxima_pergunta"].lower()
        assert out["estado"]["aguardando_numero"] is True
        assert "Rua das Flores" in out["estado"]["endereco"]
        fatos = " ".join(out["decisao"]["fatos"])
        assert "Rua das Flores" in fatos

    def test_numero_anexa_ao_endereco_sem_substituir(self):
        from app.agent.fsm import engine
        estado = {"endereco": "Rua das Flores, Centro, localização enviada pelo WhatsApp"}
        engine._aplicar_nlu(estado, {"endereco": {"numero": "123", "referencia": "apto 4"}})
        assert estado["endereco"].startswith("Rua das Flores, Centro")
        assert "nº 123" in estado["endereco"]
        assert "apto 4" in estado["endereco"]

    def test_endereco_completo_continua_substituindo(self):
        from app.agent.fsm import engine
        estado = {"endereco": "Endereço antigo"}
        engine._aplicar_nlu(estado, {"endereco": {"rua": "Av. Brasil", "numero": "10", "bairro": "Sul"}})
        assert estado["endereco"] == "Av. Brasil, 10, Sul"

    def test_pergunta_de_endereco_oferece_localizacao(self):
        """Ao pedir o endereço, a atendente menciona a opção de mandar a localização."""
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        estado = _estado_com_pizza()
        estado["tipo"] = "delivery"
        nlu = {"intencao": "informar_entrega_retirada", "dados": {"tipo_entrega": "delivery"}}
        calc_ok = {
            "ok": True, "valor_total": 30.0, "taxa_entrega": 0,
            "itens": [{"nome": "Calabresa (P)", "quantidade": 1, "preco_unit": 30.0}],
        }

        with patch("app.agent.tools._calcular_pedido", new=AsyncMock(return_value=calc_ok)):
            with patch("app.agent.fsm.engine._sincronizar_rascunho", new=AsyncMock()):
                out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="entrega"))

        assert out["decisao"]["acao"] == "pedir_info"
        assert "localiza" in out["decisao"]["proxima_pergunta"].lower()
