from types import SimpleNamespace

from app.agent.behavior import (
    AtendimentoConfig,
    delivery_options,
    get_behavior,
    personality_prompt_block,
    render_template,
)
from app.services.humanized_delivery import split_balloons, typing_delay_ms


def _persona(config=None):
    return SimpleNamespace(
        nome="Lia",
        estilo="proximo",
        nivel_emoji="pouco",
        vocabulario_regional="uai",
        diferenciais=["massa de longa fermentação"],
        restricoes=["não chamar de amor"],
        exemplos_conversa=[
            {"cliente": "Tem calabresa?", "atendente": "Tem sim! Quer ver os tamanhos?"},
        ],
        instrucoes_extras="Seja direta.",
        config_atendimento=config or {},
    )


def test_config_incompleta_recebe_defaults_e_ignora_campos_desconhecidos():
    cfg = AtendimentoConfig.model_validate({
        "comunicacao": {"max_baloes": 3, "campo_inventado": "ignorar"},
        "raiz_inventada": True,
    })
    assert cfg.comunicacao.max_baloes == 3
    assert cfg.comunicacao.ritmo_digitacao == "natural"
    assert not hasattr(cfg, "raiz_inventada")


def test_persona_antiga_sem_config_eh_retrocompativel():
    cfg = get_behavior(_persona())
    assert cfg.versao == 1
    assert cfg.handoff.resumo_automatico is True
    assert cfg.followups.carrinho.atraso_minutos == 25


def test_prompt_usa_exemplos_e_preserva_fronteira_de_seguranca():
    prompt = personality_prompt_block(_persona())
    assert 'Cliente: "Tem calabresa?"' in prompt
    assert 'Atendente: "Tem sim! Quer ver os tamanhos?"' in prompt
    assert "subordinada às regras críticas" in prompt
    assert "nunca dados/preços" in prompt


def test_template_interpola_apenas_variaveis_permitidas():
    pizzaria = SimpleNamespace(nome="Pizza Boa")
    text = render_template(
        "Oi{{ primeiro_nome }}! Aqui é {{ nome_atendente }} da {{ nome_pizzaria }}. {{ segredo }}",
        pizzaria=pizzaria,
        cliente_nome="Ana Silva",
        atendente_nome="Lia",
    )
    assert text == "Oi, Ana! Aqui é Lia da Pizza Boa. {{ segredo }}"


def test_ritmo_calmo_e_limites_de_baloes_sao_aplicados():
    persona = _persona({
        "comunicacao": {
            "ritmo_digitacao": "calmo",
            "max_baloes": 3,
            "tamanho_resposta": "equilibrada",
        }
    })
    opts = delivery_options(persona)
    assert opts["max_balloons"] == 3
    assert opts["max_chars"] == 360
    assert opts["delay_multiplier"] > 1
    assert typing_delay_ms("Uma frase curta", **{
        "multiplier": opts["delay_multiplier"],
        "min_delay_ms": opts["min_delay_ms"],
        "max_delay_ms": opts["max_delay_ms"],
    }) >= 850


def test_quebra_de_baloes_respeita_teto():
    texto = "Primeiro assunto.\n\nSegundo assunto.\n\nTerceiro assunto."
    assert split_balloons(texto, max_balloons=2) == [
        "Primeiro assunto.",
        "Segundo assunto.",
    ]
