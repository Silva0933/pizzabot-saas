"""
Telefones brasileiros: o mesmo número chega em formatos diferentes.

O cardápio digital grava o telefone digitado pelo cliente, normalizado para
55 + DDD + 9 dígitos. O WhatsApp (Evolution) entrega o JID — e, para muitos
números, sem o 9º dígito (55 + DDD + 8). Comparar por igualdade separa o mesmo
cliente em dois: o pedido feito no cardápio não aparece para o agente que
atende a mensagem dele no WhatsApp.
"""
from __future__ import annotations

import re


def limpar_telefone(tel: str) -> str:
    """Só dígitos, com DDI 55 quando vier só DDD + número."""
    digits = re.sub(r"\D", "", tel or "")
    if len(digits) in (10, 11):
        digits = "55" + digits
    return digits


def telefones_equivalentes(tel: str) -> set[str]:
    """Todas as formas do mesmo número: com/sem 55 e com/sem o 9º dígito."""
    digits = re.sub(r"\D", "", tel or "")
    nacional = digits[2:] if digits.startswith("55") and len(digits) in {12, 13} else digits
    variantes = {digits, limpar_telefone(digits), nacional}
    if len(nacional) == 11 and nacional[2:3] == "9":
        sem_nono = nacional[:2] + nacional[3:]
        variantes.update({sem_nono, "55" + sem_nono})
    elif len(nacional) == 10:
        com_nono = nacional[:2] + "9" + nacional[2:]
        variantes.update({com_nono, "55" + com_nono})
    return {numero for numero in variantes if numero}
