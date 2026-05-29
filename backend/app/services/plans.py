"""
Catálogo de planos de assinatura da plataforma (PizzaBot SaaS).

Fonte única de verdade para preços e limites de cada plano. No futuro,
a cobrança será integrada ao Stripe — por enquanto o valor mensal é
calculado a partir daqui (MRR = soma dos planos das pizzarias ativas).

Diferenciação por limites:
  - basico:  bem limitado
  - pro:     intermediário
  - premium: ~10x o básico
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
            "conversas_mes": 500,
            "mensagens_ia_mes": 1000,
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
            "conversas_mes": 2000,
            "mensagens_ia_mes": 4000,
            "equipe": 3,
        },
    },
    "premium": {
        "id": "premium",
        "nome": "Premium",
        "preco_mensal": 297.0,
        "ordem": 3,
        # ~10x o básico
        "limites": {
            "produtos": 300,
            "conversas_mes": 5000,
            "mensagens_ia_mes": 10000,
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
