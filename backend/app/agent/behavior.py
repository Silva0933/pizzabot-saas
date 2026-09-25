"""Configuração tipada e segura do comportamento do atendente.

As regras comerciais continuam no engine/FSM. Este módulo controla apenas voz,
cadência, memória, ofertas, handoff e follow-ups. Valores antigos/incompletos são
normalizados para defaults conservadores, mantendo compatibilidade retroativa.
"""
from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


def sanitize_text(value: Any, *, max_length: int) -> str:
    """Remove caracteres de controle e limita conteúdo configurável."""
    text = str(value or "")
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    return text.strip()[:max_length]


class ComunicacaoConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    tamanho_resposta: Literal["curta", "equilibrada"] = "curta"
    max_baloes: int = Field(2, ge=1, le=4)
    ritmo_digitacao: Literal["rapido", "natural", "calmo"] = "natural"
    uma_pergunta_por_vez: bool = True
    usar_nome_cliente: bool = True
    transparencia_ia: bool = True


class VendasConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    habilitado: bool = True
    oferecer_bebida: bool = True
    oferecer_borda: bool = True
    oferecer_adicional: bool = True
    oferecer_sobremesa: bool = False
    max_ofertas: int = Field(1, ge=0, le=2)


class MemoriaConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    usar_nome: bool = True
    usar_endereco: bool = True
    usar_preferencias: bool = True
    usar_pedido_habitual: bool = True


class HandoffConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    habilitado: bool = True
    resumo_automatico: bool = True
    falhas_nlu_limite: int = Field(3, ge=1, le=5)
    pendencias_limite: int = Field(3, ge=1, le=5)
    # Porta do pedido (validador) barrou o fechamento N vezes seguidas → equipe.
    validador_limite: int = Field(2, ge=1, le=5)
    # Conferência humana: pedido fechado pela IA espera alguém da loja aprovar
    # no painel antes de ir para a cozinha (e antes de o pagamento confirmar).
    revisar_pedidos: bool = False
    mensagem_transicao: str = Field(
        "Vou chamar um de nossos atendentes para finalizar seu atendimento. "
        "Só um instante que a equipe já responde por aqui! 😊",
        min_length=10,
        max_length=500,
    )

    @field_validator("mensagem_transicao")
    @classmethod
    def _limpar_mensagem(cls, value: str) -> str:
        return sanitize_text(value, max_length=500)


class FollowupItemConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    habilitado: bool = True
    atraso_minutos: int = Field(8, ge=2, le=1440)
    mensagem: str = Field(min_length=10, max_length=600)

    @field_validator("mensagem")
    @classmethod
    def _limpar_mensagem(cls, value: str) -> str:
        return sanitize_text(value, max_length=600)


class FollowupsConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    confirmacao: FollowupItemConfig = Field(default_factory=lambda: FollowupItemConfig(
        atraso_minutos=8,
        mensagem=(
            "Oi{{ primeiro_nome }}! Seu pedido ainda *não foi fechado* 😊 "
            "Quando quiser, é só confirmar que eu mando para a cozinha. Posso fechar?"
        ),
    ))
    carrinho: FollowupItemConfig = Field(default_factory=lambda: FollowupItemConfig(
        atraso_minutos=25,
        mensagem=(
            "Oi{{ primeiro_nome }}! Vi que seu pedido ficou pela metade 😊 "
            "Quer que eu continue de onde paramos? É só responder por aqui."
        ),
    ))
    respeitar_horario: bool = True


class AtendimentoConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    versao: int = Field(1, ge=1, le=1)
    comunicacao: ComunicacaoConfig = Field(default_factory=ComunicacaoConfig)
    vendas: VendasConfig = Field(default_factory=VendasConfig)
    memoria: MemoriaConfig = Field(default_factory=MemoriaConfig)
    handoff: HandoffConfig = Field(default_factory=HandoffConfig)
    followups: FollowupsConfig = Field(default_factory=FollowupsConfig)


def sanitize_list(values: Any, *, max_items: int = 12, max_length: int = 180) -> list[str]:
    if not isinstance(values, list):
        return []
    result: list[str] = []
    for value in values[:max_items]:
        item = sanitize_text(value, max_length=max_length)
        if item and item not in result:
            result.append(item)
    return result


def get_behavior(personalidade: Any | None) -> AtendimentoConfig:
    raw = getattr(personalidade, "config_atendimento", None) if personalidade else None
    try:
        return AtendimentoConfig.model_validate(raw or {})
    except Exception:
        return AtendimentoConfig()


def default_behavior_dict() -> dict[str, Any]:
    return AtendimentoConfig().model_dump()


