"""Pipeline FSM do atendimento: NLU (JSON) → backend determinístico → voz.

Substitui o loop de tool-calling por 3 camadas claras, ativável por pizzaria
(flag pizzarias.pipeline_fsm). Reaproveita os serviços de pedido já testados.
"""
