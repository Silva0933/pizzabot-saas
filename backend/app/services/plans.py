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
PLANS: dict[str, dict] = {
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


def plan_info(plano: str | None) -> dict:
    """Retorna o catálogo do plano (cai no básico se desconhecido)."""
    return PLANS.get((plano or "").lower(), PLANS[DEFAULT_PLAN])


def plan_price(plano: str | None) -> float:
    return float(plan_info(plano)["preco_mensal"])


def plans_catalog() -> list[dict]:
    """Lista de planos ordenada para exibição."""
    return sorted(PLANS.values(), key=lambda p: p["ordem"])
