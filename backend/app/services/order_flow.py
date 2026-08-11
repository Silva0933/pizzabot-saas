"""Rules that keep the order workflow sequential and predictable."""
from __future__ import annotations

ORDER_STATUSES = (
    "novo", "confirmado", "no_forno", "pronto_entrega",
    "a_caminho", "entregue", "cancelado",
)


def allowed_next_statuses(current: str, order_type: str) -> set[str]:
    """Statuses allowed during normal operation, without an audited correction."""
    flow = {
        "novo": {"confirmado", "cancelado"},
        "confirmado": {"no_forno", "cancelado"},
        "no_forno": {"entregue" if order_type == "retirada" else "pronto_entrega", "cancelado"},
        "pronto_entrega": {"a_caminho", "cancelado"},
        "a_caminho": {"entregue", "cancelado"},
        "entregue": set(),
        "cancelado": set(),
    }
    return flow.get(current, set())


def validate_transition(current: str, target: str, order_type: str) -> str | None:
    """Return a user-friendly message when a regular transition is forbidden."""
    if target not in ORDER_STATUSES:
        return f"Status invalido: {target}."
    if current == target:
        return None
    if target not in allowed_next_statuses(current, order_type):
        return (
            f"Nao e permitido alterar de '{current}' para '{target}' diretamente. "
            "Avance o pedido pela proxima etapa ou use 'Corrigir pedido' com justificativa."
        )
    return None
