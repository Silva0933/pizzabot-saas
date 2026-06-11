"""Configuração compartilhada de testes.

Isolamento do client Redis por teste: vários testes usam `asyncio.run(...)`, que
cria e FECHA um event loop novo a cada chamada. O client Redis async é global
(`app.redis_client.redis`) e, ao ser usado, prende seu pool de conexões ao
primeiro loop — os testes seguintes então quebram com "attached to a different
loop" / "Event loop is closed".

Este fixture (autouse) entrega um client NOVO a cada teste, ligado ao loop daquele
teste, e reaponta os módulos que capturaram a referência no import (top-level:
queue, broadcaster, streams). Só atua quando há REDIS_URL (CI/integração); sem
Redis, é no-op e não toca em nada (suíte local inalterada).
"""
import os

import pytest


@pytest.fixture(autouse=True)
def _isolate_redis_client():
    url = os.environ.get("REDIS_URL")
    if not url:
        yield
        return

    from redis.asyncio import Redis

    import app.redis_client as rc

    client = Redis.from_url(
        url, encoding="utf-8", decode_responses=True, health_check_interval=30
    )
    rc.redis = client

    # Reaponta quem fez `from app.redis_client import redis` no nível do módulo.
    for modname, attr in (
        ("app.services.queue", "redis"),
        ("app.services.broadcaster", "redis"),
        ("app.dispatcher.streams", "redis"),
    ):
        try:
            mod = __import__(modname, fromlist=[attr])
            setattr(mod, attr, client)
        except Exception:  # noqa: BLE001
            pass
    try:
        import app.dispatcher.streams as _s

        _s._pump_script = None  # re-registra o script Lua no client novo
    except Exception:  # noqa: BLE001
        pass

    yield
    # Teardown: o loop do teste já fechou aqui; não dá pra await aclose(). Apenas
    # soltamos a referência — o GC encerra. (Em teste, vazar conexão é inócuo.)