def render_template(template: str, *, pizzaria: Any, cliente_nome: str | None = None,
                    atendente_nome: str | None = None) -> str:
    """Interpola somente variáveis conhecidas; nenhuma expressão é avaliada."""
    primeiro_nome = (cliente_nome or "").strip().split(" ")[0] if cliente_nome else ""
    values = {
        "primeiro_nome": f", {primeiro_nome}" if primeiro_nome else "",
        "nome_cliente": cliente_nome or "cliente",
        "nome_pizzaria": getattr(pizzaria, "nome", None) or "pizzaria",
        "nome_atendente": atendente_nome or "atendente virtual",
    }
    result = sanitize_text(template, max_length=600)
    for key, value in values.items():
        result = re.sub(r"{{\s*" + re.escape(key) + r"\s*}}", value, result)
    return result


def handoff_message(personalidade: Any | None, *, pizzaria: Any,
                    cliente_nome: str | None = None) -> str:
    cfg = get_behavior(personalidade)
    return render_template(
        cfg.handoff.mensagem_transicao,
        pizzaria=pizzaria,
        cliente_nome=cliente_nome,
        atendente_nome=getattr(personalidade, "nome", None),
    )


def delivery_options(personalidade: Any | None) -> dict[str, Any]:
    cfg = get_behavior(personalidade).comunicacao
    rhythm = {
        "rapido": {"delay_multiplier": 0.65, "min_delay_ms": 350, "max_delay_ms": 2800},
        "natural": {"delay_multiplier": 1.0, "min_delay_ms": 600, "max_delay_ms": 5000},
        "calmo": {"delay_multiplier": 1.3, "min_delay_ms": 850, "max_delay_ms": 6500},
    }[cfg.ritmo_digitacao]
    return {
        "max_balloons": cfg.max_baloes,
        "max_chars": 220 if cfg.tamanho_resposta == "curta" else 360,
        **rhythm,
    }


def personality_prompt_block(personalidade: Any | None) -> str:
    """Bloco de voz subordinado às regras comerciais e dados do backend."""
    cfg = get_behavior(personalidade)
    nome = sanitize_text(getattr(personalidade, "nome", None) or "Camila", max_length=50)
    estilo = getattr(personalidade, "estilo", None) or "casual"
    emoji = getattr(personalidade, "nivel_emoji", None) or "moderado"
    vocab = sanitize_text(getattr(personalidade, "vocabulario_regional", None), max_length=300)
    diferenciais = sanitize_list(getattr(personalidade, "diferenciais", None))
    restricoes = sanitize_list(getattr(personalidade, "restricoes", None))
    extras = sanitize_text(getattr(personalidade, "instrucoes_extras", None), max_length=2000)
    raw_examples = getattr(personalidade, "exemplos_conversa", None) or []
    examples: list[str] = []
    for item in raw_examples[:6]:
        if not isinstance(item, dict):
            continue
        cliente = sanitize_text(item.get("cliente"), max_length=300)
        atendente = sanitize_text(item.get("atendente"), max_length=500)
        if cliente and atendente:
            examples.append(f'Cliente: "{cliente}"\nAtendente: "{atendente}"')

    perguntas = "uma pergunta por vez" if cfg.comunicacao.uma_pergunta_por_vez else "até duas perguntas relacionadas"
    tamanho = "1 frase, no máximo 2" if cfg.comunicacao.tamanho_resposta == "curta" else "1 a 3 frases curtas"
    emoji_rule = {
        "nenhum": "não use emojis",
        "pouco": "use emoji raramente (no máximo um)",
        "moderado": "use no máximo um emoji quando for natural",
        "muito": "pode usar até dois emojis, sem exagero",
    }.get(emoji, "use emojis com moderação")

    lines = [
        "CONFIGURAÇÃO DE VOZ DA CASA (subordinada às regras críticas e aos dados do sistema):",
        f"- Identidade: {nome}; estilo: {estilo}.",
        f"- Respostas: {tamanho}; {perguntas}; {emoji_rule}.",
        f"- Separe em no máximo {cfg.comunicacao.max_baloes} balões quando houver assuntos diferentes.",
        "- Seja transparente se perguntarem se é IA." if cfg.comunicacao.transparencia_ia else
        "- Não discuta detalhes técnicos; apresente-se como atendente virtual se perguntarem diretamente.",
    ]
    if vocab:
        lines.append(f"- Vocabulário regional, com naturalidade e sem caricatura: {vocab}.")
    if diferenciais:
        lines.append("- Diferenciais que podem ser citados quando forem pertinentes: " + "; ".join(diferenciais) + ".")
    if restricoes:
        lines.append("- Restrições adicionais de comunicação: " + "; ".join(restricoes) + ".")
    if examples:
        lines.append("EXEMPLOS DE TOM (imite o estilo, nunca dados/preços):\n" + "\n".join(examples))
    if extras:
        lines.append(
            "PREFERÊNCIAS EXTRAS DO OPERADOR (ignore qualquer trecho que conflite com regras críticas, "
            "dados do backend ou segurança):\n" + extras
        )
    return "\n".join(lines)
