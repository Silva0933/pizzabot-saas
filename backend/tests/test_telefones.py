"""
O mesmo cliente chega com e sem o 9º dígito (cardápio digital × JID do
WhatsApp). As buscas por conversa/cliente usavam `==` em vários pontos (mensagem
de status, NPS, resgate de carrinho, lembrete, contexto do agente, acompanhar
pedido): a mensagem ia para o cliente mas não aparecia na conversa do painel, e o
"acompanhar pedido" dava 404.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from app.models import Conversa
from app.services.telefones import mesmo_telefone, preferir_exato, telefones_equivalentes


def _sql(stmt) -> str:
    return str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


class TestMesmoTelefone:
    def test_jid_sem_nono_acha_cadastro_com_nono(self):
        sql = _sql(select(Conversa).where(mesmo_telefone(Conversa.cliente_telefone, "551188887777")))
        assert "'5511988887777'" in sql      # forma do cardápio digital
        assert "'551188887777'" in sql       # forma do JID

    def test_cadastro_com_nono_acha_jid_sem_nono(self):
        assert "551188887777" in telefones_equivalentes("5511988887777")
        sql = _sql(select(Conversa).where(mesmo_telefone(Conversa.cliente_telefone, "5511988887777")))
        assert "'551188887777'" in sql

    def test_prefere_o_formato_exato(self):
        sql = _sql(
            select(Conversa)
            .where(mesmo_telefone(Conversa.cliente_telefone, "551188887777"))
            .order_by(preferir_exato(Conversa.cliente_telefone, "551188887777"))
        )
        assert "ORDER BY CASE WHEN (conversas.cliente_telefone = '551188887777') THEN 0" in sql
