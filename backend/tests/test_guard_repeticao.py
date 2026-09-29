"""
Guard contra repetição da voz (frases reais do teste com o agente, 29/09).

O sistema já mostra "✅ Anotei: 1x Fanta 1L"; a voz repetia "Fanta 1L anotada."
e "Tirei, sim." antes da pergunta. E se reapresentava ("Sou a Camila, da
Fornalha") no meio da conversa.
"""
from __future__ import annotations

from app.agent.fsm.guard import blindar, remover_eco_confirmacao, strip_apresentacao


class TestEcoDaConfirmacao:
    def test_remove_item_anotado_repetido(self):
        out, removeu = remover_eco_confirmacao(
            "Fanta 1L anotada. Vai ser entrega ou retirada?", "✅ Anotei: 1x Fanta 1L",
        )
        assert removeu and out == "Vai ser entrega ou retirada?"

    def test_remove_tirei_sim(self):
        out, removeu = remover_eco_confirmacao(
            "Tirei, sim. Vai ser entrega ou retirada?", "✅ Tirei: Coca-Cola 2L",
        )
        assert removeu and out == "Vai ser entrega ou retirada?"

    def test_mantem_pergunta_e_resposta_util(self):
        texto = "Anotei a Coca, quer mais alguma coisa?"
        assert remover_eco_confirmacao(texto, "✅ Anotei: 1x Coca-Cola 2L") == (texto, False)
        texto2 = "A Brasa leva calabresa artesanal. Vai ser entrega ou retirada?"
        assert remover_eco_confirmacao(texto2, "✅ Anotei: 1x Coca-Cola 2L") == (texto2, False)

    def test_nunca_apaga_tudo(self):
        assert remover_eco_confirmacao("Anotado!", "✅ Anotei: 1x Fanta 1L") == ("Anotado!", False)

    def test_sem_confirmacao_nao_mexe(self):
        assert remover_eco_confirmacao("Anotado! E pra entrega?", None) == ("Anotado! E pra entrega?", False)


class TestApresentacaoForaDeHora:
    def test_remove_depois_de_apresentada(self):
        out, removeu = strip_apresentacao(
            "Sou a Camila, da Fornalha Burger & Pizza. Já chamei alguém da equipe para continuar.",
            "Camila", ja_apresentou=True,
        )
        assert removeu and out == "Já chamei alguém da equipe para continuar."

    def test_primeira_mensagem_mantem(self):
        texto = "Olá! Sou a Camila da Fornalha 😊 Gostaria de ver o cardápio?"
        assert strip_apresentacao(texto, "Camila", ja_apresentou=False) == (texto, False)

    def test_blindar_registra_a_correcao(self):
        texto, cor = blindar("Oi! Sou a Camila, da Fornalha. Já chamei alguém da equipe.",
                             ja_apresentou=True, precos_validos=[], persona_nome="Camila")
        assert texto == "Já chamei alguém da equipe."
        assert cor.get("apresentacao_removida") and cor.get("saudacao_removida")
