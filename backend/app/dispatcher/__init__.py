"""Dispatcher assíncrono (Etapa 1 do plano de escalabilidade).

Consome conversas prontas de um Redis Stream e processa muitas em paralelo num
único event loop (workload I/O-bound). Reaproveita as primitivas atuais
(`drain_pending`, `confirm_processed`, `process_and_reply`) — só troca o
"sistema nervoso" (ingestão + concorrência), não o "cérebro" (agente/FSM).
"""
