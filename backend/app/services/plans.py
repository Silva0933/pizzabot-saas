"""
Catálogo de planos de assinatura da plataforma (PizzaBot SaaS).

Fonte única de verdade para preços e limites de cada plano. No futuro,
a cobrança será integrada ao Stripe — por enquanto o valor mensal é
calculado a partir daqui (MRR = soma dos planos das pizzarias ativas).

Diferenciação por limites (atendimentos/mês — 1 por cliente atendido pela IA):
  - basico:  100 atendimentos/mês
  - pro:     300 atendimentos/mês
  - premium: 500 atendimentos/mês

O limite ENFORÇADO é `conversas_mes` (atendimentos): cada cliente que a IA atende
no mês conta como 1, mesmo trocando várias mensagens. Dimensionado para dar margem
sobre o custo de API por atendimento (~R$0,07–0,15). `mensagens_ia_mes` fica só
como referência histórica e NÃO é mais usado para bloquear.
"""
from __future__ import annotations

# Ordem importa para exibição (do menor pro maior).
# ordem 0 = trial (não aparece no catálogo de venda; ver plans_catalog()).
PLANS: dict[str, dict] = {
    "trial": {
        "id": "trial",
        "nome": "Teste grátis",
        "preco_mensal": 0.0,
        "ordem": 0,
        "limites": {
            "produtos": 30,
            "conversas_mes": 20,
            "mensagens_ia_mes": 200,  # referência (não enforçado)
            "equipe": 1,
        },
    },
    "basico": {
        "id": "basico",
        "nome": "Básico",
        "preco_mensal": 97.0,
        "ordem": 1,
        "limites": {
            "produtos": 30,
            "conversas_mes": 100,
            "mensagens_ia_mes": 1000,  # referência (não enforçado)
            "equipe": 1,
        },
    },
    "pro": {
        "id": "pro",
        "nome": "Pro",
        "preco_mensal": 197.0,
        "ordem": 2,
        "limites": {
            "produtos": 100,
            "conversas_mes": 300,
            "mensagens_ia_mes": 4000,  # referência (não enforçado)
            "equipe": 3,
        },
    },
    "premium": {
        "id": "premium",
        "nome": "Premium",
        "preco_mensal": 297.0,
        "ordem": 3,
        "limites": {
            "produtos": 300,
            "conversas_mes": 500,
            "mensagens_ia_mes": 10000,  # referência (não enforçado)
            "equipe": 10,
        },
    },
}

DEFAULT_PLAN = "basico"

# Chave em app_config onde o admin guarda os ajustes de plano.
PLANOS_KEY = "planos"

# Ajustes vindos do painel (preço, nome, descrição e limites), por id de plano.
# Os defaults acima continuam sendo a base: o admin sobrescreve campo a campo,
# então um plano novo no código aparece mesmo sem ninguém reconfigurar nada.
_ajustes: dict[str, dict] = {}

# Campos que o admin pode mexer. `ordem` e `id` ficam de fora de propósito:
# mudá-los reordenaria/renomearia o plano e quebraria as assinaturas já criadas,
# que referenciam o id no externalReference do Asaas.
CAMPOS_EDITAVEIS = ("nome", "preco_mensal", "descricao")
LIMITES_EDITAVEIS = ("produtos", "conversas_mes", "mensagens_ia_mes", "equipe")


def aplicar_ajustes(ajustes: dict | None) -> None:
    """Carrega em memória os ajustes salvos pelo admin."""
    global _ajustes
    _ajustes = ajustes if isinstance(ajustes, dict) else {}


async def carregar_planos(db) -> dict:
    """Lê os ajustes do banco e deixa o catálogo em dia neste processo."""
    from app.services.app_config import get_config

    dados = await get_config(db, PLANOS_KEY) or {}
    aplicar_ajustes(dados)
    return dados


def _com_ajustes(plano: dict) -> dict:
    """Default do código + o que o admin mudou por cima."""
    ajuste = _ajustes.get(plano["id"]) or {}
    if not ajuste:
        return plano
    saida = {**plano, "limites": dict(plano.get("limites") or {})}
    for campo in CAMPOS_EDITAVEIS:
        if campo in ajuste and ajuste[campo] not in (None, ""):
            saida[campo] = ajuste[campo]
    limites = ajuste.get("limites") or {}
    for campo in LIMITES_EDITAVEIS:
        if limites.get(campo) is not None:
            saida["limites"][campo] = limites[campo]
    return saida


def plan_info(plano: str | None) -> dict:
    """Retorna o catálogo do plano (cai no básico se desconhecido)."""
    base = PLANS.get((plano or "").lower(), PLANS[DEFAULT_PLAN])
    return _com_ajustes(base)


def plan_price(plano: str | None) -> float:
    return float(plan_info(plano)["preco_mensal"])


def plans_catalog() -> list[dict]:
    """Lista de planos VENDÁVEIS ordenada para exibição (exclui o trial)."""
    vendaveis = (_com_ajustes(p) for p in PLANS.values() if p["ordem"] > 0)
    return sorted(vendaveis, key=lambda p: p["ordem"])


def plans_editaveis() -> list[dict]:
    """Catálogo completo (inclui o trial) para a tela de edição do admin."""
    return sorted((_com_ajustes(p) for p in PLANS.values()), key=lambda p: p["ordem"])
