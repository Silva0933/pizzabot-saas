"""
App do entregador — Fase 1: código de entrega, localização e rota.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.services import entregas as E


class TestCodigoDeEntrega:
    def test_gera_quatro_digitos(self):
        for _ in range(50):
            c = E.gerar_codigo_entrega()
            assert len(c) == 4 and c.isdigit()

    def test_confere(self):
        assert E.codigo_confere("0472", "0472")
        assert E.codigo_confere("0472", " 04-72 ")
        assert not E.codigo_confere("0472", "4720")
        assert not E.codigo_confere("0472", "")
        assert E.codigo_confere(None, "")  # pedido antigo, sem código

    def test_mensagem_de_saiu_para_entrega_leva_o_codigo(self):
        from app.services import status_messages as sm
        pedido = SimpleNamespace(
            id=uuid.uuid4(), pizzaria_id=uuid.uuid4(), cliente_id=uuid.uuid4(), numero_pedido=14,
            valor_total=57, tipo="delivery", codigo_entrega="0472", status="a_caminho",
        )
        pizz = SimpleNamespace(id=pedido.pizzaria_id, instancia="inst", mensagens_status={},
                               tempo_entrega_min=30, tempo_entrega_max=60,
                               tempo_retirada_min=15, tempo_retirada_max=25)
        cli = SimpleNamespace(nome="Ana", telefone="5598999999999")

        def _res(v):
            r = MagicMock()
            r.first.return_value = v
            r.scalar_one_or_none.return_value = v
            r.scalars.return_value.first.return_value = None
            return r
        db = AsyncMock()
        db.execute = AsyncMock(side_effect=[_res(None), _res(pizz), _res(cli), _res(None)])
        enviado = AsyncMock()
        with patch.object(sm.evolution, "send_text", new=enviado), \
             patch.object(sm.evolution, "send_presence", new=AsyncMock()):
            assert asyncio.run(sm.enviar_mensagem_status(db, pedido, "a_caminho"))
        texto = enviado.await_args.kwargs["texto"]
        assert "Código de entrega: *0472*" in texto


def _ent():
    return SimpleNamespace(id=uuid.uuid4(), usuario_id=uuid.uuid4(), nome="Carlos",
                           lat=None, lon=None, precisao_m=None, localizacao_em=None)


def _db_com_pedido(pedido):
    res = MagicMock()
    res.scalar_one_or_none.return_value = pedido
    db = AsyncMock()
    db.execute = AsyncMock(return_value=res)
    return db


class TestConfirmacaoDoEntregador:
    def _confirmar(self, pedido, **body):
        from app.routes import entregadores as R
        aplicar = AsyncMock(return_value=pedido)
        with patch.object(R, "apply_status_change", new=aplicar):
            asyncio.run(R.atualizar_status_entregador(
                uuid.uuid4(), pedido.id, R.DriverStatusIn(status="entregue", **body),
                _db_com_pedido(pedido), _ent(),
            ))
        return aplicar

    def _pedido(self, codigo="0472"):
        return SimpleNamespace(id=uuid.uuid4(), codigo_entrega=codigo, status="a_caminho")

    def test_codigo_certo_confirma(self):
        aplicar = self._confirmar(self._pedido(), codigo="0472")
        assert aplicar.await_args.args[3] == "entregue"
        assert aplicar.await_args.args[4] is None

    def test_codigo_errado_barra(self):
        with pytest.raises(HTTPException) as e:
            self._confirmar(self._pedido(), codigo="1111")
        assert e.value.status_code == 422 and "não confere" in e.value.detail

    def test_sem_codigo_exige_motivo(self):
        with pytest.raises(HTTPException) as e:
            self._confirmar(self._pedido())
        assert e.value.status_code == 422

    def test_sem_codigo_com_motivo_fica_no_historico(self):
        aplicar = self._confirmar(self._pedido(), sem_codigo_motivo="cliente sem celular")
        assert "cliente sem celular" in aplicar.await_args.args[4]

    def test_pedido_antigo_sem_codigo_confirma(self):
        aplicar = self._confirmar(self._pedido(codigo=None))
        assert aplicar.await_args.args[3] == "entregue"


class TestLocalizacao:
    def test_guarda_posicao_e_avisa_o_painel(self):
        from app.routes import entregadores as R
        ent = _ent()
        db = AsyncMock()
        pub = AsyncMock()
        with patch("app.services.broadcaster.broadcaster.publish", new=pub):
            asyncio.run(R.registrar_localizacao(uuid.uuid4(), R.LocalizacaoIn(lat=-2.53, lon=-44.3, precisao=12),
                                                db, ent))
        assert (ent.lat, ent.lon, ent.precisao_m) == (-2.53, -44.3, 12)
        assert ent.localizacao_em is not None
        assert pub.await_args.args[1]["tipo"] == "entregador.localizacao"

    def test_coordenada_invalida_recusada(self):
        from pydantic import ValidationError

        from app.routes import entregadores as R
        with pytest.raises(ValidationError):
            R.LocalizacaoIn(lat=120, lon=0)


class TestRota:
    def test_vizinho_mais_proximo(self):
        origem = (-2.50, -44.30)
        paradas = [
            {"pedido_id": "longe", "lat": -2.60, "lon": -44.30},
            {"pedido_id": "perto", "lat": -2.51, "lon": -44.30},
            {"pedido_id": "sem", "lat": None, "lon": None, "endereco": "Rua X"},
            {"pedido_id": "meio", "lat": -2.55, "lon": -44.30},
        ]
        ordem = [p["pedido_id"] for p in E.ordenar_paradas(origem, paradas)]
        assert ordem == ["perto", "meio", "longe", "sem"]

    def test_links(self):
        paradas = [{"lat": -2.5, "lon": -44.3}, {"endereco": "Rua Jerusalém, 5"}]
        url = E.link_google_maps(paradas)
        assert url.startswith("https://www.google.com/maps/dir/?api=1")
        assert "waypoints=-2.5%2C-44.3" in url and "destination=Rua%20Jerus" in url
        assert E.link_waze({"lat": -2.5, "lon": -44.3}) == "https://waze.com/ul?ll=-2.5,-44.3&navigate=yes"

    def test_geocoder_em_outra_cidade_e_descartado(self):
        with patch("app.services.geocoding.geocode_address",
                   new=AsyncMock(return_value={"lat": -23.55, "lon": -46.63})), \
             patch("app.redis_client.redis", MagicMock(get=AsyncMock(return_value=None), set=AsyncMock())):
            ponto = asyncio.run(E.coordenadas("Rua Jerusalém, 5", cidade="São Luís - MA", perto_de=(-2.53, -44.3)))
        assert ponto is None

    def test_cidade_da_pizzaria(self):
        assert E.cidade_da_pizzaria("Av. X, 100 - Centro, São Luís - MA") == "100 - Centro, São Luís - MA"

    def test_rota_comeca_pela_coleta_quando_ha_pedido_a_retirar(self):
        from app.routes import entregadores as R
        pizz = SimpleNamespace(id=uuid.uuid4(), nome="Palazio", endereco="Rua A, 1, São Luís - MA")
        cli = SimpleNamespace(nome="Ana")
        pedidos = [
            SimpleNamespace(id=uuid.uuid4(), numero_pedido=1, status="pronto_entrega", cliente=cli,
                            endereco_entrega="Rua B, 2", endereco_lat=-2.52, endereco_lon=-44.30),
            SimpleNamespace(id=uuid.uuid4(), numero_pedido=2, status="pronto_entrega", cliente=cli,
                            endereco_entrega="Rua C, 3", endereco_lat=-2.51, endereco_lon=-44.30),
        ]
        r_pizz = MagicMock()
        r_pizz.scalar_one.return_value = pizz
        r_ped = MagicMock()
        r_ped.scalars.return_value.all.return_value = pedidos
        db = AsyncMock()
        db.execute = AsyncMock(side_effect=[r_pizz, r_ped])
        ent = _ent()
        ent.lat, ent.lon, ent.localizacao_em = -2.40, -44.30, datetime.now(UTC) - timedelta(minutes=2)
        with patch.object(E, "coordenadas", new=AsyncMock(return_value=(-2.50, -44.30))):
            rota = asyncio.run(R.minha_rota(pizz.id, db, ent))
        tipos = [p["tipo"] for p in rota["paradas"]]
        assert tipos == ["coleta", "entrega", "entrega"]
        assert [p.get("numero_pedido") for p in rota["paradas"][1:]] == [2, 1]  # mais perto da pizzaria primeiro
        assert rota["origem"] == "posicao_atual"
        assert rota["google_maps_url"] and all(p["waze_url"] for p in rota["paradas"])
