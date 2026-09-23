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


# ---- Mensagem de fora do horário reflete o horário CADASTRADO ----
from types import SimpleNamespace

from app.services.business_hours import (
    DEFAULT_FORA_HORARIO,
    formatar_horario,
    mensagem_fora_horario,
)

SEMANA = {
    "seg": {"abre": "18:00", "fecha": "23:00", "fechado": False},
    "ter": {"abre": "18:00", "fecha": "23:00", "fechado": False},
    "qua": {"abre": "18:00", "fecha": "23:00", "fechado": False},
    "qui": {"abre": "18:00", "fecha": "23:30", "fechado": False},
    "sex": {"abre": "18:00", "fecha": "23:30", "fechado": False},
    "sab": {"abre": "18:00", "fecha": "23:30", "fechado": False},
    "dom": {"abre": "18:00", "fecha": "23:00", "fechado": True},
}


def test_formatar_agrupa_dias_iguais_seguidos():
    assert formatar_horario(SEMANA) == (
        "• Seg a Qua: 18:00 às 23:00\n"
        "• Qui a Sáb: 18:00 às 23:30\n"
        "• Dom: fechado"
    )


def test_formatar_sem_horario_estruturado_nao_inventa():
    assert formatar_horario(None) is None
    assert formatar_horario({}) is None
    assert formatar_horario("das 18 às 23") is None  # formato antigo


def test_marcador_vira_horario_cadastrado():
    pizz = SimpleNamespace(
        mensagens_status={"fora_horario": "Estamos fechados! 😴\nHorário:\n{horario}"},
        horario_funcionamento=SEMANA,
    )
    msg = mensagem_fora_horario(pizz)
    assert "{horario}" not in msg
    assert "• Seg a Qua: 18:00 às 23:00" in msg


def test_mensagem_padrao_ja_mostra_o_horario():
    pizz = SimpleNamespace(mensagens_status={}, horario_funcionamento=SEMANA)
    msg = mensagem_fora_horario(pizz)
    assert msg.startswith(DEFAULT_FORA_HORARIO)
    assert "Nosso horário:" in msg and "• Dom: fechado" in msg


def test_texto_livre_sem_marcador_e_respeitado():
    """Texto próprio da pizzaria, sem marcador, não é alterado."""
    pizz = SimpleNamespace(
        mensagens_status={"fora_horario": "Voltamos amanhã!"},
        horario_funcionamento=SEMANA,
    )
    assert mensagem_fora_horario(pizz) == "Voltamos amanhã!"


def test_padrao_sem_horario_cadastrado_fica_como_antes():
    pizz = SimpleNamespace(mensagens_status={}, horario_funcionamento=None)
    assert mensagem_fora_horario(pizz) == DEFAULT_FORA_HORARIO
