"""Unit tests for the safe, sequential order status workflow."""
from app.services.order_flow import allowed_next_statuses, validate_transition


def test_delivery_follows_every_step():
    assert allowed_next_statuses("novo", "delivery") == {"confirmado", "cancelado"}
    assert allowed_next_statuses("confirmado", "delivery") == {"no_forno", "cancelado"}
    assert allowed_next_statuses("no_forno", "delivery") == {"pronto_entrega", "cancelado"}
    assert allowed_next_statuses("pronto_entrega", "delivery") == {"a_caminho", "cancelado"}
    assert allowed_next_statuses("a_caminho", "delivery") == {"entregue", "cancelado"}


def test_pickup_finishes_from_kitchen_without_delivery_step():
    assert allowed_next_statuses("no_forno", "retirada") == {"entregue", "cancelado"}
    assert validate_transition("no_forno", "entregue", "retirada") is None


def test_cannot_skip_statuses():
    error = validate_transition("confirmado", "entregue", "delivery")
    assert error is not None
    assert "Corrigir pedido" in error


def test_terminal_statuses_cannot_be_changed_normally():
    assert validate_transition("entregue", "confirmado", "delivery") is not None
    assert validate_transition("cancelado", "novo", "delivery") is not None


def test_repeating_same_status_is_idempotent():
    assert validate_transition("no_forno", "no_forno", "delivery") is None
