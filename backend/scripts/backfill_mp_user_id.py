"""
Preenche `pizzarias.mp_user_id` para quem já tinha o access_token cadastrado.

Por que: o webhook do Mercado Pago descobre de qual pizzaria é o pagamento pelo
`user_id` que vem na notificação, comparando com `mp_user_id`. Pizzarias
configuradas antes da migration 030 estão com esse campo vazio — sem o backfill,
pagamento por link (cartão) só é confirmado automaticamente se houver uma única
pizzaria usando Mercado Pago.

Uso (dentro do container, depois de aplicar as migrations):
    python scripts/backfill_mp_user_id.py          # aplica
    python scripts/backfill_mp_user_id.py --dry-run  # só mostra o que faria

Idempotente: só toca em quem ainda está sem mp_user_id.
"""
import os
import sys
from pathlib import Path

import httpx
import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.secrets import decrypt_secret  # noqa: E402


def get_db_url() -> str:
    url = os.environ.get("DATABASE_URL_SYNC")
    if not url:
        url = os.environ.get("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql://")
    if not url:
        raise RuntimeError("Defina DATABASE_URL_SYNC ou DATABASE_URL no ambiente.")
    return url


def mp_user_id(token: str) -> str | None:
    r = httpx.get(
        "https://api.mercadopago.com/users/me",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15.0,
    )
    if r.is_error:
        print(f"    ✗ MP respondeu {r.status_code}: {r.text[:120]}")
        return None
    return str(r.json().get("id") or "") or None


def main() -> int:
    dry_run = "--dry-run" in sys.argv

    with psycopg.connect(get_db_url()) as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, nome, mp_access_token
              FROM public.pizzarias
             WHERE mp_access_token IS NOT NULL
               AND mp_access_token <> ''
               AND (mp_user_id IS NULL OR mp_user_id = '')
             ORDER BY nome
        """)
        pendentes = cur.fetchall()

        if not pendentes:
            print("Nada a fazer: toda pizzaria com token do MP já tem mp_user_id.")
            return 0

        print(f"{len(pendentes)} pizzaria(s) sem mp_user_id.\n")
        ok = falhou = 0
        for pid, nome, token_cru in pendentes:
            print(f"  • {nome}")
            token = decrypt_secret(token_cru)
            if not token:
                # Acontece se o APP_SECRET_KEY mudou depois do token ser salvo.
                print("    ✗ não consegui descriptografar o token (APP_SECRET_KEY mudou?)")
                falhou += 1
                continue
            uid = mp_user_id(token)
            if not uid:
                falhou += 1
                continue
            if dry_run:
                print(f"    → gravaria mp_user_id={uid}")
            else:
                cur.execute(
                    "UPDATE public.pizzarias SET mp_user_id = %s WHERE id = %s", (uid, pid)
                )
                print(f"    ✓ mp_user_id={uid}")
            ok += 1

        if dry_run:
            conn.rollback()
            print(f"\n[dry-run] {ok} seriam atualizadas, {falhou} com problema.")
        else:
            conn.commit()
            print(f"\n{ok} atualizada(s), {falhou} com problema.")
        # Falha explícita no CI/deploy se alguma pizzaria ficou para trás.
        return 1 if falhou else 0


if __name__ == "__main__":
    raise SystemExit(main())
