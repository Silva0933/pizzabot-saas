from datetime import datetime

from app.services.business_hours import esta_aberto


HORARIOS = {
    "seg": {"abre": "18:00", "fecha": "23:00", "fechado": False},
}


def test_horario_automatico_continua_valendo_sem_override():
    assert esta_aberto(HORARIOS, datetime(2026, 8, 10, 19, 0)) is True
    assert esta_aberto(HORARIOS, datetime(2026, 8, 10, 12, 0)) is False


def test_fechamento_manual_tem_prioridade_sobre_horario_aberto():
    assert esta_aberto(
        HORARIOS,
        datetime(2026, 8, 10, 19, 0),
        override=False,
    ) is False


def test_abertura_manual_tem_prioridade_sobre_horario_fechado():
    assert esta_aberto(
        HORARIOS,
        datetime(2026, 8, 10, 12, 0),
        override=True,
    ) is True
