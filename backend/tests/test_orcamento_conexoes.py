"""
Orçamento de conexões do Postgres.

Cada conversa em voo no dispatcher segura 1 conexão durante a chamada do LLM.
Antes, a soma dos pools (dispatcher 50 + API 30 + worker 40 + beat 5 ≈ 125)
passava do max_connections=100 da produção: num pico de atendimento, "too many
connections". O dispatcher agora limita a própria concorrência ao que cabe.
"""
from __future__ import annotations

from app.dispatcher.runner import concorrencia_segura


def test_padrao_cabe_no_postgres_de_fabrica():
    # 40 conversas, max_connections=100 (3 reservadas), outros serviços 50.
    assert concorrencia_segura(40, 100, 3, 50) == 40


def test_80_sem_subir_o_max_connections_e_limitado():
    assert concorrencia_segura(80, 100, 3, 50) == 37


def test_80_com_max_connections_200_passa():
    assert concorrencia_segura(80, 200, 3, 50) == 80


def test_duas_replicas_dividem_o_que_sobra():
    # 200 conexões, 2 réplicas pedindo 80 cada: cada uma fica com o que cabe.
    assert concorrencia_segura(80, 200, 3, 50, replicas=2) == 63


def test_nunca_abaixo_do_minimo():
    assert concorrencia_segura(40, 30, 3, 50) == 5
